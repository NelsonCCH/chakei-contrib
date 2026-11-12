"""Style gate: does a new part look like the reference set? Every new part is measured against the reference parts of
its kind (furniture and fittings, people, food) on five numbers, each at one common size (longest side STD px):

  sat        mean HSV saturation of the solid pixels (palette saturation)
  val        mean HSV value (palette brightness)
  outline    mean luminance of the outermost OUTLINE_RING px (how dark the outline is; lower = darker)
  line_px    dark pixels (luminance < DARK) in the outer BAND px per px of perimeter (outline thickness)
  sharp      90th-percentile luminance gradient inside the part over its 10-90% luminance spread (edge crispness,
             independent of the part's own contrast; a soft or painterly render scores low, flat vector art high)

A metric is an outlier when it falls outside the reference parts' range widened by WIDEN of that range on each side.
The gate is a flag for a look, not a verdict: a side-by-side strip (compose_rooms.style_strip) is judged by eye.

  python style_gate.py <part.png> [things|people|food]     # prints the metrics and any outliers
"""

from __future__ import annotations

from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

STD = 512
OUTLINE_RING = 2
BAND = 8
DARK = 0.35
WIDEN = 0.25
METRICS = ("sat", "val", "outline", "line_px", "sharp")
METRIC_ZH = {"sat": "飽和度", "val": "明度", "outline": "描邊深淺", "line_px": "描邊粗幼", "sharp": "邊緣銳利"}

PARTS = Path(__file__).resolve().parent.parent / "art" / "parts"
REFERENCE: dict[str, list[tuple[str, str]]] = {  # kind -> reference (sheet, part): the parts new art must match
    "things": [("I-COUNTER", n) for n in ("counter", "cake_case", "till")] + [("B1-DEPT", n) for n in ("bar", "takeaway", "pass")]
              + [("I-FURN", n) for n in ("bench_front", "bench_back", "booth_table", "stool", "square_table", "clock", "tv", "sign")]
              + [("F-FURN", n) for n in ("clock", "tv", "sign")],
    "people": [(s, f"{w}_{f}") for s, who in (("B1-STAFF", ("cashier", "barman")), ("B1-CHAR", ("granny", "schoolgirl")),
                                              ("I-CHAR-1", ("worker", "housewife")), ("I-CHAR-2", ("office_lady", "waiter")))
               for w in who for f in ("q_front", "side", "q_back")],
    "food": [("FOOD-N", f"dish_{i}") for i in range(6)] + [("FOOD-N2", f"dish_{i}") for i in range(6, 12)]
            + [("B1-FOOD", f"dish_{i}") for i in range(12, 18)],
}


Style = dict[str, float]  # metric -> value, keys METRICS


def measure(path: Path) -> Style:
    return measure_img(Image.open(path).convert("RGBA"))


def measure_img(img: Image.Image) -> Style:
    bb = img.getbbox()
    if bb:
        img = img.crop(bb)
    k = STD / max(img.size)
    img = img.convert("RGBa").resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.Resampling.LANCZOS).convert("RGBA")
    a = np.asarray(img)
    solid = a[..., 3] >= 200
    hsv = np.asarray(img.convert("RGB").convert("HSV")).astype(float) / 255
    lum = np.asarray(img.convert("RGB").convert("L")).astype(float) / 255
    ring = solid & ~ndimage.binary_erosion(solid, iterations=OUTLINE_RING)
    band = solid & ~ndimage.binary_erosion(solid, iterations=BAND)
    edge = solid & ~ndimage.binary_erosion(solid)
    inner = ndimage.binary_erosion(solid, iterations=BAND)
    gy, gx = np.gradient(lum)
    grad = np.hypot(gx, gy)[inner]
    li = lum[inner]
    spread = float(np.percentile(li, 90) - np.percentile(li, 10)) if li.size else 1.0
    return {"sat": float(hsv[..., 1][solid].mean()), "val": float(hsv[..., 2][solid].mean()), "outline": float(lum[ring].mean()),
            "line_px": float((band & (lum < DARK)).sum() / max(int(edge.sum()), 1)),
            "sharp": float(np.percentile(grad, 90) / max(spread, 0.05)) if grad.size else 0.0}


def reference(kind: str) -> dict[str, Style]:
    return {f"{s}/{n}": measure(PARTS / s / f"{n}.png") for s, n in REFERENCE[kind]}


def limits(ref: dict[str, Style]) -> dict[str, tuple[float, float]]:
    out: dict[str, tuple[float, float]] = {}
    for m in METRICS:
        vals = [r[m] for r in ref.values()]
        lo, hi = min(vals), max(vals)
        out[m] = (lo - WIDEN * (hi - lo), hi + WIDEN * (hi - lo))
    return out


def outliers(s: Style, lim: dict[str, tuple[float, float]]) -> list[str]:
    return [m for m in METRICS if not lim[m][0] <= s[m] <= lim[m][1]]


def main() -> None:
    import sys  # noqa: PLC0415

    path = Path(sys.argv[1])
    kind = sys.argv[2] if len(sys.argv) > 2 else "things"
    s = measure(path)
    print({m: round(v, 3) for m, v in s.items()}, "outliers:", outliers(s, limits(reference(kind))) or "none")


if __name__ == "__main__":
    main()
