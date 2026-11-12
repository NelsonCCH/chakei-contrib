// 傳菜 runner station core: the tilt maze of the original prototype as a StationModule.
// Pure (contract.ts rules): time comes in as dt, the floor plan is rebuilt from its seed (maze.ts), and the state is
// plain JSON. The prototype's fixed 240 Hz simulation step is kept: step(dt) runs as many 1/240 s steps as dt holds.
//
// Work seam: `selfFeed` (default true, the original prototype) makes the shift's six orders itself, three candidate tables per
// trip. With selfFeed off (the referee) the pass is filled by `work` events
// ({ kind: 'work', items: [{ ref, table }] }), each trip offers the first three tables waiting, and every delivered
// table sends `carried { refs, table }`. Nothing is ever dropped: a timed-out trip puts its orders back on the pass.
import type { BotModule, RefEvent, Result, ShiftConfig, StationCtx, StationModule, StationStatus } from '../contract';
import { TUNE, at, clamp, layoutFor, isFloor, type Floor, type Layout, type Target } from './maze';
import { runnerBot } from './bot';

export type RunnerSt = 'pick' | 'ready' | 'play' | 'sink' | 'crash' | 'toast' | 'end';
export interface Work { ref: string; table: number }
export interface Order { ti: number; done: boolean; inHole: boolean; work: Work[] }
export interface WalkerState { u: number; dir: number; wait: number; blockT: number; x: number; y: number; vx: number; vy: number; ph: number }
export interface Fx { x: number; y: number; text: string; col: string; t: number; life: number; size: number }
export interface Hit { kind: string; vn: number; dmg: number; t: number }
export interface TripResult { why: string; n: number; del: number; base: number; time: number; health: number; crash: number; pts: number; t: number }
export interface Trip {
  seed: number; nos: number[];
  ball: { x: number; y: number; vx: number; vy: number };
  t: number; hp: number; orders: Order[]; crashes: number; bumps: number; guest: number;
  cool: Record<string, number>; trail: { x: number; y: number; v: number }[]; trailT: number; fx: Fx[]; lipCool: number;
  readyT: number; sinkT: number; sinkI: number; toastT: number; crashT: number; restart: boolean;
  /** The inertia the physics uses now: fed mode eases it toward the tray's load after each delivery. */
  m: number;
  hitFlash: number; shake: number; wet: boolean; wetWas: boolean; result: TripResult | null; maxV: number; hits: Hit[];
  tour: number; par: number; limit: number; walkers: WalkerState[]; stT: number;
}
export interface RunRec {
  trip: number; done: number; failed: number; points: number; crashes: number; bumps: number; guest: number; time: number;
  carried: number[]; log: { n: number; del: number; pts: number }[]; stars: number; avg: number;
}
/** A sound or a screen effect the screen plays once (the screen remembers the last id it played). */
export interface Cue { id: number; k: 'tick' | 'clink' | 'bump' | 'guest' | 'ko' | 'sink' | 'lip' | 'splash' }
export interface RunnerState {
  v: 1; dk: Floor; seed0: number; selfFeed: boolean; st: RunnerSt;
  run: RunRec; pass: Work[]; made: number; trip: Trip;
  /** Tilt: `in` is what the player holds (|in| <= 1), `t` the low-passed value the physics uses. */
  in: { x: number; y: number }; tilt: { x: number; y: number };
  acc: number; clock: number; idleFor: number; cueN: number; cues: Cue[];
  /** A floor tier asked for mid-trip (setFloor): the next trip is laid out on it. */
  next?: Floor;
}
export type RunnerCmd =
  | { t: 'tilt'; x: number; y: number; snap?: boolean }
  | { t: 'pick'; n: number };
export interface RunnerResult extends Result { kind: 'carried' | 'missed'; refs: string[]; table: number }
/** floor: the floor-plan tier when it is not the shift's difficulty (the shop picks the simple 'first' plans on level 1). */
export interface RunnerConfig extends ShiftConfig { selfFeed?: boolean; floor?: Floor }

