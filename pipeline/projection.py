"""Parallel projection for placed parts: measure it, and warp a part into it.

The game is drawn in 2:1 dimetric "pixel iso": verticals exactly vertical, the two ground axes at exactly +/-26.57
degrees, and parallel edges stay parallel (no vanishing points). Generated parts sometimes come back with a slight
perspective (verticals fanning out, top and base edges converging) or with their ground edges at another angle.

- segments(img): the straight edges of a part (Canny on its colours and its silhouette, then a probabilistic Hough
  transform), as (x1, y1, x2, y2) in the part's pixels.
- report(img): per edge family (u: +26.57, v: 153.43 = -26.57, z: 90, angles in image coordinates, y down): the
  family's tilt (its length-weighted median angle minus the target) and its convergence (how much the edge angle
  changes from one side of the part to the other, from a weighted linear fit of angle against position across the
  family, in degrees). Perspective shows as convergence; a wrong drawing angle as tilt.
- fit(img, init): the homography that best maps every edge of the part onto its family's ideal direction (least
  squares on the length-weighted angle errors), starting from init (a 2x2 linear map: the old shear or stretch).
  A projective map that leaves all three directions parallel is a uniform scale plus a shift, so the only freedom left
  is held by a light pull towards the starting scale and position.
- rectify(img, init): warp the part by the fitted map (premultiplied alpha, no dark fringe) and keep whichever of the
  fitted and the plain init warp scores better on the gate.

  python projection.py <part.png> ...    prints the report of each part
"""

from __future__ import annotations

import functools
import math
import sys
from pathlib import Path
from typing import NamedTuple

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image
from scipy.optimize import least_squares

ISO = math.degrees(math.atan(0.5))  # 26.57
TARGET = {"u": ISO, "v": 180.0 - ISO, "z": 90.0}
CLASS_TOL = 20.0  # an edge belongs to the family whose target it is nearest, within this many degrees
INLIER = 5.0  # and within this many degrees of the family's median
LONG = 0.4  # convergence uses edges at least this share of the family's longest
TILT_MAX = 1.5  # gate: degrees (a family of two or three short edges measures to about +-1 degree on its own)
CONV_MAX = 2.0  # gate: degrees across the part (the measure's own noise: one part measured at two sizes differs by up to ~1.8)
RECTIFY = True  # off: rectified() returns the plain map (measuring the pipeline before rectification)
MIN_SHARE = 0.15  # a family's tilt counts with 3+ edges, or fewer whose total length is this share of the part's longest side
SHAPE_TOL = 0.4  # safety: rectify never changes a part's bbox height-to-width ratio by more than this share
REFINE_ROUNDS = 4  # grid refinements in a row, each on the edges found in the last one's result
PERSPECTIVE = (0.03, 0.25)  # bounds tried on the homography's perspective terms before the grid refines the faces
SCALE_HOLD = 20.0  # weight holding a fitted map's x and y scales (a 1% stretch weighs as a 0.2 degree error)

F64 = NDArray[np.float64]


class Family(NamedTuple):
    n: int  # inlier edges
    length: float  # their total length, px
    tilt: float  # weighted median angle minus target, degrees
    conv: float | None  # angle change across the part, degrees (None: too few edges spread too little to say)
    share: float = 0.0  # their total length over the part's longest side

    def counts(self) -> bool:
        """Enough evidence for the tilt to mean something: one or two short strokes measure to a few degrees."""
        return self.n >= 3 or self.share >= MIN_SHARE


def angle(seg: F64) -> F64:
    """Undirected edge angles in degrees, 0-180, image coordinates (y down)."""
    return np.degrees(np.arctan2(seg[:, 3] - seg[:, 1], seg[:, 2] - seg[:, 0])) % 180.0


def wrap(d: F64) -> F64:
    return (d + 90.0) % 180.0 - 90.0


