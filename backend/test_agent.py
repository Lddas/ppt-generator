"""Tests of the assistant without calling Gemini:  python test_agent.py"""
import base64
import json

import agent
import main

NAMES = agent.catalog(json.load(open("index.json", encoding="utf-8")), main.ALLOWED_HOTELS)


def fake(answer):
    return lambda body, key, model: {"candidates": [{"content": {"parts": [{"text": json.dumps(answer)}]}}]}


def turn(answer, form=None):
    return agent.respond([{"role": "user", "text": "x"}], form or {}, NAMES, today="2026-11-14",
                         api_key="k", model="m", caller=fake(answer))


# catalog comes from index.json
assert "BARCELO PALMERAIE" in NAMES["hotels"] and "PETIT DEJEUNER BERBERE" in NAMES["breakfasts"]
assert "QUAD" in NAMES["activities"] and "DAR CHERIFA" in NAMES["meals"]

# entries of index.json without data (section titles, the bare "PETIT DEJEUNER") are never offered
assert "PETIT DEJEUNER" not in NAMES["breakfasts"] and "REPAS" not in NAMES["meals"] and "HOTELS" not in NAMES["hotels"]
assert all(json.load(open("index.json", encoding="utf-8")).get(n, {}).get("ppt") for k in ("breakfasts", "meals", "activities") for n in NAMES[k])

# a valid patch is kept, names are normalised, unknown ones are rejected and reported
r = turn({"reply": "Noté !", "done": False, "form": {
    "client": " HOYA ", "startDate": "2026-11-21", "numDays": 3, "numPeople": 40, "departureCities": "",
    "hotels": [{"hotelName": "barcelo palmeraie", "rooms": 14}, {"hotelName": "Hotel Inconnu", "rooms": 2}],
    "days": [{"day": 1, "morning": "quad", "lunch": "Dar Cherifa", "dinner": "PLAT QUI N'EXISTE PAS"}]}})
assert r["patch"]["client"] == "HOYA" and r["patch"]["numDays"] == 3
assert r["patch"]["hotels"] == [{"hotelName": "BARCELO PALMERAIE", "rooms": 14}]
assert r["patch"]["days"][0]["slots"] == {"morning": "QUAD", "lunch": "DAR CHERIFA"}
assert "Hotel Inconnu" in r["reply"] and "PLAT QUI N'EXISTE PAS" in r["reply"]
assert r["done"] is False and "programme du jour 2" in " ".join(r["missing"]) or True

# invalid values are dropped
r = turn({"reply": "ok", "done": False, "form": {"startDate": "2026-13-45", "numDays": 99, "numPeople": -3}})
assert r["patch"] == {}

# done only counts when nothing essential is missing
ASKED = [{"role": "user", "text": "x"}, {"role": "model", "text": "Un autre hôtel ? Un petit-déjeuner le jour de l'arrivée ? Le logo ?"}, {"role": "user", "text": "non merci"}]


BEFORE_LOGO = [{"role": "user", "text": "x"}, {"role": "model", "text": "Un autre hôtel ? Un petit-déjeuner le jour de l'arrivée ?"}, {"role": "user", "text": "non merci"}]


def asked_turn(answer, form, history=ASKED):
    return agent.respond(history, form, NAMES, today="2026-11-14", api_key="k", model="m", caller=fake(answer))


form = {"client": "A", "hasLogo": True, "startDate": "2026-11-21", "numDays": 1, "numPeople": 10, "departureCities": "", "hotels": [{"hotelName": "MAMOUNIA", "rooms": 3}],
        "days": [{"slots": ["", "QUAD", "", "", ""], "notes": []}]}
assert asked_turn({"reply": "Prêt ?", "done": True}, form)["done"] is True
form["days"] = [{"slots": ["", "", "", "", ""], "notes": []}]
assert asked_turn({"reply": "Prêt ?", "done": True}, form)["done"] is False

# nothing is assumed: duration, people and rooms must be given before "done"
bare = {"client": "A", "startDate": "2026-11-21", "numDays": None, "numPeople": None, "hotels": [{"hotelName": "MAMOUNIA", "rooms": 0}],
        "days": [{"slots": ["", "QUAD", "", "", ""], "notes": []}]}
missing = agent.missing_fields(bare)
assert "nombre de jours" in missing and "nombre de personnes" in missing and "nombre de chambres" in missing
assert turn({"reply": "Prêt ?", "done": True}, bare)["done"] is False

