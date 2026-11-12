// Reads the preview's playtest timing log (src/playtest/log.ts -> D1 table playtest_log) and prints, per
// station and per gesture, how fast the player really was, beside what the sims' human model assumes for its first-timer
// / mid / skilled profiles (tests/sim/human.js PROFILES, TAKE_HAND), and which profile the player is closest to.
//
// Usage:
//   node scripts/playtest-log.mjs                    the deployed D1 (wrangler d1 execute chakei --remote: your
//                                                    wrangler login, no token printed)
//   node scripts/playtest-log.mjs --local <dir>      a local test Worker's D1 (tests/helpers/server.js `dir`)
//   node scripts/playtest-log.mjs --file <rows.json> rows saved earlier with --dump
//   options: --since <id> (batches after that row id), --dev <device id>, --shift <shift id>, --dump <file> (save the
//            rows), --events (print every event instead of the summary)
// Read-only.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROFILES, TAKE_HAND } from '../tests/sim/human.js';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const IDLE_MS = 8000;   // a gap longer than this is waiting for work, not reach + decide

/* ---------- read the rows ---------- */
function query(sql) {
  const wrangler = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const local = opt('--local');
  const a = local
    ? [wrangler, 'd1', 'execute', 'chakei', '--local', '--persist-to', local, '--json', '--command', sql]
    : [wrangler, 'd1', 'execute', 'chakei', '--remote', '--json', '--command', sql];
  const out = execFileSync(process.execPath, a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });
  const j = JSON.parse(out.slice(out.indexOf('[')));
  return j.flatMap(r => r.results ?? []);
}
function rows() {
  const file = opt('--file');
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  const all = [];
  for (let since = Number(opt('--since') ?? 0); ;) {
    const page = query(`SELECT id, dev, b, at, ver, lost, body FROM playtest_log WHERE id > ${since} ORDER BY id LIMIT 200`);
    all.push(...page);
    if (page.length < 200) break;
    since = page[page.length - 1].id;
  }
  return all;
}

/* ---------- the model's numbers (seconds) ---------- */
const bits = n => Math.log2(n + 1);
/** What the human model costs before a gesture of this kind lands (its draws are log-normal, so the median is the mean
 *  given). null: the model has no figure for it. */
function model(st, g, P, id) {
  const T = TAKE_HAND[id];
  const [fn, k] = g.split(':');
  switch (st) {
    case 'waiter':
      if (fn === 'tapTable' || fn === 'tapGroup') return P.move + P.react;
      if (fn === 'sheetAct') return k === 'add' ? P.move + P.hick * bits(12) : k === 'send' || k === 'later' ? P.move : P.move + P.hick * bits(3);
      return P.move;
    case 'bar':
      if (fn === 'pickLine') return P.move + P.react + P.read * 0.5;
      return k === 'pot' || k === 'dump' ? P.move + P.react : k === 'serve' ? P.move : k === 'hot' || k === 'cold' ? P.move + P.hick * bits(2) : P.move + P.hick * bits(8);
    case 'kitchen':
      if (fn === 'pickPlate') return P.move + P.react;
      if (fn === 'assignMeal') return P.move + P.react + P.read * 0.5;
      return k === 'dump' ? P.move + P.react : k === 'serve' ? P.move : P.move + P.hick * bits(10);
    case 'till':
      if (fn === 'strikeLine') return P.move + P.react;
      return k === 'ok' || k === 'clr' ? P.move : P.move + P.hick * 0.3 * bits(10);
    case 'takeaway':
      return g === 'drag' || g === 'hand' ? P.react * 0.5 + P.move : g === 'tray' ? P.hick * bits(5) + P.move : g === 'tieBtn' ? P.move : g === 'trace' ? P.react + P.move : null;
    case 'runner': case 'roast':
      return P.move + P.react;   // these seats' sims stream the station bot (the coarse model): a generic decide + reach
    default: return null;
  }
}
/** The model's speed for a drag (css px/s) or its share of par for a knot trace. */
function modelSpeed(st, g, P, id) {
  if (st === 'takeaway' && (g === 'drag' || g === 'hand')) return TAKE_HAND[id].drag;
  return null;
}
const IDS = ['first', 'mid', 'skilled'];

