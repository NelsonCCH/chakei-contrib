// 執枱 table-clearing station core: a count-and-tap
// test of speed and accuracy. A table holds plates, bowls and cups scattered at random (overlapping, rotated), so they
// cannot be counted at a glance. Three big buttons (碟 / 碗 / 杯): each tap removes one matching item (the topmost of that
// kind), so the player counts what is still there. Tapping a kind when none of it is left is one tap too many: the
// WHOLE table resets to its starting items, with a short lock (TUNE.resetPen). The table is done when the last item is
// gone. Rushing and miscounting costs more time than going carefully.
// Pure (contract.ts rules): time comes in as dt / ctx.t, positions and rotations come from ctx.rng, state is plain JSON.
//
// Work seam: `selfFeed` (the standalone page) makes its own tables one after another (counts drawn from TUNE by tier) and
// keeps a session score. With selfFeed off (the referee) `table` events bring the tables
// ({ kind: 'table', table, name, items: { plate, bowl, cup } }) and `cancel` events ({ kind: 'cancel', table }) take
// one back; each cleared table sends `cleared`, each over-tap `reset`.
import type { BotModule, Difficulty, RefEvent, Result, Rng, ShiftConfig, StationCtx, StationModule, StationStatus } from '../contract';
import { clearBot } from './bot';

export type Kind = 'plate' | 'bowl' | 'cup';
export const KINDS: readonly Kind[] = ['plate', 'bowl', 'cup'];
export type Counts = Record<Kind, number>;
export type NoiseKind = 'stain' | 'crumbs' | 'napkin' | 'chops' | 'spoon';

/** One piece on the table, in table units (TUNE.tw x TUNE.th). `goneAt`: the table clock when it was taken (null: still there). */
export interface Item { k: Kind; x: number; y: number; rot: number; r: number; goneAt: number | null }
/** Visual noise: never needs a tap. Stains, crumbs and napkins lie under the dishes, chopsticks and spoons on top. */
export interface Noise { k: NoiseKind; x: number; y: number; rot: number; s: number }
export interface Table {
  table: number; name: string;
  /** The table clock (s.t) when it was fed: `secs` runs from here. */
  at: number;
  items: Item[]; noise: Noise[]; taps: number; resets: number;
}
/** The table just cleared (for the done stamp), with its time. */
export interface Done extends Table { secs: number; doneAt: number }
export interface Session { tables: number; secs: number; taps: number; resets: number; best: number }
/** A sound or screen effect the screen plays once (it remembers the last id it played). arg: the kind index for 'tap'. */
export interface Cue { id: number; k: 'tap' | 'reset' | 'done' | 'table'; arg: number }

export interface ClearState {
  v: 1; tier: number; selfFeed: boolean; seed: number;
  /** The table clock: advanced by step(dt). */
  t: number;
  /** Tables fed and not yet cleared; tables[0] is the one on screen. */
  tables: Table[];
  /** The table clock from which tables[0] takes taps (after a hold or a reset lock). */
  upAt: number;
  /** s before the next table comes up after a clear (the done stamp shows meanwhile). */
  hold: number;
  /** s left of an over-tap's lock (taps are ignored). */
  pen: number;
  /** The kind of the last accepted tap on this attempt (the bot's pacing and its slip read it). */
  lastK: Kind | null;
  tapT: number;
  /** The table clock of the latest over-tap (the reset flash), and which table. */
  resetAt: number | null; resetTable: number;
  last: Done | null;
  sess: Session;
  made: number; idleFor: number; cueN: number; cues: Cue[];
}
export type ClearCmd = { t: 'tap'; k: Kind } | { t: 'next' };
export interface ClearedResult extends Result { kind: 'cleared'; table: number; secs: number; taps: number; resets: number }
export interface ResetResult extends Result { kind: 'reset'; table: number }
export type ClearResult = ClearedResult | ResetResult;
export interface ClearConfig extends ShiftConfig { tier?: number; selfFeed?: boolean }

