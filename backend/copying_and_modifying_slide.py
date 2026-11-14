from pptx import Presentation
from pptx.util import Pt, Inches
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
import re
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from lxml import etree
import copy
import os
import inputs
DIR_PATH = os.path.dirname(os.path.realpath(__file__))
import io
import json
from PIL import Image


# Import data from the index.json file
with open('index.json') as f:
    data = json.load(f)

_A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
_P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
_NS = {'a': _A_NS, 'p': _P_NS}
_A = '{%s}' % _A_NS
_P = '{%s}' % _P_NS
_FILL_TAGS = ('noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill')


def _theme_maps(slide):
    """Return ({scheme colour name: hex}, {'major': font, 'minor': font}) of the slide's theme."""
    master = slide.slide_layout.slide_master
    theme = etree.fromstring(master.part.part_related_by(RT.THEME).blob)
    colors = {}
    for child in theme.find('.//a:clrScheme', _NS):
        c = child[0]
        # system colours (sysClr) keep their real value in lastClr; val is e.g. "window"
        colors[child.tag.split('}')[1]] = c.get('lastClr') or c.get('val')
    clr_map = master._element.find('p:clrMap', _NS)
    # a slide (or its layout) can override the master's mapping, e.g. bg1 -> dk1 for dark slides
    for source in (slide, slide.slide_layout):
        override = source._element.find('p:clrMapOvr/a:overrideClrMapping', _NS)
        if override is not None:
            clr_map = override
            break
    if clr_map is not None:
        for key, target in clr_map.attrib.items():
            if target in colors:
                colors[key] = colors[target]
    fonts = {}
    for kind in ('major', 'minor'):
        latin = theme.find('.//a:%sFont/a:latin' % kind, _NS)
        fonts[kind] = latin.get('typeface') if latin is not None else None
    return colors, fonts


def _apply_theme(el, colors, fonts):
    """Bake theme colours/fonts into the element (the output deck has a different theme)."""
    for sc in list(el.iter(_A + 'schemeClr')):
        hex_val = colors.get(sc.get('val'))
        if not hex_val:
            continue
        rgb = etree.Element(_A + 'srgbClr', val=hex_val)
        for child in list(sc):
            rgb.append(child)
        sc.getparent().replace(sc, rgb)
    for latin in el.iter(_A + 'latin'):
        face = latin.get('typeface', '')
        if face.startswith('+mj-') and fonts.get('major'):
            latin.set('typeface', fonts['major'])
        elif face.startswith('+mn-') and fonts.get('minor'):
            latin.set('typeface', fonts['minor'])


def _insert_after(parent, tags, new_el):
    """Insert new_el right after the last existing child whose tag is in tags (else first)."""
    idx = -1
    for i, child in enumerate(parent):
        if child.tag in tags:
            idx = i
    parent.insert(idx + 1, new_el)


_PPR_ORDER = ['lnSpc', 'spcBef', 'spcAft', 'buClrTx', 'buClr', 'buSzTx', 'buSzPct', 'buSzPts',
              'buFontTx', 'buFont', 'buNone', 'buAutoNum', 'buChar', 'buBlip', 'tabLst', 'defRPr', 'extLst']
_RPR_ORDER = ['ln', 'noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill', 'effectLst',
              'effectDag', 'highlight', 'uLnTx', 'uLn', 'uFillTx', 'uFill', 'latin', 'ea', 'cs', 'sym',
              'hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst']
_LST_ORDER = ['defPPr'] + ['lvl%dpPr' % i for i in range(1, 10)] + ['extLst']
_ORDERS = {'lstStyle': _LST_ORDER, 'defRPr': _RPR_ORDER}
_FILLS = {'noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'}
# children of which only one may be present (the schema allows one of each group)
_EXCLUSIVE = [_FILLS, {'buClrTx', 'buClr'}, {'buSzTx', 'buSzPct', 'buSzPts'}, {'buFontTx', 'buFont'},
              {'buNone', 'buAutoNum', 'buChar', 'buBlip'}, {'uLnTx', 'uLn'}, {'uFillTx', 'uFill'}]


