// On a 390x666 phone viewport (headless, muted). First: a level entered after
// a shift left mid-送外賣 (唔做喇 while the rider was out) opens on the floor with no mini-game page, no stale job button
// and no 「打直部電話先」; a 送外賣 page in a short panel of a portrait phone is not paused as "landscape". Second: a
// mini-game page shows only once it has drawn a fresh frame: at the moment it becomes visible its start card is hidden
// and its state is this job's (執枱: the new table, not the last one under its 「執好」 stamp), on open and on re-open.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, ROLES_REACHED, realErrors, shot } from './helpers/browser.js';

const PHONE = { viewport: { width: 390, height: 666 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const STORE = veteran('測試員', { ...ROLES_LEARNED, ...ROLES_REACHED });
let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

/** Watches the floor job box: when a station page turns visible, notes what its page shows at that moment. */
const watchReveal = page => page.evaluate(() => {
  window.reveals = [];
  const box = document.getElementById('floorGame') ?? document.body;
  new MutationObserver(() => {
    const f = document.getElementById('floorFrame');
    if (!f || f.classList.contains('stloading') || f.dataset.seen) return;
    f.dataset.seen = '1';
    const w = f.contentWindow, d = f.contentDocument, s = w?.__st?.s ?? null;
    window.reveals.push({
      kind: document.getElementById('floorGame').dataset.kind, start: d?.getElementById('ovStart')?.hidden ?? null, rot: d?.getElementById('rot')?.hidden ?? null,
      state: s !== null, table: s?.tables?.[0]?.table ?? null, hold: s?.hold ?? null,
    });
  }).observe(box, { subtree: true, attributes: true, attributeFilter: ['class'] });
});
const nthReveal = async (page, n) => (await page.waitForFunction(k => window.reveals.length >= k && window.reveals[k - 1], n, { timeout: 8000 })).jsonValue();

async function enter(page, lv) {
  await page.click('#levelBtn');
  await page.click('#lvSt [data-st="waiter"]');
  await page.click(`#book [data-lv="${lv}"]`);
}

test('送外賣: fresh first frame, no portrait pause in a short panel; a level after quitting mid-run opens on a clean floor', { timeout: 120000 }, async () => {
  const page = await openGame(browser, srv.url, { device: PHONE, storage: STORE });
  await enter(page, 'typhoon');
  await page.waitForFunction(() => G && G.running && G.floor);
  await watchReveal(page);
  const ok = await page.evaluate(() => {
    for (let i = 0; i < 4000 && G.running; i++) {
      if (!G.paused) shiftStep(.05);
      if (G.floor.tasks.some(x => x.k === 'deliver' && x.by === null)) return floorStationStart('deliver');
    }
    return false;
  });
  assert.ok(ok, 'a 送外賣 job starts from the 送 bubble');
  const r = await nthReveal(page, 1);
  assert.equal(r.kind, 'deliver');
  assert.equal(r.start, true, 'the start card is already hidden when the page shows');
  assert.equal(r.state, true, 'the page has the run when it shows');
  assert.equal(r.rot, true, 'no rotate notice in portrait');
  // a 390x666 phone: the panel in the lower half of a portrait phone (wider than tall): still not "landscape"
  await page.evaluate(() => { const f = document.getElementById('floorFrame'); f.style.flex = 'none'; f.style.height = '260px'; });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.getElementById('floorFrame').contentDocument.getElementById('rot').hidden), true, 'a short panel in portrait is not paused');
  // leave the shift mid-run (暫停 → 唔做喇), then enter 屋邨
  await page.evaluate(() => { for (let i = 0; i < 40; i++) shiftStep(.05); });
  await page.click('#pauseBtn');
  await page.click('#quitBtn');
  await enter(page, 'estate');
  const at = await page.evaluate(() => ({
    frames: document.querySelectorAll('iframe').length, game: document.getElementById('floorGame')?.hidden ?? true,
    bar: document.getElementById('floorJobs')?.innerText ?? '', floor: document.getElementById('floorWrap').hidden,
  }));
  assert.deepEqual(at, { frames: 0, game: true, bar: '', floor: false }, 'level entry: the floor, no mini-game page, no old job button');
  await page.waitForTimeout(1200);
  const later = await page.evaluate(() => ({ frames: document.querySelectorAll('iframe').length, game: document.getElementById('floorGame')?.hidden ?? true, job: floorJob() }));
  assert.deepEqual(later, { frames: 0, game: true, job: null }, 'still none a moment later');
  await shot(page, 'floor-open-fresh-estate-entry');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('執枱: the first visible frame is the new table, on open and on re-open during the last table\'s stamp', { timeout: 120000 }, async () => {
  const page = await openGame(browser, srv.url, { device: PHONE, storage: STORE });
  await enter(page, 'central');
  await page.waitForFunction(() => G && G.running && G.floor);
  await watchReveal(page);
  /** Dirties a free table (no party), derives its task and opens 執枱 on it: the table's id. */
  const openOn = (not = -1) => page.evaluate(n => {
    const tb = G.tables.find(t => t.id !== n && !t.dirty && !G.groups.some(g => g.table === t.id));
    tb.dirty = 3; shiftStep(.05);
    if (!floorJobStart('clear:' + tb.id)) throw new Error('no 執枱 job');
    return tb.id;
  }, not);
  const t1 = await openOn();
  const r1 = await nthReveal(page, 1);
  assert.deepEqual({ kind: r1.kind, start: r1.start, table: r1.table, hold: r1.hold }, { kind: 'clear', start: true, table: t1, hold: 0 }, 'first open: the table, no start card');
  // clear it piece by piece (the station's own commands), then open the next table at once, inside the stamp's hold
  await page.evaluate(() => {
    const s = clearState();
    for (const it of [...s.tables[0].items]) clearCommand({ t: 'tap', k: it.k });
  });
  assert.ok(await page.evaluate(() => clearState().hold > 0), 'the 執好 stamp holds');
  await page.waitForFunction(() => floorJob() === null, null, { timeout: 5000 });
  const t2 = await openOn(t1);
  assert.notEqual(t2, t1);
  const r2 = await nthReveal(page, 2);
  assert.deepEqual({ kind: r2.kind, start: r2.start, table: r2.table, hold: r2.hold }, { kind: 'clear', start: true, table: t2, hold: 0 }, 're-open: the new table, not the last one under its stamp');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
