// The party director: on a party night every seat gets its own core work, made for it
// directly, along the night's curve, and no seat waits on another.
//
// - The curve (`curve`): a round starts slow, builds to a peak a little over a mid player's pace, and winds down.
// - Each seat's pace is the curve x its adaptation (`a`, how its players keep up) x the players on its position (two
//   players on a shared position get twice the work). 1 = a mid player's whole time (core/work/load.ts LOAD seconds).
// - The door (the waiter's work): the next group comes after the last one's waiter seconds at that pace.
// - 樓面: a bundled position (seat, order, 傳, 執, 包, 送) gets ONE mid player's load shared
//   across its tasks per player on it (floorBudget / floorShare, core/work/load.ts): the door paces groups by
//   the players' part of each group's floor work (floorGroupSec), the computer's pool does the rest (core/work/floor.ts
//   poolStep), and two players on 樓面 get twice one player's part. That pool (and the helper below)
//   is the computer's 樓面 place; with no place switched on for the computer the players get the whole floor, no help.
// - Every other seat keeps a credit of work seconds owed at its pace; what reaches it from upstream (a diner's drink, a
//   bill, a dish on the pass) pays the credit down, and when the credit owes a whole job the director makes one for the
//   seat directly (a takeaway drink at the bar, a takeaway meal in the kitchen, a walk-in bill at the till, a dish on the
//   pass, a 斬料 walk-in, a bag ready to pack). A player seat with nothing waiting for TOPUP_S gets a job at once.
// - Helpers (upstream lag never starves downstream): a line a player's seat has left too long (HELP_S) is done by the
//   computer, so the seats after it keep flowing; the player is not paid for it (no result of theirs).
// - Adaptation: a player seat drowning (more than HIGH waiting) eases off; a seat clearing everything is pushed.
// Runs only in a party round (G.party), only on the referee (referee/index.ts update: the room, or a referee of one), and
// draws only from the shift's stream, so the same seed and the same inputs give the same night. Solo, co-op levels and
// the default room never set G.party: nothing here runs there.
import { liveG, bump, D, tableAt } from '../state';
import { rng, rnd, type Rng } from '../rng';
import { CFG, COLORS } from '../data/menus';
import { CORE_HOOK } from '../hooks';
import { drinkKey, priceSlip } from '../rules/price';
import { randDrink } from '../rules/order';
import { patMul } from '../playtest/pace';
import { taskSec, dineTasks, loadOf, floorShare, type Lines } from '../work/load';
import { partyFloorCpu } from '../work/floor';
import { partySeats, SHOP_LADDER } from './config';
import { makeGroup, seatProblem, SP } from '../referee/customers';
import { bestTable } from '../bots/waiter';
import { linesOf, passCount, passFull, lineMade, roastWalkIn, packOf } from '../referee/extras';
import { mealKey, takeBill } from '../referee/work';

/** The night's curve over a round, x = elapsed share: slow start, a busy peak (a bit over a mid player), a wind-down. */
export const CURVE: readonly (readonly [number, number])[] = [[0, 0.55], [0.25, 0.85], [0.55, 1.2], [0.8, 1.2], [1, 0.65]];
export function curve(x: number): number {
  const p = CURVE, c = Math.max(0, Math.min(1, x));
  for (let i = 1; i < p.length; i++){
    const [x0, y0] = p[i - 1] ?? [0, 1], [x1, y1] = p[i] ?? [1, 1];
    if (c <= x1) return y0 + (y1 - y0) * (x1 > x0 ? (c - x0) / (x1 - x0) : 0);
  }
  return p[p.length - 1]?.[1] ?? 1;
}
/** Adaptation: per second, how fast a seat's multiplier moves, and its range. */
export const ADAPT_RATE = 0.04, ADAPT_MIN = 0.6, ADAPT_MAX = 1.4;
/** A player seat with more than this waiting is drowning (the director eases off it). */
export const HIGH: Readonly<Record<string, number>> = { waiter: 3, floor: 4, bar: 6, kitchen: 6, till: 4, runner: 6, roast: 3, takeaway: 3 };
/** A player seat with nothing waiting this long gets a job at once (the idle gate is 6 s). */
export const TOPUP_S = 4;
/** Seconds before the computer helps with a line a player's seat left (so the seats after it keep flowing). */
export const HELP_S: Readonly<Record<string, number>> = { waiter: 12, bar: 15, kitchen: 20, runner: 25, roast: 40, floor: 25, floorCarry: 30 };
/** The credit a seat may run ahead of its pace (in jobs): upstream bursts pay this much in advance. */
const CREDIT_LOW = 3;

