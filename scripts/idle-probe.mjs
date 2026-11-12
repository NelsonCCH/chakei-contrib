// Each seat's longest idle at the mid human profile (tests/sim/idle.js), for every party shop
// and player count and the co-op levels: prints the table (median over seeds / worst seed) and, with --check S, exits 1
// when a seat's median longest idle is over S seconds. Rooms run in worker threads (at most 6).
//   node scripts/idle-probe.mjs [--seeds 3] [--party estate,central] [--levels central,hell] [--check 6] [--out file]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

if (!isMainThread) {
  const { longestIdle } = await import('../tests/sim/idle.js');
  for (const j of workerData) { try { parentPort.postMessage({ ...j, ...longestIdle(j) }); } catch (e) { parentPort.postMessage({ ...j, err: String(e).slice(0, 200) }); } }
  parentPort.postMessage(null);
} else {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const { seatOrder } = await import('../tests/sim/idle.js');
  const { LEVEL_ORDER, LEVELS } = await import('../tests/sim/levels.js');
  const MAIN = LEVEL_ORDER.filter(id => !LEVELS[id].era && !LEVELS[id].fest);
  const seeds = Number(arg('seeds', 3)), party = arg('party', 'estate,central,mongkok,airport,hell').split(',').filter(Boolean);
  const levels = arg('levels', MAIN.join(',')).split(',').filter(Boolean), bound = arg('check', null);
  const jobs = [];
  for (const [mode, ids] of [['party', party], ['level', levels]]) for (const id of ids) {
    const n = seatOrder(mode, id).length;
    for (let k = 1; k <= n; k++) for (let s = 1; s <= seeds; s++) jobs.push({ mode, id, n: k, seed: 50 + s });
  }
  const W = Math.min(6, availableParallelism()), out = [], t0 = performance.now();
  await Promise.all(Array.from({ length: W }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(import.meta.filename, { workerData: jobs.filter((_, i) => i % W === w) });
    wk.on('message', m => { if (m === null) res(); else out.push(m); });
    wk.on('error', rej);
  })));
  const bad = out.filter(x => x.err || x.errs?.length); if (bad.length) console.log('ERRORS', bad.length, bad[0].err ?? bad[0].errs[0]);
  if (arg('out', null)) writeFileSync(arg('out'), JSON.stringify(out));
  const SEATS = ['floor1', 'floor2', 'waiter', 'bar', 'kitchen', 'till', 'runner', 'takeaway', 'roast'];   // 樓面's two party seats first
  const med = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  console.log(`${out.length} rooms in ${((performance.now() - t0) / 1000).toFixed(0)} s. Longest idle per seat, s: median over ${seeds} seeds / worst seed, then [the real-work gap's median: the longest stretch without a result] ('-': not held)`);
  const over = [];
  for (const mode of ['party', 'level']) {
    console.log(`\n| ${mode} | players | ${SEATS.join(' | ')} |\n|---|---|${SEATS.map(() => '---|').join('')}`);
    for (const id of mode === 'party' ? party : levels) for (let n = 1; n <= seatOrder(mode, id).length; n++) {
      const rows = out.filter(x => x.mode === mode && x.id === id && x.n === n && !x.err);
      console.log(`| ${id} | ${n} | ${SEATS.map(st => {
        const v = rows.map(x => x.idle?.[st]).filter(x => x !== undefined); if (!v.length) return '-';
        const m = med(v); if (bound !== null && m > Number(bound)) over.push(`${mode} ${id} x${n} ${st} ${m.toFixed(0)} s`);
        const g = rows.map(x => x.gap?.[st]).filter(x => x !== undefined);
        return `${m.toFixed(0)} / ${Math.max(...v).toFixed(0)}${g.length ? ` [${med(g).toFixed(0)}]` : ''}`;
      }).join(' | ')} |`);
    }
  }
  if (bound !== null) { console.log(`\nover ${bound} s: ${over.length}${over.length ? '\n  ' + over.join('\n  ') : ''}`); if (over.length) process.exitCode = 1; }
}
