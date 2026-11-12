// Shared helpers for the ui-*.test.js files (menus, shop, notify, save, cloud, visuals, offline).
import { go } from './intro.js';
import assert from 'node:assert/strict';
import { startServer } from './server.js';
import { launch, openGame, realErrors, veteran } from './browser.js';

/** veteran() plus cleared levels, which the dex gate (茶餐廳圖鑑: two levels played) needs on top of the rank gates. */
export const vet = (nick, extra = {}) => veteran(nick, { levels: { estate: 3, central: 3, mongkok: 2 }, ...extra });

/** One local Worker + one headless muted Chromium for a test file. */
export async function world(vars) {
  const srv = await startServer(vars ? { vars } : {});
  const br = await launch();
  return { srv, br, url: srv.url, async stop() { await br.close().catch(() => {}); await srv.stop(); } };
}
export async function open(w, storage, opts = {}) {
  const p = await openGame(w.br, w.url, { storage, ...opts });
  p.setDefaultTimeout(6000);   // a control that cannot be clicked should fail fast, not after 30 s
  return p;
}
/** Dismisses any unlock pop-ups (they appear ~400 ms after the home screen renders and cover it). */
export async function settle(page) {
  for (let i = 0; i < 6; i++) {
    await sleep(450);
    if (await page.locator('#gatePop').count()) await page.click('#gateLater'); else return;
  }
}

/** Asserts the page had no real errors, then closes its context. Call at the end of every browser test. */
export async function done(page) {
  const errs = realErrors(page);
  await page.context().close();
  assert.deepEqual(errs, []);
}

export const store = (page, key = 'ckf-shop') => page.evaluate(k => { const v = localStorage.getItem(k); try { return JSON.parse(v); } catch { return v; } }, key);
export const shopNow = page => page.evaluate(() => JSON.parse(JSON.stringify(SHOP)));
export const overlays = page => page.evaluate(() => [...document.querySelectorAll('.overlay')].filter(e => !e.hidden).map(e => e.id));
export const shown = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0; }, sel);
export const text = (page, sel) => page.locator(sel).first().innerText();
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The id of the topmost overlay-ish element at a viewport point. */
export const topAt = (page, x, y) => page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); const o = e && e.closest('.overlay, .sheetwrap, #decorBar, #toast'); return o ? o.id : (e ? e.tagName : null); }, [x, y]);

/**
 * localStorage survives a reload in a real browser, but openGame's init script re-seeds on every navigation.
 * So snapshot the storage first and restore it with a later init script (which runs after the seeding one).
 */
export async function reload(page) {
  const snap = await page.evaluate(() => ({ ...localStorage }));
  await page.context().addInitScript(s => { try { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } catch (e) {} }, snap);
  await page.reload();
  await page.waitForFunction(() => typeof G !== 'undefined' && typeof cloudReady !== 'undefined');
  await page.evaluate(() => cloudReady);
}

/** Home screen -> "my shop" step with the given station/slot, then starts the shift. */
export async function startShift(page, { station, slot } = {}) {
  if (await page.evaluate(() => document.querySelector('.home').dataset.step) !== 'shop') await page.click('#shopBtn');
  if (station) await page.click(`#stSeg [data-st="${station}"]`);
  if (slot) await page.click(`#slotSeg [data-s="${slot}"]`);
  await go(page, '#startBtn');
  await page.waitForFunction(() => G.running && document.getElementById('startView').hidden);
}
/** Ends the running shift now with the given counters (so each end-of-shift message can be reached). */
export const endShift = (page, fields = {}) => page.evaluate(f => { Object.assign(G, f); endGame(); }, fields);
