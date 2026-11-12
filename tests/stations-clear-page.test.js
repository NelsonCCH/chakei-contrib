// 執枱: the standalone page (site/stations/clear.html) in a headless, muted browser at phone size. Real taps on the
// three big buttons clear a table; the test reads the core's state only to know how many of each kind there are (the
// screen never shows it). One over-tap resets the table and shows the flash; the done stamp shows the time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, PHONE, WEBKIT, OUT } from './helpers/browser.js';
import { staticServer } from './helpers/stations-sim.js';
import { join } from 'node:path';

let srv, browser;
before(async () => { srv = await staticServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const shot = (page, name) => page.screenshot({ path: join(OUT, `stations-clear-${name}${WEBKIT ? '-webkit' : ''}.png`) });
const left = () => {
  const tb = window.__st.s.tables[0], c = { plate: 0, bowl: 0, cup: 0 };
  for (const it of tb.items) if (it.goneAt === null) c[it.k]++;
  return c;
};
const ready = () => { const s = window.__st.s; return !!s && s.tables.length > 0 && s.hold === 0 && s.pen === 0; };

test('start, an over-tap resets the table, then real taps clear it and the done stamp shows the time', async () => {
  const ctx = await browser.newContext({ ...PHONE, locale: 'zh-HK', serviceWorkers: 'block' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.url + '/stations/clear.html');
  await page.waitForFunction(() => !!window.__st);
  assert.equal(await page.evaluate(() => window.__st.s), null, 'nothing runs before the start card');
  await shot(page, 'start');
  await page.click('#segDiff button[data-v="pro"]');
  await page.click('#bGo');
  await page.waitForFunction(ready);
  assert.equal(await page.isVisible('#ovStart'), false);
  assert.equal(await page.evaluate(() => window.__st.s.tier), 4, '熟手 is tier 4');
  // the three buttons sit on screen, fully, at phone size
  for (const k of ['plate', 'bowl', 'cup']) {
    const b = await page.locator(`.key[data-k="${k}"]`).boundingBox();
    assert.ok(b.y >= 0 && b.y + b.height <= 844 && b.height >= 80, `${k} button on screen: ${JSON.stringify(b)}`);
  }
  await shot(page, 'table');
  const tb0 = await page.evaluate(() => ({ table: window.__st.s.tables[0].table, n: window.__st.s.tables[0].items.length }));
  // take every cup, then one cup too many: everything comes back
  const c0 = await page.evaluate(left);
  for (let i = 0; i < c0.cup; i++) await page.click('.key[data-k="cup"]');
  assert.equal((await page.evaluate(left)).cup, 0, 'each tap took one cup');
  await page.click('.key[data-k="cup"]');
  await page.waitForFunction(() => window.__st.s.tables[0].resets === 1);
  assert.deepEqual(await page.evaluate(left), c0, 'the table is back to its start set');
  await page.waitForTimeout(250);
  await shot(page, 'reset');
  await page.click('.key[data-k="plate"]');
  assert.equal((await page.evaluate(left)).plate, c0.plate, 'a tap during the reset lock takes nothing');
  // now carefully: every kind, by real taps
  await page.waitForFunction(ready);
  for (const k of ['plate', 'bowl', 'cup']) for (let i = 0; i < c0[k]; i++) {
    await page.click(`.key[data-k="${k}"]`);
    await page.waitForTimeout(40);
  }
  await page.waitForFunction(t => window.__st.s.last && window.__st.s.last.table === t, tb0.table);
  const done = await page.evaluate(() => window.__st.s.last);
  assert.equal(done.resets, 1);
  assert.equal(done.taps, tb0.n + c0.cup + 1, 'taps: the full table, the cups before the reset and the over-tap');
  await page.waitForTimeout(350);
  await shot(page, 'done');
  assert.match(await page.textContent('#hs'), new RegExp(`執咗 1 張 · 平均 ${done.secs.toFixed(1)}秒`));
  // the next table comes up by itself
  await page.waitForFunction(t => window.__st.s.tables[0] && window.__st.s.tables[0].table !== t && window.__st.s.hold === 0, tb0.table);
  // the hardest free-play key, from the menu
  await page.click('#bMenu');
  await page.click('#segDiff button[data-v="ace"]');
  await page.click('#bGo');
  await page.waitForFunction(() => window.__st.s.tier === 6 && window.__st.s.tables.length > 0);
  await page.waitForTimeout(300);
  await shot(page, 'ace');
  assert.deepEqual(errors, []);
  await ctx.close();
});