/* ---------- stats ---------- */
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const f1 = v => v === null || v === undefined ? '-' : v >= 100 ? String(Math.round(v)) : v.toFixed(2);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
/** The profile whose figure is nearest the measured one (on a log scale: twice as slow is as far as half). */
function nearest(meas, figs) {
  let best = '-', bd = Infinity;
  figs.forEach((v, i) => { if (v === null || !meas || !v) return; const d = Math.abs(Math.log(meas / v)); if (d < bd) { bd = d; best = IDS[i]; } });
  return best;
}

function summarize(ev) {
  const shifts = new Map();
  for (const e of ev) { if (!shifts.has(e.i)) shifts.set(e.i, []); shifts.get(e.i).push(e); }
  const out = [];
  out.push(`playtest timing log: ${ev.length} events, ${shifts.size} shifts`);
  for (const [i, list] of shifts) {
    const h = list.find(e => e.e === 'shift')?.x ?? {}, end = list.find(e => e.e === 'end')?.x;
    const pace = Object.entries(h).filter(([k, v]) => k.startsWith('p_') && v !== 5).map(([k, v]) => `${k.slice(2)}=${v}`).join(' ');
    out.push(`  shift ${i}: ${h.mode ?? '?'} ${h.level ? `level ${h.levelN ?? ''} ${h.levelName ?? h.level}` : ''} diff ${h.diff ?? '?'} ${h.slot ?? ''} seat ${h.seat ?? '?'} ${h.role ?? ''}`
      + `${pace ? ` | sliders ${pace}` : ''} | ${h.vw ?? '?'}x${h.vh ?? '?'} dpr ${h.dpr ?? '?'} build ${h.ver || '?'}${end ? ` | ${end.sec}s $${end.rev}` : ' | (no end row)'}`);
    // seat changes mid-shift: "64.8 s runner -> waiter"
    const sw = list.filter(e => e.e === 'seat').sort((a, b) => a.t - b.t);
    if (sw.length) out.push(`    seats: ${sw.map(e => `${(e.t / 1000).toFixed(1)} s ${e.x?.from || '-'} -> ${e.x?.to || '-'}`).join(', ')}`);
  }
  // per station x gesture
  const by = new Map();
  const key = (s, g) => `${s}\u0000${g}`;
  for (const e of ev) {
    if (e.e !== 'g') continue;
    const k = key(e.s, e.g);
    if (!by.has(k)) by.set(k, { s: e.s, g: e.g, n: 0, ok: 0, d: [], gap: [], rd: [], r: 0, idle: 0, m: {}, sp: [], share: [] });
    const b = by.get(k);
    b.n++; if (e.ok) b.ok++; if (e.r) b.r++;
    b.d.push(e.d / 1000);
    if (e.rd !== undefined) b.rd.push(e.rd / 1000);
    else if (e.gap !== undefined) { if (e.gap <= IDLE_MS) b.gap.push(e.gap / 1000); else b.idle++; }
    if (e.m) for (const m of e.m.split(',')) b.m[m] = (b.m[m] ?? 0) + 1;
    if (e.x?.px && e.d > 0) b.sp.push(e.x.px / (e.d / 1000));
    if (e.x?.par && e.x?.tt) b.share.push(e.x.par / e.x.tt);
  }
  const groups = [...by.values()].sort((a, b) => a.s.localeCompare(b.s) || b.n - a.n);
  out.push('', 'per gesture: n, ok%, retries, median gap before it (reach + decide; gaps over 8 s are idle), read (work appeared at an idle station -> touch),');
  out.push('duration, drag speed (css px/s) or knot speed (share of par), mistakes; model = the sims\' first / mid / skilled figure for the gap (s)');
  out.push([pad('station', 9), pad('gesture', 18), lpad('n', 4), lpad('ok%', 5), lpad('retry', 6), lpad('gap', 6), lpad('read', 6), lpad('dur', 6), lpad('speed', 7), '  model f/m/s', '  closest', '  mistakes'].join(''));
  for (const b of groups) {
    const gap = med(b.gap), figs = IDS.map(id => model(b.s, b.g, PROFILES[id], id));
    const sp = b.share.length ? med(b.share) : med(b.sp), spFig = IDS.map(id => b.share.length ? TAKE_HAND[id].trace : modelSpeed(b.s, b.g, PROFILES[id], id));
    const closest = gap !== null && figs[0] !== null ? nearest(gap, figs) : '-';
    const spClosest = sp !== null && spFig[0] !== null && spFig[0] !== undefined ? ` (${b.share.length ? 'knot' : 'drag'} ~${nearest(sp, spFig)})` : '';
    const mist = Object.entries(b.m).map(([k, v]) => `${k} ${v}`).join(', ');
    out.push([pad(b.s, 9), pad(b.g, 18), lpad(b.n, 4), lpad(Math.round(b.ok / b.n * 100), 5), lpad(b.r, 6), lpad(f1(gap), 6), lpad(f1(med(b.rd)), 6), lpad(f1(med(b.d)), 6),
      lpad(f1(sp), 7), '  ' + (figs[0] === null ? '-' : figs.map(f1).join('/')), '  ' + closest + spClosest, mist ? '  ' + mist : ''].join(''));
  }
  // per station: tasks and the whole station
  out.push('', 'per station: gestures, finished tasks, median seconds a task (first touch after the last one -> done), mistakes off a gesture, read medians');
  const sts = [...new Set(ev.filter(e => e.s).map(e => e.s))].sort();
  for (const s of sts) {
    const mine = ev.filter(e => e.s === s), g = mine.filter(e => e.e === 'g'), done = mine.filter(e => e.e === 'done');
    const task = [];
    for (const list of shifts.values()) {
      let first = null;
      for (const e of list) {
        if (e.s !== s) continue;
        if (e.e === 'g' && first === null) first = e.t;
        if (e.e === 'done') { if (first !== null) task.push((e.t - first) / 1000); first = null; }
      }
    }
    const loose = mine.filter(e => e.e === 'miss').length, rd = g.filter(e => e.rd !== undefined).map(e => e.rd / 1000);
    const kinds = [...new Set(done.map(e => e.g))].join('/');
    out.push(`  ${pad(s, 9)} ${lpad(g.length, 4)} gestures, ${lpad(done.length, 3)} done${kinds ? ` (${kinds})` : ''}, task ${f1(med(task))} s, ${loose} other mistakes, read ${f1(med(rd))} s (n ${rd.length}); model read f/m/s ${IDS.map(id => f1(PROFILES[id].react + PROFILES[id].read)).join('/')}`);
  }
  return out.join('\n');
}

/* ---------- main ---------- */
const raw = rows();
if (opt('--dump')) writeFileSync(opt('--dump'), JSON.stringify(raw));
let ev = raw.flatMap(r => { try { return JSON.parse(r.body).map(e => ({ ...e, dev: r.dev })); } catch { return []; } });
if (opt('--dev')) ev = ev.filter(e => e.dev === opt('--dev'));
if (opt('--shift')) ev = ev.filter(e => e.i === opt('--shift'));
const lost = raw.reduce((a, r) => Math.max(a, r.lost ?? 0), 0);
if (args.includes('--events')) for (const e of ev) console.log(JSON.stringify(e));
else {
  console.log(summarize(ev));
  console.log(`\n${raw.length} batches from ${new Set(raw.map(r => r.dev)).size} device(s)${lost ? `; a device dropped ${lost} events offline` : ''}`);
}
