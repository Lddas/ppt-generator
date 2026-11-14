"""Pack everything the server needs at runtime into one file to put on Dropbox.

    python make_bundle.py            # -> ../PPTX_PREF/templates_bundle.zip

Contains slices/ (made by build_slices.py) and the small decks used as they are. fetch_assets.py
downloads and unpacks it at build time, so the big template decks never have to leave this computer.
"""
import os
import sys
import zipfile

RUNTIME_FILES = ["PRESENTATION_MARRAKECH.pptx", "SLIDES_FIN.pptx", "liste_JOUR_N.pptx"]


def main(out):
    if not os.path.isdir("slices"):
        sys.exit("No slices/ folder: run build_slices.py first")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as bundle:  # pptx files are already compressed
        for name in RUNTIME_FILES:
            bundle.write(os.path.realpath(name), name)
        for name in sorted(os.listdir("slices")):
            bundle.write(os.path.join("slices", name), f"slices/{name}")
    print(f"{out}: {os.path.getsize(out) / 1048576:.0f} MB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join("..", "PPTX_PREF", "templates_bundle.zip"))
