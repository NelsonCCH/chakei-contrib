// What the playtest timing log (log.ts) sees of each mini-game. Watch-only: nothing here changes a station.
//
// The shop's four (伙記 / 水吧 / 廚房 / 收銀): every tap of their screens goes through the HOOK table (ui/hooks.ts), so
// each tap entry is wrapped once: a tap is logged as `fn:what` (e.g. barKey:ing, tillKey:num, sheetAct:add), the names the
// human model costs (tests/sim/human.js cost()); a good() or breakCombo() the tap itself causes marks it done / wrong.
// The extra seats (傳菜 / 洗碗 / 燒味 / 外賣): every command their iframe sends passes PT.seat (ui/seat.ts); each seat's
// observer compares the station's state before and after it and logs gestures (down .. up), mistakes and finished work.
// 傳菜 is steered by tilt, so its trips are watched from its state instead (seePoll, every log poll).
//
// A new mini-game (ts-floor's 執枱 / 送外賣, ...): an iframe seat adds an observer to SEATS below; a station that runs on
// the game page calls ptDown / ptUp / ptTap / ptMiss / ptDone (core/playtest/hook.ts) from its own input handler.
import { G } from '../core/state';
import { HOOK } from '../ui/hooks';
import { PT, ptDown, ptUp, ptTap, ptMiss, ptDone, type PtExtra } from '../core/playtest/hook';
import { takeawayState } from '../core/coop/plugins/takeaway';
import { roastState } from '../core/coop/plugins/roast';
import { runnerState } from '../core/coop/plugins/runner';

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const mine = (st: string): boolean => !!G && G.running && Object.entries(G.roles).some(([k, v]) => k === st && v === 'me');

/* ---------- the shop's four: taps through HOOK ---------- */
const TAPS: Readonly<Record<string, string>> = {
  tapTable: 'waiter', tapGroup: 'waiter', deselect: 'waiter', sheetAct: 'waiter', barKey: 'bar', pickLine: 'bar',
  kitKey: 'kitchen', pickPlate: 'kitchen', assignMeal: 'kitchen', tillKey: 'till', strikeLine: 'till',
};
const SHEET_KEYS = ['add', 'pick', 'peek', 'del', 'temp', 'sweet', 'noice', 'opt', 'flag', 'dflag', 'hat'];
/** The kind of a tap, in the human model's terms (its cost differs by kind). */
function what(fn: string, a: unknown): string {
  if (fn === 'sheetAct' && obj(a)) { const act = a.act; if (typeof act === 'string' && act) return act; return SHEET_KEYS.find(k => k in a && a[k] !== undefined) ?? 'other'; }
  if (typeof a !== 'string') return '';
  if (fn === 'barKey') return ['pot', 'dump', 'serve', 'hot', 'cold'].includes(a) ? a : 'ing';
  if (fn === 'kitKey') return ['dump', 'serve', 'stir'].includes(a) ? a : a.startsWith('t:') ? 'stove' : a.startsWith('h:') ? 'hold' : 'tray';
  if (fn === 'tillKey') return /^\d$/.test(a) ? 'num' : a === '+' ? 'plus' : a;
  return '';
}
let inTap: { good: number; bad: number } | null = null;
function wrap(fn: string, f: (orig: (...a: unknown[]) => unknown) => (...a: unknown[]) => unknown): void {
  const orig: unknown = Reflect.get(HOOK, fn);
  if (typeof orig !== 'function') return;
  Reflect.set(HOOK, fn, f((...a: unknown[]): unknown => { const r: unknown = Reflect.apply(orig, HOOK, a); return r; }));
}
function wrapTaps(): void {
  for (const [fn, st] of Object.entries(TAPS)) {
    wrap(fn, orig => (...a) => {
      if (inTap || !mine(st)) return orig(...a);
      const box = { good: 0, bad: 0 }, step = st === 'till' && G ? G.step : '';
      inTap = box;
      try { return orig(...a); } finally {
        inTap = null;
        const k = what(fn, a[0]), x: PtExtra | undefined = step ? { step } : undefined;
        ptTap(st, k ? `${fn}:${k}` : fn, box.bad === 0, x);
        if (box.bad) ptMiss(st, 'wrong');
        if (box.good) ptDone(st, fn);
      }
    });
  }
  wrap('good', orig => (...a) => { if (inTap) inTap.good++; return orig(...a); });
  wrap('breakCombo', orig => (...a) => { if (inTap) inTap.bad++; return orig(...a); });
}