def _merge_missing(target, source):
    """Add to target the attributes/children it lacks from source (what a placeholder inherits),
    keeping the schema order of the children."""
    for key, value in source.attrib.items():
        if key not in target.attrib:
            target.set(key, value)
    t_name = target.tag.split('}')[1]
    order = _ORDERS.get(t_name) or (_PPR_ORDER if t_name.startswith(('lvl', 'defPPr')) else None)
    for child in source:
        name = child.tag.split('}')[1]
        existing = target.find(child.tag)
        if existing is None and any(
                name in group and any(c.tag.split('}')[1] in group for c in target) for group in _EXCLUSIVE):
            continue
        if existing is not None:
            _merge_missing(existing, child)
            continue
        new = copy.deepcopy(child)
        if order and name in order:
            rank = order.index(name)
            for i, sibling in enumerate(target):
                sib_name = sibling.tag.split('}')[1]
                if sib_name in order and order.index(sib_name) > rank:
                    target.insert(i, new)
                    break
            else:
                target.append(new)
        else:
            target.append(new)


def _text_style(master, shp):
    """The master's txStyles entry (title/body/other) that applies to this placeholder."""
    kind = shp.placeholder_format.type.name
    name = 'titleStyle' if 'TITLE' in kind else 'bodyStyle' if kind in (
        'BODY', 'OBJECT', 'SUBTITLE', 'VERTICAL_BODY', 'VERTICAL_OBJECT') else 'otherStyle'
    return master._element.find('p:txStyles/p:' + name, _NS)


def _materialize_placeholder(el, shp, master=None):
    """Turn a placeholder shape into a standalone shape: explicit geometry, and the
    formatting it inherits from its layout/master copied in, since the output deck
    does not contain the template's layouts."""
    spPr = el.find('p:spPr', _NS)
    if spPr is None:
        return
    if spPr.find('a:xfrm', _NS) is None and shp.left is not None and shp.width is not None:
        xfrm = etree.Element(_A + 'xfrm')
        etree.SubElement(xfrm, _A + 'off', x=str(int(shp.left)), y=str(int(shp.top)))
        etree.SubElement(xfrm, _A + 'ext', cx=str(int(shp.width)), cy=str(int(shp.height)))
        spPr.insert(0, xfrm)
    if spPr.find('a:prstGeom', _NS) is None and spPr.find('a:custGeom', _NS) is None:
        geom = etree.Element(_A + 'prstGeom', prst='rect')
        etree.SubElement(geom, _A + 'avLst')
        _insert_after(spPr, (_A + 'xfrm',), geom)

    base = getattr(shp, '_base_placeholder', None)
    while base is not None:
        base_el = base._element
        base_spPr = base_el.find('p:spPr', _NS)
        if base_spPr is not None:
            if not any(spPr.find('a:' + t, _NS) is not None for t in _FILL_TAGS):
                for t in _FILL_TAGS:
                    fill = base_spPr.find('a:' + t, _NS)
                    if fill is not None:
                        _insert_after(spPr, (_A + 'xfrm', _A + 'prstGeom', _A + 'custGeom'), copy.deepcopy(fill))
                        break
            ln = base_spPr.find('a:ln', _NS)
            if ln is not None and spPr.find('a:ln', _NS) is None:
                _insert_after(spPr, (_A + 'xfrm', _A + 'prstGeom', _A + 'custGeom') + tuple(_A + t for t in _FILL_TAGS), copy.deepcopy(ln))
        tx, base_tx = el.find('p:txBody', _NS), base_el.find('p:txBody', _NS)
        if tx is not None and base_tx is not None:
            body, base_body = tx.find('a:bodyPr', _NS), base_tx.find('a:bodyPr', _NS)
            if body is not None and base_body is not None:
                for key, value in base_body.attrib.items():
                    if key not in body.attrib:
                        body.set(key, value)
                if len(body) == 0:
                    for child in base_body:
                        body.append(copy.deepcopy(child))
            lst, base_lst = tx.find('a:lstStyle', _NS), base_tx.find('a:lstStyle', _NS)
            if lst is not None and base_lst is not None:
                _merge_missing(lst, base_lst)
        base = getattr(base, '_base_placeholder', None)

    # finally the master's default text style (size, font, bullets...) for this kind of placeholder
    style = _text_style(master, shp) if master is not None else None
    lst = el.find('p:txBody/a:lstStyle', _NS)
    if style is not None and lst is not None:
        _merge_missing(lst, style)

    nv_pr = el.find('p:nvSpPr/p:nvPr', _NS)
    if nv_pr is not None:
        ph = nv_pr.find('p:ph', _NS)
        if ph is not None:
            nv_pr.remove(ph)


