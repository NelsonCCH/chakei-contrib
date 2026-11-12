// 樓面 floor seats on a phone. A floor player plays the waiter's screens
// (seat, order: each tap claims its task first, stations/waiter.ts FloorGate) and takes the other floor work from bubbles
// on the shop map (ui/floor-map.ts): a dirty table's 「執」 opens 執枱 for that table (floorJobStart); a station's counted
// bubble (「傳」 at the pass, 「包」 in the takeaway bay, 「送」 at the rider exit) takes items from the station
// (floorStationStart): each item is its own task, claimed on its own through the referee, first claim wins, so phones
// tapping the same station split its items. The job's mini-game is fed with the items this phone holds: 傳菜 (those
// tables' dishes, plugins/runner.ts), 打包 (one bag, plugins/takeaway.ts), 執枱 (one table, plugins/clear.ts) or
// 送外賣 (one run of up to RUN_MAX bags, plugins/deliver.ts). An item leaves the job when it is done or someone else
// holds it; the job ends when it has none left; a 送外賣 job ends when the rider is home.
import { registerStation, stationOf } from '../registry';
import { actor } from '../results';
import { noteHandOut } from '../fresh';
import { liveG, G, bump } from '../../state';
import { toast } from '../../fx';
import { taskClaim, taskRelease, taskTouch, taskOf, kindOf, stationPick, clearGameNow, resultTask, type StationTask } from '../../work/floor';
import { phone, taskWant, taskDrop, setWorking, pendingResults } from '../phone';
import { referee } from '../referee';
import { setFloorGate } from '../../stations/waiter';
import { runnerOnly } from './runner';
import { takeawayOnly } from './takeaway';
import { clearFor } from './clear';
import { deliverSetOff, deliverDrive, deliverHome } from './deliver';

/** The mini-game each floor task kind opens (seat and order are the waiter's own screens). */
export type FloorGame = 'runner' | 'takeaway' | 'clear' | 'deliver';
const GAME: Readonly<Partial<Record<FloorKind, FloorGame>>> = { carry: 'runner', bag: 'takeaway', clear: 'clear', deliver: 'deliver' };
export const gameOf = (id: string): FloorGame | null => { const k = kindOf(id); return k ? GAME[k] ?? null : null; };
const num = (id: string): number => Number(id.slice(id.indexOf(':') + 1));

/** A job: the items (tasks) it holds, the ones the referee has confirmed, and whether its run has left. */
interface Job { ids: string[]; held: Set<string>; game: FloorGame; g: GameState; rode: boolean; n: number }
let job: Job | null = null, serial = 0;
/** The floor job this phone's player is on now (its mini-game shows), or null. `id`: its first item; `n`: the job's serial (a new tap, a new job). */
export const floorJob = (): { id: string; ids: readonly string[]; game: FloorGame; n: number } | null =>
  job && job.g === G && job.ids[0] ? { id: job.ids[0], ids: job.ids, game: job.game, n: job.n } : null;

/** Claim floor task `id` for this phone's player (predicted on a teammate's phone, at once on the referee's). */
export function floorWant(id: string): boolean {
  if (!liveG().floor) return true;
  return phone() ? taskWant(id) : taskClaim(actor(), id);
}
/** Let floor task `id` go. */
export function floorDrop(id: string): void {
  if (!liveG().floor) return;
  if (phone()) taskDrop(id); else taskRelease(actor(), id);
}
/**
 * The batch claim: claims each of `ids` on its own (first claim wins on the referee) and returns the ones
 * this phone now holds or has asked for. The refused ones come back through the lost list (the 「隊友…」 notice). One path
 * for every station bubble, 送外賣's multi-bag runs included.
 */
export function floorTakeMany(ids: readonly string[]): string[] { return ids.filter(id => floorWant(id)); }
function aim(j: Job | null): void {
  runnerOnly(j?.game === 'runner' ? j.ids.map(num) : null);
  takeawayOnly(j?.game === 'takeaway' && j.ids[0] ? num(j.ids[0]) : null);
  clearFor(j?.game === 'clear' && j.ids[0] ? num(j.ids[0]) : null);
}
function begin(ids: string[], game: FloorGame): void {
  // every job's mini-game starts from zero (no bag, tray or table left from an earlier job on this phone)
  stationOf(game)?.restart?.();
  job = { ids, held: new Set(), game, g: liveG(), rode: false, n: ++serial };
  aim(job); noteHandOut(game, 'job'); bump();
}
/** Starts the job of floor bubble `id` (one item: 執枱, or any single task): false when someone else has it. */
export function floorJobStart(id: string): boolean {
  const game = gameOf(id); if (!game || !liveG().floor) return false;
  if (game === 'clear' && !clearGameNow()) return false;   // before 執枱 joins the floor: the waiter's one-tap clean
  const now = floorJob(); if (now?.ids.includes(id)) return true;
  if (now && job?.rode) return false;   // out on a run: back first
  if (now) floorJobEnd();
  if (!floorWant(id)){ toast('隊友做緊呢樣'); return false; }
  begin([id], game);
  return true;
}
/**
 * A station's counted bubble (「傳」 carry, 「包」 bag, 「送」 deliver): takes the items one tap takes (work/floor.ts
 * stationPick) and opens the station's mini-game with them. False when the station has nothing left to take.
 */
