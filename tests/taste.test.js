// Tasting mode (?taste, src/ui/taste.ts): every course opens what it promises, with no errors, and the real save,
// the cloud and the stats are never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { veteran, realErrors, fastForward } from './helpers/browser.js';
import { world, open, sleep } from './helpers/ui.js';

let w;
before(async () => { w = await world(); });
after(async () => { await w.stop(); });

const REAL = veteran('真玩家', { bank: 1234, stars: 7 });
const DEV = { ...REAL, 'chakei-dev': '1' };   // a device that has entered the dev key once
const DEV_KEY = 'ckt-pubbb8v9y3';             // a key that matches the dev-key hash in src/ui/taste.ts (the site only holds the hash)

test('dev only: ?taste does nothing on a normal device or with a wrong key; the right key opens it and is remembered', async () => {
  for (const q of ['?taste', '?taste=1', '?taste=wrong']) {
    const p = await open(w, REAL, { query: q });
    assert.equal(await p.evaluate(() => TASTE), false, q);
    assert.equal(await p.locator('#tasteView').count(), 0, q);
    assert.equal(await p.evaluate(() => SHOP.bank), 1234, q + ': the real save loads');
    await p.context().close();
  }
  const p = await open(w, REAL, { query: '?taste=' + DEV_KEY });
  assert.equal(await p.evaluate(() => TASTE), true);
  assert.equal(await p.evaluate(() => localStorage.getItem('chakei-dev')), '1');
  await p.goto(w.url + '/?taste');   // later visits on this device need no key
  assert.equal(await p.evaluate(() => TASTE), true);
  assert.deepEqual(realErrors(p), []);
  await p.context().close();
});
const realSave = p => p.evaluate(() => localStorage['ckf-shop']);   // property access skips the patched getItem
const tasteSave = p => p.evaluate(() => JSON.parse(localStorage['ckf-taste-shop'] || 'null'));

// Opens the tasting menu, orders one course, waits for it to be served after the reload.
async function serve(p, id) {
  await p.evaluate(id => TASTE_API.order(id), id);
  await p.waitForFunction(id => typeof TASTE_API !== 'undefined' && document.getElementById('tasteBar') && document.getElementById('tasteBar').textContent.includes(TASTE_API.FLAT.find(c => c.id === id).name), id, { timeout: 15000 });
  await sleep(600);
}

test('tasting menu: opens on ?taste, lists every course in groups, real save untouched', async () => {
  const p = await open(w, DEV, { query: '?taste' });
  const before = await realSave(p);
  assert.equal(await p.evaluate(() => TASTE), true);
  assert.equal(await p.locator('#tasteView').isVisible(), true, 'the menu opens first');
  const n = await p.evaluate(() => TASTE_API.FLAT.length);
  assert.ok(n >= 30, `${n} courses`);
  assert.equal(await p.locator('#tasteView li button').count(), n);
  assert.equal(await p.evaluate(() => CLOUD.on), false, 'no cloud in tasting mode');
  assert.equal(await realSave(p), before);
  assert.deepEqual(realErrors(p), []);
  await p.context().close();
});

test('without ?taste nothing changes: no bar, normal save key, cloud on', async () => {
  const p = await open(w, REAL);
  assert.equal(await p.evaluate(() => TASTE), false);
  assert.equal(await p.locator('#tasteBar').count(), 0);
  assert.equal(await p.evaluate(() => SHOP.bank), 1234, 'the real save is what loads');
  assert.equal(await p.evaluate(() => CLOUD.on), true);
  await p.context().close();
});

