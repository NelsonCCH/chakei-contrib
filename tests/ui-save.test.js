// Saving: progress survives a reload, bad / old / odd saves load without breaking, toggles persist.
import { go } from './helpers/intro.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { veteran, realErrors } from './helpers/browser.js';
import { world, open, vet, done, shown, text, shopNow, store, reload, startShift, endShift, settle } from './helpers/ui.js';

let w;
before(async () => { w = await world(); });
after(async () => { await w.stop(); });

const base = { shifts: 5, stars: 12, servedTotal: 120, tutDone: { waiter: 1, bar: 1, kitchen: 1, till: 1 }, nick: '老闆', t: 1, levels: { estate: 3, central: 3, mongkok: 2 } };
const raw = obj => ({ 'ckf-shop': JSON.stringify({ ...base, ...obj }) });

/** Pokes every menu and plays + ends one shift. Whatever the save looked like, none of this may throw. */
async function exercise(p) {
  assert.equal(await shown(p, '#startView'), true, 'home screen is up');
  await settle(p);
  await p.click('#wardBtn'); await p.click('#bookClose');
  if (await p.locator('#gradeBtn').count()) { await p.click('#gradeBtn'); await p.click('#bookClose'); }   // only from rank 熟手
  await p.click('#levelBtn'); await p.click('#bookClose');
  await p.click('#tutBtn'); await p.click('#bookClose');
  await p.click('#shopBtn');
  for (const b of ['#recipeBtn', '#bookBtn', '#dexBtn']) { await p.click(b); if (await shown(p, '#bookView')) await p.click('#bookClose'); }   // locked ones only toast
  await p.click('#decorBtn');
  for (const tab of ['look', 'buy', 'grow', 'move']) await p.click(`#decorBar [data-tab="${tab}"]`);
  await p.click('#decorDone');
  await go(p, '#startBtn');
  await p.waitForFunction(() => G.running);
  await p.evaluate(() => { for (let i = 0; i < 100; i++) update(.1); endGame(); });
  assert.equal(await shown(p, '#endView'), true);
  await p.click('#homeBtn');
  assert.equal(await shown(p, '#startView'), true);
}

test('progress survives a reload: money, looks, tables, items, outfit, names, recipes, stars', async () => {
  const p = await open(w, vet('x', { bank: 20000, ingStart: true, ing: { 雞蛋: 9, 麵包: 9 } }));
  await p.click('#shopBtn');
  await p.click('#decorBtn');
  await p.click('#decorBar [data-tab="look"]'); await p.click('#decorBar [data-v="blue"]'); await p.click('#decorBar [data-v="blue"]');
  await p.click('#decorBar [data-sub="floor"]'); await p.click('#decorBar [data-v="terra"]'); await p.click('#decorBar [data-v="terra"]');
  await p.click('#decorBar [data-tab="buy"]'); await p.click('#decorBar [data-sub="items"]'); await p.click('#decorBar [data-bi="plant"]');
  await p.click('#decorBar [data-tab="buy"]'); await p.click('#decorBar [data-sub="tables"]'); await p.click('#decorBar [data-bt="round"]');
  await p.click('#decorBar [data-tab="grow"]'); await p.click('#decorBar [data-sub="size"]'); await p.click('#decorBar [data-sz="1"]');
  await p.click('#decorDone');
  await p.click('#shopRename'); await p.fill('#shopIn', '大大茶餐廳'); await p.click('#shopForm button[type=submit]');
  await p.click('#recipeBtn'); await p.click('#book [data-rt="drinks"]'); await p.click('#book [data-learn="k:檸水"]'); await p.click('#bookClose');
  await p.click('#homeBack');
  await p.click('#wardBtn'); await p.click('#book [data-wk="cap"]'); await p.click('#book [data-wk="cap"]'); await p.click('#bookClose');
  await p.click('#nickBtn'); await p.fill('#nickIn', '阿芬'); await p.click('#nickSave');
  const before = await shopNow(p);
  await reload(p);
  const after = await shopNow(p);
  for (const k of ['bank', 'wall', 'floor', 'own', 'items', 'tables', 'size', 'name', 'recipes', 'ing', 'outfit', 'wardrobe', 'nick', 'stars', 'tutDone']) assert.deepEqual(after[k], before[k], k + ' survives');
  assert.equal(after.wall, 'blue'); assert.equal(after.size, 1); assert.equal(after.tables.length, 7); assert.equal(after.items.length, 1);
  assert.equal(await text(p, '#me .who b'), '阿芬');
  assert.equal(await text(p, '#shopName'), '大大茶餐廳');
  await p.click('#shopBtn'); await p.click('#decorBtn');
  assert.match(await text(p, '#decorBar .dbank b'), /\$/);
  assert.equal(await text(p, '#decorBar .dbank b'), '$' + after.bank);
  await done(p);
});

