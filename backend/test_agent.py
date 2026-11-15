"""Tests of the assistant without calling Gemini:  python test_agent.py"""
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

# a valid patch is kept, names are normalised, unknown ones are rejected and reported
r = turn({"reply": "Noté !", "done": False, "form": {
    "client": " HOYA ", "startDate": "2026-11-21", "numDays": 3, "numPeople": 40,
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
form = {"client": "A", "hasLogo": True, "startDate": "2026-11-21", "numDays": 1, "numPeople": 10, "hotels": [{"hotelName": "MAMOUNIA", "rooms": 3}],
        "days": [{"slots": ["", "QUAD", "", "", ""], "notes": []}]}
assert turn({"reply": "Prêt ?", "done": True}, form)["done"] is True
form["days"] = [{"slots": ["", "", "", "", ""], "notes": []}]
assert turn({"reply": "Prêt ?", "done": True}, form)["done"] is False

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
done_form = {"client": "A", "startDate": "2026-11-21", "numDays": 1, "numPeople": 10, "hotels": [{"hotelName": "MAMOUNIA", "rooms": 3}],
             "days": [{"slots": ["", "QUAD", "", "", ""], "notes": []}]}
r = turn({"reply": "Prêt !", "done": True}, done_form)
assert r["done"] is False and r["choices"]["kind"] == "logo" and "logo" in r["reply"]
assert turn({"reply": "Prêt !", "done": True}, {**done_form, "hasLogo": True})["choices"] is None  # logo already added
r = agent.respond([{"role": "user", "text": "x"}, {"role": "model", "text": "Tu as le logo ?"}, {"role": "user", "text": "Pas de logo pour le moment"}],
                  done_form, NAMES, api_key="k", model="m", caller=fake({"reply": "Ok, sans logo. Prêt ?", "done": True}))
assert r["done"] is True and r["choices"] is None  # skipping it ends the question

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
# the voice: WAV passes through, raw PCM gets a header, no audio tries the next model
import base64
wav = lambda mime, data: (lambda b, k, m: {"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode()}}]}}]})
assert agent.speech("Bonjour", api_key="k", caller=wav("audio/wav", b"RIFFxxxx"))== b"RIFFxxxx"
out = agent.speech("Bonjour", api_key="k", caller=wav("audio/L16;codec=pcm;rate=24000", b"\0\0" * 10))
assert out[:4] == b"RIFF" and out.endswith(b"\0\0" * 10)
tried = []
def flaky(b, k, m):
    tried.append(m)
    return {"candidates": [{"content": {"parts": [{"text": "pas d'audio"}]}}]} if len(tried) < 2 else wav("audio/wav", b"RIFF")(b, k, m)
assert agent.speech("Bonjour", api_key="k", caller=flaky) == b"RIFF" and len(tried) == 2
try:
    agent.speech("  ", api_key="k", caller=flaky)
    raise SystemExit("expected an error for empty text")
except agent.AgentError as error:
    assert error.status == 400
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
agent._call_once = fake_call({"m1": 503, "gemini-3.1-flash-lite": 429, "gemini-3.5-flash": lambda: "third"})
assert agent.call_gemini({}, "k", "m1") == "third"
agent._call_once = fake_call({"m1": lambda: (time.sleep(1.5), "slow")[1], "gemini-3.1-flash-lite": lambda: "fast"})
t0 = time.time(); assert agent.call_gemini({}, "k", "m1", hedge_after=0.2) == "fast" and time.time() - t0 < 1
agent._call_once = fake_call({m: 503 for m in ["m1", *agent.FALLBACK_MODELS]})
try:
    agent.call_gemini({}, "k", "m1")
    raise SystemExit("expected an error when every model is down")
except agent.AgentError as error:
    assert error.status == 502
agent._call_once = real
print("test_agent: ok")
