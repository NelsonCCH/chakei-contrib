// 外賣 takeaway counter: the station core, ported 1:1 from the playtested original prototype.
// Pure (src/stations-next/contract.ts rules): no DOM, timers, clocks or Math.random. Time comes in as `dt`, randomness
// from `ctx.rng`, and the whole state is plain JSON so a seat can be handed to another driver by value. The tie path is
// kept as its spec (difficulty, seed, rect, family) and rebuilt on demand by path.ts, which is deterministic.
//
// Input is the prototype's own pointer code fed with pointer commands (down / move / up / cancel) carrying logical px (x, y),
// the css px the prototype measures the trace and the throw in (cx, cy) and the event time in ms (the throw's speed). The
// layout the hit tests use is a pure function of the view size (`view` command), kept in the state.
//
// Changes from the prototype: slips never fold (fold is 0 on every difficulty), so the fold / peek code is not
// ported; particles are the screen's (the core sends `fx`); the prototype's Math.random calls draw from ctx.rng.
//
// Work: with `selfFeed` on (the standalone page) the station prints its own slips as the prototype does. The referee turns it
// off and sends `bag` events (shop takeaway orders, walk-ins) and `item` events (a dish or drink is ready on the counter),
// and takes the bags back as `packed` results.
import type { BotModule, Difficulty, Rng, RefEvent, ShiftConfig, StationCtx, StationModule, StationStatus } from '../contract';
import { at, curveInfo, type CurveInfo, type Pt, type Rect, type TiePath } from './path';
import { KNOT_PATTERNS, KNOT_TUNE, knotBand, knotDef, knotPar, knotPts, drawKnot, sessionKnots, keepKnots, type KnotBag } from './knots';
/* ======================= TUNING KNOBS (the prototype's TUNE, verbatim) ======================= */
export const TUNE = {
  shift: 150,                       // seconds in a shift
  lastOrder: 30,                    // no new slips in the last N seconds
  maxOrders: 4,                     // slips (and people waiting at the door) at once
  counterSlots: 6,                  // places on the counter for finished food and drinks
  arrive: [1.5, 7],                 // s after a slip prints that its items land on the counter (staggered over this span)
  remake: 6,                        // s for the kitchen to remake an item you packed into someone else's bag
  lift: 30,                         // css px a dragged item / bag rides above the finger, so the thumb does not hide it
  // Bag tying, the star. Lengths in css px. The path is resampled every `step` px. Progress moves along the path only:
  // the next sample counts when the finger is within `band` of it, and a run of samples outside the band longer than
  // `gap` stops it, so a finger cutting across an overlap or a hairpin never skips ahead. `win` caps how far ahead one
  // finger position can reach. Leaving the band (hysteresis x offK) pauses; above 新人 it also undoes `undo` px.
  trace: { step: 3, gap: 27, back: 45, offK: 1.2, next: 110, arrowEvery: 72, intro: 0.35, rustleEvery: 16 },
  // Path generator: margin from the trace area edge; jitter of the v1 control points (grid units); default rotation (deg);
  // attempts per family before handing over to another; smoothing passes. (path.ts GEN holds the same values.)
  gen: { margin: 30, timerH: 12, jitter: 0.32, rot: 12, tries: 24, smoothMax: 6 },
  // par (s) = base + time of a careful hand: parSpeed on straights, slower in curves tighter than rFull px (lateral
  // limit), plus corner[0] + corner[1] x turn/180 at each sharp corner. (path.ts PAR holds the same values.)
  par: { base: 0.6, rFull: 70, corner: [0.05, 0.15] },
  fx: { hand: 0.42, ghosts: 6, ghostGap: 0.006, cinch: 0.24, hold: 0.55 },   // s: hand run, afterimages and their spacing, cinch, hold on the knot
  tip: { base: 3, tie: 2, wait: 1.5, over: 0.5, wrongHand: 1 },
  slowTie: 2,                       // a tie slower than par x this costs a star
  diff: {
    // slipGap: s between slips; people/items: ranges; patience: s a customer waits (+ perItem each); band/win/undo: trace.
    // Pattern rules (css px, deg): lv picks the families and their complexity; gap = closest two strokes may run
    // without crossing; minSeg = shortest straight between corners; maxTurn = sharpest corner; minCross = shallowest
    // crossing; maxCross = most crossings; minR = tightest curve; lenK = length range x sqrt(tie rect area).
    // fold: s before a slip folds (0 = never; every difficulty is 0, no memory tests).
    rookie: { name: '新人', slipGap: 24, people: [1, 2], items: [1, 2], patience: 85, perItem: 6, hints: true, bounce: true, fold: 0,
      band: 36, win: 80, undo: 0, parSpeed: 300, lv: 0, gap: 42, minSeg: 50, maxTurn: 125, minCross: 50, maxCross: 4, minR: 36, lenK: [1.8, 4.8] },
    pro: { name: '熟手', slipGap: 19, people: [1, 3], items: [2, 3], patience: 70, perItem: 5, hints: false, bounce: false, fold: 0,
      band: 29, win: 72, undo: 30, parSpeed: 380, lv: 1, gap: 36, minSeg: 42, maxTurn: 140, minCross: 40, maxCross: 10, minR: 27, lenK: [2.6, 7.5] },
    ace: { name: '阿姐', slipGap: 15, people: [1, 4], items: [2, 4], patience: 60, perItem: 5, hints: false, bounce: false, fold: 0,
      band: 24, win: 64, undo: 60, parSpeed: 460, lv: 2, gap: 31, minSeg: 36, maxTurn: 150, minCross: 35, maxCross: 22, minR: 20, lenK: [3.4, 10.5] },
  },
} as const;
/* ======================================================================================== */

/* ---------- menu (the prototype's, verbatim) ---------- */
export const FOODS: readonly { n: string; c: string; syrup?: boolean }[] = [
  { n: '焗豬扒飯', c: '#c8452f' }, { n: '乾炒牛河', c: '#7a4a22' }, { n: '星洲炒米', c: '#e8c23a' }, { n: '揚州炒飯', c: '#efd27a' },
  { n: '咖喱牛腩飯', c: '#e08a1a' }, { n: '餐蛋公仔麵', c: '#f4e0a0' }, { n: '西多士', c: '#d9a050', syrup: true },
];
export const SOFT = { n: '菠蘿油', c: '#e8b450' } as const;
export const DRINKS: readonly { b: string; c: string }[] = [{ b: '奶茶', c: '#b0794a' }, { b: '檸茶', c: '#c88a2a' }, { b: '鴛鴦', c: '#8a5a3a' }, { b: '檸水', c: '#eedf9a' }, { b: '咖啡', c: '#5a3a22' }];
export type ExK = 'cut' | 'nap' | 'str' | 'sug' | 'syr';
export const EXK: readonly ExK[] = ['cut', 'nap', 'str', 'sug', 'syr'];
export const EXN: Record<ExK, string> = { cut: '餐具', nap: '紙巾', str: '飲管', sug: '糖包', syr: '糖漿' };
export const EXU: Record<ExK, string> = { cut: '套', nap: '張', str: '枝', sug: '包', syr: '份' };
export const PPL = ['', '一位', '兩位', '三位', '四位', '五位'] as const;
export const DIFF = (d: Difficulty) => TUNE.diff[d];

