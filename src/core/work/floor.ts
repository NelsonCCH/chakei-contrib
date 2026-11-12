// 樓面, the floor role: seating, order-taking, 傳菜, 執枱, takeaway
// bagging and 送外賣 are one role that 2-3 players share (WorkSpec.floor seats: floor, floor2, floor3), each picking
// work by tapping it. Every piece of floor work is a task with a stable id derived from the shift (`seat:<gid>`,
// `order:<gid>`, `carry:<table no>`, `clear:<table index>`, `bag:<gid>`, `deliver:<gid>`), recomputed on every referee
// step ("level-triggered", like the plugins: a lost message can never lose or double a task).
//
// Claims: the referee owns them. The first claim it receives wins; a later one is refused (the phone gets a nack and
// shows the bubble again); a claim the holder stops touching for CLAIM_IDLE_S (the referee's game clock) times out and
// the task is open again. A result that completes a task (seat, order, clean / cleared, carried, packed, ride) is refused
// when someone else holds that task's claim. Solo runs this same code on its referee of one, in memory.
//
// Computer cover: each floor seat the computer drives is one computer worker. It takes the oldest open task that has been
// open for COVER_S, one at a time, at the load table's mid-player pace. A player out on a 送外賣 run still holds their
// seat, so their absence brings no extra computer worker: the cost of being away stays.
import { liveG, bump, byId, asSeat, tableAt, curLevel } from '../state';
import { CORE_HOOK } from '../hooks';
import { aiSlip, bestTable } from '../bots/waiter';
import { linesOf, carried, packed } from '../referee/extras';
import { taskSec, floorShare } from './load';
import type { Result } from '../proto/messages';
import { bagBonus, rocketBonus } from '../../stations-next/deliver/core';
import { FLOOR_INTRO } from './roles';
import { noteTask } from '../coop/fresh';

export const FLOOR_IDS: readonly FloorSeatId[] = ['floor1', 'floor2', 'floor3'];
export const isFloorSeat = (s: unknown): s is FloorSeatId => FLOOR_IDS.some(x => x === s);
/** A claim not touched by its player for this long (game s) times out and the task is open again. */
export const CLAIM_IDLE_S = 8;
/** The computer leaves an open task to the players this long (game s) before it covers it. */
export const COVER_S = 4;
/** Seconds after bagging before a delivered order's food goes cold (its countdown bar). */
export const DELIVER_COLD_S = 45;
/** A delivered order that arrives hot: the rider's tip. */
export const DELIVER_TIP = 5;
/** At most this many orders in one 送外賣 run. */
export const RUN_MAX = 3;
/** The prefix of the computer's claims. */
export const CPU = '#cpu:';
export const KINDS: readonly FloorKind[] = ['seat', 'order', 'carry', 'clear', 'bag', 'deliver'];

/** The holder of a task set aside for the computer by the floor's budget (floorShareNow): no player sees or claims it. */
export const SHARE = CPU + 'share';
/** The computer's hands for the set-aside tasks: POOL + the task id holds it while it is done (poolStep). */
export const POOL = CPU + 'pool:';
/** A seat task set aside for the computer that found no table for this long (game s) is open to the players. */
export const SHARE_WAIT_S = 6;
/**
 * The share of new floor tasks that go to the players this shift: core/work/load.ts
 * floorShare, with the players on the floor seats and the work the shift booked so far. 1 when the computer drives no
 * floor seat (nobody else could do the rest) or outside the workload model (nothing booked: 屋邨, the lessons). A party
 * round seats only its 樓面 players, so there the pool always does the rest (the director paces the door by the
 * players' part, party/director.ts floorGroupSec).
 */
export function floorShareNow(): number {
  const seats = seatsFn(), players = seats.filter(s => s.player !== null).length;
  if (players === seats.length && !liveG().party) return 1;
  if (players > 0 && partyFloorCpu(players) === 0) return 1;   // no computer place on 樓面, no computer help
  return floorShare(players, liveG().work?.tasks ?? {});
}
/**
 * A party round's 樓面 places the computer works now: the switched-on places
 * (G.party.floorOn, from the lobby) less the players on the floor. With none, the players get the whole floor (one
 * player's load per player, the director's door pace) and no computer help: no pool, no helper. With one, the computer's
 * pool does everything past the players' load, as before the places could be switched off. 1 when the
 * round does not say (an older start message: both places on). Outside a party round: 1 (not used there).
 */