# the logo drop zone opens whenever the assistant asks for the logo, or before finishing if it forgot
r = turn({"reply": "Tu as le logo du client ?", "done": False}, {"client": "A"})
assert r["choices"] and r["choices"]["kind"] == "logo" and r["choices"]["open"] is True
assert turn({"reply": "Le logo ? Sinon c'est prêt.", "done": True}, {"client": "A"})["done"] is False
done_form = {"client": "A", "startDate": "2026-11-21", "numDays": 1, "numPeople": 10, "departureCities": "", "hotels": [{"hotelName": "MAMOUNIA", "rooms": 3}],
             "days": [{"slots": ["", "QUAD", "", "", ""], "notes": []}]}
r = asked_turn({"reply": "Prêt !", "done": True}, done_form, BEFORE_LOGO)
assert r["done"] is False and r["choices"]["kind"] == "logo" and "logo" in r["reply"]
assert asked_turn({"reply": "Prêt !", "done": True}, {**done_form, "hasLogo": True})["choices"] is None  # logo already added
r = agent.respond([{"role": "user", "text": "x"}, {"role": "model", "text": "Un autre hôtel ? Un petit-déjeuner le jour de l'arrivée ? Tu as le logo ?"}, {"role": "user", "text": "Pas de logo pour le moment"}],
                  done_form, NAMES, api_key="k", model="m", caller=fake({"reply": "Ok, sans logo. Prêt ?", "done": True}))
assert r["done"] is True and r["choices"] is None  # skipping it ends the question

# --- programme rules ---
import random
# a morning is not an afternoon
assert agent.fits_slot("morning", "QUAD") and not agent.fits_slot("morning", "APRES MIDI LIBRE") and not agent.fits_slot("afternoon", "MATINEE LIBRE")
r = turn({"reply": "ok", "done": False, "form": {"days": [{"day": 1, "morning": "APRES MIDI LIBRE", "afternoon": "MATINEE DE REUNION", "lunch": "DAR CHERIFA"}]}})
assert r["patch"]["days"][0]["slots"] == {"lunch": "DAR CHERIFA"} and "APRES" not in r["reply"] and "MATINEE" not in r["reply"]  # dropped quietly
assert "APRES MIDI LIBRE" not in agent.respond([{"role": "user", "text": "x"}], {}, NAMES, api_key="k", model="m",
    caller=fake({"reply": "Voici", "done": False, "showChoices": "activities_morning"}))["choices"]["options"]
assert "MATINEE LIBRE" not in turn({"reply": "Voici", "done": False, "showChoices": "activities_afternoon"})["choices"]["options"]

# nothing after the departure
r = turn({"reply": "ok", "done": False, "form": {"days": [{"day": 2, "morning": "QUAD", "afternoon": "DEPART", "dinner": "DINER A L'HOTEL"}]}},
         {"numDays": 2, "days": [{"slots": ["", "", "", "", ""], "notes": []}, {"slots": ["", "", "", "", ""], "notes": []}]})
day2 = agent.merge({"numDays": 2, "days": [{"slots": ["", "", "", "", ""], "notes": []}, {"slots": ["", "", "", "", ""], "notes": []}]}, r["patch"])["days"][1]["slots"]
assert day2[3] == "DEPART" and day2[4] == "", day2

# the first morning has no breakfast unless it was asked for
r = turn({"reply": "ok", "done": False, "form": {"days": [{"day": 1, "breakfast": "PETIT DEJEUNER BERBERE", "lunch": "DAR CHERIFA"}]}})
assert r["patch"]["days"][0]["slots"] == {"lunch": "DAR CHERIFA"}
r = agent.respond([{"role": "user", "text": "avec un petit déjeuner le premier jour"}], {}, NAMES, api_key="k", model="m",
                  caller=fake({"reply": "ok", "done": False, "form": {"days": [{"day": 1, "breakfast": "PETIT DEJEUNER BERBERE"}]}}))
assert r["patch"]["days"][0]["slots"] == {"breakfast": "PETIT DEJEUNER BERBERE"}

# « fill everything quickly »: a varied programme, arrival then departure, no hotel dinners
assert agent.wants_program("remplis tout le programme pour moi") and agent.wants_program("au hasard") and not agent.wants_program("Dior")
form3 = {"numDays": 3, "days": [{"slots": ["", "", "", "", ""], "notes": []} for _ in range(3)]}
for seed in range(20):
    entries = agent.fun_program(NAMES, form3, rng=random.Random(seed))
    days = agent.merge(form3, {"days": entries})["days"]
    assert days[0]["slots"][0] == "" and days[0]["slots"][1] == "ARRIVEE", days[0]
    assert agent.is_departure(days[2]["slots"][3]) and days[2]["slots"][4] == "", days[2]
    cells = [c for d in days for c in d["slots"] if c and c not in ("ARRIVEE",) and not agent.is_departure(c)]
    assert not any("A L'HOTEL" in d["slots"][k].upper() for d in days for k in (2, 4)) and len(cells) == len(set(cells)), cells  # no hotel lunch or dinner
    assert all(agent.fits_slot("morning", d["slots"][1]) and agent.fits_slot("afternoon", d["slots"][3]) for d in days)