/* ---------- state ---------- */
export type ItemKind = 'box' | 'soft' | 'drink';
/** One thing to pack. hot / mod: drinks only; syrup: 西多士. */
export interface Item { id: number; no: number; name: string; kind: ItemKind; col: string; syrup: boolean; hot: boolean; mod: string; packed: boolean }
export type Who = 'rider' | 'walk';
/** A slip. gid: the referee's group id (own counter when self-fed). pat: s before the customer counts as kept waiting. */
export interface Order { no: number; gid: number; t0: number; people: number; items: Item[]; who: Who; seed: number; pat: number; done: boolean; huff: number }
export type Ex = Record<ExK, number>;
export interface BagItem { it: Item; wrong: boolean; squashed: boolean }
export interface Bag { items: BagItem[]; ex: Ex; log: ExK[]; spills: number; wrongHand: number }
/** A counter place: the item (by id; it lives in its order) and its slide-in / bounce-back timers. */
export interface Cell { id: number; enter: number; back: number }
export interface Incoming { id: number; at: number }
export type Drag = { kind: 'item'; slot: number; id: number } | { kind: 'bag' };
/** The bag being tied. The path is kept as its spec (tier, pat, R: a knot of the library) and rebuilt by tiePath();
 * name / fam / par / n are copies; seed is the order's (the pattern came from it). */
export interface Tie {
  tier: number; pat: number; seed: number; R: Rect; fam: string; name: string; par: number; len: number; n: number;
  i: number; on: boolean; touched: boolean; offs: number; gain: number; readyAt: number; startT: number; fx: number; popped: boolean;
  time: number; dist: number; fingerDown: boolean; rustle: number; offT: number;
}
export interface TieLog { time: number; par: number; len: number; name: string; fam: string; offs: number; tier: number; pat: number }
export interface Verdict { no: number; gid: number; stars: number; tip: number; why: string[]; quote: string; tie: number; par: number }
export interface Leaving { no: number; seed: number; who: Who; slot: number; t: number; stars: number; quote: string }
export type Flight = { t: number; kind: 'pack' } | { t: number; kind: 'ex'; k: ExK; x0: number; y0: number };
export interface Msg { text: string; col: string; t: number }
/** The finger (the prototype's F): css px (x, y), logical px (lx, ly), smoothed css px/s velocity, last event time (ms). */
export interface Finger { down: boolean; x: number; y: number; lx: number; ly: number; px: number; py: number; vx: number; vy: number; ms: number }
export type SfxName = 'rustle' | 'whoosh' | 'pop' | 'thud' | 'tick' | 'spill' | 'bang' | 'chime' | 'slip';
/** Juice for the screen, drained by seq (logical px): sounds, the trace's sparks (p: chance), a splash, the knot burst, shakes. */
export type Fx =
  | { seq: number; kind: 'sfx'; name: SfxName; n: number }
  | { seq: number; kind: 'trail'; x: number; y: number; p: number }
  | { seq: number; kind: 'splash'; x: number; y: number; col: string; n: number }
  | { seq: number; kind: 'pop'; x: number; y: number }
  | { seq: number; kind: 'shake' };
export type Phase = 'pack' | 'tie' | 'fx' | 'hand' | 'drillRes';
export interface Summary {
  n: number; undone: number; stars: number; max: number; big: number; avgTie: number; avgPar: number; fastest: number; offs: number;
  score: number; verdict: string; quotes: string[]; why: [string, number][];
}
export interface BotStep { cmd: TakeCmd; wait: number }
export interface TakeState {
  v: 1; diff: Difficulty; selfFeed: boolean; mode: 'shift' | 'drill'; view: { LW: number; LH: number; S: number };
  t: number; orders: Order[]; counter: (Cell | null)[]; incoming: Incoming[]; no: number; nextAt: number; uid: number; gidN: number;
  phase: Phase; bag: Bag; tie: Tie | null; drag: Drag | null;
  results: Verdict[]; quotes: { no: number; text: string; bad: boolean }[]; why: Record<string, number>; tips: number; ties: TieLog[];
  msgs: Msg[]; flights: Flight[]; leaving: Leaving[]; over: boolean; end: Summary | null; drillN: number; drillWait: number;
  knot: number;   // the knot tier (1-10) the next tie is drawn from: the difficulty's (KNOT_TUNE.base), moved by the 試玩 slider
  kb?: KnotBag;   // the session's knot bag (knots.ts drawKnot): taken from the session when the run starts
  f: Finger; fx: Fx[]; fxSeq: number; idleSince: number; ai: { at: number; steps: BotStep[]; ti: number };   // ti: where the bot's finger is along the tie path
}

/* ---------- commands, events, results ---------- */
export type TakeCmd =
  | { k: 'down' | 'move' | 'up'; x: number; y: number; cx: number; cy: number; ms: number }
  | { k: 'cancel' }
  | { k: 'view'; LW: number; LH: number; S: number };
export type TakeResult =
  | { kind: 'packed'; at: number; gid: number; no: number; stars: number; tip: number; why: string[]; tie: number; par: number }
  | { kind: 'remake'; at: number; gid: number; i: number }
  | { kind: 'shiftEnd'; at: number; tips: number; handed: number; undone: number; stars: number };

/* ---------- small helpers ---------- */
const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
const rnd = (rng: Rng, a: number, b: number) => a + rng.next() * (b - a);
const rint = (rng: Rng, r: readonly [number, number]) => r[0] + Math.floor(rng.next() * (r[1] - r[0] + 1));
function pick<T>(rng: Rng, a: readonly T[]): T {
  const v = a[Math.floor(rng.next() * a.length)] ?? a[0];
  if (v === undefined) throw new Error('pick from an empty list');
  return v;
}
const df = (s: TakeState) => TUNE.diff[s.diff];