export function partyFloorCpu(players: number, S: GameState = liveG()): number {
  const on = S.party?.floorOn;
  return on === undefined ? 1 : Math.max(0, on - players);
}
/** The 樓面 is on in this shift. */
export const floorOn = (): boolean => !!liveG().floor;
export function freshFloor(): FloorShared {
  return { tasks: [], out: [], away: {}, bots: {}, stats: { claims: 0, lost: 0, expired: 0, cpu: 0, drops: 0, cold: 0 } };
}
export const kindOf = (id: string): FloorKind | null => { const k = id.split(':')[0]; return KINDS.find(x => x === k) ?? null; };
const num = (id: string): number => Number(id.slice(id.indexOf(':') + 1));

/** The floor seats and who drives each (registered by the referee: core/coop/referee.ts). */
export interface FloorSeatInfo { id: string; player: string | null }
let seatsFn: () => FloorSeatInfo[] = () => [];
/** The referee runs here (it registered its seats): only it derives the task list; a phone takes its list from the ticks. */
let refHere = false;
export function setFloorSeats(f: (() => FloorSeatInfo[]) | null): void { seatsFn = f ?? ((): FloorSeatInfo[] => []); refHere = f !== null; }

/* ---------- the task list ---------- */
/** The tasks the shift has now, by id (kind, and how many pieces for the clear mini-game). */
export function deriveIds(S: GameState): string[] {
  const out: string[] = [];
  for (const g of S.groups){
    if (g.take){ if (g.via === 'pack' && linesOf(g).every(x => x.l.done)) out.push('bag:' + String(g.id)); continue; }
    if (g.state === 'queue') out.push('seat:' + String(g.id));
    else if (g.state === 'order') out.push('order:' + String(g.id));
  }
  const pass = new Set<number>();
  for (const g of S.groups) if (!g.take && g.table !== null && linesOf(g).some(x => x.l.passT !== undefined)) pass.add(g.table + 1);
  for (const n of [...pass].sort((a, b) => a - b)) out.push('carry:' + String(n));
  for (const tb of S.tables) if (tb.dirty > 0) out.push('clear:' + String(tb.id));
  for (const o of S.floor?.out ?? []) if (o.rider === null) out.push('deliver:' + String(o.gid));
  return out;
}
/** The referee's step: the task list follows the shift; timed-out claims return; the computer covers. */
export function floorStep(): void {
  const S = liveG(), F = S.floor; if (!F || !refHere) return;   // a phone: the ticks and keyframes carry the list
  const t = S.t, ids = deriveIds(S), have = new Map(F.tasks.map(x => [x.id, x]));
  let changed = ids.length !== F.tasks.length;
  const share = floorShareNow();
  F.tasks = ids.map(id => {
    const x = have.get(id); if (x) return x;
    changed = true;
    // the budget: a new task is the players' while their share allows, else the computer's
    const k = kindOf(id) ?? 'seat', acc = (F.acc?.[k] ?? 1 - 1e-9) + share, mine = acc >= 1;   // per kind: each kind's first is the players'
    F.acc = { ...F.acc, [k]: mine ? acc - 1 : acc };
    return { id, k, at: t, by: mine ? null : SHARE, free: t, ct: 0, seen: 0 };
  });
  for (const x of F.tasks) if (x.by !== null && !x.by.startsWith(CPU) && t - x.seen > CLAIM_IDLE_S){ x.by = null; x.free = t; F.stats.expired++; changed = true; }
  // the computer's share waits for a free computer worker; one that waits too long is open to the players after all
  for (const x of F.tasks) if (x.by === SHARE && t - x.at > SHARE_WAIT_S){ x.by = null; x.free = t; changed = true; }
  const b = begunOf(F); for (const id of b) if (!ids.includes(id)) b.delete(id);
  if (coverStep(S, F)) changed = true;
  if (changed) bump();
}
/**
 * The tasks a computer hand (a cover worker or the pool) has started and not yet finished,
 * on the referee. The computer finishes what it starts, so a player's claim on one of these is the guard's failure
 * (core/coop/fresh.ts, read by tests/sim/fresh-work.test.js); an id leaves the set when the work is done or gone.
 */
const BEGUN = new WeakMap<FloorShared, Set<string>>();
function begunOf(F: FloorShared): Set<string> { let s = BEGUN.get(F); if (!s){ s = new Set(); BEGUN.set(F, s); } return s; }

