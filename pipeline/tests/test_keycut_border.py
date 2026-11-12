"""keycut drops a secondary piece on the cell border (the model painting outside its mask, e.g. white
strips), keeps the object, anchors it on its own feet, and counts only outline pixels as magenta fringe."""

from __future__ import annotations

import numpy as np

import keycut as k


def test_border_strip_dropped_and_interior_pink_kept() -> None:
    cell = np.zeros((300, 200, 3), np.uint8)
    cell[:] = k.KEY
    cell[:, :12] = (250, 250, 250)  # a white strip along the left border, full height
    cell[60:240, 70:150] = (40, 60, 120)  # the object: a dark blue block standing at y = 239
    cell[100:140, 90:130] = (230, 90, 200)  # a pink-purple pattern inside it (a floral blouse), not fringe
    rgba, p = k.cut_cell(cell)
    assert p["pieces"] == 1 and p["border_px"] == 300 * 12
    assert not p["touches_edge"]
    assert p["spill_px"] == 0
    assert p["anchor"][1] + p["box"][1] == 239
    assert abs(p["anchor"][0] + p["box"][0] - 109) <= 1
    assert rgba.shape[1] < 100  # the strip is not in the sprite
