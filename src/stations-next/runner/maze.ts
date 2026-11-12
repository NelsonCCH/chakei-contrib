// 傳菜 runner: the tuning knobs and the floor-plan generator, ported 1:1 from the playtested original
// prototype. Pure: no DOM, no clock, no Math.random. A floor plan is a function of
// (seed, difficulty) only, so the station state keeps the seed and the plan is rebuilt (and memoised) on demand.
import type { Difficulty } from '../contract';

/** A floor-plan tier: the three difficulties, plus 'first', the simple plans of the shop's level 1. */
export type Floor = Difficulty | 'first';
export const isFloor = (x: unknown): x is Floor => x === 'first' || x === 'rookie' || x === 'pro' || x === 'ace';

/* ======================= TUNING KNOBS (all in one place, as in the original prototype) ======================= */
// Units: the floor is 9 x 16 units (1 unit ~ one small table). Speeds in units/s, accelerations in units/s^2.
export interface RunnerDiff {
  name: string; maze: readonly [number, number]; braid: number; rooms: number; room: readonly [number, number]; puddles: number;
  holeR: number; capV: number; dmg: number; wv: readonly [number, number]; stool: number; far: number;
}
export const TUNE = {
  grid: { w: 9, h: 16 },
  r: 0.30,             // the waiter (ball) radius
  clear: 0.06,         // extra room the maze check demands beyond the ball radius (gap >= 2 * (r + clear))
  // Tilt: full tilt = tiltMax degrees away from the calibrated level. acc = acceleration at full tilt straight down
  // the slope (empty-handed); nothing else pushes the ball except the gentle cup of an open pocket, which is drawn.
  tiltMax: 16, dead: 0.03, lowpass: 0.05,
  acc: 7.0, damp: 1.0, roll: 0.5,     // top speed ~ (acc - roll) / damp = 6.5 whatever the tray carries
  wet: { damp: 0.12, roll: 0.05 },    // on a puddle: almost no friction, you slide
  // Inertia by orders still on the tray: tilt force, drag and rolling friction are all divided by this.
  mass: [1, 1.7, 2.5],
  e: 0.35, eGuest: 0.5,
  tapV: 1.3,           // impact speed (into the obstacle) below this is a free brush
  pull: 2.0,           // units/s^2, an open pocket is a shallow cup: inside its rim the ball is drawn to the centre
  sinkK: 0.6,          // sink when the centre is inside sinkK x pocket radius and the speed is under capV
  rw: 0.28,            // walking customer radius
  hp: 100,             // health; damage per hit = dmg x (impact - tapV + 0.3), x guestK for a customer
  guestK: 1.6, hardDmg: 30,
  walls: { booth: 0.5, tables: 0.36, counter: 0.34, partition: 0.22 },
  stoolGap: 1.0,       // a stool beside a table row never narrows the way below this (the waiter is 0.6 wide)
  diff: {
    // level 1 in the shop: a small maze with wide corridors and loops, no dining rooms (so no walking customers)
    // and no puddles; the original prototype never uses it, so the three tiers below stay 1:1 with it
    first: { name: '第一日', maze: [3, 5], braid: 0.3, rooms: 0, room: [2, 2], puddles: 0, holeR: 0.62, capV: 2.6, dmg: 6, wv: [0.5, 0.6], stool: 0.2, far: 0.3 },
    rookie: { name: '新人', maze: [4, 7], braid: 0.14, rooms: 1, room: [2, 2], puddles: 1, holeR: 0.55, capV: 2.4, dmg: 8, wv: [0.55, 0.70], stool: 0.5, far: 0.35 },
    pro: { name: '熟手', maze: [5, 8], braid: 0.07, rooms: 2, room: [3, 2], puddles: 2, holeR: 0.48, capV: 2.0, dmg: 11, wv: [0.60, 0.80], stool: 0.5, far: 0.4 },
    ace: { name: '阿姐', maze: [5, 8], braid: 0, rooms: 2, room: [3, 2], puddles: 4, holeR: 0.42, capV: 1.8, dmg: 13, wv: [0.70, 1.00], stool: 0.6, far: 0.55 },
  } satisfies Record<Floor, RunnerDiff>,
  // Fed by the shop (selfFeed off): shorter breaks between trips (the original prototype keeps 0.8 s ready, 1.8 s toast),
  // and the tray's weight eases to the new load over massTau seconds after a delivery instead of stepping.
  fed: { ready: 0.4, toast: 0.9, massTau: 0.6 },
  // Points per trip: each delivered order earns order x mult[orders carried - 1], plus time, plus health left, minus
  // crash per knock-out. Par = the shortest tour through the trip's pockets at parV, plus parPad per pocket.
  score: { order: 40, mult: [1, 1.25, 1.5], time: 30, timeMax: 1.5, health: 15, crash: 20 },
  parV: 2.0, parPad: 2.5,
  limitK: 3, limitPad: 20,  // customers leave after limitK x par + limitPad seconds
  stars: [45, 70, 95],      // average points per order for 1 / 2 / 3 stars
  orders: 6,
  keyMax: 0.6, keyTau: 0.25, dragR: 60,
} as const;
/* ================================================================================================= */