/* ---------- claims (the referee's word is final) ---------- */
export const taskOf = (id: string): FloorTask | undefined => liveG().floor?.tasks.find(x => x.id === id);
/** `by` claims task `id`: true when it is theirs now (it was open, or theirs already). */
export function taskClaim(by: string, id: string): boolean {
  const S = liveG(), F = S.floor, x = taskOf(id); if (!F || !x) return false;
  if (x.by !== null && x.by !== by){ F.stats.lost++; return false; }
  if (x.by === null){ F.stats.claims++; x.ct = S.t; if (!by.startsWith(CPU)) noteTask(x.k, begunOf(F).has(id)); }
  x.by = by; x.seen = S.t; bump();
  // taking an order holds the table's patience, as the waiter's open slip does
  if (x.k === 'order'){ const g = byId(num(id)); if (g && !g.take && g.state === 'order'){ g.taken = true; g.later = null; } }
  return true;
}
/** `by` lets task `id` go: open again. */
export function taskRelease(by: string, id: string): boolean {
  const S = liveG(), x = taskOf(id); if (!x || x.by !== by) return false;
  x.by = null; x.free = S.t; bump();
  if (x.k === 'order'){ const g = byId(num(id)); if (g && !g.take && g.state === 'order') g.later = 2; }   // the slip goes back to the floor shortly
  return true;
}
/** `by` is still on these tasks (a claim not touched for CLAIM_IDLE_S times out). */
export function taskTouch(by: string, ids: readonly string[]): void {
  const S = liveG(); for (const id of ids){ const x = taskOf(id); if (x && x.by === by) x.seen = S.t; }
}
/** Every claim of `by` goes back (their seat changed hands, they left); a run they were on comes back to the door. */
export function releaseAll(by: string): void {
  const S = liveG(), F = S.floor; if (!F) return;
  let n = 0;
  for (const x of F.tasks) if (x.by === by){ x.by = null; x.free = S.t; n++; }
  for (const o of F.out) if (o.rider === by){ o.rider = null; n++; }
  if (F.away[by] !== undefined){ F.away = Object.fromEntries(Object.entries(F.away).filter(([k]) => k !== by)); n++; }
  if (n) bump();
}
/** The task a result completes (null: not a floor task). */
export function resultTask(r: Result): string[] {
  switch (r.k){
    case 'seat': return ['seat:' + String(r.gid)];
    case 'slipOpen': case 'order': return ['order:' + String(r.gid)];
    case 'clean': case 'cleared': return ['clear:' + String(r.table)];
    case 'carried': return ['carry:' + String(r.table)];
    case 'packed': case 'remake': return ['bag:' + String(r.gid)];
    case 'ride': return r.gids.map(g => 'deliver:' + String(g));
    default: return [];
  }
}
/** May `by` apply result `r`? Not when another holds the task's claim (the race's loser is refused). It claims for them. */
export function taskGuard(by: string, r: Result): boolean {
  if (!floorOn()) return true;
  const ids = resultTask(r);
  for (const id of ids){ const x = taskOf(id); if (x && x.by !== null && x.by !== by) return false; }
  for (const id of ids) if (taskOf(id)) taskClaim(by, id);
  return true;
}

/* ---------- a station's counted bubble ---------- */
// One bubble per station, never one per item: 「傳」 at the pass counts the dishes waiting, 「包」 in the takeaway bay the
// bags to pack, 「送」 at the rider exit the bags to deliver. A tap takes items from the station: each item is still its
// own task (carry:<table>, bag:<gid>, deliver:<gid>) and is claimed on its own through the referee, first claim wins, so
// two phones tapping the same station split its items and nothing is held twice.
export type StationTask = 'carry' | 'bag' | 'deliver';
export const STATION_TASKS: readonly StationTask[] = ['carry', 'bag', 'deliver'];
/** 傳菜: one tap takes tables until the tray's dishes reach this many (at least one table), at most TRAY_TABLES tables. */
export const TRAY_DISHES = 6, TRAY_TABLES = 3;
/** The dishes on the pass for table number `n` (from 1). */
export function passDishes(S: GameState, n: number): number {
  let c = 0;
  for (const g of S.groups) if (!g.take && g.table === n - 1) for (const x of linesOf(g)) if (x.l.passT !== undefined) c++;
  return c;
}
/** A station's open items (as this copy of the shift shows them), oldest first. */
export function stationOpen(kind: StationTask): FloorTask[] {
  return (liveG().floor?.tasks ?? []).filter(x => x.k === kind && x.by === null).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}
