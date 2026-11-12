"""The shop as a dining hall with department rooms beside it, Sims-style cutaway. Each department is its own small
room next to the hall, with real working room for a person:

  - the building is a rectangle on the same 2:1 grid as compose_iso2 (u along the right-hand back wall, v along the
    left-hand one). The two back walls stay full height; every other wall is cut down to a stub (the Sims cutaway),
    so the rooms read as rooms and we still see inside;
  - a strip of rooms runs along the right-hand back wall (v < STRIP): kitchen, roast-meat room, drinks bar, in that
    order, each with its own floor and wall finish, cut partitions between them, and a doorway or opening into the
    hall: the kitchen's pass shelf, the roast room's door, the bar counter set into the partition;
  - the hall (v > STRIP): booths along the left-hand wall, square tables, and by the entrance (a gap in the cut front
    wall) the cake cabinet and the cashier counter;
  - the roast room's glass case stands at its front with the cook behind it; a takeaway room by the entrance,
    whose pending orders show as bag cards over its bench; outside, a plain street (pavement, kerb, road) and a pale
    backdrop of blocks above the back walls, checked to stay below the floor's saturation and contrast;
  - modular: compose_rooms(rooms=...) takes any subset of the rooms in any order (an early level has no roast room).

The rooms' equipment, decor and both cooks are the room art sheets (R-KITCHEN, R-ROAST, R-BAR-TA, R-DECOR, R-COOKS;
cut and measured by cut_sheet.py): boxy parts are sheared from the angle they were drawn at to the grid's 26.6
degrees, flat wall parts are sheared onto the back walls. Only the walls, floors, the street and the backdrop are
code-drawn. style_strip() lays the new parts beside the reference ones at the scene's scale, for judging by eye.

Bubbles: overlaps are solved by distance, not by holding bubbles back. Tables are spaced so that, with
every party calling at once, no two tap targets overlap and no bubble hides a face: bubble_clashes() must be empty,
which makes every moment fit (100%), whatever share of the floor needs the waiter.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import NamedTuple

import numpy as np
from PIL import Image, ImageDraw

import compose_iso2 as c2
import projection as pj
from compose_base import scaled
from compose_iso2 import HX, HY, Grid, Rect, Scene

STRIP = 10.5  # tiles: the rooms' depth from the right-hand back wall (about 3.4 m at 3.1 tiles a metre)
WALL_T = 0.4  # tiles: a wall's thickness
STUB = 0.30  # a cut-down wall's height, x a booth back
DOOR = 3.2  # tiles: a doorway (about 1 m)
# tiles along u; 0: the rest. The sink room is as wide as the roast room, so swapping one for the other leaves the
# takeaway room (and its shelf, sized to it) exactly as the projection gate passed it
ROOM_W = {"kitchen": 12.5, "lunch_kitchen": 12.5, "wash": 10.5, "roast": 10.5, "bar": 8.0, "takeaway": 0.0}
ROOM_ZH = {"kitchen": "廚房", "lunch_kitchen": "廚房", "wash": "洗碗", "roast": "燒味", "bar": "水吧", "takeaway": "外賣"}
WALL_TOP = 2.9  # the back walls' height, x a booth back (about 2.7 m); the street backdrop shows above them
PAVE, KERB, ROAD = 3.5, 0.35, 7.0  # tiles: the pavement along the shop front, the kerb, the road
SHOW_ORDERS = 3  # pending takeaway orders drawn over the packing bench (one bag card each, in a row)
MAX_ROW = 3  # more orders than this: the last card carries a "+n" badge
# spacing that keeps every pair of bubbles apart (tuned with bubble_clashes; compose_iso2 used AISLE 3.0 everywhere)
SIDE_AISLE = 6.0  # tiles between the booths' front and the first square column's stools
ROW_AISLE = 5.0  # tiles between square tables (stool to stool), both ways
BACK_AISLE = 4.0  # tiles from the rooms' partition to the first square row's stools
BOOTH_GAP = 1.6  # tiles between one booth's end and the next along the wall
COUNTER_AISLE = 6.0  # tiles from the last square column's stools to the counter column's cashier
QUEUE_GAP = 4.8  # tiles between people queueing along v: their tap targets (284 px) clear each other
FRONT_ROOM = 3.0 # tiles of hall in front of the last row / booth, before the front wall
COLS, ROWS, BOOTHS = 2, 3, 4
SQUARES = {(0, 0): (True, True), (1, 0): (True, True), (0, 1): (True, False), (1, 1): (True, True), (0, 2): (False, True),
           (1, 2): (True, True)}
L_BOOTHS = [(True, True), (True, False), (True, True), (True, True)]
DIRTY = (0, 1)
M = 200  # px of margin round the building
Y0 = 760  # px from the picture's top to the back corner's floor point: the back walls' visible height
WHOLE_W = 3200  # the whole-building picture's width on the page

STEEL = ((214, 218, 222), (170, 176, 182), (128, 134, 142))  # top, +v face, +u face
PLASTER = ((240, 234, 220), (216, 202, 178), (186, 170, 146))
WOOD = ((214, 168, 112), (166, 110, 66), (130, 84, 50))
OUTSIDE = (62, 60, 68)
EDGE = (58, 46, 46)
NEW_SAMPLES: dict[str, Image.Image] = {}  # each room-art part as placed (scene scale), for the style strip


class Layout(NamedTuple):
    W: float  # building width along u, tiles
    D: float  # depth along v
    rooms: list[tuple[str, float, float]]  # (name, u0, u1) in the strip
    booths: list[float]  # each left-wall booth's start along v
    cells: list[tuple[float, float]]  # square table centres, row by row
    cu: float  # the counter column's u
    cv0: float  # where the counter column starts along v
    entrance: tuple[float, float]  # the gap in the front-right wall (u = W), along v


def plan(rooms: tuple[str, ...], reach: float, blen: float, sq: float, ctr_a: float, col_len: float) -> Layout:
    """Where everything goes, from the furniture's measured sizes (reach: a booth's depth from the wall; blen: one
    booth along the wall; sq: a square table's reach from its centre, stools included; ctr_a: the counter's half depth;
    col_len: the counter column's length along v). The hall is sized by the bubble spacing; the rooms share the
    building's width from the back corner; the strip past the last room is hall (the counter's alcove when the
    counter column fits there, cashier included)."""
    u_col = [reach + SIDE_AISLE + sq + i * (2 * sq + ROW_AISLE) for i in range(COLS)]
    v_row = [STRIP + WALL_T / 2 + BACK_AISLE + sq + j * (2 * sq + ROW_AISLE) for j in range(ROWS)]
    cu = u_col[-1] + sq + COUNTER_AISLE + ctr_a
    hall_w = cu + ctr_a + 4.5  # the paying customer (and without a takeaway room, its queue) stand in front of the counter
    fixed = sum(ROOM_W[r] for r in rooms)
    out: list[tuple[str, float, float]] = []
    u = 0.0
    for r in rooms:
        w = ROOM_W[r] or max(hall_w - fixed, 6.0)  # the takeaway room takes the strip's rest, by the entrance
        out.append((r, u, u + w))
        u += w
    W = max(hall_w, u)
    alcove = not any(ROOM_W[r] == 0 for r in rooms) and cu - ctr_a - 1.6 >= u + WALL_T / 2  # cashier clears the side wall
    booths = [STRIP + WALL_T / 2 + 0.6 + k * (blen + BOOTH_GAP) for k in range(BOOTHS)]
    take = any(ROOM_W[r] == 0 for r in rooms)  # the takeaway room: its order cards need the till kept clear of its bench
    cv0 = 1.0 if alcove else STRIP + WALL_T / 2 + (6.5 if take else 2.5)
    entrance = (cv0 + col_len + 1.0, cv0 + col_len + 1.0 + 2 * DOOR)
    D = max(v_row[-1] + sq, booths[-1] + blen, entrance[1]) + FRONT_ROOM
    return Layout(W, D, out, booths, [(u, v) for v in v_row for u in u_col], cu, cv0, entrance)


def grid_for(lay: Layout, y0: float = Y0) -> Grid:
    """The picture: the building, the street beyond its front walls (pavement, kerb, road and a little more), and above
    the back walls (y0 from the top) the street's backdrop."""
    w = int(2 * M + HX * (lay.W + lay.D))
    h = int(y0 + HY * (lay.W + lay.D) + 2 * HY * (PAVE + KERB + ROAD + 1.5))
    return Grid(M + HX * lay.D, y0, w, h)


