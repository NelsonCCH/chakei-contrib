// Workload from customers in the referee. In a shop with extra seats (G.extra,
// not a training lesson) the customers come in two streams and every customer books the seconds of work it puts on
// each seat (core/work/load.ts) into G.work, the shared state that travels in keyframes and the room's saves:
// - dine-in (customers.ts makeGroup / enqueue): seat, order, the lines at the bar, kitchen and 燒味, 傳菜 with a pass,
//   clearing, the bill. With a roast seat the mixer (core/work/mix.ts) sends a diner's food to the kitchen or to 燒味,
//   whichever is further behind; a 燒味 dish is ordered at the counter, not on the waiter's slip, so it comes in
//   when the order goes in (extras.ts orderPlaced).
// - takeaway: an order pays at the till first (a bill in the pay queue, `takeNo`), then its lines are made (the mixer
//   picks each item), it is bagged at the takeaway seat and collected or delivered (`deliver`); and 斬料 walk-ins, one
//   roast dish paid at the roast counter. How many of each come is the level's spec (core/work/spec.ts).
// Every draw is from the shift's stream, in a fixed order, so the room's Durable Object and a solo phone make the same
// customers for the same seed. Without G.extra nothing here runs and nothing is drawn (solo's four, the default room).
import { liveG, bump, D, curLevel } from '../state';
import { rng, rnd, pickSure, type Rng } from '../rng';
import { CFG, COLORS } from '../data/menus';
import { itemsOf, isMeal, drinkKey, priceSlip } from '../rules/price';
import { randPerson, randDrink, sayPerson } from '../rules/order';
import { gapMul, patMul } from '../playtest/pace';
import { packPeople } from '../playtest/knobs-takeaway';
import { dineTasks, takeTasks, chopTasks, LOAD, type Task, type Lines, type PrepSeat } from '../work/load';
import { pickPrep, bookPrep, wantFood, type PrepAcc, type PrepShare } from '../work/mix';
import { levelTier, DELIVER_TIER } from '../work/roles';
import { workSpecFor, WORK_DEFAULT, type WorkSpec } from '../work/spec';
// extras.ts imports this file too; neither uses the other at load time (the bundle resolves it lazily)
import { roastDish, packOf, roastWalkIn, packOpen, chopOpen } from './extras';

const xOn = (k: ExtraKind): boolean => !!liveG().extra?.includes(k);
/** A person (not the computer) carries this shift's dishes: the 傳菜 seat, or on a 樓面 level a floor
 *  seat; solo 'me', a room's player 'remote' on the referee. */
export const runnerHeld = (S: GameState = liveG()): boolean => {
  if (!S.extra?.includes('runner')) return false;
  const held = (k: string): boolean => { const v: unknown = Reflect.get(S.roles, k); return v === 'me' || v === 'remote'; };
  return held('runner') || Object.keys(S.roles).some(k => /^floor\d+$/.test(k) && held(k));
};
/** The workload model runs in this shift (a shop with extra seats, not a lesson). */
export const workOn = (): boolean => { const S = liveG(); return !!S.extra && !S.tut; };
/** This shift's spec: its level's, else the default. */
export const workSpec = (): WorkSpec => workSpecFor(liveG().level);
/** The spec for one seat's stream: the level's where the level has the seat's role, else the default (a seat
 *  opened on a level without the role, by a room's toggle or a solo seat, gets work; the level's spec was solved for
 *  its own roles, so it sends that seat nothing). Off a level both are the default. */
const seatSpec = (k: ExtraKind): WorkSpec => {
  const L = curLevel(), sp = !L || levelTier(L, k) !== null ? workSpec() : WORK_DEFAULT;
  return k === 'takeaway' && liveG().xseat === 'takeaway' && sp.take < SOLO_TAKE ? { ...sp, take: SOLO_TAKE } : sp;
};
/** Takeaway orders a shift at least, when the player is alone at the 外賣 bench (a solo seat shift). The levels'
 *  rates were solved for a shop where bagging is one of the floor's tasks (機場 sends 2), which left a solo bench idle for
 *  most of the shift; a mid player bags in about 20 s, so this many keep the bench busy without a pile-up. */
export const SOLO_TAKE = 10;
/** The dine-in arrival gap's factor from the spec (1 outside the model or when the spec sets none). */
export const workGapK = (): number => workOn() ? workSpec().gapK ?? 1 : 1;

export function freshWork(): WorkShared {
  return { acc: { bar: 0, kitchen: 0, roast: 0 }, load: {}, tasks: {}, nextTake: null, nextChop: null, bills: {}, takes: 0, chops: 0 };
}
/** G.work, made on first use. */
export function work(): WorkShared { const S = liveG(); return S.work ??= freshWork(); }
/** Equal shares over the prep seats this shift has (the shop's bar and kitchen, 燒味 when on). */
function share(): PrepShare { return roastOn() ? { bar: 1, kitchen: 1, roast: 1 } : { bar: 1, kitchen: 1 }; }
const PREP: readonly PrepSeat[] = ['bar', 'kitchen', 'roast'];
/** The 燒味 seat is on. A level with the role sells its `r:` dishes; a seat opened where the level has none (a room's toggle,
 *  a solo 燒味 seat, until the seat pickers follow `roles`) sells the station's own menu (extras.ts roastDish). */
