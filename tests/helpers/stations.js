// In-memory harness for the new station cores (src/stations-next/<kind>/): bundles a station's TypeScript entry with
// esbuild into a temp ES module and imports it, so node:test can drive the pure core without a browser or a server.
import { buildSync } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './server.js';

/** Imports src/stations-next/<kind>/index.ts as a module object. */
export async function loadStation(kind) {
  const code = buildSync({ entryPoints: [join(ROOT, 'src', 'stations-next', kind, 'index.ts')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false, logLevel: 'warning' }).outputFiles[0].text;
  const file = join(mkdtempSync(join(tmpdir(), `chakei-${kind}-`)), `${kind}.mjs`);
  writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

/** Mulberry32 with a draw counter, so a run can be resumed by a fresh copy at the same point (hand-over tests). */
export function countingRng(seed, skip = 0) {
  let a = seed >>> 0, n = 0;
  const r = {
    next() {
      n++;
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get count() { return n; },
  };
  for (let i = 0; i < skip; i++) r.next();
  n = skip;
  return r;
}

export const ctxOf = (t, rng, seat = 's1') => ({ t, rng, seat, byPlayer: false, shared: { t, paused: false } });

/**
 * Runs a station for `secs` game seconds at a fixed step with its bot driving (or `drive(s, ctx)` returning a command).
 * Returns every result. `onStep(s, ctx)` runs after each step.
 */
export function run(mod, s, rng, { secs, dt = 1 / 60, bot = true, onStep, from = 0 } = {}) {
  const out = [];
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) {
    const ctx = ctxOf(from + (i + 1) * dt, rng);
    out.push(...mod.step(s, dt, ctx));
    if (bot) { const c = mod.bot.next(s, ctx); if (c) out.push(...mod.command(s, c, ctx)); }
    if (onStep) onStep(s, ctx);
  }
  return out;
}
