// 外賣 takeaway in the referee (BUSY_SEATS 5): takeaway orders are shop groups (TakeGroup, via
// 'pack', core/referee/extras.ts) whose drinks, meals and roast the bar, kitchen and roast make. The station
// (src/stations-next/takeaway, fed mode) packs them: on every step of the phone that drives the seat each open order
// is given to it as a `bag` (once), each line made as an `item` (once: the station keeps what it has), and an order
// that is gone (it waited too long) is cancelled. A bag handed over sends `packed`; an item packed into the wrong bag
// sends `remake`, and the station that made it makes it again.
import { takeawayFed as takeaway, resetBot, itemById, newBag, type TakeState, type TakeResult } from '../../../stations-next/takeaway';
import { registerStation } from '../registry';
import { submit } from '../results';
import { liveG } from '../../state';
import { label, isMeal } from '../../rules/price';
import { linesOf } from '../../referee/extras';
import { levelTier, byTier, KNOT_TIER } from '../../work/roles';
import { PORT } from '../../env';
import { ctxOf, dk, store, registerSeatCommand, ptrCmd, finishStarted } from './kit';

const st = store<TakeState>(() => {
  const s = takeaway.init({ difficulty: dk(), seed: liveG().nextId * 7919, players: 1 }, 'takeaway');
  const L = liveG().level ? PORT.level(liveG().level ?? '') : undefined, tier = levelTier(L ?? liveG().party, 'takeaway');
  if (tier !== null) s.knot = byTier(KNOT_TIER, tier);   // a level with the 外賣 role: its tier's knots
  return s;
});
export const takeawayState = (): TakeState | null => st.peek();
const ctx = (byPlayer: boolean): ReturnType<typeof ctxOf> => ctxOf('takeaway', byPlayer);

/** How the station shows a line: the shop's own name, a box for a meal or a roast dish, a cup for a drink. */
function spec(dest: 'bar' | 'kitchen' | 'roast', k: string): { n: string; kind: 'box' | 'drink'; hot?: boolean; mod?: string; syrup?: boolean } {
  if (dest === 'roast') return { n: k, kind: 'box' };
  const n = (label(k).split(' ')[0] ?? k).slice(0, 24);
  if (isMeal(k)) return { n, kind: 'box', syrup: n.includes('西多士') };
  return { n, kind: 'drink', hot: k[0] === '熱', mod: /走甜|少甜|少冰/.exec(k)?.[0] ?? '' };
}
/** 樓面: the one bag a floor player's bag job packs (null: every order, the 外賣 seat). */
let only: number | null = null;
export function takeawayOnly(gid: number | null): void { only = gid; }
function sync(s: TakeState): void {
  const S = liveG(), open = new Set<number>();
  for (const g of S.groups){
    if (g.via !== 'pack' || (only !== null && g.id !== only)) continue;
    open.add(g.id);
    const lines = linesOf(g);
    if (!s.orders.some(o => o.gid === g.id))
      takeaway.onEvent(s, { kind: 'bag', gid: g.id, items: lines.map(x => spec(x.dest, x.l.k)), no: g.no ?? g.id, who: (g.deliver ?? g.id % 2 === 1) ? 'rider' : 'walk', patience: Math.max(20, g.until - S.t) }, ctx(false));
    lines.forEach((x, i) => { if (x.l.done) takeaway.onEvent(s, { kind: 'item', gid: g.id, i }, ctx(false)); });
  }
  for (const o of s.orders) if (!o.done && !open.has(o.gid)) takeaway.onEvent(s, { kind: 'cancel', gid: o.gid }, ctx(false));
}
function report(out: TakeResult[]): void {
  for (const r of out){
    if (r.kind === 'packed') submit('takeaway', { k: 'packed', gid: r.gid, stars: r.stars, tip: r.tip });
    else if (r.kind === 'remake') submit('takeaway', { k: 'remake', gid: r.gid, i: r.i });
  }
}
/** Work begun at the bench: items in the bag, a knot or hand-over under way, something in hand. */
const bagBegun = (s: TakeState): boolean => s.bag.items.length > 0 || s.tie !== null || s.phase !== 'pack' || s.drag !== null;
/**
 * A bag the computer could not finish: its slip still waits for an item the shop has not made, and no
 * shop time passes while it finishes. Its items go back on the counter (an item packed into the wrong bag was already
 * sent back to be made again) and the bench is empty, so the player is handed the slip untouched.
 */
function unpack(s: TakeState): void {
  for (const b of s.bag.items){
    if (b.wrong) continue;
    const it = itemById(s, b.it.id); if (!it) continue;
    it.packed = false;
    const free = s.counter.findIndex(c => c === null);
    if (free >= 0) s.counter[free] = { id: it.id, enter: 0, back: 0 }; else s.incoming.push({ id: it.id, at: s.t });
  }
  s.bag = newBag(); s.tie = null; s.drag = null; s.phase = 'pack'; s.f.down = false;
}
export function takeawayCommand(cmd: Parameters<typeof takeaway.command>[1]): void { const s = st.get(); sync(s); report(takeaway.command(s, cmd, ctx(true))); }

registerStation({
  kind: 'takeaway', v: 1,
  pick: () => st.get(),
  put: (_S, s) => { if (!takeaway.validate(s)) return false; st.set(structuredClone(s)); return true; },
  // a bag half packed, a knot being tied or an item in hand is begun work; a player taking the seat gets
  // an empty bench, the computer's bag finished and handed over first (fast time, kit.ts finishStarted; cues dropped)
  toPlayer: () => {
    const s = st.peek(); if (!s) return;
    const seq = s.fxSeq;
    finishStarted(() => bagBegun(s), dt => { sync(s); const c = takeaway.bot.next(s, ctx(false)); if (c) report(takeaway.command(s, c, ctx(false))); report(takeaway.step(s, dt, ctx(false))); });
    if (bagBegun(s)) unpack(s);
    s.fx = s.fx.filter(f => f.seq <= seq);
    resetBot(s);
  },
  started: () => { const s = st.peek(); return !!s && bagBegun(s); },
  restart: () => { st.reset(); },
  waiting: () => takeaway.status(st.get(), ctx(false)).waiting,
  step: (dt, driver) => {
    const s = st.get(); sync(s);
    if (driver === 'computer'){ const c = takeaway.bot.next(s, ctx(false)); if (c) report(takeaway.command(s, c, ctx(false))); }
    report(takeaway.step(s, dt, ctx(driver === 'me')));
  },
});
registerSeatCommand('takeaway', c => { const p = ptrCmd(c); if (p) takeawayCommand(p); return p !== null; });
export function takeawayBotPress(): void { const c = takeaway.bot.next(st.get(), ctx(true)); if (c) takeawayCommand(c); }