MAX_IMAGE_SIDE = 2000  # px; the photos of the templates are much larger than a slide needs


def _has_alpha(im):
    if im.mode in ("RGBA", "LA"):
        return im.getchannel("A").getextrema()[0] < 255
    return im.mode == "P" and "transparency" in im.info


def _shrink(blob):
    """Smaller photos (smaller decks, less memory): downscale the huge ones and store opaque
    photographic PNGs as JPEG. Small images and logos with transparency are returned as is."""
    try:
        im = Image.open(io.BytesIO(blob))
        fmt = im.format
        too_big = max(im.size) > MAX_IMAGE_SIDE
        heavy_png = fmt == "PNG" and len(blob) > 300_000 and not _has_alpha(im)
        if not too_big and not heavy_png:
            return blob
        if too_big:
            im.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.LANCZOS)
        out = io.BytesIO()
        if fmt == "PNG" and _has_alpha(im):
            im.save(out, "PNG", optimize=True)
        else:
            im.convert("RGB").save(out, "JPEG", quality=88, optimize=True)
        return out.getvalue()
    except Exception:
        return blob


def _copy_picture(new_slide, shp):
    """Re-add a picture (including pictures held in a placeholder) from its bytes."""
    pic = new_slide.shapes.add_picture(io.BytesIO(_shrink(shp.image.blob)), shp.left, shp.top, shp.width, shp.height)
    pic.crop_left, pic.crop_right = shp.crop_left, shp.crop_right
    pic.crop_top, pic.crop_bottom = shp.crop_top, shp.crop_bottom
    return pic


def _copy_background(new_slide, slide, colors):
    """Copy the background (slide, else layout, else master) as a plain solid fill/gradient."""
    bg = None
    for source in (slide, slide.slide_layout, slide.slide_layout.slide_master):
        bg = source._element.find('p:cSld/p:bg', _NS)
        if bg is not None:
            break
    if bg is None:
        return
    new_bg = etree.Element(_P + 'bg')
    bg_pr = bg.find('p:bgPr', _NS)
    if bg_pr is not None and bg_pr.find('a:blipFill', _NS) is None:
        new_bg.append(copy.deepcopy(bg_pr))
    else:
        bg_ref = bg.find('p:bgRef', _NS)
        color = bg_ref[0] if bg_ref is not None and len(bg_ref) else None
        if color is None:
            return
        pr = etree.SubElement(new_bg, _P + 'bgPr')
        fill = etree.SubElement(pr, _A + 'solidFill')
        fill.append(copy.deepcopy(color))
        etree.SubElement(pr, _A + 'effectLst')
    _apply_theme(new_bg, colors, {})
    new_slide._element.find('p:cSld', _NS).insert(0, new_bg)


def _rebind_embeds(el, src_part, new_slide):
    """Images referenced from inside a copied shape (e.g. a picture fill) need their own
    relationship on the new slide, otherwise the link dangles."""
    key = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed'
    for node in el.iter():
        rid = node.get(key)
        if rid is None:
            continue
        try:
            blob = src_part.related_part(rid).blob
            _, new_rid = new_slide.part.get_or_add_image_part(io.BytesIO(blob))
            node.set(key, new_rid)
        except Exception as e:
            print(f"Error re-linking image {rid}: {e}")


def _unique_shape_ids(new_slide):
    seen = set()
    elements = list(new_slide.shapes._spTree.iter(_P + 'cNvPr'))
    next_id = max([int(e.get('id', 0)) for e in elements] + [1]) + 1
    for e in elements:
        sid = e.get('id')
        if sid in seen:
            e.set('id', str(next_id))
            sid = str(next_id)
            next_id += 1
        seen.add(sid)


