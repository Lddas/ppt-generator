"""Assistant that fills the form by talking, powered by Gemini Flash.

The Gemini key stays on the server (env GEMINI_API_KEY): the website code is public.
The model answers with a JSON object: a reply to show, a patch of the form, and whether it is done.
Everything it proposes is checked here against the real lists (hotels, restaurants, activities).
"""
import base64
import concurrent.futures
import datetime
import difflib
import io
import json
import os
import random
import re
import urllib.error
import urllib.parse
import urllib.request

import usage

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-3.5-flash-lite"  # ~1.5 s a turn; override with GEMINI_MODEL
FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"]  # when Google is overloaded or the quota is spent
SLOT_KEYS = ["breakfast", "morning", "lunch", "afternoon", "dinner"]
SLOT_LABELS = {"breakfast": "petit-déjeuner", "morning": "matinée", "lunch": "déjeuner",
               "afternoon": "après-midi", "dinner": "dîner"}
CHOICE_KINDS = {"hotels": "hôtels", "breakfasts": "petits-déjeuners", "meals": "restaurants et soirées",
                "activities": "activités", "activities_morning": "activités du matin", "activities_afternoon": "activités de l'après-midi",
                "logo": "logo"}
TRANSFERS = ("ARRIVEE", "DEPART")  # names starting like this are transfers (DEPART, DEPART AEROPORT EN 4X4)


def fits_slot(slot, name):
    """A morning is not an afternoon: « APRES MIDI LIBRE » is never offered for the morning, « MATINEE LIBRE » never for the afternoon."""
    name = name.upper()
    if slot == "morning":
        return not name.startswith("APRES MIDI")
    if slot == "afternoon":
        return not name.startswith("MATINEE")
    return True


def is_departure(name):
    return str(name or "").upper().startswith("DEPART")
CLEAR = "AUCUN"  # what the model writes to empty a cell

_FORM_PROPERTIES = {
    "client": {"type": "STRING"},
    "eventTitle": {"type": "STRING"},
    "startDate": {"type": "STRING", "description": "AAAA-MM-JJ, null si inchangé"},
    "numDays": {"type": "INTEGER"},
    "numNights": {"type": "INTEGER"},
    "numPeople": {"type": "INTEGER"},
    "departureCities": {"type": "STRING", "description": "villes de départ des vols, séparées par des virgules (2 à 5 ajoutent les plans de vol aller et retour), \"\" pour effacer, null si inchangé"},
    "hotels": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
        "hotelName": {"type": "STRING"},
        "rooms": {"type": "INTEGER", "description": "0 tant que l'utilisateur n'a pas donné le nombre de chambres"}}}},
    "days": {"type": "ARRAY", "maxItems": 8, "description": "un seul objet par jour modifié, avec ses 5 cases ; \"\" = case inchangée",
             "items": {"type": "OBJECT", "properties": {
                 "day": {"type": "INTEGER"},
                 **{key: {"type": "STRING"} for key in SLOT_KEYS},
                 "notes": {"type": "ARRAY", "items": {"type": "STRING"}}},
                 "required": ["day", *SLOT_KEYS]}},
}
# Flat on purpose: a nested "form" object made the model drift inside string fields.
# Every field is required (null / empty = unchanged), otherwise the model closes the JSON early.
SCHEMA = {
    "type": "OBJECT",
    "properties": {"reply": {"type": "STRING"}, "done": {"type": "BOOLEAN"},
                   "showChoices": {"type": "STRING", "nullable": True,
                                   "description": "hotels, breakfasts, meals, activities_morning, activities_afternoon ou logo : affiche la liste cliquable (ou la zone de dépôt du logo) ; null sinon"},
                   "offerChoices": {"type": "STRING", "nullable": True,
                                    "description": "hotels, breakfasts, meals, activities_morning ou activities_afternoon : ajoute un bouton « Voir les options » sous ta question ; null sinon"},
                   **{key: {**value, "nullable": True} for key, value in _FORM_PROPERTIES.items()}},
    "required": ["reply", "done", "showChoices", "offerChoices", *_FORM_PROPERTIES],
}


