// The workload model's load table, measured with the human player model
// (tests/sim/human.js): how many seconds of a person's work each task puts on its seat.
//   The shop's four: the human model plays the station alone (tests/sim/shift.js) and every press it pays for is tagged
//   with the task it belongs to (seat a party, take an order, clear a table, a drink, a meal, a bill); seconds per task
//   are the tagged press time over the tasks done (an order and a bill are fitted as base + per diner / per line).
//   The extra seats: the human model at the seat (tests/sim/xseat.js), the computer at the four; a seat is "engaged"
//   while it holds a job (a cut on the board, a trip under way, a bag being packed or tied, a piece in the sink), and
//   seconds per task are engaged time over the tasks done.
// It prints the measured table next to core's LOAD (src/core/work/load.ts) and exits 1 with --check when a measured
// entry is more than 20% off (the table is then out of date: paste the printed values). Tasks with no station yet
// (執枱 count-and-tap, 送外賣 trip) are design values from the human model's own constants, printed for reference.
//   node scripts/workload-calibrate.mjs [--seeds 4] [--profile mid] [--check]
// Shifts run in worker threads (one per CPU, at most 6).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const FOUR = ['waiter', 'bar', 'kitchen', 'till'], EXTRAS = ['runner', 'roast', 'takeaway'];
/** One level per slot plus two busy ones, so a meal and an order are averaged over the menus people meet. */
const LEVELS = { lunch: ['estate', 'airport', 'typhoon'], breakfast: ['central'], dinner: ['mongkok', 'newyear'] };

/** Least squares y = a + b x over [x, y] points (b >= 0). */
function fit(pts) {
  const n = pts.length; if (!n) return { a: 0, b: 0, n };
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0), sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const b = sxx > 0 ? Math.max(0, sxy / sxx) : 0;
  return { a: my - b * mx, b, n };
}

async function four(job) {
  const { runShift } = await import('../tests/sim/shift.js');
  const per = {};   // order: gid -> [diners, s]; till: cid -> [lines, s]
  const tag = (C, st, x) => {
    const G = C.G;
    if (st === 'waiter') {
      if (x.gid !== undefined) { (per['o' + x.gid] ??= [C.byId(x.gid)?.persons?.length ?? 1, 0]); return 'o' + x.gid; }
      if (x.fn === 'tapGroup' || x.fn === 'deselect') return 'seat';
      if (x.fn === 'tapTable') {
        const sel = G.selected != null ? C.byId(G.selected) : null;
        if (sel && sel.state === 'queue') return 'seat';
        const g = G.groups.find(y => y.table === x.args[0] && y.state === 'order');
        if (g) { (per['o' + g.id] ??= [g.persons.length, 0]); return 'o' + g.id; }
        return 'clear';
      }
      return 'waiterOther';
    }
    if (st === 'till') { const c = G.cur; if (!c) return 'tillOther'; (per['b' + c.id] ??= [c.payLines.length, 0]); return 'b' + c.id; }
    return st;
  };
  const counts = { seat: 0, clear: 0, sent: 0 };
  let wrapped = false;
  const before = C => {
    if (wrapped) return; wrapped = true;
    const H = C.CORE_HOOK, { seat, cleanTable, submitOrder } = H;
    H.seat = (...a) => { counts.seat++; return seat(...a); };
    H.cleanTable = (...a) => { counts.clear++; return cleanTable(...a); };
    H.submitOrder = (...a) => { counts.sent++; return submitOrder(...a); };
  };
  const r = runShift({ seed: job.seed, station: job.st, lv: job.lv, human: job.prof, tag, before });
  const h = r.human[job.st], by = h.by, G = r.C.G;
  for (const [k, s] of Object.entries(by)) if (per[k]) per[k][1] += s;
  return {
    ...job, err: r.errs.join('; ') || null, by, counts, cups: G.cups | 0, dishes: G.dishes | 0, busy: h.busy, clock: h.clock,
    orders: Object.entries(per).filter(([k]) => k[0] === 'o').map(([, v]) => v),
    bills: Object.entries(per).filter(([k]) => k[0] === 'b').map(([, v]) => v),
  };
}

/** A seat holds a job (the person is working, not waiting for work). */
const ENGAGED = {
  roast: s => !!s.board || s.plate.base !== null || s.plate.items.length > 0,
  runner: s => s.st !== 'pick' && s.st !== 'end',
  // packing while a made item sits on the counter, then tying and handing over (not waiting for the kitchen)
  takeaway: s => s.phase !== 'pack' || s.drag !== null || s.counter.some(c => c !== null),
};
const STATE = { roast: 'roastState', runner: 'runnerState', takeaway: 'takeawayState' };
async function extra(job) {
  const { runSeat } = await import('../tests/sim/xseat.js');
  let eng = 0;
  const each = (C, dt) => { const s = C[STATE[job.st]](); if (s && ENGAGED[job.st](s)) eng += dt; };
  const r = runSeat({ seed: job.seed, kind: job.st, human: job.prof, lv: job.lv, each });
  const s = r.st, G = r.G;
  const units = job.st === 'roast' ? s.served : job.st === 'runner' ? s.run.trip : s.results.length;
  const items = job.st === 'takeaway' ? s.orders.filter(o => o.done).reduce((a, o) => a + o.items.length, 0) : job.st === 'runner' ? G.pass?.carried ?? 0 : 0;
  return { ...job, err: r.errs.join('; ') || null, eng, units, items, tables: job.st === 'runner' ? s.run.done : 0 };
}

