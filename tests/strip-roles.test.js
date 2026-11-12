// Roles only at 390x666, headless and muted: the seat strip, the seat pickers (the
// own shop's, the 關卡 station segment) and the co-op lobby list 樓面, 水吧, 廚房, 收銀 and the roles of their own (燒味 ...),
// never 伙記 / 傳菜 / 外賣 / 送外賣 / 執枱 as seats (those are 樓面's tasks, entered from the map's bubbles). A floor level
// runs the floor whichever role the player picked, and the strip's data holds a role with more than one player.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, PHONE, realErrors, shot } from './helpers/browser.js';

const P666 = { ...PHONE, viewport: { width: 390, height: 666 } };
const SAVE = { ...ROLES_LEARNED, levels: { estate: 1, central: 1, mongkok: 1, airport: 1, typhoon: 1, newyear: 1 } };
const TASKS = /伙記|傳菜|外賣|送外賣|執枱/;
let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const open = () => openGame(browser, srv.url, { device: P666, storage: veteran('測試員', SAVE) });
const segSeats = (p, sel) => p.$$eval(`${sel} [data-st]`, b => b.map(x => [x.dataset.st, x.innerText.split('\n')[0].trim()]));
async function levelShift(page, id, st) {
  await page.click('#levelBtn');
  await page.click(`#lvSt [data-st="${st}"]`);
  await page.click(`#book [data-lv="${id}"]`);
  await page.waitForFunction(lv => G && G.running && G.level === lv, id);
}

