// 燒味 roast-meat counter: the station core, ported 1:1 from the playtested original prototype of the station.
// Pure (src/stations-next/contract.ts rules): no DOM, timers, clocks or Math.random. Time comes in as `dt`,
// randomness from `ctx.rng`, and the whole state is plain JSON so a seat can be handed to another driver by value.
//
// Input is the prototype's own gesture code fed with pointer commands (down / move / up / cancel) in logical px (the 130 x 250
// design's units) plus the css px the prototype measures taps and swipes in, so the strict gestures stay exactly as playtested.
// The layout the hit tests use is a pure function of the view size (`view` command), kept in the state.
//
// Work: with `selfFeed` on (the standalone page) the station makes its own customers as the original prototype does. The referee
// turns it off and feeds the queue with `order` events instead (shop lines with dest 'roast', 斬料 walk-ins), and takes
// the plates back as `lineDone` results.
import type { BotModule, Difficulty, Rng, RefEvent, ShiftConfig, StationCtx, StationModule, StationStatus } from '../contract';

/* ======================= TUNING KNOBS (the prototype's TUNE, verbatim) ======================= */
export const TUNE = {
  shift: 150,                                   // seconds in a run
  queueMax: 3,                                  // customers waiting at the counter at most
  firstArrivals: [0, 7],                        // s: the first two customers walk in at these times
  emptyWait: 5,                                 // s: with nobody at the counter the next customer comes within this
  diff: {
    // the ticket always lists every step and the next-step line always shows (no memory test, only quick hands);
    // hints: the roast to pull blinks on the rail. patience: s a customer waits; arrive: s between arrivals (the prototype's);
    // tier: the 斬料 cutting tier (TUNE.cut; a level sets its own)
    rookie: { name: '新人', hints: true, patience: 85, arrive: 24, tier: 0, help: '虛線成條，斬錯少少都會黐返落線；要拉嗰款燒味會閃' },
    pro: { name: '熟手', hints: true, patience: 66, arrive: 19, tier: 1, help: '件數多啲，要斬得準啲' },
    ace: { name: '阿姐', hints: false, patience: 52, arrive: 15, tier: 2, help: '件數再多，虛線得頂頭一截，燒味唔會閃' },
  },
  // meat on the board: w = ideal piece width (logical px; x3 css px on an iPhone), h = thickness drawn
  meat: { char: { w: 12, h: 22 }, pork: { w: 12, h: 24 }, duck: { w: 14, h: 26 }, chick: { w: 14, h: 24 } },
  // 斬料 by cutting tier (0 = level 1 / 新人 .. 3 = 修羅場):
  //   pieces: per order (one: a single roast per meat; two / three: each meat of a 雙拼 / 三拼) = cuts on the guides
  //   snap: a cut this close to a guide (share of the piece width) lands ON the guide: even pieces, a clean cut
  //   guide: how the cut lines show ('full' dashed, 'short' dashes at the top, 'none': bone-in keeps its joint ticks)
  // Bone-in roasts (燒鴨 油雞) have a joint on every guide: a cut off the guide splinters the bone.
  cut: {
    pieces: [
      { one: { char: 6, pork: 6, duck: 5, chick: 5 }, two: 4, three: 3 },
      { one: { char: 7, pork: 7, duck: 6, chick: 6 }, two: 5, three: 3 },
      { one: { char: 8, pork: 8, duck: 7, chick: 7 }, two: 6, three: 4 },
      { one: { char: 10, pork: 10, duck: 8, chick: 8 }, two: 6, three: 4 },
    ],
    snap: [0.42, 0.34, 0.27, 0.2],
    guide: ['full', 'full', 'short', 'none'],
    maxPieces: 12,                              // the 試玩 slider's extra pieces stop here
    cover: 0.4,                                 // a cut this close to a guide (share of the piece width) uses it up: a near miss is its cut, off
  },
  // When more pieces would not fit the board, each is narrower: a meat's wanted length is at most boardLen logical px
  boardLen: 76,
  trace: { startBand: 0.45, gap: 4, tol: 5 },   // 叉燒: start in the top 45% of the strip; frontier within gap; stay within tol px of the line
  minPiece: 2.5,                                // logical px: thinner than this is refused (太薄)
  leftover: 16,                                // logical px of roast past the last wanted piece: the end that hangs back on the rail
  restBack: 0.5,                                // s the leftover takes to fly back up onto its hook
  tap: { move: 14, time: 0.45 },                // a press that moves < move css px and lifts within time s is a tap (a chop has no time limit)
  wrongLock: 1.3,                               // s the rail is busy hanging a wrong roast back
  soy: { time: 1.6, lo: 0.42, hi: 0.85, over: 1.2 }, // hold time for 1.0 soy; ok band lo..hi; at over it floods
  swipe: 45,                                    // css px up (serve) or down (dump) from the plate
  amount: { lo: 0.85, hi: 1.18 },               // meat taken / portion: below lo stingy, above hi a loss for the boss
  even: { ok: 0.09, k: 140, cap: 30 },          // evenness: penalty = (cv - ok) * k, capped (cv = std / mean of widths)
  pen: { missing: 45, perPiece: 8, stingy: 90, over: 60, splinter: 7, ragged: 5, extra: 15, mixed: 10, base: 25, flood: 35,
    noSoy: 12, lowSoy: 6, hiSoy: 10, soyNoodle: 10, ginger: 12, noGinger: 3, veg: 15, noVeg: 5,
    noSoup: 30, soupMore: 10, noScal: 10, late: 8 },  // noodles: no soup, each extra ladle, no 蔥花, soup or 蔥花 put on after the meat
  stars: [45, 70, 88],                          // order quality for 1 / 2 / 3 stars
  tipMax: 12, leaveCost: 20, dumpCost: 8,       // $: tip for a fast 2+ star order; a customer walking out; tipping a plate
  lossK: 0.4,                                   // $ lost per order = (amount - 1) * price * lossK when over-portioned
  vegPrice: 8,
  payCurve: 1.5,                                // pay = price x (quality / 100) ^ payCurve: above 1, sloppy plates pay less than in proportion
} as const;
/* ======================================================================================== */

export type MeatK = 'char' | 'pork' | 'duck' | 'chick';
export type BaseK = 'rice' | 'lai' | 'mai' | 'ho';
export const MEAT: Record<MeatK, { name: string; bone: boolean }> = {
  char: { name: '叉燒', bone: false },
  pork: { name: '燒肉', bone: false },
  duck: { name: '燒鴨', bone: true },
  chick: { name: '油雞', bone: true },
};
export const RAIL: readonly MeatK[] = ['char', 'pork', 'duck', 'chick'];
export const BASES: readonly BaseK[] = ['rice', 'lai', 'mai', 'ho'];
export const BASE: Record<BaseK, { name: string; soup: boolean }> = {
  rice: { name: '白飯', soup: false }, lai: { name: '瀨粉', soup: true }, mai: { name: '米粉', soup: true }, ho: { name: '河粉', soup: true },
};
export interface MenuItem { name: string; meats: readonly MeatK[]; base: BaseK; price: number; w: number }
export const MENU: readonly MenuItem[] = [
  { name: '叉燒飯', meats: ['char'], base: 'rice', price: 42, w: 3 },
  { name: '燒肉飯', meats: ['pork'], base: 'rice', price: 42, w: 2 },
  { name: '燒鴨飯', meats: ['duck'], base: 'rice', price: 46, w: 2 },
  { name: '油雞飯', meats: ['chick'], base: 'rice', price: 42, w: 2 },
  { name: '叉燒燒肉雙拼飯', meats: ['char', 'pork'], base: 'rice', price: 50, w: 2 },
  { name: '叉燒油雞雙拼飯', meats: ['char', 'chick'], base: 'rice', price: 50, w: 2 },
  { name: '燒鴨叉燒雙拼飯', meats: ['duck', 'char'], base: 'rice', price: 52, w: 2 },
  { name: '三寶飯', meats: ['char', 'pork', 'duck'], base: 'rice', price: 58, w: 1.5 },
  { name: '燒鴨瀨粉', meats: ['duck'], base: 'lai', price: 46, w: 2 },
  { name: '叉燒瀨粉', meats: ['char'], base: 'lai', price: 42, w: 1.5 },
  { name: '油雞瀨粉', meats: ['chick'], base: 'lai', price: 42, w: 1 },
  { name: '叉燒湯河', meats: ['char'], base: 'ho', price: 42, w: 1 },
  { name: '燒鴨湯米', meats: ['duck'], base: 'mai', price: 46, w: 1 },
  { name: '油雞湯米', meats: ['chick'], base: 'mai', price: 42, w: 1 },
  // 城寨冰室's own (kwc): only on its menu, never drawn off a level
  { name: '城寨叉燒飯', meats: ['char'], base: 'rice', price: 42, w: 0 },
];
export const DIFF = (d: Difficulty) => TUNE.diff[d];

