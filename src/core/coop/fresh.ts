// The player is only ever given untouched work. If the computer (a seat it covers, the
// 樓面 pool or a computer floor worker) has started an order or task, the computer finishes it. This file is the guard's
// record: every hand-out to a player (a seat taken from the computer, a floor job opened) is checked against the
// station's `started()` (core/coop/registry.ts), and a hand-out of begun work is logged. The simulations read the log
// (tests/sim/fresh-work.test.js); the game only records it.
import { stationOf } from './registry';
import { liveG } from '../state';

export interface HandOut { kind: string; how: 'seat' | 'job' | 'task'; t: number }
let checked = 0, stale: HandOut[] = [];
/** Station `kind` was just handed to a player (`how`: a seat from the computer, or a floor job): is its work untouched? */
export function noteHandOut(kind: string, how: 'seat' | 'job'): void {
  const m = stationOf(kind); if (!m?.started) return;
  checked++;
  if (m.started()) stale.push({ kind, how, t: liveG().t });
}
/** A player claimed a 樓面 task (core/work/floor.ts taskClaim): `begun` when a computer hand had started it. */
export function noteTask(kind: string, begun: boolean): void {
  checked++;
  if (begun) stale.push({ kind, how: 'task', t: liveG().t });
}
/** The guard's record since the last reset: how many hand-outs were checked, and those that held begun work. */
export const handOuts = (): { checked: number; stale: HandOut[] } => ({ checked, stale: [...stale] });
export function handOutsReset(): void { checked = 0; stale = []; }
