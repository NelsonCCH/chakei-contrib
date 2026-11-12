"""45-degree (2:1 isometric) floor composition from the cut parts: the compositing reference for the game.

Everything is placed in floor coordinates (u along the right-hand wall, v along the left-hand wall, 1 = one floor tile),
so every footprint, tabletop and shadow sits on the 2:1 grid:

  - booths stand along the walls with the table's end against the wall: bench, table, bench, booth after booth;
    free-standing square tables have stools on four sides, diners on the two far sides (the top hides their legs);
  - tabletops are widened in code (slices repeated along the top's own iso axes) and lifted (a pedestal row
    repeated), so the 2:1 edges and the pedestal stay as drawn;
  - every seated diner faces their own table (3/4 front or back, mirrored as the bench's direction needs) and is cut
    along the top edge of whatever hides their lower body (the tabletop, the near bench's back, the counter);
  - food: one main and a drink per diner, sized by category on its footprint (not on the picture's size), placed by a
    small solver; the compose FAILS if any dish leaves the top's margin or touches another dish;
  - standing people go where their feet are clear of every footprint and their silhouette covers the least of the
    seated diners and the food; draw order = the ground contact point's depth (u + v).

compose(root): a small test floor (1170 x 780). compose_floor(root): a whole-floor view (2340 x 1560).
root is the parts folder (art/parts); a part is root/<sheet>/<name>.png, where <sheet> is the generation sheet it was
cut from (I-STAB, I-FURN, I-CHAR-1, FOOD-N, ...). bench_back and square_table were drawn at 23 degrees and are
stretched vertically to 2:1; clock / sign / TV come from the front-view sheet F-FURN, sheared onto their wall.
Facing: 3/4 front faces down-left (+v), 3/4 back faces up-left (-u); the mirror gives down-right (+u) and up-right (-v).
"""

from __future__ import annotations

import math
import os
from pathlib import Path
from typing import NamedTuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
from scipy import ndimage
from scipy.spatial import ConvexHull

import compose_base as iso
import projection as pj
from compose_base import DEVICE_W, scaled

HX, HY = iso.TW // 2, iso.TH // 2  # one tile along u is (+64, +32) px, along v (-64, +32)
BENCH_W = 470  # bench_front's bbox width in scene px
PERSON_TO_BACK = 1.75  # standing height / bench backrest height above the floor
SEAT_TO_BACK = 0.42  # seat surface height / backrest height
TABLE_TO_BACK = 0.58  # tabletop height / backrest height: elbow height for a seated bust (0.70 reaches the chin)
COUNTER_TO_BACK = 0.95  # counter top height / backrest height
HIPS = 0.53  # hips, from the top of a standing sprite
CUT_MARGIN = 14  # px below the occluder's top edge where a hidden body is cut (hidden under the occluder)
OVERHANG = 0.15  # tiles of tabletop over each seat's front edge: snug against both benches and the diners
WALL_GAP = 0.12  # tiles between a wall and the table end / bench end
WALL_BAND = 210  # tiled dado height, px

# Food for the game, not the real world: readable, sizes closer together. Footprint diameter in tiles, relative to
# the main plate, applied to the dish's footprint (the picture's widest extent: plate, bowl rim or saucer).
MAIN_D = 1.15  # a main plate's footprint diameter, tiles
FOOD = {0: ("叉燒湯米", "bowl", 0.85), 1: ("白多士", "toast", 0.70), 2: ("星洲炒米", "main", 1.00),
        3: ("燉奶", "dessert", 0.70), 4: ("火腿三文治", "sandwich", 0.70), 5: ("熱奶茶", "cup", 0.52),
        6: ("凍檸茶", "glass", 0.52), 7: ("鴛鴦", "cup", 0.52), 8: ("凍奶茶", "glass", 0.52),  # FOOD-N2 from here
        9: ("餐蛋麵", "bowl", 0.85), 10: ("焗豬扒飯", "main", 1.00), 11: ("菠蘿油", "toast", 0.70),
        12: ("火腿通粉", "bowl", 0.85), 13: ("西多士", "toast", 0.70), 14: ("熱檸茶", "cup", 0.52),  # B1-FOOD from here
        15: ("食剩碟", "main", 1.00), 16: ("飲剩杯", "cup", 0.52), 17: ("食剩碗", "bowl", 0.85)}  # 15-17: a dirty table's
DISH_SHEETS = ((12, "B1-FOOD"), (6, "FOOD-N2"), (0, "FOOD-N"))  # the sheet holding each dish index from the first up
DRINK = 5  # the small test floor's drink
DRINKS = [5, 6, 14, 7, 8]
MAINS = [2, 10, 12, 0, 9, 13, 1, 11, 4, 3]
LEFTOVERS = [(15, 16), (17, 16)]  # a dirty table's dishes, per diner who left: (main, drink)
# base-ellipse centre above the picture's bottom / its width (bowls and glasses: their foot ring; plates and saucers:
# half the plate's measured height / width)
PLATE_BASE = {0: 0.13, 1: 0.30, 2: 0.30, 3: 0.13, 4: 0.30, 5: 0.30, 6: 0.07, 7: 0.30, 8: 0.07, 9: 0.13, 10: 0.22, 11: 0.28,
              12: 0.13, 13: 0.33, 14: 0.30, 15: 0.31, 16: 0.31, 17: 0.13}
# people: (sheet, height / an adult's); the waiter, cashier and barman are staff, the rest customers
PEOPLE = {"worker": ("I-CHAR-1", 1.0), "housewife": ("I-CHAR-1", 0.97), "office_lady": ("I-CHAR-2", 0.97), "waiter": ("I-CHAR-2", 1.0),
          "student": ("I-CHAR-3b", 0.93), "uncle": ("I-CHAR-3b", 0.95), "office_man": ("I-CHAR-4", 1.0), "housewife2": ("I-CHAR-4", 0.96),
          "cashier": ("B1-STAFF", 0.96), "barman": ("B1-STAFF", 0.98), "granny": ("B1-CHAR", 0.9), "schoolgirl": ("B1-CHAR", 0.92),
          "wok_cook": ("R-COOKS", 0.99), "roast_cook": ("R-COOKS", 0.97),
          "dishwasher": ("FA-STAFF", 0.95), "waiter_tray": ("FA-STAFF", 1.0)}
CUSTOMERS = ["worker", "housewife", "office_lady", "student", "uncle", "office_man", "housewife2", "granny", "schoolgirl"]
DISH_MARGIN = 0.10  # tiles: dish footprint to tabletop edge, and between dishes
TOP_HALF = 1.40  # half depth of every tabletop (booth tables: across; square tables: both ways), tiles
SQUARE_HALF = 1.75  # half side of a square tabletop: wider than a diner on screen, so nobody sticks out past its corners
SQUARE_SPREAD = 0.3  # tiles each far diner sits from the middle of their edge, away from the other diner
SQUARE_SIT = 0.2 # tiles from a square top's edge to a far diner's seat point
AISLE = 3.0  # tiles between furniture rows: 2x a standing person's footprint (about 1.5 tiles with the bag)
COUNTER_DRAWN_DEG = 14.2  # I-COUNTER drew its long edges at this angle (measured); sheared to 26.6
COUNTER_HALF = 3.4  # tiles: half the counter's length
CAKE_HALF = 1.4  # tiles: half the cake cabinet's length
# the department counters (B1-DEPT, drawn at about 15.8 degrees like I-COUNTER; sheared to 26.6). Scale: the 2.2 m
# counter is 6.8 tiles, so 1 m is about 3.1 tiles
DEPT_DRAWN_DEG = 15.8
TAKEAWAY_HALF = 1.85  # tiles: half the takeaway packing bench's length (1.2 m)
BAR_HALF = 2.5  # tiles: half the drinks bar's length (1.6 m)
HATCH_TILES = 4.8  # tiles of left wall the kitchen hatch spans (1.2 m): the aisle between the booth rows and a little behind them
HATCH_Z = 0.6  # the hatch picture's bottom (its shelf brackets) above the floor, x a booth back
QUEUE_FIRST = 1.9  # tiles from the counter's end to the first in the queue: clear of the counter's front
QUEUE_GAP = 4.3  # tiles between people in the queue: each stands clear of the one ahead, and their bubbles fit side by side
STANDER_APART = 15.0  # tiles: a standing customer keeps this far from anyone of the same type, seated or standing
QUEUE_CLEAR = 6.5  # tiles: walkers keep this far from the queue, so the line reads on its own
DINER_WEIGHT = 1000.0  # a stander covering any part of a seated diner is a last resort (cover >= this: it happened)
TOUCH_PX = 5  # a walker may graze up to this many px of a diner (an outline touch); covering more is a last resort
FURNITURE_WEIGHT = 0.3  # a stander overlapping furniture on screen counts this much per px (diners and food: 1.0)


class Grid(NamedTuple):
    cx: float
    y0: float
    w: int
    h: int

    def S(self, u: float, v: float) -> tuple[float, float]:
        return self.cx + HX * (u - v), self.y0 + HY * (u + v)


SMALL = Grid(iso.CX, 560, iso.RW, iso.RH)  # 1920 x 1280 -> 1170 x 780
LARGE = Grid(1920, 640, 3840, 2560)  # the whole floor: 3840 x 2560 -> 2880 x 1920


class Sprite(NamedTuple):
    img: Image.Image
    fx: float  # the footprint's centre at floor level, in the sprite's own pixels
    fy: float
    a: float  # footprint half extent along u, tiles
    b: float  # along v


class Table(NamedTuple):
    img: Image.Image
    fx: float  # floor point under the top's centre, sprite pixels
    fy: float
    a: float  # top half extents, tiles
    b: float
    h: float  # top surface height above the floor, px


class Dish(NamedTuple):
    idx: int
    u: float
    v: float
    r: float  # footprint radius, tiles


class Baked(NamedTuple):
    """A part exactly as the scene places it, for the game's atlas (export_atlas.py)."""
    kind: str  # furniture, table, equipment, loose, wall, hung (the hood: anchor at its lowest pixel, on the wall)
    img: Image.Image
    ax: float  # anchor in sprite px: the floor point it stands on (wall parts: its centre on the wall)
    ay: float
    foot: tuple[float, float]  # footprint half extents (a, b), tiles; (0, 0) for loose and wall parts
    top_h: float  # tables: top surface above the floor point, px; else 0
    shadow: float  # its code shadow's strength (0: none)
    wall: str  # wall parts: "L" or "R"; else ""