/* ---------- state ---------- */
/** pcs: pieces wanted of each of `meats` (set by the cutting tier when the order comes in: the guides on the board). */
export interface Order { name: string; item: string; meats: MeatK[]; pcs: number[]; base: BaseK; price: number; veg: boolean; ginger: boolean }
export interface Look { hair: string; shirt: string; skin: string; bald: boolean }
/** gid / i: the referee's group id and line index (own counter when self-fed). timed: the station runs its patience. */
export interface Customer { id: number; gid: number; i: number; ord: Order; pat: number; max: number; timed: boolean; look: Look }
/** A 叉燒 cut traced part of the way down (lift the finger and press again on it to go on). */
export interface Partial { x: number; front: number; xs: number[] }
/** The roast on the board: it stays where it landed; each cut splits it where the knife lies, so the guides
 *  (x0 + i * w, i = 1..n) stay true whatever was cut before. `on`: the cuts that landed on a guide (snapped). */
export interface Board { k: MeatK; n: number; w: number; h: number; x0: number; x1: number; cuts: number[]; on: number[]; splinter: number; ragged: number; partial: Partial | null; drop: number }
export interface PlateItem { k: MeatK; widths: number[]; zone: number; splinter: number; ragged: number }
// soup: ladles of soup in the bowl; scal: 蔥花; late: soup or 蔥花 went in after the meat (the roast goes on top, last)
export interface Plate { base: BaseK | null; items: PlateItem[]; soy: number; flood: boolean; ginger: boolean; veg: boolean; mixed: number; soup: number; scal: boolean; late: number }
// slab: a press on an uncut 叉燒 below the slicing band (nothing on the lift); lift: the uncut roast carried off the board
// (a drag up from a press off the guides; dropped on the rail it hangs back on its hook)
export type Mode = 'none' | 'roast' | 'trace' | 'tap' | 'slab' | 'lift' | 'tapOrPieces' | 'pieces' | 'base' | 'soy' | 'ladle' | 'ginger' | 'scal' | 'veg' | 'plate' | 'done';
/** The finger (the prototype's F): one at a time. Logical px (x, y) and css px (cx, cy); ax..off: a 叉燒 trace in progress. */
export interface Finger {
  down: boolean; mode: Mode | null; sx: number; sy: number; x: number; y: number; cx0: number; cy0: number; t0: number; moved: number;
  k: MeatK | null; base: BaseK | null; ax: number; front: number; xs: number[]; prevOn: boolean; prevY: number; off: boolean;
}
export interface Msg { text: string; col: string; t: number; key: string }
export type SfxName = 'thunk' | 'slice' | 'sliced' | 'splinter' | 'hook' | 'plop' | 'pour' | 'pick' | 'ding' | 'combo' | 'bad' | 'leave';
/** Juice for the screen, drained by seq: sounds, particle bursts (p: chance the burst happens), shakes. */
export type Fx = { seq: number; kind: 'sfx'; name: SfxName; n: number } | { seq: number; kind: 'bits'; x: number; y: number; cols: string[]; n: number; sp: number; p: number } | { seq: number; kind: 'shake' };
export interface OrderLog { name: string; q: number; stars: number; t: number; why: string[] }
export interface Gone { c: Customer; t: number; happy: boolean; angry: string }
export interface Summary { stars: number; avg: number; even: number; why: [string, number, number][]; wrong: number }
export interface BotStep { cmd: RoastCmd; wait: number }
/** The 試玩 slider's knob: pieces added to each meat of a new order, and the snap distance's multiplier. */
export interface CutKnob { pcs: number; snap: number }
export interface RoastState {
  v: 1; diff: Difficulty; tier: number; knob: CutKnob; selfFeed: boolean; view: { LW: number; LH: number; S: number };
  t: number; q: Customer[]; orderN: number; custSeed: number; gid: number; arrivals: number[]; nextArr: number;
  board: Board | null; plate: Plate; lock: number; hangBack: { k: MeatK; x: number; y: number; t: number } | null;
  restBack: { b: Board; from: number; t: number } | null;
  score: number; earned: number; tips: number; loss: number; served: number; left: number; dumped: number; starsSum: number;
  orders: OrderLog[]; combo: number; bestCombo: number; cuts: number; cleanCuts: number; why: Record<string, { n: number; pts: number }>;
  msgs: Msg[]; flights: { plate: Plate; x: number; y: number; t: number }[]; react: { text: string; stars: number; t: number; money: number } | null;
  gone: Gone[]; chop: { x: number; t: number } | null; over: boolean; end: Summary | null; lastPour: number; lastSlice: number;
  /** ai.aim: the spread (logical px, one SD) of the driver's aim at a guide: the computer's steady hand, or a person's in the sims */
  f: Finger; fx: Fx[]; fxSeq: number; idleSince: number; ai: { at: number; steps: BotStep[]; aim: number };
}

/* ---------- commands, events, results ---------- */
export type RoastCmd =
  | { k: 'down' | 'move' | 'up'; x: number; y: number; cx: number; cy: number }
  | { k: 'cancel' }
  | { k: 'view'; LW: number; LH: number; S: number };
/** made: the plate as built, for the referee's judge; grade: the station's own prediction (same pure function). */
export interface RoastMade { item: string; base: BaseK | null; items: { k: MeatK; widths: number[]; zone: number; splinter: number }[]; soy: number; flood: boolean; ginger: boolean; veg: boolean; soup: number; scal: boolean; late: number; mixed: number }
export type RoastResult =
  | { kind: 'lineDone'; at: number; gid: number; dest: 'roast'; i: number; made: RoastMade; q: number; stars: number; pay: number; tip: number; loss: number }
  | { kind: 'walkout'; at: number; gid: number; i: number }
  | { kind: 'dumped'; at: number; cost: number }
  | { kind: 'shiftEnd'; at: number; score: number; served: number; left: number; stars: number };

/* ---------- small helpers ---------- */
const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
const sum = (a: readonly number[]) => a.reduce((s, v) => s + v, 0);
const nz = (v: number | undefined) => v ?? 0;
const rnd = (rng: Rng, a: number, b: number) => a + rng.next() * (b - a);
function pick<T>(rng: Rng, a: readonly T[]): T {
  const v = a[Math.floor(rng.next() * a.length)] ?? a[0];
  if (v === undefined) throw new Error('pick from an empty list');
  return v;
}
/** The cutting tiers (TUNE.cut): 0 = level 1 / 新人 .. TIERS - 1 = 修羅場. */
export const TIERS = TUNE.cut.snap.length;
export const clampTier = (t: number): number => Math.max(0, Math.min(TIERS - 1, Math.round(t)));
export const NO_KNOB: CutKnob = { pcs: 0, snap: 1 };
/** Pieces of roast k for an order of `n` roasts at `tier`, plus the slider's `add` (the order keeps its own in `pcs`). */
export function portion(k: MeatK, n: number, tier = 0, add = 0): number {
  const P = TUNE.cut.pieces[clampTier(tier)] ?? TUNE.cut.pieces[0], base = n <= 1 ? P.one[k] : n === 2 ? P.two : P.three;
  return clamp(base + Math.round(add), 2, TUNE.cut.maxPieces);
}
/** The order's own piece count of roast k (fixed when the order came in). */
export function portionOf(o: Order, k: MeatK): number { return o.pcs[o.meats.indexOf(k)] ?? portion(k, o.meats.length); }
/** Ideal width (logical px) of one of n pieces of roast k: the meat's own, narrower when n pieces would not fit. */
export function pieceW(k: MeatK, n: number): number { return Math.min(TUNE.meat[k].w, TUNE.boardLen / Math.max(1, n)); }
/** How the guides show at this state's tier. */
export const guideMode = (s: RoastState): 'full' | 'short' | 'none' => TUNE.cut.guide[clampTier(s.tier)] ?? 'full';
/** Logical px within which a cut lands on a guide (the tier's share of the piece width, times the slider's knob; under half a piece). */
export const snapPx = (s: RoastState, b: Board): number => Math.min(0.48, (TUNE.cut.snap[clampTier(s.tier)] ?? 0.3) * s.knob.snap) * b.w;
const df = (s: RoastState) => TUNE.diff[s.diff];

