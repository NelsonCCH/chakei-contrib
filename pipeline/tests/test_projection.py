"""The projection gate and rectifier on synthetic boxes: a box drawn in exact 2:1 parallel projection passes; the same
box seen in perspective (its verticals fanning, its top edges converging) or drawn at 18 degrees fails; rectify() brings
both back inside the gate."""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
from PIL import Image, ImageDraw

import projection as pj

Pt = tuple[float, float]


def box(project: Callable[[float, float, float], Pt], size: tuple[int, int] = (520, 420)) -> Image.Image:
    """A 4 x 1.6 x 1.5 box with shaded faces, dark outlines and panel lines, through `project` (x along u, y along v,
    z up -> screen)."""
    k = 3
    im = Image.new("RGBA", (size[0] * k, size[1] * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    def q(pts: list[tuple[float, float, float]]) -> list[Pt]:
        return [(x * k, y * k) for x, y in (project(*p) for p in pts)]

    w, dp, h = 4.0, 1.6, 1.5
    faces = [([(0, 0, h), (w, 0, h), (w, dp, h), (0, dp, h)], (200, 200, 196)),
             ([(0, dp, 0), (w, dp, 0), (w, dp, h), (0, dp, h)], (150, 150, 150)),
             ([(w, 0, 0), (w, dp, 0), (w, dp, h), (w, 0, h)], (120, 120, 124))]
    for pts, col in faces:
        d.polygon(q(pts), fill=(*col, 255), outline=(60, 40, 60, 255), width=3 * k)
    for i in range(1, 4):  # panel lines on the front face
        d.line(q([(i, dp, 0.1), (i, dp, h - 0.1)]), fill=(80, 70, 80, 255), width=2 * k)
    d.line(q([(0.1, dp, 0.75), (w - 0.1, dp, 0.75)]), fill=(80, 70, 80, 255), width=2 * k)
    return im.resize(size, Image.Resampling.LANCZOS)


def parallel(x: float, y: float, z: float) -> Pt:
    return 160 + (x - y) * 64, 140 + (x + y) * 32 - z * 90


def slanted(x: float, y: float, z: float) -> Pt:  # the u axis drawn at 18 degrees (tan 0.325) instead of 26.57
    return 160 + (x - y) * 64, 140 + x * 64 * 0.325 + y * 32 - z * 90


def perspective(x: float, y: float, z: float) -> Pt:
    """A pinhole view of the same box from above and in front: verticals fan out, parallel edges converge."""
    p = np.array([x - 2.0, y - 0.8, z - 0.75])
    r = np.array([[0.894, -0.447, 0.0], [0.2, 0.4, -0.894], [0.4, 0.8, 0.447]])  # camera axes: right, down, forward
    c = r @ p + np.array([0.0, 0.0, 9.0])
    f = 9.0 * 143.0
    return 260 + f * c[0] / c[2], 210 + f * c[1] / c[2]


def test_parallel_box_passes() -> None:
    rep = pj.report(box(parallel))
    assert pj.passes(rep), pj.describe(rep)


def test_perspective_box_fails_and_is_rectified() -> None:
    im = box(perspective)
    rep = pj.report(im)
    assert not pj.passes(rep), pj.describe(rep)
    fixed = pj.rectify(im, np.eye(2))
    after = pj.report(fixed)
    assert pj.passes(after), pj.describe(after)


def test_slanted_box_fails_and_is_rectified() -> None:
    im = box(slanted)
    rep = pj.report(im)
    assert not pj.passes(rep), pj.describe(rep)
    assert pj.passes(pj.report(pj.rectify(im, np.eye(2))))


def test_skipped_family_is_not_measured() -> None:
    rep = pj.report(box(slanted), frozenset({"u", "v", "z"}))
    assert all(f.n == 0 for f in rep.values())