/** The director's shared state, in G (plain JSON, travels in keyframes and the room's saves). */
export function freshDir(): DirShared { return { a: {}, cr: {}, q: {}, made: {}, help: {}, off: {}, dirty: {} }; }
export const dirOn = (): boolean => { const S = liveG(); return !!S.party && !S.tut; };
const dir = (): DirShared => liveG().dir ??= freshDir();

/** The position a seat belongs to: the 樓面 floor seats share one; every other seat is its own. */
export const positionOf = (seat: string): string => seat.startsWith('floor') ? 'floor' : seat;
/** Players on a seat's position (seats of that position a person drives). */
export function playersOn(seat: string, S: GameState = liveG()): number {
  const pos = positionOf(seat);
  return Object.entries(S.roles).filter(([k, r]) => k !== 'floor' && positionOf(k) === pos && (r === 'me' || r === 'remote')).length;
}
/** The director's key for a seat: its position (the 樓面 seats share one pace, credit and adaptation). */
const keyOf = positionOf;
/** A seat's pace now: curve x adaptation x players on its position (at least one: the shop runs at a computer seat too). */
export function pace(seat: string, S: GameState = liveG()): number {
  const sec = S.party?.sec ?? CFG.gameSec;
  return curve(S.t / sec) * (S.dir?.a[keyOf(seat)] ?? 1) * Math.max(1, playersOn(seat, S));
}

/* ---------- what is waiting at each seat, on the referee's shared state ---------- */
const openDrinks = (S: GameState): number => S.groups.reduce((a, g) => a + (g.state === 'wait' && g.drinks ? g.drinks.filter(d => !d.done).length : 0), 0);
const openMeals = (S: GameState): number => S.groups.reduce((a, g) => a + (g.state === 'wait' && g.meals ? g.meals.filter(m => !m.done).length : 0), 0);
const openRoast = (S: GameState): number => S.groups.reduce((a, g) => a + (g.roast ?? []).filter(l => !l.done).length, 0);
const readyBags = (S: GameState): number => S.groups.filter(g => g.take && g.via === 'pack' && linesOf(g).every(x => x.l.done)).length;
const doorWork = (S: GameState): number => S.groups.filter(g => g.state === 'queue' || (g.state === 'order' && !g.take && !g.taken)).length + S.tables.filter(t => t.dirty).length;
/** 樓面's open bubbles a player can act on now (a party at the door with no table free to take is not one yet). */
export function floorOpen(S: GameState = liveG()): number {
  return (S.floor?.tasks ?? []).filter(x => {
    if (x.by !== null) return false;
    if (x.k !== 'seat') return true;
    const g = S.groups.find(y => y.id === Number(x.id.slice(5)));
    return !!g && !g.take && g.state === 'queue' && !!bestTable(g);
  }).length;
}
/** Jobs waiting at a seat as the referee sees them (樓面: its open bubbles a player can act on). */
export function backlog(seat: string, S: GameState = liveG()): number {
  switch (positionOf(seat)){
    case 'waiter': return doorWork(S);
    case 'floor': return S.floor ? floorOpen(S) : doorWork(S);
    case 'bar': return openDrinks(S);
    case 'kitchen': return openMeals(S);
    case 'till': return S.payQ.length;
    case 'runner': return passCount();
    case 'roast': return openRoast(S);
    case 'takeaway': return readyBags(S);
    default: return 0;
  }
}
const isPlayer = (seat: string, S: GameState): boolean => seat === 'floor' ? playersOn('floor1', S) > 0 : Object.entries(S.roles).some(([k, r]) => k === seat && (r === 'me' || r === 'remote'));

/* ---------- the seats' jobs, in a mid player's seconds ---------- */
const dishSec = (): number => taskSec('carry') / 1.5;   // a 傳菜 trip carries about 1.5 dishes (core/work/load.ts)
const groupSec = (g: SeatGroup, sl: Slot): number => taskSec('seat') + taskSec('order', g.size, sl) + 1;
/**
 * 樓面's part of one dine-in group, in a mid player's seconds (the budget in core/work/load.ts):
 * the group's floor tasks as the workload books them (dineTasks: seating, the order, its share of a carry trip when the
 * shop has 傳菜, clearing), of which the players get `floorShare` (one 伙記's load per player on 樓面, floorBudget); the
 * rest is the computer's pool (core/work/floor.ts floorShareNow / poolStep). So the door paces groups by the players'
 * part: one player on 樓面 gets one player's load, two get twice it.
 */