export const clamp = (v: number, a: number, b: number): number => v < a ? a : v > b ? b : v;
/** The original prototype's own seeded generator (the same mulberry32 as contract.ts seededRng), as a plain function. */
export function rngFn(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export type WallKind = 'booth' | 'tables' | 'counter' | 'partition';
export interface Pt { x: number; y: number }
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Wall extends Rect { kind: WallKind; hor: boolean; run: number; first: boolean; last: boolean }
export interface RectObs extends Rect { t: 'rect'; run?: number; target?: boolean }
export interface CircObs { t: 'circ'; x: number; y: number; r: number }
export interface Stool extends CircObs { sit: boolean; col: string; fx: number; fy: number }
export type Obs = RectObs | CircObs;
export interface Cell { i: number; j: number; d: number }
export interface Hole { x: number; y: number; r: number }
export interface Target {
  tab: Rect; hole: Hole; ox: number; oy: number; cell: Cell; no: number;
  dist: Int32Array; len: number; straight: number; wind: number; to: number[];
}
export interface Puddle { x: number; y: number; r: number; seed: number }
/** A walking customer's fixed lane (the moving part lives in the station state, see WalkerState in core.ts). */
export interface WalkerDef { a: Pt; b: Pt; len: number; u: number; dir: number; sp: number; col: string; ph: number }
export interface Room { i: number; j: number; w: number; h: number }
export interface FreeGrid { free: Uint8Array; nx: number; ny: number }
export interface Layout {
  GW: number; GH: number; mx: number; my: number; cw: number; ch: number; start: Pt;
  walls: Wall[]; targets: Target[]; stools: Stool[]; obs: Obs[]; puddles: Puddle[]; walkers: WalkerDef[]; rooms: Room[];
  fg: FreeGrid; seed: number; attempts: number; dk: Floor;
}

export const TABLE_NO = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 18, 19, 20];
export const SHIRTS = ['#c8323c', '#5f7fd0', '#e8a23a', '#7a4ab0', '#2f8f6a', '#d0607a'];
const RES = 6;   // maze check resolution: nodes per unit
export const MAZE_RES = RES;

const at = <T>(a: readonly T[], i: number): T => { const v = a[i]; if (v === undefined) throw new Error(`index ${i} out of range`); return v; };
export { at };