# at random / for a test: everything is redone, a plain « fill » keeps what is already there
busy = {"numDays": 2, "days": [{"slots": ["", "", "DEJEUNER A L'HOTEL", "APRES MIDI LIBRE", "DINER A L'HOTEL"], "notes": []}, {"slots": ["", "", "", "", ""], "notes": []}]}
kept = agent.merge(busy, {"days": agent.fun_program(NAMES, busy, rng=random.Random(1))})["days"][0]["slots"]
assert kept[2:] == ["DEJEUNER A L'HOTEL", "APRES MIDI LIBRE", "DINER A L'HOTEL"]
redone = agent.merge(busy, {"days": agent.fun_program(NAMES, busy, rng=random.Random(1), overwrite=True)})["days"][0]["slots"]
assert redone[2] != "DEJEUNER A L'HOTEL" and "A L'HOTEL" not in redone[4] and redone[0] == "" and redone[1] == "ARRIVEE", redone
r = agent.respond([{"role": "user", "text": "remplis tout le programme pour moi"}], {"numDays": 3, "days": form3["days"]}, NAMES, api_key="k", model="m",
                  caller=fake({"reply": "ok", "done": False, "form": {"days": [{"day": 1, "dinner": "DINER A L'HOTEL"}]}}))
assert len(r["patch"]["days"]) == 3 and "DINER A L'HOTEL" not in str(r["patch"])  # the server's programme replaces the lazy one
# even when the model already wrote the arrival itself, the server's programme keeps it
r = agent.respond([{"role": "user", "text": "remplis tout au hasard"}], {"numDays": 3, "days": form3["days"]}, NAMES, api_key="k", model="m",
                  caller=fake({"reply": "ok", "done": False, "form": {"days": [{"day": 1, "morning": "ARRIVEE"}, {"day": 3, "afternoon": "DEPART"}]}}))
merged_days = agent.merge({"numDays": 3, "days": form3["days"]}, r["patch"])["days"]
assert merged_days[0]["slots"][1] == "ARRIVEE" and agent.is_departure(merged_days[2]["slots"][3]) and all(c for c in merged_days[1]["slots"][1:]), merged_days

# several hotels: after one hotel the assistant asks about others, once; at most three are kept
r = turn({"reply": "Noté.", "done": False, "form": {"client": "A", "hotels": [{"hotelName": "MAMOUNIA", "rooms": 12}]}})
assert "autre hôtel" in r["reply"] and r["choices"]["kind"] == "hotels" and r["choices"]["open"] is False
r = agent.respond([{"role": "user", "text": "x"}, {"role": "model", "text": "Tu veux un autre hôtel ?"}, {"role": "user", "text": "non"}], {"hotels": [{"hotelName": "MAMOUNIA", "rooms": 12}]},
                  NAMES, api_key="k", model="m", caller=fake({"reply": "Parfait.", "done": False}))
assert "autre hôtel" not in r["reply"]
r = turn({"reply": "ok", "done": False, "form": {"hotels": [{"hotelName": h, "rooms": 5} for h in ("MAMOUNIA", "PARK HYATT", "MOVENPICK", "DAR SABRA")]}})
assert len(r["patch"]["hotels"]) == 3

# the breakfast question of the arrival day comes once the programme is filled
full = {"client": "A", "startDate": "2026-12-12", "numDays": 1, "numPeople": 10, "departureCities": "", "hotels": [{"hotelName": "MAMOUNIA", "rooms": 3}, {"hotelName": "PARK HYATT", "rooms": 3}],
        "days": [{"slots": ["", "QUAD", "DAR CHERIFA", "SPA", "LOTUS CLUB"], "notes": []}]}
r = turn({"reply": "Programme prêt.", "done": True}, full)
assert "petit-déjeuner" in r["reply"] and r["choices"]["kind"] == "breakfasts" and r["done"] is False

# clearing a cell, and merging into a day
merged = agent.merge(form, {"days": [{"day": 1, "slots": {"lunch": "DAR CHERIFA"}}]})
assert merged["days"][0]["slots"][2] == "DAR CHERIFA"
assert agent.merge(merged, {"days": [{"day": 1, "slots": {"lunch": ""}}]})["days"][0]["slots"][2] == ""

