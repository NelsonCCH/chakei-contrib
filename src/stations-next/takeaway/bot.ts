// The computer driver for the 外賣 counter: it plays the station through the same pointer commands a finger sends
// (down / move / up), at a human-like pace, so the prototype's rules judge it exactly as they judge a player. For the slip in
// turn it drags the boxes into the bag first (so nothing gets squashed), then the drinks and 菠蘿油, taps the trays up to
// the slip's counts (and back with ↶ if it has too many), taps 綁袋, traces the path a little slower than par, and drags
// the tied bag to that customer at the door. Its plan for the gesture in hand lives in the state (`ai`); the trace is
// closed-loop on the state (it aims just ahead of the glowing head), so a hand-over carries everything.
import type { BotModule, Rng, StationCtx } from '../contract';
import { knotSpeed } from './knots';
import { EXK, LY, TUNE, active, custOrders, itemById, needEx, slotXY, tiePath, tieAt, trayRect, undoRect, type BotStep, type TakeCmd, type TakeState } from './core';

/** Pace: s between gestures, s between finger moves, tap hold, aim error (logical px; css px on the trace), trace speed as a share of parSpeed. */
export const BOT = { gap: [0.22, 0.42], move: 0.025, tapHold: 0.07, aim: 1.5, traceAim: 3, tie: 0.75 } as const;

type Pt = { x: number; y: number };
const ptr = (s: TakeState, k: 'down' | 'move' | 'up', p: Pt, t: number): TakeCmd => ({ k, x: p.x, y: p.y, cx: p.x * s.view.S, cy: p.y * s.view.S, ms: t * 1000 });
const gap = (rng: Rng) => BOT.gap[0] + rng.next() * (BOT.gap[1] - BOT.gap[0]);
const aim = (rng: Rng, p: Pt, a: number = BOT.aim): Pt => ({ x: p.x + (rng.next() * 2 - 1) * a, y: p.y + (rng.next() * 2 - 1) * a });
// the waits are relative; the ms stamp a command carries is the time it will be sent at
function tap(s: TakeState, rng: Rng, p: Pt): BotStep[] { const q = aim(rng, p); return [{ cmd: ptr(s, 'down', q, s.t), wait: BOT.tapHold }, { cmd: ptr(s, 'up', q, s.t + BOT.tapHold), wait: gap(rng) }]; }
function drag(s: TakeState, rng: Rng, a: Pt, b: Pt, dur: number): BotStep[] {
  const n = Math.max(2, Math.ceil(dur / BOT.move)), p0 = aim(rng, a), p1 = aim(rng, b), out: BotStep[] = [{ cmd: ptr(s, 'down', p0, s.t), wait: BOT.move }];
  let t = s.t + BOT.move;
  for (let i = 1; i <= n; i++) { const u = i / n, e = u * u * (3 - 2 * u); out.push({ cmd: ptr(s, 'move', { x: p0.x + (p1.x - p0.x) * e, y: p0.y + (p1.y - p0.y) * e }, t), wait: BOT.move }); t += BOT.move; }
  for (let i = 0; i < 3; i++) { out.push({ cmd: ptr(s, 'move', p1, t), wait: BOT.move }); t += BOT.move; }   // settle, so the throw is not a fling
  out.push({ cmd: ptr(s, 'up', p1, t), wait: gap(rng) });
  return out;
}
const mid = (r: { x: number; y: number; w: number; h: number }): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The next gesture while packing or handing over (empty: nothing to do yet). */
export function plan(s: TakeState, rng: Rng): BotStep[] {
  const a = active(s), L = LY(s), lift = TUNE.lift / s.view.S;
  if (!a || s.over || s.mode !== 'shift') return [];
  if (s.phase === 'hand') {
    const i = custOrders(s).indexOf(a); if (i < 0) return [];
    const c = L.cust, w = L.LW / TUNE.maxOrders, to = { x: i * w + w / 2, y: c.y + c.h / 2 + lift };
    return drag(s, rng, mid(L.bag), to, 0.35);
  }
  if (s.phase !== 'pack') return [];
  // the bag's things: boxes first; a drink or 菠蘿油 waits while a box of this slip is still to come
  const mine = s.counter.map((c, i) => ({ c, i, it: c ? itemById(s, c.id) : null })).filter(x => x.c && x.c.enter === 0 && x.it?.no === a.no && !x.it.packed);
  const boxLeft = a.items.some(it => it.kind === 'box' && !it.packed);
  const next = mine.find(x => x.it?.kind === 'box') ?? (boxLeft ? undefined : mine[0]);
  if (next) { const p = slotXY(L, next.i); return drag(s, rng, p, { x: L.bag.x + L.bag.w / 2, y: L.bag.y + L.bag.h / 2 + lift }, 0.3); }
  const need = needEx(a), have = s.bag.ex;
  if (EXK.some(k => have[k] > need[k])) return tap(s, rng, mid(undoRect(L)));
  for (const k of EXK) if (have[k] < need[k]) return tap(s, rng, mid(trayRect(L, k)));
  if (a.items.every(i => i.packed)) return tap(s, rng, mid(L.tieBtn));
  return [];
}

/** The trace, one finger move at a time along the path (ai.ti), as fast as the curve there allows; off the line, back to the head. */
function traceCmd(s: TakeState, rng: Rng): TakeCmd | null {
  const T = s.tie; if (!T) return null;
  if (s.t < T.readyAt) { s.ai.at = T.readyAt; return null; }
  const S = s.view.S, j = (i: number): Pt => { const q = tieAt(T, Math.round(i)); return { x: (q[0] + (rng.next() * 2 - 1) * BOT.traceAim) / S, y: (q[1] + (rng.next() * 2 - 1) * BOT.traceAim) / S }; };
  s.ai.at = s.t + BOT.move;
  if (!s.f.down || !T.on) { s.ai.ti = T.i; return ptr(s, s.f.down ? 'move' : 'down', j(T.i), s.t); }
  const P = tiePath(T), v = knotSpeed(T.tier) * BOT.tie, acc = v * v / TUNE.par.rFull, i0 = Math.round(s.ai.ti);
  let r = 1e9; for (let i = i0; i < Math.min(T.n, i0 + 6); i++) r = Math.min(r, P.info.rad[i] ?? 1e9);
  s.ai.ti = Math.min(T.n - 1, s.ai.ti + Math.min(v, Math.sqrt(acc * r)) * BOT.move / TUNE.trace.step);
  return ptr(s, 'move', j(s.ai.ti), s.t);
}

/** Drops the plan in hand (when a player takes the seat back). */
export function resetBot(s: TakeState) { s.ai = { at: s.t, steps: [], ti: 0 }; }

export const takeawayBot: BotModule<TakeState, TakeCmd> = {
  next(s: TakeState, ctx: StationCtx): TakeCmd | null {
    if (s.over || s.t < s.ai.at) return null;
    const st = s.ai.steps.shift();
    if (st) { s.ai.at = s.t + st.wait; return { ...st.cmd, ...('ms' in st.cmd ? { ms: s.t * 1000 } : {}) }; }
    if (s.phase === 'tie') return traceCmd(s, ctx.rng);
    if (s.f.down) { s.ai.at = s.t + 0.1; return ptr(s, 'up', { x: s.f.lx, y: s.f.ly }, s.t); }   // the trace is done, or a finger left down
    s.ai.steps = plan(s, ctx.rng);
    if (!s.ai.steps.length) { s.ai.at = s.t + 0.2; return null; }
    return this.next(s, ctx);
  },
};