/* ---------- layout (logical px; a 130 x 250 design, centred): a pure function of the view ---------- */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Layout {
  LW: number; LH: number; ox: number; extra: number; cust: { y: number; h: number }; ticket: Rect; rail: Rect; board: Rect;
  hooks: { k: MeatK; x: number; y: number; bot: number }[]; meatCx: number; meatCy: number; station: { y: number; h: number };
  bases: Record<BaseK, Rect>; plate: { cx: number; cy: number; rx: number; ry: number }; soy: Rect; soup: Rect; ginger: Rect; scal: Rect; veg: Rect;
}
export function layout(LW: number, LH: number): Layout {
  const ox = Math.floor((LW - 130) / 2), extra = Math.max(0, LH - 250);
  // the board gets the room (the numbered guides along its top, the roast under it); the rail with the hanging roasts less
  const rail = { x: 0, y: 52, w: LW, h: 44 + Math.round(extra * 0.2) };
  const board = { x: ox + 3, y: rail.y + rail.h + 3, w: 124, h: 68 + Math.round(extra * 0.5) };
  const sy = board.y + board.h + 3, sh = LH - sy - 2;
  const tub = (i: number) => ({ x: ox + 2 + (i % 2) * 20, y: sy + 4 + Math.floor(i / 2) * Math.round(sh / 2), w: 19, h: Math.round(sh / 2) - 6 });
  const half = Math.round(sh / 2), third = Math.round((sh - 4) / 3);
  const side = (i: number) => ({ x: ox + 111, y: sy + 4 + i * third, w: 17, h: third - 3 });   // 薑葱, 蔥花, 油菜 stacked on the right
  return {
    LW, LH, ox, extra,
    cust: { y: 0, h: 28 }, ticket: { x: 2, y: 29, w: LW - 4, h: 22 }, rail, board,
    hooks: RAIL.map((k, i) => ({ k, x: ox + 17 + i * 32, y: rail.y + 3, bot: rail.y + rail.h - 3 })),
    // the roast on the board is centred on the board: meatCx is the anchor its middle sits on
    meatCx: board.x + board.w / 2, meatCy: board.y + Math.round(board.h * 0.52),
    station: { y: sy, h: sh },
    bases: { rice: tub(0), lai: tub(1), mai: tub(2), ho: tub(3) },
    plate: { cx: ox + 67, cy: sy + Math.round(sh * 0.5), rx: 25, ry: Math.min(26, Math.round(sh * 0.36)) },
    soy: { x: ox + 96, y: sy + 4, w: 14, h: half - 6 },
    soup: { x: ox + 96, y: sy + half + 2, w: 14, h: half - 6 },
    ginger: side(0), scal: side(1), veg: side(2),
  };
}
let lyKey = '', lyVal: Layout | null = null;
/** The layout for the state's view (memoised: a cache of a pure function, not state). */
export function LY(s: RoastState): Layout {
  const key = `${s.view.LW}x${s.view.LH}`;
  if (key !== lyKey || !lyVal) { lyKey = key; lyVal = layout(s.view.LW, s.view.LH); }
  return lyVal;
}
interface Pt { x: number; y: number }
export const inR = (r: Rect, l: Pt, m = 0) => l.x >= r.x - m && l.x <= r.x + r.w + m && l.y >= r.y - m && l.y <= r.y + r.h + m;
export function onPlate(L: Layout, l: Pt, m = 4) { const p = L.plate; return ((l.x - p.cx) / (p.rx + m)) ** 2 + ((l.y - p.cy) / (p.ry + m)) ** 2 <= 1; }
function hookAt(L: Layout, l: Pt): MeatK | null { if (l.y < L.rail.y - 2 || l.y > L.rail.y + L.rail.h + 2) return null; for (const h of L.hooks) if (Math.abs(l.x - h.x) <= 15) return h.k; return null; }
function baseAt(L: Layout, l: Pt): BaseK | null { for (const k of BASES) if (inR(L.bases[k], l, 1)) return k; return null; }
export function zones(s: RoastState): number { const o = s.q[0]?.ord ?? null; return s.plate.base && BASE[s.plate.base].soup ? 1 : Math.max(o ? o.meats.length : 1, ...s.plate.items.map(i => i.zone + 1)); }
function zoneAt(s: RoastState, x: number): number { const n = zones(s), p = LY(s).plate; return clamp(Math.floor((x - (p.cx - p.rx)) / (p.rx * 2 / n)), 0, n - 1); }

/* ---------- the run ---------- */
export function newPlate(): Plate { return { base: null, items: [], soy: 0, flood: false, ginger: false, veg: false, mixed: 0, soup: 0, scal: false, late: 0 }; }
function newFinger(): Finger { return { down: false, mode: null, sx: 0, sy: 0, x: 0, y: 0, cx0: 0, cy0: 0, t0: 0, moved: 0, k: null, base: null, ax: 0, front: 0, xs: [], prevOn: false, prevY: 0, off: false }; }
/** The computer's aim when it covers a seat (logical px, one SD): a steady hand (a person's comes from the sims' human model). */
export const BOT_AIM = 0.4;
/** A phone at 390 x ~760 css px of scene: the prototype's own scale picks S = 3, 130 x 253 logical px. */
export const DEFAULT_VIEW = { LW: 130, LH: 253, S: 3 };
export function newRun(diff: Difficulty, selfFeed: boolean, view = DEFAULT_VIEW): RoastState {
  return {
    v: 1, diff, tier: TUNE.diff[diff].tier, knob: { ...NO_KNOB }, selfFeed, view: { ...view },
    t: 0, q: [], orderN: 0, custSeed: 1, gid: 1, arrivals: selfFeed ? [...TUNE.firstArrivals] : [], nextArr: 999, board: null, plate: newPlate(), lock: 0, hangBack: null, restBack: null,
    score: 0, earned: 0, tips: 0, loss: 0, served: 0, left: 0, dumped: 0, starsSum: 0, orders: [], combo: 0, bestCombo: 0, cuts: 0, cleanCuts: 0,
    why: {}, msgs: [], flights: [], react: null, gone: [], chop: null, over: false, end: null, lastPour: 0, lastSlice: 0,
    f: newFinger(), fx: [], fxSeq: 0, idleSince: 0, ai: { at: 0, steps: [], aim: BOT_AIM },
  };
}
function mkOrder(rng: Rng, i: number, tier: number, add: number): Order {
  let m: MenuItem;
  if (i === 0) m = pick(rng, MENU.slice(0, 1));                         // the first one is always a plain 叉燒飯
  else if (i === 1) m = pick(rng, MENU.slice(1, 4));
  else { const tot = sum(MENU.map(x => x.w)); let r = rng.next() * tot; m = MENU.find(x => (r -= x.w) < 0) ?? pick(rng, MENU.slice(0, 1)); }
  const veg = i >= 2 && rng.next() < 0.3;
  return orderOf(m, veg, tier, add);
}
function orderOf(m: MenuItem, veg: boolean, tier: number, add: number): Order {
  return { name: m.name + (veg ? '跟油菜' : ''), item: m.name, meats: [...m.meats], pcs: m.meats.map(k => portion(k, m.meats.length, tier, add)), base: m.base, veg, price: m.price + (veg ? TUNE.vegPrice : 0), ginger: m.meats.includes('chick') };
}
function mkLook(rng: Rng): Look {
  return { hair: pick(rng, ['#1c1410', '#3a2a1a', '#6a6a6a', '#2a1a2a']), shirt: pick(rng, ['#5f7fd0', '#c8323c', '#2a8b67', '#cf861a', '#8a5ab0', '#e6e0d0']), skin: pick(rng, ['#f0c8a0', '#e0b088', '#f4d4b0']), bald: rng.next() < 0.2 };
}
function mkCustomer(s: RoastState, rng: Rng): Customer {
  const i = s.orderN++, ord = mkOrder(rng, i, s.tier, s.knob.pcs), pat = df(s).patience;
  return { id: s.custSeed++, gid: s.gid++, i: 0, ord, pat, max: pat, timed: true, look: mkLook(rng) };
}

/* ---------- juice (kept as data; the screen plays it) ---------- */
function say(s: RoastState, text: string, col: string, dur = 0, key = '') {
  if (key) s.msgs = s.msgs.filter(m => m.key !== key); else if (s.msgs.some(m => m.text === text && m.t < 0.6)) return;
  s.msgs.push({ text, col, t: -dur, key }); if (s.msgs.length > 2) s.msgs.shift();
}
function sfx(s: RoastState, name: SfxName, n = 0) { s.fx.push({ seq: ++s.fxSeq, kind: 'sfx', name, n }); trimFx(s); }
function bits(s: RoastState, x: number, y: number, cols: string[], n: number, sp: number, p = 1) { s.fx.push({ seq: ++s.fxSeq, kind: 'bits', x, y, cols, n, sp, p }); trimFx(s); }
function shake(s: RoastState) { s.fx.push({ seq: ++s.fxSeq, kind: 'shake' }); trimFx(s); }
function trimFx(s: RoastState) { if (s.fx.length > 40) s.fx.splice(0, s.fx.length - 40); }
function tally(s: RoastState, _tag: string, pts: number, t: string) { const w = s.why[t] ?? (s.why[t] = { n: 0, pts: 0 }); w.n++; w.pts += pts; }