class AgentError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def catalog(index, hotels):
    """The names the agent may use, taken from index.json so they never go out of date."""
    names = {"hotels": sorted(hotels), "breakfasts": [], "meals": [], "activities": []}
    for name, entry in index.items():
        ppt = entry.get("ppt")
        if not ppt or (ppt != "FALSE" and "index" not in entry):
            continue  # a placeholder or section title in index.json (e.g. "PETIT DEJEUNER" alone): the generator has nothing to build from it
        if name.startswith("PETIT DEJEUNER"):
            names["breakfasts"].append(name)
        elif ppt == "liste_REPAS.pptx":
            names["meals"].append(name)
        elif ppt in ("liste_ACTIVITES.pptx", "FALSE"):
            names["activities"].append(name)
    for key in ("breakfasts", "meals", "activities"):
        names[key] = sorted(set(names[key]))
    return names


def system_prompt(names, form, missing, today):
    return f"""Tu es l'assistant de Preference Events (agence événementielle à Marrakech). Tu aides un collègue à remplir le formulaire qui génère une présentation PowerPoint de séminaire. Tu parles français, de façon chaleureuse, brève et naturelle (une à deux phrases), en tutoyant. Pose UNE question à la fois (deux au maximum si elles vont ensemble), dans cet ordre de priorité : client, dates d'arrivée et nombre de jours, nombre de personnes, ville(s) de départ des vols, hôtel(s) et nombre de chambres, puis le programme de chaque jour.

Date du jour : {today}. Si l'utilisateur donne une date sans année, prends la prochaine occurrence à venir. Renseigne startDate au format AAAA-MM-JJ. Si l'utilisateur donne des dates de début et de fin, déduis numDays (jours) et numNights = numDays - 1. Une seule date (arrivée) ne suffit JAMAIS à connaître la durée : tant que l'utilisateur n'a pas donné une date de fin, un nombre de jours ou un nombre de nuits, numDays et numNights restent null et tu demandes « combien de jours ? ». Ne suppose jamais une durée, ni un nombre de personnes : un champ null dans l'état du formulaire veut dire « pas encore donné ».

Programme d'un jour : 5 cases fixes, breakfast (petit-déjeuner), morning (matinée), lunch (déjeuner), afternoon (après-midi), dinner (dîner). Remplis les cases avec les noms EXACTS de ces listes, jamais autre chose :
- HÔTELS : {" | ".join(names["hotels"])}
- PETITS-DÉJEUNERS : {" | ".join(names["breakfasts"])}
- RESTAURANTS ET SOIRÉES (déjeuner, dîner) : {" | ".join(names["meals"])}
- ACTIVITÉS ET TRANSFERTS (matinée, après-midi) : {" | ".join(names["activities"])}
Si l'utilisateur demande quelque chose qui n'existe pas, propose l'option la plus proche de la liste. N'invente aucun nom. Pour vider une case, écris "{CLEAR}". Les notes manuelles (notes) sont des rappels libres : n'en ajoute que si on te le demande.

Choix dans une liste (hôtel, petit-déjeuner, restaurant, activité) : n'écris JAMAIS la liste des noms dans reply, le site sait l'afficher joliment. Chaque fois que tu poses une question dont la réponse est un hôtel, un petit-déjeuner, un restaurant ou une activité, dis-le dans ta phrase (« tu as déjà une idée, ou tu veux voir les options ? ») et mets offerChoices à hotels, breakfasts, meals (déjeuner, dîner), activities_morning (matinée) ou activities_afternoon (après-midi) : le site ajoute un bouton « Voir les options ». Quand la personne te demande les options, la liste, ce qui existe ou « propose-moi », mets showChoices au même type et réponds en une courte phrase (« Voici les hôtels, clique sur celui que tu veux »). Sinon showChoices et offerChoices restent null.

Logo : hasLogo dit si un logo est déjà ajouté. Quand le client, les dates, l'hôtel et le programme sont remplis, hasLogo est false et que tu n'as pas encore posé la question, demande si la personne a le logo du client et mets showChoices à logo (le site affiche une zone de dépôt, on peut aussi passer). Ne mets done à true qu'après avoir posé cette question.

Règles du programme :
- Une matinée n'est PAS un après-midi : pour la case morning n'utilise jamais un nom qui commence par « APRES MIDI », pour afternoon jamais un nom qui commence par « MATINEE ».
- Jour d'arrivée (jour 1) : il n'y a presque jamais de petit-déjeuner. Laisse breakfast du jour 1 vide, et demande une fois « tu veux un petit-déjeuner le jour de l'arrivée ? » ; ne le remplis que si la personne dit oui.
- Dernier jour : après le départ (un nom qui commence par DEPART), le programme s'arrête ; les cases suivantes du même jour restent vides. Ne mets jamais de dîner après un départ.
- Quand on te demande de remplir vite, au hasard ou pour un test, propose un programme varié et agréable (activités, restaurants, soirées différents d'un jour à l'autre), pas seulement des repas à l'hôtel.
- Plusieurs hôtels : après le premier hôtel, demande une fois s'il faut proposer un ou plusieurs autres hôtels (jusqu'à trois) ; la présentation ajoute alors une slide « PROPOSITIONS D'HEBERGEMENT ».

Vols : si on te dit que des participants partent de plusieurs villes (Paris, Lyon, Nantes…), mets-les dans departureCities (2 à 5 villes, séparées par des virgules) : cela ajoute les slides de plans de vol aller et retour. Ne pose pas la question de toi-même, c'est facultatif.
Si on te demande de tout remplir (au hasard, pour un test), ne remplis PAS days toi-même : le serveur le fait. Réponds seulement par une phrase très courte, et demande ce qui manque (client, date d'arrivée, nombre de jours).
N'invente jamais une information : ne remplis eventTitle que si on te le dit, et pour les chambres mets rooms à 0 puis demande le nombre : ne le déduis jamais du nombre de personnes. Un champ non mentionné reste null.

À chaque réponse :
- reply : ce que tu dis à l'utilisateur (confirme brièvement ce que tu viens de noter, puis pose la prochaine question).
- les autres champs (client, startDate, numDays, numNights, numPeople, departureCities, hotels, days) : seulement ce qui change, directement à la racine du JSON (pour hotels, la liste complète des hôtels ; pour days, uniquement les jours et cases modifiés, day commence à 1).
- done : true seulement quand tout l'essentiel est rempli ET que tu as récapitulé en une phrase en demandant s'il faut ajuster quelque chose ; sinon false.

État actuel du formulaire : {json.dumps(form, ensure_ascii=False)}
Ce qu'il manque encore : {", ".join(missing) if missing else "rien d'essentiel"}"""