if (!isMainThread) {
  for (const job of workerData) parentPort.postMessage(FOUR.includes(job.st) ? await four(job) : await extra(job));
  parentPort.postMessage(null);
} else {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const seeds = Number(arg('seeds', 4)), prof = arg('profile', 'mid');
  const jobs = [];
  for (const [slot, lvs] of Object.entries(LEVELS)) for (const lv of lvs) for (let s = 1; s <= seeds; s++) {
    for (const st of FOUR) jobs.push({ st, lv, slot, prof, seed: 2000 + s * 13 });
    if (slot === 'lunch') for (const st of EXTRAS) jobs.push({ st, lv, slot, prof, seed: 2000 + s * 13 });
  }
  const n = Math.min(6, availableParallelism(), jobs.length), out = [], t0 = performance.now();
  await Promise.all(Array.from({ length: n }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(import.meta.filename, { workerData: jobs.filter((_, i) => i % n === w) });
    wk.on('message', m => { if (m === null) res(); else out.push(m); });
    wk.on('error', rej);
  })));
  console.log(`${out.length} shifts in ${((performance.now() - t0) / 1000).toFixed(0)} s (profile ${prof})`);
  const bad = out.filter(x => x.err);
  if (bad.length) console.log('ERRORS', bad.length, bad.slice(0, 3).map(x => x.err));
  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
  const of = (st, slot) => out.filter(x => !x.err && x.st === st && (!slot || x.slot === slot));
  const m = {};
  const W = of('waiter');
  m.seat = sum(W, x => x.by.seat ?? 0) / Math.max(1, sum(W, x => x.counts.seat));
  m.clearTap = sum(W, x => x.by.clear ?? 0) / Math.max(1, sum(W, x => x.counts.clear));
  for (const slot of Object.keys(LEVELS)) {
    const o = fit(of('waiter', slot).flatMap(x => x.orders.filter(([d]) => d > 0)));
    m['order.' + slot] = o;
    const B = of('bar', slot), K = of('kitchen', slot);
    m['drink.' + slot] = sum(B, x => x.busy) / Math.max(1, sum(B, x => x.cups));
    m['meal.' + slot] = sum(K, x => x.busy) / Math.max(1, sum(K, x => x.dishes));
    m['bill.' + slot] = fit(of('till', slot).flatMap(x => x.bills));
  }
  for (const st of EXTRAS) {
    const X = of(st);
    m[st] = { perUnit: sum(X, x => x.eng) / Math.max(1, sum(X, x => x.units)), units: sum(X, x => x.units) / Math.max(1, X.length), items: sum(X, x => x.items) / Math.max(1, sum(X, x => x.units)), tables: sum(X, x => x.tables) / Math.max(1, sum(X, x => x.units)) };
  }
  console.log(JSON.stringify(m, null, 1));
  // measured against core's table: an order of 2 diners, a bill of 3 lines; design entries are printed, not checked
  const { freshCore } = await import('../tests/sim/core.js');
  const C = freshCore(), T = (k, n, slot) => C.taskSec(k, n, slot), rows = [];
  const row = (task, have, got, design = false) => rows.push({ task, have, got, off: got / have - 1, design });
  row('seat', T('seat'), m.seat);
  row('clear (one tap today; the table is count-and-tap)', T('clear', 1), m.clearTap, true);
  for (const slot of Object.keys(LEVELS)) {
    const o = m['order.' + slot], b = m['bill.' + slot];
    row(`order of 2 (${slot})`, T('order', 2, slot), o.a + 2 * o.b);
    row(`drink (${slot})`, T('drink', 0, slot), m['drink.' + slot]);
    row(`meal (${slot})`, T('meal', 0, slot), m['meal.' + slot]);
    row(`bill of 3 lines (${slot})`, T('pay', 3, slot), b.a + 3 * b.b);
  }
  row('carry (a 傳菜 trip)', T('carry'), m.runner.perUnit);
  row('chop (a roast dish)', T('chop'), m.roast.perUnit);
  row(`bag (${m.takeaway.items.toFixed(1)} items; the 外賣 hand)`, T('bag', m.takeaway.items), m.takeaway.perUnit);
  console.log('\n| task | core LOAD (s) | measured (s) | off |\n|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.task}${r.design ? ' [design]' : ''} | ${r.have.toFixed(1)} | ${r.got.toFixed(1)} | ${(100 * r.off).toFixed(0)}% |`);
  const out20 = rows.filter(r => !r.design && Math.abs(r.off) > 0.2);
  if (process.argv.includes('--check') && out20.length) { console.log('\nmore than 20% off:', out20.map(r => r.task).join('; ')); process.exit(1); }
}
