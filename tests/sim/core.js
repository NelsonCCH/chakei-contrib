// Loads the shop's rules (src/core/) into Node for the simulations: src/core/index.ts bundled once with
// esbuild (TypeScript in, CommonJS out, no type check: `npm run check` does that), then run as a fresh module instance
// per shift, so no state (G, the random stream, the clock's accumulator, the combo memory) leaks between shifts.
import { buildSync } from 'esbuild';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const CODE = buildSync({ entryPoints: [join(ROOT, 'src', 'core', 'index.ts')], bundle: true, format: 'cjs', platform: 'neutral', target: 'es2022', write: false, logLevel: 'error' }).outputFiles[0].text;

/** A fresh copy of every export of src/core/index.ts. */
export function freshCore() {
  const module = { exports: {} };
  new Function('module', 'exports', CODE)(module, module.exports);
  return module.exports;
}

// Two levels like the game's (ui/levels.ts): a takeaway stall with its own kitchen, and a night shift with costumes and
// ghosts. Only the fields the rules read.
export const LEVELS = {
  stall: { n: 90, name: 'stall', slot: 'lunch', takeaway: 6, sizes: [.3, .6, .8], favorDrink: '奶茶', favor: '西多士', foodP: .7, pulls: 3, oneSay: 4,
    kit: { st: { pot: ['公仔麵', '通粉'], pan: ['煎蛋', '西多士'], toaster: ['多士'] }, inst: ['火腿', '餐肉', '牛油'] } },
  night: { n: 91, name: 'night', slot: 'dinner', costume: true, ghost: true, nightLabels: ['夜貓'] },
};

/**
 * The player's progress as the page would answer it (core/env.ts ShopPort): their own shop with a few upgraded recipes
 * (signature dishes, weighted picks), regulars who remember their visits, the two levels above. `paid` counts what the
 * save was told (the page's bookkeeping); the tips it returns go into the shift's revenue.
 */
export function simPort(C) {
  const visits = { chan: 2 }, rlv = { 'k:奶茶': 3, 'f:西多士': 3, 'd:焗豬扒飯': 3, 's:A餐': 2, 'k:檸茶': 2 };
  const port = {
    level: id => LEVELS[id], menuOpen: () => true,
    inMyShop: () => !!C.G && !C.G.level && !C.G.tut, recipeLv: k => rlv[k] || 1, fancyName: k => k.split(':')[1],
    setPat: () => 1, setTip: () => 1, setBoost: () => 1, potCap: () => C.CFG.potCap, placeFx: () => ({}), setOn: k => k === 'spooky',
    rankIx: () => 2, regVisits: k => visits[k] | 0, lunchKit: () => null,
    regArrive: () => {},
    regPaid: g => {
      let tip = 0;
      if (g.regular) { const r = C.REG[g.regular]; visits[g.regular] = (visits[g.regular] | 0) + 1; if (r && r.persist) tip += Math.min(40, 10 + 5 * (visits[g.regular] - 1)); }
      if (g.celeb) tip += 50;
      port.tipsPaid += tip;
      return tip;
    },
    tipsPaid: 0,
  };
  return port;
}

/** mulberry32, for the bots' own choices and the frame timings (the game's stream is separate: core/rng.ts). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