# what a room builder returns: its openings in the hall partition (intervals along u), and where pending-order cards
# anchor (a scene point over its counter), if it shows any
Opened = tuple[list[tuple[float, float]], tuple[float, float] | None]


# -- drawing in iso -----------------------------------------------------------------------------------------------
Colour = tuple[int, int, int]
RGBA = tuple[int, int, int, int]


class Canvas:
    """A sprite covering floor rectangle r (with margin) from the floor up to z_top px: draw iso boxes, cylinders and
    flat shapes in floor coordinates, then put it into the scene at one depth."""

    def __init__(self, g: Grid, r: Rect, z_top: float, pad: float = 1.0) -> None:
        u0, u1, v0, v1 = r[0] - pad, r[1] + pad, r[2] - pad, r[3] + pad
        xs = [g.S(u, v)[0] for u in (u0, u1) for v in (v0, v1)]
        ys = [g.S(u, v)[1] for u in (u0, u1) for v in (v0, v1)]
        self.g = g
        self.ox, self.oy = int(min(xs)) - 4, int(min(ys) - z_top) - 4
        self.img = Image.new("RGBA", (int(max(xs)) + 4 - self.ox, int(max(ys)) + 4 - self.oy), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    def p(self, u: float, v: float, z: float = 0.0) -> tuple[float, float]:
        x, y = self.g.S(u, v)
        return x - self.ox, y - z - self.oy

    def box(self, r: Rect, z0: float, h: float, col: tuple[Colour, Colour, Colour], edge: Colour = EDGE) -> None:
        u0, u1, v0, v1 = r
        z1 = z0 + h
        p = self.p
        self.d.polygon([p(u1, v0, z0), p(u1, v1, z0), p(u1, v1, z1), p(u1, v0, z1)], fill=col[2], outline=edge)
        self.d.polygon([p(u0, v1, z0), p(u1, v1, z0), p(u1, v1, z1), p(u0, v1, z1)], fill=col[1], outline=edge)
        self.d.polygon([p(u0, v0, z1), p(u1, v0, z1), p(u1, v1, z1), p(u0, v1, z1)], fill=col[0], outline=edge)

    def ellipse(self, u: float, v: float, z: float, r: float, fill: Colour | RGBA, outline: Colour | None = EDGE, width: int = 2) -> None:
        """A horizontal circle of radius r tiles at height z: 181 r px wide, half as tall."""
        x, y = self.p(u, v, z)
        w = HX * math.sqrt(2) * r
        self.d.ellipse((x - w, y - w / 2, x + w, y + w / 2), fill=fill, outline=outline, width=width)

    def cylinder(self, u: float, v: float, z0: float, h: float, r: float, side: Colour, top: Colour, shade: Colour) -> None:
        x, y0 = self.p(u, v, z0)
        _, y1 = self.p(u, v, z0 + h)
        w = HX * math.sqrt(2) * r
        self.d.ellipse((x - w, y0 - w / 2, x + w, y0 + w / 2), fill=shade, outline=EDGE, width=2)
        self.d.rectangle((x - w, y1, x + w, y0), fill=side)
        self.d.rectangle((x + w * 0.35, y1, x + w, y0), fill=shade)
        self.d.line((x - w, y1, x - w, y0), fill=EDGE, width=2)
        self.d.line((x + w, y1, x + w, y0), fill=EDGE, width=2)
        self.d.ellipse((x - w, y1 - w / 2, x + w, y1 + w / 2), fill=top, outline=EDGE, width=2)

    def put(self, sc: Scene, depth: float) -> tuple[int, int]:
        return sc.put(self.img, self.ox, self.oy, depth)


def solid_box(sc: Scene, r: Rect, h: float, col: tuple[Colour, Colour, Colour], hall: bool = False, shadow: float = 0.25) -> tuple[int, int]:
    """One plain box on the floor; hall: walkers keep clear of it and avoid covering it."""
    cv = Canvas(sc.g, r, h, 0.2)
    cv.box(r, 0, h, col)
    sc.iso_shadow((r[0] + r[1]) / 2, (r[2] + r[3]) / 2, (r[1] - r[0]) / 2, (r[3] - r[2]) / 2, shadow)
    tl = cv.put(sc, (r[0] + r[1]) / 2 + (r[2] + r[3]) / 2)
    if hall:
        sc.feet.append(r)
        sc.keep.append((c2.solid(cv.img), tl[0], tl[1], c2.FURNITURE_WEIGHT))
    return tl


def wall_run(sc: Scene, a: tuple[float, float], b: tuple[float, float], gaps: list[tuple[float, float]], h: float) -> None:
    """A cut-down wall from a to b (along u or along v), WALL_T thick, in one-tile pieces (each sorted by its own
    depth, so people on either side are drawn right), leaving out the gaps (intervals along its own axis)."""
    along_u = a[1] == b[1]
    s0, s1 = (a[0], b[0]) if along_u else (a[1], b[1])
    t = a[1] if along_u else a[0]
    edges = sorted({s0, s1, *(g for gap in gaps for g in gap if s0 < g < s1)})
    for lo, hi in zip(edges, edges[1:], strict=False):
        mid = (lo + hi) / 2
        if any(g0 <= mid <= g1 for g0, g1 in gaps):
            continue
        n = max(1, math.ceil(hi - lo))
        for k in range(n):
            p0, p1 = lo + (hi - lo) * k / n, lo + (hi - lo) * (k + 1) / n
            r = (p0, p1, t - WALL_T / 2, t + WALL_T / 2) if along_u else (t - WALL_T / 2, t + WALL_T / 2, p0, p1)
            cv = Canvas(sc.g, r, h, 0.1)
            cv.box(r, 0, h, PLASTER, (200, 186, 162))  # faint seams: the run reads as one wall
            cv.put(sc, (r[0] + r[1]) / 2 + (r[2] + r[3]) / 2)
            sc.feet.append(r)


def dish(sc: Scene, idx: int, u: float, v: float, z: float, r: float, depth: float) -> None:
    """A dish part standing on a surface z px above the floor at (u, v), r tiles in radius (compose_iso2.food's sizing)."""
    img = c2.load(sc.root, next(s for first, s in c2.DISH_SHEETS if idx >= first), f"dish_{idx}")
    img = scaled(img, 2 * HX * math.sqrt(2) * r / img.width)
    ys, xs = np.nonzero(c2.solid(img))
    bx, by = (xs.min() + xs.max()) / 2, ys.max() - c2.PLATE_BASE[idx] * img.width
    x, y = sc.g.S(u, v)
    sc.put(img, x - bx, y - z - by, depth)


def wall_sign(sc: Scene, text: str, u0: float, u1: float, z: float, left: bool = False) -> None:
    """A room's name board on the right-hand back wall over u0..u1 (left: on the left-hand wall, over v0..v1): red
    board, gold characters, sheared onto the wall."""
    font = c2.bubble_font(120)
    w = 150 * len(text) + 80
    img = Image.new("RGBA", (w, 190), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, 189), radius=18, fill=(150, 34, 30), outline=(232, 190, 90), width=8)
    d.text((w / 2, 96), text, font=font, fill=(246, 214, 120), anchor="mm")
    img = c2.shear(img, -0.5 if left else 0.5, 2 / math.sqrt(5))
    x, y = sc.g.S(0, (u0 + u1) / 2) if left else sc.g.S((u0 + u1) / 2, 0)
    sc.put(img, x - img.width / 2, y - z - img.height / 2, -1.0)


