// 燒味 roast in the referee: the whole registration of
// a stations-next module, one file. The station module (src/stations-next/roast, fed mode) runs unchanged on the phone
// that drives the seat (a player's, or the referee's for the computer, with the module's own bot); its state lives in
// this plugin's store (not in G). Its customers are the shop's: the roast dishes seated tables add to their order and
// the 斬料 walk-ins (core/referee/extras.ts), fed to it as `order` events from the shared shift on every step. Each
// roast it hands over becomes a `lineDone` result (the customer pays at the counter), each walk-out a `walkout`.
import { roastFed as roast, setBotAim, handOver, resetBot, newPlate, type RoastState, type RoastResult } from '../../../stations-next/roast';
import { registerStation } from '../registry';
import { submit } from '../results';
import { liveG } from '../../state';
import { PORT } from '../../env';
import { roastMade, setRoastMenu } from '../../referee/extras';
import { MENU } from '../../../stations-next/roast/core';
import { levelTier, byTier, ROAST_CUT } from '../../work/roles';
import { ctxOf, dk, store, registerSeatCommand, ptrCmd, finishStarted } from './kit';

setRoastMenu(MENU);
// the simulations' person at this seat: the spread of their aim at a guide (tests/sim/human.js AIM_SKILL); null = the computer's
let skill: number | null = null;
/**
 * The 斬料 cutting tier for this shift (core TUNE.cut: pieces, snap, guides). A level with the 燒味 role
 * plays its role tier's (core/work/roles.ts ROAST_CUT: 年廿八 brings it in at 0, 修羅場 3). Elsewhere (a solo 燒味 seat on a
 * level without the role) the old ramp: the lesson and 第 1 關 the easiest, 第 2-3 關 tier 1, 第 4-7 關 and festivals
 * tier 2 (dashes at the top only), 修羅場 tier 3 (no guides); the era / classic levels tier 1. null: the difficulty's own.
 */
export function roastTier(): number | null {
  const S = liveG();
  if (S.tut) return 0;
  const L = S.level ? PORT.level(S.level) : undefined;
  // a party round: the party shop's 燒味 tier (G.party.roles)
  if (!L){ const pt = levelTier(S.party, 'roast'); return pt === null ? null : byTier(ROAST_CUT, pt); }
  const tier = levelTier(L, 'roast');   // a level with the 燒味 role: its role tier's cutting tier
  if (tier !== null) return byTier(ROAST_CUT, tier);
  if (L.hell) return 3;
  if (L.fest) return 2;
  if (L.era) return 1;
  return L.n <= 1 ? 0 : L.n <= 3 ? 1 : 2;
}
const st = store<RoastState>(() => {
  const s = roast.init({ difficulty: dk(), seed: liveG().nextId * 7919, players: 1 }, 'roast'), t = roastTier();
  if (t !== null) roast.onEvent(s, { kind: 'tier', tier: t }, ctx(false));
  if (skill !== null) setBotAim(s, skill);
  return s;
});
/** The roast seat's state on this phone (null until the seat is first driven here). */
export const roastState = (): RoastState | null => st.peek();
export function roastReset(): void { st.reset(); }
/** The simulations: give the bot playing this seat a person's aim (logical px, one SD; null: the computer's). */
export function roastBotSkill(aim: number | null): void { skill = aim; const s = st.peek(); if (s) setBotAim(s, aim); }
const ctx = (byPlayer: boolean): ReturnType<typeof ctxOf> => ctxOf('roast', byPlayer);