Placed = tuple[Image.Image, int, int, float]  # image, top-left x, y, depth
Rect = tuple[float, float, float, float]  # u0, u1, v0, v1
Diner = tuple[tuple[float, float], int, int]  # unit floor vector from the table's centre towards the diner, main, drink
Seat = tuple[str, int, int] | None  # (who, main dish, drink), or an empty seat


IDENTITY = (1.0, 0.0, 0.0, 1.0)
# parts the projection gate and rectify() do not hold to every family, by design: the booth's backrest reclines, so
# its channels lean (its verticals are not boxy edges); the stool is round with splayed legs (no straight box edges);
# the hood's ends are sloped panels, so its edges across the depth are not ground-axis lines; the griddle's splash
# guard has sloped side panels too (its v family reads 0.4 degrees at sheet size and 0.7-4.1 at placed sizes: noise)
PROJ_SKIP: dict[str, frozenset[str]] = {"bench_front": frozenset({"z"}), "stool": frozenset({"u", "v", "z"}), "hood": frozenset({"v"}),
                                        "griddle": frozenset({"v"})}


def part_path(root: Path, call: str, name: str) -> str:
    return str(root / call / f"{name}.png")


def load(root: Path, call: str, name: str) -> Image.Image:
    return Image.open(root / call / f"{name}.png").convert("RGBA")


def solid(img: Image.Image) -> np.ndarray:
    return np.asarray(img)[..., 3] >= 128


def to_2to1(img: Image.Image, drawn_deg: float) -> Image.Image:
    """Stretch vertically so diagonals drawn at drawn_deg become the grid's 26.57 degrees."""
    k = 0.5 / math.tan(math.radians(drawn_deg))
    return img.convert("RGBa").resize((img.width, round(img.height * k)), Image.Resampling.LANCZOS).convert("RGBA")


def extents(m: np.ndarray) -> tuple[float, float, float, float]:
    """(bbox centre x, lowest y, a, b) of a footprint drawn long side along u: width = 2*64*(a+b), and the lowest
    corner (+a, +b) lies 64*(a-b) right of the bbox centre."""
    ys, xs = np.nonzero(m)
    x0, x1, ylow = float(xs.min()), float(xs.max()), float(ys.max())
    xc = (x0 + x1) / 2
    xlow = float(xs[ys >= ylow - 2].mean())
    s = (x1 - x0 + 1) / (2 * HX)
    d = max(-s + 0.4, min(s - 0.4, (xlow - xc) / HX))
    return xc, ylow, (s + d) / 2, (s - d) / 2


def footprint(img: Image.Image) -> Sprite:
    xc, ylow, a, b = extents(solid(img))
    return Sprite(img, xc, ylow - HY * (a + b), a, b)


def mirror(sp: Sprite) -> Sprite:
    return Sprite(ImageOps.mirror(sp.img), sp.img.width - 1 - sp.fx, sp.fy, sp.b, sp.a)


def resize(sp: Sprite, k: float) -> Sprite:
    return Sprite(scaled(sp.img, k), sp.fx * k, sp.fy * k, sp.a * k, sp.b * k)


def top_mask(a: np.ndarray) -> np.ndarray:
    """The tabletop: the largest pale region's convex hull, grown 3 px, plus the chrome rim under its front corner."""
    m = a[..., 3] >= 128
    pale = m & (a[..., :3].astype(int).sum(-1) > 600)
    lbl, n = ndimage.label(pale)
    if n > 1:
        sizes = np.asarray(ndimage.sum(pale, lbl, range(1, n + 1)))
        pale = lbl == 1 + int(np.argmax(sizes))
    ys, xs = np.nonzero(pale)
    pts = np.column_stack([xs, ys]).astype(float)
    hull = pts[ConvexHull(pts).vertices]
    h, w = m.shape
    im = Image.new("L", (w, h), 0)
    ImageDraw.Draw(im).polygon([(float(x), float(y)) for x, y in hull], fill=255)
    top = ndimage.binary_dilation(np.asarray(im) > 0, iterations=3)
    ylow = int(ys.max())
    xcol = int(round(float(xs[ys >= ylow - 1].mean())))
    rim = 0
    while ylow + rim + 1 < h and m[ylow + rim + 1, xcol] and rim < 60:
        rim += 1
    out = top.copy()
    for t in range(1, rim + 3):
        out[t:] |= top[:-t]
    return out & m