# -- the building shell -------------------------------------------------------------------------------------------
def paint_shell(sc: Scene, lay: Layout) -> None:
    """Over compose_iso2.shell's walls and floor: dark outside the building, each room's own floor, and each wet room's
    own wall tiles (to 1.5 booth backs, a red border course on top): the kitchen small white tiles with a stainless
    splash-back sheet behind the wok range; the roast room a maroon tiled dado under cream tiles."""
    g = sc.g
    a = np.asarray(sc.img.convert("RGB")).copy()
    yy, xx = np.mgrid[0:g.h, 0:g.w]
    yb = g.y0 + np.abs(xx - g.cx) / 2
    h = yb - yy
    u = (xx - g.cx) / (2 * HX) + (yy - g.y0) / (2 * HY)
    v = (yy - g.y0) / (2 * HY) - (xx - g.cx) / (2 * HX)
    floor = h <= 0
    along = np.abs(xx - g.cx) / HX  # wall pixels: how far along their wall
    right = xx >= g.cx
    for name, u0, u1 in lay.rooms:
        m = floor & (u >= u0) & (u < u1) & (v < STRIP)
        if name == "kitchen":  # small grey non-slip tiles
            q = 2
            tile = np.where(((np.floor(u * q) + np.floor(v * q)) % 2 == 0)[..., None], np.array((214, 216, 212)), np.array((200, 204, 200)))
            tile[((u * q) % 1 < 0.07) | ((v * q) % 1 < 0.07)] = (160, 164, 162)
        elif name == "roast":  # red quarry tiles
            tile = np.where(((np.floor(u) + np.floor(v)) % 2 == 0)[..., None], np.array((176, 84, 62)), np.array((160, 74, 54)))
            tile[(u % 1 < 0.05) | (v % 1 < 0.05)] = (120, 60, 46)
        elif name == "bar":  # cream and brown terrazzo checks
            q = 2
            tile = np.where(((np.floor(u * q) + np.floor(v * q)) % 2 == 0)[..., None], np.array((232, 220, 196)), np.array((204, 178, 142)))
        else:  # takeaway: pale green terrazzo, speckled
            tile = np.zeros((g.h, g.w, 3), np.uint8)
            tile[:] = (206, 214, 196)
            spk: np.ndarray = ((np.floor(u * 9) * 73856093).astype(np.int64) ^ (np.floor(v * 9) * 19349663).astype(np.int64)) % 11 == 0
            tile[spk] = (150, 160, 146)
            tile[(u % 2 < 0.06) | (v % 2 < 0.06)] = (172, 176, 160)
        a[m] = tile[m]
        if name in ("kitchen", "roast"):
            top = sc.back_h * 1.5
            wall = (~floor) & (h <= top) & (h > 0) & ((right & (along >= u0) & (along < u1)) | ((~right) & (along < STRIP) & (u0 == 0)))
            m_px = sc.person_h / ADULT_M
            if name == "kitchen":  # small white tiles, 10 cm
                tile_wall(a, wall, h, along, 26, (244, 246, 242), (236, 240, 236), (190, 196, 192))
                r0, r1 = u0 + RANGE_AT - 1.2, u0 + RANGE_AT + 2 * RANGE_HALF + 0.3  # the drawn range reaches past its footprint
                splash = wall & right & (along >= r0) & (along < r1) & (h <= RANGE_SPLASH_M * m_px)
                sheet = np.floor((along - r0) / 1.6)  # brushed steel sheets 1.6 tiles wide, a seam between them
                shade = (198 + 10 * np.sin(h / 23.0) + 6 * (sheet % 2)).clip(0, 255)
                a[splash] = np.stack([shade - 4, shade, shade + 4], -1)[splash]
                a[splash & (((along - r0) % 1.6) * HX < 3)] = (150, 156, 160)
                a[splash & (np.abs(h - RANGE_SPLASH_M * m_px) < 3)] = (140, 146, 150)  # its top edge
            else:  # the roast room: maroon tiles to the dado, a cream trim, cream tiles above
                dado = 1.1 * m_px
                tile_wall(a, wall & (h > dado), h, along, 44, (240, 230, 204), (234, 222, 194), (196, 182, 156))
                tile_wall(a, wall & (h <= dado), h, along, 44, (150, 52, 44), (138, 46, 40), (96, 34, 30))
                a[wall & (np.abs(h - dado) < 5)] = (222, 196, 140)
            band = (~floor) & (h > top) & (h <= top + 20) & ((right & (along >= u0) & (along < u1)) | ((~right) & (along < STRIP) & (u0 == 0)))
            a[band] = (176, 50, 40)
    top = sc.back_h * WALL_TOP
    a[(~floor) & (h > top - 12) & (h <= top)] = (196, 170, 128)  # the back walls' cut top edge
    sky = (~floor) & ((h > top) | (right & (along > lay.W)) | ((~right) & (along > lay.D)))
    a[sky] = backdrop(g)[sky]
    # the street: pavement slabs along both front walls, a kerb, the road with a dashed centre line, then more pavement
    du, dv = u - lay.W, v - lay.D
    d = np.maximum(du, dv)
    outside = floor & (d > 0)
    st = np.zeros((g.h, g.w, 3), np.uint8)
    st[:] = np.where(((np.floor(u) + np.floor(v)) % 2 == 0)[..., None], np.array((204, 200, 194)), np.array((196, 192, 186)))
    st[(u % 1 < 0.04) | (v % 1 < 0.04)] = (178, 174, 168)
    r0, r1 = PAVE + KERB, PAVE + KERB + ROAD
    st[(d >= PAVE) & (d < r0)] = (222, 220, 214)
    st[(d >= r0 - 0.06) & (d < r0)] = (176, 174, 170)
    road = (d >= r0) & (d < r1)
    st[road] = (172, 172, 174)
    along_road = v * (du >= dv) + u * (du < dv)
    st[road & (np.abs(d - (r0 + r1) / 2) < 0.1) & (along_road % 3.0 < 1.6)] = (204, 202, 196)
    st[(d >= r1) & (d < r1 + KERB)] = (222, 220, 214)
    a[outside] = st[outside]
    sc.img = Image.fromarray(a.astype(np.uint8)).convert("RGBA")


def tile_wall(a: np.ndarray, wall: np.ndarray, h: np.ndarray, along: np.ndarray, t: int, c0: tuple[int, int, int],
              c1: tuple[int, int, int], grout: tuple[int, int, int]) -> None:
    """Square wall tiles t px tall (t * 0.894 px across on screen: a 2:1 wall), two shades in a checker, grout lines."""
    col = np.floor(along * HX / (t * 0.894))
    a[wall] = c0
    a[wall & ((np.floor(h / t) + col) % 2 == 0)] = c1
    a[wall & (((h % t) < 3) | (((along * HX) % (t * 0.894)) < 3))] = grout


def backdrop(g: Grid) -> np.ndarray:
    """The street behind the shop, kept plain and pale so the eye stays on the floor: a hazy sky, rows of tenement
    blocks with faint window grids, a few vertical shop signs with no text. Low saturation and low contrast."""
    img = Image.new("RGB", (g.w, g.h), (222, 226, 228))
    d = ImageDraw.Draw(img)
    for y in range(0, g.h, 4):  # the haze: a little lighter toward the horizon
        k = min(1.0, y / max(1.0, g.y0))
        c = int(212 + 18 * k)
        d.rectangle((0, y, g.w, y + 4), fill=(c, c + 3, c + 6))
    import random  # noqa: PLC0415 - only the backdrop needs it

    rng = random.Random(7)
    pal = [(200, 198, 194), (192, 196, 198), (206, 202, 196), (188, 190, 192), (198, 194, 200), (194, 198, 192)]
    base = int(g.y0 + 0.5 * g.w)  # the blocks' feet: below everything the backdrop shows
    for row, (lo, hi) in enumerate(((60, 300), (180, 520))):  # far row first (paler and taller), then the near row
        x = -rng.randint(0, 200)
        while x < g.w:
            w = rng.randint(220, 420)
            top = int(g.y0 - rng.randint(lo, hi) - (140 if row == 0 else 0))
            col = pal[rng.randrange(len(pal))]
            if row == 0:
                col = tuple(min(255, c + 12) for c in col)
            d.rectangle((x, top, x + w, base), fill=col)
            win = tuple(c - 12 for c in col)
            for wy in range(top + 26, base, 46):
                for wx in range(x + 18, x + w - 30, 40):
                    d.rectangle((wx, wy, wx + 20, wy + 24), fill=win)
            d.line((x, top, x + w, top), fill=tuple(c - 22 for c in col), width=4)
            if row == 1 and rng.random() < 0.45:  # a vertical shop sign hung off the block, muted, no text
                sc = [(196, 158, 150), (156, 180, 174), (202, 190, 150)][rng.randrange(3)]
                sx = x + rng.randint(20, max(21, w - 80))
                sy = top + rng.randint(60, 160)
                d.rectangle((sx, sy, sx + 54, sy + 200), fill=sc, outline=tuple(c - 30 for c in sc), width=4)
                for k in range(3):
                    d.rectangle((sx + 16, sy + 22 + k * 58, sx + 38, sy + 58 + k * 58), fill=tuple(min(255, c + 18) for c in sc))
            x += w + rng.randint(0, 30)
    lamp = (176, 178, 182)  # street lamps in front of the blocks: flat and pale, like the rest of the backdrop
    for lx in range(260, g.w, 940):
        top = int(g.y0 - 300)
        d.line((lx, top, lx, base), fill=lamp, width=10)
        d.line((lx, top, lx + 80, top + 24), fill=lamp, width=8)
        d.ellipse((lx + 60, top + 14, lx + 130, top + 44), fill=(226, 224, 214), outline=lamp, width=3)
    return np.asarray(img)


