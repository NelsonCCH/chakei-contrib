// Measures every level at a person's speed: the human player model (tests/sim/human.js,
// first-timer / mid / skilled) at each station of each of the game's levels (tests/sim/levels.js reads ui/levels.ts),
// alone (the computer covers the other stations) and in a co-op room with computer teammates, plus the extra seats
// in a room. Prints the tables and, with --lines, the solo star lines and third-star speed lines from the
// mid profile. Served % = groups that got their food and drinks out of those that did not walk out; at the till a bill
// that ran (走數) counts as a walk-out instead.
//   node scripts/human-pace.mjs [--seeds 6] [--levels estate,central] [--modes solo,coop,extra] [--out file] [--lines]
// Shifts run in worker threads (one per CPU, at most 6), each a fresh copy of the shop's rules.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';

const ROOT = join(import.meta.dirname, '..');
const STATIONS = ['waiter', 'bar', 'kitchen', 'till'];
const EXTRAS = ['runner', 'roast', 'takeaway'];
const PROFILES = ['first', 'mid', 'skilled'];

async function shift(job) {
  const { runShift } = await import('../tests/sim/shift.js');
  const { runCoop } = await import('../tests/sim/coop.js');
  const { st, prof, mode, seed, diff, slot = 'lunch' } = job, lv = diff ? undefined : job.lv;   // free play: `lv` names the difficulty
  if (job.set && !diff) Object.assign((await import('../tests/sim/levels.js')).LEVELS[lv], job.set);   // a sweep (--set gap=2,pat=1.5)
  const dset = diff ? job.set : undefined;   // free play (--free): the sweep goes into DIFFS[diff]
  let r, G, cust, h;
  if (mode === 'solo') {
    // roles: a level's stations run, the computer at each, as ui/main.ts start does; free play has none
    r = runShift({ seed, station: st, slot, lv, roles: !!lv, human: prof === 'bot' ? undefined : prof, diff: diff || 'pro', dset });
    G = r.C.G; cust = r.cust; h = r.human && r.human[st];
  } else {
    const extra = EXTRAS.includes(st);
    r = runCoop({ seed, seats: extra ? [null, st] : [st], lv, diff, dset, slot, extraSeats: extra ? [st] : undefined, human: prof === 'bot' ? undefined : { [extra ? 1 : 0]: prof }, shape: 'clean' });
    G = r.S; cust = r.cust; h = r.human && r.human[st];
  }
  if (r.errs.length) return { ...job, err: r.errs.slice(0, 2).join('; ') };
  const spd = G.spd && G.spd[st] && G.spd[st][0] ? G.spd[st][1] / G.spd[st][0] : null;
  const busy = h ? h.busy / Math.max(1, h.clock) : null, idle = h ? h.idle / Math.max(1, h.clock) : null;
  return { ...job, rev: G.revenue, served: cust.served, came: cust.came, perMin: cust.perMin, walk: cust.walkouts + (st === 'till' ? cust.ranTill : 0), servedPct: st === 'till' ? 100 * (cust.served - cust.ranTill) / Math.max(1, cust.served + cust.walkouts) : cust.servedPct, why: cust.why,
    turned: cust.turned, ran: cust.ranTill, mistakes: G.mistakes, dishes: G.dishes | 0, cups: G.cups | 0, spd, busy, idle, taps: h ? h.taps : null,
    stale: G.pass ? G.pass.stale | 0 : null };
}