def _match(value, options):
    """The option the text refers to (exact, ignoring case/accents-free typos), or None."""
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip().upper()
    for option in options:
        if option.upper() == value:
            return option
    close = difflib.get_close_matches(value, [o.upper() for o in options], n=1, cutoff=0.8)
    return next((o for o in options if o.upper() == close[0]), None) if close else None


def _int(value, low, high):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if low <= number <= high else None


def clean_patch(raw, names):
    """Keep only what is valid. Returns (patch, rejected names)."""
    patch, rejected = {}, []
    raw = raw if isinstance(raw, dict) else {}
    for key in ("client", "eventTitle"):
        if isinstance(raw.get(key), str) and raw[key].strip():
            patch[key] = raw[key].strip()
    date = raw.get("startDate")
    found = re.search(r"\d{4}-\d{2}-\d{2}", date) if isinstance(date, str) else None  # tolerate text around it
    if found:
        try:
            datetime.date.fromisoformat(found.group())
            patch["startDate"] = found.group()
        except ValueError:
            pass
    for key, low, high in (("numDays", 1, 8), ("numNights", 0, 9), ("numPeople", 1, 5000)):
        number = _int(raw.get(key), low, high)
        if number is not None:
            patch[key] = number
    if isinstance(raw.get("departureCities"), str):
        cities = []
        for city in re.split(r"[,;\n]+", raw["departureCities"]):
            city = city.strip()
            if city and city.lower() not in [c.lower() for c in cities]:
                cities.append(city)
        patch["departureCities"] = ", ".join(cities[:5])
    if isinstance(raw.get("hotels"), list):
        hotels = []
        for item in raw["hotels"]:
            name = _match((item or {}).get("hotelName"), names["hotels"])
            if name is None:
                rejected.append(str((item or {}).get("hotelName")))
                continue
            hotels.append({"hotelName": name, "rooms": _int((item or {}).get("rooms"), 1, 2000) or 10})
        if hotels:
            patch["hotels"] = hotels[:3]  # up to three hotels can be proposed
    allowed = {
        "breakfast": names["breakfasts"] + names["activities"],
        "morning": names["activities"] + names["breakfasts"],
        "lunch": names["meals"] + names["activities"],
        "afternoon": names["activities"],
        "dinner": names["meals"] + names["activities"],
    }
    days = []
    for item in raw.get("days") or []:
        day = _int((item or {}).get("day"), 1, 8)
        if day is None:
            continue
        entry = {"day": day, "slots": {}}
        for key in SLOT_KEYS:
            value = item.get(key)
            if not isinstance(value, str) or not value.strip():
                continue
            if value.strip().upper() == CLEAR:
                entry["slots"][key] = ""
                continue
            name = _match(value, [o for o in allowed[key] if fits_slot(key, o)])
            if name is None:
                if _match(value, allowed[key]) is None:  # unknown name: tell the user; a name of the wrong half of the day is just dropped
                    rejected.append(value)
            else:
                entry["slots"][key] = name
        if isinstance(item.get("notes"), list):
            entry["notes"] = [n.strip() for n in item["notes"] if isinstance(n, str) and n.strip()]
        if entry["slots"] or "notes" in entry:
            days.append(entry)
    if days:
        patch["days"] = days
    return patch, rejected


