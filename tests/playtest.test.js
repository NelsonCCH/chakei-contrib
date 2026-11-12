// The preview's 試玩 pace panel: shown only when the Worker's PLAYTEST flag is on (a deployed
// preview Worker; never the live config), a moved slider changes the running shift's pace, and the 新手 / 熟手 / 有挑戰 marks are
// kept on the device and exported as plain text. Phone size; screenshots of the panel go to tests/out/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, openGame, veteran, PHONE, shot, realErrors } from './helpers/browser.js';
import { startShift } from './helpers/single.js';

let on, off, browser;
before(async () => { [on, off] = await Promise.all([startServer({ vars: { PLAYTEST: '1' } }), startServer()]); browser = await launch(); });
after(async () => { await browser?.close(); await on?.stop(); await off?.stop(); });

const open = url => openGame(browser, url, { device: PHONE, storage: { ...veteran('測試員'), 'ckf-view': 'simple' } });
const settle = page => page.evaluate(() => new Promise(r => setTimeout(r, 150)));

test('without the PLAYTEST flag (the live config) there is no 試玩 button', async () => {
  const page = await open(off.url);
  await settle(page);
  assert.equal(await page.locator('#ptBtn').count(), 0);
  assert.equal(await page.evaluate(() => CLOUD.cfg.playtest), false);
  await page.context().close();
});

test('with the flag: the panel opens mid-shift, the waiter slider speeds the shift up, a mark is kept and exported', async () => {
  const page = await open(on.url);
  await page.locator('#ptBtn').waitFor();
  await shot(page, 'playtest-home-phone');
  await startShift(page, { station: 'waiter', diff: 'pro' });
  // hold the clock still so the numbers compare exactly (the slider works on a running shift: G.running stays true)
  const before = await page.evaluate(() => { G.paused = true; return { gap: G.nextSpawn - G.t, sg: spawnGap(60, () => .5), pat: makeGroup(undefined, false, () => .3).max }; });
  await shot(page, 'playtest-button-phone');
  await page.click('#ptBtn');
  const rows = page.locator('#ptPanel .pt-row');
  assert.equal(await rows.first().getAttribute('data-st'), 'waiter', "the player's own station comes first");
  assert.match(await rows.first().locator('.pt-name').innerText(), /落單\/伙記\s*你/);
  assert.equal(await rows.count(), 4, "the shift's four stations");
  assert.equal(await rows.first().locator('.pt-val').innerText(), '5');
  await shot(page, 'playtest-panel-phone');
  await page.click('#ptPanel .pt-more');
  assert.equal(await rows.count(), 8, 'one slider per station');
  await rows.first().locator('input[type=range]').fill('10');
  assert.equal(await rows.first().locator('.pt-val').innerText(), '10');
  const k = 1 / 1.15 ** 5;
  const after = await page.evaluate(() => ({ v: paceOf('waiter'), gap: G.nextSpawn - G.t, sg: spawnGap(60, () => .5), pat: makeGroup(undefined, false, () => .3).max }));
  assert.equal(after.v, 10);
  assert.ok(Math.abs(after.gap / before.gap - k) < 1e-6, `the wait for the next customer shrank at once: ${before.gap} -> ${after.gap}`);
  assert.ok(Math.abs(after.sg / before.sg - k) < 1e-9, 'later customers come closer together');
  assert.ok(Math.abs(after.pat / before.pat - k) < 1e-9, 'and wait less at the door');
  // a mark
  await rows.first().locator('[data-band=skilled]').click();
  assert.match(await rows.first().locator('.pt-last').innerText(), /已記：熟手 @ 10/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ckf-playtest-marks')));
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0].st, saved[0].band, saved[0].v, saved[0].diff, saved[0].slot, saved[0].role, saved[0].seat], ['waiter', 'skilled', 10, 'pro', 'lunch', 'solo', 'waiter']);
  assert.match(saved[0].mode, /^(free|own-shop)$/);
  // export: plain text in a visible box (and the clipboard when the browser allows it)
  await page.click('#ptPanel [data-pt=export]');
  const box = page.locator('#ptPanel textarea');
  await box.waitFor();
  const text = await box.inputValue();
  assert.match(text, /落單\/伙記 \(waiter\) \| 熟手 \| 值 10/);
  assert.match(text, /\nJSON \[\{/);
  await page.locator('#ptPanel .pt-msg', { hasText: /已複製|複製唔到/ }).waitFor();   // after the clipboard answers
  await shot(page, 'playtest-export-phone');
  await page.click('#ptPanel .pt-x');
  assert.equal(await page.locator('#ptPanel').isHidden(), true);
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('with the flag: over a new seat\'s screen (燒味 lesson) the button is on top and the seat\'s slider comes first', async () => {
  const page = await open(on.url);
  await page.locator('#ptBtn').waitFor();
  await page.click('#tutBtn');
  await page.click('#book [data-train="roast"]');
  await page.waitForFunction(() => G && G.running && G.xseat === 'roast');
  await page.frameLocator('#seatFrame').locator('#shop canvas').first().waitFor();
  await page.click('#ptBtn');
  const first = page.locator('#ptPanel .pt-row').first();
  assert.equal(await first.getAttribute('data-st'), 'roast');
  assert.equal(await page.evaluate(() => roastState().tier), 0, 'the lesson: the easiest cutting tier');
  await first.locator('input[type=range]').fill('10');
  await page.waitForFunction(() => roastState()?.knob.pcs === 5 && roastState().tier === 0);
  await shot(page, 'playtest-seat-phone');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