export function floorStationStart(kind: StationTask): boolean {
  const S = liveG(); if (!S.floor) return false;
  const now = floorJob();
  if (now && job?.rode) return false;
  const game = GAME[kind]; if (!game) return false;
  if (now?.game === game) return true;   // already on this station's job
  if (now) floorJobEnd();
  const got = floorTakeMany(stationPick(kind));
  if (!got.length){ toast('隊友搶先咗：呢度冇嘢淨'); return false; }
  begin(got, game);
  return true;
}
/** Leaves the job (返樓面): its items go back to the floor unless done or on the road. */
export function floorJobEnd(): void {
  const j = job; if (!j) return;
  job = null; aim(null);
  if (!j.rode) for (const id of j.ids) if (taskOf(id)?.by === actor()) floorDrop(id);
  bump();
}
/** What this phone's player is on (the status keeps these claims alive): the job's items, the group picked at the door, the slip. */
export function floorWorking(): string[] {
  const S = G; if (!S?.floor) return [];
  const out: string[] = [];
  const j = floorJob(); if (j) out.push(...j.ids);
  if (S.selected !== null) out.push('seat:' + String(S.selected));
  if (S.sheet) out.push('order:' + String(S.sheet.gid));
  return out;
}
setWorking(floorWorking);
setFloorGate({
  want: floorWant,
  drop: floorDrop,
  clear: table => floorJobStart('clear:' + String(table)),
});

/** The floor seat's step where it is driven by this phone: the job's mini-game, and its end. */
function step(dt: number): void {
  const S = liveG(), j = job;
  if (!j) return;
  if (j.g !== S){ job = null; aim(null); return; }
  if (referee()) taskTouch(actor(), floorWorking());   // a teammate's phone touches through its status instead
  if (j.rode){
    deliverDrive(dt);
    if (deliverHome()){ job = null; aim(null); bump(); }
    return;
  }
  const me = actor(), pend = Object.values(phone()?.pend ?? {});
  // an item this phone's mini-game has just finished is done here and now (its result is on its way to the
  // referee), so the job ends and the floor shows the frame the order is finished, not a tick and a link later
  const sent = new Set(pendingResults().filter(o => o.r.k !== 'remake').flatMap(o => resultTask(o.r)));
  // each item: done (left the list, or finished here), taken by someone else, or back on the floor after it was this phone's
  const keep = j.ids.filter(id => {
    const x = taskOf(id), mine = x?.by === me;
    if (mine && !pend.includes(id)) j.held.add(id);
    return !(!x || sent.has(id) || (x.by !== null && !mine) || (j.held.has(id) && x.by === null));
  });
  if (keep.length !== j.ids.length){ j.ids = keep; if (j.game !== 'deliver') aim(j); bump(); }
  if (!j.ids.length){ job = null; aim(null); bump(); return; }
  if (j.game === 'deliver'){
    // the bike waits at the door until every claim is settled; deliverSetOff (plugins/deliver.ts) leaves out a
    // lost bag and sends the `ride` with the granted ones
    const go = deliverSetOff(j.ids.map(num));
    if (go.st === 'wait') return;
    if (go.st === 'none'){ job = null; aim(null); bump(); return; }
    j.ids = go.gids.map(g => 'deliver:' + String(g)); j.rode = true;
    if (deliverHome()){ job = null; aim(null); }
    bump(); return;
  }
  stationOf(j.game)?.step?.(dt, 'me');
}

registerStation({
  kind: 'floor', v: 1,
  pick: () => ({}),
  put: () => true,
  waiting: S => S.floor?.tasks.filter(x => x.by === null).length ?? 0,
  step: (dt, driver) => { if (driver === 'me') step(dt); },
});