/** Feeds the station from the shift: every roast line not made yet is queued once; a line that is gone is cancelled. */
function sync(s: RoastState): void {
  const S = liveG(), want = new Set<string>();
  for (const g of S.groups) (g.roast ?? []).forEach((l, i) => {
    if (l.done) return;
    want.add(`${String(g.id)}:${String(i)}`);
    if (s.q.some(c => c.gid === g.id && c.i === i)) return;
    const until = g.take ? g.until : g.mealUntil ?? g.until;
    roast.onEvent(s, { kind: 'order', gid: g.id, i, item: l.k, patience: Math.max(5, until - S.t) }, ctx(false));
  });
  for (const c of [...s.q]) if (!want.has(`${String(c.gid)}:${String(c.i)}`)) roast.onEvent(s, { kind: 'cancel', gid: c.gid, i: c.i }, ctx(false));
}
function report(out: RoastResult[]): void {
  for (const r of out){
    if (r.kind === 'lineDone') submit('roast', { k: 'lineDone', gid: r.gid, dest: 'roast', i: r.i, made: { t: 'score', q: r.q, pay: Math.max(0, r.pay + r.tip - r.loss) } });
    else if (r.kind === 'walkout') submit('roast', { k: 'walkout', gid: r.gid, i: r.i });
  }
}
/**
 * Work begun at the counter: a roast on the board, anything on the plate (the ticket's ✓白飯), a finger
 * left down. Seen in play: back at 燒味 after the computer covered it, the order on the ticket had 白飯 ticked and a
 * meat on the board.
 */
function started(s: RoastState): boolean {
  const P = s.plate;
  return s.board !== null || P.base !== null || P.items.length > 0 || P.soy > 0 || P.soup > 0 || P.ginger || P.veg || P.scal || P.flood || s.f.down;
}
/**
 * The player takes the counter from the computer: the computer finishes the plate it began, in fast
 * time (kit.ts finishStarted), and hands it over as its own. The customers' waits stand still meanwhile (no shop time
 * passes); the cues it made are dropped, so the player's screen does not replay them. A plate it could not finish in
 * FINISH_S (no customer left for the roast on the board) is put back untouched.
 */
function computerFinishes(): void {
  const s = st.peek(); if (!s) return;
  const timed = s.q.map(c => [c, c.timed] as const), seq = s.fxSeq;
  for (const c of s.q) c.timed = false;
  finishStarted(() => started(s), dt => {
    const c = roast.bot.next(s, ctx(false)); if (c) report(roast.command(s, c, ctx(false)));
    report(roast.step(s, dt, ctx(false)));
  });
  for (const [c, t] of timed) c.timed = t;
  if (started(s)){ s.board = null; s.plate = newPlate(); s.f.down = false; s.f.mode = null; }
  s.fx = s.fx.filter(f => f.seq <= seq);
  resetBot(s);
}

/** A player's command at the roast counter (the seat screen calls it). */
export function roastCommand(cmd: Parameters<typeof roast.command>[1]): void { const s = st.get(); sync(s); report(roast.command(s, cmd, ctx(true))); }

registerStation({
  kind: 'roast', v: 1,
  pick: () => st.get(),
  put: (_S, s) => { if (!roast.validate(s)) return false; st.set(structuredClone(s)); return true; },
  // a hand-over drops the old driver's finger and the computer's plan in hand (a finger left down by the
  // computer mid-chop locked the player out of the counter); to a player, the computer first finishes what it started (item 1)
  toComputer: () => { const s = st.peek(); if (s) handOver(s); },
  toPlayer: () => { computerFinishes(); const s = st.peek(); if (s) handOver(s); },
  started: () => { const s = st.peek(); return !!s && started(s); },
  waiting: () => roast.status(st.get(), ctx(false)).waiting,
  step: (dt, driver) => {
    const s = st.get(); sync(s);
    if (driver === 'computer'){ const c = roast.bot.next(s, ctx(false)); if (c) report(roast.command(s, c, ctx(false))); }
    report(roast.step(s, dt, ctx(driver === 'me')));
  },
}, {
  kind: 'roast', lineDest: 'roast',
  onResult: (_seat, r) => r.k === 'lineDone' && r.made.t === 'score' && roastMade(r.gid, r.i, r.made.pay),
});
/** The roast module's own bot pressing for a player (the simulations' player at this seat). */
registerSeatCommand('roast', c => { const p = ptrCmd(c); if (p) roastCommand(p); return p !== null; });
export function roastBotPress(): void { const c = roast.bot.next(st.get(), ctx(true)); if (c) roastCommand(c); }
