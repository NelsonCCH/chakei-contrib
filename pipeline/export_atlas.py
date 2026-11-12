"""Bake the floor art into the atlas the game loads (contract: docs/ART_PIPELINE.md, "Atlas and manifest").

  python export_atlas.py [--out DIR]      # from the pipeline folder; default DIR: ../art/atlas

Reads the parts from ../art/parts. Writes DIR/floor_<n>.png (pages of at most PAGE px) and DIR/floor.json (the manifest). Every part is
baked at its final size, as the rooms scene places it (compose_rooms: rectified, sheared, widened, category-scaled),
then halved to TILE_PX atlas px per tile width (2 atlas px per game logical px at TW 32):
  - furniture, tables, counters, equipment, loose items and wall parts: captured from the scene (Scene.baked, first
    placement of each label);
  - people: every look's 3/4 front, 3/4 back and side at the scene's person height x their height factor;
  - dishes: every dish at its category footprint (compose_iso2.food's sizing).
Gates on the baked sprites (the export fails on any): page fit; the anchor on the part (people: on the lowest solid
row); the projection gate (furniture, tables, equipment); the style gate against the reference ranges, except the
outliers accepted by eye (ACCEPTED). The manifest also carries the customer look rule (looks.py).
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import NamedTuple

import numpy as np
from PIL import Image

import compose_iso2 as c2
import compose_rooms as cr
import looks
import projection as pj
import style_gate as sg
from compose_base import scaled

SCALE = 0.5  # scene px -> atlas px
TILE_PX = int(2 * c2.HX * SCALE)  # atlas px per tile width (TW)
PAGE = 2048  # max page side (iOS canvas limits)
PAD = 2  # transparent px around every part
# the profiles' native facing, checked by eye on a contact sheet of every side view
SIDE_FACES = {"worker": "left", "housewife": "left", "office_lady": "right", "waiter": "right", "student": "left", "uncle": "left",
              "office_man": "right", "housewife2": "left", "cashier": "left", "barman": "left", "granny": "left", "schoolgirl": "right",
              "wok_cook": "right", "roast_cook": "right", "dishwasher": "left", "waiter_tray": "left"}
VIEW_FACES = {"q_front": "+v", "q_back": "-u"}
STAFF = {"waiter", "cashier", "barman", "wok_cook", "roast_cook", "dishwasher", "waiter_tray"}
# style outliers accepted by eye: content, not style (a tray of meat against white-plate food references; a cook's
# bare arms outlined in skin tone)
ACCEPTED = {"meat_tray": {"val", "outline", "line_px"}, "roast_cook_q_front": {"outline"}, "roast_cook_q_back": {"outline"}, "roast_cook_side": {"outline"}}
# line_px only, at atlas size only: light steel, white and paper parts with a thin dark outline. On the sheet they are
# inside the range (pass 1.80, ticket_rail 3.53, cups 2.71, bag_pile 2.28, noodle_boiler 2.40 vs the counter's 2.20);
# halving blends that 1-2 px outline above the 0.35 darkness threshold (0.75-1.25 vs a 1.72 floor), while the reference
# counters and benches have thick outlines. A phone-size crop shows them at this same density; checked by eye on the
# atlas page.
for _n in ("pass", "ticket_rail", "cups", "bag_pile", "noodle_boiler"):
    ACCEPTED[_n] = {"line_px"}
EQUIPMENT = {"wok_range", "prep_counter", "pass", "roast_counter", "roast_case", "chop_table", "fridge", "bar_back", "takeaway_shelf",
             "noodle_boiler", "griddle", "toaster", "sink", "dish_rack"}
STYLE_KIND = {"person": "people", "dish": "food"}  # everything else: "things"
# style_gate's reference "things" as they are labelled in the scene (its clock, tv and sign are not on the rooms floor)
REFERENCE_THINGS = ("counter", "cake_case", "bar", "takeaway", "bench_front", "bench_back", "booth_table", "stool", "square_table")


class Entry(NamedTuple):
    name: str
    kind: str  # furniture, table, equipment, loose, wall, person, dish
    img: Image.Image
    ax: float
    ay: float
    extra: dict[str, object]


def solid_box(img: Image.Image) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(c2.solid(img))
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def scene_entries(sc: c2.Scene) -> list[Entry]:
    out: list[Entry] = []
    for label, b in sc.baked.items():
        kind = "equipment" if label in EQUIPMENT else b.kind
        extra: dict[str, object] = {"shadow": round(b.shadow, 3)}
        if kind in ("furniture", "table", "equipment", "hung"):
            extra["foot"] = [round(b.foot[0], 3), round(b.foot[1], 3)]
        if kind == "table":
            extra["top_h"] = b.top_h
        if kind in ("wall", "hung"):
            extra["wall"] = b.wall
        out.append(Entry(label, kind, b.img, b.ax, b.ay, extra))
    return out


def people_entries(sc: c2.Scene) -> list[Entry]:
    out: list[Entry] = []
    for who, (sheet, k) in c2.PEOPLE.items():
        for view in ("q_front", "q_back", "side"):
            img = c2.load(sc.root, sheet, f"{who}_{view}")
            img = scaled(img, sc.person_h * k / img.height)
            x0, y0, x1, y1 = solid_box(img)
            faces = SIDE_FACES[who] if view == "side" else VIEW_FACES[view]
            extra: dict[str, object] = {"hips": round(img.height * c2.HIPS, 1), "head": float(y0), "faces": faces,
                                        "role": "staff" if who in STAFF else "customer", "look": who, "shadow": 0.35}
            out.append(Entry(f"{who}_{view}", "person", img, (x0 + x1) / 2, float(y1), extra))
    return out


def dish_entries(sc: c2.Scene) -> list[Entry]:
    out: list[Entry] = []
    for idx, (zh, cat, rel) in c2.FOOD.items():
        r = rel * c2.MAIN_D / 2
        img = c2.load(sc.root, next(s for first, s in c2.DISH_SHEETS if idx >= first), f"dish_{idx}")
        img = scaled(img, 2 * c2.HX * math.sqrt(2) * r / img.width)
        x0, _, x1, y1 = solid_box(img)
        out.append(Entry(f"dish_{idx}", "dish", img, (x0 + x1) / 2, y1 - c2.PLATE_BASE[idx] * img.width,
                         {"name": zh, "category": cat, "radius_tiles": round(r, 4), "shadow": 0.33}))
    return out


def halve(e: Entry) -> Entry:
    img = scaled(e.img, SCALE)
    extra = dict(e.extra)
    for key in ("top_h", "hips", "head"):
        v = extra.get(key)
        if isinstance(v, (int, float)):
            extra[key] = round(float(v) * SCALE, 1)
    return Entry(e.name, e.kind, img, e.ax * SCALE, e.ay * SCALE, extra)


def pack(entries: list[Entry]) -> tuple[list[Image.Image], dict[str, tuple[int, int, int]]]:
    """Shelf packing, tallest first: name -> (page, x, y) of the part's top-left (inside its padding)."""
    pages: list[Image.Image] = []
    where: dict[str, tuple[int, int, int]] = {}
    x = y = shelf = 0
    for e in sorted(entries, key=lambda e: (-e.img.height, e.name)):
        w, h = e.img.width + 2 * PAD, e.img.height + 2 * PAD
        if w > PAGE or h > PAGE:
            raise SystemExit(f"{e.name}: {e.img.size} does not fit a {PAGE} px page")
        if x + w > PAGE:
            x, y, shelf = 0, y + shelf, 0
        if not pages or y + h > PAGE:
            pages.append(Image.new("RGBA", (PAGE, PAGE), (0, 0, 0, 0)))
            x = y = shelf = 0
        pages[-1].alpha_composite(e.img, (x + PAD, y + PAD))
        where[e.name] = (len(pages) - 1, x + PAD, y + PAD)
        x, shelf = x + w, max(shelf, h)
    return [p.crop((0, 0, PAGE, max(1, (p.getbbox() or (0, 0, 1, 1))[3] + PAD))) for p in pages], where


