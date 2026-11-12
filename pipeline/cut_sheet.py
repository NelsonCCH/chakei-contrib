"""Cut one generated sheet into parts and run the cut, angle, consistency and style gates (no API call).

  python cut_sheet.py <sheet id> [--sheet work/<id>/sheet.png] [--boxes work/<id>/boxes.json] [--kind things|people|food]
                      [--boxy a,b,...] [--glass a,...] [--swap a:b,...]

  --kind   the style gate's reference kind (default: people for a people sheet in plan_sheet.py, else things)
  --boxy   parts with box edges on the 2:1 grid: their drawn angle is measured and merged into
           ../art/parts/drawn_deg.json, which the compositor uses to shear each part onto the grid's 26.6 degrees
  --glass  see-through parts: alpha from the exact key coverage only (the stage seen through glass is a mix, not pink)
  --swap   cells the model filled with each other's item (found by eye on the contact sheet): name each by what it is

Steps: find the box each object was really drawn in (models often draw past their cell; cut by the drawn box, never the
cell, so nothing is clipped), keycut.py into ../art/parts/<id>/, then the gates. Writes work/<id>/gates.json and exits 1
when a gate fails. Look at the inspect_parts.py contact sheet as well: detectors miss merged objects and slivers.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import keycut as k  # noqa: E402
import style_gate as sg  # noqa: E402
from colour import srgb_to_lab  # noqa: E402

HERE = Path(__file__).resolve().parent
PARTS = HERE.parent / "art" / "parts"
GROW = 8  # px: pieces of one object this close together are one object (a rail's hanging pieces)
MIN_AREA = 1500  # px: smaller pieces are stage noise
PAD = 10  # px of stage kept round each drawn object
PURITY_MIN = 0.95  # share of stage pixels within dE 10 of the key (sheets so far: 99.6% or more)
SPILL_MAX = 20  # magenta-looking outline pixels allowed per part after despill
HEIGHT_SPREAD_MAX = 0.03  # one person's three facings: height spread
COLOUR_DE_MAX = 8.0  # one person's three facings: mean colour difference (dE76)
FACINGS = ("q_front", "side", "q_back")
Gate = dict[str, object]


def drawn_boxes(rgb: np.ndarray, planned: dict[str, list[int]]) -> dict[str, list[int]]:
    """Every solid piece of the sheet goes to the planned cell it overlaps most; a cell's box is the union of its pieces,
    padded. Cells with nothing drawn keep their planned box."""
    solid = k.soft_alpha(rgb) >= k.SOLID
    lbl, n = ndimage.label(ndimage.binary_dilation(solid, iterations=GROW))
    h, w = solid.shape
    out: dict[str, list[int]] = {}
    for sl, i in zip(ndimage.find_objects(lbl), range(1, n + 1), strict=True):
        if ((lbl[sl] == i) & solid[sl]).sum() < MIN_AREA:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop

        def overlap(b: list[int]) -> int:
            return max(0, min(x1, b[2]) - max(x0, b[0])) * max(0, min(y1, b[3]) - max(y0, b[1]))

        name = max(planned, key=lambda nm: overlap(planned[nm]))
        if overlap(planned[name]) == 0:
            continue
        b = out.get(name, [x0, y0, x1, y1])
        out[name] = [min(b[0], x0), min(b[1], y0), max(b[2], x1), max(b[3], y1)]
    return {nm: ([max(0, b[0] - PAD), max(0, b[1] - PAD), min(w, b[2] + PAD), min(h, b[3] + PAD)] if (b := out.get(nm)) else pb)
            for nm, pb in planned.items()}


def recut_glass(rgb: np.ndarray, boxes: dict[str, list[int]], names: set[str], out: Path, parts: dict[str, k.Part]) -> None:
    keep = k.KEY_OUT
    k.KEY_OUT = 1e9  # alpha from the coverage alone
    try:
        for nm in names & set(boxes):
            x0, y0, x1, y1 = boxes[nm]
            rgba, p = k.cut_cell(rgb[y0:y1, x0:x1])
            p["box"] = [p["box"][0] + x0, p["box"][1] + y0, p["box"][2] + x0, p["box"][3] + y0]
            Image.fromarray(rgba, "RGBA").save(out / f"{nm}.png")
            parts[nm] = p
    finally:
        k.KEY_OUT = keep
    (out / "parts.json").write_text(json.dumps(parts, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")


def slope(alpha: np.ndarray) -> float:
    """The diagonal actually drawn: the strongest silhouette edge direction between 5 and 60 degrees off horizontal."""
    a = ndimage.gaussian_filter(alpha.astype(float), 1.5)
    gx, gy = ndimage.sobel(a, axis=1), ndimage.sobel(a, axis=0)
    mag = np.hypot(gx, gy)
    on = mag > mag.max() * 0.25
    ang = (np.degrees(np.arctan2(-gy[on], gx[on])) + 90.0) % 180.0  # the edge runs across the gradient; y points down
    s = np.minimum(ang, 180.0 - ang)
    sel = (s > 5.0) & (s < 60.0)
    hist, edges = np.histogram(s[sel], bins=110, range=(5.0, 60.0), weights=mag[on][sel])
    i = int(np.argmax(hist))
    return float((edges[i] + edges[i + 1]) / 2)


def mean_lab(path: Path) -> np.ndarray:
    a = np.asarray(Image.open(path).convert("RGBA"))
    return srgb_to_lab(a[a[..., 3] >= 128][:, :3].astype(np.float64)).mean(0)


def gate(name: str, value: str, ok: bool) -> Gate:
    return {"gate": name, "value": value, "ok": ok}


def cut_gates(parts: dict[str, k.Part], planned: dict[str, list[int]], boxes: dict[str, list[int]]) -> list[Gate]:
    pur = min(p["stage_purity"] for p in parts.values())
    multi = [nm for nm, p in parts.items() if p["pieces"] > 1]
    empty = [nm for nm, p in parts.items() if p["pieces"] == 0]
    edge = [nm for nm, p in parts.items() if p["touches_edge"]]
    spill = max(p["spill_px"] for p in parts.values())
    outside = [nm for nm, p in parts.items() if p["border_px"] > 0]
    grown = [nm for nm in planned if boxes[nm][0] + PAD < planned[nm][0] or boxes[nm][1] + PAD < planned[nm][1]
             or boxes[nm][2] - PAD > planned[nm][2] or boxes[nm][3] - PAD > planned[nm][3]]
    return [gate("stage purity", f"min {pur:.1%}", pur >= PURITY_MIN),
            gate("one piece per cell", f"empty: {empty or 'none'}; several pieces: {multi or 'none'}", not empty and not multi),
            gate("no edge touch", f"{edge or 'none'}", not edge),
            gate("no magenta fringe", f"max {spill} outline px", spill <= SPILL_MAX),
            # informational: paint outside the mask is dropped by the cut; drawing past the cell is cut by the drawn box
            gate("paint outside the mask (dropped)", f"{outside or 'none'}", True),
            gate("drawn past the cell (cut by the drawn box)", f"{grown or 'none'}", True)]


def people_gates(out: Path, parts: dict[str, k.Part]) -> list[Gate]:
    res: list[Gate] = []
    for who in sorted({n.rsplit("_", 1)[0].removesuffix("_q") for n in parts}):
        names = [f"{who}_{f}" for f in FACINGS if f"{who}_{f}" in parts]
        if len(names) < 2:
            continue
        hs = [parts[n]["h"] for n in names]
        spread = (max(hs) - min(hs)) / max(hs)
        de = max(float(np.sqrt(((mean_lab(out / f"{a}.png") - mean_lab(out / f"{b}.png")) ** 2).sum()))
                 for a in names for b in names if a < b)
        res += [gate(f"{who}: height spread across facings", f"{spread:.1%}", spread <= HEIGHT_SPREAD_MAX),
                gate(f"{who}: colour drift across facings", f"dE {de:.1f}", de <= COLOUR_DE_MAX)]
    return res


def arg(flag: str, default: str = "") -> str:
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


def names(flag: str) -> list[str]:
    return [n for n in arg(flag).split(",") if n]


def main() -> None:
    sid = sys.argv[1]
    work = HERE / "work" / sid
    sheet = Path(arg("--sheet", str(work / "sheet.png")))
    planned: dict[str, list[int]] = json.loads(Path(arg("--boxes", str(work / "boxes.json"))).read_text(encoding="utf-8"))
    kind = arg("--kind", "people" if all(n.endswith(FACINGS) for n in planned) else "things")
    rgb = np.asarray(Image.open(sheet).convert("RGB"))
    boxes = drawn_boxes(rgb, planned)
    for pair in names("--swap"):
        a, b = pair.split(":")
        boxes[a], boxes[b] = boxes[b], boxes[a]
        planned[a], planned[b] = planned[b], planned[a]
    out = PARTS / sid
    parts = k.run(sheet, boxes, out)
    recut_glass(rgb, boxes, set(names("--glass")), out, parts)
    gates = cut_gates(parts, planned, boxes)
    deg_file = PARTS / "drawn_deg.json"
    degs: dict[str, float] = json.loads(deg_file.read_text(encoding="utf-8")) if deg_file.exists() else {}
    for n in names("--boxy"):
        a = np.asarray(Image.open(out / f"{n}.png").convert("RGBA"))[..., 3] / 255.0
        degs[n] = round(slope(a), 2)
        gates.append(gate(f"{n}: drawn angle", f"{degs[n]} deg (sheared to 26.6 when composed)", True))
    if names("--boxy"):
        deg_file.write_text(json.dumps(degs, indent=1) + "\n", encoding="utf-8", newline="\n")
    if kind == "people":
        gates += people_gates(out, parts)
    lim = sg.limits(sg.reference(kind))
    for n in parts:
        bad = sg.outliers(sg.measure(out / f"{n}.png"), lim)
        gates.append(gate(f"{n}: style ({kind})", f"outliers: {bad or 'none'}", not bad))
    work.mkdir(parents=True, exist_ok=True)
    (work / "gates.json").write_text(json.dumps(gates, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    for g in gates:
        print("PASS" if g["ok"] else "FAIL", g["gate"], "|", g["value"])
    sys.exit(0 if all(g["ok"] for g in gates) else 1)


if __name__ == "__main__":
    main()
