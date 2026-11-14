#!/usr/bin/env python3
"""Rebuild an old Preference Events template deck (hotels, meals...) in the new design.

Every old slide becomes exactly one new slide (same index, same slide count). The new slide is
created from a layout of PRESENTATION_MARRAKECH.pptx, chosen from what the old slide contains
(number/position of photos, titles, body text), and its placeholders are filled with the old
photos and texts. Slides that fit no layout keep their old geometry on a blank slide.

    python migrate_to_new_da.py PPTX_PREF/liste_HOTELS.pptx PPTX_PREF/liste_HOTELS_NEW.pptx
    python migrate_to_new_da.py OLD NEW --slides 120-135      # only a range, to check the result
"""
import argparse
import io
import itertools
import json
import math
import os
from collections import Counter
from dataclasses import dataclass, field

from PIL import Image
from pptx import Presentation
from pptx.util import Emu, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
DESIGN_FILE = os.path.join(HERE, "PPTX_PREF", "PRESENTATION_MARRAKECH.pptx")
INDEX_FILE = os.path.join(HERE, "backend", "index.json")
SLIDE_W, SLIDE_H = 12192000, 6858000
LOGO_MAX_AREA = 0.03  # pictures smaller than this (share of the slide) are logos, the design has its own
LONG_TEXT = 60  # chars; a text this long is body text
BODY_SIZE = 12  # pt, default size of body placeholders in the design

L_SECTION = "INTO_PAGE DE GARDE 3"
L_PHOTO_TITLE = "TITRE SECTION"
L_PLACE = "PAGE DE GARDE PRESENTATION LIEU"
L_SUB_LEFT = "IMAGE + TEXTE 3"  # picture on the left, title + text on the right
L_SUB_RIGHT = "SOUS-SECTION LIEU (ex. Chambres, Spa)"  # picture on the right
L_PHOTOS_TEXT = "IMAGES + TEXTE 2"
L_BLANK = "IMAGES 1"


@dataclass
class Pic:
    blob: bytes
    left: int
    top: int
    width: int
    height: int
    crop: tuple

    @property
    def cx(self):
        return (self.left + self.width / 2) / SLIDE_W

    @property
    def cy(self):
        return (self.top + self.height / 2) / SLIDE_H

    @property
    def area(self):
        return self.width * self.height


@dataclass
class Txt:
    paragraphs: list  # [(text, size_pt or None, bold)]
    left: int
    top: int
    width: int
    height: int

    @property
    def text(self):
        return "\n".join(p[0] for p in self.paragraphs)

    @property
    def chars(self):
        return len(self.text)

    @property
    def size(self):
        return max([p[1] or 0 for p in self.paragraphs] + [0])


@dataclass
class OldSlide:
    pics: list = field(default_factory=list)
    texts: list = field(default_factory=list)


def extract(slide):
    old = OldSlide()

    def walk(shapes):
        for sh in shapes:
            tag = sh._element.tag.split("}")[1]
            if tag == "grpSp":
                walk(sh.shapes)
                continue
            try:
                geo = (sh.left, sh.top, sh.width, sh.height)
            except Exception:
                continue
            if None in geo:
                continue
            if tag == "pic":
                if geo[2] * geo[3] / (SLIDE_W * SLIDE_H) < LOGO_MAX_AREA:
                    continue
                try:
                    old.pics.append(Pic(sh.image.blob, *geo, (sh.crop_left, sh.crop_top, sh.crop_right, sh.crop_bottom)))
                except Exception:
                    pass
            elif tag == "sp" and sh.has_text_frame and sh.text_frame.text.strip():
                paragraphs = []
                for p in sh.text_frame.paragraphs:
                    text = "".join(r.text for r in p.runs).strip()
                    if not text:
                        continue
                    size = next((r.font.size.pt for r in p.runs if r.font.size), None)
                    bold = any(r.font.bold for r in p.runs)
                    paragraphs.append((text, size, bold))
                if paragraphs:
                    old.texts.append(Txt(paragraphs, *geo))

    walk(slide.shapes)
    return old


def prepared_blob(pic):
    """Apply the old crop to the image itself: the new placeholders crop to fill their own box."""
    if max(pic.crop) < 0.005:
        return pic.blob
    im = Image.open(io.BytesIO(pic.blob))
    fmt = "PNG" if im.format == "PNG" or im.mode in ("RGBA", "LA", "P") else "JPEG"
    w, h = im.size
    left, top, right, bottom = pic.crop
    im = im.crop((int(left * w), int(top * h), int(w * (1 - right)), int(h * (1 - bottom))))
    out = io.BytesIO()
    if fmt == "JPEG":
        im.convert("RGB").save(out, "JPEG", quality=92)
    else:
        im.save(out, "PNG")
    return out.getvalue()


