"""Cut sprites from a magenta key stage: no difference against a scene, only the reserved key
colour #FF00FF, which no asset may use. Works at the picture's full resolution (no downscale, no palette snap).

Per cell box: soft alpha from the colour distance to the key (dE76 in CIELAB, ramp KEY_IN..KEY_OUT), despill by
un-mixing the key out of every partly transparent pixel (observed = a * colour + (1 - a) * key), keep the cell's main
piece plus any piece at least MIN_SHARE of it (so a hand or a strap that the outline separates survives), trim, and
record the anchor (contact point = bottom row of the solid pixels, at their bbox's horizontal centre) and the gate numbers.
A secondary piece touching the cell border is the model painting outside its mask: dropped and counted (border_px).

  python keycut.py <picture.png> <boxes.json> <out_dir>
      boxes.json: {"name": [x0, y0, x1, y1], ...} in the picture's pixels

Writes <out_dir>/<name>.png (RGBA) and <out_dir>/parts.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import TypedDict

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from colour import srgb_to_lab  # noqa: E402

KEY = (255, 0, 255)
KEY_IN, KEY_OUT = 30.0, 60.0  # dE76 to the key: <= KEY_IN is fully stage, >= KEY_OUT fully object
CHROMA_FLOOR = 0.06  # chroma coverage at or below this is stage (a key repainted a few levels off pure #FF00FF)
STAGE_DE = 10.0  # a stage pixel this close to the key counts as clean stage (purity gate)
MIN_SHARE = 0.005  # pieces smaller than this share of the cell's main piece are stage noise
SOLID = 0.5  # alpha at or above which a pixel is "the object" for pieces, bbox and anchor


class Part(TypedDict):
    box: list[int]
    w: int
    h: int
    anchor: list[int]  # contact point in the sprite's own pixels: the solid bbox's horizontal centre, on its bottom row
    stage_purity: float  # share of stage pixels (alpha 0) within STAGE_DE of the key
    pieces: int  # solid pieces kept
    dropped_px: int  # solid pixels dropped as noise
    border_px: int  # solid pixels dropped because a secondary piece touched the cell border (paint outside the mask)
    touches_edge: bool  # the kept object reaches the cell border (clipped by the cell: a gate failure)
    spill_px: int  # outline pixels (within 2 px of transparent) that still look magenta after despill (R, B both > G + 40)


def key_de(rgb: np.ndarray) -> np.ndarray:
    key = srgb_to_lab(np.array([KEY], dtype=np.float64)).reshape(3)
    return np.sqrt(((srgb_to_lab(rgb.astype(np.float64)) - key) ** 2).sum(-1))


def coverage(rgb: np.ndarray) -> np.ndarray:
    """Exact coverage for colours not tinted magenta. Mixing colour F with the key at coverage a gives G = a*F_g and
    min(R, B) - G = (1 - a) * 255 whenever F has min(R, B) <= G, so a = 1 - (min(R, B) - G) / 255."""
    f = rgb.astype(float)
    return np.clip(1.0 - (np.minimum(f[..., 0], f[..., 2]) - f[..., 1]) / 255.0, 0.0, 1.0)


def soft_alpha(rgb: np.ndarray) -> np.ndarray:
    """Output alpha: the coverage, with a stage pixel a few levels off pure key read as 0 (CHROMA_FLOOR). Inside the
    object (2 px from any edge), a pixel far from the key in dE is opaque even if its coverage says less: that is an
    object colour leaning pink (a floral blouse), not a mix with the stage."""
    a = np.clip((coverage(rgb) - CHROMA_FLOOR) / (1.0 - CHROMA_FLOOR), 0.0, 1.0)
    far = key_de(rgb) >= KEY_OUT
    inside = ndimage.binary_erosion((a >= SOLID) | far, iterations=2)
    return np.where(inside & far, 1.0, a)


def despill(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Un-mix the key from partly covered pixels: colour = (observed - (1 - a) * key) / a, with a = the exact coverage
    (not the floored output alpha, which would leave a pink cast)."""
    a = np.where(alpha < 1.0, coverage(rgb), 1.0)[..., None]
    key = np.array(KEY, dtype=float)
    obs = rgb.astype(float)
    safe = np.maximum(a, 0.05)
    col = np.where(a < 1.0, (obs - (1.0 - a) * key) / safe, obs)
    return np.clip(np.rint(col), 0, 255).astype(np.uint8)


