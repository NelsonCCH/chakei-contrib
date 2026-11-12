// Star lines and revenue medians for solo shifts at the extra seats, the way the four
// stations' were derived: the human model's mid profile (tests/sim/human.js) alone at the seat, the
// computer on the four shop stations (tests/sim/xseat.js runSeat), median of the seat's measure over seeds.
//   STAR_LINES: on each of the game's levels, 2★ = .9 x mid median, 1★ = .65 x 2★, 3★ = 1.35 x 2★ (as human-pace.mjs --lines).
//   REV_MEDIAN: the own shop, lunch, per difficulty, mid median (as the career targets).
//   STAR3: the seat's third-star speed line, the mid profile's 65th percentile of its average (levels pooled; free
//     play = own shop 熟手 lunch), and per runner floor tier; COMBO_SEAT: the mid median of the longest combo per difficulty.
// The measure is the seat's own (core/career/targets.ts shiftMeasure): 燒味 and 外賣 the money
// their own work booked, 傳菜 the dishes it put on their tables hot.
// Usage: node scripts/xseat-calibrate.mjs [--seeds 8] [--levels estate,central] [--kinds roast,takeaway]. Prints the entries
// to paste. Shifts run in worker threads (one per CPU, at most 6).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const KINDS = ['runner', 'roast', 'takeaway'], DIFFS = ['rookie', 'pro', 'ace'];

if (!isMainThread) {
  const { runSeat } = await import('../tests/sim/xseat.js');
  for (const j of workerData) {
    const r = runSeat({ seed: j.seed, kind: j.kind, ...(j.bot ? { pace: 1 } : { human: 'mid' }), ...(j.lv ? { lv: j.lv } : { diff: j.diff, slot: 'lunch' }) });
    const a = r.G.spd?.[j.kind], floor = j.kind === 'runner' ? r.C.runnerState()?.dk ?? null : null;
    parentPort.postMessage({ ...j, rev: r.C.shiftMeasure(r.G), spd: a && a[0] ? a[1] / a[0] : null, combo: r.G.maxCombo ?? 0, floor, err: r.errs.join('; ') || null });
  }
  parentPort.postMessage(null);
} else {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const { LEVEL_ORDER } = await import('../tests/sim/levels.js');
  const seeds = Number(arg('seeds', 8)), levels = arg('levels', LEVEL_ORDER.join(',')).split(','), kinds = arg('kinds', KINDS.join(',')).split(',');
  const jobs = [];
  for (const kind of kinds) for (let s = 1; s <= seeds; s++) {
    for (const lv of levels) jobs.push({ kind, lv, seed: 1000 + s * 17 + LEVEL_ORDER.indexOf(lv) * 3 });
    for (const diff of DIFFS) jobs.push({ kind, diff, seed: 101 + s });
    // 傳菜: the station's bot at full pace too, the floor under its third-star line
    if (kind === 'runner') {
      for (const lv of levels) jobs.push({ kind, lv, bot: true, seed: 1000 + s * 17 + LEVEL_ORDER.indexOf(lv) * 3 });
      for (const diff of DIFFS) jobs.push({ kind, diff, bot: true, seed: 101 + s });
    }
  }
  const n = Math.min(6, availableParallelism(), jobs.length), out = [], t0 = performance.now();
  await Promise.all(Array.from({ length: n }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(import.meta.filename, { workerData: jobs.filter((_, i) => i % n === w) });
    wk.on('message', m => { if (m === null) res(); else out.push(m); });
    wk.on('error', rej);
  })));
  console.log(`${out.length} shifts in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  const bad = out.filter(x => x.err);
  if (bad.length) console.log('ERRORS', bad.length, bad.slice(0, 3));
  const med = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
  const r10 = v => Math.round(v / 10) * 10, h = v => Math.round(v * 2) / 2, up = v => Math.ceil(v * 2) / 2;
  // the 傳菜 measure is a dish count: its lines round to the dish
  const rk = k => k === 'runner' ? Math.round : r10;
  const mids = out.filter(x => !x.bot), bots = out.filter(x => x.bot);
  const cell = (k, f) => med(mids.filter(x => x.kind === k && f(x)).map(x => x.rev));
  const spds = (k, f, rows = mids) => rows.filter(x => x.kind === k && f(x) && x.spd !== null).map(x => x.spd);
  // a third-star line: the mid profile's 65th percentile; 傳菜's at least the bot's slowest shift (the sims drive
  // the tray with that bot at every profile, so its hand is the floor's limit, not a better player's)
  const line = (k, f) => up(Math.max(pct(spds(k, f), .65), k === 'runner' ? pct(spds(k, f, bots), 1) : 0));

  console.log('\nmid medians per level (measure | speed median s | longest combo median):\n| level | ' + kinds.join(' | ') + ' |');
  for (const lv of levels) console.log(`| ${lv} | ${kinds.map(k => `${cell(k, x => x.lv === lv)} · ${h(med(spds(k, x => x.lv === lv)))} s · ${med(mids.filter(x => x.kind === k && x.lv === lv).map(x => x.combo))}`).join(' | ')} |`);
  console.log('\nSTAR_LINES extra-seat entries (append to each level row):');
  for (const lv of levels) console.log(`  ${lv}: ${kinds.map(k => { const r = rk(k), two = r(.9 * cell(k, x => x.lv === lv)); return `${k}: [${r(.65 * two)},${two},${r(1.35 * two)}]`; }).join(', ')}`);
  console.log('\nREV_MEDIAN extra-seat entries (own shop, lunch, mid median):');
  for (const d of DIFFS) console.log(`  ${d}: ${kinds.map(k => `${k}: ${rk(k)(cell(k, x => x.diff === d))}`).join(', ')}`);
  console.log('\nSTAR3 (mid 65th percentile of the average seconds; 傳菜 at least its bot\'s slowest shift): level = levels pooled, free = own shop 熟手');
  console.log(`  level: { ${kinds.map(k => `${k}: ${line(k, x => !!x.lv)}`).join(', ')} }`);
  console.log(`  free: { ${kinds.map(k => `${k}: ${line(k, x => x.diff === 'pro')}`).join(', ')} }`);
  console.log('\nSTAR3_LEVEL (per level):');
  for (const lv of levels) console.log(`  ${lv}: { ${kinds.map(k => `${k}: ${line(k, x => x.lv === lv)}`).join(', ')} },`);
  if (kinds.includes('runner')) {
    const floors = [...new Set(mids.filter(x => x.kind === 'runner').map(x => x.floor))];
    console.log(`  runner per floor, free play (RUNNER_STAR3): { ${floors.map(f => `${f}: ${line('runner', x => x.floor === f)}`).join(', ')} }`);
    console.log('  runner bot vs mid per level (median s per dish, hot dishes): ' + levels.map(lv => `${lv} ${h(med(spds('runner', x => x.lv === lv, bots)))}/${h(med(spds('runner', x => x.lv === lv)))} s, ${med(bots.filter(x => x.kind === 'runner' && x.lv === lv).map(x => x.rev))}/${cell('runner', x => x.lv === lv)}`).join('; '));
  }
  console.log('\nCOMBO_SEAT (mid median of the longest combo, own shop lunch):');
  for (const d of DIFFS) console.log(`  ${d}: { ${kinds.map(k => `${k}: ${med(mids.filter(x => x.kind === k && x.diff === d).map(x => x.combo))}`).join(', ')} }`);
}