if (!isMainThread) {
  for (const job of workerData) parentPort.postMessage(await shift(job));
  parentPort.postMessage(null);
} else {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const { LEVEL_ORDER, LEVELS } = await import('../tests/sim/levels.js');
  // --free: free play (own shop) instead of levels; --levels then lists difficulties (rookie,pro,ace), --slot picks the slot
  const free = process.argv.includes('--free'), slot = arg('slot', 'lunch');
  const seeds = Number(arg('seeds', 6)), levels = arg('levels', free ? 'rookie,pro,ace' : LEVEL_ORDER.join(',')).split(','), modes = arg('modes', free ? 'solo,coop' : 'solo,coop,extra').split(',');
  const profs = arg('profiles', PROFILES.join(',')).split(','), stations = arg('stations', null);
  const set = arg('set', null) ? Object.fromEntries(arg('set').split(',').map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; })) : undefined;
  if (set && !free) for (const lv of levels) Object.assign(LEVELS[lv], set);
  const jobs = [];
  for (const lv of levels) for (const mode of modes) for (const st of stations ? stations.split(',') : mode === 'extra' ? EXTRAS : STATIONS) for (const prof of profs) for (let s = 1; s <= seeds; s++)
    jobs.push({ lv, st, prof, mode, seed: 1000 + s * 17 + (free ? 0 : LEVEL_ORDER.indexOf(lv) * 3), set, ...(free ? { diff: lv, slot } : {}) });
  const n = Math.min(6, availableParallelism(), jobs.length), out = [], t0 = performance.now();
  await Promise.all(Array.from({ length: n }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(import.meta.filename, { workerData: jobs.filter((_, i) => i % n === w) });
    wk.on('message', m => { if (m === null) res(); else out.push(m); });
    wk.on('error', rej);
  })));
  const bad = out.filter(x => x.err);
  if (bad.length) console.log('ERRORS', bad.length, bad.slice(0, 3));
  const file = arg('out', join(ROOT, 'tests', 'out', 'human-pace.json'));
  mkdirSync(join(ROOT, 'tests', 'out'), { recursive: true });
  writeFileSync(file, JSON.stringify(out));
  console.log(`${out.length} shifts in ${((performance.now() - t0) / 1000).toFixed(0)} s -> ${file}`);

  const med = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] + (s.length % 2 ? 0 : (s[s.length / 2] - s[(s.length - 1) >> 1]) / 2) : null; };
  const mean = xs => { const s = xs.filter(x => x != null); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
  const f0 = x => (x == null ? '-' : x.toFixed(0)), f1 = x => (x == null ? '-' : x.toFixed(1));
  const cell = (lv, mode, st, prof) => out.filter(x => !x.err && x.lv === lv && x.mode === mode && x.st === st && x.prof === prof);

  // the level's pace: customers per minute and the patience at the door / for the order (CFG.queuePat 45, orderPat 50)
  console.log('\n| level | gap x | patience x | groups / min | mean gap s | door patience s | order patience s |\n|---|---|---|---|---|---|---|');
  for (const lv of levels) {
    const all = out.filter(x => !x.err && x.lv === lv && x.mode === 'solo' && x.st === 'waiter'), L = free ? { gap: set?.gap ?? 'DIFFS', pat: set?.pat ?? 1 } : LEVELS[lv];
    const pm = mean(all.map(x => x.perMin));
    console.log(`| ${lv} | ${L.gap} | ${L.pat} | ${f1(pm)} | ${f1(pm ? 60 / pm : null)} | ${f0(45 * L.pat)} | ${f0(50 * L.pat)} |`);
  }
  for (const mode of modes) {
    const sts = stations ? stations.split(',') : mode === 'extra' ? EXTRAS : STATIONS;
    console.log(`\n**${mode}**: served % (mean) / walk-outs (mean) / revenue (median) / busy % per profile\n`);
    console.log(`| level | station | ${profs.map(p => `${p} served % | ${p} walk-outs | ${p} rev | ${p} busy %`).join(' | ')} |\n|---|---|${profs.map(() => '---|---|---|---|').join('')}`);
    for (const lv of levels) for (const st of sts) {
      const row = profs.map(p => { const c = cell(lv, mode, st, p); return `${f1(mean(c.map(x => x.servedPct)))} | ${f1(mean(c.map(x => x.walk)))} | ${f0(med(c.map(x => x.rev)))} | ${f0(mean(c.map(x => x.busy)) * 100)}`; });
      console.log(`| ${lv} | ${st} | ${row.join(' | ')} |`);
    }
  }
  if (process.argv.includes('--lines')) {
    const r10 = x => Math.round(x / 10) * 10;
    const lines = {}, speed = {};
    for (const lv of levels) {
      lines[lv] = {};
      for (const st of STATIONS) { const two = r10(.9 * med(cell(lv, 'solo', st, 'mid').map(x => x.rev))); lines[lv][st] = [r10(.65 * two), two, r10(1.35 * two)]; }
    }
    for (const st of STATIONS) {
      const xs = levels.flatMap(lv => cell(lv, 'solo', st, 'mid').map(x => (st === 'kitchen' ? x.spd : x.spd))).filter(x => x != null).sort((a, b) => a - b);
      speed[st] = xs.length ? xs[Math.floor(.65 * (xs.length - 1))] : null;
    }
    console.log('\nSTAR_LINES (2★ = .9 x mid median):\n' + Object.entries(lines).map(([lv, o]) => `  ${lv}: { ${STATIONS.map(st => `${st}: [${o[st].join(',')}]`).join(', ')} },`).join('\n'));
    console.log('\nlevel speed lines (65th percentile of the mid profile, seconds):', JSON.stringify(speed));
  }
}