/* ---------- layout (logical px): a pure function of the view ---------- */
export interface Layout { LW: number; LH: number; rail: Rect; bag: Rect; tieBtn: Rect; counter: Rect; ex: Rect; cust: Rect }
export function layout(LW: number, LH: number): Layout {
  const railH = 44, custH = 50, exH = 26;
  const workY = railH + 2, workB = LH - custH - exH - 4;
  const bag = { x: 4, y: workY + 8, w: 56, h: workB - workY - 32 };
  return { LW, LH, rail: { x: 0, y: 0, w: LW, h: railH }, bag, tieBtn: { x: 4, y: workB - 21, w: 56, h: 19 },
    counter: { x: 64, y: workY + 2, w: LW - 66, h: workB - workY - 2 }, ex: { x: 2, y: workB + 2, w: LW - 4, h: exH }, cust: { x: 0, y: LH - custH, w: LW, h: custH } };
}
let lyKey = '', lyVal: Layout | null = null;
/** The layout for the state's view (memoised: a cache of a pure function, not state). */
export function LY(s: TakeState): Layout {
  const key = `${s.view.LW}x${s.view.LH}`;
  if (key !== lyKey || !lyVal) { lyKey = key; lyVal = layout(s.view.LW, s.view.LH); }
  return lyVal;
}
export function slotXY(L: Layout, i: number) { const c = L.counter, col = i % 2, row = Math.floor(i / 2); return { x: c.x + (col + 0.5) * c.w / 2, y: c.y + (row + 0.5) * c.h / 3 + 2 }; }
export function trayRect(L: Layout, k: ExK): Rect { const n = EXK.length, i = EXK.indexOf(k), w = (L.ex.w - 2 * (n - 1)) / n; return { x: L.ex.x + i * (w + 2), y: L.ex.y, w, h: L.ex.h }; }
// slip 0 is always the active order (orders are served in turn): it gets most of the rail
export function slipRect(L: Layout, i: number): Rect {
  const all = L.LW - 4, w0 = Math.round(all * 0.62), w = (all - w0) / (TUNE.maxOrders - 1);
  return i === 0 ? { x: 2, y: 5, w: w0 - 2, h: L.rail.h - 7 } : { x: 2 + w0 + (i - 1) * w, y: 5, w: w - 2, h: L.rail.h - 7 };
}
export function custSlot(L: Layout, i: number) { const w = L.LW / TUNE.maxOrders; return { x: i * w, y: L.cust.y, w, h: L.cust.h, cx: i * w + w / 2 }; }
export function undoRect(L: Layout): Rect { const b = L.bag; return { x: b.x + b.w - 15, y: b.y - 6, w: 15, h: 12 }; }
// the tie area in css px: between the rail and the door, minus a margin and room for the timer
export function tieRect(L: Layout, S: number): Rect { const m = TUNE.gen.margin, top = L.rail.h * S, bot = L.cust.y * S; return { x: m, y: top + m + TUNE.gen.timerH, w: L.LW * S - 2 * m, h: bot - top - 2 * m - TUNE.gen.timerH }; }
export const inR = (r: Rect, x: number, y: number, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
export const custOrders = (s: TakeState) => s.orders.filter(o => !o.done).slice(0, TUNE.maxOrders);
export const active = (s: TakeState): Order | null => s.orders.find(o => !o.done) ?? null;
export function itemById(s: TakeState, id: number): Item | null { for (const o of s.orders) for (const it of o.items) if (it.id === id) return it; return null; }
export const dragPos = (s: TakeState) => ({ x: s.f.lx, y: s.f.ly - TUNE.lift / s.view.S });
export function knotPt(s: TakeState): { x: number; y: number } { const R = s.tie ? s.tie.R : tieRect(LY(s), s.view.S), S = s.view.S; return { x: (R.x + R.w / 2) / S, y: (R.y + R.h * 0.15) / S - 14 }; }   // knot sits on a gathered neck above the bag

/* ---------- the tie path: rebuilt from its spec (memoised) ---------- */
export interface LivePath extends TiePath { info: CurveInfo }
const pathMemo = new Map<string, LivePath>();
export function tiePath(T: Tie): LivePath {
  const key = `${T.tier}|${T.pat}|${T.R.x},${T.R.y},${T.R.w},${T.R.h}`;
  let p = pathMemo.get(key);
  if (!p) {
    const k = knotDef(T.tier, T.pat), pts = knotPts(k, T.R), info = curveInfo(pts);
    p = { name: k.name, fam: k.fam, seed: T.seed, pts, step: TUNE.trace.step, len: info.len, minR: info.minR, passes: 0, R: T.R, tries: 0,
      corners: info.corners, crossings: 0, par: knotPar(pts, T.tier, T.R), info };
    if (pathMemo.size > 8) pathMemo.clear();
    pathMemo.set(key, p);
  }
  return p;
}
/** Sample i of the tie path (css px). */
export const tieAt = (T: Tie, i: number): Pt => at(tiePath(T).pts, clamp(i, 0, T.n - 1));

/* ---------- the run ---------- */
export const newBag = (): Bag => ({ items: [], ex: { cut: 0, nap: 0, str: 0, sug: 0, syr: 0 }, log: [], spills: 0, wrongHand: 0 });
const newFinger = (): Finger => ({ down: false, x: 0, y: 0, lx: 0, ly: 0, px: 0, py: 0, vx: 0, vy: 0, ms: 0 });
/** A phone at 390 x ~760 css px of scene: the prototype's own scale picks S = 3, 130 x 253 logical px. */
export const DEFAULT_VIEW = { LW: 130, LH: 253, S: 3 };
/** A fresh run. The first slip number comes from `no0` (the prototype: 10 + a random 0..29). Drill mode starts a tie on the first step. */
export function newRun(diff: Difficulty, selfFeed: boolean, mode: 'shift' | 'drill', no0: number, view = DEFAULT_VIEW): TakeState {
  const s: TakeState = {
    v: 1, diff, selfFeed, mode, view: { ...view },
    t: 0, orders: [], counter: new Array<Cell | null>(TUNE.counterSlots).fill(null), incoming: [], no: no0, nextAt: 0.4, uid: 1, gidN: 1,
    phase: mode === 'drill' ? 'drillRes' : 'pack', bag: newBag(), tie: null, drag: null,
    results: [], quotes: [], why: {}, tips: 0, ties: [], msgs: [], flights: [], leaving: [], over: false, end: null, drillN: 0, drillWait: 0,
    knot: KNOT_TUNE.base[diff], kb: sessionKnots(),
    f: newFinger(), fx: [], fxSeq: 0, idleSince: 0, ai: { at: 0, steps: [], ti: 0 },
  };
  if (mode === 'shift') say(s, '開工！睇住張單', '#ffe9a8', 0.3);
  return s;
}
export function needEx(o: Order): Ex {
  const it = o.items;
  return { cut: o.people, nap: o.people, str: it.filter(i => i.kind === 'drink' && !i.hot).length, sug: it.filter(i => i.kind === 'drink' && i.hot && i.mod !== '走甜').length,
    syr: it.filter(i => i.syrup).length };
}
const mkItem = (id: number, no: number, name: string, kind: ItemKind, col: string, o: { syrup?: boolean; hot?: boolean; mod?: string } = {}): Item =>
  ({ id, no, name, kind, col, syrup: o.syrup ?? false, hot: o.hot ?? false, mod: o.mod ?? '', packed: false });
function makeOrder(s: TakeState, rng: Rng, no: number): Order {
  const d = df(s), people = rint(rng, d.people), n = rint(rng, d.items), items: Item[] = [];
  const nDrink = n === 1 ? 0 : Math.min(people + 1, Math.max(1, Math.round(n * 0.45)));
  for (let i = 0; i < n - nDrink; i++) {
    if (rng.next() < 0.18) items.push(mkItem(s.uid++, no, SOFT.n, 'soft', SOFT.c));
    else { const f = pick(rng, FOODS); items.push(mkItem(s.uid++, no, f.n, 'box', f.c, { syrup: f.syrup === true })); }
  }
  for (let i = 0; i < nDrink; i++) {
    const dr = pick(rng, DRINKS), hot = rng.next() < 0.5;
    const mod = hot ? pick(rng, ['', '', '少甜', '走甜']) : pick(rng, ['', '', '少甜', '少冰', '走甜']);
    items.push(mkItem(s.uid++, no, (hot ? '熱' : '凍') + dr.b + mod, 'drink', dr.c, { hot, mod }));
  }
  return { no, gid: s.gidN++, t0: s.t, people, items, who: rng.next() < 0.6 ? 'rider' : 'walk', seed: Math.floor(rng.next() * 1e6), pat: d.patience + d.perItem * n, done: false, huff: 0 };
}
/** An item from its slip name (a FOODS name, 菠蘿油, or 熱 / 凍 + drink + 少甜 / 少冰 / 走甜), as the referee names them. */
export function itemOf(name: string, id: number, no: number): Item | null {
  const f = FOODS.find(x => x.n === name);
  if (f) return mkItem(id, no, f.n, 'box', f.c, { syrup: f.syrup === true });
  if (name === SOFT.n) return mkItem(id, no, SOFT.n, 'soft', SOFT.c);
  const m = /^(熱|凍)(.+?)(少甜|少冰|走甜)?$/.exec(name), dr = m ? DRINKS.find(x => x.b === m[2]) : undefined;
  if (!m || !dr || (m[1] === '熱' && m[3] === '少冰')) return null;
  return mkItem(id, no, name, 'drink', dr.c, { hot: m[1] === '熱', mod: m[3] ?? '' });
}
/** An item from a spec `{ n, kind, hot?, mod?, syrup? }` (the referee's menu: any name, the colour by kind); null if malformed. */
const SPEC_COL: Record<ItemKind, string> = { box: '#c8452f', soft: SOFT.c, drink: '#b0794a' };
export function itemSpec(x: unknown, id: number, no: number): Item | null {
  if (typeof x !== 'object' || x === null || !('n' in x) || !('kind' in x)) return null;
  const n = x.n, kind = x.kind;
  if (typeof n !== 'string' || !n || n.length > 24 || (kind !== 'box' && kind !== 'soft' && kind !== 'drink')) return null;
  const hot = 'hot' in x && x.hot === true, mod = 'mod' in x && typeof x.mod === 'string' ? x.mod : '', syrup = 'syrup' in x && x.syrup === true;
  return mkItem(id, no, n, kind, kind === 'drink' ? (hot ? '#b0794a' : '#c88a2a') : SPEC_COL[kind], { hot, mod, syrup });
}
function scheduleItems(s: TakeState, rng: Rng, o: Order) {
  o.items.forEach((it, k) => s.incoming.push({ id: it.id, at: s.t + TUNE.arrive[0] + (TUNE.arrive[1] - TUNE.arrive[0]) * (k + rng.next() * 0.8) / o.items.length }));
}

/* ---------- juice ---------- */
function say(s: TakeState, text: string, col: string, dur = 0) { if (s.msgs.some(m => m.text === text && m.t < 0.6)) return; s.msgs.push({ text, col, t: -dur }); if (s.msgs.length > 4) s.msgs.shift(); }
function push(s: TakeState, f: Fx) { s.fx.push(f); if (s.fx.length > 40) s.fx.splice(0, s.fx.length - 40); }
function sfx(s: TakeState, name: SfxName, n = 0) { push(s, { seq: ++s.fxSeq, kind: 'sfx', name, n }); }

/* ---------- input (the prototype's pointer handlers) ---------- */
type Res = TakeResult;
type Ptr = { x: number; y: number; cx: number; cy: number; ms: number };
function pdown(s: TakeState, c: Ptr): Res[] {
  if (s.over || s.f.down) return [];
  const L = LY(s), lx = c.x, ly = c.y;
  Object.assign(s.f, { down: true, x: c.cx, y: c.cy, lx, ly, px: c.cx, py: c.cy, vx: 0, vy: 0, ms: c.ms });
  if (s.phase === 'tie') { tieDown(s, c.cx, c.cy); return []; }
  if (s.phase === 'hand') { if (inR(L.bag, lx, ly, 6)) { s.drag = { kind: 'bag' }; sfx(s, 'thud'); } return []; }
  if (s.phase !== 'pack') return [];
  const o = active(s);
  for (let i = 0; i < s.counter.length; i++) {
    const ci = s.counter[i]; if (!ci || ci.enter > 0) continue;
    const p = slotXY(L, i); if (Math.abs(lx - p.x) < 15 && Math.abs(ly - p.y) < 15) { s.drag = { kind: 'item', slot: i, id: ci.id }; sfx(s, 'tick'); return []; }
  }
  if (s.bag.log.length && inR(undoRect(L), lx, ly, 3)) { const k = s.bag.log.pop(); if (k) { s.bag.ex[k]--; say(s, `退返${EXN[k]}`, '#bfe3ff'); sfx(s, 'tick'); } return []; }
  for (const k of EXK) if (inR(trayRect(L, k), lx, ly)) { addExtra(s, k); return []; }
  if (inR(L.tieBtn, lx, ly, 2)) { if (o?.items.every(i => i.packed)) startTie(s); else { say(s, o ? '仲未齊嘢' : '未有單', '#ffb347'); sfx(s, 'bang'); } }
  return [];
}
function pmove(s: TakeState, c: Ptr) {
  const F = s.f; if (!F.down) return;
  const dt = Math.max(1, c.ms - F.ms);
  F.vx = F.vx * 0.6 + (c.cx - F.x) / dt * 400; F.vy = F.vy * 0.6 + (c.cy - F.y) / dt * 400; F.ms = c.ms;   // css px/s, smoothed
  F.px = F.x; F.py = F.y; F.x = c.cx; F.y = c.cy; F.lx = c.x; F.ly = c.y;
  if (s.phase === 'tie' && s.tie && s.t >= s.tie.readyAt) tieMove(s, F.px, F.py, F.x, F.y);
}
function pup(s: TakeState, rng: Rng): Res[] {
  const F = s.f; if (!F.down) return [];
  F.down = false;
  if (s.tie) s.tie.fingerDown = false;
  const dr = s.drag; s.drag = null; if (!dr) return [];
  const L = LY(s), q = dragPos(s), out: Res[] = [];
  if (dr.kind === 'item') { if (s.phase === 'pack' && inR(L.bag, q.x, q.y, 8)) { const r = packItem(s, dr.slot); if (r) out.push(r); } else { const c = s.counter[dr.slot]; if (c) c.back = 0.2; } }
  if (dr.kind === 'bag') {
    // where it lands: the door slot under the bag, or the one the throw points at
    const S = s.view.S, fx = q.x + F.vx * 0.12 / S, fy = q.y + F.vy * 0.12 / S, os = custOrders(s);
    let hit = -1; for (let i = 0; i < os.length; i++) { const sl = custSlot(L, i); if (inR(sl, q.x, q.y, 2) || inR(sl, fx, fy, 2)) { hit = i; break; } }
    const o = os[hit];
    if (o) { const r = handTo(s, o, hit, rng); if (r) out.push(r); }
  }
  return out;
}

/* ---------- packing ---------- */
function packItem(s: TakeState, slot: number): Res | null {
  const ci = s.counter[slot], it = ci ? itemById(s, ci.id) : null, o = active(s);
  if (!ci || !it || !o) return null;
  const b = s.bag, L = LY(s);
  let out: Res | null = null;
  if (it.no !== o.no) {
    if (df(s).bounce) { ci.back = 0.2; say(s, `呢樣係 #${it.no} 嘅！`, '#ff8a5a'); sfx(s, 'bang'); return null; }
    // packed into the wrong bag: the kitchen makes that one again for its own slip (caught at hand-over)
    const owner = s.orders.find(q => q.no === it.no && !q.done);
    if (owner) {
      const k = owner.items.indexOf(it), copy: Item = { ...it, id: s.uid++, packed: false };
      owner.items[k] = copy;
      if (s.selfFeed) s.incoming.push({ id: copy.id, at: s.t + TUNE.remake });
      else out = { kind: 'remake', at: s.t, gid: owner.gid, i: k };        // the referee has the kitchen make it again
    }
    b.items.push({ it: { ...it }, wrong: true, squashed: false });
  } else { it.packed = true; b.items.push({ it: { ...it }, wrong: false, squashed: false }); }
  s.counter[slot] = null;
  if (it.kind === 'box') {
    const soft = b.items.filter(x => (x.it.kind === 'drink' || x.it.kind === 'soft') && !x.squashed);
    if (soft.length) {
      soft.forEach(x => { x.squashed = true; }); b.spills++; const dr = soft.find(x => x.it.kind === 'drink');
      say(s, dr ? '壓住杯嘢！瀉咗' : '壓扁咗個菠蘿油！', '#ff5a5a'); sfx(s, 'spill');
      push(s, { seq: ++s.fxSeq, kind: 'splash', x: L.bag.x + L.bag.w / 2, y: L.bag.y + L.bag.h - 20, col: dr ? dr.it.col : '#e8b450', n: 22 });
      push(s, { seq: ++s.fxSeq, kind: 'shake' });
      return out;
    }
  }
  sfx(s, 'thud'); s.flights.push({ t: 0, kind: 'pack' });
  return out;
}
function addExtra(s: TakeState, k: ExK) {
  if (!active(s)) { say(s, '未有單', '#ffb347'); return; }
  s.bag.ex[k]++; s.bag.log.push(k); sfx(s, 'tick');
  const r = trayRect(LY(s), k); s.flights.push({ t: 0, kind: 'ex', k, x0: r.x + r.w / 2, y0: r.y + 8 });
}

/* ---------- tying ---------- */
// The knot: the tier is s.knot; the pattern is drawn from the session's bag for that tier (no repeat
// until the tier's ten are tied, never the same family twice running), picked by the order's seed; the tie keeps it,
// so every phone shows the same one. The drill has no order: it steps through the tier's ten patterns, 3 at a time.
function startTie(s: TakeState) {
  const R = tieRect(LY(s), s.view.S), o = active(s), drill = s.mode === 'drill' || !o, seed = drill ? s.drillN * 3 : o.seed;
  let pat = seed % KNOT_PATTERNS;
  if (!drill) { s.kb ??= sessionKnots(); pat = drawKnot(s.kb, s.knot, seed); keepKnots(s.kb); }
  const T: Tie = { tier: s.knot, pat, seed, R, fam: '', name: '', par: 0, len: 0, n: 0, i: 0, on: false, touched: false, offs: 0, gain: 0,
    readyAt: s.t + TUNE.trace.intro, startT: s.t, fx: -1, popped: false, time: 0, dist: 0, fingerDown: false, rustle: 0, offT: -9 };
  const p = tiePath(T);
  T.fam = p.fam; T.name = p.name; T.par = p.par; T.len = p.len; T.n = p.pts.length;
  s.tie = T; s.phase = 'tie'; sfx(s, 'slip');
}
// T.i is the index of the last covered sample. One finger point covers following samples in order while each is within
// band (a run of up to `gap` px outside the band is bridged), never beyond i + win.
export function traceAt(s: TakeState, T: Tie, fx: number, fy: number) {
  const d = df(s), band = knotBand(T.tier), p = tiePath(T).pts, h = TUNE.trace.step, b2 = band * band, gapN = Math.round(TUNE.trace.gap / h);
  const i0 = T.i, iMax = Math.min(p.length - 1, i0 + Math.round(d.win / h));
  let best = i0;
  for (let j = i0 + 1; j <= iMax; j++) { if (j - best > gapN) break; const q = at(p, j), dx = q[0] - fx, dy = q[1] - fy; if (dx * dx + dy * dy <= b2) best = j; }
  // distance to the live stretch [i0 - back, iMax] decides on / off the line
  let dm = 1e18; for (let j = Math.max(0, i0 - Math.round(TUNE.trace.back / h)); j <= iMax; j++) { const q = at(p, j), dx = q[0] - fx, dy = q[1] - fy; dm = Math.min(dm, dx * dx + dy * dy); }
  dm = Math.sqrt(dm); T.dist = dm;
  const wasOn = T.on;
  if (T.on && dm > band * TUNE.trace.offK) T.on = false; else if (!T.on && dm <= band) T.on = true;
  if (wasOn && !T.on && T.touched) {
    T.offs++; const back = Math.round(d.undo / h); T.i = Math.max(0, T.i - back); T.offT = s.t;
    if (back) say(s, `甩咗線！退 ${d.undo}`, '#ff8a5a'); else say(s, '甩咗線，返去發光嗰度', '#ffb347'); sfx(s, 'bang');
    return;
  }
  if (T.on) { T.touched = true; if (best > T.i) { T.gain += (best - T.i) * h; T.i = best; } }
}
export function traceMove(s: TakeState, T: Tie, x0: number, y0: number, x1: number, y1: number) {
  // fast fingers: walk the segment between two events in small steps so the match never jumps
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4));
  for (let k = 1; k <= n; k++) { traceAt(s, T, x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n); if (T.i >= T.n - 1) break; }
}
// (a function, so the checker does not narrow T.on across traceAt, which changes it)
const onLine = (T: Tie) => T.on;
function tieDown(s: TakeState, x: number, y: number) {
  const T = s.tie; if (!T || s.t < T.readyAt) return;
  T.fingerDown = true; T.on = false;
  traceAt(s, T, x, y);
  if (!onLine(T)) say(s, T.i === 0 ? '由「起」嗰點開始' : '返去發光嗰點接住', '#ffb347');
}
function tieMove(s: TakeState, x0: number, y0: number, x1: number, y1: number) {
  const T = s.tie; if (!T || T.fx >= 0) return;
  const i0 = T.i; traceMove(s, T, x0, y0, x1, y1);
  if (T.i > i0) {
    T.rustle += (T.i - i0) * TUNE.trace.step; if (T.rustle > TUNE.trace.rustleEvery) { T.rustle = 0; sfx(s, 'rustle'); }
    const p = tieAt(T, T.i); push(s, { seq: ++s.fxSeq, kind: 'trail', x: p[0] / s.view.S, y: p[1] / s.view.S, p: 0.5 });
  }
  if (T.i >= T.n - 1) finishTie(s);
}
function finishTie(s: TakeState) {
  const T = s.tie; if (!T) return;
  T.time = s.t - T.readyAt; T.fx = 0; s.phase = 'fx'; sfx(s, 'whoosh');
  s.ties.push({ time: T.time, par: T.par, len: T.len, name: T.name, fam: T.fam, offs: T.offs, tier: T.tier, pat: T.pat });
}
function popKnot(s: TakeState) {
  const T = s.tie; if (!T) return;
  const K = knotPt(s); T.popped = true; sfx(s, 'pop');
  push(s, { seq: ++s.fxSeq, kind: 'pop', x: K.x, y: K.y });
}