def measure_table(img: Image.Image) -> Table:
    a = np.asarray(img)
    top = top_mask(a)
    pale = top & (a[..., :3].astype(int).sum(-1) > 600)
    xc, ylow, ta, tb = extents(pale)
    ty = ylow - HY * (ta + tb)
    m = a[..., 3] >= 128
    my, mx = np.nonzero(m)
    ybot = int(my.max())
    band = my >= ybot - max(4, (ybot - int(my.min())) // 10)
    wf = float(mx[band].max() - mx[band].min() + 1)
    fy = ybot - wf / 4  # the foot's ellipse is 2:1: its centre is a quarter of its width above its bottom
    return Table(img, xc, fy, ta, tb, fy - ty)


def scale_table(t: Table, k: float) -> Table:
    return Table(scaled(t.img, k), t.fx * k, t.fy * k, t.a * k, t.b * k, t.h * k)


def stretch(arr: np.ndarray, cx: float, cy: float, d: tuple[float, float], e: tuple[float, float], extra: float,
            period: float) -> tuple[np.ndarray, int, int]:
    """Lengthen a layer by `extra` tiles along screen axis d (px per tile), cutting it along the line through (cx, cy)
    in direction e: each half moves out by extra/2 and the middle band, `period` tiles either side of the cut, is
    stretched evenly to fill the gap. Edges along d stay straight and unbroken even where the art's slope is a little
    off 2:1 (repeating a slice left a 1-2 px step at every seam), edges along e stay where they were. Returns the new
    layer and the padding added."""
    px, py = int(math.ceil(abs(d[0]) * extra / 2)) + 1, int(math.ceil(abs(d[1]) * extra / 2)) + 1
    h, w = arr.shape[:2]
    H, W = h + 2 * py, w + 2 * px
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    qx, qy = xx - (cx + px), yy - (cy + py)
    det = d[0] * e[1] - d[1] * e[0]
    al = (qx * e[1] - qy * e[0]) / det  # coordinate along d, tiles
    half = extra / 2
    mid: np.ndarray = al * period / (half + period)
    src: np.ndarray = np.where(al < -half - period, al + half, np.where(al > half + period, al - half, mid))
    sx = np.rint(xx - px - (al - src) * d[0]).astype(int)
    sy = np.rint(yy - py - (al - src) * d[1]).astype(int)
    ok = (sx >= 0) & (sx < w) & (sy >= 0) & (sy < h)
    out = np.zeros((H, W, 4), np.uint8)
    out[ok] = arr[sy[ok], sx[ok]]
    return out, px, py


def top_region(a: np.ndarray) -> np.ndarray:
    """The largest pale region of a sprite: a counter's or cabinet's top surface."""
    m = a[..., 3] >= 128
    pale = m & (a[..., :3].astype(int).sum(-1) > 600)
    lbl, n = ndimage.label(pale)
    if n > 1:
        pale = lbl == 1 + int(np.argmax(np.asarray(ndimage.sum(pale, lbl, range(1, n + 1)))))
    return pale


def box_height(img: Image.Image) -> float:
    """A box's top above the floor, px: from its lowest pixel (the front bottom corner) up to its top surface's lowest
    pixel (the front top corner)."""
    a = np.asarray(img)
    return float(np.nonzero((a[..., 3] >= 128).any(1))[0].max() - np.nonzero(top_region(a).any(1))[0].max())


def raise_box(img: Image.Image, dz: int) -> Image.Image:
    """Make a box dz px taller: in every column, stretch the run from the top surface's lower edge to the column's
    bottom (the front faces) evenly by dz px, so panels and glass grow without streaks and the top stays as drawn.
    Both ends of the run follow parallel slanted lines, so the faces' stripes and edges stay straight."""
    if dz <= 0:
        return img
    a = np.asarray(img)
    h, w = a.shape[:2]
    m = a[..., 3] >= 128
    top = top_region(a)
    out = np.zeros((h + dz, w, 4), np.uint8)
    for x in range(w):
        ys = np.nonzero(m[:, x])[0]
        if not len(ys):
            continue
        ts = np.nonzero(top[:, x])[0]
        y0 = int(ts.max()) + 1 if len(ts) else int(ys.min())
        y1 = int(ys.max()) + 1
        n = y1 - y0
        src = y0 + (np.arange(n + dz) * n) // (n + dz)
        out[:y0, x] = a[:y0, x]
        out[y0:y1 + dz, x] = a[src, x]
        out[y1 + dz:, x] = a[y1:, x]
    return Image.fromarray(out, "RGBA")


def smooth_edge(layer: np.ndarray, sigma: float = 2.0) -> np.ndarray:
    """Round off the 1-2 px steps the slice repeat leaves on a widened top's outline: blur the coverage and threshold
    it again (notches fill, bumps go); pixels it adds take the colour of the nearest original pixel."""
    m = layer[..., 3] >= 128
    sm = ndimage.gaussian_filter(m.astype(float), sigma) >= 0.5
    idx = np.asarray(ndimage.distance_transform_edt(~m, return_distances=False, return_indices=True))
    out = layer[idx[0], idx[1]].copy()
    out[..., 3] = np.where(sm, np.where(m, layer[..., 3], 255), 0)
    return out.astype(np.uint8)


def widen(t: Table, a_new: float, b_new: float) -> Table:
    """Grow the tabletop to half extents (a_new, b_new) tiles; the pedestal and foot stay as drawn, centred under it."""
    a = np.asarray(t.img)
    top = top_mask(a)
    layer = np.where(top[..., None], a, 0).astype(np.uint8)
    base = np.where(top[..., None], 0, a).astype(np.uint8)
    cx, cy = t.fx, t.fy - t.h
    pads = [0, 0]
    u_ax, v_ax = (float(HX), float(HY)), (float(-HX), float(HY))
    for d, e, extra in ((u_ax, v_ax, 2 * (a_new - t.a)), (v_ax, u_ax, 2 * (b_new - t.b))):
        if extra <= 0.02:
            continue
        layer, px, py = stretch(layer, cx + pads[0], cy + pads[1], d, e, extra, 0.5)
        pads = [pads[0] + px, pads[1] + py]
    layer = smooth_edge(layer)
    out = np.zeros_like(layer)
    out[pads[1]:pads[1] + base.shape[0], pads[0]:pads[0] + base.shape[1]] = base
    img = Image.fromarray(out, "RGBA")
    img.alpha_composite(Image.fromarray(layer, "RGBA"))
    return Table(img, t.fx + pads[0], t.fy + pads[1], max(a_new, t.a), max(b_new, t.b), t.h)


def raise_top(t: Table, dz: int) -> Table:
    """Lift the tabletop by dz px: repeat one row of the pedestal below the top (the sheet's tables are low)."""
    if dz <= 0:
        return t
    a = np.asarray(t.img)
    top = top_mask(a)
    layer = np.where(top[..., None], a, 0).astype(np.uint8)
    base = np.where(top[..., None], 0, a).astype(np.uint8)
    y_top = int(np.nonzero(top.any(1))[0].max())
    y_foot = int(t.fy - (a.shape[0] - 1 - t.fy))  # the foot's band starts about as far above the floor point as below
    y_p = (y_top + y_foot) // 2 if y_top + 2 < y_foot else max(0, y_foot - 1)
    h, w = a.shape[:2]
    out = np.zeros((h + dz, w, 4), np.uint8)
    out[:y_p] = base[:y_p]
    out[y_p:y_p + dz] = base[y_p]
    out[y_p + dz:] = base[y_p:]
    img = Image.fromarray(out, "RGBA")
    img.alpha_composite(Image.fromarray(np.vstack([layer, np.zeros((dz, w, 4), np.uint8)]), "RGBA"))
    return Table(img, t.fx, t.fy + dz, t.a, t.b, t.h + dz)


def mirror_table(t: Table) -> Table:
    return Table(ImageOps.mirror(t.img), t.img.width - 1 - t.fx, t.fy, t.b, t.a, t.h)


def shear(img: Image.Image, s: float, kx: float = 1.0) -> Image.Image:
    """Put a front-facing flat item onto an iso wall: squeeze x by kx (2/sqrt(5) for a 2:1 wall) and shear y by s
    (+0.5 on the right-hand wall, whose horizontals fall to the right; -0.5 on the left-hand wall)."""
    w = round(img.width * kx)
    h = img.height + int(math.ceil(abs(s) * w))
    off = 0.0 if s >= 0 else -s * w
    out = img.convert("RGBa").transform((w, h), Image.Transform.AFFINE, (1 / kx, 0, 0, -s, 1, -off), Image.Resampling.BICUBIC)
    return out.convert("RGBA")


THEMES = ("plain", "estate", "central")  # stage treatments: walls and floor are a code layer


def shell(g: Grid, theme: str = "plain", back_h: float = 0.0) -> Image.Image:
    """The room: walls taller than the frame and a 2:1 tiled floor. "plain": compose_base.shell's colours (teal dado,
    pink check). "estate" (屋邨茶記): green and white wall tiles to shoulder height (1.45 x a booth back), a mosaic
    floor of small tiles. "central" (中環早餐): wood panelling to 1.1 x a booth back, a darker floor."""
    yy, xx = np.mgrid[0:g.h, 0:g.w]
    yb = g.y0 + np.abs(xx - g.cx) / 2
    h = yb - yy  # height above the floor line, px (walls)
    w = np.abs(xx - g.cx)  # along the wall, screen px
    a = np.zeros((g.h, g.w, 3), np.uint8)
    u, v = (xx - g.cx) / iso.TW + (yy - g.y0) / iso.TH, (yy - g.y0) / iso.TH - (xx - g.cx) / iso.TW
    if theme == "plain":
        a[:] = iso.WALL_C
        band = (h <= WALL_BAND) & (h > 20)
        a[band] = iso.GROUT_C
        a[band & (((yy - yb) % 32) < 29) & ((xx % 32) < 29)] = iso.TEAL_C
        a[(h <= 20) & (h > 0)] = iso.SKIRT_C
        chk = ((np.floor(u) + np.floor(v)) % 2 == 0)[..., None]
        return Image.fromarray(np.where((h <= 0)[..., None], np.where(chk, iso.FLOOR_A, iso.FLOOR_B), a).astype(np.uint8)).convert("RGBA")
    if theme == "estate":
        a[:] = (236, 226, 196)  # cream plaster above
        top = back_h * 1.45
        tile = 44
        row, col = np.floor(h / tile), np.floor(w / (tile * 0.894))
        grout = ((h % tile) < 3) | ((w % (tile * 0.894)) < 3)
        band = (h > 0) & (h <= top)
        a[band] = np.where(((row + col) % 2 == 0)[..., None], np.array((236, 242, 232)), np.array((92, 158, 120)))[band]
        a[band & grout] = (190, 196, 184)
        a[(h > top) & (h <= top + 22)] = (46, 110, 78)  # a dark green border course
        a[(h > 0) & (h <= 18)] = (40, 92, 66)
        # 紙皮石: quarter-tile mosaic, mostly white with scattered colour, a darker grout
        q = 4
        mu, mv = np.floor(u * q), np.floor(v * q)
        hsh: np.ndarray = ((mu * 73856093).astype(np.int64) ^ (mv * 19349663).astype(np.int64)) % 97
        pal = np.array([(238, 234, 222), (232, 228, 214), (226, 220, 206), (196, 86, 70), (78, 140, 120), (70, 104, 150)], np.uint8)
        pick: np.ndarray = np.where(hsh < 80, hsh % 3, 3 + hsh % 3)
        floor = pal[pick]
        mgrout = ((u * q) % 1 < 0.08) | ((v * q) % 1 < 0.08)
        floor[mgrout] = (150, 146, 136)
        return Image.fromarray(np.where((h <= 0)[..., None], floor, a).astype(np.uint8)).convert("RGBA")
    if theme == "central":
        a[:] = (206, 196, 172)  # warm putty above
        top = back_h * 1.1
        plank = 58
        k = np.floor(w / plank)
        tone = np.where((k % 3 == 0)[..., None], np.array((122, 76, 44)), np.where((k % 3 == 1)[..., None], np.array((110, 68, 40)), np.array((132, 84, 50))))
        band = (h > 0) & (h <= top)
        a[band] = tone[band]
        a[band & ((w % plank) < 4)] = (64, 38, 22)  # the grooves between planks
        a[(h > top) & (h <= top + 26)] = (78, 48, 28)  # the cap rail
        a[(h > top + 26) & (h <= top + 30)] = (150, 108, 70)
        a[(h > 0) & (h <= 22)] = (52, 32, 20)
        chk = ((np.floor(u) + np.floor(v)) % 2 == 0)[..., None]
        floor = np.where(chk, np.array((92, 78, 70)), np.array((128, 112, 98)))
        return Image.fromarray(np.where((h <= 0)[..., None], floor, a).astype(np.uint8)).convert("RGBA")
    raise ValueError(f"unknown theme {theme!r}")


def tint_layer(mask: Image.Image, colour: tuple[int, int, int]) -> Image.Image:
    t = Image.new("RGBA", mask.size, (*colour, 0))
    t.putalpha(mask)
    return t


def place_dishes(uc: float, vc: float, A: float, B: float, diners: list[Diner]) -> list[Dish]:
    """One main and a drink per diner on a top of half extents (A along u, B along v). Each dish goes to the free spot
    nearest its preferred one (main in front of its diner, drink beside it) that keeps it inside the top's margin, on
    its diner's half and clear of every dish already placed."""
    placed: list[Dish] = []
    grid = [(float(du), float(dv)) for du in np.arange(-A, A + 1e-6, 0.05) for dv in np.arange(-B, B + 1e-6, 0.05)]
    for (nu, nv), main, drink in diners:
        ext = abs(nu) * A + abs(nv) * B
        tu, tv = -nv, nu
        rm = FOOD[main][2] * MAIN_D / 2
        for idx, pref in ((main, 0.0), (drink, 1.0)):
            r = FOOD[idx][2] * MAIN_D / 2
            depth = ext - r - DISH_MARGIN - 0.05
            side = pref * (rm + r + DISH_MARGIN + 0.05)
            pu, pv = nu * depth + tu * side, nv * depth + tv * side
            best: tuple[float, float] | None = None
            for du, dv in sorted(grid, key=lambda q: (q[0] - pu) ** 2 + (q[1] - pv) ** 2):
                if abs(du) > A - r - DISH_MARGIN or abs(dv) > B - r - DISH_MARGIN or du * nu + dv * nv < 0:
                    continue
                if all(math.hypot(du - (d.u - uc), dv - (d.v - vc)) >= r + d.r + DISH_MARGIN for d in placed):
                    best = (du, dv)
                    break
            if best is None:
                raise ValueError(f"no room for {FOOD[idx][0]} on the table at ({uc:.1f}, {vc:.1f})")
            placed.append(Dish(idx, uc + best[0], vc + best[1], r))
    check_dishes(placed, (uc - A, uc + A, vc - B, vc + B))
    return placed


def check_dishes(dishes: list[Dish], top: Rect) -> None:
    """Fail the compose unless every dish footprint is inside the top with DISH_MARGIN and no two are closer than it."""
    u0, u1, v0, v1 = top
    eps = 1e-6
    for d in dishes:
        if min(d.u - d.r - u0, u1 - d.u - d.r, d.v - d.r - v0, v1 - d.v - d.r) < DISH_MARGIN - eps:
            raise ValueError(f"{FOOD[d.idx][0]} is within {DISH_MARGIN} tiles of the tabletop's edge")
    for i, d in enumerate(dishes):
        for e in dishes[i + 1:]:
            if math.hypot(d.u - e.u, d.v - e.v) < d.r + e.r + DISH_MARGIN - eps:
                raise ValueError(f"{FOOD[d.idx][0]} and {FOOD[e.idx][0]} overlap")


class Scene:
    def __init__(self, root: Path, g: Grid, theme: str = "plain") -> None:
        self.root, self.g = root, g
        self.floor_sh = Image.new("RGBA", (g.w, g.h), (0, 0, 0, 0))
        self.items: list[Placed] = []
        self.heads: list[tuple[float, float, str]] = []  # each customer's head top (x, y) and role, for status bubbles
        self.slots: list[SeatSlot] = []  # the whole floor's taken seats, in the order their diners are placed
        self.feet: list[Rect] = []  # furniture and standers' footprints (u0, u1, v0, v1)
        self.keep: list[tuple[np.ndarray, int, int, float]] = []  # masks a stander should not cover, and their weight
        self.dishes: list[Dish] = []
        self.floating: list[tuple[str, int]] = []  # per seated diner: px columns cut at the hips with no occluder
        self.marks: list[tuple[float, float]] = []  # each dirty table's top centre (x, y), for its 執枱 marker
        self.party: list[int] = []  # per head: its party (the table's index for diners; one of its own for a stander)
        self.counter_h = 0.0  # the counter top's height above the floor, px
        self.parts: list[tuple[str, Image.Image]] = []  # every placed furniture/equipment image, for the projection gate
        self.baked: dict[str, Baked] = {}  # each label's first placed part, as placed, for the game's atlas
        bf = footprint(pj.rectified(part_path(root, "I-STAB", "bench_front"), IDENTITY, PROJ_SKIP["bench_front"]))
        self.bench_front = resize(bf, BENCH_W / bf.img.width)
        bk = footprint(pj.rectified(part_path(root, "I-FURN", "bench_back"), pj.stretch_m(0.5 / math.tan(math.radians(23.2)))))
        self.bench_back = resize(bk, self.bench_front.a / bk.a)  # same bench length as bench_front
        self.back_h = self.bench_front.fy  # backrest top above the floor point, px
        self.img = shell(g, theme, self.back_h)
        self.person_h = self.back_h * PERSON_TO_BACK
        self.seat_h = self.back_h * SEAT_TO_BACK
        t = measure_table(pj.rectified(part_path(root, "I-STAB", "booth_table"), IDENTITY))
        t = scale_table(t, self.bench_front.a * 0.95 / t.a)  # the top as long as the bench; the pedestal lifted after
        self.booth_table = raise_top(t, int(round(self.back_h * TABLE_TO_BACK - t.h)))
        q = measure_table(pj.rectified(part_path(root, "I-FURN", "square_table"), pj.stretch_m(0.5 / math.tan(math.radians(22.8)))))
        q = scale_table(q, 1.0 / max(q.a, q.b))
        self.square_table = raise_top(q, int(round(self.back_h * TABLE_TO_BACK - q.h)))
        st = footprint(load(root, "I-STAB", "stool"))
        self.stool = resize(st, self.seat_h * 1.05 / st.fy)

    # -- placing ------------------------------------------------------------------------------------------------
    def put(self, img: Image.Image, x: float, y: float, depth: float) -> tuple[int, int]:
        tl = (int(round(x)), int(round(y)))
        self.items.append((img, tl[0], tl[1], depth))
        return tl

    def put_sprite(self, sp: Sprite, u: float, v: float, shadow: float = 0.32, label: str = "part") -> tuple[int, int]:
        x, y = self.g.S(u, v)
        self.parts.append((label, sp.img))
        self.baked.setdefault(label, Baked("furniture", sp.img, sp.fx, sp.fy, (sp.a, sp.b), 0.0, shadow, ""))
        self.feet.append((u - sp.a, u + sp.a, v - sp.b, v + sp.b))
        self.iso_shadow(u, v, sp.a, sp.b, shadow)
        tl = self.put(sp.img, x - sp.fx, y - sp.fy, u + v)
        self.keep.append((solid(sp.img), tl[0], tl[1], FURNITURE_WEIGHT))
        return tl

    def put_table(self, t: Table, u: float, v: float, label: str = "table") -> tuple[int, int]:
        x, y = self.g.S(u, v)
        self.parts.append((label, t.img))
        self.baked.setdefault(label, Baked("table", t.img, t.fx, t.fy, (t.a, t.b), t.h, 0.22, ""))
        self.feet.append((u - t.a, u + t.a, v - t.b, v + t.b))
        self.iso_shadow(u, v, t.a * 0.8, t.b * 0.8, 0.22)
        tl = self.put(t.img, x - t.fx, y - t.fy, u + v)
        self.keep.append((solid(t.img), tl[0], tl[1], FURNITURE_WEIGHT))
        return tl

    def iso_shadow(self, u: float, v: float, a: float, b: float, strength: float = 0.32, grow: float = 0.08) -> None:
        sh = Image.new("L", self.img.size, 0)
        S = self.g.S
        pts = [S(u - a - grow, v - b - grow), S(u + a + grow, v - b - grow), S(u + a + grow, v + b + grow), S(u - a - grow, v + b + grow)]
        ImageDraw.Draw(sh).polygon(pts, fill=int(255 * strength))
        self.floor_sh.alpha_composite(tint_layer(sh.filter(ImageFilter.GaussianBlur(9)), (70, 35, 30)))

    def round_shadow(self, x: float, y: float, w: float, strength: float = 0.35) -> None:
        sh = Image.new("L", self.img.size, 0)
        ImageDraw.Draw(sh).ellipse((x - w / 2, y - w / 4, x + w / 2, y + w / 4), fill=int(255 * strength))
        self.floor_sh.alpha_composite(tint_layer(sh.filter(ImageFilter.GaussianBlur(7)), (70, 35, 30)))

    def contour(self, img: Image.Image, tl: tuple[int, int]) -> np.ndarray:
        """Top edge of a placed sprite in scene columns (inf where it has no pixels)."""
        m = solid(img)
        top = np.where(m.any(0), m.argmax(0), 10 ** 6).astype(float)
        out = np.full(self.img.width, np.inf)
        xs = np.arange(img.width) + tl[0]
        ok = (xs >= 0) & (xs < self.img.width) & (top < 10 ** 6)
        out[xs[ok]] = top[ok] + tl[1]
        return out

    def person(self, who: str, facing: str) -> Image.Image:
        """facing: +v (down-left), +u (down-right), -u (up-left), -v (up-right)."""
        call, k = PEOPLE[who]
        front = facing in ("+v", "+u")
        img = load(self.root, call, f"{who}_q_{'front' if front else 'back'}")
        img = scaled(img, self.person_h * k / img.height)
        return ImageOps.mirror(img) if facing in ("+u", "-v") else img

    def hidden(self, who: str, facing: str, u: float, v: float, edge: np.ndarray, depth: float, seated: bool = True) -> None:
        """A person whose lower body is hidden: seated (hips on the seat at (u, v)) or standing behind a counter;
        everything below the occluder's top edge (+ margin), and below the hips when seated, is cut."""
        img = self.person(who, facing)
        m = solid(img)
        xs = np.nonzero(m.any(0))[0]
        cx = (xs.min() + xs.max()) / 2
        hips = int(img.height * HIPS)
        foot = int(np.nonzero(m.any(1))[0].max())
        x, y = self.g.S(u, v)
        tl = (int(round(x - cx)), int(round(y - self.seat_h - hips)) if seated else int(round(y - foot)))
        a = np.asarray(img).copy()
        cols = np.arange(img.width) + tl[0]
        lim = np.full(img.width, float(hips if seated else img.height))
        inside = (cols >= 0) & (cols < self.img.width)
        lim[inside] = np.minimum(lim[inside], edge[cols[inside]] + CUT_MARGIN - tl[1])
        if seated:  # columns cut flat at the hips with nothing in front: the body would look cut off in mid-air
            row = min(hips, img.height - 1)
            self.floating.append((who, int((solid(img)[row] & (lim >= hips)).sum())))
            self.heads.append((tl[0] + cx, tl[1] + float(np.nonzero(m.any(1))[0].min()), "seated"))
        a[np.arange(img.height)[:, None] > lim[None, :]] = 0
        out = Image.fromarray(a, "RGBA")
        self.items.append((out, tl[0], tl[1], depth))
        self.keep.append((solid(out), tl[0], tl[1], DINER_WEIGHT))

    def food(self, t: Table, u: float, v: float, diners: list[Diner], depth: float) -> None:
        dishes = place_dishes(u, v, t.a, t.b, diners)
        self.dishes += dishes
        for d in dishes:
            img = load(self.root, next(s for first, s in DISH_SHEETS if d.idx >= first), f"dish_{d.idx}")
            img = scaled(img, 2 * HX * math.sqrt(2) * d.r / img.width)  # a floor circle of radius r is 181*r px wide
            ys, xs = np.nonzero(solid(img))
            bx, by = (xs.min() + xs.max()) / 2, ys.max() - PLATE_BASE[d.idx] * img.width
            x, y = self.g.S(d.u, d.v)
            y -= t.h
            k = depth + 0.002 + (d.u + d.v - u - v + 4) * 0.0001
            self.dish_shadow(x, y, img.width * 0.85, k)
            tl = self.put(img, x - bx, y - by, k + 0.00005)
            self.keep.append((solid(img), tl[0], tl[1], 1.0))

    def dish_shadow(self, x: float, y: float, w: float, depth: float) -> None:
        h = max(4.0, w * 0.3)
        s = Image.new("L", (int(w) + 24, int(h) + 24), 0)
        ImageDraw.Draw(s).ellipse((12, 12, 12 + w, 12 + h), fill=85)
        self.put(tint_layer(s.filter(ImageFilter.GaussianBlur(4)), (70, 45, 35)), x - s.width / 2, y - s.height / 2 - 2, depth)

    # -- furniture groups -------------------------------------------------------------------------------------
    def booth(self, wall: str, s0: float, far: Seat, near: Seat) -> float:
        """One booth, its table's end against `wall` ("L": the left wall, u = 0, booths run along v; "R": the right
        wall, v = 0, booths run along u). s = position along the wall, t = distance from it. far / near = (who, main
        dish), or None for an empty seat. Returns where the booth ends along s."""
        bf, bk = self.bench_front, self.bench_back
        if wall == "R":
            bf, bk = mirror(bf), mirror(bk)
        ln = bf.a if wall == "L" else bf.b
        df, dk = (bf.b, bk.b) if wall == "L" else (bf.a, bk.a)

        def uv(s: float, t: float) -> tuple[float, float]:
            return (t, s) if wall == "L" else (s, t)

        tc = WALL_GAP + ln
        t = widen(self.booth_table, self.booth_table.a, TOP_HALF)  # drawn long side along u, as the left wall needs
        if wall == "R":
            t = mirror_table(t)
        gap = 2 * (TOP_HALF - OVERHANG)  # between the two seats' front edges
        s_far = s0 + df
        s_tab = s_far + df + gap / 2
        s_near = s_tab + gap / 2 + dk
        self.put_sprite(bf, *uv(s_far, tc), label="bench_front")
        u, v = uv(s_tab, tc)
        top_edge = self.contour(t.img, self.put_table(t, u, v, "booth_table"))
        back_edge = self.contour(bk.img, self.put_sprite(bk, *uv(s_near, tc), label="bench_back"))
        near_depth = sum(uv(s_near, tc))
        far_face, near_face = ("+v", "-v") if wall == "L" else ("+u", "-u")
        to_far = (0.0, -1.0) if wall == "L" else (-1.0, 0.0)
        diners: list[Diner] = []
        if far:
            fu, fv = uv(s_far + df * 0.35, tc)
            self.hidden(far[0], far_face, fu, fv, top_edge, fu + fv)
            diners.append((to_far, far[1], far[2]))
        if near:
            nu, nv = uv(s_near - dk * 0.35, tc)
            self.hidden(near[0], near_face, nu, nv, back_edge, min(nu + nv, near_depth - 0.01))
            diners.append(((-to_far[0], -to_far[1]), near[1], near[2]))
        self.food(t, u, v, diners, u + v)
        return s_near + dk

    def square(self, u: float, v: float, back: Seat, left: Seat, dirty: bool = False) -> None:
        """A free-standing square table with a stool on each side; diners only on the two far sides (at -v facing +v,
        at -u facing +u), so the top hides their legs; each sits SQUARE_SPREAD tiles from their edge's middle, away
        from the other (not huddled at the back corner). A near stool is left out when a diner sits on the same
        side of the screen behind the table (the -v diner is right of centre, like the +u stool; the -u diner left,
        like the +v stool): an empty stool under a seated diner makes them read as standing behind it. dirty: the
        diners have left (no one seated, all four stools out) but their dishes are still on the table, and the table
        gets a 執枱 marker (a table state, not a customer's bubble)."""
        t = widen(self.square_table, SQUARE_HALF, SQUARE_HALF)
        off = SQUARE_HALF + 0.45
        sit = SQUARE_HALF + SQUARE_SIT  # the diner leans in: closer than the stool, so the top hides more of them
        stools = [(SQUARE_SPREAD, -off), (-off, SQUARE_SPREAD)]
        if not left:
            stools.append((0.0, off))
        if not back:
            stools.append((off, 0.0))
        for du, dv in stools:
            self.put_sprite(self.stool, u + du, v + dv, 0.25, "stool")
        edge = self.contour(t.img, self.put_table(t, u, v, "square_table"))
        diners: list[Diner] = []
        if back:
            self.hidden(back[0], "+v", u + SQUARE_SPREAD, v - sit, edge, u + v - sit + 0.001)
            diners.append(((0.0, -1.0), back[1], back[2]))
        if left:
            self.hidden(left[0], "+u", u - sit, v + SQUARE_SPREAD, edge, u + v - sit + 0.002)
            diners.append(((-1.0, 0.0), left[1], left[2]))
        if dirty:  # the two who left: their plates and cups stay at their places
            diners = [((0.0, -1.0), *LEFTOVERS[0]), ((-1.0, 0.0), *LEFTOVERS[1])]
            x, y = self.g.S(u - t.a, v - t.b)  # the top's far corner: the marker stands clear of the dishes
            self.marks.append((x, y - t.h))
        self.food(t, u, v, diners, u + v)

    def counter_part(self, name: str, half_len: float, sheet: str = "I-COUNTER", drawn_deg: float = COUNTER_DRAWN_DEG) -> Sprite:
        """A counter-like part (drawn at drawn_deg, long side along u, front down-left), sheared so its long edges
        run at the grid's 26.6 degrees, scaled to half_len tiles, lifted to counter height and mirrored: long side
        along v, front +u."""
        img = pj.rectified(part_path(self.root, sheet, name), pj.shear_m(0.5 - math.tan(math.radians(drawn_deg))))
        sp = footprint(img)
        sp = resize(sp, half_len / sp.a)
        dz = int(round(self.back_h * COUNTER_TO_BACK - box_height(sp.img)))  # drawn long and low: lift the front faces
        return mirror(Sprite(raise_box(sp.img, dz), sp.fx, sp.fy + max(dz, 0), sp.a, sp.b))

    def counter(self, u: float, v0: float, cashier: str) -> tuple[float, float, tuple[float, float]]:
        """The cake cabinet, the cashier counter and the takeaway packing bench, in a line along v from v0 (their
        fronts face +u, the room's front right), the cashier behind the counter (smaller u) facing +u, cut by its top
        edge; no till on the top (it reads oddly there). Returns the floor point just past the packing bench's +v end,
        where the takeaway queue starts, and the paying customer's spot in front of the counter."""
        tk = self.counter_part("takeaway", TAKEAWAY_HALF, "B1-DEPT", DEPT_DRAWN_DEG)
        cake = self.counter_part("cake_case", CAKE_HALF)
        ctr = self.counter_part("counter", COUNTER_HALF)
        cv = v0 + cake.b
        cake_tl = self.put_sprite(cake, u, cv, 0.3, "cake_case")
        vc = v0 + 2 * cake.b + 0.25 + ctr.b
        tl = self.put_sprite(ctr, u, vc, 0.3, "counter")
        top_h = box_height(ctr.img)
        self.counter_h = top_h
        edge = np.minimum(self.contour(ctr.img, tl), self.contour(cake.img, cake_tl))
        cu, cvv = u - ctr.a - 0.75, vc  # behind the middle, clear of the queue at the +v end
        self.feet.append((cu - 0.35, cu + 0.35, cvv - 0.35, cvv + 0.35))
        self.hidden(cashier, "+u", cu, cvv, edge, min(cu + cvv, u + vc - 0.01), seated=False)
        tv = vc + ctr.b + 0.25 + tk.b
        self.put_sprite(tk, u, tv, 0.3, "takeaway")
        return u, tv + tk.b, (u + ctr.a + 1.6, vc - 1.0)  # in front of the counter: drawn after it (larger u + v), clear of the cashier

    def bar(self, v0: float, barman: str) -> float:
        """The drinks bar against the left wall from v0 along v, its front facing +u (into the room), the barman
        between it and the wall facing +u, cut by its top edge. Returns where it ends along v."""
        sp = self.counter_part("bar", BAR_HALF, "B1-DEPT", DEPT_DRAWN_DEG)
        bu, bv = WALL_GAP + 1.3 + sp.a, v0 + sp.b
        tl = self.put_sprite(sp, bu, bv, 0.3, "bar")
        mu = WALL_GAP + 0.65
        self.feet.append((0.0, mu + 0.35, bv - 0.35, bv + 0.35))
        self.hidden(barman, "+u", mu, bv - 0.3 * sp.b, self.contour(sp.img, tl), min(mu + bv, bu + bv - 0.01), seated=False)
        return v0 + 2 * sp.b

    def hatch(self, v: float) -> None:
        """The kitchen hatch set in the left wall, centred at v. B1-DEPT drew it in the right-hand wall's plane, so it
        is mirrored; its width spans HATCH_TILES of wall (plus the shelf's depth), its bottom HATCH_Z booth backs up."""
        img = ImageOps.mirror(load(self.root, "B1-DEPT", "pass"))
        img = scaled(img, (HATCH_TILES + 0.6) * HX / img.width)
        x, y = self.g.S(0, v)
        self.put(img, int(round(x - img.width / 2)), int(round(y - HATCH_Z * self.back_h - img.height)), -0.5)

    def wall_prop(self, call: str, name: str, wall: str, s: float, z: float, w: float) -> None:
        img = load(self.root, call, name)
        img = shear(scaled(img, w / img.width), 0.5 if wall == "R" else -0.5, 2 / math.sqrt(5))
        x, y = self.g.S(s, 0) if wall == "R" else self.g.S(0, s)
        self.baked.setdefault(name, Baked("wall", img, img.width / 2, img.height / 2, (0.0, 0.0), 0.0, 0.0, wall))
        self.put(img, x - img.width / 2, y - z - img.height / 2, -1.0)

    # -- standing people ----------------------------------------------------------------------------------------
    def clear(self, u: float, v: float, room: float) -> bool:
        return all(max(u0 - u, u - u1, 0.0) ** 2 + max(v0 - v, v - v1, 0.0) ** 2 >= room ** 2 for u0, u1, v0, v1 in self.feet)

    def cover(self, m: np.ndarray, tl: tuple[int, int]) -> int:
        """Weighted px of diners and food (1.0) and furniture (FURNITURE_WEIGHT) that a standing silhouette m at tl
        would overlap on screen, whichever is drawn in front: both make the depth hard to read."""
        tot = 0.0
        h, w = m.shape
        for om, ox, oy, wt in self.keep:
            x0, y0 = max(tl[0], ox), max(tl[1], oy)
            x1, y1 = min(tl[0] + w, ox + om.shape[1]), min(tl[1] + h, oy + om.shape[0])
            if x1 > x0 and y1 > y0:
                tot += wt * float((m[y0 - tl[1]:y1 - tl[1], x0 - tl[0]:x1 - tl[0]] & om[y0 - oy:y1 - oy, x0 - ox:x1 - ox]).sum())
        return int(tot)

    def spot_costs(self, who: str, facing: str, spots: list[tuple[float, float]], room: float = 0.75) -> list[tuple[float, float, int]]:
        """(u, v, weighted px hidden) for every spot whose feet are clear of every footprint by `room` tiles."""
        m = solid(self.person(who, facing))
        ys, xs = np.nonzero(m)
        fx, fy = (xs.min() + xs.max()) / 2, float(ys.max())
        out: list[tuple[float, float, int]] = []
        for u, v in spots:
            if self.clear(u, v, room):
                x, y = self.g.S(u, v)
                out.append((u, v, self.cover(m, (int(round(x - fx)), int(round(y - fy))))))
        return out

    def stander(self, who: str, facing: str, spots: list[tuple[float, float]], room: float = 0.75, role: str = "") -> tuple[float, float, int]:
        """Stand at the spot whose feet are clear of every footprint by `room` tiles and whose silhouette hides the
        fewest px of diners and food (only what is drawn behind it counts); returns (u, v, px hidden). A customer
        (role "queue", "takeaway" or "walker"; staff have none) gets a status-bubble anchor at the head."""
        costs = self.spot_costs(who, facing, spots, room)
        if not costs:
            raise ValueError(f"no clear spot for {who}")
        best = min(costs, key=lambda s: s[2])
        u, v, _ = best
        img = self.person(who, facing)
        m = solid(img)
        ys, xs = np.nonzero(m)
        fx, fy = (xs.min() + xs.max()) / 2, float(ys.max())
        x, y = self.g.S(u, v)
        tl = self.put(img, x - fx, y - fy, u + v)
        self.keep.append((m, tl[0], tl[1], 1.0))
        self.round_shadow(x, y, img.width * 0.75)
        self.feet.append((u - 0.35, u + 0.35, v - 0.35, v + 0.35))
        if role:
            self.heads.append((tl[0] + fx, tl[1] + float(ys.min()), role))
        return best

    def render(self) -> Image.Image:
        img = self.img
        img.alpha_composite(self.floor_sh)
        for spr, x, y, _ in sorted(self.items, key=lambda it: it[3]):
            paste_clip(img, spr, x, y)
        return img


def paste_clip(dst: Image.Image, spr: Image.Image, x: int, y: int) -> None:
    cx0, cy0 = max(0, -x), max(0, -y)
    if cx0 >= spr.width or cy0 >= spr.height:
        return
    dst.alpha_composite(spr.crop((cx0, cy0, spr.width, spr.height)), (x + cx0, y + cy0))


# Status bubbles. The floor is the
# order-taker's screen: only customers who need the waiter right now show a bubble (about a third at any moment), plus
# a 執枱 marker on a dirty table. Each bubble is small and icon-led (an icon over a 2-character label) with a short tail
# straight down at the head; what must be 48 pt is the tap target, an invisible square centred on the bubble. Game
# scale: a portrait phone (390 pt wide) shows the game's 9 x 9-unit shop, about 36 tiles of (u - v) here (one game
# unit is about 2 tiles: booths 3.5 units apart there, 6.8 tiles here), so 1 pt = 2304 / 390 = 5.9 scene px.
PHONE_PT, PHONE_TILES = 390, 36.0
PT_PX = PHONE_TILES * HX / PHONE_PT  # scene px per pt
HIT_PT, DRAWN_PT, LABEL_PT = 48, 38, 13.5  # the tap target, the drawn card's width and its label's size, pt
HIT_PX, DRAWN_PX = round(HIT_PT * PT_PX), round(DRAWN_PT * PT_PX)  # 260 and 130 scene px
TAIL_PX, HEAD_GAP = 36, 8  # the tail's length, and the gap between its tip and the head, px
FACE_HALF_W, FACE_H = 31, 57  # the face zone below a head top that no card may cover, px
ACTION_SHARE = 0.35  # the share of customers who need the waiter at the sampled moment
NEEDS = {"order": ("落單", (236, 150, 64)), "bill": ("埋單", (96, 168, 112)), "seat": ("帶位", (84, 140, 204)),
         "takeaway": ("外賣", (204, 112, 160)), "clear": ("執枱", (150, 146, 140))}
# a bold CJK font for the bubble labels and room signs (preview pictures only; the atlas export draws no text).
# Set CJK_FONT to a .ttf/.ttc path; without one, Pillow's default font is used and CJK labels may not render.
FONT = os.environ.get("CJK_FONT", "")
Box = tuple[float, float, float, float]  # x0, y0, x1, y1, scene px


class Bubble(NamedTuple):
    box: Box  # the drawn bubble
    hit: Box  # the invisible tap target, HIT_PX square
    anchor: tuple[float, float]  # the head top (or the dirty table's top) the tail points at
    need: str  # a key of NEEDS


class BubbleCrowding(ValueError):
    def __init__(self, index: int, msg: str) -> None:
        super().__init__(msg)
        self.index = index  # the anchor to give more room to (a seated customer whenever one is involved)


def apart(a: Box, b: Box, gap: float) -> bool:
    return a[2] + gap <= b[0] or b[2] + gap <= a[0] or a[3] + gap <= b[1] or b[3] + gap <= a[1]


def spot_hash(x: float, y: float) -> int:
    return (int(round(x)) * 73856093 ^ int(round(y)) * 19349663) % 1000003


Head = tuple[float, float, str]  # a customer's head top (x, y) and role: "seated", "queue", "takeaway" or "walker"
Call = tuple[list[int], str]  # one bubble: the party's members (indices into the heads) and what they need


def parties(heads: list[Head], party: list[int]) -> list[list[int]]:
    """The heads grouped by party (customers at one table share a party id; each stander is a party of one)."""
    out: dict[int, list[int]] = {}
    for i, p in enumerate(party):
        out.setdefault(p, []).append(i)
    return list(out.values())


def needs_now(heads: list[Head], party: list[int], share: float = ACTION_SHARE) -> list[Call]:
    """Who needs the waiter at the sampled moment. A table's party orders and pays together, so it has one bubble
    (as the game draws one per table); round(share x parties) of the parties need the waiter, picked by a fixed hash
    of their first member's head (so the pick barely moves when another seat is emptied). Seated parties want to order
    or to pay (alternately, left to right), walkers to be seated, the till queue to pay, the customer at the packing bench a takeaway."""
    groups = parties(heads, party)
    k = round(share * len(groups))
    pick = sorted(sorted(groups, key=lambda g: spot_hash(heads[g[0]][0], heads[g[0]][1]))[:k], key=lambda g: heads[g[0]][0])
    kind = {"walker": "seat", "queue": "bill", "takeaway": "takeaway"}
    out: list[Call] = []
    for g in pick:
        seated = sum(1 for _, n in out if n in ("order", "bill"))
        out.append((g, kind.get(heads[g[0]][2]) or ("order", "bill")[seated % 2]))
    return out


def bubble_at(x: float, y: float, need: str) -> Bubble:
    """The bubble straight above an anchor: the tail's tip HEAD_GAP above it, the tap target centred on the bubble."""
    h = DRAWN_PX * 1.05
    bottom = y - HEAD_GAP - TAIL_PX
    box = (x - DRAWN_PX / 2, bottom - h, x + DRAWN_PX / 2, bottom)
    cy = bottom - h / 2
    return Bubble(box, (x - HIT_PX / 2, cy - HIT_PX / 2, x + HIT_PX / 2, cy + HIT_PX / 2), (x, y), need)


def bubble_fault(b: Bubble, out: list[Bubble], faces: list[tuple[float, float]], width: int) -> str:
    """Why bubble b breaks place_bubbles' rules next to the bubbles already placed ("" when it does not)."""
    name = NEEDS[b.need][0]
    if b.hit[0] < 0 or b.hit[1] < 0 or b.hit[2] > width:
        return f"the {name} bubble at ({b.anchor[0]:.0f}, {b.anchor[1]:.0f}) leaves the picture"
    for o in out:
        if not apart(b.hit, o.hit, 0):
            return f"the {name} and {NEEDS[o.need][0]} tap targets overlap"
    for fx, fy in faces:
        if (fx, fy) != b.anchor and not apart(b.box, (fx - FACE_HALF_W, fy, fx + FACE_HALF_W, fy + FACE_H), 0):
            return f"the {name} bubble at ({b.anchor[0]:.0f}, {b.anchor[1]:.0f}) hides a face"
    return ""


def place_bubbles(calls: list[list[tuple[float, float, str]]], faces: list[tuple[float, float]], width: int) -> list[Bubble]:
    """One bubble per call, straight above one of its candidate anchors (a party's members, front first; a table
    marker has one): no sideways shift, no long leader. Rules: every tap target lies inside the picture and overlaps
    no other; no drawn bubble hides a face (faces: every customer's head top, bubbling or not). Raises BubbleCrowding
    naming the first call none of whose anchors fits, so the layout can give it more room."""
    out: list[Bubble] = []
    for i, anchors in enumerate(calls):
        fits = [b for b in (bubble_at(*a) for a in anchors) if not bubble_fault(b, out, faces, width)]
        if not fits:
            raise BubbleCrowding(i, bubble_fault(bubble_at(*anchors[0]), out, faces, width) + ": the layout must give it more room")
        out.append(fits[0])
    return out


def calls_of(heads: list[Head], now: list[Call], marks: list[tuple[float, float]]) -> list[list[tuple[float, float, str]]]:
    """place_bubbles' input for a moment: each party's members front first (larger y), then each dirty table's mark."""
    return ([[(heads[i][0], heads[i][1], need) for i in sorted(g, key=lambda i: -heads[i][1])] for g, need in now]
            + [[(x, y, "clear")] for x, y in marks])


def bubble_odds(heads: list[Head], party: list[int], marks: list[tuple[float, float]], width: int, trials: int = 400,
                share: float = ACTION_SHARE) -> float:
    """The share of random moments (a random `share` of the parties needing the waiter, plus the table marks) whose
    bubbles all obey place_bubbles' rules on this layout."""
    import random  # noqa: PLC0415 - only this estimate needs it

    rng = random.Random(1)
    faces = [(x, y) for x, y, _ in heads]
    groups = parties(heads, party)
    ok = 0
    for _ in range(trials):
        now = [(g, "order") for g in rng.sample(groups, round(share * len(groups)))]
        try:
            place_bubbles(calls_of(heads, now, marks), faces, width)
            ok += 1
        except BubbleCrowding:
            pass
    return ok / trials


def draw_icon(d: ImageDraw.ImageDraw, need: str, cx: float, cy: float, s: float, ink: tuple[int, int, int]) -> None:
    """A small flat icon, s px across, centred at (cx, cy): notepad (order), coin (bill), chair (seat), bag
    (takeaway), sparkle and cloth (clear)."""
    w = max(3, int(s * 0.07))
    if need == "order":
        d.rounded_rectangle((cx - s * 0.32, cy - s * 0.42, cx + s * 0.28, cy + s * 0.42), radius=s * 0.06, fill=(255, 255, 255), outline=ink, width=w)
        for k in range(3):
            yy = cy - s * 0.18 + k * s * 0.18
            d.line((cx - s * 0.2, yy, cx + s * 0.14, yy), fill=ink, width=w)
        d.line((cx + s * 0.14, cy + s * 0.36, cx + s * 0.44, cy - s * 0.1), fill=(230, 170, 40), width=w * 2)
    elif need == "bill":
        d.ellipse((cx - s * 0.42, cy - s * 0.42, cx + s * 0.42, cy + s * 0.42), fill=(248, 206, 72), outline=ink, width=w)
        d.text((cx, cy + s * 0.02), "$", fill=ink, anchor="mm", font=bubble_font(int(s * 0.6)))
    elif need == "seat":  # a padded chair, side on, with an arrow into it
        red = (206, 60, 60)
        d.line((cx - s * 0.3, cy + s * 0.08, cx - s * 0.3, cy + s * 0.44), fill=ink, width=w)
        d.line((cx + s * 0.22, cy + s * 0.08, cx + s * 0.22, cy + s * 0.44), fill=ink, width=w)
        d.rounded_rectangle((cx - s * 0.38, cy - s * 0.42, cx - s * 0.18, cy + s * 0.1), radius=s * 0.06, fill=red, outline=ink, width=w)
        d.rounded_rectangle((cx - s * 0.38, cy - s * 0.04, cx + s * 0.3, cy + s * 0.12), radius=s * 0.05, fill=red, outline=ink, width=w)
        d.line((cx + s * 0.44, cy - s * 0.36, cx + s * 0.06, cy - s * 0.14), fill=ink, width=w)
        d.polygon([(cx - s * 0.02, cy - s * 0.1), (cx + s * 0.14, cy - s * 0.26), (cx + s * 0.18, cy - s * 0.04)], fill=ink)
    elif need == "takeaway":
        d.rectangle((cx - s * 0.34, cy - s * 0.18, cx + s * 0.34, cy + s * 0.42), fill=(250, 246, 236), outline=ink, width=w)
        d.arc((cx - s * 0.2, cy - s * 0.48, cx + s * 0.2, cy - s * 0.02), 180, 360, fill=ink, width=w)
    else:  # a plate with crumbs, a cloth wiping across it, sparkles
        d.ellipse((cx - s * 0.44, cy - s * 0.02, cx + s * 0.3, cy + s * 0.36), fill=(255, 255, 255), outline=ink, width=w)
        for px, py in ((-0.2, 0.14), (-0.04, 0.2), (0.1, 0.12)):
            d.ellipse((cx + s * px - w, cy + s * py - w, cx + s * px + w, cy + s * py + w), fill=(170, 110, 60))
        d.polygon([(cx - s * 0.02, cy - s * 0.2), (cx + s * 0.38, cy - s * 0.3), (cx + s * 0.46, cy + s * 0.04), (cx + s * 0.06, cy + s * 0.14)],
                  fill=(110, 180, 210), outline=ink)
        for sx, sy, r in ((cx - s * 0.22, cy - s * 0.26, s * 0.18), (cx + s * 0.4, cy + s * 0.32, s * 0.1)):
            d.polygon([(sx, sy - r), (sx + r * 0.3, sy - r * 0.3), (sx + r, sy), (sx + r * 0.3, sy + r * 0.3), (sx, sy + r),
                       (sx - r * 0.3, sy + r * 0.3), (sx - r, sy), (sx - r * 0.3, sy - r * 0.3)], fill=(250, 220, 90), outline=ink)


def bubble_font(px: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return ImageFont.truetype(FONT, px) if FONT else ImageFont.load_default(px)


def draw_bubbles(img: Image.Image, bubbles: list[Bubble], show_hit: bool = False) -> None:
    """Each bubble: a rounded card in its need's colour band, the icon over the label, a short tail straight down.
    show_hit outlines the invisible tap targets (dashed), for a debug picture."""
    d = ImageDraw.Draw(img)
    font = bubble_font(round(LABEL_PT * PT_PX))
    ink, paper = (44, 26, 40), (252, 250, 242)
    for b in bubbles:
        x0, y0, x1, y1 = b.box
        ax = b.anchor[0]
        if show_hit:
            hx0, hy0, hx1, hy1 = b.hit
            for t in range(0, int(hx1 - hx0), 24):
                d.line((hx0 + t, hy0, min(hx0 + t + 12, hx1), hy0), fill=ink, width=3)
                d.line((hx0 + t, hy1, min(hx0 + t + 12, hx1), hy1), fill=ink, width=3)
            for t in range(0, int(hy1 - hy0), 24):
                d.line((hx0, hy0 + t, hx0, min(hy0 + t + 12, hy1)), fill=ink, width=3)
                d.line((hx1, hy0 + t, hx1, min(hy0 + t + 12, hy1)), fill=ink, width=3)
        d.polygon([(ax - 24, y1 - 6), (ax + 24, y1 - 6), (ax, y1 + TAIL_PX)], fill=paper, outline=ink, width=7)
        d.rounded_rectangle(b.box, radius=DRAWN_PX * 0.16, fill=paper, outline=ink, width=8)
        d.rounded_rectangle((x0 + 8, y0 + 8, x1 - 8, y0 + 8 + (y1 - y0) * 0.08), radius=8, fill=NEEDS[b.need][1])
        d.polygon([(ax - 16, y1 - 10), (ax + 16, y1 - 10), (ax, y1 + 12)], fill=paper)
        draw_icon(d, b.need, ax, y0 + (y1 - y0) * 0.4, DRAWN_PX * 0.5, ink)
        d.text((ax, y0 + (y1 - y0) * 0.8), NEEDS[b.need][0], font=font, fill=ink, anchor="mm")


def compose(root: Path) -> Image.Image:
    """The small test floor (1170 x 780): two booths on the right-hand wall, one on the left, two walkers."""
    sc = Scene(root, SMALL)
    s = sc.booth("R", 0.3, ("worker", 0, DRINK), ("office_lady", 1, DRINK))
    end = sc.booth("R", s + 0.05, ("office_lady", 3, DRINK), ("worker", 4, DRINK))
    corner = WALL_GAP + 2 * sc.bench_front.a + 1.0
    sc.booth("L", corner, ("housewife", 2, DRINK), ("waiter", 1, DRINK))
    hi = sc.back_h + 150
    sc.wall_prop("F-FURN", "clock", "L", corner + 2.2, hi, 140)
    sc.wall_prop("F-FURN", "sign", "R", s - 0.2, hi + 40, 380)
    sc.wall_prop("F-FURN", "tv", "R", end - 1.6, hi, 200)
    lane = [(float(u), float(v)) for u in np.arange(6.0, 14.0, 0.5) for v in np.arange(6.0, 14.0, 0.5)]
    sc.stander("housewife", "+v", lane, 0.4)
    sc.stander("waiter", "-u", lane, 0.4)
    return scaled(sc.render(), DEVICE_W / SMALL.w)


FLOOR_W = 2880  # the whole-floor picture's width (3840 x 2560 scene -> 2880 x 1920)
# which seats are taken (far, near) / (back, left); the people and food are assigned by assign_seats()
R_BOOTHS = [(True, True), (True, False), (True, True), (False, True)]
L_BOOTHS = [(True, True), (True, True)]  # then the drinks bar
SQUARES = {(0, 0): (True, True), (1, 0): (False, True), (0, 1): (False, True), (1, 1): (True, True), (0, 2): (True, True),
           (1, 2): (True, False)}  # column 2 holds the cake cabinet, the counter and the queue
DIRTY = (1, 2)  # the square whose diners have just left: dishes on the table, no one seated, a 執枱 marker
NEIGHBOUR = 9.5  # tiles between table centres within which no customer type repeats


class SeatSlot(NamedTuple):
    table: int
    centre: tuple[float, float]


def assign_seats(slots: list[SeatSlot]) -> list[Seat]:
    """Customers for the taken seats: no type twice at one table or at a neighbouring table (centres within NEIGHBOUR
    tiles), the least-used type first so all seven appear about equally; mains and drinks rotate, a table's two diners
    never share a main. A seat with no allowed type stays empty."""
    used = dict.fromkeys(CUSTOMERS, 0)
    out: list[Seat] = []
    k_main = k_drink = 0
    for sl in slots:
        near_types = {s[0] for j, s in enumerate(out) if s is not None
                      and (slots[j].table == sl.table or math.dist(slots[j].centre, sl.centre) <= NEIGHBOUR)}
        options = sorted((w for w in CUSTOMERS if w not in near_types), key=lambda w: (used[w], CUSTOMERS.index(w)))
        if not options:
            out.append(None)
            continue
        who = options[0]
        used[who] += 1
        mate = {s[1] for j, s in enumerate(out) if s is not None and slots[j].table == sl.table}
        main = MAINS[k_main % len(MAINS)]
        while main in mate:
            k_main += 1
            main = MAINS[k_main % len(MAINS)]
        k_main += 1
        out.append((who, main, DRINKS[k_drink % len(DRINKS)]))
        k_drink += 1
    return out


def compose_floor(root: Path, theme: str = "plain", bubbles: bool = False) -> tuple[Image.Image, list[str]]:
    """The whole floor (2880 x 1920), a room of about 30 x 30 tiles: four booths along the right-hand wall, three
    along the left, six square tables in the middle, and along the front-right column the cake cabinet and the cashier
    counter, the queue lined up past its near end; a waiter and two customers walk the aisles. Seven customer types,
    no type twice at one table or a neighbouring one; some seats empty, as in a real shop. theme: the walls and floor
    (THEMES). bubbles (with square DIRTY a table whose diners have left): the status bubbles of one sampled moment
    (needs_now: about a third of the customers, plus the dirty table's 執枱 marker), placed by place_bubbles, with
    their tap targets outlined (show_hit). Returns the picture and a log (who sits where, standers and how much they
    overlap, mid-air cuts; with bubbles, who needs what and how many customers one phone screen holds).

    With bubbles, the floor gives a crowded customer more room by leaving their seat empty and composing again, until
    the moment's bubbles fit; the log names the seats left empty (fewer customers per area is the room bubbles need)."""
    empty: set[int] = set()
    while True:
        sc, log = build_floor(root, theme, empty, DIRTY if bubbles else None)
        img = sc.render()
        if not bubbles:
            return scaled(img, FLOOR_W / LARGE.w), log
        now = needs_now(sc.heads, sc.party)
        calls = calls_of(sc.heads, now, sc.marks)
        seated = [i for i, h in enumerate(sc.heads) if h[2] == "seated"]
        try:
            placed = place_bubbles(calls, [(x, y) for x, y, _ in sc.heads], LARGE.w)
        except BubbleCrowding as e:
            if not seated:
                raise
            hx, hy, _ = calls[e.index][0]  # a party's front member; for a stander or a table, the nearest seat goes
            k = min(seated, key=lambda i: math.hypot(sc.heads[i][0] - hx, sc.heads[i][1] - hy))
            taken = [i for i in range(len(sc.slots)) if i not in empty]
            empty.add(taken[seated.index(k)])
            log.append(f"crowding: {e}; seat {taken[seated.index(k)]} left empty")
            continue
        draw_bubbles(img, placed, show_hit=True)
        xs = sorted(x for x, _, _ in sc.heads)
        screen = PHONE_TILES * HX  # one portrait phone's width in scene px; it shows the full height
        per_screen = max(sum(1 for x in xs if a <= x < a + screen) for a in xs)
        groups = parties(sc.heads, sc.party)
        log.append(f"bubbles: {len(now)} of {len(groups)} parties ({sum(len(g) for g, _ in now)} of {len(sc.heads)} customers) "
                   "need the waiter (" + ", ".join(f"{NEEDS[n][0]} {sum(1 for _, m in now if m == n)}" for n in NEEDS if n != "clear")
                   + f") + {len(sc.marks)} 執枱; drawn {DRAWN_PX} px ({DRAWN_PT} pt), tap targets {HIT_PX} px ({HIT_PT} pt), none "
                   f"overlapping; {len(empty)} seats left empty to make room")
        log.append(f"per phone screen ({screen:.0f} px wide): at most {per_screen} customers; random moments with "
                   f"{ACTION_SHARE:.0%} of parties needing the waiter that fit: {bubble_odds(sc.heads, sc.party, sc.marks, LARGE.w):.0%}")
        busiest = max(range(0, LARGE.w - int(screen) + 1, 16), key=lambda a: (
            sum(1 for b in placed if a <= b.box[0] and b.box[2] <= a + screen), sum(1 for x in xs if a <= x < a + screen)))
        log.append(f"phone window x {busiest}")
        return scaled(img, FLOOR_W / LARGE.w), log


IPHONE_PT = (390, 844)  # a portrait iPhone's screen, pt (drawn at 3x)


def phone_view(floor: Image.Image, x0: float) -> Image.Image:
    """A 1:1 iPhone-size picture (390 x 844 pt at 3x = 1170 x 2532 px) of the whole floor picture (FLOOR_W wide)
    from scene x x0: one phone screen's width of the floor (PHONE_TILES tiles) fills the width; the rest of the screen,
    which the game's other controls would use, stays a plain backdrop. Shown 390 CSS px wide, it is real size."""
    w, h = IPHONE_PT[0] * 3, IPHONE_PT[1] * 3
    k = FLOOR_W / LARGE.w
    crop = floor.crop((round(x0 * k), 0, round((x0 + PHONE_TILES * HX) * k), floor.height)).convert("RGB")
    crop = crop.resize((w, round(crop.height * w / crop.width)), Image.Resampling.LANCZOS)
    out = Image.new("RGB", (w, h), (40, 34, 38))
    out.paste(crop, (0, (h - crop.height) // 2))
    return out


def build_floor(root: Path, theme: str, empty: set[int], dirty: tuple[int, int] | None = None) -> tuple[Scene, list[str]]:
    """compose_floor's scene, with the occupied seats listed in `empty` (indices into the taken seats) left empty, and the square `dirty` (if any) a table whose diners have left."""
    sc = Scene(root, LARGE, theme)
    bf, bk = sc.bench_front, sc.bench_back
    reach = WALL_GAP + 2 * bf.a  # how far a booth reaches into the room
    tc = WALL_GAP + bf.a
    gap = 2 * (TOP_HALF - OVERHANG)
    blen = 2 * bf.b + gap + 2 * bk.b + 0.05  # one booth along its wall
    sq = SQUARE_HALF + 0.45 + max(sc.stool.a, sc.stool.b)  # a square table's reach from its centre, stools included
    mid = reach + AISLE + sq
    step = 2 * sq + AISLE

    def cell(i: int, j: int) -> tuple[float, float]:
        return mid + i * step, mid + j * step

    tables: list[tuple[str, float, tuple[float, float], tuple[bool, bool]]] = []  # kind, s0 or 0, centre, taken
    for i, taken in enumerate(R_BOOTHS):
        s0 = 0.3 + i * blen
        tables.append(("R", s0, (s0 + 2 * bf.b + gap / 2, tc), taken))
    for i, taken in enumerate(L_BOOTHS):
        s0 = reach + AISLE + i * blen
        tables.append(("L", s0, (tc, s0 + 2 * bf.b + gap / 2), taken))
    for (i, j), taken in SQUARES.items():
        tables.append(("D", 0.0, cell(i, j), (False, False)) if (i, j) == dirty else ("S", 0.0, cell(i, j), taken))
    slots = [SeatSlot(t, tables[t][2]) for t in range(len(tables)) for k in range(2) if tables[t][3][k]]
    sc.slots = slots
    kept = iter(assign_seats([s for i, s in enumerate(slots) if i not in empty]))
    assigned = [None if i in empty else next(kept) for i in range(len(slots))]
    seats = iter(assigned)
    log: list[str] = []
    where: list[tuple[str, tuple[float, float]]] = []  # each seated customer's type and table centre
    for t, (kind, s0, (u, v), (far, near)) in enumerate(tables):
        a = next(seats) if far else None
        b = next(seats) if near else None
        where += [(s[0], (u, v)) for s in (a, b) if s is not None]
        log.append(f"{kind} ({u:.1f}, {v:.1f}): {a} / {b}")
        if kind in "SD":
            sc.square(u, v, a, b, kind == "D")
        else:
            sc.booth(kind, s0, a, b)
        sc.party += [t] * (len(sc.heads) - len(sc.party))
    seated = [s[0] for s in assigned if s is not None]
    cu = cell(2, 0)[0]
    qu, qv, till = sc.counter(cu, mid - sq + 1.0, "cashier")
    log.append(f"counter top {sc.counter_h:.0f} px above the floor = {sc.counter_h / sc.back_h:.2f} x a booth back")
    bar_end = sc.bar(reach + AISLE + len(L_BOOTHS) * blen + 0.3, "barman")
    sc.hatch(reach + AISLE / 2)
    hi = sc.back_h + 170
    sc.wall_prop("F-FURN", "sign", "R", 7.5, hi + 40, 420)
    sc.wall_prop("F-FURN", "clock", "R", 15.5, hi, 150)
    sc.wall_prop("F-FURN", "tv", "R", 0.3 + 4 * blen - 3.5, hi, 210)
    sc.wall_prop("F-FURN", "clock", "L", reach + AISLE + 3.5, hi, 150)
    sc.wall_prop("F-FURN", "sign", "L", reach + AISLE + 12.0, hi + 40, 380)
    count = {w: seated.count(w) for w in CUSTOMERS}

    def far_from_twin(who: str, p: tuple[float, float]) -> bool:  # no one of the same type seated or standing nearby
        return all(w != who or math.dist(p, c) > STANDER_APART for w, c in where)

    by_count = sorted(CUSTOMERS, key=lambda w: (count[w], CUSTOMERS.index(w)))  # the least-seen types stand
    lines = [(till, "-u", "queue")]  # paying at the counter, facing the cashier
    lines += [((qu + 0.15, qv + QUEUE_FIRST + QUEUE_GAP * i), "-v", "takeaway") for i in range(2)]  # the takeaway queue
    for i, (p, facing, role) in enumerate(lines):
        who = next((w for w in by_count if far_from_twin(w, p)), by_count[0])
        by_count.remove(who)
        u, v, c = sc.stander(who, facing, [p], 0.3, role)
        where.append((who, p))
        log.append(f"{role} {i + 1} {who} ({u:.1f}, {v:.1f}) overlaps {c}" + ("  COVERS A PERSON" if c >= DINER_WEIGHT * TOUCH_PX else ""))
    log.append(f"drinks bar along the left wall to v {bar_end:.1f}; kitchen hatch in the left wall at v {reach + AISLE / 2:.1f}")
    # walkers: on the aisles (between the booth rows and the tables, between the tables) or the open floor in front,
    # clear of the queue and of each other; the type and spot are picked together: never covering a diner, then as
    # far as possible (up to STANDER_APART) from anyone of the same type, then hiding the least
    rng = [float(x) for x in np.arange(reach + 1.0, 32.0, 0.5)]
    lanes = [reach + AISLE / 2] + [mid + sq + AISLE / 2 + k * step for k in range(2)]
    front = [(float(a), float(b)) for a in np.arange(6.0, 30.0, 0.5) for b in np.arange(6.0, 34.0, 0.5) if 40.0 <= a + b <= 52.0]
    floor_spots = [(lane, x) for lane in lanes for x in rng] + [(x, lane) for lane in lanes for x in rng] + front
    up = [c for _, c in where[-3:]]  # the queue, then each walker placed
    up += [(qu, qv - k) for k in (2.0, 6.0, 10.0, 14.0)]  # the counter, cake cabinet and packing bench: walkers keep off
    where.append(("waiter", (qu, qv - 8.0)))  # the cashier: the walking waiter keeps away from the counter

    def twin(who: str, p: tuple[float, float]) -> float:
        return min([STANDER_APART] + [math.dist(p, c) for w, c in where if w == who])

    for facing in ("+v", "-u", "+u"):
        spots = [p for p in floor_spots if all(math.dist(p, q) > QUEUE_CLEAR for q in up)]
        options = ["waiter"] if facing == "-u" else by_count
        lim = DINER_WEIGHT * TOUCH_PX
        scored = [(c >= lim, c if c >= lim else 0, -round(twin(w, (u, v))), c, k, w, (u, v)) for k, w in enumerate(options)
                  for u, v, c in sc.spot_costs(w, facing, spots)]
        *_, who, p = min(scored)
        if who != "waiter":
            by_count.remove(who)
        u, v, c = sc.stander(who, facing, [p], role="" if who == "waiter" else "walker")
        where.append((who, (u, v)))
        up.append((u, v))
        log.append(f"walker {who} ({u:.1f}, {v:.1f}) overlaps {c}" + ("  COVERS A PERSON" if c >= DINER_WEIGHT * TOUCH_PX else ""))
    sc.party += range(len(tables) + len(sc.party), len(tables) + len(sc.heads))  # each stander is a party of one
    log.append("seated per type: " + ", ".join(f"{w} {n}" for w, n in count.items()))
    log.append("seated diners cut in mid-air (px columns): " + ", ".join(f"{w} {n}" for w, n in sc.floating))
    return sc, log