test('seat pickers: roles only, 伙記\'s seat reads 樓面, no 傳菜 / 外賣 seat (an old pick of one is dropped)', { timeout: 60000 }, async () => {
  const page = await open();
  await page.evaluate(() => localStorage.setItem('ckf-xseat', 'runner'));
  await page.reload(); await page.waitForFunction(() => typeof buildMenus === 'function');
  assert.equal(await page.evaluate(() => pickedX()), '', 'a saved 傳菜 pick is dropped');
  assert.equal(await page.evaluate(() => pickX('takeaway')), false, '外賣 cannot be picked');
  await page.click('#shopBtn');
  const own = await segSeats(page, '#stSeg');
  assert.deepEqual(own.map(x => x[0]), ['waiter', 'kitchen', 'bar', 'till', 'roast'], 'own shop: ' + JSON.stringify(own));
  assert.equal(own[0][1], '樓面');
  await page.click('#homeBack');
  await page.click('#levelBtn');
  const lv = await segSeats(page, '#lvSt');
  assert.deepEqual(lv.map(x => x[0]), ['waiter', 'kitchen', 'bar', 'till', 'roast'], 'levels: ' + JSON.stringify(lv));
  assert.ok(!lv.some(x => TASKS.test(x[1])), JSON.stringify(lv));
  // the level list's seat row (its ✓ marks) lists roles too
  const rows = await page.$$eval('#book .lvst', e => e.map(x => x.innerText));
  assert.ok(rows.length > 0 && rows.every(t => !TASKS.test(t) && /樓面/.test(t)), JSON.stringify(rows));
  await shot(page, 'strip-roles-pickers-666');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('solo at 水吧 on 中環: the floor runs with the computer on it, the strip lists 水吧 and no 傳菜', { timeout: 60000 }, async () => {
  const page = await open();
  await levelShift(page, 'central', 'bar');
  assert.ok(await page.evaluate(() => !!G.floor), 'the floor runs under any seat on a floor level');
  assert.deepEqual(await page.evaluate(() => Object.values(referee().seats).filter(s => s.kind === 'floor').map(s => s.driver.type)), ['computer', 'computer']);
  assert.equal(await page.evaluate(() => referee().seats.runner), undefined, 'no 傳菜 seat');
  assert.equal(await page.evaluate(() => G.roles.bar), 'me');
  await page.waitForFunction(() => /你做水吧/.test(document.getElementById('xStrip').innerText), null, { timeout: 5000 });
  const strip = await page.evaluate(() => document.getElementById('xStrip').innerText);
  assert.ok(!TASKS.test(strip), strip);
  assert.deepEqual(await page.evaluate(() => stripRoles().map(r => r.role)), ['bar']);
  await shot(page, 'strip-roles-central-bar-666');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('solo at 樓面 on 年廿八: the strip offers 換做燒味, roles only; two players on 樓面 read ×2', { timeout: 60000 }, async () => {
  const page = await open();
  await levelShift(page, 'newyear', 'waiter');
  await page.waitForFunction(() => /你做樓面/.test(document.getElementById('xStrip').innerText), null, { timeout: 5000 });
  const roles = await page.evaluate(() => stripRoles());
  assert.deepEqual(roles.map(r => [r.role, r.sw]), [['floor', null], ['roast', 'roast']]);
  assert.ok(!TASKS.test(await page.evaluate(() => document.getElementById('xStrip').innerText)));
  // a second player on the floor (as in party rooms): the role holds both
  await page.evaluate(() => { setDriver('floor2', { type: 'player', player: 'p2' }, 'claim'); drawExtrasStrip(); });
  assert.deepEqual(await page.evaluate(() => stripRoles().filter(r => r.mine).map(r => [r.role, r.n])), [['floor', 2]]);
  await page.waitForFunction(() => /你做樓面 ×2/.test(document.getElementById('xStrip').innerText), null, { timeout: 5000 });
  await shot(page, 'strip-roles-newyear-floor2-666');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('co-op lobby on 打風前夕: 樓面1 and 樓面2 rows, roles of their own, no 傳菜 / 外賣 row', { timeout: 60000 }, async () => {
  const page = await open();
  await page.addLocatorHandler(page.locator('#gatePop'), async () => { await page.click('#gateLater'); });
  await page.click('#coopBtn'); await page.click('#hostBtn');
  await page.waitForFunction(() => NET.t && NET.t.up && NET.code);
  await page.click('#coop [data-lv="typhoon"]'); await page.waitForFunction(() => NET.level === 'typhoon');
  const rows = await page.$$eval('#coop ul.seats li b', b => b.map(x => x.innerText));
  assert.deepEqual(rows, ['樓面1', '樓面2', '廚房', '水吧', '收銀'],   // no 洗碗 row (that seat is retired)
    JSON.stringify(rows));   // 樓面's two places, each a seat (as the party lobby's)
  const hint = await page.evaluate(() => document.querySelector('#coop ul.seats + p.hint')?.innerText ?? '');
  assert.match(hint, /樓面要做埋傳菜、外賣/);
  await shot(page, 'strip-roles-lobby-666');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('an old save that learned 洗碗 loads cleanly and keeps no trace of it', { timeout: 60000 }, async () => {
  const old = { ...SAVE, tutDone: { ...SAVE.tutDone, wash: true }, tried: { wash: 1, roast: 1 }, mastery: { wash: 2 }, gates: ['x_runner', 'x_wash'],
    lvst: { mongkok: { waiter: 900, wash: 150 } } };
  const page = await openGame(browser, srv.url, { device: P666, storage: veteran('測試員', old) });
  const s = await page.evaluate(() => ({ tut: SHOP.tutDone.wash, tried: SHOP.tried?.wash, roast: SHOP.tried?.roast, mastery: SHOP.mastery?.wash, gates: SHOP.gates, lv: SHOP.lvst?.mongkok }));
  assert.ok(!s.gates.includes('x_wash'), JSON.stringify(s.gates)); delete s.gates;   // learned roles add their own cards
  assert.deepEqual(s, { tut: undefined, tried: undefined, roast: 1, mastery: undefined, lv: { waiter: 900 } });
  await page.click('#tutBtn');
  assert.equal(await page.locator('#book [data-train="wash"]').count(), 0, 'no 洗碗 lesson');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
