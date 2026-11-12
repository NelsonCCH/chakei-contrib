"""Plan one image call: the magenta stage, its mask, the cell boxes, the style board and the prompt (no API call).

  python plan_sheet.py sheets/FA-SINK.json            # writes work/<id>/ and prints the cost ceiling

A sheet spec (JSON, see sheets/):
  id      sheet id; the cut parts go to ../art/parts/<id>/
  size    [w, h] in px: 1536x1024 for objects, 1024x1536 for people (edges multiples of 16)
  kind    "things" (furniture, equipment, decor, loose items), "food", or "people"
  board   [[sheet, part], ...]: up to 6 finished parts of the same kind for the style board
  things / food:
    what     one phrase, e.g. "piece of cha chaan teng kitchen equipment"
    camera   "iso" (2:1 floor items), "flat" (wall items), or "dish" (food on a table)
    scale    one sentence fixing the scale against the board ("" for none)
    items    [{"name", "zh", "look", "cell": [c0, r0, c1, r1], "grid": [cell_w, cell_h]}, ...]
             the cell spans columns c0..c1 and rows r0..r1 of a cell_w x cell_h grid
  people:
    people   [{"name", "zh", "look"}, ...] (1 or 2 per call: 3 facings each, a 3 x 2 grid)
  "zh" (optional): the local name, written before the look ("zh (look)"); it carries culture-specific detail the
  English alone loses. "name" is the part name the cut writes.

Writes work/<id>/stage.png (flat #FF00FF), mask.png (alpha 0 = cells to paint), boxes.json ({part: [x0, y0, x1, y1]},
for cut_sheet.py), board.png (the style board) and prompt.txt, and prints the image_call.py command for the call.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import TypeGuard

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import image_call  # noqa: E402

HERE = Path(__file__).resolve().parent
PARTS = HERE.parent / "art" / "parts"
KEY = (255, 0, 255)
CELL_MARGIN = 24  # px of untouched stage round each cell, so neighbours never touch
BOARD_BG = (226, 224, 220)  # the style board's plain light grey: clearly not the magenta stage

STYLE = ("Clean, high-resolution 2D game art in the colours and lighting of the reference pictures (warm fluorescent light "
         "from above and slightly in front, dark plum outlines, hue-shifted shading), crisp at full size: NOT pixelated, no "
         "pixel grid, no dithering. No text, no letters, no Chinese characters, no numbers, no logos.")
RULES = ("The background is flat pure magenta #FF00FF: keep it perfectly flat, with no floor, no cast shadow, no glow, no "
         "gradient and no magenta or pink anywhere on the objects. Each masked area holds exactly one thing, alone, not "
         "touching or holding anything else, centred, fully inside the area, standing on (or resting on) the bottom of the "
         "area. Keep everything outside the masked areas exactly unchanged.")
CAM = {"iso": "2:1 isometric game view (camera 30 degrees above the horizon, turned 45 degrees): the object's front faces "
              "down-left, floor edges run at exactly 26.6 degrees (two across, one down), verticals stay vertical, no "
              "vanishing point. Use exactly the camera of the board's counters and benches.",
       "flat": "Wall items are drawn flat and straight on, like a picture hung on a wall (a front view, no perspective).",
       "dish": "Each dish as it looks on a cafe table seen from the game camera (30 to 35 degrees above the table: a round "
               "plate looks about half as tall as it is wide), filling about two thirds of its area's width.",
       "char": "Camera 30 to 35 degrees above the horizon, no perspective distortion; the same height, scale and light in every "
               "area; standing still, arms relaxed, nothing in the hands except where described."}
FACE = [("q_front", "turned three-quarters, facing down-left"), ("side", "seen from the side, facing left"),
        ("q_back", "turned three-quarters away, facing up-left")]
MATCH = ("The second picture is a board of finished parts from the same game, on plain grey: it is a STYLE reference "
         "only. Do not copy its objects, its grey background or its layout. Draw the new items in exactly its style: the "
         "same outline weight and dark plum outline colour, the same soft hue-shifted shading and highlights, the same "
         "palette saturation (warm, slightly muted, never neon), the same level of detail and the same clean painted finish, "
         "so the new parts sit next to the old ones as one set.")
MATCH_PEOPLE = ("The second picture is a board of finished characters from the same game, on plain grey: a STYLE reference "
                "only, do not copy those people. Draw the new people in exactly that style: the same outline weight and dark "
                "plum outline colour, the same soft hue-shifted shading, the same palette saturation, the same face style, "
                "proportions and level of detail, at the same scale (adults as tall as the board's adults, filling the "
                "area's height the same way).")


def box(c0: int, r0: int, c1: int, r1: int, cw: int, ch: int) -> list[int]:
    """The cell spanning columns c0..c1 and rows r0..r1 (inclusive) of a cw x ch grid, with the margin."""
    return [c0 * cw + CELL_MARGIN, r0 * ch + CELL_MARGIN, (c1 + 1) * cw - CELL_MARGIN, (r1 + 1) * ch - CELL_MARGIN]


def grid(w: int, h: int, cols: int, rows: int) -> list[list[int]]:
    return [box(c, r, c, r, w // cols, h // rows) for r in range(rows) for c in range(cols)]


def stage(out: Path, w: int, h: int, boxes: dict[str, list[int]]) -> Path:
    """The flat key stage, the mask (alpha 0 inside every cell) and the cell boxes."""
    path = out / "stage.png"
    Image.new("RGB", (w, h), KEY).save(path)
    mask = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    d = ImageDraw.Draw(mask)
    for b in boxes.values():
        d.rectangle((b[0], b[1], b[2] - 1, b[3] - 1), fill=(0, 0, 0, 0))
    mask.save(out / "mask.png")
    (out / "boxes.json").write_text(json.dumps(boxes, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    return path


def board(out: Path, parts: list[tuple[str, str]]) -> Path:
    """The style board: the finished parts closest in kind, each scaled into a 3 x 2 grid on plain grey, no text."""
    path = out / "board.png"
    w, h, cols = 1536, 1024, 3
    img = Image.new("RGBA", (w, h), (*BOARD_BG, 255))
    cw, ch = w // cols, h // 2
    for i, (sheet, name) in enumerate(parts[:6]):
        p = Image.open(PARTS / sheet / f"{name}.png").convert("RGBA")
        bb = p.getbbox()
        if bb:
            p = p.crop(bb)
        k = min((cw - 60) / p.width, (ch - 60) / p.height)
        p = p.resize((max(1, round(p.width * k)), max(1, round(p.height * k))), Image.Resampling.LANCZOS)
        img.alpha_composite(p, ((i % cols) * cw + (cw - p.width) // 2, (i // cols) * ch + (ch - p.height) // 2))
    img.convert("RGB").save(path)
    return path


def is_list(x: object) -> TypeGuard[list[object]]:
    return isinstance(x, list)


def is_dict(x: object) -> TypeGuard[dict[str, object]]:
    return isinstance(x, dict)


def ints(x: object, n: int) -> list[int]:
    if not is_list(x) or len(x) != n:
        raise SystemExit(f"expected a list of {n} integers, got {x!r}")
    out = [v for v in x if isinstance(v, int)]
    if len(out) != n:
        raise SystemExit(f"expected a list of {n} integers, got {x!r}")
    return out


def records(x: object) -> list[dict[str, object]]:
    if not is_list(x):
        raise SystemExit(f"expected a list of objects, got {x!r}")
    out = [r for r in x if is_dict(r)]
    if len(out) != len(x):
        raise SystemExit(f"expected a list of objects, got {x!r}")
    return out


def item(r: dict[str, object]) -> str:
    return f"{r['zh']} ({r['look']})" if r.get("zh") else str(r["look"])


def plan(spec: dict[str, object]) -> tuple[Path, str, list[Path]]:
    sid = str(spec["id"])
    w, h = ints(spec["size"], 2)
    out = HERE / "work" / sid
    out.mkdir(parents=True, exist_ok=True)
    kind = str(spec["kind"])
    boxes: dict[str, list[int]] = {}
    if kind == "people":
        cells = grid(w, h, 3, 2)
        body: list[str] = []
        for p in records(spec["people"]):
            for key, facing in FACE:
                boxes[f"{p['name']}_{key}"] = cells[len(boxes)]
                body.append(f"{len(boxes)}. {item(p)}, {facing};")
        text = (f"Paint one person into each masked area of this magenta stage, left to right, top row first: {' '.join(body)} "
                f"Each person is identical in all three of their areas. {MATCH_PEOPLE} {CAM['char']} {RULES} {STYLE}")
    else:
        items = records(spec["items"])
        for it in items:
            c0, r0, c1, r1 = ints(it["cell"], 4)
            cw, ch = ints(it["grid"], 2)
            boxes[str(it["name"])] = box(c0, r0, c1, r1, cw, ch)
        body_t = " ".join(f"{i}. {item(it)};" for i, it in enumerate(items, 1))
        text = (f"Paint one {spec['what']} into each masked area of this magenta stage, left to right, top row first: {body_t} "
                f"{CAM[str(spec['camera'])]} {spec.get('scale', '')}{MATCH} {RULES} {STYLE}")
    st = stage(out, w, h, boxes)
    refs = spec["board"]
    if not is_list(refs):
        raise SystemExit("board: expected [[sheet, part], ...]")
    bd = board(out, [(str(r[0]), str(r[1])) for r in refs if is_list(r) and len(r) == 2])
    (out / "prompt.txt").write_text(text, encoding="utf-8", newline="\n")
    return out, f"{w}x{h}", [st, bd]


def main() -> None:
    spec: object = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if not is_dict(spec):
        raise SystemExit("a sheet spec is a JSON object")
    out, size, refs = plan(spec)
    prompt = (out / "prompt.txt").read_text(encoding="utf-8")
    est = image_call.estimate_usd(prompt, len(refs), size, "high")
    rel = [str(p.relative_to(HERE)).replace("\\", "/") for p in (out / "prompt.txt", *refs, out / "mask.png", out / "sheet.png")]
    print(f"{spec['id']}: {size}, {len(json.loads((out / 'boxes.json').read_text(encoding='utf-8')))} cells, estimate <= ${est:.4f}")
    print(f"python image_call.py --prompt-file {rel[0]} --ref {rel[1]} --ref {rel[2]} --mask {rel[3]} --size {size} "
          f"--quality high --out {rel[4]}")


if __name__ == "__main__":
    main()
