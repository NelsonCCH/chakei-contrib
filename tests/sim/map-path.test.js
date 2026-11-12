// Walkable shop maps: on every map level's layout (src/core/map/layout.ts, the main ladder and
// 地獄午市), a person of WALKER_R tiles' radius (STAFF_R for the staff behind their counters) can walk from the entrance to
// every table, every station's spot, the till's paying spot, every member of staff and the queue on the pavement, never through a wall or a
// piece of furniture. Walls: the back walls (the map's edges), the partition in front of the rooms with its openings,
// the walls between rooms with their doors, the two front walls with the entrance. Furniture: every table's footprint
// (booth benches, stools) and every placed part with an atlas footprint (FOOT); small floor parts without one get a
// 0.6-tile square. A breadth-first search on a 0.25-tile grid over the obstacles grown by the walker's radius.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { join } from 'node:path';
import { LEVELS } from './levels.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CODE = buildSync({ entryPoints: [join(ROOT, 'src', 'core', 'map', 'layout.ts')], bundle: true, format: 'cjs', platform: 'neutral', target: 'es2022', write: false, logLevel: 'error' }).outputFiles[0].text;
export const M = (() => { const module = { exports: {} }; new Function('module', 'exports', CODE)(module, module.exports); return module.exports; })();

/** A person's half width in tiles (a tile is about 0.32 m): a customer or the floor staff in the hall and on the
 *  pavement, 0.8 (a 0.5 m wide walker); the cooks, the barman and the cashiers in their rooms, behind their counters,
 *  0.6 (0.4 m: turned a little sideways, as staff squeeze behind a cha chaan teng counter). */
const WALKER_R = 0.8, STAFF_R = 0.6;
const CELL = 0.25;
/** Wall-hung or counter-top parts: not in the walker's way. */
const OVERHEAD = new Set(['hood', 'urns']);
const SMALL = 0.6;

/** The map levels (floor-map.ts mapShop): the main ladder 1-7 and 地獄午市. */
const MAP_LEVELS = Object.keys(LEVELS).filter(id => { const L = LEVELS[id]; return !L.era && !L.fest && (L.n <= 7 || !!L.hell); });

export function walkable(L, R = WALKER_R) {
  const U = L.W + M.PAVE, V = L.D + M.PAVE, nu = Math.ceil(U / CELL), nv = Math.ceil(V / CELL);
  const rects = [];   // [u0, u1, v0, v1] obstacles before growing
  const T = M.WALL_T / 2;
  // the partition (v = STRIP) with its openings
  const cut = (a0, a1, gaps) => { const out = []; let s = a0; for (const [g0, g1] of [...gaps].sort((x, y) => x[0] - y[0])) { if (g0 > s) out.push([s, Math.min(g0, a1)]); s = Math.max(s, g1); } if (s < a1) out.push([s, a1]); return out; };
  for (const [a, b] of cut(0, L.W, L.gaps)) rects.push([a, b, M.STRIP - T, M.STRIP + T]);
  // the walls between rooms, each with its door near the partition (layout.ts stubPieces [STRIP - 4.5, STRIP - 1.0])
  for (const r of L.rooms.slice(0, -1)) for (const [a, b] of cut(0, M.STRIP, [[M.STRIP - 4.5, M.STRIP - 1.0]])) rects.push([r.u1 - T, r.u1 + T, a, b]);
  // the front walls: u = W with the entrance, v = D whole
  for (const [a, b] of cut(0, L.D, [L.door])) rects.push([L.W - T, L.W + T, a, b]);
  rects.push([0, L.W + T, L.D - T, L.D + T]);
  for (const t of L.tables) rects.push(t.box);
  for (const p of L.parts) {
    if (OVERHEAD.has(p.part)) continue;
    const f = M.FOOT[p.part] ?? [SMALL, SMALL];
    rects.push([p.u - f[0], p.u + f[0], p.v - f[1], p.v + f[1]]);
  }
  const free = new Uint8Array(nu * nv);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u = (i + 0.5) * CELL, v = (j + 0.5) * CELL;
    // the back walls are the map's edges: keep the walker's radius off them
    let ok = u >= R && v >= R && u <= U - R && v <= V - R;
    if (ok) for (const [u0, u1, v0, v1] of rects) { if (u > u0 - R && u < u1 + R && v > v0 - R && v < v1 + R) { ok = false; break; } }
    free[i * nv + j] = ok ? 1 : 0;
  }
  const at = (u, v) => [Math.floor(u / CELL), Math.floor(v / CELL)];
  /** The free cell nearest (u, v) within `reach` tiles, or null. */
  const near = (u, v, reach) => {
    let best = null, bd = 1e9;
    const [ci, cj] = at(u, v), k = Math.ceil(reach / CELL);
    for (let i = Math.max(0, ci - k); i <= Math.min(nu - 1, ci + k); i++) for (let j = Math.max(0, cj - k); j <= Math.min(nv - 1, cj + k); j++) {
      if (!free[i * nv + j]) continue;
      const d = Math.hypot((i + 0.5) * CELL - u, (j + 0.5) * CELL - v);
      if (d <= reach && d < bd) { bd = d; best = i * nv + j; }
    }
    return best;
  };
  // flood from just inside the entrance
  const start = near(L.W - 1.2, (L.door[0] + L.door[1]) / 2, 1.5);
  const seen = new Uint8Array(nu * nv);
  if (start !== null) {
    const q = [start]; seen[start] = 1;
    while (q.length) {
      const c = q.pop(), i = Math.floor(c / nv), j = c % nv;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nu || b >= nv) continue;
        const n = a * nv + b;
        if (free[n] && !seen[n]) { seen[n] = 1; q.push(n); }
      }
    }
  }
  /** Can the walker stand within `reach` tiles of (u, v), reached from the entrance? */
  const reach = (u, v, r) => {
    const [ci, cj] = at(u, v), k = Math.ceil(r / CELL);
    for (let i = Math.max(0, ci - k); i <= Math.min(nu - 1, ci + k); i++) for (let j = Math.max(0, cj - k); j <= Math.min(nv - 1, cj + k); j++) {
      if (seen[i * nv + j] && Math.hypot((i + 0.5) * CELL - u, (j + 0.5) * CELL - v) <= r) return true;
    }
    return false;
  };
  return { start, reach, free, seen, nu, nv };
}