export function floorGroupSec(g: SeatGroup, S: GameState): number {
  const l: Lines = g.wl ?? { bar: g.persons.length, kitchen: g.persons.filter(p => p.food || p.set || p.dish).length, roast: 0 };
  const tasks = dineTasks(g.size, l, S.slot, { carry: (S.extra ?? []).includes('runner') }), booked: Record<string, [number, number]> = {};
  for (const [k, n, s] of tasks){ const c = booked[k] ??= [0, 0]; c[0] += n; c[1] += s; }
  const on = playersOn('floor1', S), players = Math.max(1, on);
  // no computer place switched on beside the players: the floor is all theirs (floorShareNow gives 1)
  if (on > 0 && partyFloorCpu(on, S) === 0) return loadOf(tasks).floor;
  return floorShare(players, booked) * loadOf(tasks).floor;
}
/** The computer helps on 樓面 (its late-task helper below): unless its players have no computer place beside them. */
const floorHelp = (S: GameState): boolean => { const on = playersOn('floor1', S); return on === 0 || partyFloorCpu(on, S) > 0; };
/** The door's position and a group's seconds there: 樓面's players' part on a 樓面 shift, else the waiter's. */
const doorKey = (S: GameState): string => S.floor ? 'floor' : 'waiter';
const doorSec = (g: SeatGroup, S: GameState): number => S.floor ? floorGroupSec(g, S) : groupSec(g, S.slot);
const unitSec = (seat: string, sl: Slot): number => {
  switch (seat){
    case 'bar': return taskSec('drink');
    case 'kitchen': return taskSec('meal', 0, sl);
    case 'till': return taskSec('pay', 2, sl);
    case 'runner': return dishSec();
    case 'roast': return taskSec('chop');
    case 'takeaway': return taskSec('bag', 2, sl);
    default: return 10;
  }
};
/** Work offered to a seat (natural or made): pays its credit down and is logged by 10% of the round for the guards. */
function offer(seat: string, sec: number): void {
  const S = liveG(), D_ = dir(), k = keyOf(seat);
  D_.cr[k] = (D_.cr[k] ?? 0) - sec;
  const b = Math.min(9, Math.floor(10 * S.t / (S.party?.sec ?? CFG.gameSec))), o = D_.off[k] ??= Array.from({ length: 10 }, () => 0);
  o[b] = (o[b] ?? 0) + sec;
}

/* ---------- the door ---------- */
/** The gap after group `g` came in: its waiter seconds at the waiter's pace (the fever's heat on top, as spawnGap's). */
export function dirGap(g: SeatGroup, heat: number, r: Rng = rng): number {
  const S = liveG(), s = doorSec(g, S), k = doorKey(S);
  offer(k, s);
  return s / Math.max(0.2, pace(k === 'floor' ? 'floor1' : k)) * heat * rnd(0.8, 1.2, r);
}

/* ---------- jobs made for a seat ---------- */
function stallGroup(drinks: string[], meals: string[], pat: number): TakeGroup {
  const S = liveG(), id = S.nextId++, color = COLORS[S.colorIx++ % COLORS.length] ?? '#c96', until = S.t + pat, items = [...drinks, ...meals];
  return { id, color, label: '外賣客', size: 1, take: true, state: 'wait', table: null, items, slip: items, result: { correct: true },
    drinks: drinks.map(k => ({ k, done: false, ok: true, dn: 1 })), meals: meals.map(k => ({ k, done: false, ok: true, dn: 1 })),
    drinkMax: pat, drinkUntil: until, mealMax: pat, mealUntil: until, until, max: pat, orderAt: S.t };
}
/** One job for `seat`, made directly; false when the seat has nothing it can take now (no table to carry to). */
function make(seat: string, r: Rng): boolean {
  const S = liveG(), sl = S.slot;
  switch (seat){
    case 'waiter': case 'floor': { const g = makeGroup(undefined, undefined, r); CORE_HOOK.enqueue(g); offer(seat, doorSec(g, S)); return true; }
    case 'bar': {
      // 外賣飲品: a drink to go, made at the bar and paid there (the stall's customer)
      S.groups.push(stallGroup([drinkKey(randDrink(r))], [], CFG.drinkPat * D().pat * SP() * 1.1 * patMul('bar'))); break;
    }
    case 'kitchen': {
      const k = mealKey(r); if (!k) return false;
      S.groups.push(stallGroup([], [k], CFG.foodPat * D().pat * SP() * patMul('kitchen'))); break;
    }
    case 'till': {
      // a walk-in bill: a takeaway order already bagged at the counter, paid at the till (no other seat makes it)
      const keys = Array.from({ length: 1 + Math.floor(r() * 3) }, () => drinkKey(randDrink(r)));
      S.packNo = (S.packNo ?? 20) + 1 + Math.floor(r() * 3);
      const b = takeBill({ no: S.packNo, keys, roast: [], deliver: false }, r); b.dn = 1; S.payQ.push(b); break;
    }
    case 'runner': {
      // a dish out to a seated table (the kitchen's 加送: soup or toast on the house), straight onto the pass
      if (passFull()) return false;
      const gs = S.groups.filter((g): g is SeatGroup => !g.take && g.table !== null && (g.state === 'wait' || g.state === 'eat') && !!g.meals);
      const g = gs.find(x => x.state === 'wait') ?? gs[0], k = g ? mealKey(r) : null;
      if (!g || !k) return false;
      const l: OrderLine = { k, done: true, ok: true, dn: 3 }; (g.meals ?? []).push(l); lineMade(g, 'kitchen', l); break;
    }
    case 'roast': { const g = roastWalkIn(); for (const l of g.roast ?? []) l.dn = 1; S.groups.push(g); break; }
    case 'takeaway': {
      // a bag whose items are made already: it waits on the bench alone
      const keys = [drinkKey(randDrink(r))], k = mealKey(r); if (k) keys.push(k);
      S.packNo = (S.packNo ?? 20) + 1 + Math.floor(r() * 3);
      const g = packOf({ no: S.packNo, keys, roast: [], deliver: false }, false);
      for (const x of linesOf(g)){ x.l.done = true; x.l.dn = 1; }
      g.dn = 1; S.groups.push(g); break;
    }
    default: return false;
  }
  offer(seat, unitSec(seat, sl));
  const D_ = dir(); D_.made[seat] = (D_.made[seat] ?? 0) + 1;
  bump(); return true;
}

