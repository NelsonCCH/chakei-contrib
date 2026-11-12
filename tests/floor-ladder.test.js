// 樓面 along the ladder at 390x666, headless and muted: 伙記 plays the floor from level 1 (seating
// and order-taking; a dirty table is still the one-tap clean there), 執枱 joins at 中環, and the floor's two own tasks
// each have a lesson of their own (執枱, 送外賣) played on the shop map, with a 新工作 card where they join the ladder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, ROOT } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, ROLES_REACHED, PHONE, realErrors, shot } from './helpers/browser.js';
import { mapTap, mapKinds } from './helpers/map.js';

const BOTS = readFileSync(join(ROOT, 'tests', 'helpers', 'bots.browser.js'), 'utf8');
const P666 = { ...PHONE, viewport: { width: 390, height: 666 } };
let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

/** Lock-step: up to `sec` game seconds, or until `until` (a page function's source) says yes; `press` each 3rd step. */
const run = (page, sec, until, press = '') => page.evaluate(([sec, until, press]) => {
  const done = new Function('return (' + until + ')()'), pr = press ? new Function('return ' + press)() : null;
  let now = performance.now();
  for (let i = 0; i < sec / .05 && G.running; i++) {
    if (!G.paused) shiftStep(.05);
    now += 50; coopFrame(now); floorFrame(); if (G.tut) tutTick();
    if (pr && i % 3 === 0) pr();
    if (done()) return { ok: true, t: G.t };
  }
  return { ok: !G.running || done(), t: G.t, running: G.running };
}, [sec, until, press]);

async function levelShift(id, shop = {}) {
  const page = await openGame(browser, srv.url, { device: P666, storage: veteran('測試員', shop) });
  await page.addScriptTag({ content: BOTS });
  await page.click('#levelBtn');
  await page.click('#lvSt [data-st="waiter"]');
  await page.click(`#book [data-lv="${id}"]`);
  await page.waitForFunction(lv => G && G.running && G.level === lv, id);
  await page.evaluate(() => { Bot.stop?.(); });
  return page;
}

