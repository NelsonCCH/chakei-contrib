// Taps on the shop map (ui/floor-map.ts): pans the camera to the thing, redraws, and clicks its bubble (or the
// table) with the real pointer, so the tap goes through the map's own hit test and handlers.

/**
 * What to tap: { k: 'spot', spot: 'pass' | 'bag' | 'deliver' | 'roast' }, { k: 'table', tid } (its bubble, or
 * the table itself when it has none), { k: 'group', gid } (a party in the queue outside).
 * Returns { ok, x, y, why } (CSS px of the page where it clicked).
 */
export async function mapTap(page, want) {
  const at = await page.evaluate(w => {
    // draw first: mapLook centres with the canvas size of the last draw, which is stale right after a mini-game screen
    // closes (the floor's canvas is back at another height before the page's next frame draws it)
    drawFloorIso(performance.now());
    const L = mapNow();
    if (!L) return { ok: false, why: 'no map' };
    if (w.k === 'spot') { const s = L.spots.find(x => x.kind === w.spot); if (!s) return { ok: false, why: 'no spot ' + w.spot }; mapLook(s.u, s.v); }
    else if (w.k === 'table') { const t = L.tables.find(x => x.tid === w.tid); if (!t) return { ok: false, why: 'no table ' + w.tid }; mapLook(t.u, t.v); }
    else mapLook(L.W, (L.door[0] + L.door[1]) / 2 + 3);
    drawFloorIso(performance.now());
    const same = a => a && a.k === w.k && (w.k === 'spot' ? a.spot === w.spot : w.k === 'table' ? a.tid === w.tid : a.gid === w.gid);
    const r = FSC.tv.getBoundingClientRect(), b = mapBubbles().find(x => same(x.act));
    // the point must be on the map's canvas, where a finger lands on it (not under the HUD, not past the canvas's edge)
    const onMap = (x, y, why) => {
      const e = document.elementFromPoint(x, y);
      return e === FSC.tv ? { ok: true, x, y, why } : { ok: false, x, y, why: `(${Math.round(x)}, ${Math.round(y)}) is not on the map but on ${e ? e.id || e.tagName : 'nothing'}` };
    };
    if (b) return onMap(r.left + b.x, r.top + b.y);
    if (w.k === 'table') { const t = L.tables.find(x => x.tid === w.tid), p = mapToScreen(t.u, t.v, 20); return onMap(r.left + p.x, r.top + p.y, 'table'); }
    return { ok: false, why: 'no bubble for ' + JSON.stringify(w) + ' among ' + JSON.stringify(mapBubbles().map(x => x.act)) };
  }, want);
  if (!at.ok) return at;
  await page.mouse.click(at.x, at.y);
  return at;
}
/** The map's bubbles now: their kinds ('spot:pass', 'table:3', 'group:12'). */
export const mapKinds = page => page.evaluate(() => mapBubbles().map(b => b.act.k === 'spot' ? 'spot:' + b.act.spot : b.act.k === 'table' ? 'table:' + b.act.tid : 'group:' + b.act.gid));