export interface TierTune {
  /** Per kind, the count is drawn from lo..hi (self-fed tables). */
  lo: number; hi: number;
  /** Sprite size factor. */
  scale: number;
  /** Fraction of the table the dishes are first tried in (smaller = more piled up). */
  area: number;
  /** Least centre distance as a fraction of the two radii (smaller = more overlap). */
  sep: number;
  /** Noise pieces (stains, crumbs, napkins, chopsticks, spoons). */
  noise: number;
}
export const TUNE = {
  tw: 100, th: 150,
  /** Radius in table units at scale 1. A cup's handle sticks out a further `handle` of its radius. */
  size: { plate: 15, bowl: 11, cup: 7 } satisfies Counts,
  handle: 0.55,
  tiers: [
    { lo: 1, hi: 3, scale: 1.0, area: 1.0, sep: 0.95, noise: 2 },
    { lo: 2, hi: 4, scale: 0.97, area: 0.95, sep: 0.85, noise: 3 },
    { lo: 2, hi: 5, scale: 0.94, area: 0.9, sep: 0.78, noise: 4 },
    { lo: 3, hi: 6, scale: 0.9, area: 0.85, sep: 0.7, noise: 5 },
    { lo: 3, hi: 7, scale: 0.86, area: 0.8, sep: 0.64, noise: 6 },
    { lo: 4, hi: 8, scale: 0.82, area: 0.76, sep: 0.58, noise: 7 },
    { lo: 5, hi: 9, scale: 0.78, area: 0.72, sep: 0.54, noise: 8 },
    { lo: 6, hi: 10, scale: 0.74, area: 0.68, sep: 0.5, noise: 10 },
  ] satisfies TierTune[],
  /** Free-play difficulty keys -> tier. */
  diffTier: { rookie: 2, pro: 4, ace: 6 } satisfies Record<Difficulty, number>,
  /** s of lock after an over-tap (the time cost, on top of redoing the table). */
  resetPen: 1.2,
  /** s the done stamp shows before the next table comes up. */
  gap: 1.3,
  /** The most of one kind a fed table may hold. */
  maxPerKind: 12,
  /** Every dish keeps at least this fraction of its disc uncovered by the dishes above it (fair to count). */
  minVis: 0.35,
};
export const TIER_MAX = TUNE.tiers.length;

export function at<T>(a: readonly T[], i: number): T {
  const v = a[i];
  if (v === undefined) throw new Error(`index ${String(i)} out of range`);
  return v;
}
export const tierTune = (tier: number): TierTune => at(TUNE.tiers, Math.min(TIER_MAX, Math.max(1, Math.round(tier))) - 1);
/** Items of each kind still on the table. */
export function left(tb: Table): Counts {
  const c: Counts = { plate: 0, bowl: 0, cup: 0 };
  for (const it of tb.items) if (it.goneAt === null) c[it.k]++;
  return c;
}
export const remaining = (tb: Table): number => tb.items.filter(it => it.goneAt === null).length;
/** Can tables[0] take a tap now? */
export const tappable = (s: ClearState): boolean => s.tables.length > 0 && s.hold <= 0 && s.pen <= 0;

/* ---------- laying a table out ---------- */
// sample points of a disc (the centre and three rings, about evenly spread over the area): the visibility check
const ring = (n: number, d: number, a0: number): { x: number; y: number }[] => Array.from({ length: n }, (_, i) => ({ x: d * Math.cos(a0 + i * 2 * Math.PI / n), y: d * Math.sin(a0 + i * 2 * Math.PI / n) }));
const SAMPLES: readonly { x: number; y: number }[] = [{ x: 0, y: 0 }, ...ring(6, 0.33, 0), ...ring(12, 0.64, 0.26), ...ring(18, 0.9, 0.1)];
type Disc = Pick<Item, 'x' | 'y' | 'r'>;
/** The uncovered fraction of disc `a` under the discs drawn after it. */
function visible(a: Disc, above: readonly Disc[]): number {
  let free = 0;
  for (const p of SAMPLES) {
    const x = a.x + p.x * a.r, y = a.y + p.y * a.r;
    if (!above.some(b => Math.hypot(x - b.x, y - b.y) < b.r)) free++;
  }
  return free / SAMPLES.length;
}
/** Places a disc of radius r on top of `items`: spaced by `sep`, and never hiding an earlier one below minVis. */
function place(rng: Rng, items: readonly Item[], r: number, T: TierTune): { x: number; y: number } {
  const W = TUNE.tw, H = TUNE.th, pad = 2;
  let best = { x: W / 2, y: H / 2 }, bestScore = -Infinity;
  for (let k = 0; k < 60; k++) {
    // the first tries in the piled-up middle area, then anywhere on the table
    const area = k < 30 ? T.area : 1, hx = (W / 2 - r - pad) * area, hy = (H / 2 - r - pad) * area;
    const c = { x: W / 2 + (rng.next() * 2 - 1) * hx, y: H / 2 + (rng.next() * 2 - 1) * hy, r };
    let spaced = Infinity, vis = Infinity;
    items.forEach((it, i) => {
      const d = Math.hypot(c.x - it.x, c.y - it.y);
      spaced = Math.min(spaced, d / (it.r + r));
      if (d < it.r + r) vis = Math.min(vis, visible(it, [...items.slice(i + 1), c]));
    });
    const score = Math.min(spaced / T.sep, vis / TUNE.minVis);
    if (score >= 1) return { x: c.x, y: c.y };
    if (score > bestScore) { bestScore = score; best = { x: c.x, y: c.y }; }
  }
  return best;
}
const NOISE_KINDS: readonly NoiseKind[] = ['stain', 'crumbs', 'napkin', 'chops', 'spoon', 'crumbs', 'stain'];
/** A table's dishes (shuffled, so kinds mix in the pile) and its noise, all from rng. */
export function layTable(rng: Rng, tier: number, table: number, name: string, counts: Counts, now: number): Table {
  const T = tierTune(tier), kinds: Kind[] = [];
  for (const k of KINDS) for (let i = 0; i < counts[k]; i++) kinds.push(k);
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)), a = at(kinds, i); kinds[i] = at(kinds, j); kinds[j] = a; }
  const items: Item[] = [];
  for (const k of kinds) {
    const r = TUNE.size[k] * T.scale * (0.94 + rng.next() * 0.12), p = place(rng, items, r, T);
    items.push({ k, x: p.x, y: p.y, rot: rng.next() * Math.PI * 2, r, goneAt: null });
  }
  const noise: Noise[] = [];
  for (let i = 0; i < T.noise; i++) {
    noise.push({ k: at(NOISE_KINDS, Math.floor(rng.next() * NOISE_KINDS.length)), x: 6 + rng.next() * (TUNE.tw - 12), y: 6 + rng.next() * (TUNE.th - 12), rot: rng.next() * Math.PI * 2, s: 0.8 + rng.next() * 0.4 });
  }
  return { table, name, at: now, items, noise, taps: 0, resets: 0 };
}
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
/** Self-fed: the next table's counts by tier and a name like 三號卡. */
function selfTable(s: ClearState, rng: Rng): Table {
  const T = tierTune(s.tier), counts: Counts = { plate: 0, bowl: 0, cup: 0 };
  for (const k of KINDS) counts[k] = T.lo + Math.floor(rng.next() * (T.hi - T.lo + 1));
  const n = Math.floor(rng.next() * CN.length), name = `${at(CN, n)}號${rng.next() < 0.5 ? '卡' : '枱'}`;
  return layTable(rng, s.tier, ++s.made, name, counts, s.t);
}