def merge(form, patch):
    """The form after applying the patch (same shape as the website's form)."""
    merged = json.loads(json.dumps(form or {}))
    for key in ("client", "eventTitle", "startDate", "numDays", "numNights", "numPeople", "departureCities", "hotels"):
        if key in patch:
            merged[key] = patch[key]
    days = merged.setdefault("days", [])
    wanted = merged.get("numDays") or len(days) or 1
    while len(days) < wanted:
        days.append({"slots": ["", "", "", "", ""], "notes": []})
    for entry in patch.get("days", []):
        while len(days) < entry["day"]:
            days.append({"slots": ["", "", "", "", ""], "notes": []})
        day = days[entry["day"] - 1]
        day["slots"] = list(day.get("slots") or ["", "", "", "", ""])
        for key, value in entry["slots"].items():
            day["slots"][SLOT_KEYS.index(key)] = value
        if "notes" in entry:
            day["notes"] = entry["notes"]
    return merged


def missing_fields(form):
    missing = []
    if not (form.get("client") or "").strip():
        missing.append("nom du client")
    if not form.get("startDate"):
        missing.append("date d'arrivée")
    if not form.get("numDays"):
        missing.append("nombre de jours")
    if not form.get("numPeople"):
        missing.append("nombre de personnes")
    if form.get("departureCities") is None:  # "" = asked, nothing to plan
        missing.append("ville(s) de départ des vols")
    if not form.get("hotels"):
        missing.append("hôtel")
    elif any(not h.get("rooms") for h in form["hotels"]):
        missing.append("nombre de chambres")
    for number, day in enumerate(form.get("days") or [], 1):
        if not any(day.get("slots") or []) and not day.get("notes"):
            missing.append(f"programme du jour {number}")
    if not form.get("days"):
        missing.append("programme")
    return missing


def wants_program(text):
    """Does the message ask for the whole programme to be filled in (quickly, at random, for a test…)?"""
    text = (text or "").lower()
    if re.search(r"au hasard|al[ée]atoire|random|surprends|surprise|pour (un )?test|pour tester|for a test", text):
        return True
    return bool(re.search(r"remplis|rempli|compl[èe]te|g[ée]n[èe]re|fill|propose[- ]moi un programme", text)
                and re.search(r"programme|tout|test|everything|\ball\b|program|jours?", text))


