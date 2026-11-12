# Art pipeline

How the restaurant floor art (a 2:1 isometric Hong Kong cha chaan teng: a dining hall plus cutaway department rooms)
was made, how the game consumes it, and how to make matching new parts. Every step is a
script in `pipeline/`, run from that folder.

```
art/atlas/       floor_0.png (+ floor_0.webp), floor.json   what the game loads
art/parts/       <sheet id>/<part>.png, drawn_deg.json       the cut source parts the atlas is baked from
pipeline/        plan -> image call -> cut + gates -> inspect -> compose -> export
pipeline/sheets/ example sheet specs (the sheets the shipped room and floor parts came from)
```

Setup: `pip install -r pipeline/requirements.txt` (Python 3.11+). Tests: `cd pipeline && python -m pytest`.
Only `image_call.py` touches the network; it reads `OPENAI_API_KEY` from the environment.

## 1. Style

- **Modern high-detail ("HD", hi-bit) pixel art, painted.** Many colours, soft hue-shifted shading, a thin dark
  **plum** outline (not black), warm fluorescent light from above and slightly in front, warm and slightly muted
  saturation (never neon). It reads as pixel art at phone size but is not a retro budget.
- **No pixel grid, no palette snap, no dithering.** Image models draw soft pseudo-pixels (about 8 raw px) with no
  detectable grid; snapping to a grid or a small palette was tried and loses detail. Draw at 2x or more of the largest
  size shown on a device (a 3x phone is 1170 px wide) and scale down by filtering only.
- **Scale premultiplied, draw smoothed.** `compose_base.scaled()` resizes in premultiplied RGBa with Lanczos (no dark
  fringe). In the game, turn `imageSmoothingEnabled` on (quality `high`) around art `drawImage` calls.
- **No text on any sprite.** Signs, labels and numbers are drawn by code. Every part may be mirrored.
- **Magenta `#FF00FF` is reserved** as the key colour and appears in no asset (0% of people, furniture or food pixels
  measured within dE 25 of it; teal, the runner-up, had 1% of food pixels near it).

## 2. Generating images

GPT Image 2.5 (snapshot `gpt-image-2.5-sunburst-2026-09-08`, the best at masked edits), quality `high`, through the
`/v1/images/edits` endpoint. One call = one **sheet**:

1. `python plan_sheet.py sheets/<id>.json` writes `work/<id>/`:
   - `stage.png`: flat `#FF00FF`, the image being edited;
   - `mask.png`: alpha 0 inside each cell (the areas to paint), cells 24 px in from their grid lines so neighbours
     never touch;
   - `boxes.json`: `{part name: [x0, y0, x1, y1]}`, one cell per item;
   - `board.png`: the **style board**, up to six finished parts of the same kind, cropped, scaled into a 3 x 2 grid on
     plain light grey (226, 224, 220), no text. Grey, so it cannot be mistaken for the stage or its layout copied;
   - `prompt.txt`.
2. `python image_call.py --prompt-file work/<id>/prompt.txt --ref work/<id>/stage.png --ref work/<id>/board.png
   --mask work/<id>/mask.png --size 1536x1024 --quality high --out work/<id>/sheet.png` (plan_sheet prints it).
   `--estimate` prints the cost ceiling without calling. No automatic retries: a failed item goes into the next call.

**Prompt shape** (built by `plan_sheet.py`; the shipped sheets' prompts are reproduced exactly from `sheets/*.json`):

1. The task and the items, in cell order (left to right, top row first), each with its local name and a concrete
   look: material, colour, size in metres, what it holds, which way its long front faces.
2. **One camera, written into every prompt.** Floor items: "2:1 isometric game view (camera 30 degrees above the
   horizon, turned 45 degrees): the object's front faces down-left, floor edges run at exactly 26.6 degrees (two
   across, one down), verticals stay vertical, no vanishing point." Wall items: flat, straight on. Dishes: seen from
   30-35 degrees above the table (a round plate about half as tall as wide). People: 30-35 degrees above the horizon,
   no perspective, standing still, three facings (3/4 front facing down-left, side facing left, 3/4 back facing
   up-left).