const roastOn = (): boolean => xOn('roast');

/** Books tasks into G.work: seconds per seat and per task kind (count, seconds). */
export function book(tasks: readonly Task[]): void {
  const W = work();
  for (const [k, n, s] of tasks){
    const seat = LOAD[k].seat;
    W.load[seat] = (W.load[seat] ?? 0) + s;
    const c = W.tasks[k] ?? [0, 0]; c[0] += n; c[1] += s; W.tasks[k] = c;
  }
}

/* ---------- dine-in ---------- */
/**
 * A dine-in group was made (makeGroup): decide where each diner's food is made. The decisions run on a copy of the
 * mixer's memory; the group's lines are booked only if it gets in the door (workEnqueued), since some groups are drawn and
 * thrown away (a celebrity's or a fan's size).
 */
export function workDine(g: SeatGroup, r: Rng = rng): void {
  if (!workOn()) return;
  const S = liveG(), sl = S.slot, acc: PrepAcc = { ...work().acc }, sh = share();
  const plan: string[] = [];
  let kitchen = 0, changed = false;
  for (const p of g.persons){
    bookPrep(acc, 'bar', sl);
    const has = !!(p.food || p.set || p.dish);
    // a regular orders what they always order
    if (g.regular){ if (has){ kitchen++; bookPrep(acc, 'kitchen', sl); } continue; }
    // the food seat furthest behind; then whether this diner eats at all, so the bar and the food seats stay level
    const f: PrepSeat = roastOn() ? pickPrep(acc, sh, ['kitchen', 'roast'], sl, r) ?? 'kitchen' : 'kitchen';
    if (!wantFood(acc, sh, f, sl, has)){
      if (has){ p.food = null; p.set = null; p.dish = null; changed = true; }
      continue;
    }
    if (!has){ if (!addFood(p, r)) continue; changed = true; }
    if (f === 'kitchen'){ kitchen++; bookPrep(acc, 'kitchen', sl); continue; }
    p.food = null; p.set = null; p.dish = null; changed = true;
    plan.push(roastDish(r)); bookPrep(acc, 'roast', sl);
  }
  // with a person at 傳菜 every table is a trip (drinks skip the pass): a table that came out drinks only
  // gets one dish, or the runner waits half a minute while drink-only tables come and go
  const p0 = g.persons[0];
  if (runnerHeld(S) && !g.regular && !kitchen && !plan.length && p0 && addFood(p0, r)){ kitchen++; bookPrep(acc, 'kitchen', sl); changed = true; }
  if (changed){
    // the order as the diners now say it; the ones who take 燒味 order only their drink from the waiter (the dish is
    // ordered at the roast counter)
    g.items = itemsOf(g.persons);
    g.lines = g.persons.map((p, i) => (i === 0 ? '唔該，' : pickSure(['我要', '我', '佢要'], r)) + sayPerson(p, r) + '。');
  }
  if (plan.length) g.roastPlan = plan;
  g.wl = { bar: g.persons.length, kitchen, roast: plan.length };
}
/** Gives a diner who wanted only a drink a dish from the shift's menu and slot (a breakfast set, a lunch plate, a dinner
 *  dish); false when none came up. */
function addFood(p: Person, r: Rng): boolean {
  for (let i = 0; i < 8; i++){
    const q = randPerson(r);
    if (q.food){ p.food = q.food; return true; }
    if (q.set){ p.set = q.set; return true; }
    if (q.dish){ p.dish = q.dish; return true; }
  }
  return false;
}
/** A dine-in group got in the door (customers.ts enqueue): its work is booked. */
export function workEnqueued(g: SeatGroup): void {
  if (!workOn()) return;
  const S = liveG(), l: Lines = g.wl ?? { bar: g.persons.length, kitchen: g.persons.filter(p => p.food || p.set || p.dish).length, roast: 0 };
  const W = work();
  bookPrep(W.acc, 'bar', S.slot, l.bar); bookPrep(W.acc, 'kitchen', S.slot, l.kitchen); bookPrep(W.acc, 'roast', S.slot, l.roast);
  book(dineTasks(g.size, l, S.slot, { carry: xOn('runner') }));
}