function cue(s: ClearState, k: Cue['k'], arg = 0): void { s.cues.push({ id: ++s.cueN, k, arg }); if (s.cues.length > 16) s.cues.shift(); }
/** A table arrives: on screen at once when nothing is showing. */
function arrive(s: ClearState, tb: Table): void {
  s.tables.push(tb);
  if (s.tables.length === 1 && s.hold <= 0) { s.upAt = s.t; s.lastK = null; s.pen = 0; cue(s, 'table'); }
}

export function init(cfg: ClearConfig): ClearState {
  const tier = Math.min(TIER_MAX, Math.max(1, Math.round(cfg.tier ?? TUNE.diffTier[cfg.difficulty])));
  return {
    v: 1, tier, selfFeed: cfg.selfFeed ?? true, seed: cfg.seed >>> 0, t: 0, tables: [], upAt: 0, hold: 0, pen: 0, lastK: null, tapT: 0,
    resetAt: null, resetTable: 0, last: null, sess: { tables: 0, secs: 0, taps: 0, resets: 0, best: 0 }, made: 0, idleFor: 0, cueN: 0, cues: [],
  };
}

/* ---------- the StationModule ---------- */
function tap(s: ClearState, k: Kind, ctx: StationCtx): ClearResult[] {
  const tb = s.tables[0];
  if (!tb || !tappable(s)) return [];
  tb.taps++; s.sess.taps++;
  let hit: Item | null = null;
  for (let i = tb.items.length - 1; i >= 0; i--) { const it = at(tb.items, i); if (it.k === k && it.goneAt === null) { hit = it; break; } }
  if (!hit) {
    // one tap too many: everything comes back
    for (const it of tb.items) it.goneAt = null;
    tb.resets++; s.sess.resets++;
    s.pen = TUNE.resetPen; s.upAt = s.t + TUNE.resetPen; s.lastK = null; s.resetAt = s.t; s.resetTable = tb.table;
    cue(s, 'reset');
    return [{ kind: 'reset', at: ctx.t, table: tb.table }];
  }
  hit.goneAt = s.t; s.lastK = k; s.tapT = s.t;
  cue(s, 'tap', KINDS.indexOf(k));
  if (remaining(tb) > 0) return [];
  const secs = +(s.t - tb.at).toFixed(3);
  s.tables.shift();
  s.last = { ...tb, secs, doneAt: s.t };
  s.sess.tables++; s.sess.secs += secs; s.sess.best = s.sess.best > 0 ? Math.min(s.sess.best, secs) : secs;
  s.hold = TUNE.gap; s.lastK = null; s.pen = 0;
  cue(s, 'done');
  return [{ kind: 'cleared', at: ctx.t, table: tb.table, secs, taps: tb.taps, resets: tb.resets }];
}
function command(s: ClearState, cmd: ClearCmd, ctx: StationCtx): ClearResult[] {
  if (cmd.t === 'tap') return KINDS.includes(cmd.k) ? tap(s, cmd.k, ctx) : [];
  // 'next': skip the rest of the done stamp's hold
  if (s.hold > 0) { s.hold = 0; comeUp(s, ctx); }
  return [];
}
/** After a hold: the next table comes up (self-fed: a new one is laid). */
function comeUp(s: ClearState, ctx: StationCtx): void {
  if (s.selfFeed && s.tables.length === 0) { arrive(s, selfTable(s, ctx.rng)); return; }
  if (s.tables.length > 0) { s.upAt = s.t; s.lastK = null; s.pen = 0; cue(s, 'table'); }
}
function step(s: ClearState, dt: number, ctx: StationCtx): ClearResult[] {
  if (!(dt > 0) || !Number.isFinite(dt)) return [];
  s.t += dt;
  if (s.pen > 0) s.pen = Math.max(0, s.pen - dt);
  if (s.hold > 0) { s.hold = Math.max(0, s.hold - dt); if (s.hold === 0) comeUp(s, ctx); }
  else if (s.selfFeed && s.tables.length === 0) arrive(s, selfTable(s, ctx.rng));
  s.idleFor = s.tables.length === 0 ? s.idleFor + dt : 0;
  return [];
}
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const count = (x: unknown): x is number => num(x) && Number.isInteger(x) && x >= 0 && x <= TUNE.maxPerKind;
function onEvent(s: ClearState, ev: RefEvent, ctx: StationCtx): void {
  if (ev.kind === 'cancel') {
    const i = s.tables.findIndex(tb => tb.table === ev.table);
    if (i < 0) return;
    s.tables.splice(i, 1);
    if (i === 0 && s.hold <= 0) comeUp(s, ctx);
    return;
  }
  if (ev.kind !== 'table' || !num(ev.table) || typeof ev.name !== 'string') return;
  const it = ev.items;
  if (!isObj(it) || !count(it.plate) || !count(it.bowl) || !count(it.cup) || it.plate + it.bowl + it.cup < 1) return;
  const table = ev.table;
  if (s.tables.some(tb => tb.table === table)) return;   // a resend changes nothing
  arrive(s, layTable(ctx.rng, s.tier, table, ev.name, { plate: it.plate, bowl: it.bowl, cup: it.cup }, s.t));
}
function status(s: ClearState): StationStatus {
  const waiting = s.tables.length;
  return { waiting, idleFor: s.idleFor, load: Math.min(1, waiting / 3) };
}
const isKind = (x: unknown): x is Kind => x === 'plate' || x === 'bowl' || x === 'cup';
const isItem = (x: unknown): x is Item => isObj(x) && isKind(x.k) && num(x.x) && num(x.y) && num(x.rot) && num(x.r) && (x.goneAt === null || num(x.goneAt));
const isNoise = (x: unknown): x is Noise => isObj(x) && typeof x.k === 'string' && NOISE_KINDS.some(k => k === x.k) && num(x.x) && num(x.y) && num(x.rot) && num(x.s);
const isTable = (x: unknown): x is Table => isObj(x) && num(x.table) && typeof x.name === 'string' && num(x.at) && Array.isArray(x.items) && x.items.every(isItem)
  && Array.isArray(x.noise) && x.noise.every(isNoise) && num(x.taps) && num(x.resets);
