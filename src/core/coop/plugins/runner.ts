// 傳菜 runner in the referee: the referee owns the pass (lines with
// passT, core/referee/extras.ts); the station (src/stations-next/runner, fed mode) holds what it has been given. On
// every step of the phone that drives the seat, the pass is compared with what the station holds (its pass and the
// orders on its tray): new lines go to it as `work`, lines that are gone (their table left) come off its pass. Each
// table it reaches sends `carried` with the lines' references.
import { makeRunnerBot } from '../../../stations-next/runner/bot';
import { runner, init as runnerInit, setFloor, type RunnerState, type RunnerResult, type Work } from '../../../stations-next/runner/core';
import type { Floor } from '../../../stations-next/runner/maze';
import type { PassRef } from '../../proto/messages';
import { staleAfter } from '../../referee/extras';   // a dish left to go cold
import { setRunnerFloor } from '../../referee/speed';   // the third star's line follows the floor plan
import { PORT } from '../../env';
import { registerStation } from '../registry';
import { submit } from '../results';
import { liveG } from '../../state';
import { linesOf } from '../../referee/extras';
import { levelTier, byTier, RUNNER_FLOOR } from '../../work/roles';
import { ctxOf, dk, store, registerSeatCommand, obj, fin, finishStarted } from './kit';

// The floor ramps with the shop's levels: level 1 the simple 'first' plans, level 2 rookie, level 3 pro, levels
// 4-7 ace; the bonus levels and the player's own shop follow the shop's difficulty.
function floor(): Floor {
  const lv = liveG().level, L = lv ? PORT.level(lv) : undefined, n = L?.n;
  const tier = levelTier(L ?? liveG().party, 'runner');   // a level with the 傳菜 role: its tier's floor
  if (tier !== null) return byTier(RUNNER_FLOOR, tier);
  return n === 1 ? 'first' : n === 2 ? 'rookie' : n === 3 ? 'pro' : n !== undefined && n <= 7 ? 'ace' : dk();
}
const st = store<RunnerState>(() => runnerInit({ difficulty: dk(), floor: floor(), seed: liveG().nextId * 7919, players: 1, selfFeed: false }));
export const runnerState = (): RunnerState | null => st.peek();
/** The playtest slider's floor tier (core/playtest/apply.ts): now between trips, else from the next trip. */
export function runnerFloorTo(f: Floor): void { const s = st.peek(); if (s) setFloor(s, f); }
const ctx = (byPlayer: boolean): ReturnType<typeof ctxOf> => ctxOf('runner', byPlayer);
// The computer takes every table waiting (up to 3) per trip: one table a trip (the bot's default) cannot keep up with a
// busy shop's pass. It stays honest in how it drives (its speed, its route, no knocks).
const bot = makeRunnerBot({ load: 3 });

