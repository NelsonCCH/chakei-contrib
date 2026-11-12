"""Inspect cut-out parts by eye and by detector: contact sheets of every part on contrasting backgrounds at
5x zoom, plus per-part defect detectors.

  python inspect_parts.py <parts dir> <out prefix> [--bg <background png> --meta <parts.json>]

Sheets: <out prefix>_sheet.png, one row per part: magenta, black, white, a red brick wall, each at 5x (nearest).
Detectors (all on the game-resolution sprite; thresholds tuned on the first drinks-bar parts):
  - alpha_junk: alpha values other than 0 and 255
  - islands: opaque components (8-connected) under ISLAND_PX, apart from the largest
  - pinholes: transparent components fully enclosed by the part and under PINHOLE_PX (a 1-3 px gap inside a body)
  - spurs: pixels hanging off the body by one pixel (wire ends excluded)
  - extra_piece: a second sizeable piece (a neighbour's corner, or a real part, listed with a reason)
  - slits: enclosed 1 px wide transparent cracks
  - wall_key: pixels of the wall's key colour (the bar's green tile, lit or shaded) in a non-glass part
  - dark_dots / light_dots: single pixels inside the body whose lightness differs from all 8 neighbours by more than
    DOT_DL while those neighbours agree with each other (a speck in a flat region)
  - bg_edge: edge pixels whose colour equals the old background under them (needs --bg and --meta: the background
    the part was cut from, at game resolution, and the part's home offset)
Writes <out prefix>_detect.json: {part: {detector: [ [x, y], ... ] }} (empty lists when clean).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from colour import srgb_to_lab  # noqa: E402

ZOOM = 5
ISLAND_PX, PINHOLE_PX, DOT_DL, DOT_FLAT, BG_DE, BG_WIN = 20, 4, 28.0, 10.0, 5.0, 3
EIGHT = np.ones((3, 3), bool)


def lab(rgb: np.ndarray) -> np.ndarray:
    return srgb_to_lab(rgb.reshape(-1, 3).astype(np.float64)).reshape(rgb.shape)


def brick(h: int, w: int) -> np.ndarray:
    out = np.zeros((h, w, 3), np.uint8)
    out[:] = (150, 62, 48)
    for y in range(h):
        if y % 6 == 5:
            out[y] = (205, 190, 170)
        off = 0 if (y // 6) % 2 == 0 else 6
        for x in range(w):
            if (x + off) % 12 == 11:
                out[y, x] = (205, 190, 170)
    return out


def backgrounds(h: int, w: int) -> list[np.ndarray]:
    return [np.full((h, w, 3), c, np.uint8) for c in ((255, 0, 255), (0, 0, 0), (255, 255, 255))] + [brick(h, w)]


def on(bg: np.ndarray, spr: np.ndarray) -> np.ndarray:
    a = spr[..., 3:4].astype(np.float64) / 255
    return (bg * (1 - a) + spr[..., :3] * a).astype(np.uint8)


def detect(spr: np.ndarray, under: np.ndarray | None = None, glass: bool = False) -> dict[str, list[list[int]]]:
    a8 = spr[..., 3]
    a = a8 > 0
    out: dict[str, list[list[int]]] = {}

    def pts(m: np.ndarray) -> list[list[int]]:
        return [[int(x), int(y)] for y, x in zip(*np.nonzero(m))]
    out["alpha_junk"] = pts((a8 > 0) & (a8 < 255))
    lbl, n = ndimage.label(a, EIGHT)
    isl = np.zeros_like(a)
    extra = np.zeros_like(a)
    if n > 1:
        sizes = np.asarray(ndimage.sum(a, lbl, range(1, n + 1)), np.float64)
        big = int(np.argmax(sizes)) + 1
        for i, s in enumerate(sizes, 1):
            if i != big:
                if s < ISLAND_PX:
                    isl |= lbl == i
                else:  # a second sizeable piece: a neighbour's part, or a real part of the object (listed with a reason)
                    ys, xs = np.nonzero(lbl == i)
                    extra[ys[0], xs[0]] = True
    out["islands"] = pts(isl)
    out["extra_piece"] = pts(extra)
    hl, hn = ndimage.label(~a)
    pin = np.zeros_like(a)
    slit = np.zeros_like(a)
    border = set(np.unique(np.concatenate([hl[0], hl[-1], hl[:, 0], hl[:, -1]])))
    for i in range(1, hn + 1):
        if i not in border:
            comp = hl == i
            if comp.sum() < PINHOLE_PX:
                pin |= comp
            elif not ndimage.binary_opening(comp, np.ones((2, 2), bool)).any():
                slit |= comp
    out["pinholes"] = pts(pin)
    out["slits"] = pts(slit)
    eight = ndimage.convolve(a.astype(int), np.ones((3, 3), int), mode="constant") - a
    body = a & (eight >= 4)
    near_body = ndimage.binary_dilation(body, EIGHT)
    out["spurs"] = pts(a & (eight <= 1) & ((eight == 0) | near_body) & ~isl)  # wire ends (neighbour not in a body) excluded
    L = lab(spr[..., :3])[..., 0]
    pad = np.pad(L, 1, mode="edge")
    apad = np.pad(a, 1)
    nb = np.stack([pad[1 + dy:1 + dy + L.shape[0], 1 + dx:1 + dx + L.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx])
    na = np.stack([apad[1 + dy:1 + dy + L.shape[0], 1 + dx:1 + dx + L.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx])
    inside = a & na.all(0)
    flat = (nb.max(0) - nb.min(0)) < DOT_FLAT
    out["dark_dots"] = pts(inside & flat & (nb.min(0) - L > DOT_DL))
    out["light_dots"] = pts(inside & flat & (L - nb.max(0) > DOT_DL))
    if under is not None and under.shape[:2] == a.shape:
        edge = a & ~ndimage.binary_erosion(a)
        ls, lu = lab(spr[..., :3]), lab(under[..., :3])
        h, w = a.shape
        r = BG_WIN // 2
        pu = np.pad(lu, ((r, r), (r, r), (0, 0)), mode="edge")
        de = np.full((h, w), 1e9)
        for dy in range(BG_WIN):
            for dx in range(BG_WIN):
                de = np.minimum(de, np.sqrt(((ls - pu[dy:dy + h, dx:dx + w]) ** 2).sum(-1)))
        out["bg_edge"] = pts(edge & (de < BG_DE))
        # the wall's key colour (its dominant chromatic colour, lit or shaded) anywhere in a non-glass part
        chroma = np.hypot(lu[..., 1], lu[..., 2])
        cab = lu[chroma > 13][:, 1:]
        if (chroma > 13).mean() > 0.25 and not glass and np.median(np.hypot(*(cab - np.median(cab, axis=0)).T)) < 5:
            kab = np.median(lu[chroma > 13][:, 1:], axis=0)
            kL = float(np.median(lu[chroma > 13][:, 0]))
            key = (np.hypot(ls[..., 1] - kab[0], ls[..., 2] - kab[1]) < 10) & (ls[..., 0] > max(45.0, kL - 45)) & (ls[..., 0] < kL + 12)
            out["wall_key"] = pts(a & key)
    return out


def run(parts_dir: Path, prefix: Path, bg: np.ndarray | None, meta: dict[str, dict[str, int]] | None, glass: set[str],
        names: list[str] | None = None) -> dict[str, dict[str, list[list[int]]]]:
    files = [p for p in sorted(parts_dir.glob("*.png")) if not p.stem.endswith("_shadow")]
    if names is not None:
        files = [p for p in files if p.stem in names]
    sprites = {p.stem: np.asarray(Image.open(p).convert("RGBA")) for p in files}
    res: dict[str, dict[str, list[list[int]]]] = {}
    for k, spr in sprites.items():
        under = None
        if bg is not None and meta is not None and k in meta:
            x, y = meta[k]["x"], meta[k]["y"]
            h, w = spr.shape[:2]
            under = bg[y:y + h, x:x + w]
        res[k] = detect(spr, under, k in glass)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    (prefix.parent / f"{prefix.name}_detect.json").write_text(json.dumps(res, indent=0), encoding="utf-8")
    sheet(sprites, res, prefix.parent / f"{prefix.name}_sheet.png")
    return res


def sheet(sprites: dict[str, np.ndarray], res: dict[str, dict[str, list[list[int]]]], out: Path) -> None:
    """One row per part on four backgrounds at ZOOM; detector hits ringed in cyan on a fifth copy (on grey)."""
    from PIL import ImageDraw
    pad = 8
    rows: list[Image.Image] = []
    for k, spr in sprites.items():
        h, w = spr.shape[:2]
        tiles = [on(b, spr) for b in backgrounds(h, w)]
        grey = on(np.full((h, w, 3), 128, np.uint8), spr)
        tiles.append(grey)
        imgs = [Image.fromarray(t).resize((w * ZOOM, h * ZOOM), Image.Resampling.NEAREST) for t in tiles]
        d = ImageDraw.Draw(imgs[-1])
        for ps in res[k].values():
            for x, y in ps:
                d.rectangle((x * ZOOM - 2, y * ZOOM - 2, x * ZOOM + ZOOM + 1, y * ZOOM + ZOOM + 1), outline=(0, 255, 255))
        rw = sum(i.width for i in imgs) + pad * (len(imgs) + 1)
        row = Image.new("RGB", (rw, h * ZOOM + 2 * pad + 14), (60, 60, 60))
        ImageDraw.Draw(row).text((pad, 2), f"{k}  " + " ".join(f"{d}:{len(v)}" for d, v in res[k].items() if v), fill=(255, 255, 255))
        x = pad
        for i in imgs:
            row.paste(i, (x, pad + 14))
            x += i.width + pad
        rows.append(row)
    W = max(r.width for r in rows)
    H = sum(r.height for r in rows)
    canvas = Image.new("RGB", (W, H), (60, 60, 60))
    y = 0
    for r in rows:
        canvas.paste(r, (0, y))
        y += r.height
    canvas.save(out)


def main() -> None:
    parts_dir, prefix = Path(sys.argv[1]), Path(sys.argv[2])
    bg: np.ndarray | None = None
    meta: dict[str, dict[str, int]] | None = None
    if "--bg" in sys.argv:
        bg = np.asarray(Image.open(sys.argv[sys.argv.index("--bg") + 1]).convert("RGBA"))
        meta = json.loads(Path(sys.argv[sys.argv.index("--meta") + 1]).read_text(encoding="utf-8"))
    glass: set[str] = set(sys.argv[sys.argv.index("--glass") + 1].split(",")) if "--glass" in sys.argv else set()
    res = run(parts_dir, prefix, bg, meta, glass)
    tot: dict[str, int] = {}
    for k, r in res.items():
        hits = {d: len(v) for d, v in r.items() if v}
        if hits:
            print(k, hits)
        for d, v in r.items():
            tot[d] = tot.get(d, 0) + len(v)
    print("totals", tot)


if __name__ == "__main__":
    main()
