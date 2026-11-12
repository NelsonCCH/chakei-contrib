// The preview's playtest timing log: how fast a real person plays every mini-game, for
// calibrating the sims' human model (tests/sim/human.js). Mounted only with the 試玩 panel (index.ts playtestMount),
// i.e. only when /api/config says `playtest` (a Worker with PLAYTEST="1"); production never loads it and its Worker refuses the
// endpoint anyway (worker/index.ts /api/ptlog answers 404 without PLAYTEST).
//
// What a row holds (PtRow): the shift id `i` (random, per shift), `t` ms since that shift began on this page, the station
// `s`, the event `e` and, for a gesture, its name `g`, duration `d`, the gap since the station's previous gesture ended
// (`gap`, reach + decide), the read time `rd` (work appeared at an idle station -> this first touch), `ok`, a retry flag
// `r` (the same gesture again right after a mistake) and the mistakes `m`. The shift's first row ('shift') carries the
// context: mode, level, difficulty, slot, seat, role, every 試玩 slider and knob, device (UA, dpr, viewport, screen) and
// build version. Nothing personal: no name, account, audio or text the player typed; the device id is random.
//
// Transport: rows buffer in memory, batches of up to BATCH_MAX rows go out every FLUSH_MS (fetch, keepalive) and on
// pagehide (sendBeacon); unsent batches are kept in localStorage (offline: sent later). A batch keeps its number until
// the Worker has it, and the Worker ignores a (device, batch) pair it already holds, so a resend never doubles a row.
import { G } from '../core/state';
import { PT, type PtExtra, type PtSink } from '../core/playtest/hook';
import { stationOf } from '../core/coop/registry';

export interface PtRow {
  i: string; t: number; s: string; e: 'shift' | 'g' | 'miss' | 'done' | 'new' | 'pace' | 'seat' | 'end';
  g?: string; d?: number; gap?: number; rd?: number; ok?: 0 | 1; r?: 1; m?: string; x?: PtExtra;
}
interface Batch { b: number; ev: PtRow[] }
interface Kept { out: Batch[]; pend: PtRow[]; lost: number }

const DEV_KEY = 'ckf_pt_dev', BOX_KEY = 'ckf_pt_log', BN_KEY = 'ckf_pt_bn';
export const FLUSH_MS = 20000;
const BATCH_MAX = 400, KEEP_MAX = 6000, SAVE_MS = 3000, POLL_MS = 100;
const URL_LOG = '/api/ptlog';

const hex = (n: number): string => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); };
function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* full or private mode: memory only */ } }

let dev = '', ver = '', bn = 0, kept: Kept = { out: [], pend: [], lost: 0 }, dirty = false;
let ctxOf: () => PtExtra = () => ({});

/* ---------- the shift and the stations' open gestures ---------- */
interface Open { g: string; t: number; m: string[]; x: PtExtra | undefined }
interface StLog { lastEnd: number | null; lastG: string; lastOk: boolean; open: Open | null; newAt: number | null; w: number }
interface Shift { G: GameState; i: string; t0: number; st: Map<string, StLog>; seat: string }
let shift: Shift | null = null;

const now = (): number => (shift ? Math.round(performance.now() - shift.t0) : 0);
function push(r: PtRow): void { kept.pend.push(r); dirty = true; if (kept.pend.length >= BATCH_MAX) cut(); }
/** The shift the rows belong to: a new G starts a new one (with its context row), a finished shift is closed. */
function cur(): Shift | null {
  const S = G;
  if (shift && (shift.G !== S || !S.running)) endShift();
  if (!S || !S.running) return null;
  if (!shift) {
    shift = { G: S, i: hex(4), t0: performance.now(), st: new Map(), seat: seatNow(S) };
    push({ i: shift.i, t: 0, s: '', e: 'shift', x: { ...ctxOf(), ...device(), ver } });
  }
  return shift;
}
function endShift(): void {
  const sh = shift; if (!sh) return;
  const S = sh.G;
  push({ i: sh.i, t: now(), s: '', e: 'end', x: { sec: Math.round(S.t), rev: Math.round(S.revenue), served: S.served, mistakes: S.mistakes, angry: S.angry } });
  shift = null;
  void ptFlush();
}
function stOf(sh: Shift, s: string): StLog {
  let L = sh.st.get(s);
  if (!L) { L = { lastEnd: null, lastG: '', lastOk: true, open: null, newAt: null, w: 0 }; sh.st.set(s, L); }
  return L;
}
/** The row of a gesture that ends now (or at once, for a tap). */
function close(sh: Shift, s: string, L: StLog, o: Open, ok: boolean, end: number, x?: PtExtra, g?: string): void {
  const name = g ?? o.g, good = ok && !o.m.length;
  const r: PtRow = { i: sh.i, t: o.t, s, e: 'g', g: name, d: Math.max(0, end - o.t), ok: good ? 1 : 0 };
  if (L.lastEnd !== null) r.gap = Math.max(0, o.t - L.lastEnd);
  if (L.newAt !== null) { r.rd = Math.max(0, o.t - L.newAt); L.newAt = null; }
  if (!L.lastOk && L.lastG === name) r.r = 1;
  if (o.m.length) r.m = o.m.join(',');
  const xx = o.x || x ? { ...o.x, ...x } : undefined; if (xx) r.x = xx;
  push(r);
  L.lastEnd = end; L.lastG = name; L.lastOk = good; L.open = null;
}
function open(L: StLog, g: string, x?: PtExtra): void { L.open = { g, t: now(), m: [], x }; }