def fun_program(names, form, rng=None, overwrite=False):
    """A varied, pleasant programme for the empty cells: activities, restaurants and evenings that change every day.
    Day 1: arrival and no breakfast. Last day: ends with the departure. Nothing after a departure.
    With overwrite (« at random », « for a test ») the whole programme is redone, otherwise only the empty cells are filled."""
    rng = rng or random.Random()
    num_days = int(form.get("numDays") or len(form.get("days") or []) or 0)
    if num_days < 1:
        return []
    boring = ("A L'HOTEL", "REUNION", "LIBRE", "A LA CARTE", "CHOIX")
    activities = [n for n in names["activities"] if not n.upper().startswith(TRANSFERS) and not any(b in n.upper() for b in boring)]
    morning = [n for n in activities if fits_slot("morning", n)]
    afternoon = [n for n in activities if fits_slot("afternoon", n)]
    meals = [n for n in names["meals"] if "A L'HOTEL" not in n.upper()]
    evenings = [n for n in meals if n.upper().startswith("SOIREE")] or meals
    lunches = [n for n in meals if not n.upper().startswith(("SOIREE", "AFTER", "CASINO", "LOTUS CLUB", "NOUBA"))] or meals
    breakfasts = list(names["breakfasts"])
    used = set()

    def pick(pool):
        fresh = [n for n in pool if n not in used] or pool
        if not fresh:
            return ""
        choice = rng.choice(fresh)
        used.add(choice)
        return choice

    arrival = next((n for n in names["activities"] if n.upper() == "ARRIVEE"), "")
    departures = [n for n in names["activities"] if is_departure(n)]
    days = form.get("days") or []
    entries = []
    for i in range(num_days):
        first, last = i == 0, i == num_days - 1 and num_days > 1
        wanted = {
            "breakfast": "" if first else pick(breakfasts),
            "morning": arrival if first else pick(morning),
            "lunch": pick(lunches),
            "afternoon": (rng.choice(departures) if departures else "") if last else pick(afternoon),
            "dinner": "" if last else pick(evenings),
        }
        current = (days[i].get("slots") if i < len(days) else None) or ["", "", "", "", ""]
        if overwrite:
            slots = {key: (value or CLEAR) for key, value in wanted.items() if value != current[SLOT_KEYS.index(key)] and (value or current[SLOT_KEYS.index(key)])}
        else:
            slots = {key: value for key, value in wanted.items() if value and not current[SLOT_KEYS.index(key)]}
        if slots:
            entries.append({"day": i + 1, "slots": slots})
    return entries


def _cut_after_departure(merged, patch):
    """Once a day has its departure, the rest of that day stays empty: add the clearing to the patch and to the merged form."""
    fixes = {}
    for number, day in enumerate(merged.get("days") or [], 1):
        slots = list(day.get("slots") or [])
        for k, name in enumerate(slots):
            if is_departure(name):
                fixes[number] = {SLOT_KEYS[later]: "" for later in range(k + 1, len(slots)) if slots[later]}
                break
    fixes = {number: slots for number, slots in fixes.items() if slots}
    if not fixes:
        return patch, merged
    days = {entry["day"]: entry for entry in patch.get("days", [])}
    merged = json.loads(json.dumps(merged))
    for number, slots in fixes.items():
        days.setdefault(number, {"day": number, "slots": {}})["slots"].update(slots)
        for key, value in slots.items():
            merged["days"][number - 1]["slots"][SLOT_KEYS.index(key)] = value
    return {**patch, "days": sorted(days.values(), key=lambda e: e["day"])}, merged


HOTEL_ASKED = re.compile(r"autres? h[ôo]tels?|deuxi[èe]me h[ôo]tel|plusieurs h[ôo]tels|second hotel|another hotel|other hotels?|more hotels|propos\w* un autre", re.I)
BREAKFAST = re.compile(r"petit[- ]?d[ée]j|breakfast", re.I)
ARRIVAL = re.compile(r"arriv|premier jour|jour 1|first day|day 1", re.I)


DEPARTURE_ASKED = re.compile(r"d['’]o[uù]\s+(part|vien|ven|décol|decol)|partent|ville.{0,25}d[ée]part|d[ée]part.{0,25}vol|where .{0,30}(fly|depart|travel)|departure cit", re.I)


def next_question(merged, turns, reply, still_missing, language):
    """The questions the assistant must not forget, in order. Returns (text, choices) or None."""
    said = " ".join(str(m["text"]) for m in turns if m["role"] == "model") + " " + reply
    if (any("départ" in m for m in still_missing) and merged.get("numPeople") and merged.get("startDate")
            and not DEPARTURE_ASKED.search(said)):
        text = ("Where are the participants flying from? One city or several." if language == "en"
                else "D'où partent les participants ? Une ville, ou plusieurs.")
        return text, None
    hotels = merged.get("hotels") or []
    if len(hotels) == 1 and hotels[0].get("rooms") and not HOTEL_ASKED.search(said):
        text = ("Do you want to propose another hotel as well (up to three)?" if language == "en"
                else "Tu veux proposer un autre hôtel en plus (jusqu'à trois) ?")
        return text, "hotels"
    days = merged.get("days") or []
    programme_filled = days and not any(m.startswith("programme") for m in still_missing)
    user_said = " ".join(str(m["text"]) for m in turns if m["role"] == "user")
    asked_breakfast = (BREAKFAST.search(said) and ARRIVAL.search(said)) or BREAKFAST.search(user_said) and ARRIVAL.search(user_said)
    first_slots = (days[0].get("slots") if days else None) or []
    if programme_filled and not asked_breakfast and not (first_slots and first_slots[0]):
        text = ("Do you want a breakfast on the arrival day? (usually there isn't one)" if language == "en"
                else "Tu veux un petit-déjeuner le jour de l'arrivée ? (en général il n'y en a pas)")
        return text, "breakfasts"
    return None