/** The number on a station's bubble: dishes at the pass for 「傳」, bags for 「包」 and 「送」. */
export function stationCount(kind: StationTask): number {
  const open = stationOpen(kind);
  if (kind !== 'carry') return open.length;
  const S = liveG(); return open.reduce((a, x) => a + Math.max(1, passDishes(S, num(x.id))), 0);   // a table's dishes can reach a phone a tick after its task
}
/** The items one tap on station `kind` takes: 傳菜 a trayful of tables, 包 one bag, 送 up to RUN_MAX bags. */
export function stationPick(kind: StationTask): string[] {
  const open = stationOpen(kind);
  if (kind === 'bag') return open.slice(0, 1).map(x => x.id);
  if (kind === 'deliver') return open.slice(0, RUN_MAX).map(x => x.id);
  const S = liveG(), out: string[] = []; let dishes = 0;
  for (const x of open){
    const d = passDishes(S, num(x.id));
    if (out.length && (dishes + d > TRAY_DISHES || out.length >= TRAY_TABLES)) break;
    out.push(x.id); dishes += d;
  }
  return out;
}

/* ---------- 送外賣 ---------- */
/** A bag for delivery was handed over (extras.ts packed): it waits at the door for a rider. */
export function bagOut(g: TakeGroup): void {
  const S = liveG(), F = S.floor; if (!F) return;
  F.out.push({ gid: g.id, no: g.no ?? g.id, cold: S.t + DELIVER_COLD_S, items: linesOf(g).length, rider: null });
  bump();
}
/** `by` sets off with these orders (the `ride` result): they leave the door; `by` is out of the shop. */
export function rideOut(by: string, gids: readonly number[]): boolean {
  const S = liveG(), F = S.floor; if (!F || F.away[by] !== undefined) return false;
  const os = F.out.filter(o => gids.includes(o.gid) && o.rider === null);
  if (!os.length || os.length !== gids.length || os.length > RUN_MAX) return false;
  for (const o of os){ o.rider = by; o.run = os.length; }   // a bigger run tips more per bag
  F.away = { ...F.away, [by]: S.t };
  for (const x of F.tasks) if (x.k === 'deliver' && gids.includes(num(x.id))) x.by = by;
  bump(); return true;
}
/** One order reached its door (`dropped`): hot pays the tip (x the run's bag bonus, x the rocket's), cold is a mistake. */
export function dropOff(by: string, gid: number, fast = false): boolean {
  const S = liveG(), F = S.floor; if (!F) return false;
  const o = F.out.find(x => x.gid === gid && x.rider === by); if (!o) return false;
  F.out = F.out.filter(x => x !== o); F.stats.drops++;
  if (S.t > o.cold){ F.stats.cold++; S.mistakes++; }
  else { const tip = Math.round(DELIVER_TIP * bagBonus(o.run ?? 1) * rocketBonus(fast)); S.revenue += tip; S.tips = (S.tips ?? 0) + tip; }
  S.served++; bump(); return true;
}
/** Back at the shop (`back`): the rider works the floor again; any order not dropped returns to the door. */
export function rideBack(by: string): boolean {
  const S = liveG(), F = S.floor; if (!F || F.away[by] === undefined) return false;
  F.away = Object.fromEntries(Object.entries(F.away).filter(([k]) => k !== by));
  for (const o of F.out) if (o.rider === by){ o.rider = null; delete o.run; }
  bump(); return true;
}
export const isAway = (by: string): boolean => liveG().floor?.away[by] !== undefined;

/* ---------- 執枱: the pieces on a dirty table ---------- */
/** What a table holds to clear (the 執枱 mini-game's feed): a cup per diner, plates and bowls by table and diners. */
export function messOf(tb: TableState): { plate: number; bowl: number; cup: number } {
  const d = Math.max(1, tb.dirty), plate = Math.ceil(d / 2) + (tb.id % 2), bowl = Math.max(0, d - Math.ceil(d / 2)) + ((tb.id + d) % 2);
  return { plate: Math.min(12, plate), bowl: Math.min(12, bowl), cup: Math.min(12, d) };
}
/** Seconds a mid player spends on a task (the load table): the computer works at this pace. */
export function taskSecOf(id: string): number {
  const S = liveG(), k = kindOf(id), n = num(id);
  switch (k){
    case 'seat': return taskSec('seat');
    case 'order': { const g = byId(n); return taskSec('order', g && !g.take ? g.size : 2, S.slot); }
    case 'carry': return taskSec('carry');
    case 'clear': { const tb = S.tables[n]; const m = tb ? messOf(tb) : { plate: 2, bowl: 1, cup: 2 }; return taskSec('clear', m.plate + m.bowl + m.cup); }
    case 'bag': { const g = byId(n); return taskSec('bag', g ? linesOf(g).length : 2); }
    case 'deliver': return taskSec('deliver', 0);
    default: return 3;
  }
}

