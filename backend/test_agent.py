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
form = {"client": "A", "startDate": "2026-11-21", "numDays": 1, "hotels": [{"hotelName": "MAMOUNIA", "rooms": 3}],
        "days": [{"slots": ["", "QUAD", "", "", ""], "notes": []}]}
assert turn({"reply": "Prêt ?", "done": True}, form)["done"] is True
form["days"] = [{"slots": ["", "", "", "", ""], "notes": []}]
assert turn({"reply": "Prêt ?", "done": True}, form)["done"] is False

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
print("test_agent: ok")
