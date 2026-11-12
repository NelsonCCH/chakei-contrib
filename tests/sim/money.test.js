// Money as the player reads it: a HUD in play showed $377.0999999999997 after a 旺場 of 10-cent
// takeaway tips. cash() reads whole dollars, cashCents() two fixed decimals; neither ever shows more than two decimals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const CODE = buildSync({ entryPoints: [join(ROOT, 'src', 'core', 'util.ts')], bundle: true, format: 'cjs', platform: 'neutral', target: 'es2022', write: false, logLevel: 'error' }).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', CODE)(mod, mod.exports);
const { cash, cashCents } = mod.exports;

test('cash: whole dollars, float noise gone', () => {
  assert.equal(cash(377.0999999999997), '$377');
  assert.equal(cash(0.1 + 0.2), '$0');
  assert.equal(cash(16.5), '$17');
  assert.equal(cash(1200), '$1200');
  assert.equal(cash(-0.2), '$0', 'no $-0');
  assert.equal(cash(-35), '$-35');
});

test('cashCents: two fixed decimals where cents matter', () => {
  assert.equal(cashCents(16.1), '$16.10');
  assert.equal(cashCents(0), '$0.00');
  assert.equal(cashCents(0.1 + 0.2), '$0.30');
  assert.equal(cashCents(377.0999999999997), '$377.10');
});

test('no money string has more than two decimals, over sums of 10-cent tips', () => {
  let sum = 0;
  for (let i = 0; i < 5000; i++) {
    sum += Math.round(((i * 37) % 97) / 10 * 10) / 10;   // tips booked to 10 cents, as takeaway/core.ts judge() does
    for (const s of [cash(sum), cashCents(sum)]) assert.match(s, /^\$-?\d+(\.\d{2})?$/, s);
  }
});