def cut_cell(rgb: np.ndarray) -> tuple[np.ndarray, Part]:
    alpha = soft_alpha(rgb)
    solid = alpha >= SOLID
    lbl, n = ndimage.label(solid)
    dropped = 0
    border_px = 0
    if n:
        sizes = np.asarray(ndimage.sum(solid, lbl, range(1, n + 1)), dtype=float)
        main = 1 + int(np.argmax(sizes))
        edge_ids = {int(i) for i in np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))} - {0, main}
        # a secondary piece on the cell border is the model painting outside its mask (a strip, a panel edge), not a part
        border_px = int(sum(sizes[i - 1] for i in edge_ids))
        keep_ids = np.array([int(i) for i in 1 + np.nonzero(sizes >= sizes.max() * MIN_SHARE)[0] if int(i) not in edge_ids])
        keep = np.isin(lbl, keep_ids)
        dropped = int(solid.sum() - keep.sum()) - border_px
        # the soft edge belongs to a kept piece if it touches one (2 px); stray soft pixels elsewhere go
        near = ndimage.binary_dilation(keep, iterations=2)
        alpha = np.where(near, alpha, 0.0)
        alpha[solid & ~keep] = 0.0
        n_kept = len(keep_ids)
    else:
        keep, n_kept = solid, 0
    col = despill(rgb, alpha)
    stage = alpha == 0.0
    purity = float((key_de(rgb)[stage] < STAGE_DE).mean()) if stage.any() else 0.0
    h, w = alpha.shape
    ys, xs = np.nonzero(keep)
    if len(ys) == 0:
        return np.zeros((1, 1, 4), np.uint8), {"box": [0, 0, 0, 0], "w": 0, "h": 0, "anchor": [0, 0], "stage_purity": round(purity, 4),
                                               "pieces": 0, "dropped_px": dropped, "border_px": border_px, "touches_edge": False, "spill_px": 0}
    ya, yb, xa, xb = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    pad = 3  # keep the soft edge around the solid bbox
    y0, y1, x0, x1 = max(0, ya - pad), min(h, yb + pad), max(0, xa - pad), min(w, xb + pad)
    rgba = np.dstack([col, np.rint(alpha * 255).astype(np.uint8)])[y0:y1, x0:x1]
    # x = the solid bbox's centre, not the lowest row's: on a 45-degree part the lowest row is one corner of the footprint
    anchor = [(xa + xb - 1) // 2 - x0, yb - 1 - y0]
    kept = rgba[..., 3] > 0
    outline = kept & ndimage.binary_dilation(~kept, iterations=2)  # fringe lives on the outline; pink inside is a real colour
    r, g, b = (rgba[..., i].astype(int) for i in range(3))
    spill = int((outline & (r > g + 40) & (b > g + 40)).sum())
    touches = ya == 0 or xa == 0 or yb == h or xb == w
    part: Part = {"box": [x0, y0, x1, y1], "w": x1 - x0, "h": y1 - y0, "anchor": anchor, "stage_purity": round(purity, 4),
                  "pieces": n_kept, "dropped_px": dropped, "border_px": border_px, "touches_edge": bool(touches), "spill_px": spill}
    return rgba, part


def run(picture: Path, boxes: dict[str, list[int]], out: Path) -> dict[str, Part]:
    rgb = np.asarray(Image.open(picture).convert("RGB"))
    out.mkdir(parents=True, exist_ok=True)
    parts: dict[str, Part] = {}
    for name, (x0, y0, x1, y1) in boxes.items():
        rgba, p = cut_cell(rgb[y0:y1, x0:x1])
        p["box"] = [p["box"][0] + x0, p["box"][1] + y0, p["box"][2] + x0, p["box"][3] + y0]  # in the picture's pixels
        Image.fromarray(rgba, "RGBA").save(out / f"{name}.png")
        parts[name] = p
    (out / "parts.json").write_text(json.dumps(parts, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    return parts


def main() -> None:
    picture, boxes, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    bx: dict[str, list[int]] = json.loads(boxes.read_text(encoding="utf-8"))
    for name, p in run(picture, bx, out).items():
        print(name, p["w"], "x", p["h"], "purity", p["stage_purity"], "pieces", p["pieces"], "edge", p["touches_edge"], "spill", p["spill_px"])


if __name__ == "__main__":
    main()