const isDone = (x: unknown): x is Done => isTable(x) && isObj(x) && num(x.secs) && num(x.doneAt);
function validate(x: unknown): x is ClearState {
  if (!isObj(x) || x.v !== 1 || !num(x.tier) || x.tier < 1 || x.tier > TIER_MAX || typeof x.selfFeed !== 'boolean' || !num(x.seed) || !num(x.t)) return false;
  if (!Array.isArray(x.tables) || !x.tables.every(isTable) || !num(x.upAt) || !num(x.hold) || !num(x.pen) || !(x.lastK === null || isKind(x.lastK)) || !num(x.tapT)) return false;
  if (!(x.resetAt === null || num(x.resetAt)) || !num(x.resetTable)) return false;
  if (!(x.last === null || isDone(x.last))) return false;
  const se = x.sess;
  if (!isObj(se) || !num(se.tables) || !num(se.secs) || !num(se.taps) || !num(se.resets) || !num(se.best)) return false;
  return num(x.made) && num(x.idleFor) && num(x.cueN) && Array.isArray(x.cues);
}
export const clearBotModule: BotModule<ClearState, ClearCmd> = { next: (s, ctx) => clearBot(s, ctx) };
export const clear: StationModule<ClearState, ClearCmd, ClearResult> = {
  kind: 'clear', init, command, step, onEvent, status, bot: clearBotModule, validate,
};