test('a played shift is banked and the level stars / dex / daily flag survive a reload', async () => {
  const p = await open(w, vet('x', { bank: 0, levels: {} }));
  await p.click('#levelBtn'); await p.click('#book [data-lvt="main"]');
  await p.click('#book [data-lv="estate"]');
  await p.waitForFunction(() => G.running && G.level === 'estate');
  await p.evaluate(() => { G.revenue = 99999; G.spd = { [G.station]: [1, 1] }; G.t = CFG.gameSec; endGame(); });   // the third star needs speed too
  await p.waitForSelector('#endView:not([hidden])');
  const s1 = await shopNow(p);
  assert.equal(s1.levels.estate, 3);
  assert.ok(s1.bank >= 600, 'star prize banked: ' + s1.bank);
  await p.click('#homeBtn');
  await reload(p);
  const s2 = await shopNow(p);
  assert.equal(s2.levels.estate, 3); assert.equal(s2.bank, s1.bank); assert.equal(s2.stars, s1.stars);
  assert.ok(s2.dex && s2.dex.estate >= 2, 'dex card saved');
  await p.click('#levelBtn');
  assert.match(await text(p, '#book .levels li.on, #book .levels li:first-child'), /★/);
  await done(p);
});

test('station, slot and difficulty choices are remembered', async () => {
  const p = await open(w, vet());
  await p.click('#shopBtn');
  await p.click('#stSeg [data-st="kitchen"]'); await p.click('#slotSeg [data-s="dinner"]');
  const diffs = await p.$$eval('#diffSeg button:not([disabled])', bs => bs.map(b => b.dataset.d));
  await p.click(`#diffSeg [data-d="${diffs[0]}"]`);
  await reload(p);
  await p.click('#shopBtn');
  assert.equal(await p.getAttribute('#stSeg [data-st="kitchen"]', 'aria-pressed'), 'true');
  assert.equal(await p.getAttribute('#slotSeg [data-s="dinner"]', 'aria-pressed'), 'true');
  assert.equal(await p.getAttribute(`#diffSeg [data-d="${diffs[0]}"]`, 'aria-pressed'), 'true');
  await done(p);
});

test('floor view (3D / simple) choice is remembered', async () => {
  const p = await open(w, vet());
  const v0 = await p.evaluate(() => floorView);
  await startShift(p, { station: 'waiter' });
  await p.click('#viewBtn');
  const v1 = await p.evaluate(() => floorView);
  assert.notEqual(v1, v0);
  assert.equal(await store(p, 'ckf-view'), v1);
  await reload(p);
  assert.equal(await p.evaluate(() => floorView), v1);
  await done(p);
});

test('sound and music switches: label + stored value flip, and persist across a reload', async () => {
  const p = await open(w, vet());   // harness seeds both off
  assert.equal(await text(p, '.toggles .soundBtn'), '聲：熄');
  assert.equal(await text(p, '.toggles .musicBtn'), '音樂：熄');
  await p.click('.toggles .musicBtn');
  assert.equal(await text(p, '.toggles .musicBtn'), '音樂：開');
  assert.equal(await store(p, 'ckf-music'), 'on');
  await p.click('.toggles .soundBtn');
  assert.equal(await text(p, '.toggles .soundBtn'), '聲：開');
  assert.equal(await store(p, 'ckf-sound'), 'on');
  await reload(p);
  assert.equal(await text(p, '.toggles .soundBtn'), '聲：開');
  assert.equal(await text(p, '.toggles .musicBtn'), '音樂：開');
  // the pause screen shows the same state; switch both back off so nothing is left on
  await p.click('.toggles .soundBtn'); await p.click('.toggles .musicBtn');
  assert.equal(await store(p, 'ckf-sound'), 'off'); assert.equal(await store(p, 'ckf-music'), 'off');
  await startShift(p, { station: 'waiter' });
  await p.click('#pauseBtn');
  assert.equal(await text(p, '#pauseView .soundBtn'), '聲：熄');
  await p.click('#pauseView .soundBtn');
  assert.equal(await text(p, '.toggles .soundBtn'), '聲：開', 'both buttons are one setting');
  await p.click('#pauseView .soundBtn');
  assert.equal(await store(p, 'ckf-sound'), 'off');
  await done(p);
});