/* ---------- hand-over ---------- */
function handTo(s: TakeState, o: Order, slot: number, rng: Rng): Res | null {
  const a = active(s);
  if (o !== a) { s.bag.wrongHand++; say(s, o.who === 'rider' ? '外賣仔：唔係我㗎！' : '客：我唔係叫呢個喎', '#ff8a5a'); sfx(s, 'bang'); o.huff = 0.6; return null; }
  const r = judge(s, o, rng); o.done = true; s.results.push(r);
  s.leaving.push({ no: o.no, seed: o.seed, who: o.who, slot, t: 0, stars: r.stars, quote: r.quote });
  sfx(s, 'chime', Math.max(1, r.stars));
  s.bag = newBag(); s.tie = null; s.phase = 'pack';
  return { kind: 'packed', at: s.t, gid: o.gid, no: o.no, stars: r.stars, tip: r.tip, why: r.why, tie: r.tie, par: r.par };
}
export const WHY: Record<string, string> = { wrongItem: '執錯咗第張單啲嘢', miss_cut: '漏餐具', miss_nap: '漏紙巾', miss_str: '漏飲管', miss_sug: '漏糖包', miss_syr: '漏西多士糖漿', spill: '飯盒壓住飲品／菠蘿油', slowTie: '綁袋慢過標準一倍',
  late: '客等過咗耐性', wrongHand: '交錯人', over: '畀多咗嘢', sugarNo: '走甜都畀糖包', undone: '收工仲未交嘅單' };