def segments(img: Image.Image) -> F64:
    a = np.asarray(img.convert("RGBA")).astype(np.float64)
    al = a[..., 3] / 255.0
    lum = (a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114) * al + 128.0 * (1.0 - al)
    g = np.clip(lum, 0, 255).astype(np.uint8)
    inner = np.asarray(cv2.Canny(g, 60, 160), np.uint8)
    inner[al < 0.05] = 0  # the grey outside only meets the part at its silhouette: the alpha pass has that
    edges = inner | np.asarray(cv2.Canny((al * 255).astype(np.uint8), 60, 160), np.uint8)
    h, w = g.shape
    mn = max(18, int(0.08 * max(h, w)))
    found = cv2.HoughLinesP(edges, 1, math.pi / 720, threshold=max(15, mn // 2), minLineLength=mn, maxLineGap=3)
    lines: F64 = np.zeros((0, 4)) if found is None else np.asarray(found, np.float64).reshape(-1, 4)
    return lines


def classify(seg: F64, skip: frozenset[str] = frozenset()) -> dict[str, NDArray[np.bool_]]:
    """Each edge to the nearest family target within CLASS_TOL, then only those near the family's weighted median."""
    ang = angle(seg)
    ln = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1])
    d = np.stack([np.abs(wrap(ang - t)) for t in TARGET.values()])
    near = np.argmin(d, axis=0)
    out: dict[str, NDArray[np.bool_]] = {}
    for i, f in enumerate(TARGET):
        m = (near == i) & (d[i] <= CLASS_TOL)
        if f in skip:  # a family the part does not hold by design (a reclined backrest's leaning channels)
            m &= False
        if m.any():
            med = wmedian(wrap(ang[m] - TARGET[f]), ln[m])
            m &= np.abs(wrap(ang - TARGET[f]) - med) <= INLIER
        out[f] = m
    return out


def wmedian(x: F64, w: F64) -> float:
    o = np.argsort(x)
    c: F64 = np.cumsum(w[o])
    i = int(np.searchsorted(c, float(c[-1]) / 2))
    return float(x[o][i])


def report(img: Image.Image, skip: frozenset[str] = frozenset()) -> dict[str, Family]:
    seg = segments(img)
    out: dict[str, Family] = {}
    if not len(seg):
        return {f: Family(0, 0.0, 0.0, None) for f in TARGET}
    ang = angle(seg)
    ln = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1])
    mid = np.column_stack([(seg[:, 0] + seg[:, 2]) / 2, (seg[:, 1] + seg[:, 3]) / 2])
    for f, m in classify(seg, skip).items():
        if not m.any():
            out[f] = Family(0, 0.0, 0.0, None)
            continue
        e = wrap(ang[m] - TARGET[f])
        w = ln[m]
        t = math.radians(TARGET[f])
        normal = np.array([-math.sin(t), math.cos(t)])  # across the family's edges
        pos = mid[m] @ normal
        alpha = np.asarray(img.convert("RGBA"))[..., 3] >= 128
        ys, xs = np.nonzero(alpha)
        ext = np.column_stack([xs, ys]).astype(np.float64) @ normal
        span = float(ext.max() - ext.min()) if len(ext) else 1.0
        out[f] = Family(int(m.sum()), float(w.sum()), wmedian(e, w), convergence(e, w, pos, span), float(w.sum()) / max(img.size))
    return out


def convergence(e: F64, w: F64, pos: F64, span: float) -> float | None:
    """Angle change across the part (degrees over one full span) from a weighted line fit of edge angle against
    position. Only the family's long edges count (at least LONG of its longest: short ticks and texture strokes wobble),
    one pass drops strays past 2.5 sigma (at least 1 degree), and it needs three edges spread over 30% of the part."""
    keep: NDArray[np.bool_] = w >= LONG * float(w.max())
    k = 0.0
    for _ in range(2):
        if int(keep.sum()) < 3 or float(np.ptp(pos[keep])) < 0.3 * span:
            return None
        s = (pos - float(pos[keep].mean())) / max(span, 1.0)
        c = float(np.average(e[keep], weights=w[keep]))
        k = float((w[keep] * s[keep] * (e[keep] - c)).sum() / max(float((w[keep] * s[keep] ** 2).sum()), 1e-9))
        r = e - c - k * s
        sd = max(1.0, math.sqrt(float(np.average(r[keep] ** 2, weights=w[keep]))))
        keep = keep & (np.abs(r) <= 2.5 * sd)
    return abs(k)