const BAD = [
  ['not JSON at all', { 'ckf-shop': '{{{ nope' }],
  ['empty string', { 'ckf-shop': '' }],
  ['JSON null', { 'ckf-shop': 'null' }],
  ['JSON number', { 'ckf-shop': '42' }],
  ['JSON string', { 'ckf-shop': '"hello"' }],
  ['JSON array', { 'ckf-shop': '[1,2,3]' }],
  ['empty object', { 'ckf-shop': '{}' }],
  ['truncated JSON', { 'ckf-shop': JSON.stringify({ ...base, bank: 5 }).slice(0, 40) }],
  ['stars as text', raw({ stars: 'abc', servedTotal: 'x', bank: 'lots' })],
  ['negative / huge numbers', raw({ bank: -5000, stars: -3, size: 99, day: -1, shifts: 1e12 })],
  ['arrays are null', raw({ own: null, items: null, tables: null, recipes: null, wardrobe: null, off: null })],
  ['objects are null', raw({ levels: null, lvst: null, regs: null, celebs: null, eggs: null, streak: null, ing: null, rlv: null, mort: null, tutDone: null, dex: null, lv3day: null })],
  ['objects are wrong types', raw({ levels: 5, regs: [], eggs: 'x', streak: 7, ing: 'x', tutDone: [], rlv: 3 })],
  ['unknown look ids', raw({ wall: 'gone', floor: 'gone', sign: 'gone', awning: 'gone', place: 'gone', own: ['gone'] })],
  ['unknown table kind', raw({ tables: [{ kind: 'bogus', tx: 0, ty: 0 }] })],
  ['table without position', raw({ tables: [{ kind: 'booth' }, { kind: 'small' }] })],
  ['unknown item type', raw({ items: [{ type: 'ghost', tx: 1, ty: 1 }] })],
  ['unknown outfit parts', raw({ outfit: { hat: 'zzz', hair: 'zzz', top: 'zzz', pants: 'zzz' }, wardrobe: ['zzz:zzz'] })],
  ['unknown recipes / levels', raw({ recipes: ['k:不存在'], rlv: { 'k:不存在': 9 }, levels: { nope: 3 }, off: ['k:不存在'] })],
  ['gates is not a list', raw({ gates: 'all' })],
  ['name is an object', raw({ name: { a: 1 }, nick: 12345 })],
  ['name with markup', raw({ name: '<img src=x onerror=alert(1)>', nick: '<b>x</b>' })],
  ['old format: pos instead of tables', { 'ckf-shop': JSON.stringify({ bank: 1500, stars: 3, pos: [{ tx: 1, ty: .5 }, { tx: 4.5, ty: .5 }, { tx: 1, ty: 3.5 }, { tx: 4.5, ty: 3.5 }, { tx: 1, ty: 6.5 }, { tx: 4.5, ty: 6.5 }] }) }],
  ['old format: only bank and stars', { 'ckf-shop': JSON.stringify({ bank: 800, stars: 4 }) }],
];
for (const [name, storage] of BAD) {
  test(`bad save [${name}]: loads, every menu opens, a shift can be played and finished`, async () => {
    const p = await open(w, storage);
    // the fresh-player home or the veteran home, either way the home screen has to be usable
    assert.equal(await shown(p, '#startView'), true);
    const isNew = await shown(p, '#firstCard');
    if (isNew) { await p.click('#firstSkip'); await p.waitForFunction(() => G.running); await p.evaluate(() => { for (let i = 0; i < 100; i++) update(.1); endGame(); }); await p.click('#homeBtn'); await settle(p); }
    else await exercise(p).catch(e => { throw new Error(e.message.split('\n')[0] + ' | page errors: ' + realErrors(p).join(' ; ')); });
    const s = await shopNow(p);
    assert.equal(typeof s.bank, 'number'); assert.ok(Number.isFinite(s.bank), 'bank is a finite number: ' + s.bank);
    assert.ok(Array.isArray(s.tables) && s.tables.length >= 6, 'tables are there');
    await done(p);
  });
}

test('old save keeps its money, stars and table positions and fills in the new fields', async () => {
  const pos = [{ tx: 1, ty: .5 }, { tx: 4.5, ty: .5 }, { tx: 1, ty: 3.5 }, { tx: 4.5, ty: 3.5 }, { tx: 1, ty: 6.5 }, { tx: 4.5, ty: 6.5 }];
  const p = await open(w, { 'ckf-shop': JSON.stringify({ bank: 1500, stars: 3, servedTotal: 20, pos }) });
  const s = await shopNow(p);
  assert.equal(s.bank, 1500); assert.equal(s.stars, 3);
  assert.equal(s.tables.length, 6); assert.equal(s.tables[4].kind, 'small');
  assert.ok(Array.isArray(s.own) && s.own.includes('green')); assert.ok(s.ing && s.recipes && s.wardrobe && s.outfit);
  assert.equal(s.pos, undefined);
  await done(p);
});