def _call_once(body, api_key, model):
    url = GEMINI_URL.format(model=model)
    headers = {"Content-Type": "application/json"}
    if api_key.startswith("AIza"):
        headers["x-goog-api-key"] = api_key
    else:  # newer key formats (AQ.…) are only accepted as a query parameter
        url += "?key=" + urllib.parse.quote(api_key, safe="")
    request = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _race(models, call, hedge_after, fatal=lambda error: False):
    """Runs call(model) on the models in order, but never waits: the next model starts at once when one fails
    and also when one is just slow (> hedge_after s). The first success wins; otherwise the last error is raised."""
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=len(models))
    pending, started, last, start_next = set(), 0, None, True
    try:
        while True:
            if start_next and started < len(models):
                pending.add(pool.submit(call, models[started]))
                started += 1
            start_next = False
            if not pending:
                raise last
            done, pending = concurrent.futures.wait(pending, timeout=hedge_after, return_when=concurrent.futures.FIRST_COMPLETED)
            if not done:
                start_next = True  # nothing yet: start the next model without cancelling this one
                continue
            for future in done:
                try:
                    return future.result()
                except Exception as error:  # noqa: BLE001 - classified by the caller
                    if fatal(error):
                        raise
                    last, start_next = error, True
            if started >= len(models) and not pending:
                raise last
    finally:
        pool.shutdown(wait=False)


def call_gemini(body, api_key, model, hedge_after=4.0):
    """Calls the model; if it is overloaded (429/500/503/404) or slow, the next Flash is raced against it."""
    models = [model] + [m for m in FALLBACK_MODELS if m != model]
    retriable = (404, 429, 500, 503)
    try:
        return _race(models, lambda m: {**_call_once(body, api_key, m), "_model": m}, hedge_after,
                     fatal=lambda e: isinstance(e, urllib.error.HTTPError) and e.code not in retriable)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        if error.code in (400, 403) and "API key" in detail:
            raise AgentError(502, "La clé Gemini est refusée. Vérifie GEMINI_API_KEY sur le serveur.")
        raise AgentError(429 if error.code == 429 else 502, "Gemini est saturé pour le moment, réessaie dans quelques secondes."
                         if error.code in (429, 503) else f"Gemini a répondu {error.code}.")
    except (urllib.error.URLError, TimeoutError):
        raise AgentError(504, "Gemini ne répond pas, réessaie dans un instant.")