/** The prototype's judge: stars, tip, the reasons and the customer's line, for the bag in hand given to order o. */
export function judge(s: TakeState, o: Order, rng: Rng): Verdict {
  const b = s.bag, need = needEx(o), T = s.tie, why: string[] = [], q: string[] = [], wait = s.t - o.t0;
  const tTime = T ? T.time : 0, tPar = T ? T.par : 0;
  let stars = 3;
  const wrong = b.items.filter(x => x.wrong).length;
  if (wrong) { stars--; why.push('wrongItem'); q.push('呢個唔係我叫嘅！'); }
  const miss = EXK.filter(k => b.ex[k] < need[k]);
  if (miss.length) {
    stars--; miss.forEach(k => why.push('miss_' + k));
    const k = miss[0];
    q.push(k === 'cut' ? (b.ex.cut ? `我哋${PPL[o.people] ?? ''}得${b.ex.cut}套餐具？` : '冇餐具點食呀？') : k === 'nap' ? '紙巾都冇張…' : k === 'str' ? '凍飲冇飲管點飲呀？'
      : k === 'sug' ? '冇糖包，杯熱飲點飲呀？' : '西多士冇糖漿㗎？');
  }
  const over = EXK.filter(k => b.ex[k] > need[k]);
  if (over.includes('sug') && o.items.some(i => i.kind === 'drink' && i.hot && i.mod === '走甜')) { stars--; why.push('sugarNo'); q.push('我話咗走甜㗎喎！'); }
  else if (over.length) why.push('over');
  if (b.spills) { stars--; why.push('spill'); q.push(b.items.some(x => x.squashed && x.it.kind === 'drink') ? '杯嘢瀉晒落個飯度！' : '個菠蘿油扁晒…'); }
  if (tTime > tPar * TUNE.slowTie) { stars--; why.push('slowTie'); q.push('綁個袋都綁咁耐…'); }
  if (wait > o.pat) { stars--; why.push('late'); q.push(o.who === 'rider' ? '等到我單單遲晒！' : '等咗好耐呀！'); }
  if (b.wrongHand) why.push('wrongHand');
  stars = Math.max(0, stars);
  let tip = TUNE.tip.base * stars / 3 + TUNE.tip.tie * clamp(tPar / Math.max(0.1, tTime) - 0.6, 0, 1) + TUNE.tip.wait * clamp(1 - wait / o.pat, 0, 1)
    - TUNE.tip.over * over.length - TUNE.tip.wrongHand * b.wrongHand;
  tip = Math.max(0, Math.round(tip * 10) / 10);
  if (stars === 3) q.push(tTime < tPar * 0.7 ? '嘩，綁得咁快！' : pick(rng, ['好快手！', '啱晒，唔該！', '個結好企理', '多謝晒！']));
  for (const w of why) s.why[w] = (s.why[w] ?? 0) + 1;
  const quote = q[0] ?? '';
  s.tips += tip; s.quotes.push({ no: o.no, text: quote, bad: stars < 3 });
  return { no: o.no, gid: o.gid, stars, tip, why, quote, tie: tTime, par: tPar };
}