/* ---------- the board (cutting along the guides) ---------- */
function newBoard(s: RoastState, k: MeatK): Board {
  const o = s.q[0]?.ord ?? null, n = o?.meats.includes(k) ? portionOf(o, k) : portion(k, 1, s.tier, s.knob.pcs);
  const m = TUNE.meat[k], w = pieceW(k, n), x0 = slabX0(s, n, w);
  return { k, n, w, h: m.h, x0, x1: x0 + n * w + TUNE.leftover, cuts: [], on: [], splinter: 0, ragged: 0, partial: null, drop: 0.25 };
}
/** Where an uncut roast of n pieces of width w starts: the whole roast (the pieces and the end that goes back) centred on the board. */
const slabX0 = (s: RoastState, n: number, w: number) => Math.round(LY(s).meatCx - (n * w + TUNE.leftover) / 2);
export const lastCut = (b: Board) => b.cuts.length ? nz(b.cuts[b.cuts.length - 1]) : b.x0;
// the guides: exactly n of them, so the n pieces wanted lie between the roast's left end and the n-th guide. The roast
// never moves on the board, so they stay where they are whatever has been cut
export const guides = (b: Board) => { const g: number[] = []; for (let i = 1; i <= b.n; i++) g.push(b.x0 + i * b.w); return g; };
// bone-in roasts have a joint every piece width along the whole roast: the guides are joints
const joints = (b: Board) => { const g: number[] = []; for (let i = 1; b.x0 + i * b.w < b.x1 - 3; i++) g.push(b.x0 + i * b.w); return g; };
/**
 * A guide counts as cut once a cut lies this close: a near miss is that guide's cut, just off (uneven pieces, not an
 * extra one); only a cut well between two guides leaves both to cut. Never closer than the snap or a too-thin piece.
 */
const coverPx = (s: RoastState, b: Board) => Math.max(snapPx(s, b), TUNE.cut.cover * b.w, TUNE.minPiece + 0.5);
/** The guides not cut yet, left to right. */
export const uncut = (s: RoastState, b: Board) => { const r = coverPx(s, b); return guides(b).filter(g => !b.cuts.some(c => Math.abs(c - g) <= r + 1e-6)); };
/** Every guide is cut: the pieces are ready to go on the plate. */
export const boardDone = (s: RoastState, b: Board) => uncut(s, b).length === 0;
/** The uncut guide a cut at x lands on (within the snap distance), or null. */
function snapTo(s: RoastState, b: Board, x: number): number | null {
  const r = snapPx(s, b);
  let best: number | null = null;
  for (const g of uncut(s, b)) if (Math.abs(g - x) <= r + 1e-6 && (best === null || Math.abs(g - x) < Math.abs(best - x))) best = g;
  return best;
}
// a portion change for the front customer (the one before walked out) re-marks an uncut roast
function syncBoard(s: RoastState) {
  const b = s.board, o = s.q[0]?.ord ?? null;
  if (!b || b.cuts.length || b.partial || !o?.meats.includes(b.k)) return;
  const n = portionOf(o, b.k);
  if (n !== b.n) { b.n = n; b.w = pieceW(b.k, n); b.x0 = slabX0(s, n, b.w); b.x1 = b.x0 + n * b.w + TUNE.leftover; }
}
// the numbers on the board: 1..n on the guides (a number marks where the knife goes, so "chop 1, 2, 3, 4" means
// chop on the guides; none at the top tier, which has no guides); cut: that guide is done. rest: the leftover end past the
// n-th guide (or past the last cut) that goes back onto the rail
export function boardMarks(s: RoastState, b: Board): { nums: { x: number; n: number; cut: boolean }[]; rest: { x0: number; x1: number } | null } {
  const left = uncut(s, b), nums = guideMode(s) === 'none' ? [] : guides(b).map((x, i) => ({ x, n: i + 1, cut: !left.includes(x) }));
  const r0 = Math.max(lastCut(b), ...left);
  return { nums, rest: guideMode(s) !== 'none' || b.cuts.length ? { x0: r0, x1: b.x1 } : null };
}
export function widths(b: Board): number[] { const w: number[] = []; let p = b.x0; for (const c of b.cuts) { w.push(c - p); p = c; } return w; }
/**
 * A cut at x. Within the snap distance of a guide not cut yet it lands ON the guide: an even piece, a clean cut that keeps
 * the combo going. Elsewhere the knife falls where it fell: the pieces come out uneven (an extra piece if it was between
 * guides), and on a bone-in roast a cut off a joint splinters the bone. Cuts may come in any order (some players cut from
 * the right); the roast stays put, so the guides left stay true.
 */
function cutAt(s: RoastState, b: Board, x0: number, how: 'trace' | 'chop'): boolean {
  const g = snapTo(s, b, x0), x = g ?? x0;
  const i = b.cuts.findIndex(c => c > x), L = i < 0 ? lastCut(b) : (i > 0 ? nz(b.cuts[i - 1]) : b.x0), R = i < 0 ? null : nz(b.cuts[i]);
  if (x <= L + TUNE.minPiece || (R !== null && x >= R - TUNE.minPiece)) { say(s, '太薄！', '#ffb347'); sfx(s, 'bad'); return false; }
  if (x >= b.x1 - 2) { say(s, '切到尾喇', '#ffb347'); return false; }
  b.cuts.splice(i < 0 ? b.cuts.length : i, 0, x); s.cuts++;
  const cy = LY(s).meatCy, bone = MEAT[b.k].bone;
  if (g !== null) {
    b.on.push(x);
    s.combo++; s.cleanCuts++; s.bestCombo = Math.max(s.bestCombo, s.combo);
    if (s.combo >= 3) { say(s, `爽手 x${s.combo}`, '#7be08f', 0, 'combo'); sfx(s, 'combo', s.combo); }
    else say(s, '準！', '#7be08f', 0, 'cut');
  } else {
    if (s.combo >= 3) say(s, '斷咗', '#ffb347');
    s.combo = 0;
    if (bone && !joints(b).some(j => Math.abs(j - x) <= snapPx(s, b))) {
      b.splinter++; say(s, '斬歪咗骨位，骨碎！要斬喺虛線', '#ff8a5a', 0, 'cut'); sfx(s, 'splinter'); bits(s, x, cy, ['#f2ead8', '#ffffff', '#d8cdb0'], 10, 50);
    } else say(s, '歪咗，唔喺線上', '#ffb347', 0, 'cut');
  }
  if (how === 'trace') { sfx(s, 'sliced', b.cuts.length); bits(s, x, cy - b.h / 2, ['#e89a8a', '#9e2a22'], 4, 20); }
  else { sfx(s, 'thunk'); s.chop = { x, t: 0 }; shake(s); bits(s, x, cy, b.k === 'pork' ? ['#f7d98a', '#e2a63a', '#b8741e'] : ['#c0602a', '#7a2e12', '#f2ead8'], 8, 40); }
  return true;
}