def worst(rep: dict[str, Family]) -> tuple[float, float]:
    """(largest |tilt|, largest convergence) over the families with enough edges to say."""
    tilts = [abs(f.tilt) for f in rep.values() if f.n and f.counts()]
    convs = [f.conv for f in rep.values() if f.conv is not None]
    return (max(tilts) if tilts else 0.0, max(convs) if convs else 0.0)


def passes(rep: dict[str, Family]) -> bool:
    t, c = worst(rep)
    return t <= TILT_MAX and c <= CONV_MAX


def to_h(p: F64) -> F64:
    return np.array([[1 + p[0], p[1], p[2]], [p[3], 1 + p[4], p[5]], [p[6], p[7], 1.0]])


def apply_h(h: F64, pts: F64) -> F64:
    q = np.column_stack([pts, np.ones(len(pts))]) @ h.T
    return q[:, :2] / q[:, 2:3]


def fit(img: Image.Image, init: F64, skip: frozenset[str] = frozenset(), persp: float = 0.25) -> F64:
    """The homography (pixel coordinates) that sends every classified edge to its family's direction; persp bounds
    its perspective terms (in coordinates normalised to about [-1, 1])."""
    seg = segments(img)
    w, h = img.size
    c = max(w, h) / 2.0
    n = np.array([[1 / c, 0, -w / 2 / c], [0, 1 / c, -h / 2 / c], [0, 0, 1]])  # pixels -> about [-1, 1]
    ni = np.linalg.inv(n)
    a0 = np.eye(3)
    a0[:2, :2] = init
    if len(seg) < 3:
        return a0
    p0n = (seg[:, :2] - [w / 2, h / 2]) / c
    p1n = (seg[:, 2:] - [w / 2, h / 2]) / c
    ln = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1])
    base = n @ a0 @ ni  # the init map in normalised coordinates

    def mapped(p: F64) -> tuple[F64, F64]:
        hh = to_h(p) @ base
        return apply_h(hh, p0n), apply_h(hh, p1n)

    p = np.zeros(8)
    for _ in range(2):  # classify under the current map, fit, classify again
        q0, q1 = mapped(p)
        fam = classify(np.column_stack([q0, q1]), skip)
        idx = np.concatenate([np.nonzero(m)[0] for m in fam.values()])
        tgt = np.concatenate([np.full(int(m.sum()), TARGET[f]) for f, m in fam.items()])
        if len(idx) < 3:
            break
        # each family counts the same in total (a long counter has many u edges and few short v ends, and its ends'
        # convergence is as visible as the long sides'); within a family, by length
        share = np.concatenate([ln[m] / max(float(ln[m].sum()), 1e-9) for m in fam.values()])
        sw = np.sqrt(share)

        def resid(pp: F64, idx: NDArray[np.intp] = idx, tgt: F64 = tgt, sw: F64 = sw) -> F64:
            a, b = mapped(pp)
            ang = np.degrees(np.arctan2(b[idx, 1] - a[idx, 1], b[idx, 0] - a[idx, 0])) % 180.0
            # hold the screen x and y scales at the start (with a family skipped, u and v could stretch freely and the
            # part's proportions with them), and the shift
            reg: F64 = np.array([SCALE_HOLD * (math.hypot(1 + pp[0], pp[3]) - 1), SCALE_HOLD * (math.hypot(pp[1], 1 + pp[4]) - 1),
                            0.05 * pp[2], 0.05 * pp[5],
                            # a part whose verticals are not measured (z skipped) keeps them where the init map put them
                            (5 * SCALE_HOLD if "z" in skip else 0.0) * pp[1]])
            return np.concatenate([sw * wrap(ang - tgt), reg])

        lim = np.array([0.4, 0.4, 0.5, 0.4, 0.4, 0.5, persp, persp])
        p = least_squares(resid, p, bounds=(-lim, lim)).x
    return ni @ to_h(p) @ base @ n