/* ---------- the shift ---------- */
function tick(s: TakeState, dt: number, rng: Rng): Res[] {
  const out: Res[] = [];
  if (s.over) return out;
  s.t += dt;
  if (s.mode === 'shift') {
    // new slips
    const pending = s.orders.filter(o => !o.done).length;
    if (s.selfFeed && s.t >= s.nextAt && s.t < TUNE.shift - TUNE.lastOrder && pending < TUNE.maxOrders) {
      s.no += 1 + Math.floor(rng.next() * 3); const o = makeOrder(s, rng, s.no); s.orders.push(o);
      scheduleItems(s, rng, o);
      s.nextAt = s.t + df(s).slipGap * rnd(rng, 0.8, 1.2) * (s.orders.length === 1 ? 0.45 : 1); sfx(s, 'slip');
      say(s, `#${o.no} ${o.who === 'rider' ? '外賣' : '自取'}`, '#ffe9a8');
    }
    // items land on the counter
    s.incoming.sort((a, b) => a.at - b.at);
    for (let k = 0; k < s.incoming.length; k++) {
      const inc = s.incoming[k]; if (!inc || inc.at > s.t) break;
      const free = s.counter.findIndex(c => !c); if (free < 0) break;
      s.counter[free] = { id: inc.id, enter: 0.25, back: 0 }; s.incoming.splice(k, 1); k--;
    }
    for (const c of s.counter) if (c) { if (c.enter > 0) c.enter = Math.max(0, c.enter - dt); if (c.back > 0) c.back = Math.max(0, c.back - dt); }
    for (const o of s.orders) if (o.huff > 0) o.huff -= dt;
    if (s.selfFeed && s.t >= TUNE.shift && s.phase === 'pack' && !s.drag) out.push(endShift(s));
    // the last slip is out and handed over: no need to stand about until the bell
    else if (s.selfFeed && s.t >= TUNE.shift - TUNE.lastOrder && s.orders.length && !s.orders.some(o => !o.done) && s.phase === 'pack') out.push(endShift(s));
  }
  if (s.phase === 'fx' && s.tie) {
    const T = s.tie, X = TUNE.fx; T.fx += dt;
    if (!T.popped && T.fx >= X.hand + X.cinch) popKnot(s);
    if (T.fx >= X.hand + X.cinch + X.hold) {
      if (s.mode === 'drill') { s.drillN++; s.phase = 'drillRes'; s.drillWait = 0.8; }
      else s.phase = 'hand';
    }
  }
  if (s.phase === 'drillRes') { s.drillWait -= dt; if (s.drillWait <= 0) startTie(s); }
  for (const f of s.flights) f.t += dt; s.flights = s.flights.filter(f => f.t < 0.3);
  for (const l of s.leaving) l.t += dt; s.leaving = s.leaving.filter(l => l.t < 1.6);
  for (const m of s.msgs) m.t += dt; s.msgs = s.msgs.filter(m => m.t < 1.3);
  if (s.orders.some(o => !o.done) || s.phase !== 'pack' || s.mode === 'drill') s.idleSince = s.t;
  return out;
}
function endShift(s: TakeState): Res {
  s.over = true; s.f.down = false; s.drag = null;
  const undone = s.orders.filter(o => !o.done).length; if (undone) s.why['undone'] = undone;
  const res = s.results, n = res.length, stars = res.reduce((a, r) => a + r.stars, 0), max = (n + undone) * 3;
  const avgStars = max ? 3 * stars / max : 0, big = Math.round(avgStars);
  const ties = s.ties, avgTie = ties.length ? ties.reduce((a, t) => a + t.time, 0) / ties.length : 0, avgPar = ties.length ? ties.reduce((a, t) => a + t.par, 0) / ties.length : 0;
  const fastest = ties.length ? Math.min(...ties.map(t => t.time)) : 0, offs = ties.reduce((a, t) => a + t.offs, 0);
  const score = Math.round(s.tips * 10) / 10;
  const verdict = !n ? '一單都未交…' : big === 3 ? '又快又啱，外賣部靠晒你！' : big === 2 ? '幾好，執漏少少就得' : big === 1 ? '啲客唔多開心' : '要再練吓';
  const quotes = s.quotes.slice().sort((a, b) => Number(b.bad) - Number(a.bad)).slice(0, 5).map(q => `#${q.no}：「${q.text}」`);
  const why = Object.entries(s.why).sort((a, b) => b[1] - a[1]);
  s.end = { n, undone, stars, max, big, avgTie, avgPar, fastest, offs, score, verdict, quotes, why };
  return { kind: 'shiftEnd', at: s.t, tips: score, handed: n, undone, stars: big };
}