/* ---------- what reached each seat from upstream (natural handoffs pay the credit down) ---------- */
function noteNatural(S: GameState): void {
  const sl = S.slot;
  for (const g of S.groups){
    for (const x of linesOf(g)){
      const l = x.l;
      if (!((l.dn ?? 0) & 1)){ l.dn = (l.dn ?? 0) | 1; offer(x.dest, x.dest === 'bar' ? taskSec('drink') : x.dest === 'kitchen' ? taskSec('meal', 0, sl) : taskSec('chop')); }
      if (l.passT !== undefined && !((l.dn ?? 0) & 2)){ l.dn = (l.dn ?? 0) | 2; if (!S.floor) offer('runner', dishSec()); }
    }
    if (g.take && g.via === 'pack' && !g.dn && linesOf(g).every(x => x.l.done)){ g.dn = 1; offer(S.floor ? 'floor' : 'takeaway', taskSec('bag', linesOf(g).length, sl)); }
  }
  for (const c of S.payQ) if (!c.dn){ c.dn = 1; offer('till', taskSec('pay', c.payLines?.length ?? c.items.length, sl)); }
}

/* ---------- helpers: a line a player's seat left too long is done by the computer ---------- */
/** When a group's lines were ordered: its order (seated), else when it came (a takeaway order or walk-in: until - max). */
const bornAt = (g: Group, t: number): number => g.orderAt ?? (g.take ? g.until - g.max : t);
function helped(seat: string): void { const D_ = dir(); D_.help[seat] = (D_.help[seat] ?? 0) + 1; }
function help(S: GameState): void {
  const t = S.t, D_ = dir();
  // 樓面: its players' bubbles are left longer, and never one a player holds (their result would then be refused)
  const held = new Set((S.floor?.tasks ?? []).filter(x => x.by !== null).map(x => x.id));
  const wait = S.floor ? HELP_S.floor ?? 25 : HELP_S.waiter ?? 12, carryWait = S.floor ? HELP_S.floorCarry ?? 30 : HELP_S.runner ?? 25;
  if (isPlayer('waiter', S) && (!S.floor || floorHelp(S))){
    for (const g of S.groups){
      if (g.take) continue;
      if (g.state === 'queue' && t - (g.until - g.max) >= wait && !held.has('seat:' + String(g.id))){
        const tb = bestTable(g); if (tb && !seatProblem(g, tb)){ CORE_HOOK.seat(g, tb); helped('waiter'); }
      } else if (g.state === 'order' && !g.taken && t - (g.until - g.max) >= wait && !held.has('order:' + String(g.id))){ CORE_HOOK.submitOrder(g, [...g.items]); helped('waiter'); }
    }
    for (const tb of S.tables){
      const k = String(tb.id);
      if (!tb.dirty){ D_.dirty[k] = -1; continue; }   // -1: clean (the time it was first seen dirty otherwise)
      if ((D_.dirty[k] ?? -1) < 0) D_.dirty[k] = t;
      if (t - (D_.dirty[k] ?? t) >= wait && !held.has('clear:' + String(tb.id))){ CORE_HOOK.cleanTable(tableAt(tb.id)); D_.dirty[k] = -1; helped('waiter'); }
    }
  }
  const prep = (dest: 'bar' | 'kitchen', after: number): void => {
    for (const g of S.groups){
      if (g.state !== 'wait' || t - bornAt(g, t) < after) continue;
      const ls = dest === 'bar' ? g.drinks : g.meals;
      for (const l of ls ?? []){
        if (l.done) continue;
        if (dest === 'kitchen' && !g.take && passFull()) return;
        l.done = true; l.ok = true; lineMade(g, dest, l); helped(dest); bump();
      }
    }
  };
  if (isPlayer('bar', S)) prep('bar', HELP_S.bar ?? 15);
  // the kitchen: a player's late lines; the director's own takeaway meals at a computer kitchen too (it cooks only seated
  // tables' and the bags')
  if (isPlayer('kitchen', S)) prep('kitchen', HELP_S.kitchen ?? 20);
  else for (const g of S.groups) if (g.take && !g.via && t - (g.orderAt ?? t) >= CFG.cook) for (const m of g.meals){ if (!m.done){ m.done = true; m.ok = true; bump(); } }
  if (isPlayer('runner', S) || (S.floor && isPlayer('floor', S) && floorHelp(S))) for (const g of S.groups) for (const x of linesOf(g)){
    if (x.l.passT !== undefined && t - x.l.passT >= carryWait && !(g.table !== null && held.has('carry:' + String(g.table + 1)))){ delete x.l.passT; delete x.l.stale; helped('runner'); bump(); }
  }
  if (isPlayer('roast', S)) for (const g of S.groups){
    if (g.take) continue;
    for (const l of g.roast ?? []) if (!l.done && t - (g.orderAt ?? t) >= (HELP_S.roast ?? 40)){ l.done = true; l.ok = true; lineMade(g, 'roast', l); helped('roast'); bump(); }
  }
}

