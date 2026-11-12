// The extra stations' shared rules:
// what the referee does when a co-op room opens 傳菜 runner, 燒味 roast or 外賣 takeaway seats (the 洗碗 wash seat is gone). Everything
// here is gated by G.extra (the room's shop setting): with it absent (solo, the default room) every function below is
// a no-op that draws no random number, so the default shop stays exactly as before.
//
// - The pass (runner on): a dish the kitchen or roast makes for a seated table waits on the pass (line.passT) until
//   the runner carries it; the table is served when every line is made and carried. The pass holds PASS_CAP dishes
//   (made and not yet at the table): when full, the kitchen cannot put more out (出餐口滿咗). Drinks go out over the
//   bar's own counter, as in a real 茶餐廳 (傳菜 carries food): in play, a table's drinks and food reaching the
//   pass at different times cost the runner two or three trips a table, more than any hand could keep up with.
// - Roast (roast on): a seated table sometimes adds a roast dish (g.roast), and 斬料 walk-ins buy at the roast counter.
// - Takeaway (takeaway on): takeaway orders (TakeGroup, via 'pack') whose drinks, meals and roast come from the bar,
//   kitchen and roast; the takeaway seat packs them and hands them over (the `packed` result books the money).
import { liveG, me, bump, D, curLevel } from '../state';
import { PORT } from '../env';
import { rng, rnd, type Rng } from '../rng';
import { CFG, COLORS } from '../data/menus';
import { say } from '../fx';
import { isMeal, itemsOf, label, priceSlip } from '../rules/price';
import { randPerson } from '../rules/order';
import { gapMul, patMul } from '../playtest/pace';
import { packPeople } from '../playtest/knobs-takeaway';
import { seatMiss, seatAngry } from './seatscore';   // what the new seats' outcomes do to the score
import { tallyMiss } from '../coop/tally';   // a party round's mistakes per person
import { workOn, workStep } from './work';
import { bagOut } from '../work/floor';   // 樓面: a bag for delivery waits at the door for a rider
/** The roast station's menu (names and weights): set by its plugin (core/coop/plugins/roast.ts), so core needs no station code. */
let MENU: readonly { name: string; w: number }[] = [{ name: '叉燒飯', w: 1 }];
export function setRoastMenu(m: readonly { name: string; w: number }[]): void { MENU = m; }

export const EXTRA_KINDS: readonly ExtraKind[] = ['runner', 'roast', 'takeaway'];
export const isExtraKind = (k: unknown): k is ExtraKind => EXTRA_KINDS.some(x => x === k);
/** This shift has that extra station. */
export const xOn = (k: ExtraKind): boolean => !!liveG().extra?.includes(k);
/** A player (here or a teammate) drives that extra seat (for the shop's complaints, as me() does for the four). */
export const xMe = (k: ExtraKind): boolean => { const r = liveG().roles[k]; return r === 'me' || r === 'remote'; };

export const PASS_CAP = 6;
/** Seconds on the pass before a line goes stale (hot food 20, iced drinks 25, hot drinks 30). */
export const staleAfter = (k: string): number => isMeal(k) || !/^[熱凍]/.test(k) ? 20 : k[0] === '凍' ? 25 : 30;
const ROAST_GAP = 22, ROAST_MAX = 3, ROAST_PAT = 60, ROAST_P = 0.4;
const PACK_GAP = 20, PACK_MAX = 4, PACK_PAT = 150;

/** Every line of a group: drinks, meals and roast, with where each is made. */
export function linesOf(g: Group): { dest: 'bar' | 'kitchen' | 'roast'; i: number; l: OrderLine }[] {
  return [
    ...(g.drinks ?? []).map((l, i) => ({ dest: 'bar' as const, i, l })),
    ...(g.meals ?? []).map((l, i) => ({ dest: 'kitchen' as const, i, l })),
    ...(g.roast ?? []).map((l, i) => ({ dest: 'roast' as const, i, l })),
  ];
}
/** Made and at the table (always the same as `done` without a runner seat). */
export const delivered = (l: OrderLine): boolean => l.done && l.passT === undefined;