/* ---------- the extra seats: commands through PT.seat ---------- */
interface Seat<P> { snap(): P | null; see(pre: P, post: P, k: string, c: Record<string, unknown>): void }
/** Where a pointer gesture went down (css px), for its length and speed at the up. */
let down0: { x: number; y: number } | null = null;
function ptrX(c: Record<string, unknown>): PtExtra | undefined {
  const x = num(c.cx), y = num(c.cy), d = down0; down0 = null;
  return d && x !== null && y !== null ? { px: Math.round(Math.hypot(x - d.x, y - d.y)) } : undefined;
}
function ptrDown(c: Record<string, unknown>): void { const x = num(c.cx), y = num(c.cy); down0 = x !== null && y !== null ? { x, y } : null; }

// 外賣: drag an item into the bag, tap a tray / 綁袋, trace the knot, drag the bag to the customer
const takeaway: Seat<{ down: boolean; phase: string; drag: string; dragId: number; slot: number; bag: object; wrong: number; spills: number; wrongHand: number; exN: number;
  tie: object | null; offs: number; ties: number; results: number }> = {
  snap() {
    const s = takeawayState(); if (!s) return null;
    const dr = s.drag;
    return { down: s.f.down, phase: s.phase, drag: dr ? dr.kind : '', dragId: dr && dr.kind === 'item' ? dr.id : -1, slot: dr && dr.kind === 'item' ? dr.slot : -1, bag: s.bag,
      wrong: s.bag.items.filter(i => i.wrong).length, spills: s.bag.spills, wrongHand: s.bag.wrongHand, exN: s.bag.log.length,
      tie: s.tie, offs: s.tie ? s.tie.offs : 0, ties: s.ties.length, results: s.results.length };
  },
  see(a, b, k, c) {
    const st = 'takeaway';
    if (k === 'down' && !a.down && b.down) {
      ptrDown(c);
      const g = b.drag === 'item' ? 'drag' : b.drag === 'bag' ? 'hand' : b.phase === 'tie' && a.phase === 'tie' ? 'trace'
        : b.exN > a.exN ? 'tray' : b.exN < a.exN ? 'undo' : a.phase === 'pack' && b.phase === 'tie' ? 'tieBtn' : '-';
      ptDown(st, g);
      if (g === 'undo') ptMiss(st, 'undo');
    }
    if (a.bag === b.bag) {
      if (b.wrong > a.wrong) ptMiss(st, 'wrongItem');
      if (b.spills > a.spills) ptMiss(st, 'spill');
      if (b.wrongHand > a.wrongHand) ptMiss(st, 'wrongHand');
    }
    if (a.tie && a.tie === b.tie && b.offs > a.offs) ptMiss(st, 'off');
    let x: PtExtra | undefined;
    const s = takeawayState(), tl = s && b.ties > a.ties ? s.ties[s.ties.length - 1] : undefined;
    if (tl) tieX = { par: Math.round(tl.par * 1000), tt: Math.round(tl.time * 1000), len: Math.round(tl.len), tier: tl.tier };
    if (b.results > a.results) { const v = s?.results[s.results.length - 1]; ptDone(st, 'bag', v ? { stars: v.stars } : undefined); }
    if ((k === 'up' || k === 'cancel') && a.down && !b.down) {
      if (a.drag === 'item' && s?.counter[a.slot]?.id === a.dragId) ptMiss(st, 'drop');   // not packed: it went back to the counter
      x = { ...ptrX(c), ...tieX, ...(k === 'cancel' ? { cancel: 1 } : {}) }; tieX = undefined;
      ptUp(st, k !== 'cancel', x);
    }
  },
};
let tieX: PtExtra | undefined;

// 燒味: drag a roast down to the board, cut (叉燒 slice down a guide) / chop, drag the pieces, tap base / sauces, swipe the plate
const ROAST_G: Readonly<Record<string, string>> = { roast: 'hook', trace: 'cut', pieces: 'pieces', tap: 'chop', tapOrPieces: 'chop', done: 'chop', base: 'base', soy: 'soy',
  ladle: 'ladle', ginger: 'tap', scal: 'tap', veg: 'tap', plate: 'swipe' };
