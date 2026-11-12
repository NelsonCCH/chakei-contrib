// Solo 樓面 on 打風前夕 at 390x666, headless and muted.
// Motion: 傳菜's motion permission is asked by the level's start tap, never mid-play. On a faked iPhone whose prompt never
// answers (so the answer stays unknown and any later ask would prompt again), the start tap asks once; the 「傳」 bubble
// and the runner's 1/2/3 picks ask nothing more.
// Auto-return: finishing a job's order returns the player to the 樓面 at once: the job ends, its page goes and the floor shows
// in the same step the last item is done, with no button and no done screen (傳菜 and 打包 here; 執枱 and 送外賣 in
// solo-floor.test.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, ROOT } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, ROLES_REACHED, realErrors, shot } from './helpers/browser.js';
import { mapTap } from './helpers/map.js';

const BOTS = readFileSync(join(ROOT, 'tests', 'helpers', 'bots.browser.js'), 'utf8');
const PHONE = { viewport: { width: 390, height: 666 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

/** iOS's motion request, faked in every frame: counts the asks and never answers (the answer stays unknown). */
function fakeMotion() {
  window.__motion = 0;
  if (!window.DeviceOrientationEvent) window.DeviceOrientationEvent = class extends Event {};
  DeviceOrientationEvent.requestPermission = () => { window.__motion++; return new Promise(() => {}); };
}

async function floorShift(device, init) {
  const page = await openGame(browser, srv.url, { device, storage: veteran('測試員', { ...ROLES_LEARNED, ...ROLES_REACHED }), init });
  await page.addScriptTag({ content: BOTS });
  await page.click('#levelBtn');
  await page.click('#lvSt [data-st="waiter"]');
  const before = await page.evaluate(() => window.__motion ?? 0);
  await page.click('#book [data-lv="typhoon"]');
  await page.waitForFunction(() => G && G.running && G.level === 'typhoon' && G.floor);
  // lock-step (solo-floor.test.js): game time moves only inside run()
  await page.evaluate(() => { Bot.stop?.(); Bot.scale = 0; });
  await page.waitForFunction(() => mapNow() !== null, null, { timeout: 5000 });
  return { page, asked: (await page.evaluate(() => window.__motion ?? 0)) - before };
}
/** Lock-step: up to `sec` game seconds, or until `until` says yes; `press` every 3rd step. Notes the step the job ended
 *  and whether the floor showed in that same step. */
const run = (page, sec, until, press = '') => page.evaluate(([sec, until, press]) => {
  const done = new Function('return (' + until + ')()'), pr = press ? new Function('return ' + press)() : null;
  let now = performance.now();
  for (let i = 0; i < sec / .05 && G.running; i++) {
    if (!G.paused) shiftStep(.05);
    now += 50; coopFrame(now); floorFrame();
    if (pr && i % 3 === 0) pr();
    if (done()) return { ok: true, t: G.t, floor: !document.getElementById('floorWrap').hidden, game: !document.getElementById('floorGame').hidden };
  }
  return { ok: false, t: G.t };
}, [sec, until, press]);

test('motion: the level start tap asks for motion once; the 「傳」 bubble and the picks do not ask', { timeout: 120000 }, async () => {
  const { page, asked } = await floorShift({ ...PHONE, userAgent: IPHONE_SAFARI }, `(${fakeMotion})();`);
  assert.equal(asked, 1, 'asked inside the tap that started the level');
  assert.equal(await page.evaluate(() => motionPermit()), 'prompt', 'the faked prompt is still open: any later ask would count');
  const r = await run(page, 300, "() => stationCount('carry') > 0");
  assert.ok(r.ok, 'dishes reached the pass');
  const tap = await mapTap(page, { k: 'spot', spot: 'pass' });
  assert.ok(tap.ok, tap.why);
  await page.waitForSelector('#floorGame iframe', { state: 'visible', timeout: 10000 });
  assert.equal(await page.evaluate(() => floorJob()?.game), 'runner');
  // a pick tap inside the runner page (the real button, as a finger presses it)
  const frame = page.frameLocator('#floorFrame');
  await frame.locator('#pick button:not([disabled])').first().click({ timeout: 10000 });
  await run(page, .5, '() => false');
  assert.equal(await page.evaluate(() => window.__motion), 1, 'no ask from the 「傳」 tap or the pick');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('auto-return: a finished 傳菜 or 打包 job puts the player back on the floor in the same step, no button', { timeout: 180000 }, async () => {
  const { page } = await floorShift(PHONE);
  // 傳菜: the 「傳」 bubble, the runner pressed by its bot until the trip's tables are served
  let r = await run(page, 300, "() => stationCount('carry') > 0");
  assert.ok(r.ok, 'dishes reached the pass');
  let tap = await mapTap(page, { k: 'spot', spot: 'pass' });
  assert.ok(tap.ok, tap.why);
  await page.waitForSelector('#floorGame iframe', { state: 'visible', timeout: 10000 });
  assert.equal(await page.isHidden('#floorWrap'), true, 'the mini-game covers the floor');
  r = await run(page, 90, '() => floorJob() === null', 'runnerBotPress');
  assert.ok(r.ok, 'the 傳菜 job ended');
  assert.ok(await page.evaluate(() => runnerState().run.carried.length) > 0, 'the player carried the dishes');
  assert.deepEqual([r.floor, r.game], [true, false], 'the floor shows in the step the job ended; the page is gone');
  await shot(page, 'floor-auto-return-runner');
  // 打包: the 「包」 bubble, packed and handed over by the station's bot
  r = await run(page, 300, "() => stationCount('bag') > 0");
  assert.ok(r.ok, 'a bag is ready to pack');
  tap = await mapTap(page, { k: 'spot', spot: 'bag' });
  assert.ok(tap.ok, tap.why);
  await page.waitForSelector('#floorGame iframe', { state: 'visible', timeout: 10000 });
  assert.equal(await page.evaluate(() => floorJob()?.game), 'takeaway');
  await run(page, .2, '() => false');
  assert.equal(await page.evaluate(() => takeawayState().bag.items.length), 0, 'the bag starts empty');
  r = await run(page, 90, '() => floorJob() === null', 'takeawayBotPress');
  assert.ok(r.ok, 'the 打包 job ended');
  assert.equal(await page.evaluate(() => takeawayState().results.length), 1, 'the player packed and handed the bag over');
  assert.deepEqual([r.floor, r.game], [true, false], 'the floor shows in the step the job ended; the page is gone');
  assert.equal(await page.isVisible('#floorWrap'), true, 'back on the floor');
  assert.equal(await page.isHidden('#floorBack'), true, 'no 返樓面 button left over');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