/** The director's step (referee/index.ts update, every step of a party round). */
export function dirStep(dt: number, r: Rng = rng): void {
  if (!dirOn()) return;
  const S = liveG(), D_ = dir(), shop = SHOP_LADDER.find(x => x === S.party?.shop);
  if (!shop) return;
  noteNatural(S);
  help(S);
  const posts = [...new Set(partySeats(shop).map(positionOf))];
  for (const seat of posts){
    const player = isPlayer(seat, S), w = backlog(seat, S);
    // adaptation: only a player's position (樓面's drowning line grows with its players)
    if (player){
      const a = D_.a[seat] ?? 1, hi = (HIGH[seat] ?? 6) * (seat === 'floor' ? Math.max(1, playersOn('floor1', S)) : 1);
      D_.a[seat] = Math.max(ADAPT_MIN, Math.min(ADAPT_MAX, a + (w > hi ? -ADAPT_RATE : w === 0 ? ADAPT_RATE : 0) * dt));
    }
    D_.q[seat] = w === 0 ? (D_.q[seat] ?? 0) + dt : 0;
    if (seat === 'waiter' || seat === 'floor') continue;   // the door is the waiter's / 樓面's stream (dirGap); quiet top-up below
    // the credit: what this seat is owed at its pace, less what reached it
    const u = unitSec(seat, S.slot), p = player ? pace(seat, S) : 0;
    D_.cr[seat] = Math.max(-CREDIT_LOW * u, Math.min(u, (D_.cr[seat] ?? 0) + p * dt));
    if (player && (D_.cr[seat] ?? 0) >= u - 1e-9 && make(seat, r)) D_.q[seat] = 0;
  }
  // a player's seat quiet for TOPUP_S gets a job at once (the waiter or 樓面: a group at the door)
  for (const seat of posts){
    if (!isPlayer(seat, S) || (D_.q[seat] ?? 0) < TOPUP_S) continue;
    if (seat === 'waiter' && S.groups.filter(g => g.state === 'queue').length >= CFG.queueMax) continue;
    // 樓面 quiet with a party already at the door: the tables are full, another party would only queue
    if (seat === 'floor' && S.groups.some(g => g.state === 'queue')) continue;
    if (make(seat, r)) D_.q[seat] = 0;
  }
}
/** For the guards and the end card: the director's tallies of this round. */
export const dirStats = (): DirShared | null => liveG().dir ?? null;
/** A bill's money as the till takes it (for the walk-in bills' price, tests). */
export const billWorth = (keys: string[]): number => priceSlip(keys).total;
