// A player with a cloud save opens the game on a brand-new phone: the very first screen must let them sign in,
// and signing in must bring back their shop and leave the first-day screen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { world, open, vet, done, shown, shopNow, store } from './helpers/ui.js';

let w;
before(async () => { w = await world(); });
after(async () => { await w.stop(); });

test('new phone: sign in from the first-day screen restores the cloud save', async () => {
  const name = '新機' + Date.now().toString(36).slice(-5);
  const a = await open(w, vet('甲機', { stars: 20, servedTotal: 200, bank: 5000 }), { promptAnswer: name });
  await a.click('#devSignInBtn');
  await a.waitForFunction(() => cloudState === 'on', null, { timeout: 8000 });
  await done(a);

  const b = await open(w, {}, { promptAnswer: name });
  assert.equal(await b.evaluate(() => document.querySelector('.home').classList.contains('first')), true, 'fresh phone starts on the first-day screen');
  assert.equal(await shown(b, '#devSignInBtn'), true, 'sign-in is offered on the first-day screen');
  await b.click('#devSignInBtn');
  await b.waitForFunction(() => cloudState === 'on' && SHOP.stars >= 20, null, { timeout: 8000 });
  const s = await shopNow(b);
  assert.equal(s.stars, 20); assert.equal(s.bank, 5000);
  assert.equal((await store(b)).bank, 5000, 'written to the new phone');
  await b.waitForFunction(() => !document.querySelector('.home').classList.contains('first'), null, { timeout: 4000 })
    .catch(() => assert.fail('home still shows the first-day screen after the cloud save came back'));
  assert.equal(await shown(b, '.modes'), true, 'game modes are reachable');
  await done(b);
});
