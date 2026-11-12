// 傳菜's one control: solo 樓面 on 打風前夕 at 390x666, headless and muted. The 「傳」 map bubble opens the
// runner; on an iPhone (faked user agent and DeviceOrientationEvent.requestPermission) the level's start tap asked for motion once (not the 「傳」 tap), and
// synthetic deviceorientation events in the runner's frame switch it from the finger to tilt and steer the tray. With no
// motion readings (a desktop engine), the finger drag steers the tray.
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

/** iOS's motion request, faked in every frame: counts the asks, answers 'granted' after a short prompt. */
function fakeMotion() {
  window.__motion = 0;
  if (!window.DeviceOrientationEvent) window.DeviceOrientationEvent = class extends Event {};
  DeviceOrientationEvent.requestPermission = () => { window.__motion++; return new Promise(r => setTimeout(() => r('granted'), 50)); };
}

/** Solo 伙記 on 打風前夕 (樓面 with 傳菜), lock-stepped until the pass has dishes, then the 「傳」 bubble tapped. */
async function openRunner(device, init) {
  const page = await openGame(browser, srv.url, { device, storage: veteran('測試員', { ...ROLES_LEARNED, ...ROLES_REACHED }), init });
  await page.addScriptTag({ content: BOTS });
  await page.click('#levelBtn');
  await page.click('#lvSt [data-st="waiter"]');
  await page.click('#book [data-lv="typhoon"]');
  await page.waitForFunction(() => G && G.running && G.level === 'typhoon' && G.floor);
  await page.evaluate(() => { Bot.stop?.(); Bot.scale = 0; });
  await page.waitForFunction(() => mapNow() !== null, null, { timeout: 5000 });
  const came = await page.evaluate(() => {
    let now = performance.now();
    for (let i = 0; i < 300 / .05 && G.running; i++) { shiftStep(.05); now += 50; coopFrame(now); floorFrame(); if (stationCount('carry') > 0) return true; }
    return false;
  });
  assert.ok(came, 'dishes reached the pass');
  const tap = await mapTap(page, { k: 'spot', spot: 'pass' });
  assert.ok(tap.ok, tap.why);
  await page.waitForSelector('#floorGame iframe', { state: 'visible', timeout: 10000 });
  assert.equal(await page.evaluate(() => floorJob()?.game), 'runner');
  await page.waitForFunction(() => !!document.getElementById('floorFrame')?.contentWindow?.__st?.screen.mode, null, { timeout: 10000 });
  const frame = await (await page.$('#floorFrame')).contentFrame();
  assert.ok(frame, 'the runner frame');
  return { page, frame };
}

test('solo 傳菜 on an iPhone: motion asked once (at the level start); motion readings switch the tray to tilt and steer it', { timeout: 120000 }, async () => {
  const { page, frame } = await openRunner({ ...PHONE, userAgent: IPHONE_SAFARI }, `(${fakeMotion})();`);
  assert.equal(await page.evaluate(() => window.__motion), 1, 'asked once, by the level start tap');
  await page.waitForFunction(() => motionPermit() === 'granted');
  assert.equal(await frame.evaluate(() => window.__st.screen.mode), 'thumb', 'the finger until a reading arrives');
  // a phone held at 30 degrees (the calibration), then tipped toward the player
  await frame.evaluate(() => {
    window.__beta = 30;
    const send = () => { const e = new Event('deviceorientation'); Object.defineProperties(e, { alpha: { value: 0 }, beta: { value: window.__beta }, gamma: { value: 0 } }); window.dispatchEvent(e); };
    window.__drive = setInterval(send, 16);
  });
  await frame.waitForFunction(() => window.__st.screen.mode === 'tilt');
  assert.equal(await page.evaluate(() => runnerControl()), 'tilt', 'the help text reads the control in use');
  await page.waitForTimeout(700);   // the 0.45 s calibration on the resting angle
  assert.ok(Math.abs(await page.evaluate(() => runnerState().in.y)) < 0.05, 'level at the resting angle');
  await frame.evaluate(() => { window.__beta = 45; });
  await page.waitForFunction(() => runnerState().in.y > 0.5, null, { timeout: 5000 });
  // a pick tap inside the runner does not ask again (granted is kept for the tab)
  assert.equal(await frame.evaluate(() => window.__motion), 0, 'the runner frame never re-asked');
  await shot(page, 'runner-control-tilt');
  await frame.evaluate(() => clearInterval(window.__drive));
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('solo 傳菜 with no motion readings: the finger drag steers the tray', { timeout: 120000 }, async () => {
  const { page, frame } = await openRunner(PHONE);
  await page.waitForTimeout(500);
  assert.equal(await frame.evaluate(() => window.__st.screen.mode), 'thumb');
  assert.equal(await page.evaluate(() => runnerControl()), 'thumb');
  const box = await page.locator('#floorFrame').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height * 0.6;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 80, cy, { steps: 6 });
  await page.waitForFunction(() => runnerState().in.x > 0.8, null, { timeout: 5000 });
  await page.mouse.up();
  await page.waitForFunction(() => Math.abs(runnerState().in.x) < 1e-9, null, { timeout: 5000 });
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