# -- the rooms (room art: R-KITCHEN, R-ROAST, R-BAR-TA, R-DECOR, R-COOKS) -------------------------------------------
def drawn_deg(root: Path) -> dict[str, float]:
    """The angle each boxy room part was actually drawn at (cut_sheet.py measures it into <root>/drawn_deg.json)."""
    data: dict[str, float] = json.loads((root / "drawn_deg.json").read_text(encoding="utf-8"))
    return data


TABLE_TOP = 0.8  # the chopping table's top as a share of its tallest point (the block on it)
RANGE_AT, RANGE_HALF = 2.4, 4.4  # tiles: the wok range's start from the kitchen's left wall, its half length
RANGE_SPLASH_M = 1.95  # m: the stainless splash-back behind the range, up to the hood's lip
MEAT_LOW_M = 1.15  # m: the roast room's back rail: the hanging meat's lowest tip, a hand over the back counter
ADULT_M = 1.70  # an adult's height, m: person_h px is this many metres (scene px per metre = person_h / ADULT_M)
# floor art half lengths along u, tiles: like the room art, chosen by eye in the composite so each part stands at its
# true height beside the people (worktops at the hips, the rack at the shoulders)
LUNCH_HALF, TOASTER_HALF = 2.4, 0.9
SINK_HALF, RACK_HALF, TROLLEY_HALF, CRATE_HALF = 3.1, 1.6, 1.25, 0.85


def equip(sc: Scene, sheet: str, name: str, deg: float, half_len: float) -> c2.Sprite:
    """A room part as drawn (long side along u, front +v), warped into parallel 2:1 projection (projection.rectify: from
    the shear that takes its long edges from deg to 26.6 degrees, every edge family straightened) and scaled to
    half_len tiles along u. The sheets draw things long and low, so each part's length is chosen to give it a true
    height beside the people (a 1.2 m chopping table sized to 1.2 m stood knee-high). Recorded for the style strip."""
    img = pj.rectified(c2.part_path(sc.root, sheet, name), pj.shear_m(0.5 - math.tan(math.radians(deg))),
                       c2.PROJ_SKIP.get(name, frozenset()))  # parallel 2:1 (projection.py)
    sp = c2.footprint(img)
    sp = c2.resize(sp, half_len / sp.a)
    fixed = pj.settle(sp.img, c2.PROJ_SKIP.get(name, frozenset()))  # re-checked at the placed size
    if fixed is not sp.img:
        sp = c2.footprint(fixed)
        sp = c2.resize(sp, half_len / sp.a)
    NEW_SAMPLES[name] = sp.img
    return sp


def loose(sc: Scene, sheet: str, name: str, width: float, u: float, v: float, z: float = 0.0, shadow: float = 0.25,
          depth: float | None = None) -> tuple[int, int]:
    """A round or loose part (a pot, urns, cups, bags) width tiles across on screen, standing at (u, v), z px up."""
    img = c2.load(sc.root, sheet, name)
    img = scaled(img, width * HX * 2 / img.width)
    NEW_SAMPLES[name] = img
    ys, xs = np.nonzero(c2.solid(img))
    sc.baked.setdefault(name, c2.Baked("loose", img, (xs.min() + xs.max()) / 2, float(ys.max()), (0.0, 0.0), 0.0, shadow if z == 0.0 else 0.0, ""))
    x, y = sc.g.S(u, v)
    if z == 0.0 and shadow:
        sc.iso_shadow(u, v, width * 0.35, width * 0.35, shadow)
    return sc.put(img, x - (xs.min() + xs.max()) / 2, y - z - ys.max(), u + v if depth is None else depth)


def wall_art(sc: Scene, name: str, wall: str, s: float, z: float, w: float) -> None:
    """A flat R-DECOR part hung on a back wall (R: the right-hand one, along u; L: the left-hand one, along v)."""
    sc.wall_prop("R-DECOR", name, wall, s, z, w)
    img = c2.load(sc.root, "R-DECOR", name)
    NEW_SAMPLES[name] = scaled(img, w / img.width)


def kitchen(sc: Scene, u0: float, u1: float, cook: str) -> Opened:
    """The wok range along the back wall under its hood, the cook at the woks (seen from behind), a prep counter along
    the left-hand wall, the stock pot on its low burner in the corner, the pass set into the partition with dishes
    waiting for the waiter; the ladle rail on the splash-back by the woks, an extractor fan on the wall; crates and a
    mop bucket by the front. Returns the openings it makes in the hall partition (the pass, the door)."""
    return kitchen_at(sc, u0, u1, cook, lunch=False)


def lunch_kitchen(sc: Scene, u0: float, u1: float, cook: str) -> Opened:
    """kitchen() for a lunch menu (noodles, macaroni, French toast; FA-KITCHEN2): the noodle boiler and the
    griddle in place of the wok range under the hood, the cook at the noodle boiler, the conveyor toaster on its stand
    past the griddle, the stock pot forward in the corner; everything else as kitchen()."""
    return kitchen_at(sc, u0, u1, cook, lunch=True)


def kitchen_at(sc: Scene, u0: float, u1: float, cook: str, lunch: bool) -> Opened:
    bh = sc.back_h
    m = sc.person_h / ADULT_M  # px per metre
    deg = drawn_deg(sc.root)
    if lunch:  # the noodle boiler and the griddle side by side under one hood; the toaster on its stand past them
        nb = equip(sc, "FA-KITCHEN2", "noodle_boiler", deg["noodle_boiler"], LUNCH_HALF)
        gr = equip(sc, "FA-KITCHEN2", "griddle", deg["griddle"], LUNCH_HALF)
        nu = u0 + RANGE_AT + nb.a
        gu = nu + nb.a + 0.1 + gr.a
        sc.put_sprite(nb, nu, 0.25 + nb.b, 0.25, "noodle_boiler")
        sc.put_sprite(gr, gu, 0.25 + gr.b, 0.25, "griddle")
        ru, half, front, at = (nu - nb.a + gu + gr.a) / 2, (gu + gr.a - nu + nb.a) / 2, 0.25 + 2 * max(nb.b, gr.b), nu
        ts = equip(sc, "FA-KITCHEN2", "toaster", deg["toaster"], TOASTER_HALF)  # the back wall is full: forward, past
        sc.put_sprite(ts, u0 + 4.4, 7.4, 0.25, "toaster")  # the prep counter's end (in front of the griddle it hides it)
    else:
        rng = equip(sc, "R-KITCHEN", "wok_range", deg["wok_range"], RANGE_HALF)
        ru = u0 + RANGE_AT + rng.a  # clear of the prep counter along the left-hand wall
        sc.put_sprite(rng, ru, 0.25 + rng.b, 0.25, "wok_range")
        half, front, at = rng.a, 0.25 + 2 * rng.b, ru - 0.6
    hood = equip(sc, "R-KITCHEN", "hood", deg["hood"], half_len=half + 0.2)
    ys, xs = np.nonzero(c2.solid(hood.img))
    x = sc.g.S(ru, 1.0)[0]  # on the back wall over the range, its front lip (lowest pixel: the near corner) 1.95 m up
    y = sc.g.S(ru + half, 2.0)[1] - 1.95 * m
    sc.put(hood.img, x - (xs.min() + xs.max()) / 2, y - ys.max(), -0.5)
    sc.parts.append(("hood", hood.img))
    sc.baked.setdefault("hood", c2.Baked("hung", hood.img, (xs.min() + xs.max()) / 2, float(ys.max()), (hood.a, hood.b), 0.0, 0.0, "R"))
    sc.stander(cook, "-v", [(at, front + 0.9)], 0.0)
    prep = c2.mirror(equip(sc, "R-KITCHEN", "prep_counter", deg["prep_counter"], 3.0))  # along the left-hand wall, front +u
    sc.put_sprite(prep, 0.25 + prep.a, 2.4 + prep.b, 0.25, "prep_counter")
    if lunch:
        loose(sc, "R-KITCHEN", "stock_pot", 1.7, u1 - 1.3, front + 5.2)
    else:
        loose(sc, "R-KITCHEN", "stock_pot", 1.7, min(ru + half + 1.0, u1 - 1.0), 1.3)
    wall_art(sc, "utensil_rail", "R", ru + half - 1.6, 1.4 * m, 210)  # on the splash-back, by the woks, under the hood
    wall_art(sc, "wall_fan", "L", 1.4, bh * 2.1, 170)
    loose(sc, "R-DECOR", "crates", 1.5, 1.3, STRIP - 1.3)
    loose(sc, "R-DECOR", "mop_bucket", 1.3, 3.4, STRIP - 1.0)
    # the pass: R-KITCHEN's plastered stub topped by a steel shelf and a bell, set into the partition; dishes on it
    ps = equip(sc, "R-KITCHEN", "pass", deg["pass"], 2.2)
    pu = u0 + 5.4 + ps.a
    p0, p1 = pu - ps.a, pu + ps.a
    tl = sc.put_sprite(ps, pu, STRIP, 0.2, "pass")
    top = 1.0 * m  # the shelf top
    d = pu + STRIP
    dish(sc, 2, p0 + 0.9, STRIP, top, 0.5, d + 0.01)
    dish(sc, 10, p0 + 2.1, STRIP, top, 0.5, d + 0.02)
    sc.keep.append((c2.solid(ps.img), tl[0], tl[1], c2.FURNITURE_WEIGHT))
    wall_sign(sc, ROOM_ZH["kitchen"], 3.5, 7.5, bh * 1.85, left=True)
    return [(p0, p1), (u1 - 0.3 - DOOR, u1 - 0.3)], None  # the door at the far end: the booths stand along the near one


