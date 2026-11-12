// Solves the workload model's level specs (src/core/work/spec.ts WORK_LEVELS): for every level with
// `roles` (ui/levels.ts), the takeaway orders, their size, the 斬料 walk-ins, the dine-in party sizes, the
// floor's players that put each seat's busy share (tests/sim/workload.js: the customers' demand in a
// mid player's seconds) closest to the roster's mean. Coordinate descent over candidate values, each scored on the
// mean of a few seeds; the floor's players are worked out from the loads (they scale one seat only; the sink's pace was
// the other such lever before the 洗碗 seat was removed). The last
// line is the solved spec run as the game runs it: what tests/sim/workload.test.js checks with the same seeds.
// Deliveries follow the 外賣 tier (core/referee/work.ts deliversOn), so `deliver` is a share, not a switch.
//   node scripts/workload-solve.mjs [--seeds 3] [--only central,mongkok] [--jobs 4]
// Prints a table and the WORK_LEVELS literal to paste into spec.ts. Slow (a minute or so a level): run it in the background.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };

/** The candidates for each lever (the levels' own sizes first: the solver keeps them unless another is clearly better). */
const SIZES = [null, [.3, .6, .85], [.4, .7, .9], [.5, .8, .95], [.6, .88, .98], [.7, .93, 1]];
const TAKE = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];
const ITEMS = [1, 2, 3];
const CHOP = [0, 2, 4, 6, 8, 10];
const FLOOR = [1, 2, 3];

async function solveLevel(lv, seeds) {
  const { levelBalance } = await import('../tests/sim/workload.js');
  const { LEVELS } = await import('../tests/sim/levels.js');
  const roles = LEVELS[lv].roles ?? {};
  // score a spec: shares with the floor's players that fit best
  const score = spec => {
    const b = levelBalance(lv, seeds, { ...spec, floor: 1 });
    let best = null;
    for (const floor of FLOOR) {
      const sh = { ...b.share, floor: b.share.floor / floor };
      const mean = b.roster.reduce((a, k) => a + sh[k], 0) / b.roster.length, worst = Math.max(...b.roster.map(k => Math.abs(sh[k] / mean - 1)));
      if (!best || worst < best.worst - 1e-9) best = { floor, worst, share: sh, mean };
    }
    return { ...best, errs: b.errs };
  };
  let spec = { take: roles.takeaway ? 8 : 0, items: 2, deliver: 0.5, chop: roles.roast ? 8 : 0, sizes: null };
  let cur = score(spec), evals = 1;
  const levers = [['sizes', SIZES], ...(roles.takeaway ? [['take', TAKE], ['items', ITEMS]] : []), ...(roles.roast ? [['chop', CHOP]] : [])];
  for (let round = 0; round < 3; round++) {
    let moved = false;
    for (const [k, vals] of levers) for (const v of vals) {
      if (JSON.stringify(v) === JSON.stringify(spec[k])) continue;
      const s = { ...spec, [k]: v }, r = score(s); evals++;
      // a change must beat the current spread by a point (noise between seeds), so the levels keep their own values
      if (r.worst < cur.worst - 0.01) { spec = s; cur = r; moved = true; }
    }
    if (!moved) break;
  }
  const out = { take: spec.take, items: spec.items, deliver: spec.take ? spec.deliver : 0, chop: spec.chop, floor: cur.floor, ...(spec.sizes ? { sizes: spec.sizes } : {}) };
  const fin = levelBalance(lv, seeds, out);
  return { lv, spec: out, worst: fin.worst, share: fin.share, mean: fin.mean, evals, errs: fin.errs.slice(0, 3) };
}

if (!isMainThread) {
  parentPort.postMessage(await solveLevel(workerData.lv, workerData.seeds));
} else {
  const { LEVELS } = await import('../tests/sim/levels.js');
  const seeds = Array.from({ length: +arg('seeds', 3) }, (_, i) => 101 + i);
  const only = arg('only', ''), ids = Object.keys(LEVELS).filter(k => LEVELS[k].roles && (!only || only.split(',').includes(k)));
  const jobs = +arg('jobs', 4), res = [], queue = [...ids];
  const run = () => new Promise(done => {
    const next = () => {
      const lv = queue.shift(); if (!lv) { done(); return; }
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { lv, seeds } });
      w.once('message', m => { res.push(m); console.error(`${m.lv}: worst ${(100 * m.worst).toFixed(1)}% after ${m.evals} specs`); });
      w.once('error', e => { console.error(lv, e); next(); });
      w.once('exit', next);
    };
    next();
  });
  await Promise.all(Array.from({ length: jobs }, run));
  res.sort((a, b) => ids.indexOf(a.lv) - ids.indexOf(b.lv));
  console.log('| level | seats (busy share at mid) | worst off mean | spec |\n|---|---|---|---|');
  for (const m of res) console.log(`| ${m.lv} | ${Object.entries(m.share).map(([k, v]) => `${k} ${(100 * v).toFixed(0)}%`).join(', ')} | ${(100 * m.worst).toFixed(1)}% | ${JSON.stringify(m.spec)} |`);
  console.log('\nexport const WORK_LEVELS: Readonly<Record<string, WorkSpec>> = {');
  for (const m of res) console.log(`  ${m.lv}: ${JSON.stringify(m.spec).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')},`);
  console.log('};');
  for (const m of res) if (m.errs.length) console.log('errs', m.lv, m.errs);
}