const SINK: PtSink = {
  down(s, g, x) { const sh = cur(); if (!sh) return; const L = stOf(sh, s); if (L.open) close(sh, s, L, L.open, false, now(), { cut: 1 }); open(L, g, x); },
  up(s, ok, x, g) { const sh = cur(); if (!sh) return; const L = stOf(sh, s); if (L.open) close(sh, s, L, L.open, ok, now(), x, g); },
  tap(s, g, ok, x) { const sh = cur(); if (!sh) return; const L = stOf(sh, s), t = now(); if (L.open) close(sh, s, L, L.open, false, t, { cut: 1 }); close(sh, s, L, { g, t, m: [], x: undefined }, ok, t, x); },
  miss(s, what) { const sh = cur(); if (!sh) return; const L = stOf(sh, s); if (L.open) L.open.m.push(what); else { push({ i: sh.i, t: now(), s, e: 'miss', m: what }); L.lastOk = false; } },
  done(s, what, x) { const sh = cur(); if (!sh) return; const r: PtRow = { i: sh.i, t: now(), s, e: 'done', g: what }; if (x) r.x = x; push(r); },
  fresh(s) { const sh = cur(); if (!sh) return; const L = stOf(sh, s); if (!L.open && L.newAt === null) L.newAt = now(); },
};
/** A moved 試玩 slider (index.ts playtestSet). */
export function ptPace(st: string, v: number): void { const sh = cur(); if (sh) push({ i: sh.i, t: now(), s: st, e: 'pace', x: { v } }); }

/** The seats this phone's player drives now ('+'-joined, sorted; the 樓面 floor's aggregate roles left out). */
const seatNow = (S: GameState): string => Object.entries(S.roles).filter(([k, v]) => v === 'me' && k !== 'floor' && !(k === 'waiter' && S.floor)).map(([k]) => k).sort().join('+');
/**
 * Every POLL_MS while a shift runs: work waiting at each station this phone holds (core/coop/registry.ts `waiting`).
 * A rise logs a 'new' row; work showing up at a station with nothing waiting and no finger down starts its read clock.
 * `extra` runs the observers that watch a station's own state (observe.ts: the 傳菜 trips).
 */
/**
 * A seat change mid-shift: the strip's 換做 / 返做, a cover taken back, a grant arriving. Run by the poll, and
 * by PT.move just before this phone's own switch: a switch made before the shift's first poll (100 ms) used to find
 * the shift starting at the new seat, so its row was lost.
 */
function seatCheck(sh: Shift): void {
  const seat = seatNow(sh.G);
  // a co-op hand-over passes through no seat for a moment (released, then taken): log one move from the last real seat
  if (!seat && sh.seat) return;
  if (seat !== sh.seat) { if (sh.seat || seat) push({ i: sh.i, t: now(), s: '', e: 'seat', x: { from: sh.seat, to: seat } }); sh.seat = seat; }
}
function poll(extra: () => void): void {
  const sh = cur(); if (!sh || sh.G.paused) return;
  seatCheck(sh);
  for (const [s, who] of Object.entries(sh.G.roles)) {
    if (who !== 'me') continue;
    const m = stationOf(s); if (!m) continue;
    let w: number; try { w = m.waiting(sh.G); } catch { continue; }
    const L = stOf(sh, s);
    if (w > L.w) { push({ i: sh.i, t: now(), s, e: 'new', x: { w } }); if (L.w === 0 && !L.open && L.newAt === null) L.newAt = now(); }
    L.w = w;
  }
  extra();
}