/* ---------- the pass ---------- */
/** Lines made and not yet carried to their table. */
export function passCount(): number {
  let n = 0;
  for (const g of liveG().groups) for (const x of linesOf(g)) if (x.l.passT !== undefined) n++;
  return n;
}
export const passFull = (): boolean => xOn('runner') && passCount() >= PASS_CAP;
/** A station would put a line on a full pass: refused (the page toasts it); counted once per tap. */
export function passRefused(role: 'bar' | 'kitchen'): boolean {
  if (!passFull()) return false;
  const p = liveG().pass; if (p) p.full++;   // (a teammate's count is only their replica's: the referee's own taps count)
  say(role, '出餐口滿咗，等傳菜拎走先'); return true;
}
/** A line was made (any station, player or computer): food onto the pass for a seated table. */
export function lineMade(g: Group, dest: 'bar' | 'kitchen' | 'roast', l: OrderLine): void {
  const S = liveG(); if (!S.extra) return;
  if (xOn('runner') && !g.take && dest !== 'bar') l.passT = S.t;   // drinks skip the pass
}
/** The runner put lines on table `table` (its number: index + 1). Returns how many were on the pass, and how many of
 *  those reached the table hot: not gone cold on the pass (staleAfter), the 傳菜 seat's own measure. */
export function carried(refs: { gid: number; dest: string; i: number }[], table: number): { n: number; hot: number } {
  const S = liveG(); let n = 0, hot = 0;
  for (const r of refs){
    const g = S.groups.find(x => x.id === r.gid); if (!g || g.take || g.table !== table - 1) continue;
    const x = linesOf(g).find(y => y.dest === r.dest && y.i === r.i), l = x?.l;
    if (!x || !l || l.passT === undefined) continue;
    if (!l.stale && S.t - l.passT <= staleAfter(x.dest === 'roast' ? 'f' : l.k)) hot++;
    delete l.passT; delete l.stale; n++;
  }
  if (n){ S.pass = S.pass ?? { stale: 0, carried: 0, full: 0 }; S.pass.carried += n; bump(); }
  return { n, hot };
}

/* ---------- customers of the extra stations ---------- */
/** A roast dish name from the roast station's menu, by its weights. */
export function roastDish(r: Rng = rng): string {
  // on a level, only the roast dishes on its menu (`r:` keys); a weight of 0 (a dish only some levels sell)
  // counts as 1 there. Elsewhere, or on a level with no `r:` key whose 燒味 seat was opened anyway (a room's toggle, a solo
  // seat), the station's whole menu, as before.
  const open = curLevel() ? MENU.filter(m => PORT.menuOpen(ROAST_KEY + m.name)) : MENU.filter(m => m.w > 0);
  const list = open.length ? open : MENU.filter(m => m.w > 0), w = (m: { w: number }): number => m.w || 1;
  const tot = list.reduce((a, m) => a + w(m), 0); let x = r() * tot;
  for (const m of list){ x -= w(m); if (x < 0) return m.name; }
  return list[0]?.name ?? '叉燒飯';
}
/** The menu key prefix of a roast dish (`r:叉燒飯`). */
export const ROAST_KEY = 'r:';
/** A seated table's order is in (submitOrder): with a roast seat, it sometimes adds a roast dish. */
export function orderPlaced(g: SeatGroup): void {
  if (!liveG().extra || !xOn('roast') || g.roast) return;
  // the workload model (work.ts) decided at the door which diners take 燒味; they order it now
  if (workOn()){ if (g.roastPlan?.length) g.roast = g.roastPlan.map(k => ({ k, done: false, ok: true })); return; }
  if (rng() < ROAST_P) g.roast = [{ k: roastDish(), done: false, ok: true }];
}
function newTake(via: 'roast' | 'pack', pat: number): TakeGroup {
  const S = liveG(), id = S.nextId++, color = COLORS[S.colorIx++ % COLORS.length] ?? '#c96';
  const until = S.t + pat;
  return { id, color, label: via === 'roast' ? '斬料客' : '外賣單', size: 1, take: true, via, state: 'wait', table: null, items: [], slip: [], result: { correct: true },
    drinks: [], meals: [], drinkMax: pat, drinkUntil: until, until, max: pat };
}
export function roastWalkIn(): TakeGroup {
  const g = newTake('roast', ROAST_PAT * D().pat * patMul('roast'));
  g.roast = [{ k: roastDish(), done: false, ok: true }];
  return g;
}
function packOrder(): TakeGroup {
  const S = liveG(), g = newTake('pack', PACK_PAT * D().pat * patMul('takeaway')), keys = itemsOf(Array.from({ length: packPeople() }, () => randPerson()));
  g.no = S.packNo = (S.packNo ?? 20) + 1 + Math.floor(rng() * 3);
  g.items = keys; g.slip = keys;
  g.drinks = keys.filter(k => !isMeal(k)).map(k => ({ k, done: false, ok: true }));
  g.meals = keys.filter(isMeal).map((k, i) => ({ k, done: false, ok: true, doneAt: S.t + CFG.cook + i * 1.5 }));
  g.mealUntil = g.until; g.mealMax = g.max;
  if (xOn('roast') && rng() < ROAST_P) g.roast = [{ k: roastDish(), done: false, ok: true }];
  return g;
}
/** A workload-model takeaway order (work.ts) once its bill is paid (or at once when it is all 燒味). */
export function packOf(b: WorkBill, prepaid: boolean): TakeGroup {
  const S = liveG(), g = newTake('pack', PACK_PAT * D().pat * patMul('takeaway'));
  g.no = b.no; g.items = [...b.keys]; g.slip = [...b.keys]; g.prepaid = prepaid; g.deliver = b.deliver;
  g.drinks = b.keys.filter(k => !isMeal(k)).map(k => ({ k, done: false, ok: true }));
  g.meals = b.keys.filter(isMeal).map((k, i) => ({ k, done: false, ok: true, doneAt: S.t + CFG.cook + i * 1.5 }));
  g.mealUntil = g.until; g.mealMax = g.max;
  if (b.roast.length) g.roast = b.roast.map(k => ({ k, done: false, ok: true }));
  return g;
}
/** Takeaway orders and 斬料 walk-ins open now (the workload model's caps, work.ts). */
export const packOpen = (): number => liveG().groups.filter(g => g.via === 'pack').length;
export const chopOpen = (): number => liveG().groups.filter(g => g.via === 'roast').length;