def roast(sc: Scene, u0: float, u1: float, cook: str) -> Opened:
    """The roast-meat room, laid out as a real roast shop: R-ROAST's glass case with geese, char siu and roast pork
    stands at the FRONT, set into the partition and facing the hall; behind it the steel chopping table with its block
    and cleaver and a tray of chopped meat, and the cook behind that, seen over and beside the case. The meat
    rail hangs low on the back wall over a steel back counter with trays of meat on it, as in a roast shop's back.
    Returns the case's opening and the door."""
    bh = sc.back_h
    m = sc.person_h / ADULT_M
    deg = drawn_deg(sc.root)
    img = c2.load(sc.root, "R-ROAST", "meat_rail")  # drawn already slanting: sheared the rest of the way onto the wall
    img = c2.shear(scaled(img, (u1 - u0 - 4.4) * HX / img.width), 0.5 - math.tan(math.radians(deg["meat_rail"])))
    NEW_SAMPLES["meat_rail"] = img
    ys, _ = np.nonzero(c2.solid(img))
    x, y = sc.g.S((u0 + u1 - 2.0) / 2, 0)  # the order slips hang right of it
    sc.put(img, x - img.width / 2, y - MEAT_LOW_M * m - float(ys.max()), -0.4)  # the meat's lowest tip MEAT_LOW_M up
    sc.baked.setdefault("meat_rail", c2.Baked("wall", img, img.width / 2, img.height / 2, (0.0, 0.0), 0.0, 0.0, "R"))
    back = equip(sc, "R-KITCHEN", "prep_counter", deg["prep_counter"], (u1 - u0 - 4.6) / 2)  # long side along u, front +v
    bu, bv = (u0 + u1 - 2.0) / 2, 0.25 + back.b
    btl = sc.put_sprite(back, bu, bv, 0.25, "roast_counter")
    brow = np.nonzero(c2.solid(back.img)[:, int(round(back.fx))])[0]
    btop = (back.fy - float(brow.min())) * 0.97  # its top over the anchor
    for k, du in enumerate((-0.45, 0.25)):
        loose(sc, "R-ROAST", "meat_tray", 1.15, bu + du * back.a, bv + 0.2, btop, 0.0, bu + bv + 0.01 + k * 0.001)
    sc.keep.append((c2.solid(back.img), btl[0], btl[1], c2.FURNITURE_WEIGHT))
    case = equip(sc, "R-ROAST", "roast_case", deg["roast_case"], 3.3)
    cu = u1 - 0.6 - case.a  # the case at the far end, the door by the kitchen
    ctl = sc.put_sprite(case, cu, STRIP - 0.15, 0.25, "roast_case")
    # the chopping table, scaled whole (lifting it as a box like the counters stretches its legs and block)
    tab = equip(sc, "R-ROAST", "chop_table", deg["chop_table"], 3.3)
    tu, tv = cu - 0.6, STRIP - 0.15 - case.b - 0.5 - tab.b  # just behind the case
    ttl = sc.put_sprite(tab, tu, tv, 0.25, "chop_table")
    rows = np.nonzero(c2.solid(tab.img)[:, int(round(tab.fx))])[0]
    top = (tab.fy - float(rows.min())) * TABLE_TOP  # its working top over the anchor, under the block on it
    loose(sc, "R-ROAST", "meat_tray", 1.2, tu - tab.a * 0.5, tv + 0.1, top, 0.0, tu + tv + 0.01)
    cku, ckv = tu - 0.2, tv - tab.b - 0.7  # straight behind the table, facing the hall
    sc.hidden(cook, "+v", cku, ckv, sc.contour(tab.img, ttl), cku + ckv, seated=False)
    sc.keep.append((c2.solid(case.img), ctl[0], ctl[1], c2.FURNITURE_WEIGHT))
    wall_art(sc, "ticket_rail", "R", u1 - 1.5, 1.45 * m, 170)
    wall_sign(sc, ROOM_ZH["roast"], u0 + 3.2, u0 + 6.6, bh * 2.25)
    return [(cu - case.a - 0.1, cu + case.a + 0.1), (u0 + 0.3, min(u0 + 0.3 + DOOR, cu - case.a - 0.3))], None


def bar_room(sc: Scene, u0: float, u1: float, barman: str) -> Opened:
    """The drinks bar: B1-DEPT's bar counter set into the partition, facing the hall, the barman behind it; along the
    back wall I-COUNTER's counter with R-BAR-TA's tea urns and cups on it, the drinks fridge in the corner, a jar shelf
    and a calendar on the wall. Returns the bar's opening and the door."""
    bh = sc.back_h
    deg = drawn_deg(sc.root)
    sp = sc.counter_part("bar", c2.BAR_HALF, "B1-DEPT", c2.DEPT_DRAWN_DEG)
    sp = c2.mirror(sp)  # back to its long side along u, front +v: into the hall
    bu = u0 + 1.4 + sp.a
    tl = sc.put_sprite(sp, bu, STRIP, label="bar")
    sc.hidden(barman, "+v", bu + 0.4, STRIP - sp.b - 1.0, sc.contour(sp.img, tl), bu + STRIP - sp.b - 0.5, seated=False)
    fr = equip(sc, "R-BAR-TA", "fridge", deg["fridge"], 1.5)
    sc.put_sprite(fr, u1 - 0.5 - fr.a, 0.25 + fr.b, 0.25, "fridge")
    k0, k1 = u0 + 0.8, u1 - 0.8 - 2 * fr.a
    back = c2.mirror(sc.counter_part("counter", (k1 - k0) / 2))  # long side along u, front +v, at counter height
    ku, kv = (k0 + k1) / 2, 0.25 + back.b
    sc.put_sprite(back, ku, kv, 0.25, "bar_back")
    top = bh * c2.COUNTER_TO_BACK
    loose(sc, "R-BAR-TA", "urns", 1.7, k0 + 1.3, kv - 0.1, top, 0.0, ku + kv + 0.01)
    loose(sc, "R-BAR-TA", "cups", 1.9, k0 + 3.6, kv, top, 0.0, ku + kv + 0.02)
    wall_art(sc, "jar_shelf", "R", k0 + 2.6, bh * 1.75, 230)
    wall_art(sc, "calendar", "R", k1 - 0.6, bh * 1.55, 110)
    wall_sign(sc, ROOM_ZH["bar"], k0 + 3.6, k0 + 6.9, bh * 2.3)
    return [(bu - sp.a - 0.1, bu + sp.a + 0.1), (u1 - DOOR - 0.6, u1 - 0.6)], None


