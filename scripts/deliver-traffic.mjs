// 送外賣 success rates by human profile, gear cap, tier and bags. Not a test: a measurement.
// Each cell rides N lab runs (fed orders going cold as on the floor: the ride to the drop at gear 2 plus slack) with the
// human-model rider of tests/sim/deliver-rider.js (draws around the profile's medians, looks away now and then), and the
// computer rider (bot.ts, the default and a weak one) for comparison.
//   node scripts/deliver-traffic.mjs [runs per cell, default 30] [metres the screen shows ahead, default TUNE.reach.view]
// (the second argument measures a screen that shows less road than the generator assumes)
import { loadStation, countingRng, ctxFor } from '../tests/helpers/stations-sim.js';
import { makeRider, rideRun } from '../tests/sim/deliver-rider.js';

const M = await loadStation('deliver'), B = await loadStation('deliver', 'bot');
const N = Number(process.argv[2] ?? 30), VIEW = Number(process.argv[3] ?? M.TUNE.reach.view);
const seeded = seed => { const r = countingRng(seed); return () => r.next(); };
/** Mean crashes a run, share of runs with no crash, mean seconds, share of bags paid the rocket tip, mean tip x. */
function cell(tier, bags, mk) {
  let crashes = 0, clean = 0, secs = 0, fast = 0, cold = 0, tip = 0;
  for (let k = 0; k < N; k++) {
    const seed = 1000 + k * 7919 + tier * 31 + bags, rng = countingRng(seed), r = rideRun(M, { tier, bags, seed, rng, ctxFor, rider: mk(seed) });
    crashes += r.crashes; clean += r.crashes === 0 ? 1 : 0; secs += r.secs; fast += r.fast; cold += r.drops.filter(d => d.cold).length;
    tip += r.drops.reduce((a, d) => a + (d.cold ? 0 : M.bagBonus(bags) * M.rocketBonus(d.fast)), 0);
  }
  return { crash: crashes / N, clean: clean / N, secs: secs / N, fast: fast / (N * bags), cold: cold / (N * bags), tip: tip / (N * bags) };
}
const botRider = opts => { const f = B.makeDeliverBot(opts); return () => (s, t) => f(s, ctxFor(t, null)); };
const riders = [
  ...['first', 'mid', 'skilled'].flatMap(p => [3, 4, M.TOP].map(g => ({ name: `${p} g${g === M.TOP ? 'R' : g}`, mk: seed => makeRider(M, { profile: p, gear: g, rnd: seeded(seed * 3 + 1), view: VIEW }) }))),
  { name: 'bot (default)', mk: botRider({}) },
  { name: 'bot skill .5', mk: botRider({ skill: 0.5 }) },
];
const pct = x => `${Math.round(100 * x)}%`.padStart(4);
console.log(`gears ${M.TUNE.gears.join('/')} m/s, guard sight ${M.TUNE.reach.view} m, riders see ${VIEW} m`);
console.log(`runs per cell: ${N}. crash/run, clean-run share, seconds, rocket-tip bags, cold bags, mean tip multiplier per bag`);
for (const tier of [1, 4, 8]) for (const bags of [1, 3]) {
  console.log(`\ntier ${tier}, ${bags} bag${bags > 1 ? 's' : ''}`);
  for (const r of riders) {
    const c = cell(tier, bags, r.mk);
    console.log(`  ${r.name.padEnd(14)} crash ${c.crash.toFixed(2).padStart(5)}  clean ${pct(c.clean)}  ${c.secs.toFixed(1).padStart(5)} s  rocket ${pct(c.fast)}  cold ${pct(c.cold)}  tip x${c.tip.toFixed(2)}`);
  }
}