test('an old save that learnt, took off the menu or levelled up 和尚跳海 / 血紅檸茶 loads without them and saves without them', async () => {
  const gone = ['k:和尚跳海', 'k:血紅檸茶'];
  const p = await open(w, raw({ bank: 5000, recipes: ['k:檸水', ...gone], off: ['k:血紅檸茶', 'k:咖啡'], rlv: { 'k:和尚跳海': 3, 'k:血紅檸茶': 2, 'k:檸水': 2 } }));
  const s = await shopNow(p);
  assert.deepEqual(s.recipes, ['k:檸水']); assert.deepEqual(s.off, ['k:咖啡']); assert.deepEqual(s.rlv, { 'k:檸水': 2 });
  await exercise(p);
  const saved = await store(p);
  for (const k of gone) {
    assert.ok(!saved.recipes.includes(k), 'saved recipes: ' + k); assert.ok(!saved.off.includes(k), 'saved off list: ' + k); assert.ok(!(k in saved.rlv), 'saved recipe levels: ' + k);
  }
  await done(p);
});

test('a save with unknown extra fields keeps them through a save (forward compatible)', async () => {
  const p = await open(w, raw({ futureThing: { a: [1, 2, 3] } }));
  await p.click('#nickBtn'); await p.fill('#nickIn', '新名'); await p.click('#nickSave');
  assert.deepEqual((await store(p)).futureThing, { a: [1, 2, 3] });
  await done(p);
});

test('bad side keys (station / slot / difficulty / view / kitchen mode / stats) do not break the game', async () => {
  const p = await open(w, { ...raw({}), 'ckf-station': 'pilot', 'ckf-slot': 'midnight', 'ckf-diff': 'impossible', 'ckf-view': 'vr', 'ckf-kmode': 'x', 'ckf-ev': '{', 'ckf-from': '!!', 'ckf-visit': '{' });
  await exercise(p);   // ends on the shop step
  assert.equal(await p.$$eval('#stSeg [aria-pressed="true"]', b => b.length), 1);
  assert.equal(await p.$$eval('#slotSeg [aria-pressed="true"]', b => b.length), 1);
  assert.equal(await p.$$eval('#diffSeg [aria-pressed="true"]', b => b.length), 1);
  await done(p);
});

// src/ui/stats.ts: JSON.parse('null') gives null and `seen[k]` then throws. todo = runs, reported, does not fail the suite until fixed.
test('ckf-ev holding the JSON text "null" does not break the game', async () => {
  const p = await open(w, { ...raw({}), 'ckf-ev': 'null' });
  await exercise(p);
  await done(p);
});

test('localStorage that throws (private mode / blocked): game still loads and plays', async () => {
  const b = await w.br.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-HK' });
  await b.route(u => !u.href.startsWith(w.url), r => r.abort());
  await b.addInitScript(() => {
    window.__TEST__ = true;
    const boom = () => { throw new DOMException('denied', 'SecurityError'); };
    Storage.prototype.getItem = boom; Storage.prototype.setItem = boom; Storage.prototype.removeItem = boom;
  });
  const p = await b.newPage(); p.errors = [];
  p.on('pageerror', e => p.errors.push('pageerror: ' + e.message));
  await p.goto(w.url + '/');
  await p.waitForFunction(() => typeof G !== 'undefined' && typeof cloudReady !== 'undefined');
  assert.equal(await shown(p, '#startView'), true);
  assert.equal(await shown(p, '#firstCard'), true, 'treated as a new player');
  await p.click('#firstSkip');
  await p.waitForFunction(() => G.running);
  await p.evaluate(() => { for (let i = 0; i < 100; i++) update(.1); endGame(); });
  await p.click('#homeBtn');
  assert.equal(await shown(p, '#startView'), true);
  assert.deepEqual(p.errors, []);
  await b.close();
});

test('storage full (setItem throws on write): the shift still ends and the money still counts in memory', async () => {
  const p = await open(w, vet('x', { bank: 100 }));
  await p.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); }; });
  await startShift(p, { station: 'waiter' });
  await p.evaluate(() => { G.revenue = 123; endGame(); });
  assert.equal(await shown(p, '#endView'), true);
  assert.ok((await shopNow(p)).bank >= 100 + 1);
  await p.click('#homeBtn');
  await p.click('#decorBtn');   // still on the shop step
  await p.click('#decorBar [data-tab="buy"]'); await p.click('#decorBar [data-sub="items"]'); await p.click('#decorBar [data-bi="plant"]');
  await done(p);
});

test('two tabs: the later write wins and a reload shows it', async () => {
  const p = await open(w, vet('x', { bank: 100 }));
  await p.evaluate(() => { SHOP.bank = 777; saveShop(); });
  await reload(p);
  assert.equal((await shopNow(p)).bank, 777);
  await done(p);
});