let roastG = '';
const roast: Seat<{ down: boolean; mode: string; cuts: number; clean: number; served: number; dumped: number; partial: boolean; stars: number }> = {
  snap() {
    const s = roastState(); if (!s) return null;
    return { down: s.f.down, mode: s.f.mode ?? '', cuts: s.cuts, clean: s.cleanCuts, served: s.served, dumped: s.dumped, partial: !!s.board?.partial, stars: s.starsSum };
  },
  see(a, b, k, c) {
    const st = 'roast';
    if (k === 'down' && !a.down && b.down) { ptrDown(c); roastG = ROAST_G[b.mode] ?? '-'; ptDown(st, roastG); }
    if (b.down && b.mode === 'pieces' && roastG === 'chop') roastG = 'pieces';   // a press on cut meat that became a drag
    if (b.cuts > a.cuts && b.clean - a.clean < b.cuts - a.cuts) ptMiss(st, 'ragged');
    if (b.dumped > a.dumped) ptMiss(st, 'dump');
    if (b.served > a.served) ptDone(st, 'plate', { stars: b.stars - a.stars });
    if ((k === 'up' || k === 'cancel') && a.down && !b.down) {
      if (a.mode === 'trace' && b.partial) ptMiss(st, 'lift');   // lifted before the cut went through
      ptUp(st, k !== 'cancel', { ...ptrX(c), ...(k === 'cancel' ? { cancel: 1 } : {}) }, roastG || undefined);
    }
  },
};

// 傳菜: picking how many tables to take is a tap; the trip itself (tilt) is watched by seePoll
const runner: Seat<{ st: string }> = {
  snap() { const s = runnerState(); return s ? { st: s.st } : null; },
  see(a, b, k, c) { if (k === 'pick') ptTap('runner', 'pick', a.st === 'pick' && b.st !== 'pick', { n: num(c.n) ?? 0 }); },
};

// Each seat's observer, by kind; its snapshot type stays inside it.
const SEATS: Readonly<Record<string, { run(k: string, c: Record<string, unknown>, go: () => boolean): boolean }>> = {
  takeaway: seat(takeaway, 'k'), roast: seat(roast, 'k'), runner: seat(runner, 't'),
};
function seat<P>(o: Seat<P>, key: 'k' | 't'): { run(k: string, c: Record<string, unknown>, go: () => boolean): boolean } {
  return {
    run(_k, c, go) {
      const kk = c[key], k = typeof kk === 'string' ? kk : '';
      // tilt and view carry no gesture; a move is watched (it can tie a knot, swipe a plate or finish a cut)
      if (k === 'tilt' || k === 'view') return go();
      const a = o.snap(), ok = go(), b = o.snap();
      if (a && b) o.see(a, b, k, c);
      return ok;
    },
  };
}
function onSeat(kind: string, c: unknown, go: () => boolean): boolean {
  const o = SEATS[kind];
  if (!o || !obj(c) || !mine(kind)) return go();
  return o.run(kind, c, go);
}

/* ---------- 傳菜 trips, from its state (every log poll) ---------- */
let trip: { s: object; st: string; done: number; crashes: number } | null = null;
function seePoll(): void {
  const s = runnerState();
  if (!s || !mine('runner')) { trip = null; return; }
  const was = trip && trip.s === s ? trip : { s, st: s.st, done: s.run.done, crashes: s.trip.crashes };
  if (s.st === 'play' && was.st !== 'play' && was.st !== 'sink' && was.st !== 'crash') ptDown('runner', 'steer');
  if (s.trip.crashes > was.crashes) ptMiss('runner', 'crash');
  if (s.run.done > was.done) ptDone('runner', 'table', { n: s.run.done - was.done });
  if ((s.st === 'toast' || s.st === 'end' || s.st === 'pick') && (was.st === 'play' || was.st === 'sink' || was.st === 'crash')) {
    const r = s.trip.result;
    ptUp('runner', !!r && r.del === r.n && s.trip.crashes === 0, r ? { n: r.n, del: r.del, par: Math.round(s.trip.par * 1000), bumps: s.trip.bumps } : undefined);
  }
  trip = { s, st: s.st, done: s.run.done, crashes: s.trip.crashes };
}

let on = false;
/** Installs the observers (once). Returns the poll part for log.ts. */
export function observeStart(): () => void {
  if (!on) { on = true; wrapTaps(); PT.seat = onSeat; }
  return seePoll;
}