/* ---------- input (logical px, game time) ---------- */
type P = { x: number; y: number; cx: number; cy: number };
function pdown(s: RoastState, l: P) {
  if (s.over) return;
  const F = s.f;
  Object.assign(F, { down: true, mode: 'none', sx: l.x, sy: l.y, x: l.x, y: l.y, cx0: l.cx, cy0: l.cy, t0: s.t, moved: 0 });
  const L = LY(s), k = hookAt(L, l);
  if (k) { if (s.lock > s.t) { say(s, '掛緊返去…', '#ffb347'); return; } F.mode = 'roast'; F.k = k; sfx(s, 'pick'); return; }
  const b = s.board;
  if (b && l.y >= L.board.y - 4 && l.y <= L.board.y + L.board.h + 4) {
    const top = L.meatCy - b.h / 2, bot = L.meatCy + b.h / 2;
    // 叉燒 is sliced: a stroke down a guide from the top band (lower down, once something is cut, picks the pieces up).
    // The chopped roasts: a press on a guide not cut yet chops it there and then, however firmly or long it is held
    // (firm chops on 1-2-3-4); a press elsewhere chops where it lands when it lifts, and once something is
    // cut, a drag from there picks the cut pieces up. Only the cut pieces ride the finger; the uncut end hangs back.
    const inX = l.x >= b.x0 - 6 && l.x < b.x1 + 4, cut = b.cuts.length > 0;
    if (!inX || l.y <= top - 14 || l.y >= bot + 8) return;
    if (b.k === 'char') {
      const resume = b.partial && Math.abs(l.x - b.partial.x) <= TUNE.trace.tol;
      if (cut && !resume && l.y > top + b.h * TUNE.trace.startBand) { F.mode = 'pieces'; sfx(s, 'pick'); return; }
      startTrace(s, b, l, top);
      if (F.mode === 'none' && !cut) F.mode = 'slab';     // too low to slice: a drag up from here carries the roast back
      return;
    }
    if (snapTo(s, b, l.x) !== null) { cutAt(s, b, l.x, 'chop'); F.mode = 'done'; return; }
    F.mode = cut ? 'tapOrPieces' : 'tap';
    return;
  }
  const base = baseAt(L, l); if (base) { F.mode = 'base'; F.base = base; return; }
  const P0 = s.plate, soupBowl = P0.base && BASE[P0.base].soup;
  if (inR(L.soy, l, 2)) {
    F.mode = 'soy';
    if (!P0.base) { say(s, '揀底先', '#ffb347'); F.mode = 'none'; }
    else if (soupBowl) { say(s, '湯粉唔使豉油', '#ffb347'); F.mode = 'none'; }
    return;
  }
  if (inR(L.soup, l, 2)) { F.mode = 'ladle'; sfx(s, 'pick'); return; }
  if (inR(L.ginger, l, 1)) { F.mode = 'ginger'; return; }
  if (inR(L.scal, l, 1)) { F.mode = 'scal'; return; }
  if (inR(L.veg, l, 1)) { F.mode = 'veg'; return; }
  if (onPlate(L, l, 6)) { F.mode = 'plate'; return; }
}
function startTrace(s: RoastState, b: Board, l: P, top: number) {
  const F = s.f, tol = TUNE.trace.tol, pa = b.partial;
  if (pa && Math.abs(l.x - pa.x) <= tol && l.y <= pa.front + TUNE.trace.gap) { Object.assign(F, { mode: 'trace', ax: pa.x, front: pa.front, xs: [...pa.xs], prevOn: true, prevY: l.y, off: false }); return; }
  b.partial = null;
  if (l.y > top + b.h * TUNE.trace.startBand) { say(s, '由上面𠝹落嚟 ↓', '#ffb347'); return; }
  Object.assign(F, { mode: 'trace', ax: l.x, front: top, xs: [l.x], prevOn: true, prevY: l.y, off: false });
}
function pmove(s: RoastState, l: P): Res | null {
  const F = s.f;
  if (!F.down || s.over) return null;
  F.moved = Math.max(F.moved, Math.hypot(l.cx - F.cx0, l.cy - F.cy0));
  F.x = l.x; F.y = l.y;
  const b = s.board, L = LY(s);
  if (F.mode === 'tapOrPieces' && F.moved >= TUNE.tap.move) { F.mode = 'pieces'; sfx(s, 'pick'); }
  // an uncut roast pressed off its guides and dragged well up (a swipe's length, far more than a firm chop rolls) is
  // carried off the board instead of chopped: dropped on the rail it hangs back
  if ((F.mode === 'tap' || F.mode === 'slab') && F.cy0 - l.cy >= TUNE.swipe) { F.mode = 'lift'; sfx(s, 'pick'); }
  if (F.mode === 'trace' && b) {
    const top = L.meatCy - b.h / 2, bot = L.meatCy + b.h / 2, on = Math.abs(l.x - F.ax) <= TUNE.trace.tol;
    if (on && F.prevOn && F.prevY <= F.front + TUNE.trace.gap && l.y > F.front) {
      F.front = Math.min(l.y, bot + 1); F.xs.push(l.x);
      if (s.t - s.lastSlice > 0.05) { s.lastSlice = s.t; sfx(s, 'slice'); }
      bits(s, F.ax, F.front, ['#e89a8a', '#ffffff'], 1, 8, 0.4);
    }
    if (!on && !F.off && F.front > top + 1) { F.off = true; say(s, '跟住條線！', '#ffb347'); }
    if (on) F.off = false;
    F.prevOn = on; F.prevY = l.y;
    if (F.front >= bot) { cutAt(s, b, sum(F.xs) / F.xs.length, 'trace'); b.partial = null; F.mode = 'done'; }
  } else if (F.mode === 'soy') {
    if (!inR(L.soy, l, 8)) F.mode = 'none';
  } else if (F.mode === 'plate') {
    const dy = l.cy - F.cy0;
    if (dy < -TUNE.swipe) { F.mode = 'done'; return serve(s); }
    else if (dy > TUNE.swipe) { F.mode = 'done'; return dump(s); }
  }
  return null;
}
function pup(s: RoastState, l: P) {
  const F = s.f;
  if (!F.down) return;
  F.down = false;
  if (s.over) return;
  const b = s.board, L = LY(s), isTap = F.moved < TUNE.tap.move && s.t - F.t0 < TUNE.tap.time;
  switch (F.mode) {
    case 'roast': {
      if (F.k && l.y >= L.board.y - 6 && l.y <= L.board.y + L.board.h + 6) pullDown(s, F.k, l);
      else if (isTap) say(s, '拖落砧板 ↓', '#ffe9a8');
      break;
    }
    case 'trace':
      if (b && F.front > L.meatCy - b.h / 2 + 1) { b.partial = { x: F.ax, front: F.front, xs: [...F.xs] }; say(s, '未切斷，繼續𠝹', '#ffb347'); }
      break;
    // a chop counts however long the press was (a firm chop is slow to lift); it lands where the finger went down
    case 'tap': case 'tapOrPieces':
      if (b) cutAt(s, b, F.sx, 'chop');
      break;
    case 'pieces':
      if (b && onPlate(L, l, 8)) plateMeat(s, b, l);
      else if (b && onRail(L, l)) hangBackBoard(s, b);
      else if (Math.hypot(l.x - F.sx, l.y - F.sy) > 6) say(s, '拖去碟度', '#ffe9a8');
      break;
    case 'lift':
      if (b && onRail(L, l)) hangBackBoard(s, b);
      else say(s, '拖返上架就掛返', '#ffe9a8');
      break;
    case 'base': if (isTap && F.base && baseAt(L, l) === F.base) setBase(s, F.base); break;
    case 'ladle':
      if (onPlate(L, l, 8)) addSoup(s);
      else if (isTap) say(s, '拖湯殼去碗', '#ffe9a8');
      break;
    case 'scal': if (isTap) addScal(s); break;
    case 'ginger': if (isTap) { s.plate.ginger = !s.plate.ginger; sfx(s, 'plop'); say(s, s.plate.ginger ? '+ 薑葱' : '收返薑葱', '#ffe9a8'); } break;
    case 'veg': if (isTap) { s.plate.veg = !s.plate.veg; sfx(s, 'plop'); say(s, s.plate.veg ? '+ 油菜' : '收返油菜', '#ffe9a8'); } break;
    default: break;
  }
  F.mode = null;
}

/* ---------- actions ---------- */
type Res = RoastResult;
/** The cutting rule for a roast, in one line (on the board when it lands, and in the how-to). */
export function cutRule(s: RoastState, b: Board): string {
  if (guideMode(s) === 'none') return `自己度位，斬 ${b.n} 件一樣闊`;
  if (b.k === 'char') return `沿 1-${b.n} 每條虛線由上𠝹落，一條一刀`;
  return MEAT[b.k].bone ? `斬 1-${b.n} 每條虛線（骨位），一條一刀` : `斬 1-${b.n} 每條虛線，一條一刀`;
}
function pullDown(s: RoastState, k: MeatK, l: Pt) {
  const o = s.q[0]?.ord ?? null;
  if (!o) { say(s, '未有客', '#ffb347'); return; }
  if (!o.meats.includes(k)) {
    s.lock = s.t + TUNE.wrongLock; s.hangBack = { k, x: l.x, y: l.y, t: 0 }; s.combo = 0;
    say(s, `客冇叫${MEAT[k].name}！掛返`, '#ff8a5a'); sfx(s, 'bad'); tally(s, 'wrongRoast', 0, '拉錯燒味'); return;
  }
  if (s.board?.cuts.length) { say(s, s.board.k === k || o.meats.includes(s.board.k) ? '砧板上面嗰啲拖去碟先' : '砧板上面嗰啲拖返上架先', '#ffb347'); sfx(s, 'bad'); return; }
  s.board = newBoard(s, k); sfx(s, 'thunk'); shake(s);
  say(s, `${s.board.n} 件 = ${s.board.n} 刀`, '#ffe9a8');
}
/** Dropped this high, what the finger carries off the board is on the rail (above the board's top edge). */
const onRail = (L: Layout, l: Pt) => l.y < L.board.y - 2;
/**
 * What is on the board, dragged up onto the rail, hangs back on its hook: the way out for a roast nobody
 * wants now (its customer left, or another hand served them), cut or not. Nothing is charged; the counter is free again.
 */
