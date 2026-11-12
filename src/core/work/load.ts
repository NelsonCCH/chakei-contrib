// The workload model's load table: how many seconds of
// a person's work each task puts on its seat, for the sims' human model's mid profile (tests/sim/human.js). Measured by
// scripts/workload-calibrate.mjs (the script prints the measured values next to these and fails --check when one is more
// than 20% off), except the tasks that have no station yet, which are design values built from the same model's
// constants (src: 'design').
//
// Seats are the shop after 樓面: the floor role takes in the waiter's work, 傳菜 and the takeaway
// bench, and 2-3 players share it. `today` says which seat does the task before that merge. Every floor task is listed
// on its own (`claim`): each is a task a player claims by tapping it.

/** The seats the load is balanced over. */
export type WorkSeat = 'floor' | 'bar' | 'kitchen' | 'roast' | 'till';
export const WORK_SEATS: readonly WorkSeat[] = ['floor', 'bar', 'kitchen', 'roast', 'till'];
/** The prep seats an order line can go to. */
export type PrepSeat = 'bar' | 'kitchen' | 'roast';
export const PREP_SEATS: readonly PrepSeat[] = ['bar', 'kitchen', 'roast'];
export type TaskKind = 'seat' | 'order' | 'carry' | 'clear' | 'bag' | 'deliver' | 'drink' | 'meal' | 'chop' | 'pay';
export const TASK_KINDS: readonly TaskKind[] = ['seat', 'order', 'carry', 'clear', 'bag', 'deliver', 'drink', 'meal', 'chop', 'pay'];

type BySlot = Readonly<Record<Slot, number>>;
export interface TaskDef {
  seat: WorkSeat;
  /** The seat that does it before 樓面. */
  today: StationId | ExtraKind;
  /** Seconds for one task (by slot where the menus differ). */
  base: number | BySlot;
  /** Seconds for each `unit` on top of the base. */
  per: number | BySlot;
  unit: string;
  /** A floor task a 樓面 player will claim by tapping it. */
  claim: boolean;
  /** The player is out of the shop while doing it (送外賣): cover must not make it free. */
  away: boolean;
  src: 'measured' | 'design';
}

/** Mid profile, seconds (`node scripts/workload-calibrate.mjs --seeds 6`, 258 shifts). */
export const LOAD: Readonly<Record<TaskKind, TaskDef>> = {
  // seat a party: pick the group at the door, pick a table
  seat: { seat: 'floor', today: 'waiter', base: 2.6, per: 0, unit: 'party', claim: true, away: false, src: 'measured' },
  // take an order: open the table's slip, read each diner's order, write it, send (fitted base + per diner)
  order: { seat: 'floor', today: 'waiter', base: { breakfast: 1.0, lunch: 1.5, dinner: 1.8 }, per: { breakfast: 4.7, lunch: 3.1, dinner: 3.4 }, unit: 'diner', claim: true, away: false, src: 'measured' },
  // 傳菜: one trip from the pass (a trip carries 1.08 tables, 1.5 dishes on average; drinks skip the pass), on the
  // floors the levels' 傳菜 tiers play (first / rookie on 機場, 打風; the old ace floors took 13.5 s)
  carry: { seat: 'floor', today: 'runner', base: 9.6, per: 0, unit: 'trip', claim: true, away: false, src: 'measured' },
  // 執枱 (count and tap, each tap removes one piece): react + a tap per piece (move + a 3-way pick).
  // Today it is one tap (1.0 s measured).
  clear: { seat: 'floor', today: 'waiter', base: 0.8, per: 0.6, unit: 'piece', claim: true, away: false, src: 'design' },
  // bag a takeaway order: read the slip, drag each item in, the trays, tie the knot (par about 5 s on every tier, a mid
  // hand 1.2 x par), the finish, hand it over. Measured with the 外賣 hand (tests/sim/human.js
  // makeHumanTake): 18.2 s for 2 items; the per-item part from scripts/takeaway-pace.mjs (1-item vs 2-item levels).
  bag: { seat: 'floor', today: 'takeaway', base: 11.6, per: 3.3, unit: 'item', claim: true, away: false, src: 'measured' },
  // 送外賣 (3-lane bike runner): a run out and back, plus each further order in the same run (3 orders well under
  // 3 runs). Booked per order at DELIVER_BATCH orders a run.
  deliver: { seat: 'floor', today: 'takeaway', base: 30, per: 10, unit: 'extra order in the run', claim: true, away: true, src: 'design' },
  // a drink, the tea pot's boiling and pulling included
  drink: { seat: 'bar', today: 'bar', base: 5.8, per: 0, unit: 'drink', claim: false, away: false, src: 'measured' },
  // a meal (the sim's kitchen bot paced by the human model: the cook is the least certain number)
  meal: { seat: 'kitchen', today: 'kitchen', base: { breakfast: 8.2, lunch: 4.5, dinner: 8.9 }, per: 0, unit: 'meal', claim: false, away: false, src: 'measured' },
  // a roast dish: pick the customer, the 斬料 rhythm, the base, sauce and hand-over
  chop: { seat: 'roast', today: 'roast', base: 23.0, per: 0, unit: 'dish', claim: false, away: false, src: 'measured' },
  // a bill: add it up, key the total, work out the change (fitted base + per line)
  pay: { seat: 'till', today: 'till', base: 5.3, per: 0.9, unit: 'line', claim: false, away: false, src: 'measured' },
};
/** Tables one 傳菜 trip carries on average (measured with the trip time). */
export const CARRY_TABLES = 1.08;
/** Takeaway orders one 送外賣 run takes, for booking a run's time per order (each order's countdown stops hoarding). */
export const DELIVER_BATCH = 2;