export const DT = 1 / 240;
export const DF = (s: RunnerState): (typeof TUNE.diff)[Floor] => TUNE.diff[s.dk];
export const hardV = (s: RunnerState): number => TUNE.hardDmg / DF(s).dmg + TUNE.tapV - 0.3;   // head-on table hit at this speed costs hardDmg
export const layoutOf = (s: RunnerState): Layout => layoutFor(s.trip.seed, s.dk);
/** collide() can end play (a knock-out); a call, so the checker does not assume st is still 'play'. */
const playing = (s: RunnerState): boolean => s.st === 'play';
export const carrying = (o: Trip): number => o.orders.filter(x => !x.done).length;
export const remaining = (s: RunnerState): number => TUNE.orders - s.run.done - s.run.failed;
/** Tables waiting at the pass this trip could take (selfFeed: the prototype's remaining orders), at most 3. */
export function available(s: RunnerState): number {
  if (s.selfFeed) return Math.min(3, remaining(s));
  return Math.min(3, passTables(s.pass).length);
}
function passTables(pass: readonly Work[]): number[] { const t: number[] = []; for (const w of pass) if (!t.includes(w.table)) t.push(w.table); return t; }
/**
 * Which pocket takes the trip's k-th table. The original prototype (selfFeed) keeps its order; fed by the shop, the oldest table
 * at the pass goes to the nearest pocket, so a one-table trip is the shortest run on the floor.
 */
export function pocketOrder(s: RunnerState): number[] {
  if (s.selfFeed) return [0, 1, 2];
  const T = layoutOf(s).targets;
  return [0, 1, 2].sort((a, b) => at(T, a).len - at(T, b).len);
}
/** The table number shown on target ti this trip (null: no work for it). */
export function tableNo(s: RunnerState, ti: number): number | null {
  const n = s.trip.nos[pocketOrder(s).indexOf(ti)]; return n === undefined ? null : n;
}

function cue(s: RunnerState, k: Cue['k']): void { s.cues.push({ id: ++s.cueN, k }); if (s.cues.length > 16) s.cues.shift(); }
function addFx(o: Trip, x: number, y: number, text: string, col: string, life = 1.1, size = 14): void {
  o.fx.push({ x, y, text, col, t: 0, life, size }); if (o.fx.length > 6) o.fx.shift();
}

function emptyRun(): RunRec { return { trip: 0, done: 0, failed: 0, points: 0, crashes: 0, bumps: 0, guest: 0, time: 0, carried: [], log: [], stars: 0, avg: 0 }; }
function newTrip(dk: Floor, seed: number, fed: boolean): Trip {
  const L = layoutFor(seed, dk);
  return {
    seed, nos: [], ball: { x: L.start.x, y: L.start.y, vx: 0, vy: 0 }, t: 0, hp: TUNE.hp, orders: [], crashes: 0, bumps: 0, guest: 0,
    cool: {}, trail: [], trailT: 0, fx: [], lipCool: 0, readyT: fed ? TUNE.fed.ready : 0.8, sinkT: 0, sinkI: -1, toastT: 0, crashT: 0, restart: false, m: 1,
    hitFlash: 0, shake: 0, wet: false, wetWas: false, result: null, maxV: 0, hits: [], tour: 0, par: 0, limit: 0, stT: 0,
    walkers: L.walkers.map(w => ({ u: w.u, dir: w.dir, wait: 0, blockT: 0, x: w.a.x + (w.b.x - w.a.x) * w.u, y: w.a.y + (w.b.y - w.a.y) * w.u, vx: 0, vy: 0, ph: w.ph })),
  };
}
/** Labels the trip's tables: the prototype's random numbers when it feeds itself, the pass's tables otherwise. */
function labelTrip(s: RunnerState): void {
  const L = layoutOf(s);
  s.trip.nos = s.selfFeed ? L.targets.map(t => t.no) : passTables(s.pass).slice(0, 3);
}
function nextTrip(s: RunnerState): void {
  const seed = (s.seed0 + s.run.trip * 7777) >>> 0;
  if (s.next){ s.dk = s.next; delete s.next; }
  s.trip = newTrip(s.dk, seed, !s.selfFeed); s.st = 'pick'; labelTrip(s);
}

