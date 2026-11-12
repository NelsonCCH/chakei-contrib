// Solo modes that work the whole shop: 輪流做 (the player is moved round
// the four stations during the shift) and 一腳踢 (the player switches freely; the computer covers every station the player
// is not on). Pure rules on the shift state: hand a station between the player and the computer without losing or
// doubling any work, and read each station's load for the tab bar. The page (ui/solo.ts) draws the tabs and the views.
import { liveG, bump } from '../state';
import { PORT } from '../env';
import { CORE_HOOK } from '../hooks';

/** one = today's single station; rotate = 輪流做; all = 一腳踢. */
export type SoloMode = 'one' | 'rotate' | 'all';
export const SOLO_MODES: readonly SoloMode[] = ['one', 'rotate', 'all'];
export const SOLO_ORDER: readonly StationId[] = ['waiter', 'bar', 'kitchen', 'till'];
/** 輪流做: seconds on each station (a 180 s shift = 45 s at each of the four). */
export const ROTATE_SEC = 45;

/**
 * Hands station `st` to the player ('me') or the computer ('ai') in the middle of a shift. Same rules as a co-op
 * hand-over (a seat's toComputer / toPlayer, core/coop/registry.ts): an order the computer had picked up goes back to
 * the table, a drink or a bill in progress goes back to the front of its queue, and dishes the player left go to the
 * computer cook from now on.
 */
export function handOver(st: StationId, to: 'me' | 'ai'): void {
  const S = liveG();
  if (S.roles[st] === to) return;
  if (st === 'waiter'){
    if (S.sheet) CORE_HOOK.closeSheet();
    S.aw = { job: null, until: 0 }; S.sheet = null; S.selected = null;
    S.groups.forEach(g => { if (g.state === 'order' && 'taken' in g && g.taken){ g.taken = false; g.later = null; } });
  }
  if (st === 'bar'){
    S.ab = { cur: null, until: 0 }; S.bench.target = null;
    if (to === 'ai' && S.phase === 'prep'){ S.phase = 'open'; S.pot = { level: PORT.potCap(), st: 'ready', until: 0, pulls: 0 }; }
  }
  if (st === 'kitchen'){
    // the computer cook starts on what the player left from now (never "already done" because an old doneAt has passed)
    if (to === 'ai') S.groups.forEach(g => { (g.meals || []).forEach(m => { if (!m.done) m.doneAt = Math.max(m.doneAt || 0, S.t + 3); }); });
    S.ksel = null;
  }
  if (st === 'till'){
    if (S.at.cur) S.payQ.unshift(S.at.cur);
    if (S.cur) S.payQ.unshift(S.cur);
    if (S.board) CORE_HOOK.closeBoard();
    S.at = { cur: null, until: 0 }; S.cur = null; S.step = 'total'; S.entry = ''; S.give = []; S.nextCust = S.t;
  }
  S.roles[st] = to;
  bump();
}

/** The player moves to station `to`: the one they leave goes to the computer. False if they are already there. */
export function switchStation(to: StationId): boolean {
  const S = liveG();
  if (S.station === to && S.roles[to] === 'me') return false;
  for (const st of SOLO_ORDER) if (st !== to && S.roles[st] === 'me') handOver(st, 'ai');
  handOver(to, 'me');
  S.station = to;
  bump();
  return true;
}

/** 輪流做: the station due now, `ROTATE_SEC` on each in SOLO_ORDER from the one the shift started on. */
export function rotateDue(first: StationId, t: number): StationId {
  const i0 = SOLO_ORDER.indexOf(first), k = Math.floor(Math.max(0, t) / ROTATE_SEC);
  return SOLO_ORDER[(i0 + k) % SOLO_ORDER.length] ?? first;
}
/** Seconds until the next rotation. */
export const rotateLeft = (t: number): number => ROTATE_SEC - (Math.max(0, t) % ROTATE_SEC);

/** Jobs waiting at a station (badge) and whether the oldest is close to running out of patience (red ring). */
export interface StationLoad { n: number; hot: boolean }
export function stationLoad(st: StationId): StationLoad {
  const S = liveG(), t = S.t;
  const near = (until: number | undefined, max: number | undefined): boolean => until !== undefined && max !== undefined && max > 0 && (until - t) / max < .3;
  let n = 0, hot = false;
  if (st === 'waiter'){
    for (const g of S.groups){
      if (g.take) continue;
      if (g.state === 'queue' || (g.state === 'order' && !g.taken)){ n++; if (near(g.until, g.max)) hot = true; }
    }
    n += S.tables.filter(tb => tb.dirty).length;
  } else if (st === 'bar' || st === 'kitchen'){
    for (const g of S.groups){
      if (g.state !== 'wait') continue;
      const lines = st === 'bar' ? g.drinks : g.meals, left = (lines || []).filter(l => !l.done).length;
      if (!left) continue;
      n += left;
      if (st === 'bar' ? near(g.drinkUntil, g.drinkMax) : near(g.mealUntil, g.mealMax)) hot = true;
    }
  } else {
    n = S.payQ.length + (S.cur ? 1 : 0) + (S.at.cur ? 1 : 0);
    hot = S.payQ.some(c => near(c.until, c.max));
  }
  return { n, hot };
}