/* ---------- the computer's floor workers ---------- */
/**
 * A leaving computer worker's task goes to a pool hand of its own (`POOL` + the task id), which does it
 * at `until`, when the worker would have: its run on the road keeps going under that hand (poolStep's riders), any other
 * task is held by it as the pool holds its own.
 */
function handToPool(F: FloorShared, who: string, task: string, until: number): void {
  const hand = POOL + task, start = until - taskSecOf(task);
  if (kindOf(task) === 'deliver' && F.away[who] !== undefined){
    for (const o of F.out) if (o.rider === who) o.rider = hand;
    for (const x of F.tasks) if (x.by === who) x.by = hand;
    F.away = { ...Object.fromEntries(Object.entries(F.away).filter(([k]) => k !== who)), [hand]: start };
    return;
  }
  const x = taskOf(task); if (!x || x.by !== who) return;
  x.by = hand; x.ct = start; x.seen = start;
}
function coverStep(S: GameState, F: FloorShared): boolean {
  const t = S.t; let changed = false;
  const seats = seatsFn(), cpu = seats.filter(s => s.player === null).map(s => s.id);
  // a seat a player took back: its computer worker leaves, but what it started the computer finishes (
  // the player is only ever given untouched work). Its task, or its run on the road, goes to the pool's
  // hands (poolStep) and is done when the worker would have done it; before, it was let go half done (a run came back
  // to the door with its bags, a slip it had picked up went back to the floor).
  for (const id of Object.keys(F.bots)) if (!cpu.includes(id)){
    const who = CPU + id, b = F.bots[id];
    if (b?.task) handToPool(F, who, b.task, b.until);
    for (const x of F.tasks) if (x.by === who) taskRelease(who, x.id);   // hands kept on tasks already done
    if (isAway(who)) rideBack(who);
    F.bots = Object.fromEntries(Object.entries(F.bots).filter(([k]) => k !== id)); changed = true;
  }
  if (poolStep(S, F)) changed = true;
  for (const id of cpu){
    const who = CPU + id, b = F.bots[id] ??= { task: null, until: 0 };
    if (b.task !== null){
      if (t < b.until) continue;
      const task = b.task; b.task = null; changed = true;
      cpuDo(who, task);
      // done: the worker keeps its hand on the task until the next derive drops it, so no open bubble flashes up for a
      // job already done (as the pool's hands do); it lets go at once only if the shift still has that work
      begunOf(F).delete(task);
      if (taskOf(task)?.by === who && deriveIds(S).includes(task)) taskRelease(who, task);
      continue;
    }
    // a hand kept on a done task that the derive kept too (the same work came up again: a new dish for that table): let go
    for (const x of F.tasks) if (x.by === who){ taskRelease(who, x.id); changed = true; }
    const open = F.tasks.filter(x => x.by === null && t - x.free >= COVER_S).sort((a, c) => a.free - c.free);
    for (const x of open){
      if (x.k === 'seat'){ const g = byId(num(x.id)); if (!g || g.take || !bestTable(asSeat(g))) continue; }
      if (!taskClaim(who, x.id)) continue;
      let sec = taskSecOf(x.id);
      if (x.k === 'deliver'){
        const more = F.tasks.filter(y => y.k === 'deliver' && y.by === null).slice(0, RUN_MAX - 1).map(y => y.id);
        for (const m of more) taskClaim(who, m);
        const gids = [x.id, ...more].map(num);
        rideOut(who, gids); sec = taskSec('deliver', gids.length - 1);
      }
      b.task = x.id; b.until = t + sec; F.stats.cpu++; changed = true;
      for (const y of F.tasks) if (y.by === who) begunOf(F).add(y.id);
      break;
    }
  }
  return changed;
}
/**
 * The budget's set-aside tasks: the computer takes each at once and finishes it at the load
 * table's mid pace, each with a hand of its own (`POOL` + the task id), as the computer's 傳菜 and takeaway stations
 * did beside a single 伙記 before 樓面. So the players' load is their budget, and the rest never waits on how many floor
 * seats the computer drives (those workers still cover a player's open task after COVER_S, as before).
 */