const slotted = (v: number | BySlot, slot: Slot): number => typeof v === 'number' ? v : v[slot];
/** Seconds for one task of `kind` with `n` units on top of the base. */
export const taskSec = (kind: TaskKind, n = 0, slot: Slot = 'lunch'): number => slotted(LOAD[kind].base, slot) + n * slotted(LOAD[kind].per, slot);
/** Seconds one line puts on its prep seat. */
export const lineSec = (d: PrepSeat, slot: Slot): number => d === 'bar' ? taskSec('drink') : d === 'kitchen' ? taskSec('meal', 0, slot) : taskSec('chop');
/** Seconds one delivered order books on the floor (its share of a run of DELIVER_BATCH). */
export const deliverSec = (): number => taskSec('deliver', DELIVER_BATCH - 1) / DELIVER_BATCH;

/* ---------- a bundled role's budget ---------- */
/** The floor's tasks (樓面 bundles them). */
export const FLOOR_TASKS: readonly TaskKind[] = TASK_KINDS.filter(k => LOAD[k].seat === 'floor');
/** The floor tasks one 伙記 did alone before 樓面 (seating, orders, clearing): one player's load at the level's pace. */
export const WAITER_TASKS: readonly TaskKind[] = FLOOR_TASKS.filter(k => LOAD[k].today === 'waiter');
/** Work booked by task kind, [count, seconds] (G.work.tasks, core/referee/work.ts book). */
export type Booked = Readonly<Partial<Record<string, readonly [number, number]>>>;
const secOf = (b: Booked, ks: readonly TaskKind[]): number => ks.reduce((a, k) => a + (b[k]?.[1] ?? 0), 0);
/**
 * floorBudget: seconds of floor work this many players should get. A bundled role is budgeted as ONE player's total
 * load, the load one 伙記 had before the merge (WAITER_TASKS, booked from the level's own customers, so the level's pace
 * curve and the pace sliders sit on top), times the players on the role: 2 players about twice one.
 */
export function floorBudget(players: number, booked: Booked): number { return Math.max(0, players) * secOf(booked, WAITER_TASKS); }
/**
 * floorShare: the share of the floor's tasks that go to its players (0..1); the rest is the computer's at once
 * (core/work/floor.ts). The budget is shared across all the floor's tasks (seat, order, 傳菜, 執枱, bagging, 送外賣), so
 * a player sees every kind of task, just fewer of each. 1 when there is nothing booked yet or the budget covers it all.
 */
export function floorShare(players: number, booked: Booked): number {
  const all = secOf(booked, FLOOR_TASKS);
  return all <= 0 ? 1 : Math.min(1, floorBudget(players, booked) / all);
}

/** Tasks booked: their kind, how many (a share of a carry trip or a delivery run counts as that fraction), the seconds. */
export type Task = readonly [TaskKind, number, number];
const task = (k: TaskKind, n: number, slot: Slot, times = 1): Task => [k, times, times * taskSec(k, n, slot)];
/** Prep lines of a customer by seat. */
export interface Lines { bar: number; kitchen: number; roast: number }

/** What one dine-in party puts on the shop: seat, order, the lines, 傳菜 (with a pass), clearing, the bill. */
export function dineTasks(size: number, l: Lines, slot: Slot, o: { carry: boolean }): Task[] {
  const lines = l.bar + l.kitchen + l.roast, food = l.kitchen + l.roast;
  const out: Task[] = [task('seat', 0, slot), task('order', size, slot)];
  if (l.bar) out.push(task('drink', 0, slot, l.bar));
  if (l.kitchen) out.push(task('meal', 0, slot, l.kitchen));
  if (l.roast) out.push(task('chop', 0, slot, l.roast));
  if (o.carry && food) out.push(['carry', 1 / CARRY_TABLES, taskSec('carry') / CARRY_TABLES]);
  out.push(task('clear', lines, slot), task('pay', l.bar + l.kitchen, slot));
  return out;
}
/** What one takeaway order puts on the shop: the bill at the till first, the lines, bagging, and its share of a delivery run. */
export function takeTasks(l: Lines, slot: Slot, deliver: boolean): Task[] {
  const items = l.bar + l.kitchen + l.roast;
  const out: Task[] = [task('pay', l.bar + l.kitchen, slot)];
  if (l.bar) out.push(task('drink', 0, slot, l.bar));
  if (l.kitchen) out.push(task('meal', 0, slot, l.kitchen));
  if (l.roast) out.push(task('chop', 0, slot, l.roast));
  out.push(task('bag', items, slot));
  if (deliver) out.push(['deliver', 1 / DELIVER_BATCH, deliverSec()]);
  return out;
}
/** A 斬料 walk-in: one dish at the roast counter (it pays there). */
export const chopTasks = (slot: Slot): Task[] => [task('chop', 0, slot)];

export type SeatLoad = Record<WorkSeat, number>;
export const zeroLoad = (): SeatLoad => ({ floor: 0, bar: 0, kitchen: 0, roast: 0, till: 0 });
/** Sums tasks into seconds per seat. */
export function loadOf(tasks: readonly Task[], into: SeatLoad = zeroLoad()): SeatLoad {
  for (const [k, , s] of tasks) into[LOAD[k].seat] += s;
  return into;
}
