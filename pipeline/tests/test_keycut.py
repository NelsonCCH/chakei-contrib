"""The magenta key cut on a synthetic sheet: soft edges mixed with the key (drawn at 4x and averaged down, as a painter's
anti-aliasing would), a 2 px arm in floor-salmon skin colour (what the difference cut ate), a loose speck, and a
second cell. The cut must keep the shapes and the thin arm, drop the speck, remove the magenta from the edges, and put
the anchor on the bottom of the object."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import keycut as k

SS = 4  # supersampling factor for the synthetic picture
SKIN = (222, 142, 105)
RED = (190, 40, 40)
INK = (60, 30, 50)


def sheet() -> tuple[Image.Image, np.ndarray, np.ndarray]:
    """600x300 magenta picture, two cells of 300x300; returns the picture and the true masks of the two objects."""
    big = Image.new("RGB", (600 * SS, 300 * SS), k.KEY)
    d = ImageDraw.Draw(big)
    m1 = Image.new("L", big.size, 0)
    d1 = ImageDraw.Draw(m1)
    for dd, fill, outline in ((d, RED, INK), (d1, 255, 255)):
        dd.ellipse((60 * SS, 80 * SS, 220 * SS, 260 * SS), fill=fill, outline=outline, width=3 * SS)
    for dd, fill in ((d, SKIN), (d1, 255)):
        dd.rectangle((205 * SS, 150 * SS, 270 * SS, 152 * SS - 1), fill=fill)  # the 2 px arm, attached, sticking out
    d.rectangle((30 * SS, 30 * SS, 32 * SS, 32 * SS), fill=(120, 120, 120))  # a 2x2 speck: noise, must go
    m2 = Image.new("L", big.size, 0)
    for dd, fill in ((d, (110, 70, 40)), (ImageDraw.Draw(m2), 255)):
        dd.rectangle((380 * SS, 120 * SS, 540 * SS, 270 * SS), fill=fill)
    small = big.resize((600, 300), Image.Resampling.BOX)
    t1 = np.asarray(m1.resize((600, 300), Image.Resampling.BOX)) >= 128
    t2 = np.asarray(m2.resize((600, 300), Image.Resampling.BOX)) >= 128
    return small, t1, t2


def test_key_cut(tmp_path: Path) -> None:
    pic, t1, t2 = sheet()
    src = tmp_path / "sheet.png"
    pic.save(src)
    parts = k.run(src, {"bench": [0, 0, 300, 300], "table": [300, 0, 600, 300]}, tmp_path / "out")
    for name, truth in (("bench", t1), ("table", t2)):
        p = parts[name]
        spr = np.asarray(Image.open(tmp_path / "out" / f"{name}.png"))
        full = np.zeros((300, 600), bool)
        x0, y0, x1, y1 = p["box"]
        full[y0:y1, x0:x1] = spr[..., 3] >= 128
        iou = (full & truth).sum() / (full | truth).sum()
        assert iou > 0.98, (name, iou)
        assert p["stage_purity"] > 0.99 and not p["touches_edge"] and p["spill_px"] == 0
        ys = np.nonzero(truth)[0]
        assert abs(p["anchor"][1] + y0 - int(ys.max())) <= 1
    arm = np.zeros((300, 600), bool)
    arm[150:152, 222:270] = True
    spr = np.asarray(Image.open(tmp_path / "out" / "bench.png"))
    x0, y0, x1, y1 = parts["bench"]["box"]
    got = np.zeros((300, 600), bool)
    got[y0:y1, x0:x1] = spr[..., 3] >= 128
    assert (got & arm).sum() / arm.sum() > 0.95  # the thin skin-coloured arm survives
    assert not got[25:40, 25:40].any()  # the speck is gone
    # edge pixels: after despill the colour is the object's, not pink
    edge = (spr[..., 3] > 20) & (spr[..., 3] < 235)
    rgb = spr[..., :3].astype(int)
    assert edge.sum() > 50
    pink = (rgb[..., 0] > rgb[..., 1] + 40) & (rgb[..., 2] > rgb[..., 1] + 40)
    assert (pink & edge).sum() == 0
