"""Generate a sample deck and check it is structurally sound (the kind of fault that makes
PowerPoint offer to "repair" the file): broken image links, invalid colours, duplicate ids, shapes without position.

    python smoke_test.py [output.pptx]
"""
import re
import sys
import zipfile

from pptx import Presentation

import main

PAYLOAD = {
    "client": "Client test", "event_title": "Séminaire test", "dates": "25 au 26 octobre 2026",
    "num_people": "40", "num_days": "2", "num_nights": "1", "logo_path": "none.png",
    "hotels": [{"hotelName": "JARDINS DE LA KOUTOUBIA", "rooms": 42}],
    "dayPlans": [
        {"date": "Dimanche 25 octobre", "slots": ["PETIT DEJEUNER BERBERE", "QUAD", "DEJEUNER A L'HOTEL", "", "SOIREE DANS LE DESERT"],
         "manualNotes": ["Note de test"]},
        {"date": "Lundi 26 octobre", "slots": ["", "SPA", "", "KARTING", "DINER A L'HOTEL"], "manualNotes": []},
    ],
}


def check(path):
    problems = []
    prs = Presentation(path)
    for number, slide in enumerate(prs.slides, 1):
        xml = slide._element.xml
        rels = {rel.rId for rel in slide.part.rels.values()}
        dangling = set(re.findall(r'r:embed="([^"]+)"', xml)) - rels
        if dangling:
            problems.append(f"slide {number}: broken image links {sorted(dangling)}")
        for colour in re.findall(r'<a:srgbClr val="([^"]*)"', xml):
            if not re.fullmatch(r"[0-9A-Fa-f]{6}", colour):
                problems.append(f"slide {number}: invalid colour {colour!r}")
        for shape in slide.shapes:
            tag = shape._element.tag.split("}")[1]
            if tag in ("sp", "pic") and shape._element.find(".//{*}xfrm") is None:
                problems.append(f"slide {number}: shape {shape.name!r} has no position")
        ids = re.findall(r'<p:cNvPr id="(\d+)"', xml)
        if len(ids) != len(set(ids)):
            problems.append(f"slide {number}: duplicate shape ids")
    return len(prs.slides), problems


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "smoke_test_output.pptx"
    with open(out, "wb") as fh:
        fh.write(main.generate_pptx(".", PAYLOAD))
    total, problems = check(out)
    print(f"{total} slides written to {out}")
    for p in problems:
        print("PROBLEM:", p)
    sys.exit(1 if problems or total < 20 else 0)