/* ---------- referee work (the seam) ---------- */
/**
 * Events the station takes:
 * - `bag { gid, items, people?, who?, no?, patience?, ready? }`: a takeaway bag to pack (a shop takeaway order or a
 *   walk-in). `items`: slip names (see itemOf). people (default 1) sets the cutlery and napkins; who 'rider' | 'walk'
 *   (default 'walk'); no: the slip number (default the station's own count); patience: s before the wait costs a star
 *   (default the difficulty's); ready: the items are already made, so they land on the counter as in the prototype.
 *   An item may also be a spec `{ n, kind, hot?, mod?, syrup? }` (the shop's own menu, whose names itemOf does not know).
 *   Without ready, each item lands when the referee sends `item`. A gid is taken once.
 * - `item { gid, i }`: item i of that bag is made and lands on the counter (also after a `remake`).
 * - `cancel { gid }`: the bag is gone (another driver finished it, or the order was voided).
 * - `selfFeed { on }`: switch the station's own slips on or off (the standalone page leaves it on).
 */
function onEvent(s: TakeState, ev: RefEvent, rng: Rng) {
  if (ev.kind === 'bag') {
    const gid = ev['gid'], names = ev['items'];
    if (typeof gid !== 'number' || !Array.isArray(names) || !names.length || s.orders.some(o => o.gid === gid)) return;
    const no = typeof ev['no'] === 'number' ? ev['no'] : (s.no += 1 + Math.floor(rng.next() * 3));
    const items: Item[] = [];
    for (const n of names) { const it = typeof n === 'string' ? itemOf(n, s.uid, no) : itemSpec(n, s.uid, no); if (!it) return; s.uid++; items.push(it); }
    const d = df(s), people = typeof ev['people'] === 'number' ? clamp(Math.round(ev['people']), 1, PPL.length - 1) : 1;
    const pat = typeof ev['patience'] === 'number' && ev['patience'] > 0 ? ev['patience'] : d.patience + d.perItem * items.length;
    const o: Order = { no, gid, t0: s.t, people, items, who: ev['who'] === 'rider' ? 'rider' : 'walk', seed: Math.floor(rng.next() * 1e6), pat, done: false, huff: 0 };
    s.orders.push(o); sfx(s, 'slip'); say(s, `#${o.no} ${o.who === 'rider' ? '外賣' : '自取'}`, '#ffe9a8');
    if (ev['ready'] === true) scheduleItems(s, rng, o);
  } else if (ev.kind === 'item') {
    const o = s.orders.find(q => q.gid === ev['gid'] && !q.done), i = ev['i'], it = o && typeof i === 'number' ? o.items[i] : undefined;
    if (!it || it.packed || s.incoming.some(c => c.id === it.id) || s.counter.some(c => c?.id === it.id)) return;
    s.incoming.push({ id: it.id, at: s.t });
  } else if (ev.kind === 'cancel') {
    const o = s.orders.find(q => q.gid === ev['gid'] && !q.done); if (!o) return;
    const was = o === active(s), ids = new Set(o.items.map(it => it.id));
    s.orders.splice(s.orders.indexOf(o), 1);
    s.incoming = s.incoming.filter(c => !ids.has(c.id));
    s.counter = s.counter.map(c => c && ids.has(c.id) ? null : c);
    if (s.drag?.kind === 'item' && ids.has(s.drag.id)) s.drag = null;
    if (was) { s.bag = newBag(); s.tie = null; s.phase = 'pack'; if (s.drag?.kind === 'bag') s.drag = null; }
  } else if (ev.kind === 'selfFeed') {
    s.selfFeed = ev['on'] === true;
  }
}

