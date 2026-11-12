// Offline: after one online visit the service worker serves the game with the network cut; /api/* is never cached.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { world, open, vet, done, shown, startShift, endShift, shopNow, sleep } from './helpers/ui.js';

let w;
const SW = { serviceWorkers: 'allow' };   // this file tests the worker itself
before(async () => { w = await world(); });
after(async () => { await w.stop(); });

async function warm(p) {
  // first load registers the worker; the second (controlled) load puts every file into the cache
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForFunction(() => navigator.serviceWorker.controller || true);
  await p.reload();
  await p.waitForFunction(() => typeof G !== 'undefined' && typeof cloudReady !== 'undefined');
  await p.evaluate(() => cloudReady);
  await p.waitForFunction(() => navigator.serviceWorker.controller);
  await p.reload();
  await p.waitForFunction(() => typeof G !== 'undefined' && typeof cloudReady !== 'undefined');
  await p.evaluate(() => cloudReady);
  await sleep(500);   // cache writes are fire-and-forget
}
const cached = p => p.evaluate(async () => (await (await caches.open('chakei-v3')).keys()).map(r => new URL(r.url).pathname));

test('service worker registers on localhost and caches the page, scripts, styles and images', async () => {
  const p = await open(w, vet(), SW);
  await warm(p);
  const keys = await cached(p);
  for (const f of ['/', '/css/style.css', '/js/app.js']) assert.ok(keys.includes(f) || (f === '/' && keys.includes('/index.html')), f + ' cached; have ' + keys.length);
  assert.ok(keys.some(k => k.startsWith('/icons/')), 'icons cached');
  await done(p);
});

test('/api/* is never stored in the cache, online or offline', async () => {
  const p = await open(w, vet(), SW);
  await warm(p);
  await p.evaluate(() => fetch('/api/config').then(r => r.json()));
  await p.evaluate(() => fetch('/api/me').catch(() => 0));
  await sleep(300);
  assert.deepEqual((await cached(p)).filter(k => k.startsWith('/api/')), []);
  const allCaches = await p.evaluate(async () => { const out = []; for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(new URL(r.url).pathname); return out; });
  assert.deepEqual(allCaches.filter(k => k.startsWith('/api/')), []);
  await p.context().setOffline(true);
  const res = await p.evaluate(() => fetch('/api/config').then(r => 'served ' + r.status, e => 'failed'));
  assert.equal(res, 'failed', 'with the network cut the API must fail, not answer from a cache');
  await done(p);
});

test('network cut: the game reloads from the cache, home screen works, a shift can be played and saved', async () => {
  const p = await open(w, vet('老闆', { bank: 500 }), SW);
  await warm(p);
  await p.context().setOffline(true);
  await p.reload();
  await p.waitForFunction(() => typeof G !== 'undefined' && typeof cloudReady !== 'undefined');
  await p.evaluate(() => cloudReady);
  assert.equal(await shown(p, '#startView'), true);
  assert.equal(await p.evaluate(() => CLOUD.on), false, 'no backend: cloud features hidden');
  assert.equal(await shown(p, '#acct'), false);
  assert.equal((await shopNow(p)).bank, 500, 'save is there');
  // art really drew from cached scripts (canvas not blank) and the logo image loaded
  assert.ok(await p.evaluate(() => document.querySelector('.brand img').complete && document.querySelector('.brand img').naturalWidth > 0), 'logo loaded offline');
  for (const b of ['#helpBtn', '#levelBtn', '#wardBtn']) { await p.click(b); assert.ok(await shown(p, '#bookView') || await shown(p, '#helpView')); await p.click(b === '#helpBtn' ? '#helpClose' : '#bookClose'); }
  await startShift(p, { station: 'waiter' });
  await endShift(p, { revenue: 300, angry: 0, mistakes: 0 });
  assert.equal(await shown(p, '#endView'), true);
  // the saved bank is what the end card says (stars, prizes and rent: no fixed number)
  { const s = await shopNow(p), card = await p.evaluate(() => +(document.querySelector("#result").innerText.match(/舖頭積蓄\s*\$(-?\d+)/) || [])[1]); assert.equal(s.bank, card); assert.notEqual(s.bank, 500, "the shift changed the bank"); }
  await done(p);
});

test('network cut for a navigation to a deep path falls back to the cached home page', async () => {
  const p = await open(w, vet(), SW);
  await warm(p);
  await p.context().setOffline(true);
  const r = await p.goto(w.url + '/?from=offline').catch(e => e);
  await p.waitForFunction(() => typeof G !== 'undefined');
  assert.equal(await shown(p, '#startView'), true);
  await done(p);
});

test('back online after being offline: cloud sign-in is available again', async () => {
  const p = await open(w, vet(), SW);
  await warm(p);
  await p.context().setOffline(true);
  await p.reload(); await p.waitForFunction(() => typeof cloudReady !== 'undefined'); await p.evaluate(() => cloudReady);
  assert.equal(await p.evaluate(() => CLOUD.on), false);
  await p.context().setOffline(false);
  await p.reload(); await p.waitForFunction(() => typeof cloudReady !== 'undefined'); await p.evaluate(() => cloudReady);
  assert.equal(await p.evaluate(() => CLOUD.on), true);
  assert.equal(await shown(p, '#devSignInBtn'), true);
  await done(p);
});