function poolStep(S: GameState, F: FloorShared): boolean {
  const t = S.t; let changed = false;
  for (const x of F.tasks){
    if (x.by === SHARE){
      if (x.k === 'seat'){ const g = byId(num(x.id)); if (!g || g.take || !bestTable(asSeat(g))) continue; }   // waits for a table
      const who = POOL + x.id; x.by = who; x.ct = t; x.seen = t; F.stats.cpu++; changed = true; begunOf(F).add(x.id);
      if (x.k === 'deliver') rideOut(who, [num(x.id)]);
    } else if (x.by === POOL + x.id){
      // done at the mid pace; the hand keeps the task until the next derive drops it (no open bubble flashes up for a
      // job already done), and lets it go a second later only if it is still there (the job did not take)
      const who = x.by, d = t - x.ct, sec = taskSecOf(x.id);
      if (d >= sec + 1){ taskRelease(who, x.id); begunOf(F).delete(x.id); changed = true; }
      else if (d >= sec && x.seen < x.ct + sec){ cpuDo(who, x.id); x.by = who; x.seen = t; changed = true; }
    }
  }
  // a pool rider is out with its bag: once the bag is on the road its deliver task leaves the list (deriveIds lists only
  // bags at the door), so the hand above never sees it again; the run finishes here, from F.away, at the mid pace
  for (const [who, at] of Object.entries(F.away)){
    if (!who.startsWith(POOL + 'deliver:')) continue;
    const id = who.slice(POOL.length);
    if (t - at >= taskSecOf(id)){ cpuDo(who, id); changed = true; }
  }
  return changed;
}
/** The computer finishes a task it held (if the shift still has it). */
function cpuDo(who: string, id: string): void {
  const S = liveG(), n = num(id);
  switch (kindOf(id)){
    case 'seat': { const g = byId(n); if (!g || g.take || g.state !== 'queue') return; const tb = bestTable(asSeat(g)); if (tb) CORE_HOOK.seat(asSeat(g), tb); return; }
    case 'order': { const g = byId(n); if (g && !g.take && g.state === 'order') CORE_HOOK.submitOrder(g, aiSlip(g)); return; }
    case 'carry': {
      const refs: { gid: number; dest: 'bar' | 'kitchen' | 'roast'; i: number }[] = [];
      for (const g of S.groups) if (!g.take && g.table === n - 1) for (const x of linesOf(g)) if (x.l.passT !== undefined) refs.push({ gid: g.id, dest: x.dest, i: x.i });
      if (refs.length) carried(refs, n);
      return;
    }
    case 'clear': { const tb = S.tables[n]; if (tb && tb.dirty) CORE_HOOK.cleanTable(tableAt(n)); return; }
    case 'bag': packed(n, 2); return;
    case 'deliver': {
      const F = S.floor; if (!F) return;
      for (const o of F.out.filter(x => x.rider === who)) dropOff(who, o.gid);
      rideBack(who);
      for (const x of F.tasks) if (x.by === who && x.k === 'deliver') x.by = null;
      return;
    }
    default: return;
  }
}
/** A main-ladder shop (屋邨 .. 通宵, 地獄午市): not an era, themed bonus or festival shop (ui/floor-map.ts mapShop's rule). */
export const mainLadder = (L: Level | undefined | null): boolean => !!L && !L.era && !L.fest && (L.n <= 7 || !!L.hell);
/**
 * Is the floor on for a shift on this level? The room and solo 伙記 use it.
 * 樓面 is 伙記's seat on every main-ladder level from level 1 (there seating and order-taking) and gains its tasks
 * with the ladder; a bonus level has it when its roles include 傳菜 or 外賣 (unchanged).
 */
export function floorLevel(L: Level | undefined | null): boolean { return mainLadder(L) || (!!L?.roles && ((L.roles.runner ?? 0) > 0 || (L.roles.takeaway ?? 0) > 0)); }
/**
 * 執枱 is a mini-game on this shift's floor: from FLOOR_INTRO.clear on the ladder, on every bonus floor level,
 * and in its lesson (the floor on with no level). Before it (屋邨), a dirty table is the old one-tap clean.
 */
export const clearGameNow = (): boolean => { if (!floorOn()) return false; const L = curLevel(); return !L || L.n >= FLOOR_INTRO.clear; };
/** For the screens: the level the shift plays (avoids importing state in UI code). */
export const floorLevelNow = (): boolean => floorLevel(curLevel());