/* ---------- takeaway ---------- */
/** A meal key from the shift's menu and slot (a person who orders food). */
export function mealKey(r: Rng): string | null {
  for (let i = 0; i < 8; i++){ const k = itemsOf([randPerson(r)]).find(isMeal); if (k) return k; }
  return null;
}
export const PACK_MAX = 4, ROAST_MAX = 3;
/** Takeaway orders can be delivered (送外賣): off a level always; on a level from its 外賣 tier DELIVER_TIER (*  level 4 bags only, level 5 delivers). */
const deliversOn = (): boolean => { const L = curLevel(); return !L || (levelTier(L, 'takeaway') ?? 0) >= DELIVER_TIER; };
/** A dine-in party's size from the spec's `sizes` (a shop with extra seats whose spec sets them), else null (the level's
 *  or the slot's sizes, rules/order.ts randSize). Draws one number, as randSize does. */
export function workSize(r: Rng): number | null {
  const z = workOn() ? workSpec().sizes : undefined;
  if (!z) return null;
  const x = r();
  return x < z[0] ? 1 : x < z[1] ? 2 : x < z[2] ? 3 : 4;
}

/** One takeaway order arrives: its items from the mixer; it pays at the till first (unless it is all 燒味, paid there). */
function takeArrive(spec: WorkSpec, r: Rng): void {
  const S = liveG(), W = work(), sl = S.slot, sh = share(), keys: string[] = [], roast: string[] = [], l: Lines = { bar: 0, kitchen: 0, roast: 0 };
  const n = Math.max(1, Math.round(spec.items)) * packPeople();
  for (let i = 0; i < n; i++){
    let d = pickPrep(W.acc, sh, PREP, sl, r) ?? 'bar';
    if (d === 'roast') roast.push(roastDish(r));
    else if (d === 'kitchen'){ const k = mealKey(r); if (k) keys.push(k); else d = 'bar'; }
    if (d === 'bar') keys.push(drinkKey(randDrink(r)));
    bookPrep(W.acc, d, sl); l[d]++;
  }
  const deliver = r() < spec.deliver && deliversOn();
  S.packNo = (S.packNo ?? 20) + 1 + Math.floor(r() * 3);
  const b: WorkBill = { no: S.packNo, keys, roast, deliver };
  book(takeTasks(l, sl, deliver)); W.takes++;
  // the order goes to the bar, kitchen and 燒味 at once and its bill to the till: no seat waits on another
  const order = packOf(b, keys.length > 0);
  S.groups.push(order);
  if (keys.length){ const bill = takeBill(b, r); W.bills[String(bill.id)] = order.id; S.payQ.push(bill); }
  bump();
}
/** The takeaway order's bill at the till: shaped like a seated group's (judge.ts toPay), named by its number. */
export function takeBill(b: WorkBill, r: Rng): SeatGroup {
  const S = liveG(), id = S.nextId++, color = COLORS[S.colorIx++ % COLORS.length] ?? '#c96';
  const max = CFG.cashPat * D().pat * patMul('till'), octo = r() < .3;
  return { id, color, label: '外賣客', size: 1, state: 'pay', table: null, draft: null, persons: [], lines: [], items: [...b.keys], max, until: S.t + max,
    slip: [...b.keys], payLines: b.keys.map(k => ({ k, struck: false, extra: false })), paySay: [pickSure(['外賣，埋單。', '外賣，幾多錢呀？', '拎外賣，唔該。'], r)],
    octo, octoShort: octo && r() < .2, tableName: `外賣${String(b.no)}號`, takeNo: b.no, expect: priceSlip(b.keys).total };
}

/** A bill left the pay queue unpaid (走數, referee/index.ts): its takeaway order is called off. */
export function workUnpaid(cid: number): void {
  const S = liveG(), W = S.work, gid = W?.bills[String(cid)];
  if (!W || gid === undefined) return;
  W.bills = Object.fromEntries(Object.entries(W.bills).filter(([k]) => k !== String(cid)));
  S.groups = S.groups.filter(g => g.id !== gid); bump();
}

/** The streams' step (extras.ts extrasStep, instead of fixed takeaway and 斬料 rates). */
export function workStep(): void {
  const S = liveG(), W = work(), t = S.t, sec = CFG.gameSec;
  const take = seatSpec('takeaway'), chop = seatSpec('roast');
  if (xOn('takeaway') && take.take > 0){
    W.nextTake ??= t + 10;
    if (t >= W.nextTake){
      if (packOpen() < PACK_MAX) takeArrive(take, rng);
      W.nextTake = t + (sec - 10) / take.take * rnd(.7, 1.3) * gapMul('takeaway');
    }
  }
  if (roastOn() && chop.chop > 0){
    W.nextChop ??= t + 8;
    if (t >= W.nextChop){
      if (chopOpen() < ROAST_MAX){
        S.groups.push(roastWalkIn()); bump();
        bookPrep(W.acc, 'roast', S.slot); book(chopTasks(S.slot)); W.chops++;
      }
      W.nextChop = t + (sec - 8) / chop.chop * rnd(.7, 1.3) * gapMul('roast');
    }
  }
}