def style_limits(baked: list[Entry]) -> dict[str, dict[str, tuple[float, float]]]:
    """The style gate's ranges from the reference parts as baked here, at atlas size: the metrics shift with size (a 2 px
    rim on a 50 px dish is half the dish), so a baked part is compared with reference parts baked the same way."""
    by = {e.name: e.img for e in baked}
    out: dict[str, dict[str, tuple[float, float]]] = {}
    for kind, refs in sg.REFERENCE.items():
        names = [n for n in REFERENCE_THINGS if n in by] if kind == "things" else [n for _, n in refs if n in by]
        out[kind] = sg.limits({n: sg.measure_img(by[n]) for n in names})
    return out


def gate(full: Entry, e: Entry, lim: dict[str, dict[str, tuple[float, float]]]) -> list[str]:
    """full: the part at scene size, e: as baked. The projection gate runs on the scene-size part: halving is a uniform
    scale and cannot change an angle, while the Hough measure's own noise grows as edges get shorter."""
    bad: list[str] = []
    x0, y0, x1, y1 = solid_box(e.img)
    if not x0 - 1 <= e.ax <= x1 + 1:
        bad.append(f"anchor x {e.ax:.1f} off the part ({x0}-{x1})")
    if e.kind == "person" and abs(e.ay - y1) > 1:
        bad.append(f"anchor y {e.ay:.1f} not on the feet ({y1})")
    elif e.kind != "person" and not y0 - 1 <= e.ay <= y1 + 1 and e.kind != "dish":
        bad.append(f"anchor y {e.ay:.1f} off the part ({y0}-{y1})")
    if e.kind in ("furniture", "table", "equipment", "hung"):
        skip = c2.PROJ_SKIP.get(e.name, frozenset())
        if len(skip) < len(pj.TARGET):
            rep = pj.report(full.img, skip)
            if not pj.passes(rep):
                bad.append("projection " + pj.describe(rep))
    out = set(sg.outliers(sg.measure_img(e.img), lim[STYLE_KIND.get(e.kind, "things")])) - ACCEPTED.get(e.name, set())
    if out:
        bad.append("style " + ", ".join(sorted(out)))
    return bad