/* ---------- commands ---------- */
function command(s: TakeState, cmd: TakeCmd, rng: Rng): Res[] {
  switch (cmd.k) {
    case 'view': s.view = { LW: Math.max(1, Math.floor(cmd.LW)), LH: Math.max(1, Math.floor(cmd.LH)), S: cmd.S }; return [];
    case 'cancel': s.f.down = false; s.drag = null; return [];   // the page went to the background: nothing is dropped
    case 'down': return pdown(s, cmd);
    case 'move': pmove(s, cmd); return [];
    case 'up': return pup(s, rng);
  }
}

export function status(s: TakeState): StationStatus {
  const waiting = s.orders.filter(o => !o.done).length;
  return { waiting, idleFor: Math.max(0, s.t - s.idleSince), load: Math.min(1, waiting / TUNE.maxOrders) };
}

/* ---------- hand-over check ---------- */
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isLists = (x: unknown) => isObj(x) && Object.values(x).every(a => Array.isArray(a) && a.every(n => Number.isInteger(n)));
const isKb = (x: unknown) => isObj(x) && typeof x['fam'] === 'string' && isLists(x['bags']) && isLists(x['recent']);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isArr = (x: unknown, f: (y: unknown) => boolean) => Array.isArray(x) && x.every(f);
const isEx = (x: unknown) => isObj(x) && EXK.every(k => isNum(x[k]));
const isExK = (x: unknown) => EXK.some(k => k === x);
const isRect = (x: unknown) => isObj(x) && isNum(x['x']) && isNum(x['y']) && isNum(x['w']) && isNum(x['h']);
function isItem(x: unknown): boolean {
  return isObj(x) && isNum(x['id']) && isNum(x['no']) && typeof x['name'] === 'string' && (x['kind'] === 'box' || x['kind'] === 'soft' || x['kind'] === 'drink')
    && typeof x['col'] === 'string' && typeof x['syrup'] === 'boolean' && typeof x['hot'] === 'boolean' && typeof x['mod'] === 'string' && typeof x['packed'] === 'boolean';
}
function isOrder(x: unknown): boolean {
  return isObj(x) && ['no', 'gid', 't0', 'people', 'seed', 'pat', 'huff'].every(k => isNum(x[k])) && isArr(x['items'], isItem) && (x['who'] === 'rider' || x['who'] === 'walk') && typeof x['done'] === 'boolean';
}
function isTie(x: unknown): boolean {
  return isObj(x) && isRect(x['R']) && typeof x['fam'] === 'string' && typeof x['name'] === 'string'
    && ['tier', 'pat', 'seed', 'par', 'len', 'n', 'i', 'offs', 'gain', 'readyAt', 'startT', 'fx', 'time', 'dist', 'rustle', 'offT'].every(k => isNum(x[k]))
    && ['on', 'touched', 'popped', 'fingerDown'].every(k => typeof x[k] === 'boolean');
}
const isCell = (x: unknown) => x === null || (isObj(x) && isNum(x['id']) && isNum(x['enter']) && isNum(x['back']));
const isDrag = (x: unknown) => x === null || (isObj(x) && (x['kind'] === 'bag' || (x['kind'] === 'item' && isNum(x['slot']) && isNum(x['id']))));
/** Checks a hand-over value before it is used (shape and types of everything the logic reads). */
export function validate(x: unknown): x is TakeState {
  if (!isObj(x) || x['v'] !== 1) return false;
  const d = x['diff'], view = x['view'], f = x['f'], ai = x['ai'], bag = x['bag'];
  return (d === 'rookie' || d === 'pro' || d === 'ace') && typeof x['selfFeed'] === 'boolean' && (x['mode'] === 'shift' || x['mode'] === 'drill')
    && isObj(view) && isNum(view['LW']) && isNum(view['LH']) && isNum(view['S'])
    && ['t', 'no', 'nextAt', 'uid', 'gidN', 'tips', 'drillN', 'drillWait', 'fxSeq', 'idleSince', 'knot'].every(k => isNum(x[k]))
    && ['pack', 'tie', 'fx', 'hand', 'drillRes'].includes(String(x['phase']))
    && isArr(x['orders'], isOrder) && isArr(x['counter'], isCell) && isArr(x['incoming'], i => isObj(i) && isNum(i['id']) && isNum(i['at']))
    && isObj(bag) && isArr(bag['items'], i => isObj(i) && isItem(i['it']) && typeof i['wrong'] === 'boolean' && typeof i['squashed'] === 'boolean')
    && isEx(bag['ex']) && isArr(bag['log'], isExK) && isNum(bag['spills']) && isNum(bag['wrongHand'])
    && (x['tie'] === null || isTie(x['tie'])) && isDrag(x['drag']) && (x['kb'] === undefined || isKb(x['kb']))
    && ['results', 'quotes', 'ties', 'msgs', 'flights', 'leaving', 'fx'].every(k => isArr(x[k], isObj)) && isObj(x['why'])
    && typeof x['over'] === 'boolean'
    && isObj(f) && typeof f['down'] === 'boolean' && ['x', 'y', 'lx', 'ly', 'px', 'py', 'vx', 'vy', 'ms'].every(k => isNum(f[k]))
    && isObj(ai) && isNum(ai['at']) && isNum(ai['ti']) && Array.isArray(ai['steps']);
}

export interface TakeOpts { selfFeed: boolean; drill?: boolean }
export type TakeModule = StationModule<TakeState, TakeCmd, TakeResult>;
/** The first slip number of a run, the prototype's 10 + 0..29, from the shift seed. */
const firstNo = (seed: number) => 10 + (Math.abs(Math.floor(seed)) % 30);
/** The station. `selfFeed`: the station prints its own slips, as the prototype does. `drill`: the prototype's 淨係練綁袋, ties only. */
export function takeawayStation(opts: TakeOpts, bot: BotModule<TakeState, TakeCmd>): TakeModule {
  return {
    kind: 'takeaway',
    init: (cfg: ShiftConfig) => newRun(cfg.difficulty, opts.selfFeed && !opts.drill, opts.drill ? 'drill' : 'shift', firstNo(cfg.seed)),
    command: (s, cmd, ctx: StationCtx) => command(s, cmd, ctx.rng),
    step: (s, dt, ctx) => tick(s, dt, ctx.rng),
    onEvent: (s, ev, ctx) => { onEvent(s, ev, ctx.rng); },
    status: (s) => status(s),
    bot,
    validate,
  };
}