/* ---------- set customers for the training lessons ---------- */
/** A 斬料 walk-in for one set dish (training). */
export function addWalkIn(dish: string): TakeGroup {
  const g = newTake('roast', ROAST_PAT * D().pat); g.roast = [{ k: dish, done: false, ok: true }];
  liveG().groups.push(g); bump(); return g;
}
/** A takeaway order with set items (training); items are item keys as itemsOf() makes them. */
export function addPack(keys: string[]): TakeGroup {
  const S = liveG(), g = newTake('pack', PACK_PAT * D().pat);
  g.no = S.packNo = (S.packNo ?? 20) + 1;
  g.items = keys; g.slip = keys;
  g.drinks = keys.filter(k => !isMeal(k)).map(k => ({ k, done: false, ok: true }));
  g.meals = keys.filter(isMeal).map((k, i) => ({ k, done: false, ok: true, doneAt: S.t + CFG.cook + i * 1.5 }));
  g.mealUntil = g.until; g.mealMax = g.max;
  S.groups.push(g); bump(); return g;
}

/** The extra stations' step of the shop (referee/index.ts update, after the regulars and the door). */
export function extrasStep(): void {
  const S = liveG(); if (!S.extra) return;
  const t = S.t;
  if (xOn('runner') && !S.pass) S.pass = { stale: 0, carried: 0, full: 0 };
  if (workOn()) workStep();   // the takeaway and 斬料 streams from the level's spec (work.ts)
  else if (xOn('roast')){
    if (S.nextRoast == null) S.nextRoast = t + 8;
    if (t >= S.nextRoast){
      if (S.groups.filter(g => g.via === 'roast').length < ROAST_MAX){ S.groups.push(roastWalkIn()); bump(); }
      S.nextRoast = t + ROAST_GAP * rnd(.7, 1.3) * gapMul('roast');
    }
  }
  if (xOn('takeaway') && !workOn()){
    if (S.nextPack == null) S.nextPack = t + 10;
    if (t >= S.nextPack){
      if (S.groups.filter(g => g.via === 'pack').length < PACK_MAX){ S.groups.push(packOrder()); bump(); }
      S.nextPack = t + PACK_GAP * rnd(.7, 1.3) * gapMul('takeaway');
    }
  }
  if (S.pass) for (const g of S.groups) for (const x of linesOf(g)){
    const l = x.l;
    if (l.passT !== undefined && !l.stale && t - l.passT > staleAfter(x.dest === 'roast' ? 'f' : l.k)){ l.stale = true; S.pass.stale++; }
  }
}
/** A walk-in or a takeaway order (g.via) in update(): the computer kitchen cooks its meals; it leaves when it waits too long. */
export function viaStep(g: TakeGroup): void {
  const S = liveG(), t = S.t;
  if (!me('kitchen')) for (const m of g.meals) if (!m.done && t >= (m.doneAt ?? NaN)){ m.done = true; m.ok = rng() >= CFG.aiKitErr; lineMade(g, 'kitchen', m); bump(); }
  if (g.via === 'roast' && (g.roast ?? []).every(l => l.done)){ leaveVia(g); S.served++; S.paidCount++; return; }
  // a bag whose every line is made waits on the takeaway seat alone (its third star times it from here)
  const ready = g.via === 'pack' && linesOf(g).every(x => x.l.done);
  if (ready && g.readyAt === undefined) g.readyAt = t;
  if (t >= g.until){
    // the walk-out is the seat's when it was the seat that kept them: a 斬料 customer always, a takeaway order once
    // its bag was ready to pack (before that, the kitchen or bar kept it)
    if (g.via === 'roast' || ready) seatAngry(g.via === 'roast' ? 'roast' : 'takeaway');
    leaveVia(g);
  }
}
function leaveVia(g: Group): void { const S = liveG(); S.groups = S.groups.filter(x => x !== g); bump(); }

