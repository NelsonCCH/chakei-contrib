// The computer driver for the 燒味 counter: it plays the station through the same pointer commands a finger sends
// (down / move / up), at a human-like pace, so the strict gestures judge it exactly as they judge a player. It follows
// the ticket's next step (core.nextStep's order): base, soup and 蔥花, pull the roast, cut each guide, plate the pieces,
// soy, sides, swipe up. Its plan for the gesture in hand lives in the state (`ai`), so a hand-over carries it.
// Its aim at a guide is off by a Gaussian error of spread `ai.aim` (logical px): the computer covering a seat has a
// steady hand (core BOT_AIM); the simulations give it a person's (tests/sim/human.js AIM_SKILL).
import type { BotModule, Rng, StationCtx } from '../contract';
import { BASE, BOT_AIM, LY, TUNE, boardDone, lastCut, uncut, zones, type BotStep, type RoastCmd, type RoastState } from './core';

/** Pace: s between gestures, s between finger moves, how long a tap is held. */
export const BOT = { gap: [0.22, 0.42], move: 0.025, tapHold: 0.07 } as const;

type Pt = { x: number; y: number };
const ptr = (s: RoastState, k: 'down' | 'move' | 'up', p: Pt): RoastCmd => ({ k, x: p.x, y: p.y, cx: p.x * s.view.S, cy: p.y * s.view.S });
const gap = (rng: Rng) => BOT.gap[0] + rng.next() * (BOT.gap[1] - BOT.gap[0]);
function tap(s: RoastState, rng: Rng, p: Pt): BotStep[] { return [{ cmd: ptr(s, 'down', p), wait: BOT.tapHold }, { cmd: ptr(s, 'up', p), wait: gap(rng) }]; }
function hold(s: RoastState, rng: Rng, p: Pt, dur: number): BotStep[] { return [{ cmd: ptr(s, 'down', p), wait: dur }, { cmd: ptr(s, 'up', p), wait: gap(rng) }]; }
function drag(s: RoastState, rng: Rng, a: Pt, b: Pt, dur: number): BotStep[] {
  const n = Math.max(2, Math.ceil(dur / BOT.move)), out: BotStep[] = [{ cmd: ptr(s, 'down', a), wait: BOT.move }];
  for (let i = 1; i <= n; i++) out.push({ cmd: ptr(s, 'move', { x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }), wait: BOT.move });
  out.push({ cmd: ptr(s, 'up', b), wait: gap(rng) });
  return out;
}
const mid = (r: { x: number; y: number; w: number; h: number }): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const gauss = (rng: Rng) => { const u = 1 - rng.next(), v = rng.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/** The next gesture for the front customer, as finger commands with waits (empty: nothing to do yet). */
export function plan(s: RoastState, rng: Rng): BotStep[] {
  const c = s.q[0]; if (!c || s.over) return [];
  const o = c.ord, P = s.plate, b = s.board, L = LY(s), soup = BASE[o.base].soup, pc = { x: L.plate.cx, y: L.plate.cy };
  const swipe = (dir: 1 | -1) => drag(s, rng, pc, { x: pc.x, y: pc.y + dir * 22 }, 0.15);
  const aim = () => gauss(rng) * s.ai.aim;
  // a plate that cannot be right any more goes in the bin (a wrong base under meat, or a roast nobody ordered)
  if (P.items.some(i => !o.meats.includes(i.k)) || (P.base && P.base !== o.base && P.items.length)) return swipe(1);
  if (P.base && P.base !== o.base) return tap(s, rng, mid(L.bases[o.base]));
  const bowl = (): BotStep[] | null => {
    if (!P.base) return tap(s, rng, mid(L.bases[o.base]));
    if (soup && P.soup < 1) return drag(s, rng, mid(L.soup), pc, 0.3);
    if (soup && !P.scal) return tap(s, rng, mid(L.scal));
    return null;
  };
  if (b) {
    const wanted = o.meats.includes(b.k);
    if (boardDone(s, b) || (!wanted && b.cuts.length)) {
      const first = bowl(); if (first) return first;
      // the cut pieces ride the finger to this roast's place on the plate (one zone per meat; a bowl has one), picked
      // up from the middle of the first piece (clear of any guide)
      const n = zones(s), z = Math.min(n - 1, Math.max(0, o.meats.indexOf(b.k))), zx = L.plate.cx - L.plate.rx + (z + 0.5) * (L.plate.rx * 2 / n);
      const from = { x: Math.min(b.x0 + b.w / 2, (b.x0 + lastCut(b)) / 2), y: L.meatCy + b.h * 0.3 };
      return drag(s, rng, from, { x: zx, y: L.plate.cy }, 0.3);
    }
    const g = uncut(s, b)[0];
    if (wanted && g !== undefined) {
      const gx = g + aim(), top = L.meatCy - b.h / 2, bot = L.meatCy + b.h / 2;
      if (b.k !== 'char') return tap(s, rng, { x: gx, y: L.meatCy });
      // 叉燒: draw the knife down the line from the top
      const out: BotStep[] = [{ cmd: ptr(s, 'down', { x: gx, y: top + 2 }), wait: BOT.move }];
      for (let y = top + 4; y < bot + 3; y += 2) out.push({ cmd: ptr(s, 'move', { x: gx + aim() * 0.3, y }), wait: BOT.move });
      out.push({ cmd: ptr(s, 'up', { x: gx, y: bot + 3 }), wait: gap(rng) });
      return out;
    }
  }
  const first = bowl(); if (first) return first;
  const need = o.meats.find(k => !P.items.some(i => i.k === k));
  if (need) {
    if (s.lock > s.t) return [];
    const h = L.hooks.find(q => q.k === need);
    if (!h) return [];
    return drag(s, rng, { x: h.x, y: L.rail.y + L.rail.h / 2 }, mid(L.board), 0.35);
  }
  if (!soup && P.soy < TUNE.soy.lo) return hold(s, rng, mid(L.soy), ((TUNE.soy.lo + TUNE.soy.hi) / 2 - P.soy) * TUNE.soy.time);
  if (o.ginger && !P.ginger) return tap(s, rng, mid(L.ginger));
  if (o.veg && !P.veg) return tap(s, rng, mid(L.veg));
  return swipe(-1);
}

/** Drops the plan in hand (when a player takes the seat back). */
export function resetBot(s: RoastState) { s.ai = { at: s.t, steps: [], aim: s.ai.aim }; }
/**
 * The seat changes hands (the computer to a player or back): the old driver's finger lifts without doing
 * anything (a half-done tap, slice or soy pour is dropped) and the computer's plan in hand is dropped, so neither a stuck
 * finger nor a stale plan carries over.
 */
export function handOver(s: RoastState) { s.f.down = false; s.f.mode = null; resetBot(s); }
/** Sets the aim of the bot playing this seat (the simulations' person; null: the computer's steady hand). */
export function setBotAim(s: RoastState, aim: number | null) { s.ai.aim = aim ?? BOT_AIM; }

export const roastBot: BotModule<RoastState, RoastCmd> = {
  next(s: RoastState, ctx: StationCtx): RoastCmd | null {
    if (s.over || s.t < s.ai.at) return null;
    if (!s.ai.steps.length) {
      if (s.f.down) return { k: 'cancel' };                          // a finger left down by the last driver
      s.ai.steps = plan(s, ctx.rng);
      if (!s.ai.steps.length) { s.ai.at = s.t + 0.2; return null; }
    }
    const st = s.ai.steps.shift();
    if (!st) return null;
    s.ai.at = s.t + st.wait;
    return st.cmd;
  },
};