def _copy_prompt(el, shp, keep_text):
    """If the slide placeholder is empty, copy the paragraphs of its layout placeholder prompt:
    with keep_text the prompt text stays (fill-in slides such as the transport plan), otherwise
    only its formatting (size, bold...) is kept so the text we set later looks as designed."""
    tx = el.find('p:txBody', _NS)
    base = getattr(shp, '_base_placeholder', None)
    if tx is None or base is None or any((t.text or '').strip() for t in tx.iter(_A + 't')):
        return
    base_tx = base._element.find('p:txBody', _NS)
    if base_tx is None:
        return
    paragraphs = base_tx.findall('a:p', _NS)
    if not any((t.text or '').strip() for p in paragraphs for t in p.iter(_A + 't')):
        return
    for p in tx.findall('a:p', _NS):
        tx.remove(p)
    for p in paragraphs:
        new_p = copy.deepcopy(p)
        if not keep_text:
            for t in new_p.iter(_A + 't'):
                t.text = ''
        tx.append(new_p)


def _copy_slide(copyFromPres, slideIndex, pasteIntoPres, keep_prompts=False):
    """Copy a slide into pasteIntoPres. Returns (new_slide, placeholders) where placeholders
    maps the placeholder idx of the source slide to the copied element."""
    slide_to_copy = copyFromPres.slides[slideIndex]

    # Define the layout you want to use for your generated pptx
    slide_layout = pasteIntoPres.slide_layouts.get_by_name("Blank")  # Ensure blank layout
    new_slide = pasteIntoPres.slides.add_slide(slide_layout)

    colors, fonts = _theme_maps(slide_to_copy)
    _copy_background(new_slide, slide_to_copy, colors)

    # Decorative (non-placeholder) shapes that live on the template layout, not on the slide.
    # They go underneath the slide's own shapes.
    sp_tree = new_slide.shapes._spTree
    position = 2  # after nvGrpSpPr and grpSpPr
    for shp in slide_to_copy.slide_layout.shapes:
        if shp.is_placeholder:
            continue
        if shp._element.tag == _P + 'pic':
            try:
                el = _copy_picture(new_slide, shp)._element
            except Exception as e:
                print(f"Error adding layout image {shp.name}: {e}")
                continue
            sp_tree.remove(el)
            sp_tree.insert(position, el)
        else:
            el = copy.deepcopy(shp._element)
            _apply_theme(el, colors, fonts)
            _rebind_embeds(el, slide_to_copy.slide_layout.part, new_slide)
            sp_tree.insert(position, el)
        position += 1

    # Sort all shapes by their area (width * height), largest first
    shapes = list(slide_to_copy.shapes)
    shapes.sort(key=lambda s: (s.width or 0) * (s.height or 0), reverse=True)

    placeholders = {}
    for shp in shapes:
        if shp._element.tag == _P + 'pic':
            # Pictures (also those inside a placeholder) are re-added from their bytes
            try:
                _copy_picture(new_slide, shp)
            except Exception as e:
                print(f"Error adding image {shp.name} to the slide: {e}")
            continue
        try:
            newel = copy.deepcopy(shp._element)
            if shp.is_placeholder:
                _copy_prompt(newel, shp, keep_prompts)
                _materialize_placeholder(newel, shp, slide_to_copy.slide_layout.slide_master)
                placeholders[shp.placeholder_format.idx] = newel
            _apply_theme(newel, colors, fonts)
            _rebind_embeds(newel, slide_to_copy.part, new_slide)
            sp_tree.insert_element_before(newel, 'p:extLst')
        except Exception as e:
            print(f"Error processing shape {shp.name}: {e}")

    _unique_shape_ids(new_slide)
    return new_slide, placeholders


def CopySlide(copyFromPres, slideIndex, pasteIntoPres):
    return _copy_slide(copyFromPres, slideIndex, pasteIntoPres)[0]


_slice_table = None


def _slices():
    """(deck, 0-based slide) -> (slice file, position in it), from the entries of index.json."""
    global _slice_table
    if _slice_table is None:
        _slice_table = {}
        for entry in data.values():
            if "index" not in entry:
                continue
            ppt, index, count = entry["ppt"], entry["index"], entry["nb_slides"]
            path = os.path.join("slices", f"{os.path.splitext(ppt)[0]}__{index}_{count}.pptx")
            for k in range(count):
                _slice_table[(ppt, index - 1 + k)] = (path, k)
    return _slice_table


def NewSlide(index, link, outputPres):
    """Copy slide `index` (0-based) of the template deck `link` into outputPres.
    Uses the small per-entry deck made by build_slices.py when it exists, else the big deck."""
    path, position = _slices().get((link, index), (None, None))
    if path and os.path.exists(path):
        return CopySlide(_load(path), position, outputPres)
    return CopySlide(_load(link), index, outputPres)


