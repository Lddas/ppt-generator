"""Cut the big template decks into one small deck per hotel / restaurant / activity.

The big decks (hotels 450 MB, meals 330 MB, activities 310 MB) are too heavy to open for each
request. Every entry of index.json points to a range of slides in one of them: this script saves
each range as its own small .pptx in slices/ (run it once at build time, after fetch_assets.py).
At runtime copying_and_modifying_slide.NewSlide uses the slices and never opens the big decks.

    python build_slices.py            # all decks found in this folder
"""
import json
import os

from pptx import Presentation

import copying_and_modifying_slide as gen

SLICES_DIR = "slices"
SLIDE_W, SLIDE_H = 12192000, 6858000
DECKS = ("liste_HOTELS.pptx", "liste_REPAS.pptx", "liste_ACTIVITES.pptx")


def slice_name(ppt, index, nb_slides):
    return os.path.join(SLICES_DIR, f"{os.path.splitext(ppt)[0]}__{index}_{nb_slides}.pptx")


def ranges_by_deck():
    with open("index.json", encoding="utf-8") as fh:
        data = json.load(fh)
    wanted = {}
    for entry in data.values():
        if entry.get("ppt") in DECKS and "index" in entry:
            wanted.setdefault(entry["ppt"], set()).add((entry["index"], entry["nb_slides"]))
    return wanted


def main():
    os.makedirs(SLICES_DIR, exist_ok=True)
    for ppt, ranges in ranges_by_deck().items():
        if not os.path.exists(ppt):
            print(f"{ppt} not found, skipped")
            continue
        print(f"Opening {ppt}...")
        deck = Presentation(ppt)
        total = len(deck.slides)
        for index, nb_slides in sorted(ranges):
            if index - 1 + nb_slides > total:
                print(f"  skipped {index}+{nb_slides}: the deck only has {total} slides")
                continue
            out = Presentation()
            out.slide_width, out.slide_height = SLIDE_W, SLIDE_H
            for i in range(index - 1, index - 1 + nb_slides):
                gen.CopySlide(deck, i, out)
            out.save(slice_name(ppt, index, nb_slides))
        print(f"  {len(ranges)} slices from {ppt}")
        del deck


if __name__ == "__main__":
    main()