export function distRect(px: number, py: number, o: Rect): number {
  const dx = Math.max(o.x0 - px, 0, px - o.x1), dy = Math.max(o.y0 - py, 0, py - o.y1); return Math.hypot(dx, dy);
}
export function clearance(px: number, py: number, obs: readonly Obs[], GW: number, GH: number, skip?: (o: Obs) => boolean): number {
  let m = Math.min(px, GW - px, py, GH - py);
  for (const o of obs) { if (skip?.(o)) continue; const d = o.t === 'rect' ? distRect(px, py, o) : Math.hypot(px - o.x, py - o.y) - o.r; if (d < m) m = d; }
  return m;
}
function freeGrid(obs: readonly Obs[], GW: number, GH: number): FreeGrid {
  const nx = GW * RES, ny = GH * RES, free = new Uint8Array(nx * ny), need = TUNE.r + TUNE.clear;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) free[j * nx + i] = clearance((i + 0.5) / RES, (j + 0.5) / RES, obs, GW, GH) >= need ? 1 : 0;
  return { free, nx, ny };
}
const gi = (a: Uint8Array | Int32Array, k: number): number => a[k] ?? 0;
export function bfs(fg: FreeGrid, gx: number, gy: number, block?: Uint8Array): Int32Array {
  const { free, nx, ny } = fg, dist = new Int32Array(nx * ny).fill(-1), q = new Int32Array(nx * ny);
  const ok = (k: number): boolean => gi(free, k) !== 0 && !(block && gi(block, k) !== 0);
  const g = gy * nx + gx; if (!ok(g)) return dist;
  let h = 0, t = 0; dist[g] = 0; q[t++] = g;
  while (h < t) {
    const k = gi(q, h++), i = k % nx, j = (k - i) / nx, d = gi(dist, k) + 1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = b * nx + a; if (gi(dist, n) >= 0 || !ok(n)) continue;
      if (di && dj && (!ok(j * nx + a) || !ok(b * nx + i))) continue;
      dist[n] = d; q[t++] = n;
    }
  }
  return dist;
}
export const nodeOf = (x: number, y: number, fg: FreeGrid): { i: number; j: number } => ({ i: clamp(Math.floor(x * RES), 0, fg.nx - 1), j: clamp(Math.floor(y * RES), 0, fg.ny - 1) });
const reach = (dist: Int32Array, fg: FreeGrid, x: number, y: number): boolean => { const n = nodeOf(x, y, fg); return gi(dist, n.j * fg.nx + n.i) >= 0; };
export function routeLen(dist: Int32Array, fg: FreeGrid, x: number, y: number): number {   // walk the gradient and add up real lengths
  let { i, j } = nodeOf(x, y, fg), k = j * fg.nx + i; if (gi(dist, k) < 0) return -1;
  let len = 0;
  while (gi(dist, k) > 0) {
    let best = -1;
    for (let dj = -1; dj <= 1 && best < 0; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= fg.nx || b >= fg.ny) continue; const n = b * fg.nx + a; if (gi(dist, n) === gi(dist, k) - 1) { best = n; break; } }
    if (best < 0) break;
    const a = best % fg.nx, b = (best - a) / fg.nx; len += Math.hypot(a - i, b - j) / RES; i = a; j = b; k = best;
  }
  return len;
}

/** Generator retry reasons (debug view / tests), as the prototype's GF. */
export const GF: Record<string, number> = {};
const bump = (k: string): void => { GF[k] = (GF[k] ?? 0) + 1; };

export function gen(seed: number, dk: Floor): Layout | null {
  const d = TUNE.diff[dk];
  for (let attempt = 0; attempt < 200; attempt++) {
    const L = tryGen(rngFn((seed * 2654435761 + attempt * 40503 + 17) >>> 0), d, seed, attempt + 1, dk);
    if (L) return L;
  }
  return null;   // never seen in the prototype's 500-seed checks
}
// Memo: a floor plan is rebuilt from (seed, difficulty) whenever a state needs it (hand-over sends only the seed).
const memo = new Map<string, Layout>();
export function layoutFor(seed: number, dk: Floor): Layout {
  const key = `${seed}:${dk}`;
  const hit = memo.get(key); if (hit) return hit;
  const L = gen(seed, dk);
  if (!L) throw new Error(`no floor plan for seed ${seed} (${dk})`);
  if (memo.size > 24) { const first = memo.keys().next(); if (!first.done) memo.delete(first.value); }
  memo.set(key, L);
  return L;
}

