// Per-person counts for a party round's report (the awards, core/party/close.ts): what each player's
// own results did, counted where the referee applies them (referee.ts applyFrom). A result's effect on the shared books
// (a mistake, a job well done, a broken run) is read as the change it made, so every seat, the new ones included, feeds
// this from the same outcome events that feed the team's combo and 少出錯. The kitchen's burns happen on the cook's phone
// (stations/kitchen.ts) and reach the referee in the seat's checkpoint (the phone's status), so they are read there.
// 幫 / 催 are not counted: the pings do not exist yet, so helps and hurries stay 0.
import type { PlayerId, Result, SeatId } from '../proto/messages';
import { liveG, byId } from '../state';
import { taskSec } from '../work/load';

export interface PersonTally {
  mistakes: number;
  burnt: number;
  /** Bills paid at the till with no wrong total or change on them first. */
  exact: number;
  /** Jobs done well since this person's last mistake or broken run; `streak` is the longest. */
  run: number;
  streak: number;
  /** 樓面: floor tasks this person finished, and their size in a mid player's seconds (load.ts). */
  floorN: number;
  floorSec: number;
}
interface Tally { people: Record<PlayerId, PersonTally>; missed: number[]; burnt: Record<SeatId, number> }
let T: Tally = { people: {}, missed: [], burnt: {} };
let pre = { mistakes: 0, goods: 0, combo: 0 };
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A new shift: nobody has done anything yet. */
export function tallyReset(): void { T = { people: {}, missed: [], burnt: {} }; }
const person = (p: PlayerId): PersonTally => T.people[p] ??= { mistakes: 0, burnt: 0, exact: 0, run: 0, streak: 0, floorN: 0, floorSec: 0 };
/** What player `p` did this shift (undefined: nothing counted). */
export const tallyOf = (p: PlayerId): Readonly<PersonTally> | undefined => T.people[p];

/** Just before a teammate's result is applied: the books as they were. */
export function tallyBefore(): void {
  const S = liveG();
  pre = { mistakes: S.mistakes, goods: S.goods ?? 0, combo: S.combo ?? 0 };
}
/** Just after: the jobs it did well are player `p`'s (a broken run ends theirs). */
export function tallyAfter(p: PlayerId, r: Result, ok: boolean): void {
  if (r.k === 'tillMiss' && !T.missed.includes(r.cid)) T.missed.push(r.cid);
  if (!ok) return;
  const S = liveG(), q = person(p);
  const dm = S.mistakes - pre.mistakes, dg = (S.goods ?? 0) - pre.goods, broke = (S.combo ?? 0) < pre.combo + dg;
  q.run = dm > 0 || broke ? 0 : q.run + dg;
  q.streak = Math.max(q.streak, q.run);
  if (r.k === 'tillPaid' && !T.missed.includes(r.cid)) q.exact++;
  const fs = S.floor ? floorSecOf(r) : 0;
  if (fs > 0){ q.floorN++; q.floorSec += fs; }
}
/** A floor result's size in a mid player's seconds (core/work/load.ts LOAD); 0 for anything else. */
function floorSecOf(r: Result): number {
  const S = liveG();
  switch (r.k){
    case 'seat': return taskSec('seat');
    case 'order': { const g = byId(r.gid); return taskSec('order', g && 'size' in g ? g.size : 2, S.slot); }
    case 'carried': return taskSec('carry');
    case 'cleared': return taskSec('clear', 4, S.slot);
    case 'packed': { const g = byId(r.gid); return taskSec('bag', g && 'take' in g && g.take ? g.items.length : 2, S.slot); }
    case 'ride': return taskSec('deliver', Math.max(0, r.gids.length - 1));
    default: return 0;
  }
}
let driverOf: (seat: SeatId) => PlayerId | null = () => null;
/** The referee says who drives a seat (referee.ts): a mistake is the person's who holds the seat when it is counted. */
export function setTallyDrivers(f: ((seat: SeatId) => PlayerId | null) | null): void { driverOf = f ?? (() => null); }
/**
 * `n` mistakes counted against seat `seat` (every place the shop's rules add to G.mistakes calls this beside it): the
 * person driving that seat now gets them, and their clean run ends. Only on the referee (elsewhere nobody drives here).
 */
export function tallyMiss(seat: SeatId, n = 1): void {
  const p = driverOf(seat); if (p === null) return;
  const q = person(p); q.mistakes += n; q.run = 0;
}
/** The kitchen's checkpoint from player `p`'s phone: burns since the seat's last checkpoint are theirs. */
export function tallyBurnt(p: PlayerId, seat: SeatId, burnt: number): void {
  const was = T.burnt[seat] ?? 0;
  if (burnt > was) person(p).burnt += burnt - was;
  T.burnt[seat] = Math.max(was, burnt);
}

/** For the room's save (a restarted room carries the counts on). */
export const tallySave = (): unknown => structuredClone(T);
export function tallyLoad(v: unknown): void {
  tallyReset();
  if (!isRec(v)) return;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (Array.isArray(v.missed)) T.missed = v.missed.filter(finite);
  if (isRec(v.burnt)) for (const [k, n] of Object.entries(v.burnt)) if (finite(n)) T.burnt[k] = n;
  if (isRec(v.people)) for (const [p, x] of Object.entries(v.people)) {
    if (!isRec(x)) continue;
    const num = (k: keyof PersonTally): number => { const n = x[k]; return finite(n) ? n : 0; };
    T.people[p] = { mistakes: num('mistakes'), burnt: num('burnt'), exact: num('exact'), run: num('run'), streak: num('streak'), floorN: num('floorN'), floorSec: num('floorSec') };
  }
}