const refOf = (gid: number, dest: string, i: number): string => `${String(gid)}:${dest}:${String(i)}`;
function parse(ref: string): PassRef | null {
  const [g, d, i] = ref.split(':');
  return (d === 'bar' || d === 'kitchen' || d === 'roast') && g && i ? { gid: Number(g), dest: d, i: Number(i) } : null;
}
/** What is on the pass now, as the station's work (table numbers from 1). */
export function passWork(): Work[] {
  const out: Work[] = [];
  for (const g of liveG().groups) if (!g.take && g.table !== null) for (const x of linesOf(g)) if (x.l.passT !== undefined) out.push({ ref: refOf(g.id, x.dest, x.i), table: g.table + 1 });
  return out;
}
/** 樓面: the tables a floor player's carry job takes (null: the whole pass, the 傳菜 seat). */
let only: readonly number[] | null = null;
export function runnerOnly(tables: number | readonly number[] | null): void { only = typeof tables === 'number' ? [tables] : tables; }
function sync(s: RunnerState): void {
  const want = passWork().filter(w => only === null || only.includes(w.table)), keep = new Set(want.map(w => w.ref));
  const tray = s.trip.orders.filter(o => !o.done).flatMap(o => o.work.map(w => w.ref));
  const have = new Set([...s.pass.map(w => w.ref), ...tray]);
  const n = s.pass.length;
  s.pass = s.pass.filter(w => keep.has(w.ref));
  const add = want.filter(w => !have.has(w.ref));
  if (add.length || s.pass.length !== n) runner.onEvent(s, { kind: 'work', items: add }, ctx(false));
}
// The runner's own mistakes, reported where the seat is driven: a knock-out (the station cues each one, 'ko'), and
// a dish that goes cold on the pass while the runner stands at the pass not taking it ('pick'). A dish that goes cold
// while the runner is out on a trip is the shop's pace (one runner on a big floor), not the hand's: not counted.
let koFor: RunnerState | null = null, koSeen = 0;
const coldSeen = new Set<string>();
// The trip clock at the last table this trip reached: each `carried` sends the seconds since then (or since the
// trip left the pass), so the referee's 每碟上枱 is the trips' seconds over the dishes they carried. Keyed by the trip's
// seed (each trip has its own; a knock-out restarts the same trip and its clock runs on).
let legTrip = -1, legT = 0;
// The seat's measure: dishes put on their tables hot, i.e. taken from the pass before going cold on the
// runner's watch. A dish's clock runs from when it came out, or from the runner's return to the pass if it came out while
// the runner was away (that wait is the shop's pace, as the cold rule says), to the moment the tray leaves the pass.
let atPass = false, backAt = 0;
const hotRefs = new Set<string>();
function lineOf(ref: string): { k: string; dest: string; passT: number | undefined } | null {
  const p = parse(ref), g = p ? liveG().groups.find(x => x.id === p.gid) : undefined;
  const x = p && g ? linesOf(g).find(y => y.dest === p.dest && y.i === p.i) : undefined;
  return x ? { k: x.l.k, dest: x.dest, passT: x.l.passT } : null;
}
function report(out: RunnerResult[]): void {
  const s = st.get(); if (koFor !== s){ koFor = s; koSeen = s.cueN; coldSeen.clear(); atPass = false; }
  const T = liveG().t;
  if (s.st === 'pick' && !atPass) backAt = T;
  if (s.st !== 'pick' && atPass){
    hotRefs.clear();
    for (const o of s.trip.orders) for (const w of o.work){
      const l = lineOf(w.ref);
      if (l && l.passT !== undefined && T - Math.max(l.passT, backAt) <= staleAfter(l.dest === 'roast' ? 'f' : l.k)) hotRefs.add(w.ref);
    }
  }
  atPass = s.st === 'pick';
  for (const c of s.cues) if (c.id > koSeen && c.k === 'ko') submit('runner', { k: 'knock' });
  koSeen = s.cueN;
  const S = liveG();
  for (const g of S.groups) if (!g.take) for (const x of linesOf(g)){
    const p = x.l.passT, ref = refOf(g.id, x.dest, x.i);
    if (p === undefined || coldSeen.has(ref) || S.t - p <= staleAfter(x.dest === 'roast' ? 'f' : x.l.k)) continue;
    coldSeen.add(ref);
    if (s.st === 'pick') submit('runner', { k: 'cold' });
  }
  for (const r of out) if (r.kind === 'carried'){
    const refs = r.refs.map(parse).filter((x): x is PassRef => x !== null);
    if (legTrip !== s.trip.seed){ legTrip = s.trip.seed; legT = 0; }
    const sec = Math.max(0, s.trip.t - legT); legT = s.trip.t;
    if (refs.length) submit('runner', { k: 'carried', refs, table: r.table, sec, hot: r.refs.filter(x => hotRefs.has(x)).length });
  }
}
/** The runner is off the pass, or has dishes on its tray (work begun). */
const trayOut = (s: RunnerState): boolean => s.st !== 'pick' || s.trip.orders.length > 0;
export function runnerCommand(cmd: Parameters<typeof runner.command>[1]): void { const s = st.get(); sync(s); report(runner.command(s, cmd, ctx(true))); }

registerStation({
  kind: 'runner', v: 1,
  pick: () => st.get(),
  put: (_S, s) => { if (!runner.validate(s)) return false; st.set(structuredClone(s)); return true; },
  // a tray off the pass is begun work; a player taking the seat gets the runner back at the pass, the
  // computer's trip carried to its tables first (fast time, kit.ts finishStarted; its cues are not replayed)
  toPlayer: () => {
    const s = st.peek(); if (!s) return;
    const n = s.cueN;
    finishStarted(() => trayOut(s), dt => { sync(s); const c = bot(s, ctx(false)); if (c) report(runner.command(s, c, ctx(false))); report(runner.step(s, dt, ctx(false))); });
    s.cues = s.cues.filter(c => c.id <= n || c.k === 'ko');
  },
  started: () => { const s = st.peek(); return !!s && trayOut(s); },
  restart: () => { st.reset(); },
  waiting: () => runner.status(st.get(), ctx(false)).waiting,
  step: (dt, driver) => {
    const s = st.get(); sync(s);
    if (driver === 'computer'){ const c = bot(s, ctx(false)); if (c) report(runner.command(s, c, ctx(false))); }
    report(runner.step(s, dt, ctx(driver === 'me')));
  },
});
registerSeatCommand('runner', c => {
  if (!obj(c)) return false;
  if (c.t === 'tilt' && fin(c.x) && fin(c.y)){ runnerCommand(c.snap === true ? { t: 'tilt', x: c.x, y: c.y, snap: true } : { t: 'tilt', x: c.x, y: c.y }); return true; }
  if (c.t === 'pick' && fin(c.n)){ runnerCommand({ t: 'pick', n: c.n }); return true; }
  return false;
});
export function runnerBotPress(): void { const c = bot(st.get(), ctx(true)); if (c) runnerCommand(c); }
// the third star's line for this tray's floor plan (referee/speed.ts RUNNER_STAR3): the floor it runs on now
setRunnerFloor(() => st.peek()?.dk ?? null);
