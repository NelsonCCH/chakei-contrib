// The production build (npm run build:prod, what npm run deploy ships): one minified bundle, no source map, no test
// surface. Every other suite runs on the test build; this one checks that the shipped flavour loads, plays a solo
// shift, and keeps the game's names off the page's global scope.
import { go } from './helpers/intro.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, realErrors } from './helpers/browser.js';

let srv, browser;
before(async () => { srv = await startServer({ prod: true }); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const homeReady = () => { const v = document.getElementById('startView'); return !!v && !v.hidden && !!document.getElementById('startBtn'); };

test('production bundle: minified, no source map, no test surface', async () => {
  const js = await (await fetch(srv.url + '/js/app.js')).text();
  // Minified: no module markers, and the game's function names are gone (renamed), e.g. `function tillKey(`.
  assert.doesNotMatch(js, /\/\/ src\//);
  assert.doesNotMatch(js, /function (tillKey|newGame|buildMenus|hostTick)\(/);
  assert.doesNotMatch(js, /sourceMappingURL/);
  assert.doesNotMatch(js, /test surface/);
  assert.equal((await fetch(srv.url + '/js/app.js.map')).status, 404, 'no source map served');
  const html = await (await fetch(srv.url + '/')).text();
  assert.match(html, /<script src="js\/app\.js\?v=[\d.]+"><\/script>/);
});

test('production build: the page loads, a solo shift starts and runs, and no game name is a page global', async () => {
  const page = await openGame(browser, srv.url, { storage: veteran('測試員'), ready: homeReady });
  // Names the tests reach through the test surface: none may exist here.
  const leaked = await page.evaluate(() => ['G', 'SHOP', 'CFG', 'NET', 'HOOK', 'start', 'update', 'serve', 'tillKey', 'station', 'unacked', 'hostTick', 'cloudReady', 'buildMenus', 'setG']
    .filter(n => n in window));
  assert.deepEqual(leaked, []);
  // Everything the game page has on window beyond what a plain page of the same site (same test init scripts) has.
  const own = p => p.evaluate(() => Object.getOwnPropertyNames(window));
  const blank = await page.context().newPage();
  await blank.goto(srv.url + '/privacy.html');
  const base = new Set(await own(blank));
  await blank.close();
  assert.deepEqual((await own(page)).filter(n => !base.has(n)), [], 'the game adds nothing to the page global scope');

  // A solo shift through the real menu buttons, answering an unlock card if one shows (as startShift does).
  const gate = page.locator('#gatePop');
  await page.addLocatorHandler(gate, async () => { await page.click('#gateLater'); });
  if (await page.locator('#shopBtn').isVisible()) await page.click('#shopBtn');
  await page.click('#stSeg [data-st="waiter"]');
  await go(page, '#startBtn');
  await page.waitForFunction(() => !document.getElementById('startView').offsetParent);
  await page.removeLocatorHandler(gate);
  const c0 = await page.textContent('#clock');
  await page.waitForFunction(c => document.getElementById('clock').textContent !== c, c0, { timeout: 15000 });
  assert.equal(await page.locator('#queue, #floor').first().isVisible(), true, 'the floor is on screen');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('production build: a room of one with 傳菜 on and the host sitting there lands on the runner station screen', async () => {
  const page = await openGame(browser, srv.url, { storage: veteran('測試員', ROLES_LEARNED), ready: homeReady });
  await page.click('#coopBtn'); await page.click('#hostBtn');
  await page.click('#coop [data-x="runner"]');
  await page.click('#coop [data-hx="runner"]');
  assert.match(await page.textContent('#youDo'), /你開工做：傳菜/);
  await page.click('#hostGo');
  await page.waitForFunction(() => !document.getElementById('seatView').hidden);
  assert.equal(await page.isVisible('#floorWrap'), false, 'not the floor');
  assert.match(await page.textContent('#xStrip'), /你做傳菜/);
  // the station's own page, from the shipped (minified) station bundle, in the seat view, drawing the shift
  let f = null;
  for (let i = 0; i < 100 && !f; i++) { f = page.frames().find(x => /\/stations\/runner(\.html)?\?seat/.test(x.url())) || null; if (!f) await page.waitForTimeout(100); }
  assert.ok(f, 'the runner seat screen is loaded');
  await f.waitForFunction(() => document.getElementById('ovStart').hidden && /送咗 \d+\/6/.test(document.getElementById('hs').textContent));
  const box = await page.locator('#seatFrame').boundingBox();
  assert.ok(box && box.height > 300, `the screen is visible (${JSON.stringify(box)})`);
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