test('level 1 (屋邨): 伙記 is the 樓面 floor1, the strip says 樓面, the map has only seating, ordering and the one-tap 執', { timeout: 120000 }, async () => {
  const page = await levelShift('estate');
  assert.ok(await page.evaluate(() => !!G.floor), 'the floor is on at level 1');
  const seats = await page.evaluate(() => Object.values(referee().seats).filter(s => s.kind === 'floor').map(s => [s.id, s.driver.type]));
  assert.deepEqual(seats, [['floor1', 'player'], ['floor2', 'computer']]);
  assert.equal(await page.evaluate(() => G.roles.floor), 'me');
  assert.equal(await page.evaluate(() => G.extra), undefined, 'no extra station on level 1');
  await page.waitForFunction(() => /你做樓面/.test(document.getElementById('xStrip').innerText), null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => clearGameNow()), false, '執枱 has not joined the floor yet');
  // a party outside and a dirty table, the way the shift makes them
  const r = await run(page, 240, "() => G.tables.some(t => t.dirty > 0 && !G.groups.some(g => g.table === t.id)) && G.floor.tasks.some(t => t.k === 'clear' && t.by === null)");
  assert.ok(r.ok, 'a dirty table came up');
  const kinds = await mapKinds(page);
  assert.ok(!kinds.some(k => /spot:(pass|bag|deliver|sink|roast)/.test(k)), 'no 傳 / 包 / 送 / 洗 / 燒 station bubble on level 1: ' + kinds.join(','));
  await shot(page, 'floor-ladder-estate-666');
  const tid = await page.evaluate(() => Number(G.floor.tasks.find(t => t.k === 'clear' && t.by === null).id.split(':')[1]));
  const tap = await mapTap(page, { k: 'table', tid });
  assert.ok(tap.ok, tap.why);
  await run(page, 0.2, '() => false');
  assert.equal(await page.locator('#floorGame iframe').count(), 0, 'no 執枱 mini-game on level 1');
  assert.equal(await page.evaluate(t => G.tables[t].dirty, tid), 0, 'the table is cleaned with the tap, as before');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('中環: 執枱 has joined the floor (a dirty table opens the mini-game)', { timeout: 120000 }, async () => {
  const page = await levelShift('central', { levels: { estate: 1 } });
  assert.equal(await page.evaluate(() => clearGameNow()), true);
  // (still dirty: a worker that just cleaned one lets its task go a frame before the list drops it)
  const open = "t => t.k === 'clear' && t.by === null && G.tables[Number(t.id.split(':')[1])]?.dirty";
  const r = await run(page, 240, `() => G.floor.tasks.some(t => (${open})(t) && G.t - t.free < 2)`);
  assert.ok(r.ok, 'a dirty table came up');
  const tid = await page.evaluate(`Number(G.floor.tasks.find(${open}).id.split(':')[1])`);
  const tap = await mapTap(page, { k: 'table', tid });
  assert.ok(tap.ok, tap.why);
  await page.waitForSelector('#floorGame iframe', { state: 'visible' });
  assert.equal(await page.evaluate(() => document.getElementById('floorFrame').getAttribute('src')), 'stations/clear.html?seat');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('the budget: alone on 新年 樓面, a few bubbles at a time are mine; the computer takes the rest at once', { timeout: 120000 }, async () => {
  const page = await levelShift('newyear', { ...ROLES_LEARNED, ...ROLES_REACHED });
  const share = await page.evaluate(() => { for (let i = 0; i < 60 / .05; i++){ shiftStep(.05); coopFrame(performance.now()); floorFrame(); } return floorShareNow(); });
  assert.ok(share > 0.1 && share < 0.5, `one player's share of the floor: ${share.toFixed(2)}`);
  let most = 0, frames = 0, sum = 0;
  for (let i = 0; i < 4; i++) {
    const n = await page.evaluate(() => { let most = 0, sum = 0; let n = 0; for (let i = 0; i < 20 / .05 && G.running; i++, n++){ shiftStep(.05); coopFrame(performance.now()); floorFrame(); const k = G.floor.tasks.filter(t => t.by === null).length; most = Math.max(most, k); sum += k; } return [most, sum, n]; });
    most = Math.max(most, n[0]); sum += n[1]; frames += n[2];
  }
  assert.ok(sum / frames < 1.5, `open bubbles on average: ${(sum / frames).toFixed(2)}`);
  assert.ok(most <= 5, `never a wall of bubbles: at most ${most}`);
  await shot(page, 'floor-ladder-budget-newyear-666');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('floating text on a busy map: one a table, at most 3, a routine step only at the tapped table', { timeout: 120000 }, async () => {
  const page = await levelShift('newyear', { ...ROLES_LEARNED, ...ROLES_REACHED });
  // a minute of the floor in lock-step: every float it raises is still on screen (their timers run in real time)
  const routine = ['請坐', '搭枱', '落單', '落咗單', '埋單', '執好'];
  const after60 = await page.evaluate(() => { for (let i = 0; i < 60 / .05; i++){ shiftStep(.05); coopFrame(performance.now()); floorFrame(); } return [...document.querySelectorAll('#fx .float')].map(f => f.textContent); });
  assert.ok(after60.length <= 3, `floats on screen after a minute: ${after60.join(' ')}`);
  assert.ok(after60.every(t => !routine.includes(t)), `no routine step floats from tables nobody tapped here: ${after60.join(' ')}`);
  await page.waitForTimeout(1300);
  await page.evaluate(() => { G.paused = true; });
  const [t1, t2, t3, t4] = await page.evaluate(() => mapNow().tables.slice(0, 4).map(t => t.tid));
  const texts = () => page.evaluate(() => [...document.querySelectorAll('#fx .float')].map(f => f.textContent));
  await page.evaluate(t => floatAt(t, '請坐', 'var(--ok)'), t1);
  assert.deepEqual(await texts(), [], 'a routine step at a table this phone did not tap: no float');
  const tap = await mapTap(page, { k: 'table', tid: t1 });
  assert.ok(tap.ok, JSON.stringify(tap));
  await page.evaluate(t => { floatAt(t, '落咗單', 'var(--amber)'); floatAt(t, '埋單', 'var(--mute)'); }, t1);
  assert.deepEqual(await texts(), ['埋單'], 'the tapped table floats its steps, one at a time, the newest replacing');
  await page.evaluate(([a, b, c]) => { floatAt(a, '嬲走！', 'var(--red)'); floatAt(b, '我要熱嘅！', 'var(--red)'); floatAt(c, '碟嘢要整過', 'var(--red)'); }, [t2, t3, t4]);
  assert.deepEqual(await texts(), ['嬲走！', '我要熱嘅！', '要整過'], 'mistakes always float, at most 3 at once (oldest out), short wording');
  await shot(page, 'floor-ladder-floats-newyear-666');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('gates: 執枱 lesson and card from 中環, 送外賣 from level 5; none before; the card leads to 員工培訓', { timeout: 60000 }, async () => {
  const fresh = await openGame(browser, srv.url, { device: P666, storage: veteran('測試員') });
  assert.deepEqual(await fresh.evaluate(() => ['clear', 'deliver'].map(floorLessonNow)), [false, false]);
  await fresh.evaluate(() => openTraining());
  assert.equal(await fresh.locator('#trainF').count(), 0, 'no 樓面 lesson on a fresh save');
  await fresh.context().close();
  const page = await openGame(browser, srv.url, { device: P666, storage: veteran('測試員', { levels: { estate: 1 }, gates: ['shop', 'rookie', 'dex', 'pro', 'branch', 'x_runner'] }) });
  assert.deepEqual(await page.evaluate(() => ['clear', 'deliver'].map(floorLessonNow)), [true, false]);
  await page.waitForSelector('#gatePop');
  assert.equal(await page.locator('#gatePop h2').innerText(), '新工作：執枱');
  await shot(page, 'floor-ladder-gate-clear-666');
  await page.click('#gateGo');
  await page.waitForSelector('#trainF [data-train="clear"]');
  assert.equal(await page.locator('#trainF [data-train="deliver"]').count(), 0);
  await page.context().close();
  const late = await openGame(browser, srv.url, { device: P666, storage: veteran('測試員', ROLES_REACHED) });
  assert.deepEqual(await late.evaluate(() => ['clear', 'deliver'].map(floorLessonNow)), [true, true]);
  await late.context().close();
});

async function lesson(k) {
  const page = await openGame(browser, srv.url, { device: P666, storage: veteran('測試員', ROLES_REACHED) });
  await page.addScriptTag({ content: BOTS });
  await page.evaluate(() => openTraining());
  await page.click(`#trainF [data-train="${k}"]`);
  await page.waitForFunction(() => G && G.running && G.tut && G.floor);
  await page.evaluate(() => { Bot.stop?.(); });
  // the boss's lesson line stays until tapped, like every lesson's
  await page.locator('#bossSay').waitFor();
  assert.match(await page.locator('#bossSay').innerText(), new RegExp('教學關：' + (k === 'clear' ? '執枱' : '送外賣')));
  await page.click('#bossSay');
  return page;
}

test('lesson 執枱: three dirty tables one at a time on the map, cleared in the mini-game; 學識獎 $300', { timeout: 150000 }, async () => {
  const page = await lesson('clear');
  assert.equal(await page.evaluate(() => G.tutF), 'clear');
  assert.deepEqual(await page.evaluate(() => Object.values(referee().seats).filter(s => s.kind === 'floor').map(s => [s.id, s.driver.type])), [['floor1', 'player']], 'the floor is the player alone');
  const bank0 = await page.evaluate(() => SHOP.bank);
  for (let i = 0; i < 3; i++) {
    const r = await run(page, 10, '() => G.tables.some(t => t.dirty > 0)');
    assert.ok(r.ok, `dirty table ${i + 1} came`);
    const tid = await page.evaluate(() => G.tables.find(t => t.dirty > 0).id);
    if (i === 0) { await run(page, 0.1, '() => false'); await shot(page, 'floor-ladder-lesson-clear-map-666'); }
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));   // the floor's canvases are back (after the last job's screen) before the tap
    const tap = await mapTap(page, { k: 'table', tid });
    assert.ok(tap.ok, tap.why);
    await page.waitForSelector('#floorGame iframe', { state: 'visible' });
    await page.frameLocator('#floorFrame').locator('canvas').first().waitFor();
    if (i === 0) { await run(page, 0.5, '() => false'); assert.match(await page.locator('#tutHint').innerText(), /碟／碗／杯/); await shot(page, 'floor-ladder-lesson-clear-game-666'); }
    const res = await run(page, 60, `() => !G.tables[${tid}].dirty && floorJob() === null`, 'clearBotPress');
    assert.ok(res.ok, `table ${i + 1} cleared`);
  }
  await run(page, 5, '() => !G.running');
  await page.waitForSelector('#endView:not([hidden])');
  assert.equal(await page.evaluate(() => SHOP.tutDone.clear), true);
  assert.ok(await page.evaluate(() => SHOP.bank) - bank0 >= 300, 'the 學識獎');
  assert.match(await page.locator('#result').innerText(), /第一次完成，獎 [$]300/);
  assert.match(await page.locator('#result').innerText(), /僱員培訓 · 執枱/);
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('lesson 送外賣: two bags at the door go in one run from the map\'s 送, then one more; 學識獎 $300', { timeout: 200000 }, async () => {
  const page = await lesson('deliver');
  assert.equal(await page.evaluate(() => G.tutF), 'deliver');
  const bank0 = await page.evaluate(() => SHOP.bank);
  let first = true;
  for (let guard = 0; guard < 4 && (await page.evaluate(() => G.running)); guard++) {
    const r = await run(page, 10, "() => G.floor.tasks.some(t => t.k === 'deliver' && t.by === null)");
    if (!r.ok) break;
    if (first) { await run(page, 0.1, '() => false'); await shot(page, 'floor-ladder-lesson-deliver-map-666'); }
    // the first run is a real pointer tap on the map's 送; later ones act on the bubble directly (after a run the camera can
    // leave the 送 card under the strip at 390x666)
    if (first) { const tap = await mapTap(page, { k: 'spot', spot: 'deliver' }); assert.ok(tap.ok, tap.why); }
    else await page.evaluate(() => mapAct({ k: 'spot', spot: 'deliver' }));
    await page.waitForSelector('#floorGame iframe', { state: 'visible' });
    if (first) assert.equal((await page.evaluate(() => floorJob().ids)).length, 2, 'one run takes both bags');
    await page.frameLocator('#floorFrame').locator('canvas').first().waitFor();
    if (first) { await run(page, 3, '() => false', 'deliverBotPress'); assert.match(await page.locator('#tutHint').innerText(), /加速/); await shot(page, 'floor-ladder-lesson-deliver-game-666'); }
    first = false;
    const res = await run(page, 120, '() => floorJob() === null', 'deliverBotPress');
    assert.ok(res.ok, 'the rider came back');
  }
  await run(page, 5, '() => !G.running');
  await page.waitForSelector('#endView:not([hidden])');
  assert.equal(await page.evaluate(() => SHOP.tutDone.deliver), true);
  assert.ok(await page.evaluate(() => SHOP.bank) - bank0 >= 300, 'the 學識獎');
  assert.match(await page.locator('#result').innerText(), /第一次完成，獎 [$]300/);
  assert.match(await page.locator('#result').innerText(), /僱員培訓 · 送外賣/);
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
