// Where the 傳菜 runner seat loses customers: one co-op shift with the runner seat held by the human model (or the
// computer), traced every frame. Prints the runner's trips (tables per trip, seconds per trip, idle at the pass), how
// long lines sat on the pass, and for every group that walked out waiting for food: its lines' made / carried times.
//   node scripts/runner-diag.mjs [--lv central] [--prof mid|first|skilled|bot|computer] [--seeds 6]
import { runCoop } from '../tests/sim/coop.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const lv = arg('lv', 'central'), prof = arg('prof', 'mid'), seeds = Number(arg('seeds', 6));
const tot = { trips: 0, tables: 0, tripSec: 0, pickWait: 0, passWait: [], walk: 0, walkOnPass: 0, walkNotMade: 0, served: 0, pick: {}, pass: [] };
for (let s = 1; s <= seeds; s++) {
  const seed = 1000 + s * 17 + 3;
  const seen = new Map(), left = [];
  let lastSt = null, stT = 0, lastTrips = 0;
  const comp = prof === 'computer';
  const r = runCoop({ seed, seats: comp ? [null] : [null, 'runner'], lv, extraSeats: ['runner'], human: comp || prof === 'bot' ? undefined : { 1: prof }, shape: 'clean',
    each: ({ ref }) => {
      const G = ref.C.G; if (!G || !G.running) return;
      const live = new Set();
      for (const g of G.groups) {
        if (g.take) continue;
        live.add(g.id);
        const rec = seen.get(g.id) ?? { g, lines: {} }; rec.g = g; seen.set(g.id, rec);
        for (const [dest, arr] of [['bar', g.drinks], ['kitchen', g.meals], ['roast', g.roast]]) (arr ?? []).forEach((l, i) => {
          const k = dest + i, x = rec.lines[k] ?? (rec.lines[k] = { made: null, carried: null });
          if (l.passT !== undefined && x.made === null) x.made = l.passT;
          if (x.made !== null && l.passT === undefined && l.done && x.carried === null) x.carried = G.t;
        });
        rec.state = g.state; rec.t = G.t;
      }
      for (const [id, rec] of seen) if (!live.has(id) && !rec.gone) { rec.gone = G.t; left.push(rec); }
      tot.pass.push(G.groups.reduce((n, g) => n + (g.take ? 0 : [...(g.drinks ?? []), ...(g.meals ?? []), ...(g.roast ?? [])].filter(l => l.passT !== undefined).length), 0));
    } });
  // the runner's own record: on the phone that drives it
  for (const rec of left) {
    const ls = Object.values(rec.lines);
    if (rec.state === 'wait' && ls.length) {
      // a group gone from 'wait' was served (every line carried) or walked out
      const allCarried = ls.every(x => x.carried !== null);
      if (allCarried) { tot.served++; for (const x of ls) tot.passWait.push(x.carried - x.made); }
      else { tot.walk++; if (ls.some(x => x.made !== null && x.carried === null)) tot.walkOnPass++; else tot.walkNotMade++; }
    }
  }
  const ph = comp ? r.phones[0] : r.phones[1];
  const st = ph.C.runnerState ? ph.C.runnerState() : null;
  if (st) { tot.trips += st.run.trip; tot.tables += st.run.carried.reduce((a, b) => a + b, 0); tot.tripSec += st.run.time; for (const n of st.run.carried) tot.pick[n] = (tot.pick[n] ?? 0) + 1; }
  tot.cs = (tot.cs ?? 0) + (r.cust ? r.cust.served : 0); tot.came = (tot.came ?? 0) + (r.cust ? r.cust.came : 0); tot.cw = (tot.cw ?? 0) + (r.cust ? r.cust.walkouts : 0);
  if (r.errs.length) console.log('errs', r.errs.slice(0, 2));
}
const med = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length * p)] : null; };
console.log(JSON.stringify({ lv, prof, seeds, trips: tot.trips, tablesPerTrip: (tot.tables / Math.max(1, tot.trips)).toFixed(2), secPerTrip: (tot.tripSec / Math.max(1, tot.trips)).toFixed(1), pickSizes: tot.pick,
  servedWait: tot.served, walkedWaiting: tot.walk, walkWithFoodOnPass: tot.walkOnPass, walkFoodNotMade: tot.walkNotMade,
  passWaitMed: med(tot.passWait)?.toFixed(1), passWaitP90: pct(tot.passWait, 0.9)?.toFixed(1), passMean: (tot.pass.reduce((a, b) => a + b, 0) / Math.max(1, tot.pass.length)).toFixed(2),
  groupsServed: tot.cs, came: tot.came, walkouts: tot.cw, visitsPerServed: (tot.tables / Math.max(1, tot.cs)).toFixed(2), passFullShare: (tot.pass.filter(n => n >= 6).length / Math.max(1, tot.pass.length)).toFixed(2) }));
