# Art

These are the restaurant floor graphics generated for this game: a 2:1 isometric Hong Kong cha chaan teng with a dining
hall and cutaway department rooms (furniture, kitchen and bar equipment, wall decor, dishes and drinks, 9 customer looks
and 6 staff plus the waiter carrying a tray, each in 3/4 front, 3/4 back and side views). They are painted "HD pixel art" made with OpenAI GPT Image
masked edits on a flat magenta key stage, cut out by key, and passed through cut, projection and style gates.
`atlas/` holds what the game loads (`floor_0.png`, a lossy `floor_0.webp` copy of the same page, and the manifest
`floor.json` with each part's rectangle, anchor, footprint and facing); `parts/<sheet>/<part>.png` holds the
full-resolution cut source parts the atlas is baked from (plus `drawn_deg.json`, the angle each boxy part was drawn at),
grouped by the generation sheet they came from. `../pipeline/export_atlas.py` rebuilds the atlas from them exactly; see
`../docs/ART_PIPELINE.md` for the contract and how to make matching new parts.