function hangBackBoard(s: RoastState, b: Board) {
  s.restBack = { b, from: b.x0, t: 0 }; s.board = null;
  sfx(s, 'hook'); say(s, `${MEAT[b.k].name}掛返上架`, '#ffe9a8');
}
function plateMeat(s: RoastState, b: Board, l: Pt) {
  const P = s.plate, vessel = P.base && BASE[P.base].soup ? '碗' : '碟';
  if (!P.base) { say(s, '揀底先（飯／粉）', '#ffb347'); sfx(s, 'bad'); return; }
  const z = zoneAt(s, l.x), ws = widths(b), ex = P.items.find(i => i.k === b.k);
  if (ex) { ex.widths.push(...ws); ex.splinter += b.splinter; ex.ragged += b.ragged; }
  else {
    if (P.items.some(i => i.zone === z)) { P.mixed++; say(s, '每樣放一格', '#ff8a5a'); }
    P.items.push({ k: b.k, widths: ws, zone: z, splinter: b.splinter, ragged: b.ragged });
  }
  // only the cut pieces go onto the plate; the uncut end flies back up onto its hook, ready for the next order
  const lc = lastCut(b);
  if (b.x1 - lc > 2) s.restBack = { b, from: lc, t: 0 };
  s.board = null; sfx(s, 'plop'); say(s, `${ws.length} 件${MEAT[b.k].name}上${vessel}`, '#7be08f');
}
function setBase(s: RoastState, k: BaseK) {
  const P = s.plate;
  if (P.items.length) { say(s, '啲餸喺面，換唔到底', '#ffb347'); sfx(s, 'bad'); return; }
  // a new base is a fresh plate or bowl: what was poured on the old one goes with it
  Object.assign(P, { base: k, soy: 0, flood: false, soup: 0, scal: false });
  sfx(s, 'plop'); say(s, BASE[k].name + (BASE[k].soup ? '：用碗' : '：用碟'), '#ffe9a8');
}
function addSoup(s: RoastState) {
  const P = s.plate;
  if (!P.base) { say(s, '揀底先', '#ffb347'); sfx(s, 'bad'); return; }
  if (!BASE[P.base].soup) { say(s, '白飯唔使湯', '#ffb347'); sfx(s, 'bad'); return; }
  P.soup++; if (P.items.length) P.late++;
  sfx(s, 'pour'); say(s, P.soup === 1 ? '+ 一殼湯' : `湯多咗（${P.soup} 殼）`, P.soup === 1 ? '#7be08f' : '#ffb347');
}
function addScal(s: RoastState) {
  const P = s.plate;
  if (!P.base) { say(s, '揀底先', '#ffb347'); sfx(s, 'bad'); return; }
  if (!BASE[P.base].soup) { say(s, '白飯唔使蔥花', '#ffb347'); sfx(s, 'bad'); return; }
  if (P.scal) { P.scal = false; sfx(s, 'plop'); say(s, '收返蔥花', '#ffe9a8'); return; }
  P.scal = true; if (P.items.length) P.late++;
  sfx(s, 'plop'); say(s, '+ 蔥花', '#ffe9a8');
}
function dump(s: RoastState): Res | null {
  const P = s.plate; if (!P.base && !P.items.length) return null;
  s.plate = newPlate(); s.score -= TUNE.dumpCost; s.dumped++; tally(s, 'dump', TUNE.dumpCost, '倒咗碟'); say(s, `倒咗！-$${TUNE.dumpCost}`, '#ff8a5a'); sfx(s, 'bad');
  return { kind: 'dumped', at: s.t, cost: TUNE.dumpCost };
}
export interface Why { tag: string; pts: number; t: string; g: string }
export interface Grade { q: number; stars: number; why: Why[]; quote: string; lossR: number }
/** The prototype's grade(): the order's quality 0-100, stars, every reason (t: for this order; g: without counts, for the tally). */
export function grade(o: Order, P: Plate): Grade {
  const why: Why[] = [], add = (tag: string, pts: number, t: string) => { if (pts > 0.5) why.push({ tag, pts: Math.round(pts), t, g: t.replace(/（.*?）/g, '').replace(/ ?\d+ ?(件|次)?/g, '') }); };
  let lossR = 0;
  for (const k of o.meats) {
    const it = P.items.find(i => i.k === k), nm = MEAT[k].name, tgt = portionOf(o, k), w = pieceW(k, tgt);
    if (!it) { add('missing', TUNE.pen.missing, `冇${nm}`); continue; }
    const cnt = it.widths.length, d = cnt - tgt;
    if (d < 0) add('few', -d * TUNE.pen.perPiece, `${nm}少咗 ${-d} 件`);
    if (d > 0) add('many', d * TUNE.pen.perPiece * 0.5, `${nm}多咗 ${d} 件`);
    const r = sum(it.widths) / (tgt * w);
    if (r < TUNE.amount.lo) add('stingy', (TUNE.amount.lo - r) * TUNE.pen.stingy, `${nm}份量少（${Math.round(r * 100)}%）`);
    if (r > TUNE.amount.hi) { add('over', (r - TUNE.amount.hi) * TUNE.pen.over, `${nm}切多咗（${Math.round(r * 100)}%）`); lossR += r - 1; }
    if (cnt >= 2) {
      const m = sum(it.widths) / cnt, sd = Math.sqrt(sum(it.widths.map(x => (x - m) ** 2)) / cnt), cv = sd / m;
      add('uneven', Math.min(TUNE.even.cap, (cv - TUNE.even.ok) * TUNE.even.k), `${nm}厚薄唔均`);
    }
    if (it.splinter) add('splinter', it.splinter * TUNE.pen.splinter, `${nm}碎骨 ${it.splinter} 次`);
    if (it.ragged) add('ragged', it.ragged * TUNE.pen.ragged, `${nm}斬得唔齊 ${it.ragged} 次`);
  }
  for (const it of P.items) if (!o.meats.includes(it.k)) add('extra', TUNE.pen.extra, `客冇叫${MEAT[it.k].name}`);
  if (P.mixed) add('mixed', P.mixed * TUNE.pen.mixed, '拼盤撈埋一齊');
  if (P.base !== o.base) add('base', TUNE.pen.base, P.base ? `底錯咗（要${BASE[o.base].name}）` : '冇底');
  const soup = BASE[o.base].soup;
  if (soup) {
    if (P.soy > 0.1) add('soyNoodle', TUNE.pen.soyNoodle, '湯粉淋咗豉油');
    if (P.base === o.base) {
      if (P.soup < 1) add('noSoup', TUNE.pen.noSoup, '冇湯');
      if (P.soup > 1) add('soupMore', (P.soup - 1) * TUNE.pen.soupMore, `湯多咗（多 ${P.soup - 1} 殼）`);
      if (!P.scal) add('noScal', TUNE.pen.noScal, '漏咗蔥花');
      if (P.late) add('late', P.late * TUNE.pen.late, '湯／蔥花落喺肉面（肉要最後放）');
    }
  }
  else if (P.flood) add('flood', TUNE.pen.flood, '豉油瀉晒');
  else if (P.soy < 0.05) add('noSoy', TUNE.pen.noSoy, '冇淋豉油');
  else if (P.soy < TUNE.soy.lo) add('lowSoy', TUNE.pen.lowSoy, '豉油太少');
  else if (P.soy > TUNE.soy.hi) add('hiSoy', TUNE.pen.hiSoy, '豉油太多');
  if (o.ginger && !P.ginger) add('ginger', TUNE.pen.ginger, '漏咗薑葱');
  if (!o.ginger && P.ginger) add('noGinger', TUNE.pen.noGinger, '唔使薑葱都俾');
  if (o.veg && !P.veg) add('veg', TUNE.pen.veg, '漏咗油菜');
  if (!o.veg && P.veg) add('noVeg', TUNE.pen.noVeg, '送多碟油菜');
  const q = clamp(100 - sum(why.map(w => w.pts)), 0, 100);
  const stars = q >= TUNE.stars[2] ? 3 : q >= TUNE.stars[1] ? 2 : q >= TUNE.stars[0] ? 1 : 0;
  why.sort((a, b) => b.pts - a.pts);
  const top = why[0], quote = !top || top.pts < 4 ? (stars === 3 ? '啱晒' : '幾好') : top.t;
  return { q, stars, why, quote, lossR };
}
function made(o: Order, P: Plate): RoastMade {
  return { item: o.item, base: P.base, items: P.items.map(i => ({ k: i.k, widths: [...i.widths], zone: i.zone, splinter: i.splinter })), soy: P.soy, flood: P.flood, ginger: P.ginger, veg: P.veg, soup: P.soup, scal: P.scal, late: P.late, mixed: P.mixed };
}
function serve(s: RoastState): Res | null {
  const c = s.q[0], P = s.plate, L = LY(s);
  if (!P.base && !P.items.length) { say(s, '空碟出咩餐？', '#ffb347'); return null; }
  if (!c) { say(s, '未有客', '#ffb347'); return null; }
  const g = grade(c.ord, P), base = Math.round(c.ord.price * Math.pow(g.q / 100, TUNE.payCurve)), tip = g.stars >= 2 ? Math.round(TUNE.tipMax * c.pat / c.max) : 0, loss = Math.round(g.lossR * c.ord.price * TUNE.lossK);
  s.score += base + tip - loss; s.earned += base; s.tips += tip; s.loss += loss; s.served++; s.starsSum += g.stars;
  for (const w of g.why) tally(s, w.tag, w.pts, w.g);
  s.orders.push({ name: c.ord.name, q: g.q, stars: g.stars, t: c.max - c.pat, why: g.why.map(w => w.t) });
  s.react = { text: g.quote, stars: g.stars, t: 0, money: base + tip - loss };
  s.flights.push({ plate: P, x: L.plate.cx, y: L.plate.cy, t: 0 });
  s.gone.push({ c, t: 0, happy: g.stars >= 2, angry: '' }); s.q.shift(); s.plate = newPlate();
  if (s.board && !s.board.cuts.length && !s.q[0]?.ord.meats.includes(s.board.k)) s.board = null;
  sfx(s, 'ding'); say(s, `${'★'.repeat(g.stars)}${'☆'.repeat(3 - g.stars)} +$${base + tip - loss}`, g.stars >= 2 ? '#7be08f' : '#ffb347');
  return { kind: 'lineDone', at: s.t, gid: c.gid, dest: 'roast', i: c.i, made: made(c.ord, P), q: g.q, stars: g.stars, pay: base, tip, loss };
}