/* ---------- device, storage, transport ---------- */
function device(): PtExtra {
  const sc = window.screen;
  return { ua: navigator.userAgent.slice(0, 200), dpr: Math.round(window.devicePixelRatio * 100) / 100, vw: window.innerWidth, vh: window.innerHeight,
    sw: sc.width, sh: sc.height, touch: navigator.maxTouchPoints, dev };
}
function load(): void {
  dev = lsGet(DEV_KEY) ?? ''; if (!/^[0-9a-f]{16}$/.test(dev)) { dev = hex(8); lsSet(DEV_KEY, dev); }
  bn = Number(lsGet(BN_KEY)) || 0;
  try {
    const k: unknown = JSON.parse(lsGet(BOX_KEY) ?? 'null');
    if (typeof k === 'object' && k !== null && Array.isArray(Reflect.get(k, 'out')) && Array.isArray(Reflect.get(k, 'pend'))) {
      const out: unknown = Reflect.get(k, 'out'), pend: unknown = Reflect.get(k, 'pend'), lost: unknown = Reflect.get(k, 'lost');
      kept = { out: Array.isArray(out) ? out.filter(isBatch) : [], pend: Array.isArray(pend) ? pend.filter(isRow) : [], lost: typeof lost === 'number' ? lost : 0 };
    }
  } catch { /* a broken box: start empty */ }
  const tag = document.querySelector<HTMLScriptElement>('script[src*="app.js"]');
  ver = (tag ? /[?&]v=([\w.-]+)/.exec(tag.src)?.[1] : undefined) ?? '';
}
const isRow = (r: unknown): r is PtRow => typeof r === 'object' && r !== null && typeof Reflect.get(r, 'i') === 'string' && typeof Reflect.get(r, 't') === 'number' && typeof Reflect.get(r, 'e') === 'string';
const isBatch = (b: unknown): b is Batch => typeof b === 'object' && b !== null && typeof Reflect.get(b, 'b') === 'number' && Array.isArray(Reflect.get(b, 'ev'));
/** Pending rows become a numbered batch (kept until the Worker has it). The oldest batches go past KEEP_MAX rows. */
function cut(): void {
  if (!kept.pend.length) return;
  bn++; lsSet(BN_KEY, String(bn));
  kept.out.push({ b: bn, ev: kept.pend.splice(0, BATCH_MAX) });
  let n = kept.out.reduce((a, x) => a + x.ev.length, 0) + kept.pend.length;
  while (n > KEEP_MAX && kept.out.length > 1) { const x = kept.out.shift(); n -= x ? x.ev.length : 0; kept.lost += x ? x.ev.length : 0; }
  dirty = true;
}
function save(): void { if (!dirty) return; dirty = false; lsSet(BOX_KEY, JSON.stringify(kept)); }
const body = (x: Batch): string => JSON.stringify({ v: 1, dev, b: x.b, ver, lost: kept.lost, ev: x.ev });

let sending = false;
/** Sends every kept batch now; resolves to the rows the Worker took. Never throws (offline: kept for later). */
export async function ptFlush(): Promise<number> {
  if (!dev || sending) return 0;
  sending = true; cut();
  let n = 0;
  try {
    for (const x of [...kept.out]) {
      let ok = false;
      try { const r = await fetch(URL_LOG, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body(x), keepalive: true }); ok = r.ok; } catch { ok = false; }
      if (!ok) break;
      kept.out = kept.out.filter(y => y !== x); n += x.ev.length; kept.lost = 0; dirty = true;
    }
  } finally { sending = false; save(); }
  return n;
}
/** The page is going away: what is left goes by beacon (and stays kept: a beacon that never arrives is sent again). */
function bye(): void {
  cur(); cut(); save();
  if (typeof navigator.sendBeacon !== 'function') return;
  for (const x of kept.out) navigator.sendBeacon(URL_LOG, new Blob([body(x)], { type: 'application/json' }));
}

/** Rows not yet sent (tests). */
export const ptPending = (): number => kept.pend.length + kept.out.reduce((a, x) => a + x.ev.length, 0);

let started = false;
/** Starts the log (once): the hooks' sink, the poll, the flush timer, pagehide. `ctx`: the shift's context row. */
export function ptLogStart(ctx: () => PtExtra, observe: () => void): void {
  if (started) return; started = true;
  ctxOf = ctx; load();
  PT.sink = SINK;
  PT.move = () => { const sh = cur(); if (sh) seatCheck(sh); };
  setInterval(() => { poll(observe); }, POLL_MS);
  setInterval(save, SAVE_MS);
  setInterval(() => { void ptFlush(); }, FLUSH_MS);
  window.addEventListener('pagehide', bye);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { cut(); save(); void ptFlush(); } });
  void ptFlush();   // what an earlier visit left (offline then)
}