def set_room_count(slide, rooms):
    """Hotel slides say 'Vous aurez à votre disposition 30 chambres ...': use the requested number."""
    pattern = re.compile(r"(Vous aurez à votre disposition\s+)\d+")
    for shape in slide.shapes:
        if not shape.has_text_frame:
            continue
        for paragraph in shape.text_frame.paragraphs:
            text = "".join(run.text for run in paragraph.runs)
            if paragraph.runs and pattern.search(text):
                paragraph.runs[0].text = pattern.sub(lambda m: m.group(1) + str(rooms), text, count=1)
                for run in paragraph.runs[1:]:
                    run.text = ""


def select_image_from_index(activity_label):
    """
    Selects an image from the reference PowerPoint based on the activity_label.
    activity_label: The label of the activity that maps to a specific image.
    Returns the extracted image blob.
    """
    if activity_label not in data:
        raise ValueError(f"Activity '{activity_label}' not found in the image index map")

    slide_number = data[activity_label]["image"][0]  # Get slide number from the index
    image_index = data[activity_label]["image"][1]  # Get the image index for that activity

    ref_presentation = _load("liste_JOUR_N.pptx")
    slide_to_copy = ref_presentation.slides[slide_number - 1]  # Convert to zero-based index
    
    picture_shapes = []
    
    # Iterate through the shapes on the slide to find pictures
    for shape in slide_to_copy.shapes:
        if shape.shape_type == 13:  # Shape type 13 means it's an image
            picture_shapes.append(shape)

    # Ensure the picture index exists
    if image_index - 1 >= len(picture_shapes):
        raise ValueError(f"Image index {image_index} is out of bounds for slide {slide_number}")

    selected_image = picture_shapes[image_index - 1]  # Select the appropriate image by index

    # Return the image blob (binary content of the image)
    return selected_image.image.blob





# ─── New design (PRESENTATION_MARRAKECH.pptx) ───
# Slides of that deck are templates made of empty placeholders; we copy a slide, then fill
# the copied placeholders (found by their placeholder idx in the template).

NEW_DA_FILE = "PRESENTATION_MARRAKECH.pptx"
# 0-based slide indexes in NEW_DA_FILE
DA_INTRO_SLIDES = range(0, 9)  # cover, project, Marrakech, practical info, photos
DA_AGENDA_SLIDES = {2: 9, 3: 10, 4: 11}  # number of days -> agenda slide
DA_TRANSPORT_SLIDE = 12
DA_DAY_SLIDE = 13
DA_END_FILE = "SLIDES_FIN.pptx"  # annexes, RSE, contact, thanks (old DEBUT_FIN end, migrated)
DA_END_LAYOUTS = ("ANNEXES_PAGE DE GARDE", "MERCI")  # used if DA_END_FILE is missing

# Placeholder idx of one agenda row: (day title, weekday, date, [5 activity cells])
DA_AGENDA_DAYS = [
    (25, 11, 12, [13, 14, 15, 16, 17]),
    (26, 18, 19, [20, 21, 22, 23, 24]),
    (34, 27, 28, [29, 30, 31, 32, 33]),
    (42, 35, 36, [37, 38, 39, 40, 41]),
]
DA_AGENDA_TITLE = 10
# AGENDA JOUR slide: labels and image boxes of the 5 cells, left to right
DA_DAY_TITLE, DA_DAY_SUBTITLE = 25, 10
DA_DAY_LABELS = [13, 14, 15, 16, 17]
DA_DAY_IMAGES = [26, 29, 27, 30, 28]

_cache = {}


def _load(path):
    if path not in _cache:
        _cache[path] = Presentation(path)
    return _cache[path]


def clear_cache():
    _cache.clear()


def _remove(el):
    if el is not None and el.getparent() is not None:
        el.getparent().remove(el)


def _fit_size(text):
    """Font size (pt) so that a label fits in an agenda cell."""
    if len(text) <= 18:
        return 11
    if len(text) <= 36:
        return 9
    return 7.5