type Dir = readonly [number, number];
function tryGen(R: () => number, d: RunnerDiff, seed: number, attempts: number, dk: Floor): Layout | null {
  const GW = TUNE.grid.w, GH = TUNE.grid.h, [mx, my] = d.maze, cw = GW / mx, ch = GH / my, ri = (n: number): number => Math.floor(R() * n);
  // walls: H[j][i] = wall on the top edge of cell (i, j) (j >= 1); V[j][i] = wall on the left edge of cell (i, j) (i >= 1)
  const H: boolean[][] = [], V: boolean[][] = [];
  for (let j = 0; j < my; j++) { H.push(new Array<boolean>(mx).fill(j > 0)); V.push(new Array<boolean>(mx).fill(true).map((_, i) => i > 0)); }
  const hg = (j: number, i: number): boolean => at(at(H, j), i), vg = (j: number, i: number): boolean => at(at(V, j), i);
  const hs = (j: number, i: number, v: boolean): void => { at(H, j)[i] = v; }, vs = (j: number, i: number, v: boolean): void => { at(V, j)[i] = v; };
  const sx = Math.floor(mx / 2), sy = 0, start = { x: (sx + 0.5) * cw, y: ch * 0.5 };
  const open = (i: number, j: number, di: number, dj: number): boolean => di === 1 ? !vg(j, i + 1) : di === -1 ? !vg(j, i) : dj === 1 ? !hg(j + 1, i) : !hg(j, i);
  const carve = (i: number, j: number, di: number, dj: number): void => { if (di === 1) vs(j, i + 1, false); else if (di === -1) vs(j, i, false); else if (dj === 1) hs(j + 1, i, false); else hs(j, i, false); };
  const DIRS: readonly Dir[] = [[1, 0], [-1, 0], [0, 1], [0, -1]], inB = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < mx && j < my;
  // 1. a perfect maze by depth-first carving: long winding corridors and dead ends
  const seen = new Uint8Array(mx * my), stack: [number, number][] = [[sx, sy]]; seen[sy * mx + sx] = 1;
  while (stack.length) {
    const [i, j] = at(stack, stack.length - 1), nb = DIRS.filter(([di, dj]) => inB(i + di, j + dj) && !gi(seen, (j + dj) * mx + i + di));
    if (!nb.length) { stack.pop(); continue; }
    const [di, dj] = at(nb, ri(nb.length)); carve(i, j, di, dj); seen[(j + dj) * mx + i + di] = 1; stack.push([i + di, j + dj]);
  }
  // 2. dining rooms: open blocks where a customer walks about
  const rooms: Room[] = [], inRoom = (i: number, j: number): boolean => rooms.some(r => i >= r.i && i < r.i + r.w && j >= r.j && j < r.j + r.h);
  for (let k = 0; k < 40 && rooms.length < d.rooms; k++) {
    const [a, b] = d.room, w = R() < 0.5 ? a : b, h = w === a ? b : a, i0 = ri(mx - w + 1), j0 = 1 + ri(my - h);
    if (rooms.some(r => i0 < r.i + r.w + 1 && i0 + w + 1 > r.i && j0 < r.j + r.h + 1 && j0 + h + 1 > r.j)) continue;
    rooms.push({ i: i0, j: j0, w, h });
    for (let j = j0; j < j0 + h; j++) for (let i = i0; i < i0 + w; i++) { if (i > i0) vs(j, i, false); if (j > j0) hs(j, i, false); }
  }
  // 3. a few loops (more on easier levels): knock out some remaining inner walls
  for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
    if (j > 0 && hg(j, i) && R() < d.braid) hs(j, i, false);
    if (i > 0 && vg(j, i) && R() < d.braid) vs(j, i, false);
  }
  // 4. dead ends become the tables you serve; pick three far apart and far from the pass
  const nOpen = (i: number, j: number): number => DIRS.filter(([di, dj]) => inB(i + di, j + dj) && open(i, j, di, dj)).length;
  const cellDist = (i0: number, j0: number): Int16Array => {
    const dd = new Int16Array(mx * my).fill(-1), q: [number, number][] = [[i0, j0]]; dd[j0 * mx + i0] = 0;
    for (let e = q.shift(); e; e = q.shift()) {
      const [i, j] = e;
      for (const [di, dj] of DIRS) { const a = i + di, b = j + dj; if (!inB(a, b) || (dd[b * mx + a] ?? 0) >= 0 || !open(i, j, di, dj)) continue; dd[b * mx + a] = (dd[j * mx + i] ?? 0) + 1; q.push([a, b]); }
    }
    return dd;
  };
  const fromStart = cellDist(sx, sy);
  const dead: Cell[] = [];
  for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) { const fd = fromStart[j * mx + i] ?? -1; if (!(i === sx && j === sy) && !inRoom(i, j) && nOpen(i, j) === 1 && fd > 0) dead.push({ i, j, d: fd }); }
  if (dead.length < 3) { bump('dead'); return null; }
  dead.sort((a, b) => b.d - a.d);
  const maxD = at(dead, 0).d, picks: Cell[] = [at(dead, ri(Math.min(3, dead.length)))];
  for (let k = 1; k < 3; k++) {
    const dds = picks.map(p => cellDist(p.i, p.j));
    const cand = dead.filter(c => !picks.includes(c) && c.d >= maxD * d.far).map(c => ({ c, s: Math.min(...dds.map(dd => dd[c.j * mx + c.i] ?? -1)) })).filter(o => o.s >= 3).sort((a, b) => b.s - a.s);
    if (!cand.length) { bump('spread'); return null; }
    picks.push(at(cand, ri(Math.min(3, cand.length))).c);
  }
  // 5. turn the walls into furniture: each straight run of wall gets one kind
  const KINDS: readonly WallKind[] = ['booth', 'booth', 'tables', 'tables', 'counter', 'partition'];
  const walls: Wall[] = [], obs: Obs[] = [];
  const addRun = (hor: boolean, line: number, a0: number, a1: number): void => {
    const kind = a1 - a0 >= 3 && R() < 0.5 ? 'booth' : at(KINDS, ri(KINDS.length)), t = TUNE.walls[kind], run = walls.length;
    for (let a = a0; a < a1; a++) {
      const w = hor ? { x0: a * cw - t / 2, x1: (a + 1) * cw + t / 2, y0: line * ch - t / 2, y1: line * ch + t / 2 } : { x0: line * cw - t / 2, x1: line * cw + t / 2, y0: a * ch - t / 2, y1: (a + 1) * ch + t / 2 };
      w.x0 = Math.max(0, w.x0); w.y0 = Math.max(0, w.y0); w.x1 = Math.min(GW, w.x1); w.y1 = Math.min(GH, w.y1);
      walls.push({ ...w, kind, hor, run, first: a === a0, last: a === a1 - 1 });
    }
  };
  for (let j = 1; j < my; j++) { let a0 = -1; for (let i = 0; i <= mx; i++) { const on = i < mx && hg(j, i); if (on && a0 < 0) a0 = i; if (!on && a0 >= 0) { addRun(true, j, a0, i); a0 = -1; } } }
  for (let i = 1; i < mx; i++) { let a0 = -1; for (let j = 0; j <= my; j++) { const on = j < my && vg(j, i); if (on && a0 < 0) a0 = j; if (!on && a0 >= 0) { addRun(false, i, a0, j); a0 = -1; } } }
  for (const w of walls) obs.push({ t: 'rect', x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, run: w.run });
  // 6. the target tables: against the back of each dead end, the pocket in front
  const targets: Target[] = picks.map(c => {
    const [ox, oy] = DIRS.find(([di, dj]) => inB(c.i + di, c.j + dj) && open(c.i, c.j, di, dj)) ?? [0, 1];
    const along = ox ? ch : cw, depthC = ox ? cw : ch, cx = (c.i + 0.5) * cw, cy = (c.j + 0.5) * ch;
    // back edge (the closed side opposite the opening) and how thick the wall there is
    const bxE = ox ? (ox > 0 ? c.i * cw : (c.i + 1) * cw) : cx, byE = oy ? (oy > 0 ? c.j * ch : (c.j + 1) * ch) : cy;
    const onEdge = ox ? (ox > 0 ? c.i === 0 : c.i === mx - 1) : (oy > 0 ? c.j === 0 : c.j === my - 1);
    const hb = onEdge ? 0 : Math.max(...walls.filter(w => (ox ? !w.hor && Math.abs((w.x0 + w.x1) / 2 - bxE) < 0.01 : w.hor && Math.abs((w.y0 + w.y1) / 2 - byE) < 0.01) && (ox ? cy > w.y0 && cy < w.y1 : cx > w.x0 && cx < w.x1)).map(w => (ox ? w.x1 - w.x0 : w.y1 - w.y0) / 2), 0.1);
    const tt = 0.3, half = along * 0.3, d0 = hb, d1 = hb + tt;
    const tab = ox ? { x0: bxE + ox * d0, x1: bxE + ox * d1, y0: cy - half, y1: cy + half } : { x0: cx - half, x1: cx + half, y0: byE + oy * d0, y1: byE + oy * d1 };
    if (tab.x0 > tab.x1) [tab.x0, tab.x1] = [tab.x1, tab.x0];
    if (tab.y0 > tab.y1) [tab.y0, tab.y1] = [tab.y1, tab.y0];
    const depth = Math.max(depthC / 2, d1 + 0.42), hole = { x: ox ? bxE + ox * depth : cx, y: oy ? byE + oy * depth : cy, r: d.holeR };
    return { tab, hole, ox, oy, cell: c, no: 0, dist: new Int32Array(0), len: 0, straight: 0, wind: 0, to: [] };
  });
  const nos = TABLE_NO.slice(); targets.forEach(tg => { tg.no = at(nos.splice(ri(nos.length), 1), 0); obs.push({ t: 'rect', ...tg.tab, target: true }); });
  // 7. stools beside table rows, only where a waiter can still pass them
  const stools: Stool[] = [], need2 = TUNE.stoolGap;
  for (const w of walls) {
    if (w.kind !== 'tables' || R() > d.stool) continue;
    const side = R() < 0.5 ? -1 : 1, t = w.hor ? w.y1 - w.y0 : w.x1 - w.x0, mxp = (w.x0 + w.x1) / 2, myp = (w.y0 + w.y1) / 2;
    const s = w.hor ? { x: mxp + (R() - 0.5) * 0.4, y: myp + side * (t / 2 + 0.2) } : { x: mxp + side * (t / 2 + 0.2), y: myp + (R() - 0.5) * 0.4 };
    const sr = 0.15;
    if (clearance(s.x, s.y, [...obs, ...stools], GW, GH, o => o.t === 'rect' && o.run === w.run) - sr < need2) continue;
    if (Math.hypot(s.x - start.x, s.y - start.y) < 1.2 || targets.some(tg => Math.hypot(s.x - tg.hole.x, s.y - tg.hole.y) < 1.1)) continue;
    stools.push({ t: 'circ', x: s.x, y: s.y, r: sr, sit: R() < 0.4, col: at(SHIRTS, ri(SHIRTS.length)), fx: w.hor ? 0 : -side, fy: w.hor ? -side : 0 });
  }
  stools.forEach(s => obs.push(s));
  // 8. check the real geometry: the waiter must reach every pocket from the pass
  const fg = freeGrid(obs, GW, GH), sn = nodeOf(start.x, start.y, fg);
  const dStart = bfs(fg, sn.i, sn.j);
  for (const tg of targets) {
    if (!reach(dStart, fg, tg.hole.x, tg.hole.y)) { bump('reach'); return null; }
    const hn = nodeOf(tg.hole.x, tg.hole.y, fg); tg.dist = bfs(fg, hn.i, hn.j);
    tg.len = routeLen(tg.dist, fg, start.x, start.y); tg.straight = Math.hypot(tg.hole.x - start.x, tg.hole.y - start.y); tg.wind = tg.len / tg.straight;
    if (tg.wind < 1.3) { bump('straight'); return null; }   // never a straight shot to a table
  }
  for (const tg of targets) tg.to = targets.map(u => u === tg ? 0 : routeLen(u.dist, fg, tg.hole.x, tg.hole.y));   // pocket-to-pocket routes
  // 9. puddles in corridors
  const puddles: Puddle[] = [];
  for (let k = 0; k < 60 && puddles.length < d.puddles; k++) {
    const i = ri(mx), j = 1 + ri(my - 1); if (inRoom(i, j) || targets.some(tg => tg.cell.i === i && tg.cell.j === j)) continue;
    const x = (i + 0.5) * cw, y = (j + 0.5) * ch, r = Math.min(cw, ch) * (0.3 + R() * 0.12);
    if (Math.hypot(x - start.x, y - start.y) < 2 || puddles.some(p => Math.hypot(p.x - x, p.y - y) < 2)) continue;
    puddles.push({ x, y, r, seed: R() });
  }
  // 10. one walking customer per dining room, on its long centre line. Kept only if every pocket stays reachable with
  // the customer standing anywhere on the lane, and there is room to pass beside them, so they never wall you in.
  const walkers: WalkerDef[] = [], needW = TUNE.rw + 2 * (TUNE.r + TUNE.clear) + 0.08, rr = TUNE.r + TUNE.rw + TUNE.clear;
  for (const rm of rooms) {
    const x0 = rm.i * cw, x1 = (rm.i + rm.w) * cw, y0 = rm.j * ch, y1 = (rm.j + rm.h) * ch, hor = x1 - x0 >= y1 - y0, m = needW + 0.25;
    const a = hor ? { x: x0 + m, y: (y0 + y1) / 2 } : { x: (x0 + x1) / 2, y: y0 + m }, b = hor ? { x: x1 - m, y: a.y } : { x: a.x, y: y1 - m }, len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.8) { bump('wLen'); continue; }
    let ok = true;
    for (let s = 0; s <= 1.0001 && ok; s += 0.5 / len) {
      const x = a.x + (b.x - a.x) * s, y = a.y + (b.y - a.y) * s;
      if (clearance(x, y, obs, GW, GH) < needW || Math.hypot(x - start.x, y - start.y) < 1.6 || targets.some(tg => Math.hypot(x - tg.hole.x, y - tg.hole.y) < tg.hole.r + 1.2)) { bump('wGeom'); ok = false; break; }
      const block = new Uint8Array(fg.nx * fg.ny);
      for (let j = 0; j < fg.ny; j++) for (let i = 0; i < fg.nx; i++) if (Math.hypot((i + 0.5) / RES - x, (j + 0.5) / RES - y) < rr) block[j * fg.nx + i] = 1;
      const d2 = bfs(fg, sn.i, sn.j, block);
      if (targets.some(tg => !reach(d2, fg, tg.hole.x, tg.hole.y))) { bump('wReach'); ok = false; }
    }
    if (!ok) continue;
    // the same draw order as the prototype: u, dir, sp, col, ph
    const u = R(), dir = R() < 0.5 ? 1 : -1, sp = d.wv[0] + R() * (d.wv[1] - d.wv[0]), col = at(SHIRTS, ri(SHIRTS.length)), ph = R() * 6;
    walkers.push({ a, b, len, u, dir, sp, col, ph });
  }
  return { GW, GH, mx, my, cw, ch, start, walls, targets, stools, obs, puddles, walkers, rooms, fg, seed, attempts, dk };
}

