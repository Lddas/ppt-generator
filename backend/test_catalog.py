"""Coverage test: generates decks that together use EVERY hotel, restaurant and activity of the catalog,
and reports what looks wrong (blank slides, errors, leftover template text, empty names...).

    .venv/bin/python test_catalog.py [max_decks]

Needs the template slices (slices/) and the design files, like the server.
"""
import json
import os
import random
import re
import sys
import time

from pptx import Presentation

import agent
import copying_and_modifying_slide as gen
import main
import smoke_test

LEFTOVER = re.compile(r"lorem|SOUS TITRE|Cliquez pour|Click to|\bCLIENT\b|XXX|\bUt enim|Texte du", re.I)


def load_names():
    return agent.catalog(json.load(open("index.json", encoding="utf-8")), main.ALLOWED_HOTELS)


def static_audit():
    """Every entry of index.json: its slices exist and none of them is blank or still has template text."""
    problems = []
    index = json.load(open("index.json", encoding="utf-8"))
    for name, entry in index.items():
        if "index" not in entry:
            continue
        path = os.path.join("slices", f"{os.path.splitext(entry['ppt'])[0]}__{entry['index']}_{entry['nb_slides']}.pptx")
        if not os.path.exists(path):
            path = os.path.join("extra_slices", os.path.basename(path))
        if not os.path.exists(path):
            problems.append((name, "missing slice file"))
            continue
        pres = Presentation(path)
        for number, slide in enumerate(pres.slides, 1):
            if len(slide.shapes) == 0:
                problems.append((name, f"slide {number}: blank"))
            for shape in slide.shapes:
                if shape.has_text_frame and LEFTOVER.search(shape.text_frame.text):
                    problems.append((name, f"slide {number}: template text {shape.text_frame.text[:40]!r}"))
    return problems


def plan_decks(names, rng):
    """Decks (3 days, 5 slots a day) that use every name at least once."""
    pools = {k: list(names[k]) for k in ("hotels", "breakfasts", "meals", "activities")}
    for pool in pools.values():
        rng.shuffle(pool)
    leftover = lambda key: [n for n in pools[key] if n not in used[key]]
    used = {k: set() for k in pools}

    def take(key, ok=lambda n: True):
        candidates = [n for n in pools[key] if n not in used[key] and ok(n)] or [n for n in pools[key] if ok(n)]
        choice = candidates[0] if candidates else ""
        used[key].add(choice)
        return choice

    decks = []
    while any(leftover(k) for k in pools) and len(decks) < 40:
        before = sum(len(u) for u in used.values())
        days = []
        for d in range(3):
            slots = [
                take("breakfasts") if d else "",
                take("activities", lambda n: agent.fits_slot("morning", n) and not agent.is_departure(n) and "ARRIVEE" not in n),
                take("meals"),
                take("activities", lambda n: agent.fits_slot("afternoon", n) and not agent.is_departure(n) and "ARRIVEE" not in n),
                take("meals"),
            ]
            days.append(slots)
        days[0][1] = "ARRIVEE" if "ARRIVEE" in names["activities"] else days[0][1]
        hotels = [take("hotels")] + ([take("hotels")] if leftover("hotels") else [])
        decks.append((hotels, days))
        if sum(len(u) for u in used.values()) == before:  # nothing new: what is left cannot go in these slots (departure, arrival...)
            break
    rest = [n for n in pools["activities"] if n not in used["activities"]]  # arrival / departure / slot-specific ones
    rest_departures = [n for n in rest if agent.is_departure(n)]
    rest = [n for n in rest if not agent.is_departure(n)]
    for number in range(0, max(len(rest), len(rest_departures)), 4):
        chunk = rest[number:number + 4]
        days = [["", "", "", "", ""] for _ in range(3)]
        for k, name in enumerate(chunk):
            days[k // 2][1 if k % 2 == 0 else 3] = name
        if number // 4 < len(rest_departures):
            days[2][3] = rest_departures[number // 4]
        decks.append((["MAMOUNIA"], days))
    return decks


def generate(hotels, days, number):
    blanks = []
    real = gen.NewSlide

    def tracked(i, link, out):
        slide = real(i, link, out)
        if len(slide.shapes) == 0:
            blanks.append((link, i))
        return slide

    gen.NewSlide = tracked
    try:
        payload = {
            "client": f"Client {number}", "event_title": f"Test {number}", "dates": "1 au 3 décembre 2026", "start_date": "2026-12-01",
            "num_people": "30", "num_days": "3", "num_nights": "2", "logo_path": "none.png", "departure_cities": ["Paris", "Lyon"][: number % 3],
            "hotels": [{"hotelName": h, "rooms": 10 + k} for k, h in enumerate(hotels)],
            "dayPlans": [{"date": f"Jour {d + 1}", "slots": slots, "manualNotes": []} for d, slots in enumerate(days)],
        }
        started = time.time()
        pptx = main.generate_pptx(".", payload)
        seconds = time.time() - started
    finally:
        gen.NewSlide = real
    path = f"/tmp/catalog_deck_{number}.pptx"
    with open(path, "wb") as fh:
        fh.write(pptx)
    total, problems = smoke_test.check(path)
    return path, total, problems, blanks, seconds


if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    names = load_names()
    print("== static audit of every catalog entry")
    static = static_audit()
    for item in static:
        print("  PROBLEM", item)
    print(f"  {len(static)} problem(s)")
    print("== generated decks")
    failures = 0
    for number, (hotels, days) in enumerate(plan_decks(names, random.Random(7))[:limit], 1):
        try:
            path, total, problems, blanks, seconds = generate(hotels, days, number)
        except Exception as error:  # noqa: BLE001
            failures += 1
            print(f"  deck {number}: ERROR {type(error).__name__}: {error}  hotels={hotels} days={days}")
            continue
        flag = "" if not (problems or blanks) else f"  PROBLEMS: {problems} blank={blanks}"
        print(f"  deck {number}: {total} slides in {seconds:.1f}s, hotels={hotels}{flag}")
        if problems or blanks:
            failures += 1
    print("FAILED decks:", failures)
    sys.exit(1 if static or failures else 0)
