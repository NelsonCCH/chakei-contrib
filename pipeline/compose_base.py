"""Shared constants and helpers for the compositor (compose_iso2.py, compose_rooms.py, export_atlas.py).

- scaled(): premultiplied Lanczos scaling. The art is painted, not pixel art: scale by filtering only, never by nearest
  neighbour, and always premultiplied so no dark fringe appears round the alpha edge.
- The 2:1 grid in scene px (TW 128 / TH 64 = the game's 32 x 16 logical px tile x 4) and a plain code-drawn room shell
  (walls, tiled dado, checker floor) that compose_iso2 draws its stage treatments over.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

DEVICE_W = 1170  # a 3x phone screen's width in px: art is drawn at >= 2x the size it is shown at on it

RW, RH = 1920, 1280  # the small test scene, scene px
TW, TH = 128, 64  # the game's iso tile (32 x 16 logical px) in scene px
CX, Y0, WALL_H = 960, 300, 300  # back corner x, its floor y, wall height
WALL_C, TEAL_C, GROUT_C, SKIRT_C, CEIL_C = (235, 213, 170), (176, 202, 182), (206, 214, 192), (150, 92, 58), (133, 126, 131)
FLOOR_A, FLOOR_B = (222, 142, 105), (240, 213, 172)


def trim(img: Image.Image) -> Image.Image:
    bb = img.getbbox()
    return img.crop(bb) if bb else img


def scaled(img: Image.Image, k: float) -> Image.Image:
    w, h = max(1, round(img.width * k)), max(1, round(img.height * k))
    return img.convert("RGBa").resize((w, h), Image.Resampling.LANCZOS).convert("RGBA")  # premultiplied: no dark fringe


def shell() -> Image.Image:
    """The small test scene's room: two back walls meeting at (CX, Y0), a tiled dado, a skirting, a checker floor."""
    yy, xx = np.mgrid[0:RH, 0:RW]
    yb = Y0 + np.abs(xx - CX) / 2  # floor edge along the two back walls
    a = np.zeros((RH, RW, 3), np.uint8)
    a[:] = CEIL_C
    wall = (yy >= yb - WALL_H) & (yy < yb)
    a[wall] = WALL_C
    band = (yy >= yb - 160) & (yy < yb - 16)
    a[band] = GROUT_C
    a[band & (((yy - yb) % 32) < 29) & ((xx % 32) < 29)] = TEAL_C
    a[(yy >= yb - 16) & (yy < yb)] = SKIRT_C
    u, v = (xx - CX) / TW + (yy - Y0) / TH, (yy - Y0) / TH - (xx - CX) / TW
    chk = ((np.floor(u) + np.floor(v)) % 2 == 0)[..., None]
    floor = (yy >= yb)[..., None]
    a = np.where(floor, np.where(chk, FLOOR_A, FLOOR_B), a).astype(np.uint8)
    return Image.fromarray(a).convert("RGBA")