3. One scale for all, tied to an object on the board ("the prep counter there is about 1.5 m long and waist-high").
4. The style match: the board is a style reference only; match its outline weight and plum colour, shading,
   saturation, detail and finish.
5. The stage rules: background stays flat pure magenta, no floor, no cast shadow, no glow, no magenta on the objects;
   one thing per masked area, alone, centred, inside it, resting on its bottom edge; everything outside the masks
   unchanged.
6. Negatives last: not pixelated, no text, letters, Chinese characters, numbers or logos.

Name exact colours where the model drifts (milk tea came out orange until the prompt said "muted greyish tan-beige,
café-au-lait, not orange"). A blank sign must be asked for twice.

**Sizes and items per call.** Edges multiples of 16, at most 3840, aspect at most 3:1, 0.66-8.3 megapixels.

| Sheet | Size | Layout | Items |
|---|---|---|---|
| Furniture / equipment / decor | 1536x1024 | 3 x 2 cells of 512 (wide items span 2), or 4 x 2 of 384 x 512 | 3-8 |
| People | 1024x1536 | 3 x 2 cells: 2 people x 3 facings | 1-2 people |
| Long strip (cheapest per pixel) | 3840x1280 | 2-3 rows of ~400 px slots | up to ~24 |

Each item needs a slot of about 400 raw px. Past about 25 different names in one prompt the model starts swapping
details and making similar items alike (it failed at 64); one to three people per call keeps features from bleeding
between people.

**Cost** (re-check prices before paid calls): a 1536x1024 high-quality masked edit with two reference images is about
US$0.07 per call; `image_call.py`'s estimate is a ceiling. A 3840x1280 strip costs about the same
as a 1024x1536 portrait while holding about 3x the pixels.

**Glass and see-through items:** on magenta, ice and glass pick up a purple cast. Either cut them with coverage-only
alpha (`cut_sheet.py --glass`, used for the roast case) or generate with `--background transparent` and "drawn with
opaque colours", then threshold alpha at 128 before slicing (the API leaves a faint low-alpha haze).

## 3. Cutting and gates

`python cut_sheet.py <id> [--boxy a,b] [--glass a] [--swap a:b] [--kind things|people|food]` cuts
`work/<id>/sheet.png` into `art/parts/<id>/<part>.png` (+ `parts.json`) and writes `work/<id>/gates.json`.

**Key cut (`keycut.py`), at full resolution, per cell:**
- Coverage per pixel: mixing a colour F with the key at coverage a gives G = a·F_g and min(R, B) − G = (1 − a)·255,
  so a = 1 − (min(R, B) − G) / 255. Coverage at or below 0.06 is stage. Inside the object (2 px from any edge) a pixel
  at least dE 60 from the key stays opaque even if its coverage says less (a pink blouse is real, not stage).
- **Despill:** un-mix the key from every partly covered pixel: colour = (observed − (1 − a)·key) / a.
- Keep the main piece plus any piece at least 0.5% of it (a strap the outline separates); drop secondary pieces that
  touch the cell border (paint outside the mask); anchor = the solid box's horizontal centre on its bottom row.
- **Cut by the drawn box, not the cell:** models often draw past their cell. `cut_sheet.py` assigns every solid piece
  (grown 8 px, at least 1500 px) to the cell it overlaps most, and cuts each part by the union of its pieces + 10 px.
- If the model fills two cells with each other's item, `--swap a:b` names each by what it is (found by eye).

**Gates (fail = fix or regenerate in the next call):** stage purity (share of stage pixels within dE 10 of the key)
at least 95% (the shipped sheets: 97.7-100%); one piece per cell, none empty; no part touching its cut box's edge;
at most 20 outline pixels still magenta after despill (outline only: pink inside is a real colour). People: the three
facings agree in height within 3% and in mean colour within dE 8 (shipped: 0.2-1.1% and dE 2.5-5.1; one cook reached
dE 13.4 because his front apron is not visible from the back, accepted by eye).

**Drawn angle (`--boxy`):** models drift off the 2:1 grid (parts came back at 11-28 degrees). The strongest silhouette
edge between 5 and 60 degrees is measured and stored in `art/parts/drawn_deg.json`; the compositor shears each part
from that angle to 26.57 degrees. Record it; do not regenerate for it.

**Why not difference cuts.** An earlier method painted objects into a full scene and cut each out by differencing
against an emptied copy of the scene. The model repaints every pixel on every edit (removal edits even redrew the
patterned floor everywhere), so the difference fills with noise, and the cleanup that fights the noise also removes
real features (a tanned arm on salmon floor tiles was peeled away). Shadows cut by difference were noise every time,
and people drawn into a furnished scene carried slivers of bench. A flat key stage with one item per cell has none of
these problems. Backgrounds (walls, floors) stay whole pictures or code.

**Shadows are code, never art.** The prompt forbids cast shadows; the game draws them at the anchor (section 6).

**Inspection (`inspect_parts.py <parts dir> <out prefix>`):** a contact sheet of every part at 5x on magenta, black,
white, a brick wall and grey, plus detectors (alpha junk, islands, second piece, pinholes, 1 px slits, spurs, stray
dark/light dots, background-coloured edge). Pass with zero hits or a written reason per hit, and look at the sheet:
detectors miss merged objects and slivers. Soft alpha edges are expected on these painted parts (`alpha_junk` counts
them).

## 4. Style gate (`style_gate.py`)

Five numbers per part, each at one common size (longest side 512 px): mean HSV saturation and value of the solid
pixels; outline darkness (mean luminance of the outer 2 px ring); line density (dark pixels, luminance < 0.35, in the
outer 8 px band per px of perimeter); edge sharpness (90th-percentile luminance gradient inside the part over its
10-90% luminance spread). A metric is an outlier outside the reference parts' range of the same kind (`things`,
`people`, `food`; `style_gate.REFERENCE`) widened by 25% each side. It is a flag, not a verdict: confirm with
`compose_rooms.style_strip()` (reference parts above a line, new parts below, at scene scale). Known content
outliers: a tray of meat against the white-plate food references; a cook's bare arms outlined in skin tone.