export function init(cfg: RunnerConfig): RunnerState {
  const dk = cfg.floor ?? cfg.difficulty, selfFeed = cfg.selfFeed ?? true;
  const s: RunnerState = {
    v: 1, dk, seed0: cfg.seed >>> 0, selfFeed, st: 'pick', run: emptyRun(), pass: [], made: 0,
    trip: newTrip(dk, cfg.seed >>> 0, !selfFeed),
    in: { x: 0, y: 0 }, tilt: { x: 0, y: 0 }, acc: 0, clock: 0, idleFor: 0, cueN: 0, cues: [],
  };
  labelTrip(s);
  return s;
}

/**
 * Lays the floor out on tier `f` (the playtest slider): at once while the trip has not started (picking, nothing on
 * the tray), else from the next trip, so the floor never changes under the waiter.
 */
export function setFloor(s: RunnerState, f: Floor): void {
  if (s.st === 'pick' && !s.trip.orders.length){ delete s.next; if (s.dk !== f){ s.dk = f; s.trip = newTrip(f, s.trip.seed, !s.selfFeed); labelTrip(s); } return; }
  if (s.dk === f) delete s.next; else s.next = f;
}

/** Choose 1-3 orders for this trip (the prototype's pick). */
function pick(s: RunnerState, n: number): void {
  if (s.st !== 'pick') return;
  const avail = available(s); if (avail < 1) return;
  const o = s.trip, L = layoutOf(s), T = TUNE; n = clamp(Math.round(n), 1, avail);
  const ids = pocketOrder(s).slice(0, n);
  o.orders = ids.map((ti, k) => {
    const table = at(o.nos, k);
    let work: Work[];
    if (s.selfFeed) work = [{ ref: `w${++s.made}`, table }];
    else { work = s.pass.filter(w => w.table === table); s.pass = s.pass.filter(w => w.table !== table); }
    return { ti, done: false, inHole: false, work };
  });
  // par = the shortest tour from the pass through every chosen pocket, at parV, plus parPad per pocket
  const perms = ids.length === 1 ? [ids] : ids.length === 2 ? [ids, [at(ids, 1), at(ids, 0)]]
    : [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map(p => p.map(k => at(ids, k)));
  const T3 = L.targets;
  o.tour = Math.min(...perms.map(p => at(T3, at(p, 0)).len + p.slice(1).reduce((sum, k, i) => sum + at(at(T3, at(p, i)).to, k), 0)));
  o.par = o.tour / T.parV + T.parPad * n;
  o.limit = o.par * T.limitK + T.limitPad;
  s.run.carried.push(n);
  o.m = at(T.mass, n - 1);
  s.st = 'ready'; o.stT = 0;
}

function finishTrip(s: RunnerState, why: string, ctx: StationCtx, out: RunnerResult[]): void {
  const o = s.trip, r = s.run, S = TUNE.score, n = o.orders.length, del = o.orders.filter(x => x.done).length;
  const base = Math.round(del * S.order * at(S.mult, n - 1));
  const tf = clamp(2 - o.t / o.par, 0, S.timeMax), time = Math.round(del * S.time * tf);
  const health = Math.round(del * S.health * o.hp / TUNE.hp), crash = o.crashes * S.crash;
  const pts = Math.max(0, base + time + health - crash);
  o.result = { why, n, del, base, time, health, crash, pts, t: o.t };
  r.points += pts; r.done += del; r.crashes += o.crashes; r.bumps += o.bumps; r.guest += o.guest; r.time += o.t; r.trip++;
  r.log.push({ n, del, pts });
  for (const x of o.orders) {
    if (x.done) continue;
    if (s.selfFeed) { r.failed++; const w0 = at(x.work, 0); out.push({ kind: 'missed', at: ctx.t, refs: x.work.map(w => w.ref), table: w0.table }); }
    else s.pass.unshift(...x.work);   // the referee's orders are never lost: back on the pass
  }
  s.st = 'toast'; o.toastT = s.selfFeed ? 1.8 : TUNE.fed.toast; o.stT = 0;
}
function endShift(s: RunnerState): void {
  const r = s.run, avg = r.points / TUNE.orders, S = TUNE.stars;
  r.stars = avg >= S[2] ? 3 : avg >= S[1] ? 2 : avg >= S[0] ? 1 : 0; r.avg = avg;
  s.st = 'end';
}

/* ---------- simulation (fixed 240 Hz steps; all timers are sim time) ---------- */
function readTilt(s: RunnerState, dt: number): void {
  let tx = s.in.x, ty = s.in.y;
  let m = Math.hypot(tx, ty); if (m > 1) { tx /= m; ty /= m; m = 1; }
  if (m < TUNE.dead) { tx = 0; ty = 0; }
  const a = 1 - Math.exp(-dt / TUNE.lowpass);
  s.tilt.x += (tx - s.tilt.x) * a; s.tilt.y += (ty - s.tilt.y) * a;
}
function sub(s: RunnerState, dt: number, ctx: StationCtx, out: RunnerResult[]): void {
  readTilt(s, dt);
  const o = s.trip;
  for (const f of o.fx) f.t += dt; o.fx = o.fx.filter(f => f.t < f.life);
  o.shake = Math.max(0, o.shake - dt); o.hitFlash = Math.max(0, o.hitFlash - dt); o.stT += dt;
  if (s.st === 'end') return;
  if (s.st === 'pick') { stepWalkers(s, dt); return; }
  if (s.st === 'ready') { o.readyT -= dt; if (o.restart) o.t += dt; stepWalkers(s, dt); if (o.readyT <= 0) { s.st = 'play'; o.restart = false; } return; }
  if (s.st === 'toast') { o.toastT -= dt; if (o.toastT <= 0) { if (s.selfFeed && remaining(s) <= 0) endShift(s); else nextTrip(s); } return; }
  const L = layoutOf(s);
  if (s.st === 'crash') {
    o.t += dt; o.crashT -= dt; stepWalkers(s, dt);
    if (o.crashT <= 0) { const b = o.ball; b.x = L.start.x; b.y = L.start.y; b.vx = b.vy = 0; o.hp = TUNE.hp; o.trail = []; o.restart = true; o.readyT = 0.6; s.st = 'ready'; }
    return;
  }
  if (s.st === 'sink') {
    o.t += dt; o.sinkT += dt; const b = o.ball, ord = at(o.orders, o.sinkI), h = at(L.targets, ord.ti).hole, k = Math.min(1, dt * 12);
    b.x += (h.x - b.x) * k; b.y += (h.y - b.y) * k; b.vx = b.vy = 0; stepWalkers(s, dt);
    if (o.sinkT > 0.4) {
      ord.done = true;
      out.push({ kind: 'carried', at: ctx.t, refs: ord.work.map(w => w.ref), table: at(ord.work, 0).table });
      if (!carrying(o)) { finishTrip(s, '', ctx, out); return; }
      s.st = 'play';
    }
    return;
  }
  // play
  o.t += dt;
  if (o.t > o.limit) { finishTrip(s, '超時：呢轉冇分', ctx, out); return; }
  // weight follows the load: fed by the shop it eases to the lighter tray after each delivery; the original prototype steps
  const T = TUNE, load = at(T.mass, Math.max(0, carrying(o) - 1));
  o.m = s.selfFeed ? load : o.m + (load - o.m) * (1 - Math.exp(-dt / T.fed.massTau));
  const b = o.ball, d = DF(s), m = o.m;
  o.wet = L.puddles.some(p => Math.hypot(b.x - p.x, b.y - p.y) < p.r);
  if (o.wet && !o.wetWas) { cue(s, 'splash'); if (Math.hypot(b.vx, b.vy) > 0.6) addFx(o, b.x, b.y - 0.5, '水跡：收細斜度', '#7fd0ff', 0.9); }
  o.wetWas = o.wet;
  const damp = o.wet ? T.wet.damp : T.damp, roll = o.wet ? T.wet.roll : T.roll;
  let ax = s.tilt.x * T.acc, ay = s.tilt.y * T.acc;
  for (const x of o.orders) { if (x.done) continue; const h = at(L.targets, x.ti).hole, hx = h.x - b.x, hy = h.y - b.y, hd = Math.hypot(hx, hy); if (hd < h.r && hd > 1e-4) { ax += hx / hd * T.pull; ay += hy / hd * T.pull; } }
  b.vx += ax / m * dt; b.vy += ay / m * dt;
  b.vx -= b.vx * damp / m * dt; b.vy -= b.vy * damp / m * dt;
  let sp = Math.hypot(b.vx, b.vy);
  if (sp > 0) { const dec = Math.min(sp, roll / m * dt); b.vx -= b.vx / sp * dec; b.vy -= b.vy / sp * dec; }
  b.x += b.vx * dt; b.y += b.vy * dt;
  stepWalkers(s, dt);
  collide(s, L);
  if (!playing(s)) return;
  sp = Math.hypot(b.vx, b.vy); o.maxV = Math.max(o.maxV, sp);
  o.trailT -= dt; if (o.trailT <= 0) { o.trailT = 1 / 30; o.trail.push({ x: b.x, y: b.y, v: sp }); if (o.trail.length > 14) o.trail.shift(); }
  // pockets: slow enough inside the inner circle = sink; through one too fast = lip out
  o.lipCool -= dt;
  o.orders.forEach((x, i) => {
    if (x.done || s.st !== 'play') return;
    const tg = at(L.targets, x.ti), h = tg.hole, hd = Math.hypot(h.x - b.x, h.y - b.y);
    if (hd < h.r) {
      x.inHole = true;
      if (hd < h.r * T.sinkK && sp < d.capV) { s.st = 'sink'; o.sinkT = 0; o.sinkI = i; cue(s, 'sink'); addFx(o, h.x, h.y + 0.9, `${at(x.work, 0).table}號 送到`, '#7be08f', 1.0); }
    } else if (x.inHole) {
      x.inHole = false;
      if (o.lipCool <= 0) { o.lipCool = 1.0; addFx(o, h.x, h.y + 0.9, '太快：慢啲先入到洞', '#ffb347', 1.0); cue(s, 'lip'); }
    }
  });
}
function stepWalkers(s: RunnerState, dt: number): void {
  const o = s.trip, L = layoutOf(s), b = o.ball, need = TUNE.r + TUNE.rw + 0.02;
  o.walkers.forEach((w, i) => {
    const def = at(L.walkers, i);
    w.ph += dt * 6;
    if (w.wait > 0) { w.wait -= dt; w.vx = w.vy = 0; return; }
    let u = w.u + w.dir * def.sp * dt / def.len, end = false;
    if (u > 1) { u = 1; end = true; } else if (u < 0) { u = 0; end = true; }
    const x = def.a.x + (def.b.x - def.a.x) * u, y = def.a.y + (def.b.y - def.a.y) * u;
    // a customer never walks into the waiter: blocked, they wait; blocked for a second, they turn back
    if (Math.hypot(x - b.x, y - b.y) < need && Math.hypot(x - b.x, y - b.y) < Math.hypot(w.x - b.x, w.y - b.y)) {
      w.vx = w.vy = 0; w.blockT += dt; if (w.blockT > 1) { w.dir = -w.dir; w.blockT = 0; } return;
    }
    w.blockT = 0; w.vx = (x - w.x) / dt; w.vy = (y - w.y) / dt; w.x = x; w.y = y; w.u = u;
    if (end) { w.dir = -w.dir; w.wait = 0.5; }
  });
}
function collide(s: RunnerState, L: Layout): void {
  const o = s.trip, b = o.ball, r = TUNE.r, e = TUNE.e;
  if (b.x < r) resolve(s, 1, 0, r - b.x, 0, 0, e, 'wall', 'wl', 0, b.y);
  if (b.x > L.GW - r) resolve(s, -1, 0, b.x - (L.GW - r), 0, 0, e, 'wall', 'wr', L.GW, b.y);
  if (b.y < r) resolve(s, 0, 1, r - b.y, 0, 0, e, 'wall', 'wt', b.x, 0);
  if (b.y > L.GH - r) resolve(s, 0, -1, b.y - (L.GH - r), 0, 0, e, 'wall', 'wb', b.x, L.GH);
  for (let k = 0; k < L.obs.length; k++) {
    const ob = at(L.obs, k);
    if (ob.t === 'rect') {
      if (b.x < ob.x0 - r || b.x > ob.x1 + r || b.y < ob.y0 - r || b.y > ob.y1 + r) continue;
      const qx = clamp(b.x, ob.x0, ob.x1), qy = clamp(b.y, ob.y0, ob.y1), dx = b.x - qx, dy = b.y - qy, dd = Math.hypot(dx, dy);
      if (dd >= r) continue;
      if (dd > 1e-6) resolve(s, dx / dd, dy / dd, r - dd, 0, 0, e, 'table', `r${ob.run ?? k}`, qx, qy);
      else {   // centre inside (cannot happen at 240 Hz, kept so the ball never gets stuck)
        const cand: [number, number, number][] = [[b.x - ob.x0, -1, 0], [ob.x1 - b.x, 1, 0], [b.y - ob.y0, 0, -1], [ob.y1 - b.y, 0, 1]];
        const mm = at(cand.sort((p, q) => p[0] - q[0]), 0);
        resolve(s, mm[1], mm[2], mm[0] + r, 0, 0, e, 'table', `r${k}`, b.x, b.y);
      }
    } else {
      const dx = b.x - ob.x, dy = b.y - ob.y, dd = Math.hypot(dx, dy) || 1e-6;
      if (dd < r + ob.r) resolve(s, dx / dd, dy / dd, r + ob.r - dd, 0, 0, e, 'table', `c${k}`, ob.x + dx / dd * ob.r, ob.y + dy / dd * ob.r);
    }
    if (s.st !== 'play') return;
  }
  o.walkers.forEach((w, k) => {
    if (s.st !== 'play') return;
    const dx = b.x - w.x, dy = b.y - w.y, dd = Math.hypot(dx, dy) || 1e-6;
    if (dd < r + TUNE.rw) resolve(s, dx / dd, dy / dd, r + TUNE.rw - dd, w.vx, w.vy, TUNE.eGuest, 'guest', `g${k}`, w.x + dx / dd * TUNE.rw, w.y + dy / dd * TUNE.rw);
  });
}
function resolve(s: RunnerState, nx: number, ny: number, depth: number, wvx: number, wvy: number, e: number, kind: string, key: string, px: number, py: number): void {
  const b = s.trip.ball; b.x += nx * depth; b.y += ny * depth;
  const vn = (b.vx - wvx) * nx + (b.vy - wvy) * ny;
  if (vn >= 0) return;
  b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
  impact(s, kind, -vn, px, py, key);
}
// The impact model: the speed into the obstacle decides the damage; the waiter's edge colour shows it beforehand.
function impact(s: RunnerState, kind: string, vn: number, px: number, py: number, key: string): void {
  const T = TUNE, d = DF(s), o = s.trip;
  if (vn < T.tapV) { if (vn > 0.5) cue(s, 'tick'); return; }
  if ((o.cool[key] ?? 0) > o.t) return;
  o.cool[key] = o.t + 0.3;
  const guest = kind === 'guest', dmg = Math.round(d.dmg * (vn - T.tapV + 0.3) * (guest ? T.guestK : 1));
  o.hp -= dmg; o.bumps++; if (guest) o.guest++;
  o.hits.push({ kind, vn: +vn.toFixed(2), dmg, t: +o.t.toFixed(2) }); if (o.hits.length > 40) o.hits.shift();
  o.hitFlash = 0.35; o.shake = dmg >= T.hardDmg ? 0.25 : 0.1;
  addFx(o, px, py - 0.4, `−${dmg}`, dmg >= T.hardDmg ? '#ff5a5a' : guest ? '#ff8a5a' : '#ffe9a8', 0.9, dmg >= T.hardDmg ? 17 : 14);
  cue(s, guest ? 'guest' : 'bump');
  if (o.hp <= 0) {
    o.hp = 0; o.crashes++; s.st = 'crash'; o.crashT = 1.0; o.ball.vx = o.ball.vy = 0; cue(s, 'ko');
    addFx(o, o.ball.x, Math.max(o.ball.y - 0.9, 1.4), '體力冇晒：由出餐口再嚟', '#ff5a5a', 1.4, 17);
  }
}

/* ---------- the StationModule ---------- */
function command(s: RunnerState, cmd: RunnerCmd): RunnerResult[] {
  if (cmd.t === 'tilt') {
    if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return [];
    s.in.x = cmd.x; s.in.y = cmd.y;
    if (cmd.snap) { s.tilt.x = cmd.x; s.tilt.y = cmd.y; }
    return [];
  }
  pick(s, cmd.n);
  return [];
}
function step(s: RunnerState, dt: number, ctx: StationCtx): RunnerResult[] {
  const out: RunnerResult[] = [];
  if (!(dt > 0)) return out;
  s.acc += dt; s.clock += dt;
  s.idleFor = s.st === 'pick' && available(s) === 0 ? s.idleFor + dt : 0;
  while (s.acc >= DT) { sub(s, DT, ctx, out); s.acc -= DT; }
  return out;
}
function onEvent(s: RunnerState, ev: RefEvent): void {
  if (ev.kind === 'feed' && typeof ev.self === 'boolean') { s.selfFeed = ev.self; if (s.st === 'pick') labelTrip(s); return; }
  if (ev.kind !== 'work' || !Array.isArray(ev.items)) return;
  for (const it of ev.items) if (isWork(it) && !s.pass.some(w => w.ref === it.ref)) s.pass.push({ ref: it.ref, table: it.table });
  if (s.st === 'pick') labelTrip(s);
}
function isWork(x: unknown): x is Work {
  return typeof x === 'object' && x !== null && 'ref' in x && 'table' in x && typeof x.ref === 'string' && typeof x.table === 'number';
}
function status(s: RunnerState): StationStatus {
  const waiting = s.selfFeed ? Math.max(0, remaining(s)) : s.pass.length + (s.st === 'pick' ? 0 : carrying(s.trip));
  return { waiting, idleFor: s.idleFor, load: Math.min(1, waiting / 3) };
}
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const ST: readonly string[] = ['pick', 'ready', 'play', 'sink', 'crash', 'toast', 'end'];
function validate(x: unknown): x is RunnerState {
  if (!isObj(x) || x.v !== 1 || !isFloor(x.dk)) return false;
  if (!num(x.seed0) || typeof x.selfFeed !== 'boolean' || typeof x.st !== 'string' || !ST.includes(x.st)) return false;
  if (!isObj(x.run) || !Array.isArray(x.pass) || !x.pass.every(isWork) || !isObj(x.in) || !isObj(x.tilt) || !num(x.acc) || !Array.isArray(x.cues)) return false;
  const o = x.trip;
  if (!isObj(o) || !num(o.seed) || !isObj(o.ball) || !num(o.ball.x) || !num(o.ball.y) || !Array.isArray(o.orders) || !Array.isArray(o.walkers) || !Array.isArray(o.nos) || !num(o.m)) return false;
  try { return layoutFor(o.seed, x.dk).walkers.length === o.walkers.length; } catch { return false; }
}
export const runnerBotModule: BotModule<RunnerState, RunnerCmd> = { next: (s, ctx) => runnerBot(s, ctx) };
export const runner: StationModule<RunnerState, RunnerCmd, RunnerResult> = {
  kind: 'runner', init, command, step, onEvent, status, bot: runnerBotModule, validate,
};
export type { Target };