/** Every place a walker must get to on a level's map, with how close (tiles) counts as there. */
export function targets(L) {
  const out = [];
  // a table: beside its footprint on its open sides (a wall booth is open on +u; any table on +u or +v)
  for (const t of L.tables) {
    const [u0, u1, v0, v1] = t.box, mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
    out.push({ what: `table ${t.tid} (${t.kind})`, u: u1 + WALKER_R, v: mv, r: 1.0, alt: t.wall ? null : { u: mu, v: v1 + WALKER_R } });
  }
  for (const s of L.spots) out.push({ what: `spot ${s.kind}`, u: s.u, v: s.v + (s.kind === 'deliver' ? 0 : WALKER_R), r: 1.2 });
  out.push({ what: 'till (paying spot)', u: L.till.pay[0], v: L.till.pay[1], r: 1.0 });
  for (const s of L.staff) out.push({ what: `staff ${s.look} at (${s.u.toFixed(1)}, ${s.v.toFixed(1)})`, u: s.u, v: s.v, r: 1.2, staff: true });
  // the queue on the pavement
  for (const [k, party] of M.queueSpots(L, [4, 4, 4, 4]).entries()) out.push({ what: `queue party ${k}`, u: party[0][0], v: party[0][1], r: 1.0 });
  return out;
}

test('every map level is walkable: the entrance reaches every table, station, staff member, the till and the pavement', () => {
  assert.ok(MAP_LEVELS.length >= 8, 'the map levels: ' + MAP_LEVELS.join(','));
  const bad = {};
  for (const id of MAP_LEVELS) {
    const lv = LEVELS[id], L = M.mapLayout({ tables: lv.lay.tables.map(([kind]) => ({ kind })), roles: lv.roles ?? {} });
    const w = walkable(L), ws = walkable(L, STAFF_R);
    assert.notEqual(w.start, null, `${id}: room to stand inside the entrance`);
    const miss = targets(L).filter(t => { const g = t.staff ? ws : w; return !g.reach(t.u, t.v, t.r) && !(t.alt && g.reach(t.alt.u, t.alt.v, t.r)); }).map(t => t.what);
    if (miss.length) bad[id] = miss;
  }
  assert.deepEqual(bad, {}, `unreachable from the entrance (customers ${WALKER_R * 2} tiles wide, staff ${STAFF_R * 2})`);
});