def _set_text(el, text, size=None):
    """Replace the text of a copied placeholder, keeping the formatting it inherited."""
    tx = el.find('p:txBody', _NS)
    paragraphs = tx.findall('a:p', _NS)
    for extra in paragraphs[1:]:
        tx.remove(extra)
    p = paragraphs[0]
    first = p.find('a:r', _NS)
    r_pr = None
    if first is not None and first.find('a:rPr', _NS) is not None:
        r_pr = copy.deepcopy(first.find('a:rPr', _NS))
    if r_pr is None:
        r_pr = etree.Element(_A + 'rPr', lang='fr-FR')
    if size:
        r_pr.set('sz', str(int(size * 100)))
    for child in list(p):
        if child.tag in (_A + 'r', _A + 'br', _A + 'fld'):
            p.remove(child)
    run = etree.Element(_A + 'r')
    run.append(r_pr)
    etree.SubElement(run, _A + 't').text = text
    end = p.find('a:endParaRPr', _NS)
    if end is not None:
        end.addprevious(run)
    else:
        p.append(run)


def _fill(placeholders, idx, text, size=None):
    if idx in placeholders:
        _set_text(placeholders[idx], text, size)


def _drop(placeholders, *indexes):
    for idx in indexes:
        _remove(placeholders.get(idx))


def _put_picture(new_slide, el, blob):
    """Replace the empty picture placeholder el by the image, cropped to fill the same box."""
    xfrm = el.find('p:spPr/a:xfrm', _NS)
    off, ext = xfrm.find('a:off', _NS), xfrm.find('a:ext', _NS)
    left, top = int(off.get('x')), int(off.get('y'))
    width, height = int(ext.get('cx')), int(ext.get('cy'))
    _remove(el)
    pic = new_slide.shapes.add_picture(io.BytesIO(_shrink(blob)), left, top, width, height)
    image_w, image_h = pic.image.size
    if image_w / image_h > width / height:
        pic.crop_left = pic.crop_right = (1 - (width / height) / (image_w / image_h)) / 2
    else:
        pic.crop_top = pic.crop_bottom = (1 - (image_w / image_h) / (width / height)) / 2
    return pic


def _add_cover_logo(slide):
    """Client logo on the cover: on a white rounded card above the client name."""
    path = getattr(inputs, 'input_logo_path', None)
    if not path or not os.path.exists(path):
        return
    try:
        with Image.open(path) as im:
            ratio = im.width / im.height
    except Exception as e:
        print(f"Cannot read the logo {path}: {e}")
        return
    card_h, pad = Inches(1.5), Inches(0.18)
    box_w, box_h = Inches(3.2) - 2 * pad, card_h - 2 * pad
    width, height = (box_w, box_w / ratio) if ratio > box_w / box_h else (box_h * ratio, box_h)
    card_w = int(width + 2 * pad)
    left, top = int((slide.part.package.presentation_part.presentation.slide_width - card_w) / 2), Inches(1.5)
    card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, card_w, card_h)
    card.fill.solid()
    card.fill.fore_color.rgb = RGBColor(255, 255, 255)
    card.line.fill.background()
    card.shadow.inherit = False
    slide.shapes.add_picture(path, int(left + pad), int(top + (card_h - height) / 2), int(width), int(height))


def add_intro_slides(pasteIntoPres):
    pres = _load(NEW_DA_FILE)
    for i in DA_INTRO_SLIDES:
        slide, ph = _copy_slide(pres, i, pasteIntoPres)
        if i == 0:
            _fill(ph, 0, inputs.input_client)
            _fill(ph, 11, inputs.input_event_title)
            _add_cover_logo(slide)
        elif i == 1:
            sentence = (
                f"{inputs.input_client} souhaite organiser un séminaire qui réunira "
                f"{inputs.input_num_people} collaborateurs pour un moment de partage et d’échanges, "
                f"sur {inputs.input_num_days} jours et {inputs.input_num_nights} nuits"
            )
            if inputs.input_dates:
                sentence += f", du {inputs.input_dates}"
            _fill(ph, 10, sentence + ".")


def add_end_slides(pasteIntoPres):
    if os.path.exists(DA_END_FILE):
        end = _load(DA_END_FILE)
        for i in range(len(end.slides)):
            _copy_slide(end, i, pasteIntoPres)
        return
    pres = _load(NEW_DA_FILE)
    for name in DA_END_LAYOUTS:
        layout = next((l for l in pres.slide_layouts if l.name == name), None)
        if layout is None:
            print(f"Layout '{name}' not found in {NEW_DA_FILE}")
            continue
        pres.slides.add_slide(layout)
        _copy_slide(pres, len(pres.slides) - 1, pasteIntoPres)