The atlas export re-runs the gate at atlas size against the reference parts baked the same way (metrics shift with
size). Five light steel/paper parts with a thin outline (pass, ticket rail, cups, bag pile, noodle boiler) fail line
density only at atlas size and are accepted in `export_atlas.ACCEPTED`.

## 5. Projection gate and rectification (`projection.py`)

Canny edges (luminance over grey plus the alpha outline) and HoughLinesP, sorted into three families: along u (26.57
deg), along v (153.43 deg) and vertical. Per family, tilt = length-weighted median error; convergence = slope of a
weighted fit of angle against position (a perspective box converges). Pass: tilt <= 1.5 deg and convergence <= 2.0 deg
(tighter is measurement noise). `rectify()` fixes a failing part with a bounded near-affine homography plus a smooth
grid warp that turns every detected edge onto its family's angle, holding scale and proportions. The compositor gates
every placed furniture/equipment part at its placed size; `compose_iso2.PROJ_SKIP` lists families skipped by design
(the booth's reclining backrest, the round stool, the hood's and griddle's sloped side panels).

## 6. Atlas and manifest (the contract the game reads)

`python export_atlas.py [--out DIR]` composes the scene from `art/parts` (rectified, sheared, widened,
category-scaled), bakes every part at its final size, halves it to atlas size, packs pages of at most 2048 x 2048
(2 px clear padding) and writes `floor_<n>.png` + `floor.json`. It exits 1 if any gate fails (listed in
`gates.failed`). Today: 105 parts on one 2048 x 1539 page (about 4.3 MB PNG; the WebP copy is about 0.8 MB, same layout
and identical alpha; the manifest names the PNG). Positions change with every export: always read them from the
manifest.

**Units and camera.** Floor coordinates (u, v) in art tiles: u along the right-hand back wall, v along the left-hand
back wall, (0, 0) the back corner. Screen: `x = ox + (u - v) * TW / 2`, `y = oy + (u + v) * TH / 2 - z` with the
game's tile TW 32 / TH 16 logical px. One art tile is about 0.32 m (3.1 tiles per metre; an adult is 1.70 m).
Atlas density: 64 atlas px per tile width (`tile_px`), i.e. 2 atlas px per logical px at TW 32: draw a part with
`drawImage(page, x, y, w, h, dx, dy, w * S / 2, h * S / 2)`, S = scene scale. The camera the art was made for shows
about 18 tiles across a phone (`S ≈ 0.68 × CSS width / 390`); large shops pan.

**Part fields.** `page, x, y, w, h` (the rectangle on its page, padding outside), `kind`, `anchor`, `mirror` (always
true) and per kind:

| Field | Meaning |
|---|---|
| `kind` | `furniture` (benches, stools, counters), `table`, `equipment` (room stations), `hung` (the hood), `loose` (pots, urns, cups, bags, crates, trays), `wall` (flat decor), `person`, `dish` |
| `anchor` | sprite px placed on the floor point: footprint centre at floor level (furniture, tables, equipment); between the feet (people); base centre (dishes, loose); lowest pixel's centre (`hung`, its lip 1.95 m up the wall); centre (`wall`, hung at its height on the wall) |
| `foot` | footprint half extents `[a, b]` in tiles along u and v: blocks walking, places the shadow |
| `top_h` | tables: top surface height above the floor point, atlas px (dishes stand there) |
| `hips`, `head` | people: hip row and head-top row, sprite px from the top |
| `faces`, `role`, `look` | people: facing, `customer` or `staff`, the look id |
| `name`, `category`, `radius_tiles` | dishes: the dish (Cantonese name), size class, footprint radius |
| `shadow` | code shadow strength; 0 = none |
| `wall` | wall/hung parts: drawn for wall `L` (u = 0 plane) or `R` (v = 0 plane); mirror for the other |

**Category scale** (baked in; make new parts to match). People: height = 1.75 × the booth backrest × a per-look
factor (adult 1.0, granny 0.90 ... see `compose_iso2.PEOPLE`), an adult ≈ 294 atlas px. Booth backrest 0.57 of a
person (≈ 168 px); seat 0.42 and tabletop 0.58 of the backrest; counters 0.95. Booth table as long as the bench, top
half depth 1.40 tiles; square table half side 1.75 tiles. Dish footprint diameter in tiles: main plate 1.15, bowl 0.85×,
toast 0.70×, cup and glass 0.52× of that (a floor circle of radius r tiles is 90.5 r atlas px wide). Equipment: its
length chosen for a true height beside people.

**Draw order.** Floor, walls, wall and hung parts, then the floor-shadow layer, then parts in painter's order by
depth = u + v of the ground contact point, back to front. Booth (table end against a wall): far bench → far diner →
table → dishes (table depth + 0.002) → near diner → near bench. Square table: diners only on the two far sides, so the
top hides their legs; far stools → diners → table → dishes → near stools. Staff behind a counter: drawn before it,
cut at the counter's top edge + 7 atlas px.

**Seated people** reuse the standing art: place the sprite so its `hips` row sits at the seat point raised by the seat
height, drop every row below the hips, and let the occluder (tabletop or near backrest) cover the body between its top
edge and the hips. Never leave a body cut flat in mid-air with nothing in front of the hip line.

**Shadows** (tint (70, 35, 30), drawn before any part; pre-render one blurred shape per size class and stamp it):

| What | Shape | Alpha | Blur |
|---|---|---|---|
| Furniture, equipment | footprint quad grown 0.08 tiles each side | `shadow` (0.32; stools 0.25) | Gaussian σ 4.5 atlas px |
| Tables | footprint quad at 0.8 of `foot` | 0.22 | σ 4.5 |
| Loose items on the floor | quad 0.35 × their width each way | `shadow` | σ 4.5 |
| Standing people | ellipse 0.75 × sprite width wide, half as tall, at the feet | 0.35 | σ 3.5 |
| Dishes | ellipse 0.85 × dish width, 0.3 of that tall, at the base | 0.33, tint (70, 45, 35) | σ 2 |

**Facing and mirroring.** `q_front` faces +v (down-left), mirrored +u (down-right); `q_back` faces -u (up-left),
mirrored -v (up-right). Mirror with `ctx.scale(-1, 1)` about the anchor: mirrored anchor x = `w - 1 - ax`, and `foot`
swaps `[a, b] → [b, a]`. Side views carry their native facing in `faces` (`left`/`right`). Walkers use the 3/4 view for
their diagonal plus a code bob (2 atlas px, about 4 steps per second); there are no walk frames. `waiter_tray_*`
replaces the waiter while he carries a delivery.

**Customer looks.** 9 customer looks; a party label (free text) picks them by `looks.py`, also stored in the
manifest's `looks` block: the first matching pattern gives member k's candidates; FNV-1a 32-bit of the UTF-8 string
`"<group id>:<member index>"` picks the start (`fnv1a("a") = 0xe40c292c`); then the first candidate not seated at a
neighbouring table (within 9.5 tiles) and not used earlier in the party.

## 7. Adding a new part

1. Write a sheet spec in `pipeline/sheets/` (copy the closest example): the items with concrete looks and sizes in
   metres, cells on the grid, and a `board` of up to six finished parts closest in kind (`art/parts/<sheet>/<part>`).
   Batch additions until a call is reasonably full: one item costs the whole call.
2. `python plan_sheet.py sheets/<id>.json`, check `work/<id>/board.png` and `prompt.txt`, then run the printed
   `image_call.py` command (one paid call, about US$0.07).
3. `python cut_sheet.py <id> --boxy <names of boxy floor parts> [--glass ...]`; fix or re-queue anything that fails.
4. `python inspect_parts.py ../art/parts/<id> work/<id>/inspect` and look at the sheet.
5. Add the part to the compositor: a person goes into `compose_iso2.PEOPLE` (sheet, height factor), plus
   `export_atlas.SIDE_FACES` / `STAFF`; a dish into `compose_iso2.FOOD`, `DISH_SHEETS` and `PLATE_BASE`; furniture or
   equipment into the room that places it in `compose_rooms.py` (`equip(..., half_len)`, sized by eye beside the people;
   boxy equipment also into `export_atlas.EQUIPMENT`).
6. `python compose_rooms.py` writes preview pictures to `pipeline/out/` (whole building, a phone-size crop and the
   style strip) and runs the projection gate; look at them. Set CJK_FONT to a bold CJK .ttf/.ttc for the Chinese
   labels on room signs and bubbles in these previews (without it they render as boxes; the atlas has no text).
7. `python export_atlas.py` re-bakes `art/atlas/`; it fails rather than ship a part that breaks a gate.

To add a new *kind* of view (another camera), measure it the same way: state the camera in every prompt, measure the
drawn angle of each part, and shear in code.

## 8. Free local alternative: FLUX.2 [klein] 4B

FLUX.2 [klein] 4B (Apache 2.0: outputs usable in a free or paid game) runs locally with `diffusers` at about a second
per object, so 10-50 seeds per item cost nothing and you pick by eye. On objects it came close to GPT Image and was
very consistent on characters across seeds; it knows less Hong Kong detail (spell out things like the silk-stocking tea
bag or red-rim cups) and needs more words for scenes. Feeding an existing picture as the reference image keeps layout
and style, as it does with GPT Image. It was evaluated on single objects and characters, not on this masked key-stage
pipeline, and none of the shipped parts came from it: expect to adapt the prompts and cut, then run the same gates.
Use no LoRA unless its licence and training data allow commercial use (the FLUX.1-dev pixel-art LoRAs are
non-commercial; the one pixel-art LoRA for klein degraded it).
