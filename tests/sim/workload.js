// The workload model's balance: a level's shift with its extra stations on (its `roles`, the computer
// at each, tests/sim/shift.js roles), read back as the seconds of a mid player's work (core/work/load.ts LOAD) that the
// customers put on each seat (G.work.load, booked when they come in: the demand, whoever serves it).
// The roster is the shop after 樓面: the floor's tasks (seat, order, 傳菜, clear,
// bag, deliver) shared by `spec.floor` players, one player at each other seat. A seat's busy share is its seconds over
// the shift's length and its players; the done line is every share within BAND of the roster's mean.
import { runShift } from './shift.js';
import { LEVELS } from './levels.js';

/** The seats a level is balanced over: the floor, the shop's bar, kitchen and till, and its roles' own seats. */
export function rosterOf(lv) {
  const r = LEVELS[lv].roles ?? {};
  return ['floor', 'bar', 'kitchen', ...(r.roast ? ['roast'] : []), 'till'];
}

/**
 * One shift of level `lv` (seed `seed`): seconds per seat, busy shares and the spread. `spec` replaces the level's
 * WORK_LEVELS entry for this run (a candidate while solving).
 */
export function levelLoad(lv, seed, spec = null) {
  const L = LEVELS[lv];
  const r = runShift({ seed, station: 'waiter', slot: L.slot, lv, roles: true, diff: 'pro', setup: C => { if (spec) C.WORK_LEVELS[lv] = spec; } });
  const C = r.C, G = C.G, W = G.work, sec = C.CFG.gameSec, sp = C.workSpecFor(lv, 'pro');
  const load = { ...C.zeroLoad(), ...(W ? W.load : {}) };
  const roster = rosterOf(lv), players = k => k === 'floor' ? sp.floor : 1;
  const share = Object.fromEntries(roster.map(k => [k, load[k] / sec / players(k)]));
  const mean = roster.reduce((a, k) => a + share[k], 0) / roster.length;
  const off = Object.fromEntries(roster.map(k => [k, share[k] / mean - 1]));
  return { lv, seed, errs: r.errs, load, share, mean, off, worst: Math.max(...roster.map(k => Math.abs(off[k]))), tasks: W ? W.tasks : {}, takes: W?.takes ?? 0, chops: W?.chops ?? 0, spec: sp, roster };
}

/** The mean over seeds of levelLoad (shares averaged, then the spread worked out again). */
export function levelBalance(lv, seeds, spec = null) {
  const runs = seeds.map(s => levelLoad(lv, s, spec)), roster = runs[0].roster;
  const share = Object.fromEntries(roster.map(k => [k, runs.reduce((a, x) => a + x.share[k], 0) / runs.length]));
  const mean = roster.reduce((a, k) => a + share[k], 0) / roster.length;
  const off = Object.fromEntries(roster.map(k => [k, share[k] / mean - 1]));
  return { lv, runs, roster, share, mean, off, worst: Math.max(...roster.map(k => Math.abs(off[k]))), spec: runs[0].spec, errs: runs.flatMap(x => x.errs) };
}