/* ---------- the next step, in one line (the player never has to remember anything) ---------- */
export function nextStep(s: RoastState): string {
  const c = s.q[0]; if (!c) return '';
  const o = c.ord, P = s.plate, b = s.board, soup = BASE[o.base].soup, vessel = soup ? '碗' : '碟';
  if (P.base && P.base !== o.base) return P.items.length ? '底錯咗：喺碟度向下掃倒咗' : `換底：撳${BASE[o.base].name}`;
  if (b && o.meats.includes(b.k)) {
    const left = uncut(s, b).length, cut = b.cuts.length;
    if (!left) {
      if (!P.base) return `揀底先：${BASE[o.base].name}`;
      if (soup && P.soup < 1) return '先拖一殼湯落碗（肉最後放）';
      if (soup && !P.scal) return '先撳蔥花（肉最後放）';
      return `拖斬好嗰 ${cut} 件去${vessel} ↓`;
    }
    return `${cutRule(s, b)}（${b.n - left}／${b.n}）`;
  }
  // a cut roast nobody in front wants blocks the board (a new roast cannot come down on it): it goes back up
  if (b && b.cuts.length) return `客冇叫${MEAT[b.k].name}：拖返上架 ↑`;
  if (!P.base) return `揀底：${BASE[o.base].name}`;
  if (soup && P.soup < 1) return '由湯煲拖一殼湯落碗';
  if (soup && !P.scal) return '撳蔥花';
  const need = o.meats.find(k => !P.items.some(i => i.k === k));
  if (need) return `將${MEAT[need].name}拖落砧板`;
  if (!soup && P.soy < TUNE.soy.lo) return '撳住豉油樽，淋到綠色格';
  if (o.ginger && !P.ginger) return '撳薑葱';
  if (o.veg && !P.veg) return '撳油菜';
  return `喺${vessel}度向上掃出餐 ↑`;
}
/** The ticket's second line: every step in the order it is done, ticked once done (the meat goes on a noodle bowl last). */
export function ticketSteps(s: RoastState, o: Order): { t: string; ok: boolean }[] {
  const done = s.plate, sub: { t: string; ok: boolean }[] = [];
  for (const k of o.meats) { const it = done.items.find(i => i.k === k); sub.push({ t: `${MEAT[k].name}×${portionOf(o, k)}`, ok: !!it }); }
  const sp = BASE[o.base].soup, okBase = done.base === o.base, bt = { t: BASE[o.base].name + (sp ? '（碗）' : '（碟）'), ok: okBase };
  if (sp) sub.unshift(bt, { t: '湯×1', ok: okBase && done.soup === 1 }, { t: '蔥花', ok: okBase && done.scal });
  else { sub.unshift(bt); sub.push({ t: '豉油', ok: done.soy >= TUNE.soy.lo && done.soy <= TUNE.soy.hi && !done.flood }); }
  if (o.ginger) sub.push({ t: '薑葱', ok: done.ginger });
  if (o.veg) sub.push({ t: '油菜', ok: done.veg });
  return sub;
}

/* ---------- the clock ---------- */
function tick(s: RoastState, dt: number, rng: Rng): Res[] {
  const out: Res[] = [];
  if (s.over) return out;
  s.t += dt;
  if (s.selfFeed) {
    // arrivals
    const a0 = s.arrivals[0];
    if (a0 !== undefined && s.t >= a0) { s.arrivals.shift(); if (s.q.length < TUNE.queueMax) s.q.push(mkCustomer(s, rng)); if (!s.arrivals.length) s.nextArr = s.t + df(s).arrive; }
    if (!s.arrivals.length && s.t >= s.nextArr) { s.nextArr = s.t + df(s).arrive * rnd(rng, 0.8, 1.2); if (s.q.length < TUNE.queueMax) s.q.push(mkCustomer(s, rng)); }
    if (!s.q.length && !s.arrivals.length && s.nextArr - s.t > TUNE.emptyWait) s.nextArr = s.t + TUNE.emptyWait;   // an empty counter fills sooner
  }
  // patience (only the customers whose wait the station runs; the referee runs the shop's)
  for (let i = s.q.length - 1; i >= 0; i--) {
    const c = s.q[i];
    if (!c?.timed) continue;
    c.pat -= dt;
    if (c.pat <= 0) {
      s.q.splice(i, 1); s.left++; s.score -= TUNE.leaveCost; tally(s, 'leave', TUNE.leaveCost, '客等到走咗');
      s.gone.push({ c, t: 0, happy: false, angry: '等太耐，走咗' });
      say(s, `客走咗！-$${TUNE.leaveCost}`, '#ff5a5a'); sfx(s, 'leave');
      out.push({ kind: 'walkout', at: s.t, gid: c.gid, i: c.i });
    }
  }
  // soy pour while held
  if (s.f.down && s.f.mode === 'soy') {
    const P = s.plate; P.soy += dt / TUNE.soy.time;
    if (s.t - s.lastPour > 0.09) { s.lastPour = s.t; sfx(s, 'pour'); }
    if (P.soy >= TUNE.soy.over && !P.flood) { P.flood = true; say(s, '瀉晒！', '#ff5a5a'); sfx(s, 'bad'); }
  }
  if (s.board && s.board.drop > 0) s.board.drop = Math.max(0, s.board.drop - dt);
  if (s.hangBack) { s.hangBack.t += dt; if (s.hangBack.t >= TUNE.wrongLock) s.hangBack = null; }
  if (s.restBack) { s.restBack.t += dt; if (s.restBack.t >= TUNE.restBack) s.restBack = null; }
  syncBoard(s);
  if (s.chop) { s.chop.t += dt; if (s.chop.t > 0.15) s.chop = null; }
  for (const f of s.flights) f.t += dt; s.flights = s.flights.filter(f => f.t < 0.35);
  for (const g of s.gone) g.t += dt; s.gone = s.gone.filter(g => g.t < 1.6);
  if (s.react) { s.react.t += dt; if (s.react.t > 2.2) s.react = null; }
  for (const m of s.msgs) m.t += dt; s.msgs = s.msgs.filter(m => m.t < 1.3);
  if (s.q.length || s.board) s.idleSince = s.t;
  if (s.selfFeed && s.t >= TUNE.shift) out.push(endRun(s));
  return out;
}
function endRun(s: RoastState): Res {
  s.over = true; s.f.down = false; s.f.mode = null;
  const avg = s.served ? s.starsSum / s.served : 0, stars = s.served ? clamp(Math.round(avg - (s.left >= 2 ? 1 : 0)), 0, 3) : 0;
  const even = s.orders.length ? Math.round(s.cleanCuts / Math.max(1, s.cuts) * 100) : 0;
  const why = Object.entries(s.why).filter(([t]) => t !== '拉錯燒味').sort((a, b) => b[1].pts - a[1].pts).slice(0, 5).map(([t, w]): [string, number, number] => [t, w.n, w.pts]);
  s.end = { stars, avg, even, why, wrong: s.why['拉錯燒味']?.n ?? 0 };
  return { kind: 'shiftEnd', at: s.t, score: s.score, served: s.served, left: s.left, stars };
}

