// Single player, menu content:
// 和尚跳海 and 血紅檸茶 are off the menu everywhere (data, recipe book, dex, levels, orders of played shifts).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, realErrors } from './helpers/browser.js';
import { openSingle, startShift, runToEnd, ALL_RECIPES } from './helpers/single.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

// 滾水蛋 is what customers called 和尚跳海
const GONE = ['和尚跳海', '血紅檸茶', '滾水蛋'];
const noneOf = (where, txt) => { for (const d of GONE) assert.ok(!txt.includes(d), `${where} names ${d}`); };

test('和尚跳海 and 血紅檸茶 are nowhere: game data, recipe book, dex, level menus, orders and played shifts', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60, recipes: ALL_RECIPES } });
  // the game's own tables
  noneOf('game data', await page.evaluate(() => JSON.stringify({ DRINKS, RECIPE, ING, ING_X, RECIPES, SPECIAL, ERA_ONLY: [...ERA_ONLY], RECIPE_FEE, NEED, FANCY, DRINK_COL, DEX,
    menus: Object.fromEntries(Object.entries(LEVELS).map(([id, L]) => [id, L.menu])) })));
  // the halloween level's signature drink is a drink on its own menu
  const hw = await page.evaluate(() => ({ sig: DEX.halloween.sig, menu: LEVELS.halloween.menu }));
  assert.equal(hw.sig, 'k:齋啡');
  assert.ok(hw.menu.includes(hw.sig), 'the signature is on the halloween menu');

  // the recipe book (every tab) and the dex, as the player sees them
  await page.click('#shopBtn');
  await page.click('#recipeBtn');
  for (const rt of await page.locator('#book [data-rt]').evaluateAll(es => es.map(e => e.dataset.rt))) {
    await page.click(`#book [data-rt="${rt}"]`);
    noneOf(`recipe book ${rt}`, await page.locator('#bookView').innerText());
  }
  await page.click('#bookClose');
  noneOf('dex', await page.evaluate(() => { openDex(); return document.getElementById('book').innerText; }));
  await page.evaluate(() => document.getElementById('bookClose').click());

  // orders over many seeds: free play in every time slot, and every level's menu
  const said = await page.evaluate(() => {
    const rng = s => () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const real = Math.random, lv0 = G.level, slot0 = slot, gslot0 = G.slot, seen = new Set(), lines = [];
    const places = [...['breakfast', 'lunch', 'dinner'].map(s => ({ slot: s })), ...Object.keys(LEVELS).map(id => ({ level: id, slot: LEVELS[id].slot }))];
    try {
      for (const pl of places) {
        G.level = pl.level; slot = pl.slot; G.slot = pl.slot;
        for (let seed = 1; seed <= 150; seed++) {
          Math.random = rng(seed * 7919 + places.indexOf(pl));
          const o = genOrder(1 + seed % 4);
          o.persons.forEach(p => seen.add(p.drink.d)); lines.push(...o.lines, ...itemsOf(o.persons));
        }
      }
    } finally { Math.random = real; G.level = lv0; slot = slot0; G.slot = gslot0; }
    return { drinks: [...seen], text: lines.join('\n') };
  });
  noneOf('ordered drinks', said.drinks.join(' '));
  noneOf('what customers say and the slips', said.text);
  assert.ok(said.drinks.includes('齋啡') && said.drinks.includes('鴛鴦'), 'the replacements are ordered: ' + said.drinks.join(' '));

  // a whole bar shift in free play (every recipe known), then the halloween level at the bar, both played by the bot
  const slips = [];
  await startShift(page, { station: 'bar', slot: 'dinner', diff: 'pro' });
  await runToEnd(page);
  slips.push(...await page.evaluate(() => Bot.ev.filter(e => e.type === 'submit').flatMap(e => e.slip)));
  await page.evaluate(() => { Bot.reset(); document.getElementById('startView').hidden = true; station = 'bar'; armLevel('halloween'); start(); G.regPlan = []; CFG.aiErr = 0; CFG.aiBarErr = 0; CFG.aiKitErr = 0; });
  await runToEnd(page);
  slips.push(...await page.evaluate(() => Bot.ev.filter(e => e.type === 'submit').flatMap(e => e.slip)));
  assert.ok(slips.length > 20, 'slips written: ' + slips.length);
  noneOf('played shifts', slips.join('\n'));
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
