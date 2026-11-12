"""Minimal OpenAI image call (GPT Image): a generation, or an edit with reference images and an optional mask.

  python image_call.py --prompt-file p.txt --ref stage.png --ref board.png --mask mask.png \
      --size 1536x1024 --quality high --out sheet.png
  python image_call.py ... --estimate        # print the cost ceiling only (no API call)

Reads the key from the OPENAI_API_KEY environment variable only. Rules kept from production use:
  - a dated model snapshot, never a moving alias, and explicit size / quality / background (never `auto`);
  - never retry automatically (a timeout may already have billed); a failed item goes into the next planned call;
  - refuse a call whose estimate is above --max-usd.
The first --ref is the image being edited (the magenta stage); the mask must be the same size, alpha 0 = repaint.
Prices below were read from the provider's pricing page in late 2026: re-check them before paid calls.
"""

from __future__ import annotations

import argparse
import base64
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import TypeGuard

import requests

MODEL = "gpt-image-2.5-sunburst-2026-09-08"  # the snapshot the shipped art was made with (best editing precision)
PRICE = {"in_text": 5.00, "in_image": 8.00, "out_image": 30.00}  # USD per 1M tokens (GPT Image 2.5)
OUT_BASE = {"low": 16, "medium": 24, "high": 48}  # the provider's output-token calculator base per quality
MIME = {".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
TIMEOUT_S = 300


def check_size(size: str) -> tuple[int, int]:
    m = re.fullmatch(r"(\d+)x(\d+)", size)
    if not m:
        raise SystemExit(f"--size must be WxH, got {size!r}")
    w, h = int(m[1]), int(m[2])
    if w % 16 or h % 16 or max(w, h) > 3840 or not 655_360 <= w * h <= 8_294_400 or max(w, h) / min(w, h) > 3:
        raise SystemExit(f"--size {size}: edges multiples of 16, <= 3840, ratio <= 3:1, 655,360-8,294,400 pixels")
    return w, h


def estimate_usd(prompt: str, n_refs: int, size: str, quality: str) -> float:
    """Ceiling: calculator output tokens + prompt chars / 3 + 1,000 tokens per reference image, plus 25%."""
    w, h = check_size(size)
    base = OUT_BASE[quality]
    out_tok = math.ceil(base * round(base / (max(w, h) / min(w, h))) * (2e6 + w * h) / 4e6)
    usd = (out_tok * PRICE["out_image"] + len(prompt) / 3 * PRICE["in_text"] + 1000 * n_refs * PRICE["in_image"]) / 1e6
    return round(usd * 1.25, 4)


def is_dict(x: object) -> TypeGuard[dict[str, object]]:
    return isinstance(x, dict)


def is_list(x: object) -> TypeGuard[list[object]]:
    return isinstance(x, list)


def sub_dict(d: dict[str, object], key: str) -> dict[str, object]:
    v = d.get(key)
    return v if is_dict(v) else {}


def num(d: dict[str, object], key: str, default: int = 0) -> int:
    v = d.get(key, default)
    return int(v) if isinstance(v, (int, float)) else default


def cost_usd(usage: dict[str, object]) -> float:
    din, dout = sub_dict(usage, "input_tokens_details"), sub_dict(usage, "output_tokens_details")
    in_img = num(din, "image_tokens")
    in_txt = num(din, "text_tokens", num(usage, "input_tokens") - in_img)
    out_img = num(dout, "image_tokens", num(usage, "output_tokens"))
    return round((in_txt * PRICE["in_text"] + in_img * PRICE["in_image"] + out_img * PRICE["out_image"]) / 1e6, 4)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--ref", action="append", default=[], help="reference / input image (repeatable); the first is edited")
    ap.add_argument("--mask", help="PNG with alpha, same size as the first --ref; alpha 0 = area to repaint")
    ap.add_argument("--model", default=MODEL)
    ap.add_argument("--size", required=True)
    ap.add_argument("--quality", default="high", choices=list(OUT_BASE))
    ap.add_argument("--background", default="opaque", choices=["opaque", "transparent"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-usd", type=float, default=0.20, help="refuse if the estimate is above this")
    ap.add_argument("--estimate", action="store_true", help="print the cost ceiling and exit (no API call)")
    a = ap.parse_args()

    prompt = Path(a.prompt_file).read_text(encoding="utf-8")
    if not re.search(r"-\d{4}-\d{2}-\d{2}$", a.model):
        raise SystemExit(f"model {a.model!r} looks like a moving alias; pass a dated snapshot id")
    refs = [Path(r) for r in a.ref]
    for r in refs:
        if not r.exists() or r.suffix.lower() not in MIME:
            raise SystemExit(f"reference not found or not png/jpg/webp: {r}")
    est = estimate_usd(prompt, len(refs), a.size, a.quality)
    print(f"model {a.model}, {a.size}, quality {a.quality}, {a.background}, refs={len(refs)}: estimate <= ${est:.4f}")
    if a.estimate:
        return
    if est > a.max_usd:
        raise SystemExit(f"estimate ${est:.4f} is above --max-usd {a.max_usd}; raise it explicitly if intended")
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise SystemExit("set the OPENAI_API_KEY environment variable")
    auth = {"Authorization": f"Bearer {key}"}
    form = {"model": a.model, "prompt": prompt, "size": a.size, "quality": a.quality, "background": a.background,
            "output_format": "png", "n": 1, "moderation": "auto"}
    t0 = time.time()
    try:
        if refs:
            files = [("image[]", (r.name, r.read_bytes(), MIME[r.suffix.lower()])) for r in refs]
            if a.mask:
                files.append(("mask", (Path(a.mask).name, Path(a.mask).read_bytes(), "image/png")))
            resp = requests.post("https://api.openai.com/v1/images/edits", headers=auth, files=files,
                                 data={k: str(v) for k, v in form.items()}, timeout=TIMEOUT_S)
        else:
            resp = requests.post("https://api.openai.com/v1/images/generations", headers=auth, json=form, timeout=TIMEOUT_S)
    except requests.RequestException as e:
        raise SystemExit(f"request failed ({type(e).__name__}); it may still have billed, so do not blindly retry")
    body: object = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    data = body if is_dict(body) else {}
    if resp.status_code != 200:
        msg = sub_dict(data, "error").get("message") or resp.text
        raise SystemExit(f"HTTP {resp.status_code}: {str(msg)[:300]}")
    items = data.get("data")
    first = items[0] if is_list(items) and items else None
    if not is_dict(first) or not isinstance(first.get("b64_json"), str):
        raise SystemExit("no image in the response")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(base64.b64decode(str(first["b64_json"])))
    usage = sub_dict(data, "usage")
    cost = cost_usd(usage) if usage else est
    print(f"saved {out} (${cost:.4f} by the usage returned, {time.time() - t0:.1f} s)")


if __name__ == "__main__":
    sys.exit(main())