def takeaway(sc: Scene, u0: float, u1: float, staff: str) -> Opened:
    """The takeaway room by the entrance: B1-DEPT's packing bench set into the partition, facing the hall;
    R-BAR-TA's steel shelf of foam boxes and bags against the back wall; its pile of packed orders waiting on the floor.
    Its look is static (no staff; staff is unused); pending orders show as bag cards over the bench (takeaway_cards).
    Returns the bench's opening, the door and the cards' anchor."""
    bh = sc.back_h
    deg = drawn_deg(sc.root)
    sp = c2.mirror(sc.counter_part("takeaway", c2.TAKEAWAY_HALF, "B1-DEPT", c2.DEPT_DRAWN_DEG))  # long side along u, front +v
    tu = u0 + 0.4 + DOOR + 0.3 + sp.a  # the door first, then the bench: its order cards sit over this room, not the bar
    tl = sc.put_sprite(sp, tu, STRIP, label="takeaway")
    mask = c2.solid(sp.img)
    col = int(round(sp.fx))
    top_y = tl[1] + float(np.nonzero(mask[:, col])[0].min())
    sh = equip(sc, "R-BAR-TA", "takeaway_shelf", deg["takeaway_shelf"], (u1 - u0 - 2.4) / 2)
    sc.put_sprite(sh, min(u0 + 1.0 + sh.a, u1 - 0.5 - sh.a), 0.25 + sh.b, 0.25, "takeaway_shelf")
    loose(sc, "R-BAR-TA", "bag_pile", 2.0, u1 - 2.0, 0.25 + 2 * sh.b + 1.4)
    wall_sign(sc, ROOM_ZH["takeaway"], u0 + 2.5, u0 + 5.8, bh * 2.4)
    return [(tu - sp.a - 0.1, tu + sp.a + 0.1), (u0 + 0.4, u0 + 0.4 + DOOR)], (sc.g.S(tu, STRIP)[0], top_y)


def takeaway_cards(anchor: tuple[float, float], orders: int) -> list[c2.Bubble]:
    """One bag card per pending order over the packing bench, in a row centred on it, each with its own 48 pt tap
    target (touching, never overlapping); past MAX_ROW the row stops growing and the last card shows "+n"."""
    n = min(orders, MAX_ROW)
    x, y = anchor
    return [c2.bubble_at(x + (k - (n - 1) / 2) * c2.HIT_PX, y, "takeaway") for k in range(n)]


def till(sc: Scene, u: float, v0: float, cashier: str) -> tuple[float, float]:
    """compose_iso2.Scene.counter without the packing bench (it has its own room): the cake cabinet and the cashier
    counter along v from v0, fronts +u, the cashier behind. Returns the paying customer's spot."""
    cake = sc.counter_part("cake_case", c2.CAKE_HALF)
    ctr = sc.counter_part("counter", c2.COUNTER_HALF)
    cake_tl = sc.put_sprite(cake, u, v0 + cake.b, 0.3, "cake_case")
    vc = v0 + 2 * cake.b + 0.25 + ctr.b
    tl = sc.put_sprite(ctr, u, vc, 0.3, "counter")
    sc.counter_h = c2.box_height(ctr.img)
    edge = np.minimum(sc.contour(ctr.img, tl), sc.contour(cake.img, cake_tl))
    cu = u - ctr.a - 0.75
    sc.feet.append((cu - 0.35, cu + 0.35, vc - 0.35, vc + 0.35))
    sc.hidden(cashier, "+u", cu, vc, edge, min(cu + vc, u + vc - 0.01), seated=False)
    return u + ctr.a + 1.6, vc - 1.0


def wash(sc: Scene, u0: float, u1: float, washer: str) -> Opened:
    """The dishwashing room (FA-SINK): the double sink along the back wall, the
    dishwasher at it (seen from behind), the plate rack along the back wall past it, the bus trolley of dirty dishes
    just in from the door, the blue crates of clean bowls by the left-hand partition. Returns the door."""
    bh = sc.back_h
    deg = drawn_deg(sc.root)
    sk = equip(sc, "FA-SINK", "sink", deg["sink"], SINK_HALF)
    su = u0 + 0.6 + sk.a
    sc.put_sprite(sk, su, 0.25 + sk.b, 0.25, "sink")
    sc.stander(washer, "-v", [(su - 0.4, 0.25 + 2 * sk.b + 0.9)], 0.0)
    rk = equip(sc, "FA-SINK", "dish_rack", deg["dish_rack"], RACK_HALF)
    sc.put_sprite(rk, min(su + sk.a + 0.3 + rk.a, u1 - 0.4 - rk.a), 0.25 + rk.b, 0.25, "dish_rack")
    tr = equip(sc, "FA-SINK", "bus_trolley", deg["bus_trolley"], TROLLEY_HALF)
    sc.put_sprite(tr, u1 - 1.0 - DOOR / 2, STRIP - 3.4, 0.25, "bus_trolley")
    cr = equip(sc, "FA-SINK", "crate_stack", deg["crate_stack"], CRATE_HALF)
    sc.put_sprite(cr, u0 + 0.6 + cr.a, STRIP - 1.6 - cr.b, 0.25, "crate_stack")
    wall_sign(sc, ROOM_ZH["wash"], su - 1.5, su + 1.8, bh * 2.3)
    return [(u1 - 1.0 - DOOR, u1 - 1.0)], None


ROOM_BUILDERS = {"kitchen": kitchen, "lunch_kitchen": lunch_kitchen, "wash": wash, "roast": roast, "bar": bar_room, "takeaway": takeaway}
STAFF = {"kitchen": "wok_cook", "lunch_kitchen": "wok_cook", "wash": "dishwasher", "roast": "roast_cook", "bar": "barman", "takeaway": ""}


# -- bubbles ------------------------------------------------------------------------------------------------------
def bubble_clashes(heads: list[c2.Head], party: list[int], marks: list[tuple[float, float]], width: int,
                   fixed: list[c2.Bubble] | None = None) -> list[str]:
    """Every party calling at once, each bubble over its front member (and each dirty table's marker, and the fixed
    cards: the takeaway orders): what breaks place_bubbles' rules. Empty means any moment fits: every bubble's first
    choice fits next to all the others."""
    calls = c2.calls_of(heads, [(g, "order") for g in c2.parties(heads, party)], marks)
    faces = [(x, y) for x, y, _ in heads]
    first = [c2.bubble_at(*c[0]) for c in calls] + (fixed or [])
    out: list[str] = []
    for i, b in enumerate(first):
        f = c2.bubble_fault(b, first[:i] + first[i + 1:], faces, width)
        if f:
            out.append(f)
    return out


def head_of(sc: Scene, who: str, facing: str, u: float, v: float) -> tuple[float, float]:
    """Where a standing customer's head top would be (as Scene.stander places them)."""
    m = c2.solid(sc.person(who, facing))
    ys = np.nonzero(m)[0]
    x, y = sc.g.S(u, v)
    return x, y - float(ys.max()) + float(ys.min())


def safe_spot(sc: Scene, head: tuple[float, float], fixed: list[c2.Bubble]) -> bool:
    """A new customer whose head is here adds no bubble clash to those already placed, all calling at once."""
    heads = [*sc.heads, (head[0], head[1], "walker")]
    party = [*sc.party, max(sc.party, default=0) + 10 ** 6]
    return len(bubble_clashes(heads, party, sc.marks, sc.g.w, fixed)) == len(bubble_clashes(sc.heads, sc.party, sc.marks, sc.g.w, fixed))


def badge(img: Image.Image, b: c2.Bubble, n: int) -> None:
    """A "+n" count on a card's top-right corner, for more pending orders than the row shows."""
    d = ImageDraw.Draw(img)
    x, y = b.box[2] - 8, b.box[1] + 8
    r = 46
    d.ellipse((x - r, y - r, x + r, y + r), fill=(200, 60, 50), outline=(44, 26, 40), width=6)
    d.text((x, y), f"+{n}", font=c2.bubble_font(52), fill=(255, 255, 255), anchor="mm")


def region_stats(img: Image.Image, m: np.ndarray) -> tuple[float, float]:
    """(mean HSV saturation, RMS luminance contrast) of the pixels under mask m, both 0..1."""
    hsv = np.asarray(img.convert("HSV")).astype(float) / 255
    lum = np.asarray(img.convert("L")).astype(float) / 255
    return float(hsv[..., 1][m].mean()), float(lum[m].std())