# ─── helpers on the new slide ───

def placeholders(slide):
    return {ph.placeholder_format.idx: ph for ph in slide.placeholders}


def drop(ph_map, *indexes):
    for idx in indexes:
        ph = ph_map.pop(idx, None)
        if ph is not None:
            ph._element.getparent().remove(ph._element)


def drop_unused(ph_map, used):
    drop(ph_map, *[i for i in list(ph_map) if i not in used])


def place(ph, x, y, w, h):
    ph.left, ph.top, ph.width, ph.height = (Emu(int(v)) for v in (x * SLIDE_W, y * SLIDE_H, w * SLIDE_W, h * SLIDE_H))


def put_picture(ph, pic):
    ph.insert_picture(io.BytesIO(prepared_blob(pic)))


def put_text(ph, paragraphs, fit=False):
    """Fill a placeholder with the old paragraphs; with fit, shrink the font so a long text fits."""
    tf = ph.text_frame
    tf.clear()
    size = None
    if fit:
        chars = sum(len(p[0]) for p in paragraphs) + 40 * len(paragraphs)
        area = (ph.width / 12700) * (ph.height / 12700)
        size = min(BODY_SIZE, max(7, math.floor(math.sqrt(area / (0.7 * chars)))))
        if size >= BODY_SIZE:
            size = None
    for i, (text, _, bold) in enumerate(paragraphs):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        run = p.add_run()
        run.text = text
        if size:
            run.font.size = Pt(size)


def best_images_layout(prs, pics):
    """Among the 'IMAGES n' layouts with len(pics) photo boxes, the one whose boxes look most
    like where the old photos were. Returns (layout, [pic for each placeholder idx])."""
    best = None
    for layout in prs.slide_layouts:
        if not layout.name.startswith("IMAGES ") or layout.name.startswith("IMAGES +"):
            continue
        boxes = [ph for ph in layout.placeholders]
        if len(boxes) != len(pics):
            continue
        for order in itertools.permutations(range(len(pics))):
            cost = 0
            for box, k in zip(boxes, order):
                pic = pics[k]
                bx, by = (box.left + box.width / 2) / SLIDE_W, (box.top + box.height / 2) / SLIDE_H
                ar_box, ar_pic = box.width / box.height, pic.width / pic.height
                cost += abs(math.log(ar_box / ar_pic)) + 2 * math.hypot(bx - pic.cx, by - pic.cy)
            if best is None or cost < best[0]:
                best = (cost, layout, [(box.placeholder_format.idx, pics[k]) for box, k in zip(boxes, order)])
    return best[1], best[2]


# ─── one old slide -> one new slide ───