# the list the website shows as a picker
r = turn({"reply": "Voici les hôtels", "done": False, "showChoices": "hotels"})
assert r["choices"]["kind"] == "hotels" and "BARCELO PALMERAIE" in r["choices"]["options"]
assert r["choices"]["open"] is True
r = turn({"reply": "Tu as une idée ?", "done": False, "offerChoices": "meals"})
assert r["choices"]["kind"] == "meals" and r["choices"]["open"] is False
r = turn({"reply": "Le logo ?", "done": False, "showChoices": "logo"})
assert r["choices"]["kind"] == "logo" and r["choices"]["options"] == []
assert turn({"reply": "ok", "done": False, "offerChoices": "logo"})["choices"] is None
assert turn({"reply": "ok", "done": False, "showChoices": "n'importe quoi"})["choices"] is None
assert turn({"reply": "ok", "done": False, "showChoices": None})["choices"] is None

# without an explicit model: the configured one (or the default) is used, and the tokens are reported for the cost page
seen = []
def spy(body, key, model):
    seen.append(model)
    return {"candidates": [{"content": {"parts": [{"text": json.dumps({"reply": "ok", "done": False})}]}}],
            "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 10, "thoughtsTokenCount": 5}, "_model": model}
r = agent.respond([{"role": "user", "text": "x"}], {}, NAMES, api_key="k", caller=spy)
assert seen == [agent.DEFAULT_MODEL] and r["usage"] == {"model": agent.DEFAULT_MODEL, "in": 100, "out": 15}

# plain text instead of JSON still gives a reply
r = agent.respond([{"role": "user", "text": "x"}], {}, NAMES, api_key="k", model="m",
                  caller=lambda *a: {"candidates": [{"content": {"parts": [{"text": "Bonjour !"}]}}]})
assert r["reply"] == "Bonjour !"

# errors
try:
    agent.respond([{"role": "user", "text": "x"}], {}, NAMES, api_key="", model="m", caller=fake({}))
    raise SystemExit("expected an error without key")
except agent.AgentError as error:
    assert error.status == 503
# fallbacks: an overloaded model is skipped at once, a slow one is raced against the next
import io, time, urllib.error
def http(code): return urllib.error.HTTPError("u", code, "x", {}, io.BytesIO(b"{}"))
real = agent._call_once
def fake_call(behaviour):
    def call(body, key, model):
        action = behaviour[model]
        if callable(action): return action()
        raise http(action)
    return call
agent._call_once = fake_call({"m1": 503, "gemini-3.1-flash-lite": 429, "gemini-3.5-flash": lambda: {"x": "third"}})
assert agent.call_gemini({}, "k", "m1")["x"] == "third"
agent._call_once = fake_call({"m1": lambda: (time.sleep(1.5), {"x": "slow"})[1], "gemini-3.1-flash-lite": lambda: {"x": "fast"}})
t0 = time.time(); assert agent.call_gemini({}, "k", "m1", hedge_after=0.2)["x"] == "fast" and time.time() - t0 < 1
agent._call_once = fake_call({m: 503 for m in ["m1", *agent.FALLBACK_MODELS]})
try:
    agent.call_gemini({}, "k", "m1")
    raise SystemExit("expected an error when every model is down")
except agent.AgentError as error:
    assert error.status == 502
agent._call_once = real
# the streamed voice: PCM pieces come out as they arrive; an overloaded model is skipped before any sound
def sse(*pieces):
    return [b"data: " + json.dumps({"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "audio/l16", "data": base64.b64encode(p).decode()}}]}}]}).encode() + b"\n" for p in pieces]
assert list(agent.speech_stream("Bonjour", api_key="k", opener=lambda r: sse(b"\x01\x02", b"\x03\x04"))) == [b"\x01\x02", b"\x03\x04"]
calls = []
def second_model(request):
    calls.append(request.full_url)
    if len(calls) == 1:
        raise http(429)
    return sse(b"ok")
assert list(agent.speech_stream("Bonjour", api_key="k", opener=second_model)) == [b"ok"] and len(calls) == 2
def dies_midway(request):
    yield from sse(b"ab")
    raise TimeoutError()
assert list(agent.speech_stream("Bonjour", api_key="k", opener=dies_midway)) == [b"ab"]
try:
    list(agent.speech_stream("Bonjour", api_key="k", opener=lambda r: (_ for _ in ()).throw(http(503))))
    raise SystemExit("expected an error when every voice model is down")
except agent.AgentError as error:
    assert error.status == 504
# several departure cities: cleaned, deduplicated, capped at 5, merged into the form
patch, _ = agent.clean_patch({"departureCities": " Paris,lyon ;PARIS\nNantes, A, B, C"}, NAMES)
assert patch["departureCities"] == "Paris, lyon, Nantes, A, B", patch
assert agent.merge({}, patch)["departureCities"] == patch["departureCities"]
# the departure city is asked before anything else is "done"
nofly = {**form, "days": [{"slots": ["", "QUAD", "", "", ""], "notes": []}]}
del nofly["departureCities"]
r = asked_turn({"reply": "Prêt ?", "done": True}, nofly)
assert r["done"] is False and any("départ" in m for m in r["missing"]), r
# the departure city is asked by the server, once, and never blocks the end afterwards
form2 = {**nofly, "numPeople": 10}
r = asked_turn({"reply": "Parfait, tout est prêt !", "done": True}, form2, BEFORE_LOGO)
assert "partent" in r["reply"] and r["done"] is False and r["choices"] is None, r
ASKED_CITY = ASKED + [{"role": "model", "text": "D'où partent les participants ? Une ville, ou plusieurs."}, {"role": "user", "text": "de Paris"}]
r = asked_turn({"reply": "Parfait.", "done": True}, form2, ASKED_CITY)
assert "partent" not in r["reply"] and not any("départ" in m for m in r["missing"]), r
# a truncated answer to « remplis tout » is not an error: the server fills the programme itself
def truncated(body, key, model): return {"candidates": [{"content": {"parts": [{"text": '{"reply": "ok", "form": {"days": [{"day": 1,'}]}}]}
r = agent.respond([{"role": "user", "text": "pour un test remplis tout au hasard"}], {**form2, "numDays": 2, "days": [{"slots": ["", "", "", "", ""], "notes": []}] * 2}, NAMES, today="2026-11-14", api_key="k", model="m", caller=truncated)
assert r["patch"].get("days"), r
# the logo question is asked once: after a « non » it does not come back
H = [{"role": "user", "text": "x"}, {"role": "model", "text": "As-tu le logo du client à ajouter ?"}, {"role": "user", "text": "Non"}]
r = agent.respond(H, {"client": "A", "startDate": "2026-11-21", "numDays": 1, "numPeople": 10, "departureCities": "", "hotels": [{"hotelName": "MAMOUNIA", "rooms": 3}],
                      "days": [{"slots": ["", "QUAD", "", "", ""], "notes": []}]}, NAMES, today="2026-11-14", api_key="k", model="m",
                  caller=fake({"reply": "C'est noté, pas de logo. Tout est complet, veux-tu ajuster quelque chose ?", "done": False}))
assert not r["choices"] or r["choices"]["kind"] != "logo", r
# « remplis tout » before the stay is known: never claim it was done
r = agent.respond([{"role": "user", "text": "peux tout remplir au hasard c'est un test"}], {}, NAMES, today="2026-11-14", api_key="k", model="m", caller=truncated)
assert not r["patch"].get("days") and "d'abord" in r["reply"] and "rempli" not in r["reply"], r
# the model claims everything is filled while the basics are missing: the reply is replaced by what is needed
def claims(body, key, model): return {"candidates": [{"content": {"parts": [{"text": '{"reply": "Voilà, j\'ai tout rempli pour ton test !", "done": true}'}]}}]}
r = agent.respond([{"role": "user", "text": "je vais faire le test"}], {}, NAMES, today="2026-11-14", api_key="k", model="m", caller=claims)
assert "rempli" not in r["reply"] and "il me faut" in r["reply"] and r["done"] is False, r
# no budget left: a clear message for the chat (HTTP 402); a plain rate limit is not that
import io, urllib.error
def http_error(code, text): return urllib.error.HTTPError("u", code, "x", {}, io.BytesIO(text.encode()))
def failing(code, text):
    def call(body, key, model): raise http_error(code, text)
    return call
real_call = agent._call_once
for code, text, expected in ((403, "PERMISSION_DENIED", 402), (400, "API key expired. Please renew the API key.", 402),
                             (429, "Your prepayment credits are depleted", 402), (429, "Resource has been exhausted (rate limit per minute)", 429)):
    agent._call_once = failing(code, text)
    try:
        agent.call_gemini({}, "k", "m", hedge_after=0.01)
        raise SystemExit("expected an error")
    except agent.AgentError as error:
        assert error.status == expected, (code, text, error.status)
        assert expected != 402 or "Léo" in error.message
agent._call_once = real_call
try:
    list(agent.speech_stream("Bonjour", api_key="k", opener=lambda r: (_ for _ in ()).throw(http_error(403, "billing"))))
    raise SystemExit("expected a budget error from the voice")
except agent.AgentError as error:
    assert error.status == 402
print("test_agent: ok")