test('every course: served without errors; shifts run, screens open; real save and cloud untouched', { timeout: 600000 }, async () => {
  const p = await open(w, DEV, { query: '?taste' });
  const before = await realSave(p);
  const api = [];
  p.on('request', r => { if (/\/api\/(save|daily|stats|me|auth)/.test(r.url())) api.push(r.method() + ' ' + r.url()); });
  const ids = await p.evaluate(() => TASTE_API.FLAT.map(c => c.id));
  const SCREENS = { decor: '#decorBar', grow: '#decorBar', recipes: '#bookView', pantry: '#bookView', grade: '#bookView', branch: '#bookView', book: '#bookView', dex: '#bookView', wardrobe: '#bookView', first: '#startView', mortgage: '#startView', coop: '#coopView' };
  for (const id of ids) {
    await serve(p, id);
    const s = await p.evaluate(() => ({ running: !!(G && G.running), tut: !!(G && G.tut), level: G && G.level, daily: G && G.daily, station: G && G.station, sec: CFG.gameSec }));
    if (SCREENS[id]) assert.equal(await p.locator(SCREENS[id]).first().isVisible(), true, `${id}: ${SCREENS[id]} shows`);
    else assert.equal(s.running, true, `${id}: a shift is running`);
    if (id === 'tut') assert.equal(s.tut, true);
    if (id.startsWith('lv-')) assert.equal(s.level, id.slice(3), `${id}: plays that level`);
    if (id === 'daily') assert.equal(s.daily, true);
    if (s.running && !s.tut) assert.equal(s.sec, 75, `${id}: a 75 s bite`);
    assert.deepEqual(realErrors(p), [], `${id}: no errors`);
  }
  assert.equal(await realSave(p), before, 'the real save never changed');
  assert.deepEqual(api, [], 'no save, score, stats or login calls');
  await p.context().close();
});

test('courses that stage an event really stage it', { timeout: 120000 }, async () => {
  const p = await open(w, DEV, { query: '?taste' });
  await serve(p, 'fever');
  await fastForward(p, 4);
  assert.equal(await p.evaluate(() => G.fever), true, '旺場 three seconds after opening');
  await serve(p, 'celeb');
  await fastForward(p, 12);
  assert.ok(await p.evaluate(() => !!G.rush), 'the celebrity is recognised');
  // the fan queue starts in careerTick, which runs from the real frame loop (fastForward only steps update)
  await p.waitForFunction(() => G.rush && G.rush.started, null, { timeout: 12000 });
  await serve(p, 'regulars');
  await fastForward(p, 25);
  assert.ok(await p.evaluate(() => G.groups.some(g => g.regular === 'lung') && G.groups.some(g => g.date)), '龍哥 and 陳生 with his date arrive');
  await serve(p, 'rankup');
  await fastForward(p, 80);
  await p.waitForSelector('#endView:not([hidden])');
  const shop = await tasteSave(p);
  assert.ok(shop.stars >= 10, 'day-7 bonus star lifts the rank to 熟手: ' + shop.stars);
  assert.equal(shop.streak.n, 7, JSON.stringify(shop.streak) + ' stars ' + shop.stars);
  await serve(p, 'pantry');
  assert.match(await p.locator('#bookView').innerText(), /貨/);
  assert.deepEqual(realErrors(p), []);
  await p.context().close();
});

test('menu: bite length toggle, ticks for tasted courses, next course button', { timeout: 60000 }, async () => {
  const p = await open(w, DEV, { query: '?taste' });
  await p.click('#tasteView [data-a="full"]');
  await serve(p, 'waiter');
  assert.equal(await p.evaluate(() => CFG.gameSec), 180, 'full shift');
  // During play nothing of the tasting mode covers the game; its buttons sit on the pause and end screens.
  assert.equal(await p.locator('#tasteBar').isVisible(), false, 'no floating bar over a running shift');
  await p.click('#pauseBtn');
  await p.click('#pauseView .tasteRow [data-t="next"]');
  await p.waitForFunction(() => { const b = document.getElementById('tasteBar'); return b && b.textContent.includes('水吧'); }, null, { timeout: 15000 });
  await sleep(600);
  await p.click('#pauseBtn');
  await p.click('#pauseView .tasteRow [data-t="menu"]');
  assert.equal(await p.locator('#tasteView').isVisible(), true);
  assert.equal(await p.evaluate(() => G.paused), true, 'the shift stays paused under the menu');
  assert.equal(await p.locator('#tasteView button[data-c="waiter"].done').count(), 1);
  assert.equal(await p.locator('#tasteView button[data-c="bar"].done').count(), 1);
  await p.click('#tasteView [data-a="bite"]');
  await p.click('#tasteView [data-a="close"]');
  await p.click('#resumeBtn');
  assert.equal(await p.evaluate(() => G.paused), false, 'back to work');
  await p.evaluate(() => endGame());   // the bar course: an idle bar never opens the shop, so end it directly
  await p.waitForSelector('#endView:not([hidden])');
  assert.equal(await p.locator('#endView .tasteRow [data-t="next"]').isVisible(), true, 'next course offered on the end screen');
  await p.click('#homeBtn');
  await sleep(500);
  assert.equal(await p.locator('#tasteBar').isVisible(), true, 'the bar shows on the home screen');
  assert.deepEqual(realErrors(p), []);
  await p.context().close();
});