def warp(img: Image.Image, h: F64) -> Image.Image:
    """Warp an RGBA part by h onto a canvas just big enough, premultiplied so edges keep their colour."""
    w, hh = img.size
    corners = apply_h(h, np.array([[0, 0], [w, 0], [w, hh], [0, hh]], np.float64))
    x0, y0 = np.floor(corners.min(0))
    x1, y1 = np.ceil(corners.max(0))
    t = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]]) @ h
    a = np.asarray(img.convert("RGBA")).astype(np.float32) / 255.0
    pm = np.dstack([a[..., :3] * a[..., 3:4], a[..., 3:4]])
    size = (int(x1 - x0) + 1, int(y1 - y0) + 1)
    out = cv2.warpPerspective(pm, t, size, flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    return from_premultiplied(np.asarray(out, np.float64))


CELLS = 5  # the refinement grid: CELLS x CELLS cells over the part
SAMPLES = 4  # sub-segments per edge: each must point along its family, so edges stay straight as well as turn
SMOOTH = 0.05  # weight of the grid's second differences (px) against the angle errors (degrees)
HOLD = 0.001  # weight of the displacement itself: keeps the part where and as big as it was


def bilinear(d: F64, x: F64, y: F64, w: float, h: float) -> F64:
    """The grid displacement d ((CELLS+1) x (CELLS+1) x 2) at points (x, y) of a w x h part, bilinearly."""
    fx = np.clip(x / w * CELLS, 0.0, CELLS - 1e-9)
    fy = np.clip(y / h * CELLS, 0.0, CELLS - 1e-9)
    i, j = fy.astype(np.intp), fx.astype(np.intp)
    ty, tx = (fy - i)[:, None], (fx - j)[:, None]
    return (d[i, j] * (1 - tx) * (1 - ty) + d[i, j + 1] * tx * (1 - ty) + d[i + 1, j] * (1 - tx) * ty + d[i + 1, j + 1] * tx * ty)


def refine_field(img: Image.Image, skip: frozenset[str] = frozenset()) -> F64 | None:
    """A smooth displacement grid that turns every edge of the part to its family's direction along its whole length.

    Perspective cannot be undone by one 2D map (a box's three vanishing points are not on one line, so no homography
    sends them all to infinity); each face needs its own. A smooth free-form grid does that without finding the faces:
    edges sampled along their length are pulled onto their directions, the second differences keep it smooth, and a
    light hold keeps the part's place and size."""
    seg = segments(img)
    if len(seg) < 3:
        return None
    fam = classify(seg, skip)
    w, h = float(img.size[0]), float(img.size[1])
    ln = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1])
    pts: list[F64] = []
    tgt: list[float] = []
    wt: list[float] = []
    for f, m in fam.items():
        tot = max(float(ln[m].sum()), 1e-9)
        for s, sl in zip(seg[m], ln[m]):
            k = np.linspace(0.0, 1.0, SAMPLES + 1)[:, None]
            pts.append(s[:2] + (s[2:] - s[:2]) * k)
            tgt += [TARGET[f]] * SAMPLES
            wt += [float(sl) / tot / SAMPLES] * SAMPLES
    if not pts:
        return None
    p = np.stack(pts)  # edges x (SAMPLES + 1) x 2
    flat = p.reshape(-1, 2)
    t = np.array(tgt)
    sw = np.sqrt(np.array(wt))
    n = CELLS + 1

    def resid(v: F64) -> F64:
        d = v.reshape(n, n, 2)
        q = (flat + bilinear(d, flat[:, 0], flat[:, 1], w, h)).reshape(p.shape)
        dv = q[:, 1:] - q[:, :-1]
        ang = (np.degrees(np.arctan2(dv[..., 1], dv[..., 0])) % 180.0).reshape(-1)
        sx = (d[:, 2:] - 2 * d[:, 1:-1] + d[:, :-2]).reshape(-1)
        sy = (d[2:] - 2 * d[1:-1] + d[:-2]).reshape(-1)
        # the part's overall width and height stay: mean stretch of x across and of y down, as shares of a cell
        grow = np.array([float((d[:, 1:, 0] - d[:, :-1, 0]).mean()) / (w / CELLS), float((d[1:, :, 1] - d[:-1, :, 1]).mean()) / (h / CELLS),
                         (5.0 if "z" in skip else 0.0) * float((d[1:, :, 0] - d[:-1, :, 0]).mean()) / (h / CELLS)])  # verticals kept
        return np.concatenate([sw * wrap(ang - t), SMOOTH * sx, SMOOTH * sy, HOLD * v, SCALE_HOLD * grow])

    v = least_squares(resid, np.zeros(n * n * 2), method="trf", x_scale=10.0).x
    return v.reshape(n, n, 2)