/* ---------- results of the extra seats (core/coop/results.ts) ---------- */
/** A roast dish made (`lineDone` dest 'roast'): the customer pays `pay` at once (the roast counter takes its money). */
export function roastMade(gid: number, i: number, pay: number): boolean {
  const S = liveG(), g = S.groups.find(x => x.id === gid), l = g?.roast?.[i];
  if (!g || !l || l.done) return false;
  l.done = true; l.ok = true; S.revenue += pay;
  lineMade(g, 'roast', l); bump();
  return true;
}
/** A roast customer walked out of the station's queue: the line is given up (no money); a walk-in leaves. */
export function roastGone(gid: number, i: number): boolean {
  const S = liveG(), g = S.groups.find(x => x.id === gid), l = g?.roast?.[i];
  if (!g || !l || l.done) return false;
  l.done = true; l.ok = false;
  // a walk-in walks out (冇人嬲走); a seated table's dish given up is the roast seat's mistake
  if (g.via === 'roast'){ seatAngry('roast'); leaveVia(g); } else seatMiss('roast');
  bump(); return true;
}
/** Index `i` of a takeaway bag's items (drinks, then meals, then roast), as the takeaway station numbers them. */
export function bagLine(g: Group, i: number): { dest: 'bar' | 'kitchen' | 'roast'; i: number; l: OrderLine } | undefined { return linesOf(g)[i]; }
/** A bag handed over (`packed`): the order is paid (drinks and meals at the shop's prices, plus the tip). */
export function packed(gid: number, tip: number): boolean {
  const S = liveG(), g = S.groups.find(x => x.id === gid);
  if (!g || g.via !== 'pack' || !linesOf(g).every(x => x.l.done)) return false;
  const keys = [...g.drinks, ...g.meals].map(l => l.k), bad = linesOf(g).filter(x => !x.l.ok);
  // a workload-model order was paid at the till already: the bag books its tip only
  if (g.prepaid){ S.revenue += tip; S.tips = (S.tips ?? 0) + tip; S.served++; }
  else { S.revenue += priceSlip(keys).total + tip; S.tips = (S.tips ?? 0) + tip; S.paidCount++; S.served++; }
  for (const b of bad){
    if (b.dest === 'bar' && me('bar')){ S.mistakes++; tallyMiss('bar'); say('bar', `外賣：呢杯${label(b.l.k)}唔啱喎！`); }
    if (b.dest === 'kitchen' && me('kitchen')){ S.mistakes++; tallyMiss('kitchen'); say('kitchen', `外賣：呢個${label(b.l.k)}唔啱喎！`); }
  }
  if (S.floor && g.deliver) bagOut(g);   // 樓面: it still has to be ridden out (送外賣)
  leaveVia(g);
  return true;
}
/** An item went into the wrong bag (`remake`): that line is made again. */
export function remake(gid: number, i: number): boolean {
  const S = liveG(), g = S.groups.find(x => x.id === gid), x = g ? bagLine(g, i) : undefined;
  if (!g || !x || !x.l.done) return false;
  x.l.done = false; x.l.ok = true; x.l.redo = true;
  if (g.take) delete g.readyAt;   // the bag is not ready until the line is made again
  if (x.dest === 'kitchen') x.l.doneAt = S.t + 4;
  bump(); return true;
}
/** For the seat screens: what the kitchen and bar see of the pass (null without a runner seat). */
export function extrasView(): { pass: number | null; cap: number } {
  return { pass: xOn('runner') ? passCount() : null, cap: PASS_CAP };
}