/* ---------- referee work (the seam) ---------- */
/**
 * Events the station takes:
 * - `order { gid, i, item, veg?, patience? }`: a roast line (shop order with dest 'roast', or a 斬料 walk-in). `item` is a
 *   MENU name; `patience` (s) makes the station run that customer's wait, else the referee runs it. Queued in arrival order.
 * - `cancel { gid, i }`: the line is gone (the customer walked out, or another driver finished it).
 * - `selfFeed { on }`: switch the station's own customers on or off (the standalone page leaves it on).
 * - `tier { tier }`: the 斬料 cutting tier 0..3 (TUNE.cut; a level sets it, else the difficulty's TUNE.diff tier).
 */
function onEvent(s: RoastState, ev: RefEvent, rng: Rng) {
  if (ev.kind === 'order') {
    const item = MENU.find(m => m.name === ev['item']), gid = ev['gid'], i = ev['i'], pat = ev['patience'];
    if (!item || typeof gid !== 'number' || typeof i !== 'number') return;
    if (s.q.some(c => c.gid === gid && c.i === i)) return;                // de-duplicated: a line is queued once
    const timed = typeof pat === 'number' && pat > 0, p = timed ? pat : df(s).patience;
    s.q.push({ id: s.custSeed++, gid, i, ord: orderOf(item, ev['veg'] === true, s.tier, s.knob.pcs), pat: p, max: p, timed, look: mkLook(rng) });
    s.orderN++;
  } else if (ev.kind === 'cancel') {
    const k = s.q.findIndex(c => c.gid === ev['gid'] && c.i === ev['i']);
    if (k >= 0) { const c = s.q[k]; s.q.splice(k, 1); if (c) s.gone.push({ c, t: 0, happy: false, angry: '' }); }
  } else if (ev.kind === 'tier') {
    // the 斬料 cutting tier, set by a level (pieces, snap, guides; orders already queued keep their piece counts)
    const t = ev['tier'];
    if (typeof t === 'number' && Number.isFinite(t)) s.tier = clampTier(t);
  } else if (ev.kind === 'selfFeed') {
    s.selfFeed = ev['on'] === true;
    if (!s.selfFeed) s.arrivals = [];
  }
}

/* ---------- commands ---------- */
function command(s: RoastState, cmd: RoastCmd): Res[] {
  const out: Res[] = [];
  const push = (r: Res | null | undefined) => { if (r) out.push(r); };
  switch (cmd.k) {
    case 'view': {
      const old = LY(s).board.x;
      s.view = { LW: Math.max(1, Math.floor(cmd.LW)), LH: Math.max(1, Math.floor(cmd.LH)), S: cmd.S };
      // the roast on the board keeps its place on the board when the screen changes size
      const dx = LY(s).board.x - old;
      if (dx) for (const b of [s.board, s.restBack?.b]) if (b) { b.x0 += dx; b.x1 += dx; b.cuts = b.cuts.map(c => c + dx); b.on = b.on.map(c => c + dx); if (b.partial) { b.partial.x += dx; b.partial.xs = b.partial.xs.map(x => x + dx); } }
      break;
    }
    case 'cancel': s.f.down = false; s.f.mode = null; break;
    // a new press always starts a gesture: a finger still "down" from before is stale (the computer was mid-tap when the
    // player took the seat back, a lift the page never saw), and must never lock the counter. One finger
    // at a time is the screen's rule (it ignores a second finger), not the core's
    case 'down': if (s.f.down) { s.f.down = false; s.f.mode = null; } pdown(s, cmd); break;
    case 'move': push(pmove(s, cmd)); break;
    case 'up': pup(s, cmd); break;
  }
  return out;
}

/* ---------- the computer driver (bot.ts) is attached below to keep one module object ---------- */
export function status(s: RoastState): StationStatus {
  return { waiting: s.q.length, idleFor: Math.max(0, s.t - s.idleSince), load: Math.min(1, (s.q.length + (s.board ? 0.5 : 0)) / TUNE.queueMax) };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isArr = (x: unknown, f: (y: unknown) => boolean) => Array.isArray(x) && x.every(f);
const isMeat = (x: unknown) => x === 'char' || x === 'pork' || x === 'duck' || x === 'chick';
const isBase = (x: unknown) => x === 'rice' || x === 'lai' || x === 'mai' || x === 'ho';
function isBoard(x: unknown): boolean {
  const pa = isObj(x) ? x['partial'] : null;
  return isObj(x) && isMeat(x['k']) && isNum(x['n']) && isNum(x['w']) && x['w'] > 0 && isNum(x['h']) && isNum(x['x0']) && isNum(x['x1']) && isArr(x['cuts'], isNum) && isArr(x['on'], isNum)
    && isNum(x['splinter']) && isNum(x['ragged']) && isNum(x['drop']) && (pa === null || (isObj(pa) && isNum(pa['x']) && isNum(pa['front']) && isArr(pa['xs'], isNum)));
}
function isPlate(x: unknown): boolean {
  return isObj(x) && (x['base'] === null || isBase(x['base'])) && isNum(x['soy']) && isNum(x['soup']) && isNum(x['mixed']) && isNum(x['late']) && typeof x['flood'] === 'boolean'
    && typeof x['ginger'] === 'boolean' && typeof x['veg'] === 'boolean' && typeof x['scal'] === 'boolean'
    && isArr(x['items'], i => isObj(i) && isMeat(i['k']) && isArr(i['widths'], isNum) && isNum(i['zone']) && isNum(i['splinter']) && isNum(i['ragged']));
}
function isCustomer(x: unknown): boolean {
  if (!isObj(x) || !isNum(x['id']) || !isNum(x['gid']) || !isNum(x['i']) || !isNum(x['pat']) || !isNum(x['max']) || typeof x['timed'] !== 'boolean' || !isObj(x['look'])) return false;
  const o = x['ord'];
  return isObj(o) && typeof o['name'] === 'string' && typeof o['item'] === 'string' && isArr(o['meats'], isMeat) && isArr(o['pcs'], isNum) && isBase(o['base']) && isNum(o['price']) && typeof o['veg'] === 'boolean' && typeof o['ginger'] === 'boolean';
}
/** Checks a hand-over value before it is used (shape and types of everything the logic reads). */
export function validate(x: unknown): x is RoastState {
  if (!isObj(x) || x['v'] !== 1) return false;
  const d = x['diff'], view = x['view'], f = x['f'], ai = x['ai'], kn = x['knob'];
  return (d === 'rookie' || d === 'pro' || d === 'ace') && typeof x['selfFeed'] === 'boolean' && isObj(view) && isNum(view['LW']) && isNum(view['LH']) && isNum(view['S'])
    && ['t', 'orderN', 'custSeed', 'gid', 'nextArr', 'lock', 'score', 'earned', 'tips', 'loss', 'served', 'left', 'dumped', 'starsSum', 'combo', 'bestCombo', 'cuts', 'cleanCuts', 'lastPour', 'lastSlice', 'fxSeq', 'idleSince'].every(k => isNum(x[k]))
    && isArr(x['q'], isCustomer) && isArr(x['arrivals'], isNum) && (x['board'] === null || isBoard(x['board'])) && isPlate(x['plate'])
    && isArr(x['msgs'], isObj) && isArr(x['flights'], isObj) && isArr(x['gone'], isObj) && isArr(x['orders'], isObj) && isArr(x['fx'], isObj) && isObj(x['why'])
    && typeof x['over'] === 'boolean' && isObj(f) && typeof f['down'] === 'boolean' && isArr(f['xs'], isNum) && isObj(ai) && isNum(ai['at']) && Array.isArray(ai['steps']) && isNum(ai['aim'])
    && isNum(x['tier']) && x['tier'] >= 0 && x['tier'] < TIERS && isObj(kn) && isNum(kn['pcs']) && isNum(kn['snap']) && kn['snap'] > 0;
}

export interface RoastOpts { selfFeed: boolean }
export type RoastModule = StationModule<RoastState, RoastCmd, RoastResult>;
/** The station. `selfFeed` (default on): the station makes its own customers, as the original prototype does. */
export function roastStation(opts: RoastOpts, bot: BotModule<RoastState, RoastCmd>): RoastModule {
  return {
    kind: 'roast',
    init: (cfg: ShiftConfig) => newRun(cfg.difficulty, opts.selfFeed),
    command: (s, cmd) => command(s, cmd),
    step: (s, dt, ctx: StationCtx) => tick(s, dt, ctx.rng),
    onEvent: (s, ev, ctx) => { onEvent(s, ev, ctx.rng); },
    status: (s) => status(s),
    bot,
    validate,
  };
}