def add_transport_slide(pasteIntoPres):
    """Flight plan: a form to complete by hand, so the prompts of the template are kept."""
    _copy_slide(_load(NEW_DA_FILE), DA_TRANSPORT_SLIDE, pasteIntoPres, keep_prompts=True)


def add_day_slide(pasteIntoPres, etapes, day_index, day_date):
    """One 'AGENDA JOUR' slide: a label and a photo for each step of the day (max 5)."""
    if len([e for e in etapes if e]) > len(DA_DAY_LABELS):
        print(f"WARNING: day {day_index} has {len(etapes)} steps, only {len(DA_DAY_LABELS)} fit on the slide")
    slide, ph = _copy_slide(_load(NEW_DA_FILE), DA_DAY_SLIDE, pasteIntoPres)
    _fill(ph, DA_DAY_TITLE, f"JOUR {day_index}")
    _fill(ph, DA_DAY_SUBTITLE, day_date)
    for slot, (label_idx, image_idx) in enumerate(zip(DA_DAY_LABELS, DA_DAY_IMAGES)):
        if slot >= len(etapes) or not etapes[slot]:
            _drop(ph, label_idx, image_idx)
            continue
        etape = etapes[slot]
        if "DINER A L'HOTEL" in etape:
            etape = "DINER A L'HOTEL"
        _fill(ph, label_idx, etape, _fit_size(etape))
        try:
            _put_picture(slide, ph[image_idx], select_image_from_index(etapes[slot]))
        except Exception as e:
            print(f"Error adding image for etape '{etapes[slot]}': {e}")
            _drop(ph, image_idx)
    return slide


def make_agenda(pasteIntoPres, activities_by_day, day_dates=None):
    """Agenda slides: one per group of up to 4 days (2, 3 or 4 day layout).
    activities_by_day: list (one per day) of activity labels, at most 5 shown per day."""
    if len(activities_by_day) < 2:
        return None  # no agenda for a single day
    day_dates = day_dates or []
    pres = _load(NEW_DA_FILE)
    for start in range(0, len(activities_by_day), 4):
        chunk = activities_by_day[start:start + 4]
        slide, ph = _copy_slide(pres, DA_AGENDA_SLIDES[max(2, len(chunk))], pasteIntoPres)
        _fill(ph, DA_AGENDA_TITLE, inputs.input_event_title)
        for row, (title_idx, weekday_idx, date_idx, cells) in enumerate(DA_AGENDA_DAYS):
            if row >= len(chunk):
                _drop(ph, title_idx, weekday_idx, date_idx, *cells)
                continue
            _fill(ph, title_idx, f"JOUR {start + row + 1}")
            date = day_dates[start + row] if start + row < len(day_dates) else ""
            _fill(ph, date_idx, date)
            _drop(ph, weekday_idx)
            for cell, idx in enumerate(cells):
                if cell < len(chunk[row]) and chunk[row][cell]:
                    label = chunk[row][cell]
                    _fill(ph, idx, label, _fit_size(label))
                else:
                    _drop(ph, idx)
    return None


def create_manual_note_slide(pasteIntoPres, note_text):
    """
    Creates a blank slide with centered text for manual notes.
    This reminds users to add images manually.
    """
    slide_layout = pasteIntoPres.slide_layouts.get_by_name("Blank")
    new_slide = pasteIntoPres.slides.add_slide(slide_layout)
    
    # Calculate center position (slide is 13.33 x 7.5 inches)
    slide_width = pasteIntoPres.slide_width
    slide_height = pasteIntoPres.slide_height
    
    # Create a text box in the center
    left = Inches(1)
    top = Inches(2.5)
    width = slide_width - Inches(2)
    height = Inches(2.5)
    
    text_box = new_slide.shapes.add_textbox(left, top, width, height)
    text_frame = text_box.text_frame
    text_frame.word_wrap = True
    
    # Set text alignment to center
    text_frame.text = note_text
    paragraph = text_frame.paragraphs[0]
    paragraph.alignment = PP_ALIGN.CENTER
    paragraph.font.size = Pt(24)
    paragraph.font.bold = True
    
    return new_slide