def outside_masks(g: Grid, lay: Layout, back_h: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(hall floor, street, backdrop) pixel masks of the bare shell."""
    yy, xx = np.mgrid[0:g.h, 0:g.w]
    hgt = g.y0 + np.abs(xx - g.cx) / 2 - yy
    u = (xx - g.cx) / (2 * HX) + (yy - g.y0) / (2 * HY)
    v = (yy - g.y0) / (2 * HY) - (xx - g.cx) / (2 * HX)
    floor = hgt <= 0
    along = np.abs(xx - g.cx) / HX
    right = xx >= g.cx
    hall = floor & (v > STRIP + 0.5) & (v < lay.D) & (u < lay.W)
    street = floor & ((u > lay.W) | (v > lay.D))
    sky = (~floor) & ((hgt > back_h * WALL_TOP) | (right & (along > lay.W)) | ((~right) & (along > lay.D)))
    return hall, street, sky


def contrast_report(shell: Image.Image, g: Grid, lay: Layout, back_h: float) -> str:
    """The outside must sit back: its saturation and contrast against the hall floor's, from the bare shell.
    Fails loudly unless both are at most half the floor's."""
    hall, street, sky = (region_stats(shell, m) for m in outside_masks(g, lay, back_h))
    for name, (s, c) in (("street", street), ("backdrop", sky)):
        if s > 0.5 * hall[0] or c > 0.5 * hall[1]:
            raise ValueError(f"the {name} competes with the floor: saturation {s:.2f} / contrast {c:.2f} vs {hall[0]:.2f} / {hall[1]:.2f}")
    return (f"saturation / contrast: hall floor {hall[0]:.2f} / {hall[1]:.3f}; street {street[0]:.2f} / {street[1]:.3f}; "
            f"backdrop {sky[0]:.2f} / {sky[1]:.3f}")



# -- the whole building -------------------------------------------------------------------------------------------
def compose_rooms(root: Path, rooms: tuple[str, ...] = ("kitchen", "roast", "bar", "takeaway"), theme: str = "plain",
                  bubbles: bool = True, tray: bool = False) -> tuple[Image.Image, list[str], Layout, Scene]:
    """The building: the rooms strip, the hall, people, and (bubbles) one sampled moment's status bubbles with their
    tap targets outlined; tray: the waiter carries a tray down the hall instead of waiting at the pass. Returns the
    full-size picture, a log, the layout and the scene."""
    NEW_SAMPLES.clear()
    probe = Scene(root, c2.LARGE, theme)
    bf, bk = probe.bench_front, probe.bench_back
    reach = c2.WALL_GAP + 2 * bf.a
    gap = 2 * (c2.TOP_HALF - c2.OVERHANG)
    blen = 2 * bf.b + gap + 2 * bk.b + 0.05
    sq = c2.SQUARE_HALF + 0.45 + max(probe.stool.a, probe.stool.b)
    ctr = probe.counter_part("counter", c2.COUNTER_HALF)
    cake = probe.counter_part("cake_case", c2.CAKE_HALF)
    tk = probe.counter_part("takeaway", c2.TAKEAWAY_HALF, "B1-DEPT", c2.DEPT_DRAWN_DEG)
    has_take = "takeaway" in rooms
    col_len = 2 * (cake.b + ctr.b) + 0.25 + (0.0 if has_take else 2 * tk.b + 0.25)
    lay = plan(rooms, reach, blen, sq, ctr.a, col_len)
    g = grid_for(lay, probe.back_h * WALL_TOP + 380)
    sc = Scene(root, g, theme)
    paint_shell(sc, lay)
    shell_only = sc.img.copy()
    log = [f"building {lay.W:.1f} x {lay.D:.1f} tiles; picture {g.w} x {g.h} px; rooms "
           + ", ".join(f"{ROOM_ZH[n]} u {a:.1f}-{b:.1f}" for n, a, b in lay.rooms)]
    openings: list[tuple[float, float]] = []
    cards: list[c2.Bubble] = []
    for name, u0, u1 in lay.rooms:
        opened, anchor = ROOM_BUILDERS[name](sc, u0, u1, STAFF[name])
        openings += opened
        if anchor is not None:
            cards = takeaway_cards(anchor, SHOW_ORDERS)
    stub = sc.back_h * STUB
    end = lay.rooms[-1][2]
    wall_run(sc, (0.0, STRIP), (end + WALL_T / 2, STRIP), openings, stub)  # the rooms' partition onto the hall
    for _, _, u1 in lay.rooms if end < lay.W - 0.01 else lay.rooms[:-1]:  # past the last room: the counter's alcove
        wall_run(sc, (u1, 0.0), (u1, STRIP - WALL_T / 2), [], stub)
    wall_run(sc, (lay.W, 0.0), (lay.W, lay.D), [lay.entrance], stub)  # the front walls, cut down; the entrance
    wall_run(sc, (0.0, lay.D), (lay.W + WALL_T / 2, lay.D), [], stub)
    # the hall: booths on the left-hand wall, square tables, the counter column by the entrance
    tables: list[tuple[str, float, tuple[float, float], tuple[bool, bool]]] = []
    tc = c2.WALL_GAP + bf.a
    for s0, taken in zip(lay.booths, L_BOOTHS, strict=True):
        tables.append(("L", s0, (tc, s0 + 2 * bf.b + gap / 2), taken))
    for k, cell in enumerate(lay.cells):
        ij = (k % COLS, k // COLS)
        tables.append(("D", 0.0, cell, (False, False)) if ij == DIRTY else ("S", 0.0, cell, SQUARES[ij]))
    slots = [c2.SeatSlot(t, tables[t][2]) for t in range(len(tables)) for k in range(2) if tables[t][3][k]]
    sc.slots = slots
    assigned = c2.assign_seats(slots)
    seats = iter(assigned)
    where = [(s[0], slots[i].centre) for i, s in enumerate(assigned) if s is not None]  # each customer's type and place
    sc.party = []
    for t, (kind, s0, (u, v), (far, near)) in enumerate(tables):
        a = next(seats) if far else None
        b = next(seats) if near else None
        if kind in "SD":
            sc.square(u, v, a, b, kind == "D")
        else:
            sc.booth("L", s0, a, b)
        sc.party += [t] * (len(sc.heads) - len(sc.party))
    if has_take:  # the packing bench has its own room: no takeaway queue, its orders show as cards
        pay = till(sc, lay.cu, lay.cv0, "cashier")
        standers = [(pay, "-u", "queue")]
    else:
        qu, qv, pay = sc.counter(lay.cu, lay.cv0, "cashier")
        standers = [(pay, "-u", "queue")] + [((qu + 0.15, qv + 1.9 + QUEUE_GAP * i), "-v", "takeaway") for i in range(2)]
    seated_types = [w for w, _ in where]
    left = sorted(c2.CUSTOMERS, key=lambda w: (seated_types.count(w), c2.CUSTOMERS.index(w)))

    def twin(who: str, p: tuple[float, float]) -> float:  # how far the nearest customer of the same type is, capped
        return min([c2.STANDER_APART] + [math.dist(p, c) for w, c in where if w == who])

    nxt = 10 ** 4
    for p, facing, role in standers:
        who = max(left, key=lambda w: twin(w, p))  # the least-seen type that has no twin nearby
        left.remove(who)
        u, v, c = sc.stander(who, facing, [p], 0.3, role)
        where.append((who, (u, v)))
        sc.party.append(nxt)
        nxt += 1
        log.append(f"{role} {who} ({u:.1f}, {v:.1f}) overlaps {c}")
    # the waiter collects at the kitchen pass, from the hall side (staff: no bubble)
    pass_u = next((a + b) / 2 for a, b in openings[:1])
    if tray:  # or, plates collected, on the way to a table with them (FA-STAFF), down the aisle by the booths
        lane = [(reach + SIDE_AISLE / 2, float(v)) for v in np.arange(STRIP + 3.0, lay.D - 3.0, 0.5)]
        u, v, c = sc.stander("waiter_tray", "+v", lane, 0.3)
        log.append(f"tray waiter ({u:.1f}, {v:.1f}) overlaps {c}")
    else:
        sc.stander("waiter", "-v", [(pass_u - 0.6, STRIP + 1.5)], 0.0)
    # two customers just in, waiting to be seated: in the hall, clear of furniture, every bubble still fitting
    spots = [(float(x), float(y)) for x in np.arange(reach + 1.0, lay.cu - 2.0, 0.5) for y in np.arange(STRIP + 2.0, lay.D - 1.5, 0.5)]
    for _ in range(2):
        # type and spot together: no twin nearby first, then little cover, then near the entrance
        costs = [(-round(twin(w, (u, v))), c // 400, -u - v, c, u, v, w) for w in left[:4]
                 for u, v, c in sc.spot_costs(w, "+v", spots) if c < c2.DINER_WEIGHT * c2.TOUCH_PX and safe_spot(sc, head_of(sc, w, "+v", u, v), cards)]
        if not costs:
            log.append("walker: no spot keeps the bubbles apart")
            continue
        *_, c, u, v, who = min(costs)
        left.remove(who)
        where.append((who, (u, v)))
        sc.stander(who, "+v", [(u, v)], role="walker")
        sc.party.append(nxt)
        nxt += 1
        spots = [p for p in spots if math.dist(p, (u, v)) > 6.0]
        log.append(f"walker {who} ({u:.1f}, {v:.1f}) overlaps {c}")
    img = sc.render()
    clashes = bubble_clashes(sc.heads, sc.party, sc.marks, g.w, cards)
    log.append(contrast_report(shell_only, g, lay, sc.back_h))
    log.append(f"bubble clashes with every party calling at once: {len(clashes)}" + "".join(f"\n  {c}" for c in clashes))
    if bubbles:
        now = c2.needs_now(sc.heads, sc.party)
        try:
            placed = c2.place_bubbles(c2.calls_of(sc.heads, now, sc.marks), [(x, y) for x, y, _ in sc.heads], g.w)
            c2.draw_bubbles(img, placed + cards, show_hit=True)
            if SHOW_ORDERS > MAX_ROW:
                badge(img, cards[-1], SHOW_ORDERS - MAX_ROW + 1)
        except c2.BubbleCrowding as e:
            log.append(f"the sampled moment does not fit: {e}")
        groups = c2.parties(sc.heads, sc.party)
        log.append(f"moment: {len(now)} of {len(groups)} parties need the waiter, + {len(sc.marks)} 執枱, + {len(cards)} takeaway order cards")
        for share in (c2.ACTION_SHARE, 0.6, 1.0):
            log.append(f"random moments with {share:.0%} of parties calling that fit: "
                       f"{c2.bubble_odds(sc.heads, sc.party, sc.marks, g.w, share=share):.0%}")
    screen = c2.PHONE_TILES * HX
    xs_t = sorted(g.S(u, v)[0] for _, _, (u, v), _ in tables)
    xs_c = sorted(x for x, _, _ in sc.heads)
    per_t = max(sum(1 for x in xs_t if a <= x < a + screen) for a in xs_t)
    per_c = max(sum(1 for x in xs_c if a <= x < a + screen) for a in xs_c)
    log.append(f"per phone screen ({screen:.0f} px of {g.w}): at most {per_t} of {len(tables)} tables, {per_c} of {len(sc.heads)} customers")
    return img, log, lay, sc


def style_strip(sc: Scene, width: int = 2400) -> Image.Image:
    """The style check by eye: the reference parts (top row) and the new room parts and cooks (bottom row),
    each at the size it has in the scene, standing on one line, on the hall's plain wall colour."""
    old = [sc.bench_front.img, sc.stool.img, sc.counter_part("cake_case", c2.CAKE_HALF).img, sc.counter_part("counter", c2.COUNTER_HALF).img,
           sc.counter_part("bar", c2.BAR_HALF, "B1-DEPT", c2.DEPT_DRAWN_DEG).img, sc.person("cashier", "+v"), sc.person("barman", "+v")]
    new = [*NEW_SAMPLES.values(), sc.person("wok_cook", "+v"), sc.person("roast_cook", "+v")]
    rows: list[Image.Image] = []
    for row in (old, new):
        ims = [im.crop(im.getbbox()) for im in row]
        h = max(im.height for im in ims)
        out = Image.new("RGBA", (sum(im.width for im in ims) + 40 * (len(ims) + 1), h + 80), (236, 228, 212, 255))
        x = 40
        for im in ims:
            out.alpha_composite(im, (x, 40 + h - im.height))
            x += im.width + 40
        rows.append(out)
    w = max(r.width for r in rows)
    strip = Image.new("RGBA", (w, sum(r.height for r in rows) + 12), (236, 228, 212, 255))
    strip.alpha_composite(rows[0], (0, 0))
    ImageDraw.Draw(strip).line((0, rows[0].height + 6, w, rows[0].height + 6), fill=(150, 34, 30), width=6)
    strip.alpha_composite(rows[1], (0, rows[0].height + 12))
    k = width / w
    return strip.convert("RGB").resize((width, round(strip.height * k)), Image.Resampling.LANCZOS)


def phone_crop(img: Image.Image, x0: float) -> Image.Image:
    """1:1 iPhone-size picture (390 x 844 pt at 3x) of the full-size building picture from scene x x0: one phone
    screen's width (PHONE_TILES tiles) fills the width, the building's full height in the middle."""
    w, h = c2.IPHONE_PT[0] * 3, c2.IPHONE_PT[1] * 3
    crop = img.crop((round(x0), 0, round(x0 + c2.PHONE_TILES * HX), img.height)).convert("RGB")
    crop = crop.resize((w, round(crop.height * w / crop.width)), Image.Resampling.LANCZOS)
    out = Image.new("RGB", (w, h), (40, 34, 38))
    out.paste(crop, (0, max(0, (h - crop.height) // 2)))
    return out


def rooms_window(sc: Scene, lay: Layout) -> float:
    """The phone window's left x centred on the middle room's front (the kitchen's pass to the counter shows)."""
    _, u0, u1 = lay.rooms[len(lay.rooms) // 2]
    x = sc.g.S((u0 + u1) / 2, STRIP)[0] - c2.PHONE_TILES * HX / 2
    return float(min(max(0.0, x), sc.g.w - c2.PHONE_TILES * HX))


def main() -> None:
    import sys  # noqa: PLC0415

    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if callable(reconfigure):
        reconfigure(encoding="utf-8")  # the log holds Chinese dish names

    here = Path(__file__).resolve().parent / "out"
    here.mkdir(exist_ok=True)
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "art" / "parts"
    img, log, lay, sc = compose_rooms(root)
    print("\n".join(log))
    img.convert("RGB").resize((WHOLE_W, round(img.height * WHOLE_W / img.width)), Image.Resampling.LANCZOS).save(here / "compose_rooms.png")
    x0 = rooms_window(sc, lay)
    phone_crop(img, x0).save(here / "phone_rooms.png")
    style_strip(sc).save(here / "style_strip.png")
    print("phone window x", x0)
    rows = pj.gate(sc.parts, c2.PROJ_SKIP)
    for r in rows:
        print(f"projection {r.label:15s} tilt {r.tilt:5.2f} conv {r.conv:5.2f} {'ok' if r.ok else 'FAIL'}  {r.detail}")
    out = {"tilt_max": pj.TILT_MAX, "conv_max": pj.CONV_MAX, "skip": {k: sorted(v) for k, v in c2.PROJ_SKIP.items()},
           "parts": [r._asdict() for r in rows]}
    (here / "projection.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    # the second floor: the lunch kitchen, the sink room, the bar and takeaway, the waiter carrying a tray
    img, log, lay, sc = compose_rooms(root, FLOOR_ART_ROOMS, tray=True)
    print("\n".join(log))
    img.convert("RGB").resize((WHOLE_W, round(img.height * WHOLE_W / img.width)), Image.Resampling.LANCZOS).save(here / "compose_floor_art.png")
    _, u0, _ = lay.rooms[1]
    phone_crop(img, float(min(max(0.0, sc.g.S(u0, STRIP)[0] - c2.PHONE_TILES * HX * 0.35), sc.g.w - c2.PHONE_TILES * HX))).save(here / "phone_floor_art.png")
    for r in pj.gate(sc.parts, c2.PROJ_SKIP):
        print(f"projection {r.label:15s} tilt {r.tilt:5.2f} conv {r.conv:5.2f} {'ok' if r.ok else 'FAIL'}  {r.detail}")


FLOOR_ART_ROOMS = ("lunch_kitchen", "wash", "bar", "takeaway")


if __name__ == "__main__":
    main()