def apply_field(img: Image.Image, d: F64) -> Image.Image:
    """Warp the part forward by the grid d: each output pixel found by inverting x + d(x) with a few fixed-point steps."""
    w, h = img.size
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float64), np.arange(h, dtype=np.float64))
    fwd = bilinear(d, gx.ravel(), gy.ravel(), w, h)
    x0, y0 = np.floor((gx.ravel() + fwd[:, 0]).min()) - 2, np.floor((gy.ravel() + fwd[:, 1]).min()) - 2
    x1, y1 = np.ceil((gx.ravel() + fwd[:, 0]).max()) + 2, np.ceil((gy.ravel() + fwd[:, 1]).max()) + 2
    ow, oh = int(x1 - x0) + 1, int(y1 - y0) + 1
    qx: F64 = np.tile(np.arange(ow, dtype=np.float64) + float(x0), oh)
    qy: F64 = np.repeat(np.arange(oh, dtype=np.float64) + float(y0), ow)
    sx, sy = qx.copy(), qy.copy()
    for _ in range(8):
        dd = bilinear(d, sx, sy, w, h)
        sx, sy = qx - dd[:, 0], qy - dd[:, 1]
    a = np.asarray(img.convert("RGBA")).astype(np.float32) / 255.0
    pm = np.dstack([a[..., :3] * a[..., 3:4], a[..., 3:4]])
    mx = sx.reshape(oh, ow).astype(np.float32)
    my = sy.reshape(oh, ow).astype(np.float32)
    out = cv2.remap(pm, mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    return from_premultiplied(np.asarray(out, np.float64))


def from_premultiplied(out: F64) -> Image.Image:
    out = np.clip(out, 0.0, 1.0)
    al = out[..., 3:4]
    rgb = np.where(al > 1e-4, out[..., :3] / np.maximum(al, 1e-4), 0.0)
    res = (np.dstack([np.clip(rgb, 0, 1), al]) * 255.0 + 0.5).astype(np.uint8)
    im = Image.fromarray(res, "RGBA")
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def score(rep: dict[str, Family]) -> float:
    t, c = worst(rep)
    return t / TILT_MAX + c / CONV_MAX


def rectify(img: Image.Image, init: F64, skip: frozenset[str] = frozenset()) -> Image.Image:
    """The part warped into parallel 2:1 projection. The init map alone (the old shear or stretch) when that already
    passes the gate; otherwise the best scoring of it, the fitted homography, and the homography followed by the grid
    refinement. A candidate whose proportions (bbox height over width) move more than SHAPE_TOL from the init map's is
    dropped: straightening edges must not restretch the part (its height beside the people is set by its length)."""
    plain = warp(img, np.block([[init, np.zeros((2, 1))], [np.zeros((1, 2)), np.ones((1, 1))]]))
    if passes(report(plain, skip)):
        return plain
    tries = [plain]
    for persp in PERSPECTIVE:  # a nearly affine start and a freer one: which suits depends on the part
        cur = warp(img, fit(img, init, skip, persp))
        tries.append(cur)
        for _ in range(REFINE_ROUNDS):  # refine, find the edges again on the result, refine again
            d = refine_field(cur, skip)
            if d is None:
                break
            cur = apply_field(cur, d)
            tries.append(cur)
    r0 = plain.height / plain.width
    tries = [im for im in tries if abs(im.height / im.width / r0 - 1.0) <= SHAPE_TOL]
    return min(tries, key=lambda im: score(report(im, skip)))


@functools.lru_cache(maxsize=None)
def rectified(path: str, m: tuple[float, float, float, float], skip: frozenset[str] = frozenset()) -> Image.Image:
    """rectify() of the part file at path from the linear map m (row-major 2x2), cached: the scene builds the same
    counters many times. Callers must not change the image in place. With RECTIFY off: the plain map only (the
    pipeline as it was, for the gate's before numbers)."""
    img, lin = Image.open(path).convert("RGBA"), np.array(m, np.float64).reshape(2, 2)
    if not RECTIFY:
        return warp(img, np.block([[lin, np.zeros((2, 1))], [np.zeros((1, 2)), np.ones((1, 1))]]))
    return rectify(img, lin, skip)


def settle(img: Image.Image, skip: frozenset[str] = frozenset()) -> Image.Image:
    """A rectified part re-checked at the size it is placed at (the gate measures it there): unchanged when it passes,
    otherwise rectified again at that size. A short edge family (a shelf's two end rails) can read straight on the sheet
    and a few degrees off once scaled down, because Hough picks up a different side of the anti-aliased rail."""
    if not RECTIFY or passes(report(img, skip)):
        return img
    return rectify(img, np.eye(2), skip)


def shear_m(s: float) -> tuple[float, float, float, float]:
    """compose_iso2.shear(img, s) as a map for rectified(): y += s * x."""
    return (1.0, 0.0, s, 1.0)


def stretch_m(k: float) -> tuple[float, float, float, float]:
    """A vertical stretch by k (compose_iso2.to_2to1) as a map for rectified()."""
    return (1.0, 0.0, 0.0, k)


class GateRow(NamedTuple):
    label: str
    tilt: float  # worst family's |tilt|, degrees
    conv: float  # worst family's convergence, degrees across the part
    ok: bool
    detail: str


def gate(parts: list[tuple[str, Image.Image]], skip: dict[str, frozenset[str]]) -> list[GateRow]:
    """The projection gate over every placed part, once per distinct image; parts whose every family is skipped
    are not measured."""
    seen: set[int] = set()
    rows: list[GateRow] = []
    for label, im in parts:
        if id(im) in seen or skip.get(label, frozenset()) >= frozenset(TARGET):
            continue
        seen.add(id(im))
        rep = report(im, skip.get(label, frozenset()))
        t, c = worst(rep)
        rows.append(GateRow(label, t, c, passes(rep), describe(rep)))
    return rows


def shear_init(s: float) -> F64:
    """The linear part of compose_iso2.shear(img, s): y += s * x."""
    return np.array([[1.0, 0.0], [s, 1.0]])


def describe(rep: dict[str, Family]) -> str:
    return "  ".join(f"{f}: n {r.n} tilt {r.tilt:+.2f} conv {'-' if r.conv is None else f'{r.conv:.2f}'}" for f, r in rep.items())


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        print(Path(arg).name, describe(report(Image.open(arg))))
