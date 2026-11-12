// Helpers for the single-player tests: open the game as a veteran on a desktop-size page, inject the bot + oracle
// (tests/helpers/bots.browser.js), start shifts through the real menu buttons, and read results.
import { go } from './intro.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './server.js';
import { openGame, veteran, DESKTOP, realErrors } from './browser.js';

const BOTS = readFileSync(join(ROOT, 'tests', 'helpers', 'bots.browser.js'), 'utf8');

/** Every recipe the shop can learn (so every dish, drink and ingredient is on the menu). */
export const ALL_RECIPES = ['s:C餐', 's:常餐', 'f:沙嗲牛麵', 'f:常餐', 'f:乾炒牛河', 'f:焗豬扒飯', 'd:豉椒排骨飯', 'd:咖喱牛腩飯', 'd:白汁雞皇飯', 'd:鹹魚雞粒炒飯', 'd:焗豬扒飯',
  'k:檸水', 'k:鴛鴦', 'k:咖啡', 'k:齋啡', 'k:茶走', 'k:啡走', 'k:紅豆冰', 'k:阿華田'];

/** Desktop page (kitchen and bar use the button pad), simple floor view (one button per table), bot injected. */
export async function openSingle(browser, url, { storage = {}, shop = {}, nick = '測試員' } = {}) {
  const page = await openGame(browser, url, { device: DESKTOP, storage: { ...veteran(nick, shop), 'ckf-view': 'simple', ...storage } });
  await page.addScriptTag({ content: BOTS });
  return page;
}

/** Home -> shop -> pick station / slot / difficulty -> 開工, all through the menu buttons. */
export async function startShift(page, { station = 'waiter', slot = 'lunch', diff = 'pro', visitors = false } = {}) {
  // An unlock pop-up comes ~400 ms after the home screen shows, at a time that depends on the engine's speed. Whenever
  // one is in the way of a click below, answer 遲啲, as a player would (no timing assumption). Only while these menu
  // clicks run: tests that check the unlock cards after the shift must still see them.
  const gate = page.locator('#gatePop');
  await page.addLocatorHandler(gate, async () => { await page.click('#gateLater'); });
  try {
    if (await page.locator('#shopBtn').isVisible()) await page.click('#shopBtn');
    await page.click(`#stSeg [data-st="${station}"]`);
    await page.click(`#slotSeg [data-s="${slot}"]`);
    await page.click(`#diffSeg [data-d="${diff}"]`);
    await go(page, '#startBtn');
    await page.waitForFunction(() => G && G.running && !document.getElementById('startView').offsetParent);
  } finally {
    await page.removeLocatorHandler(gate);
  }
  // let the new screen lay out (the pixel canvases get their size on a real frame), so the bot's taps on them have somewhere to land
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 100)))));
  await page.evaluate(v => { CFG.aiErr = 0; CFG.aiBarErr = 0; CFG.aiKitErr = 0; if (!v) G.regPlan = []; }, visitors);
}

/** Make the computer players perfect, so every mistake and angry customer is the bot's own doing. */
export const perfectAI = page => page.evaluate(() => { CFG.aiErr = 0; CFG.aiBarErr = 0; CFG.aiKitErr = 0; });

/** Runs the shift synchronously in lock-step (the game loop's own body) with the bot acting between frames. */
export const run = (page, sec, o = {}) => page.evaluate(([s, o]) => Bot.run(s, o), [sec, o]);

/** Runs until the shift ends (or maxSec game seconds). */
export async function runToEnd(page, o = {}) {
  for (let i = 0; i < 30; i++) {
    if (await page.evaluate(() => !G.running)) return;
    await run(page, 30, o);
  }
}

/** A shift that does not end by itself (for tests that need more than 180 s of game time). */
export const endless = page => page.evaluate(() => { CFG.gameSec = 1e6; });

/** Runs in 2 s steps until no group is waiting for food or drink any more (or maxSec). */
export async function settleTickets(page, maxSec = 90) {
  for (let t = 0; t < maxSec; t += 2) {
    await run(page, 2);
    if (await page.evaluate(() => !G.running || G.groups.every(g => g.state !== 'wait'))) return;
  }
}

/** Runs until the room is empty again: everybody has eaten, paid and left, and the tables are clean (or maxSec). */
export async function drain(page, maxSec = 60) {
  for (let t = 0; t < maxSec; t += 2) {
    await run(page, 2);
    if (await page.evaluate(() => !G.running || (G.groups.length === 0 && G.tables.every(t => !t.dirty)))) return;
  }
}

export const state = page => page.evaluate(() => ({
  t: G.t, running: G.running, revenue: G.revenue, tips: G.tips | 0, mistakes: G.mistakes, angry: G.angry, loss: G.loss, served: G.served, paidCount: G.paidCount,
  cups: G.cups, dishes: G.dishes, combo: G.combo | 0, maxCombo: G.maxCombo | 0, groups: G.groups.length, payQ: G.payQ.length,
}));

/** Waits for the game to repaint (the DOM follows the state one animation frame later). */
export const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

/** What the HUD shows. */
export const hud = async page => { await settle(page); return page.evaluate(() => ({ rev: document.getElementById('rev').textContent, mis: document.getElementById('mis').textContent, ang: document.getElementById('ang').textContent, clock: document.getElementById('clock').textContent })); };

/** The end-of-shift card as text pairs. */
export const endCard = page => page.evaluate(() => ({
  visible: !document.getElementById('endView').hidden,
  sign: document.getElementById('endSign').textContent,
  kick: document.getElementById('endKick').textContent,
  cells: [...document.querySelectorAll('#result > div')].map(d => [d.querySelector('span') && d.querySelector('span').textContent, d.querySelector('b') && d.querySelector('b').textContent]),
  boss: document.getElementById('boss').textContent,
  next: document.getElementById('nextBtn').textContent,
  again: document.getElementById('againBtn').textContent,
}));
export const cell = (card, label) => { const c = card.cells.find(([l]) => l === label); return c ? c[1] : undefined; };

/** Fails if the bot hit missing/disabled/hidden buttons, covered buttons, invariant violations or page errors. */
export async function assertClean(assert, page, what = '') {
  const s = await page.evaluate(() => Bot.stats());
  assert.deepEqual(s.errors, [], what + ' bot errors');
  assert.deepEqual(s.unreachable, [], what + ' buttons the bot could not reach');
  assert.deepEqual(s.violations, [], what + ' invariant violations');
  assert.deepEqual(realErrors(page), [], what + ' page errors');
}