def build(prs, layouts, old, first_of_entity):
    """Returns the name of the rule used."""
    pics = sorted(old.pics, key=lambda p: -p.area)
    texts = old.texts
    n = len(pics)
    body = max(texts, key=lambda t: t.chars) if texts and (len(texts) > 1 or texts[0].chars >= LONG_TEXT) else None
    heads = sorted([t for t in texts if t is not body], key=lambda t: (-t.size, t.top))

    def new(name):
        slide = prs.slides.add_slide(layouts[name])
        return slide, placeholders(slide)

    if n == 0 and body is None:
        slide, ph = new(L_SECTION)
        used = set()
        if heads:
            put_text(ph[0], heads[0].paragraphs)
            used.add(0)
        if len(heads) > 1:
            put_text(ph[11], heads[1].paragraphs)
            used.add(11)
        drop_unused(ph, used)
        return "section"

    if 1 <= n <= 4 and not texts:
        layout, assignment = best_images_layout(prs, pics)
        slide = prs.slides.add_slide(layout)
        ph = placeholders(slide)
        for idx, pic in assignment:
            put_picture(ph[idx], pic)
        return "images"

    if n == 1 and body is None and len(heads) == 1:
        slide, ph = new(L_PHOTO_TITLE)
        put_picture(ph[10], pics[0])
        put_text(ph[0], heads[0].paragraphs)
        return "photo-title"

    if n == 1 and body is not None:
        if first_of_entity or len(texts) >= 3:
            slide, ph = new(L_PLACE)
            put_picture(ph[10], pics[0])
            used = {10, 15}
            put_text(ph[15], body.paragraphs, fit=True)
            for idx, head in zip((11, 14), heads):
                put_text(ph[idx], head.paragraphs)
                used.add(idx)
            drop_unused(ph, used)
            return "place"
        slide, ph = new(L_SUB_LEFT if pics[0].cx < 0.5 else L_SUB_RIGHT)
        put_picture(ph[10], pics[0])
        used = {10, 12}
        put_text(ph[12], body.paragraphs, fit=True)
        if heads:
            put_text(ph[11], heads[0].paragraphs)
            used.add(11)
        drop_unused(ph, used)
        return "sub-section"

    if 2 <= n <= 4 and texts:
        slide, ph = new(L_PHOTOS_TEXT)
        put_picture(ph[10], pics[0])
        rest = sorted(pics[1:], key=lambda p: p.cy)
        used = {10}
        if len(rest) == 1:
            place(ph[13], 0.81, 0.04, 0.17, 0.92)
            slots = [13]
        elif len(rest) == 2:
            place(ph[13], 0.81, 0.04, 0.17, 0.45)
            place(ph[15], 0.81, 0.51, 0.17, 0.45)
            slots = [13, 15]
        else:
            slots = [13, 15, 14]
        for idx, pic in zip(slots, rest):
            put_picture(ph[idx], pic)
            used.add(idx)
        title = heads[0] if heads else None
        if body is not None:
            place(ph[12], 0.42, 0.16, 0.34, 0.62)
            put_text(ph[12], body.paragraphs, fit=True)
            used.add(12)
        elif len(heads) > 1:
            body, title = heads[1], heads[0]
        if title is not None:
            place(ph[11], 0.42, 0.07, 0.34, 0.07)
            put_text(ph[11], title.paragraphs)
            used.add(11)
        drop_unused(ph, used)
        return "photos-text"

    return fallback(prs, layouts, old)


def fallback(prs, layouts, old):
    """No layout fits: blank design slide, photos and texts where they were in the old slide."""
    slide = prs.slides.add_slide(layouts[L_BLANK])
    drop(placeholders(slide), *list(placeholders(slide)))
    for pic in sorted(old.pics, key=lambda p: -p.area):
        shape = slide.shapes.add_picture(io.BytesIO(prepared_blob(pic)), pic.left, pic.top, pic.width, pic.height)
    for txt in old.texts:
        box = slide.shapes.add_textbox(txt.left, txt.top, txt.width, txt.height)
        tf = box.text_frame
        tf.word_wrap = True
        for i, (text, size, bold) in enumerate(txt.paragraphs):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            run = p.add_run()
            run.text = text
            if size:
                run.font.size = Pt(size)
            run.font.bold = bold or None
    return "fallback"


def first_slides(old_name):
    """1-based index of the first slide of every hotel/restaurant/activity in index.json."""
    with open(INDEX_FILE, encoding="utf-8") as fh:
        data = json.load(fh)
    return {v["index"] for v in data.values() if v.get("ppt") == os.path.basename(old_name)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("old")
    ap.add_argument("new")
    ap.add_argument("--slides", help="range to convert, e.g. 120-135 (1-based, inclusive)")
    ap.add_argument("--index-name", help="name of the deck in index.json (default: file name of OLD)")
    args = ap.parse_args()

    first, last = 1, None
    if args.slides:
        first, last = (int(x) for x in args.slides.split("-"))

    print("Opening the design file...")
    prs = Presentation(DESIGN_FILE)
    ids = prs.slides._sldIdLst
    for sld in list(ids):
        prs.part.drop_rel(sld.rId)
        ids.remove(sld)
    layouts = {layout.name: layout for layout in prs.slide_layouts}

    print("Opening the old deck...")
    old_prs = Presentation(args.old)
    firsts = first_slides(args.index_name or args.old)
    total = len(old_prs.slides)
    rules = Counter()
    fallbacks = []
    for i, slide in enumerate(old_prs.slides, 1):
        if i < first or (last and i > last):
            continue
        rule = build(prs, layouts, extract(slide), i in firsts)
        rules[rule] += 1
        if rule == "fallback":
            fallbacks.append(i)
        if i % 25 == 0:
            print(f"  {i}/{total}")
    prs.save(args.new)
    print("Saved", args.new, dict(rules))
    print("Fallback slides (old geometry kept, check by hand):", fallbacks)


if __name__ == "__main__":
    main()