def respond(messages, form, names, today=None, api_key=None, model=None, caller=call_gemini, language="fr", voice=False):
    """One turn of the conversation. messages: [{role: 'user'|'model', text}]."""
    api_key = api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise AgentError(503, "L'assistant n'est pas configuré (clé Gemini manquante sur le serveur).")
    today = today or datetime.date.today().isoformat()
    turns = [m for m in messages if m.get("role") in ("user", "model") and str(m.get("text", "")).strip()][-24:]
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    if not turns:
        raise AgentError(400, "Message vide.")
    form = form if isinstance(form, dict) else {}
    prompt = system_prompt(names, form, missing_fields(form), today)
    if language == "en":
        prompt += "\n\nLANGUAGE: the user speaks English. Write `reply` in warm, short, natural English (the rules above still apply). Catalog names stay EXACTLY as listed (they are French proper names); never translate them in the form fields. Never set eventTitle unless the user gave an explicit title."
    if voice:
        prompt += "\n\nMODE VOCAL: ta réponse est lue à voix haute, tout de suite. Réponds en UNE seule phrase courte (20 mots maximum), sans liste, sans parenthèses, sans émojis. Les cases du formulaire se remplissent normalement."
    body = {
        "systemInstruction": {"parts": [{"text": prompt}]},
        "contents": [{"role": m["role"], "parts": [{"text": str(m["text"])[:2000]}]} for m in turns],
        "generationConfig": {"temperature": 0.3, "responseMimeType": "application/json",
                             "responseSchema": SCHEMA, "maxOutputTokens": 1500,
                             "thinkingConfig": {"thinkingLevel": "low"}},
    }
    data = caller(body, api_key, model or usage.get_config().get("model") or os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL)
    meta = data.get("usageMetadata") or {}
    print("AGENT usage prompt=%s output=%s thoughts=%s total=%s" % (
        meta.get("promptTokenCount"), meta.get("candidatesTokenCount"), meta.get("thoughtsTokenCount"), meta.get("totalTokenCount")), flush=True)
    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        if not text.strip():
            raise KeyError("text")
    except (KeyError, IndexError, TypeError):
        raise AgentError(502, "Je n'ai pas bien compris, tu peux répéter ?")
    fallback = False
    try:
        answer = json.loads(re.sub(r"^```(?:json)?|```$", "", text.strip()).strip())
    except json.JSONDecodeError:
        if text.lstrip().startswith(("{", "[")):  # truncated JSON: never show it to the user
            last = next((m["text"] for m in reversed(turns) if m["role"] == "user"), "")
            if not wants_program(last.lower()):
                raise AgentError(502, "Je n'ai pas bien compris, tu peux répéter ?")
            # « remplis tout »: the programme is made by the server anyway, the model's long answer is not needed
            answer = {"reply": "C'est fait, je t'ai rempli un programme varié." if language != "en" else "Done, I filled in a varied programme.", "done": False}
            fallback = True
        else:
            answer = {"reply": text.strip(), "done": False}
    patch, rejected = clean_patch(answer["form"] if isinstance(answer.get("form"), dict) else answer, names)
    last_user = next((m["text"] for m in reversed(turns) if m["role"] == "user"), "").lower()
    merged = merge(form, patch)
    if wants_program(last_user) and merged.get("numDays"):  # a quick fill is made by the server, so it is always varied
        # compared with the form as it was before this turn (the model's own days are thrown away)
        patch["days"] = fun_program(names, {"numDays": merged["numDays"], "days": form.get("days") or []}, rng=None, overwrite=bool(re.search(r"hasard|al[ée]atoire|random|surprends|surprise|test", last_user)))
        merged = merge(form, patch)
    first_day_breakfast = any(e["day"] == 1 and e["slots"].get("breakfast") for e in patch.get("days", []))
    if first_day_breakfast and not (BREAKFAST.search(" ".join(str(m["text"]) for m in turns if m["role"] == "user"))):
        for entry in patch["days"]:  # nobody asked for it: no breakfast on the arrival day
            if entry["day"] == 1:
                entry["slots"].pop("breakfast", None)
        patch["days"] = [e for e in patch["days"] if e["slots"] or "notes" in e]
        if not patch["days"]:
            del patch["days"]
        merged = merge(form, patch)
    patch, merged = _cut_after_departure(merged, patch)
    still_missing = missing_fields(merged)
    if DEPARTURE_ASKED.search(" ".join(str(m["text"]) for m in turns if m["role"] == "model")):
        still_missing = [m for m in still_missing if "départ" not in m]  # asked once: it never blocks the end
    reply = str(answer.get("reply") or "").strip() or "Je n'ai pas bien compris, tu peux reformuler ?"
    if fallback and not patch.get("days"):  # nothing was filled (the length of the stay is unknown): never say it was
        need = [m for m in still_missing if not m.startswith(("programme", "hôtel", "nombre de chambres", "ville"))]
        reply = ((("I'd love to, but first I need: " + ", ".join(need[:2]) + ".") if language == "en"
                  else ("Avec plaisir, mais il me faut d'abord : " + ", ".join(need[:2]) + ".")) if need
                 else ("Tell me what to fill in." if language == "en" else "Dis-moi ce que tu veux que je remplisse."))
    if rejected:
        reply += " (Je n'ai pas trouvé : " + ", ".join(sorted(set(rejected))) + ".)"
    choices = None
    for field, opened in (("showChoices", True), ("offerChoices", False)):
        kind = str(answer.get(field) or "").strip().lower()
        if kind == "logo" and opened:
            choices = {"kind": "logo", "label": CHOICE_KINDS["logo"], "options": [], "open": True}
        elif kind in ("activities_morning", "activities_afternoon"):
            slot = kind.split("_")[1]
            options = [n for n in names["activities"] if fits_slot(slot, n)]
            choices = {"kind": kind, "label": CHOICE_KINDS[kind], "options": options, "open": opened}
        elif kind in CHOICE_KINDS and kind != "logo" and names.get(kind):
            choices = {"kind": kind, "label": CHOICE_KINDS[kind], "options": names[kind], "open": opened}
        if choices:
            break
    done = bool(answer.get("done")) and not still_missing
    # the logo drop zone must never depend on the model remembering to open it
    pending = next_question(merged, turns, reply, still_missing, language) if not (choices and choices["kind"] == "logo") else None
    if pending:
        reply += " " + pending[0]
        kind = pending[1]
        choices = {"kind": kind, "label": CHOICE_KINDS[kind], "options": names[kind], "open": False} if kind else None
        done = False
    if not form.get("hasLogo") and "logo" not in last_user and (choices is None or choices["kind"] == "logo"):
        mentions = "logo" in reply.lower()
        asked_before = any("logo" in str(m["text"]).lower() for m in turns if m["role"] == "model")
        logo_choices = {"kind": "logo", "label": CHOICE_KINDS["logo"], "options": [], "open": True}
        if mentions and "?" in reply:
            choices = logo_choices
        elif not still_missing and not mentions and not asked_before and not pending:
            reply += " Do you have the client's logo? You can drop it here." if language == "en" else " Tu as le logo du client ? Tu peux le déposer ici."
            choices, done = logo_choices, False
    if choices and choices["kind"] == "logo":
        done = False  # not finished while the logo question is open
    used = data.get("usageMetadata") or {}
    return {"reply": reply, "patch": patch, "done": done, "missing": still_missing, "choices": choices,
            "usage": {"model": data.get("_model") or model or DEFAULT_MODEL, "in": used.get("promptTokenCount") or 0,
                      "out": (used.get("candidatesTokenCount") or 0) + (used.get("thoughtsTokenCount") or 0)}}


TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview"]
TTS_VOICE = "Charon"  # override with GEMINI_VOICE


def _tts_body(text, voice):
    return {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {
            "prebuiltVoiceConfig": {"voiceName": voice or usage.get_config().get("voice") or os.environ.get("GEMINI_VOICE") or TTS_VOICE}}}},
    }


def _open_stream(request):
    return urllib.request.urlopen(request, timeout=20)


def speech_stream(text, api_key=None, voice=None, opener=_open_stream, info=None):
    """Spoken French as raw 16-bit 24 kHz mono PCM, yielded while Gemini still produces it (first sound in ~0.7 s).
    `info`, if given, receives the model used and the tokens billed (for the cost page)."""
    info = info if info is not None else {}
    api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        raise AgentError(503, "Clé Gemini manquante sur le serveur (GEMINI_API_KEY).")
    text = re.sub(r"\s+", " ", str(text or "")).strip()[:700]
    if not text:
        raise AgentError(400, "Rien à dire.")
    body = json.dumps(_tts_body(text, voice)).encode("utf-8")
    last = AgentError(502, "La voix est indisponible pour le moment.")
    for model in TTS_MODELS:
        url = GEMINI_URL.format(model=model).replace(":generateContent", ":streamGenerateContent") + "?alt=sse"
        headers = {"Content-Type": "application/json"}
        if api_key.startswith("AIza"):
            headers["x-goog-api-key"] = api_key
        else:
            url += "&key=" + urllib.parse.quote(api_key, safe="")
        started = False
        try:
            for line in opener(urllib.request.Request(url, data=body, headers=headers, method="POST")):
                line = line.strip()
                if not line.startswith(b"data:"):
                    continue
                event = json.loads(line[5:])
                if event.get("usageMetadata"):
                    info.update(model=model, tokens_in=event["usageMetadata"].get("promptTokenCount") or 0,
                                tokens_out=event["usageMetadata"].get("candidatesTokenCount") or 0)
                part = event["candidates"][0]["content"]["parts"][0].get("inlineData")
                if part and part.get("data"):
                    started = True
                    info.setdefault("model", model)
                    pcm = base64.b64decode(part["data"])
                    info["bytes"] = info.get("bytes", 0) + len(pcm)
                    info["chars"] = len(text)
                    yield pcm
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, IndexError, TypeError):
            if started:
                return  # cut off in the middle: what was said is said
            last = AgentError(504, "La voix ne répond pas.")
            continue
        if started:
            return
    raise last
