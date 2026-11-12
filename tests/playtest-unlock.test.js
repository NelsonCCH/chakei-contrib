// On the preview (PLAYTEST="1", the 試玩 panel) a fresh save sees every level, tab, role,
// seat and lesson open, with no gate card, and nothing is written to the save; the live config (no flag) keeps the normal
// gates: level 1 only, no new seats, no new-seat lessons. Switching the panel off restores the gates on the same save.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, openGame, PHONE } from './helpers/browser.js';

let on, off, browser;
before(async () => { [on, off] = await Promise.all([startServer({ vars: { PLAYTEST: '1' } }), startServer()]); browser = await launch(); });
after(async () => { await browser?.close(); await on?.stop(); await off?.stop(); });

const open = url => openGame(browser, url, { device: { ...PHONE, viewport: { width: 390, height: 666 } } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** What a player can reach right now, read from the game's own gates and screens. */
const reach = page => page.evaluate(() => {
  const main = mainLevels().map(l => l.id);
  openTraining();
  const lessons = [...document.querySelectorAll('#trainX button[data-train]')].map(b => b.dataset.train);
  document.getElementById('bookView').hidden = true;
  openLevels();
  const tabs = {};
  for (const t of [...document.querySelectorAll('[data-lvt]')].map(b => b.dataset.lvt)) {
    document.querySelector(`[data-lvt="${t}"]`).click();
    tabs[t] = { lock: !!document.querySelector('.lvwrap .lv-lock'), locked: document.querySelectorAll('.lvwrap li.locked').length, n: document.querySelectorAll('.lvwrap li').length };
  }
  const seats = [...document.querySelectorAll('#lvSt button[data-st]')].map(b => b.dataset.st + (b.textContent.includes('🔒') ? '🔒' : ''));
  document.getElementById('bookView').hidden = true;
  return {
    mainOpen: main.filter(levelOpen), allOpen: Object.keys(LEVELS).every(levelOpen), lessons, tabs, seats,
    first: document.querySelector('#startView .home').classList.contains('first'),
    save: { levels: SHOP.levels || {}, tutDone: SHOP.tutDone || {}, gates: SHOP.gates || [] },
  };
});

test('live config: a fresh save keeps the normal gates (level 1 only, no new seats or lessons)', async () => {
  const page = await open(off.url);
  await sleep(900);
  assert.equal(await page.locator('#ptBtn').count(), 0);
  const r = await reach(page);
  assert.deepEqual(r.mainOpen, ['estate'], 'only level 1');
  assert.equal(r.allOpen, false);
  assert.deepEqual(r.lessons, [], 'no new-seat lesson before the ladder brings it');
  assert.deepEqual(r.seats.filter(s => !['waiter', 'bar', 'kitchen', 'till'].includes(s)), [], 'no extra seat offered');
  assert.ok(r.tabs.era.lock && r.tabs.old.lock && r.tabs.classic.lock && r.tabs.hell.lock, 'the era / old / classic / hell tabs are locked');
  assert.ok(r.first, 'the first-time home');
  await page.context().close();
});

test('preview: a fresh save sees every level, tab, seat and lesson, no gate card, and the save is untouched; off restores the gates', async () => {
  const page = await open(on.url);
  await page.locator('#ptBtn').waitFor();
  await sleep(900);
  const r = await reach(page);
  assert.equal(r.allOpen, true, 'every level open');
  for (const [t, v] of Object.entries(r.tabs)) { assert.equal(v.lock, false, `tab ${t} open`); assert.equal(v.locked, 0, `no locked level on tab ${t}`); }
  const xs = ['runner', 'takeaway', 'roast'];
  assert.deepEqual([...r.lessons].sort(), [...xs].sort(), 'every new-seat lesson');
  // seats are roles only: 傳菜 / 外賣 have lessons but are 樓面's tasks, not seats
  for (const k of ['roast']) assert.ok(r.seats.includes(k), `seat ${k} offered without its lesson`);
  for (const k of ['runner', 'takeaway']) assert.ok(!r.seats.includes(k), `${k} is not a seat`);
  assert.equal(r.first, false, 'the full home');
  assert.equal(await page.locator('#gatePop').count(), 0, 'no gate card');
  assert.deepEqual(r.save, { levels: {}, tutDone: {}, gates: [] }, 'nothing written to the save');
  // a seat picks without its lesson, and a locked level arms
  assert.equal(await page.evaluate(() => pickX('roast')), true);
  // the switch off: the same save is back on the normal gates
  await page.click('#ptBtn');
  await page.click('#ptPanel [data-pt=allopen]');
  const r2 = await reach(page);
  assert.deepEqual(r2.mainOpen, ['estate']);
  assert.deepEqual(r2.lessons, []);
  assert.ok(r2.tabs.era.lock && r2.tabs.hell.lock);
  assert.equal(await page.evaluate(() => localStorage.getItem('ckf_pt_allroles')), '0');
  assert.deepEqual(r2.save, { levels: {}, tutDone: {}, gates: [] }, 'still nothing written');
  await page.context().close();
});