def main() -> None:
    art = Path(__file__).resolve().parent.parent / "art"
    src = art / "parts"
    _, _, _, sc = cr.compose_rooms(src)
    _, _, _, fa = cr.compose_rooms(src, cr.FLOOR_ART_ROOMS, tray=True)  # the second floor: lunch kitchen, sink room
    for label, b in fa.baked.items():
        sc.baked.setdefault(label, b)
    full = scene_entries(sc) + people_entries(sc) + dish_entries(sc)
    baked = [halve(e) for e in full]
    lim = style_limits(baked)
    fails = {e.name: g for f, e in zip(full, baked) if (g := gate(f, e, lim))}
    pages, where = pack(baked)
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else art / "atlas"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("floor_*.png"):
        old.unlink()
    names = [f"floor_{i}.png" for i in range(len(pages))]
    for p, n in zip(pages, names):
        p.save(out / n, optimize=True)
    parts: dict[str, object] = {}
    for e in sorted(baked, key=lambda e: e.name):
        page, x, y = where[e.name]
        parts[e.name] = {"page": page, "x": x, "y": y, "w": e.img.width, "h": e.img.height, "kind": e.kind,
                         "anchor": [round(e.ax, 1), round(e.ay, 1)], "mirror": True, **e.extra}
    rules = [{"pattern": p, "members": [list(c) for c in per]} for p, per in looks.LOOK_RULES]
    manifest = {
        "version": 1, "tile_px": TILE_PX, "scene_px_per_atlas_px": 1 / SCALE, "pages": names, "parts": parts,
        "facing": {"q_front": "+v (down-left); mirrored +u", "q_back": "-u (up-left); mirrored -v",
                   "side": "per part 'faces': the profile's native facing on the sheet"},
        "looks": {"customers": [w for w in looks.LOOKS], "neighbour_tiles": looks.NEIGHBOUR_TILES, "rules": rules,
                  "hash": "FNV-1a 32-bit of UTF-8 '<group id>:<member index>'",
                  "pick": "first rule matching the label gives member k's candidates (last list repeats; no match: all customers); "
                          "start at hash % len; first candidate not at a neighbouring table nor earlier in the party; "
                          "else the same walk over all customers; else the hashed candidate"},
        "gates": {"failed": fails, "parts": len(baked)},
    }
    (out / "floor.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    kinds: dict[str, int] = {}
    for e in baked:
        kinds[e.kind] = kinds.get(e.kind, 0) + 1
    print(f"{len(baked)} parts {kinds} on {len(pages)} pages {[p.size for p in pages]}")
    for n, g in fails.items():
        print("FAIL", n, "; ".join(g))
    if fails:
        sys.exit(1)


if __name__ == "__main__":
    main()