/** The next waypoint along the route to pocket ti (the prototype's bot helper `lookahead`, also its debug view). */
export function lookahead(L: Layout, x: number, y: number, maxNodes = 14, ti = 0, margin = 0.03): { x: number; y: number; d: number } {
  const fg = L.fg, tg = at(L.targets, ti), dist = tg.dist, hole = tg.hole;
  let { i, j } = nodeOf(x, y, fg), k = j * fg.nx + i;
  if (gi(dist, k) < 0) {   // touching a wall: start from the nearest reachable node
    let bd = 1e9;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= fg.nx || b >= fg.ny) continue; const n = b * fg.nx + a; if (gi(dist, n) >= 0 && di * di + dj * dj < bd) { bd = di * di + dj * dj; k = n; } }
    if (gi(dist, k) < 0) return { x: hole.x, y: hole.y, d: 0 };
    i = k % fg.nx; j = (k - i) / fg.nx;
  }
  const chain = [{ x: (i + 0.5) / RES, y: (j + 0.5) / RES, d: gi(dist, k) / RES }];
  for (let s = 0; s < maxNodes && gi(dist, k) > 0; s++) {
    let best = -1;
    for (let dj = -1; dj <= 1 && best < 0; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= fg.nx || b >= fg.ny) continue; const n = b * fg.nx + a; if (gi(dist, n) === gi(dist, k) - 1) { best = n; break; } }
    if (best < 0) break; k = best; i = k % fg.nx; j = (k - i) / fg.nx; chain.push({ x: (i + 0.5) / RES, y: (j + 0.5) / RES, d: gi(dist, k) / RES });
  }
  for (let n = chain.length - 1; n > 0; n--) {
    const p = at(chain, n), len = Math.hypot(p.x - x, p.y - y), steps = Math.ceil(len / 0.08); let ok = true;
    for (let s = 1; s <= steps && ok; s++) { const q = s / steps; if (clearance(x + (p.x - x) * q, y + (p.y - y) * q, L.obs, L.GW, L.GH) < TUNE.r + margin) ok = false; }
    if (ok) return p;
  }
  return at(chain, Math.min(1, chain.length - 1));
}
/** Route length (units) from (x, y) to pocket ti; 1e9 when unreachable from there. */
export function routeFrom(L: Layout, x: number, y: number, ti: number): number {
  const n = nodeOf(x, y, L.fg), v = gi(at(L.targets, ti).dist, n.j * L.fg.nx + n.i); return v < 0 ? 1e9 : v / RES;
}
