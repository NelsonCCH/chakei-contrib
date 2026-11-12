// Buying and equipping: decor (looks, tables, items, size), wardrobe, recipes, pantry/market crate.
// Money goes down by the right price, ownership persists, no purchase without money, the UI shows it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { veteran } from './helpers/browser.js';
import { world, open, vet, done, shown, text, shopNow, store, reload } from './helpers/ui.js';

let w;
before(async () => { w = await world(); });
after(async () => { await w.stop(); });

const bankUi = p => p.locator('#decorBar .dbank b').innerText();
async function decor(p, tab, sub) {
  if (await p.evaluate(() => document.querySelector('.home').dataset.step) !== 'shop') await p.click('#shopBtn');
  if (await shown(p, '#startView')) await p.click('#decorBtn');
  if (tab) await p.click(`#decorBar [data-tab="${tab}"]`);
  if (sub) await p.click(`#decorBar [data-sub="${sub}"]`);
}
const chipTag = (p, sel) => p.locator(`#decorBar ${sel} span`).innerText();

test('decor: buying a wall needs a preview tap then a buy tap, charges the price once, equips it', async () => {
  const p = await open(w, vet('x', { bank: 2000 }));
  await decor(p, 'look', 'wall');
  assert.equal(await bankUi(p), '$2000');
  assert.equal(await chipTag(p, '[data-v="blue"]'), '$1500');
  await p.click('#decorBar [data-v="blue"]');
  assert.equal(await chipTag(p, '[data-v="blue"]'), '買 $1500', 'first tap = preview, offers to buy');
  let s = await shopNow(p);
  assert.equal(s.bank, 2000); assert.equal(s.wall, 'green'); assert.ok(!s.own.includes('blue'));
  await p.click('#decorBar [data-v="blue"]');
  s = await shopNow(p);
  assert.equal(s.bank, 500); assert.equal(s.wall, 'blue'); assert.ok(s.own.includes('blue'));
  assert.equal(await bankUi(p), '$500');
  assert.equal(await chipTag(p, '[data-v="blue"]'), '用緊');
  assert.equal((await store(p)).wall, 'blue', 'saved to localStorage');
  assert.match(await text(p, '#toast'), /買咗/);
  // owned look can be switched back for free
  await p.click('#decorBar [data-v="green"]');
  s = await shopNow(p);
  assert.equal(s.wall, 'green'); assert.equal(s.bank, 500);
  assert.equal(await chipTag(p, '[data-v="blue"]'), '有');
  // cannot afford the cream tiles (800) with 500 left
  await p.click('#decorBar [data-v="cream"]'); await p.click('#decorBar [data-v="cream"]');
  s = await shopNow(p);
  assert.equal(s.bank, 500); assert.ok(!s.own.includes('cream'));
  assert.match(await text(p, '#toast'), /唔夠錢，仲差 \$300/);
  await done(p);
});

test('decor: floor and sign/awning looks charge their listed price', async () => {
  const p = await open(w, vet('x', { bank: 10000 }));
  await decor(p, 'look', 'floor');
  const price = await p.evaluate(() => FLOORS.check.p);
  await p.click('#decorBar [data-v="check"]'); await p.click('#decorBar [data-v="check"]');
  let s = await shopNow(p);
  assert.equal(s.bank, 10000 - price); assert.equal(s.floor, 'check');
  await p.click('#decorBar [data-sub="awning"]');
  const ak = await p.evaluate(() => Object.keys(AWNINGS).find(k => !SHOP.own.includes(k) && AWNINGS[k].p > 0 && !lookLocked(AWNINGS[k])));
  const ap = await p.evaluate(k => AWNINGS[k].p, ak);
  await p.click(`#decorBar [data-v="${ak}"]`); await p.click(`#decorBar [data-v="${ak}"]`);
  s = await shopNow(p);
  assert.equal(s.bank, 10000 - price - ap); assert.equal(s.awning, ak);
  await done(p);
});

test('estate: a district costs its 頂手費 (preview then sign); level-locked districts cannot be bought', async () => {
  const p = await open(w, vet('x', { bank: 99999 }));
  await decor(p, 'grow', 'place');
  const card = k => `#decorBar .listing[data-v="${k}"]`;
  await p.click(card('pl-estate'));
  assert.match(await text(p, card('pl-estate') + ' .ls-act'), /再撳一下簽約/);
  assert.equal((await shopNow(p)).bank, 99999);
  await p.click(card('pl-estate'));
  let s = await shopNow(p);
  assert.equal(s.bank, 99999 - 1500); assert.equal(s.place, 'pl-estate'); assert.ok(s.own.includes('pl-estate'));
  assert.match(await text(p, card('pl-estate') + ' .ls-act'), /而家喺度/);
  // locked district: even with the money it refuses
  assert.match(await text(p, card('pl-jordan') + ' .ls-act'), /三星先開放睇樓/);
  await p.click(card('pl-jordan')); await p.click(card('pl-jordan'));
  s = await shopNow(p);
  assert.ok(!s.own.includes('pl-jordan')); assert.equal(s.bank, 99999 - 1500);
  assert.match(await text(p, '#toast'), /三星先買得/);
  // going back to the free district costs nothing
  await p.click(card('pl-town'));
  s = await shopNow(p);
  assert.equal(s.place, 'pl-town'); assert.equal(s.bank, 99999 - 1500);
  await done(p);
});

test('decor: buying a table costs its price, adds a table and saves; no money = no table', async () => {
  const p = await open(w, vet('x', { bank: 100 }));
  await decor(p, 'buy', 'tables');
  await p.click('#decorBar [data-bt="small"]');
  let s = await shopNow(p);
  assert.equal(s.bank, 100); assert.equal(s.tables.length, 6);
  assert.match(await text(p, '#toast'), /唔夠錢，仲差 \$400/);
  await p.click('#decorDone');
  const q = await open(w, vet('x', { bank: 5000, size: 1 }));
  await decor(q, 'buy', 'tables');
  await q.click('#decorBar [data-bt="small"]');
  s = await shopNow(q);
  assert.equal(s.tables.length, 7, 'a table was added');
  assert.equal(s.bank, 4500);
  assert.equal((await store(q)).tables.length, 7);
  assert.equal(await q.getAttribute('#decorBar [data-tab="move"]', 'aria-pressed'), 'true', 'jumps to 擺位 to place it');
  assert.equal(await bankUi(q), '$4500');
  // sell it back for half
  await q.click('#decorSell');
  s = await shopNow(q);
  assert.equal(s.tables.length, 6); assert.equal(s.bank, 4750);
  await done(p); await done(q);
});

test('decor: a single item costs its price; selling returns half; no money = no item', async () => {
  const p = await open(w, vet('x', { bank: 200 }));
  await decor(p, 'buy', 'items');
  await p.click('#decorBar [data-bi="plant"]');
  let s = await shopNow(p);
  assert.equal(s.items.length, 0); assert.equal(s.bank, 200);
  assert.match(await text(p, '#toast'), /唔夠錢，仲差 \$100/);
  await p.click('#decorDone');
  const q = await open(w, vet('x', { bank: 1000 }));
  await decor(q, 'buy', 'items');
  await q.click('#decorBar [data-bi="plant"]');
  s = await shopNow(q);
  assert.equal(s.items.length, 1); assert.equal(s.items[0].type, 'plant'); assert.equal(s.bank, 700);
  assert.equal((await store(q)).items.length, 1);
  await q.click('#decorSell');
  s = await shopNow(q);
  assert.equal(s.items.length, 0); assert.equal(s.bank, 850);
  await q.click('#decorBar [data-tab="buy"]');
  assert.equal(await q.locator('#decorBar [data-bi="plant"] span').innerText(), '$300');
  await done(p); await done(q);
});

test('decor: expanding the shop must go small -> medium -> big, charges once, cannot skip or repeat', async () => {
  const p = await open(w, vet('x', { bank: 10000 }));
  await decor(p, 'grow', 'size');
  await p.click('#decorBar [data-sz="2"]');
  assert.equal((await shopNow(p)).size, 0);
  assert.match(await text(p, '#toast'), /要擴做中舖先/);
  await p.click('#decorBar [data-sz="1"]');
  let s = await shopNow(p);
  assert.equal(s.size, 1); assert.equal(s.bank, 7000);
  await p.click('#decorBar [data-sz="1"]');
  assert.equal((await shopNow(p)).bank, 7000, 'tapping the size you have is free and does nothing');
  await p.click('#decorBar [data-sz="2"]');
  s = await shopNow(p);
  assert.equal(s.size, 2); assert.equal(s.bank, 1000);
  await done(p);
  const q = await open(w, vet('x', { bank: 1000 }));
  await decor(q, 'grow', 'size'); await q.click('#decorBar [data-sz="1"]');
  s = await shopNow(q);
  assert.equal(s.size, 0); assert.equal(s.bank, 1000);
  assert.match(await text(q, '#toast'), /唔夠錢，仲差 \$2000/);
  await done(q);
});

test('wardrobe: first tap tries it on (free, not saved), second tap buys; owned items equip free', async () => {
  const p = await open(w, vet('x', { bank: 1000 }));
  await p.click('#wardBtn');
  const tag = k => p.locator(`#book [data-wk="${k}"] span`).innerText();
  assert.equal(await tag('cap'), '$300');
  await p.click('#book [data-wk="cap"]');
  assert.equal(await tag('cap'), '買 $300');
  let s = await shopNow(p);
  assert.equal(s.bank, 1000); assert.equal(s.outfit.hat, 'paper');
  await p.click('#book [data-wk="cap"]');
  s = await shopNow(p);
  assert.equal(s.bank, 700); assert.equal(s.outfit.hat, 'cap'); assert.ok(s.wardrobe.includes('hat:cap'));
  assert.equal(await tag('cap'), '著緊');
  assert.match(await p.locator('#book .sh-head span').innerText(), /\$700/);
  await p.click('#book [data-wk="paper"]');   // free item
  s = await shopNow(p);
  assert.equal(s.outfit.hat, 'paper'); assert.equal(s.bank, 700);
  await p.click('#book [data-wk="cap"]');       // owned: free
  s = await shopNow(p);
  assert.equal(s.outfit.hat, 'cap'); assert.equal(s.bank, 700);
  assert.equal((await store(p)).outfit.hat, 'cap');
  await done(p);
});

test('wardrobe: cannot buy without money; closing the page drops an un-bought try-on', async () => {
  const p = await open(w, vet('x', { bank: 100 }));
  await p.click('#wardBtn');
  await p.click('#book [data-wk="pomp"]'); await p.click('#book [data-wk="pomp"]');
  let s = await shopNow(p);
  assert.equal(s.bank, 100); assert.equal(s.outfit.hair, 'army'); assert.deepEqual(s.wardrobe, []);
  assert.match(await text(p, '#toast'), /唔夠錢，仲差 \$400/);
  await p.click('#book [data-wk="vest"]');     // try on, then leave without buying
  await p.click('#bookClose');
  assert.equal((await shopNow(p)).outfit.top, 'shirt');
  await p.click('#wardBtn');
  assert.equal(await p.locator('#book [data-wk="vest"] span').innerText(), '$200', 'try-on was dropped');
  await done(p);
});

test('recipes: learning needs the fee AND the ingredients; both are spent; it is saved', async () => {
  // opening kit: 牛肉3 麵2 檸檬2 茶葉2 咖啡豆4 (enough for 沙嗲牛麵, 檸水, 咖啡 and 鴛鴦)
  const p = await open(w, vet('x', { bank: 5000 }));
  await p.click('#shopBtn'); await p.click('#recipeBtn');
  await p.click('#book [data-rt="drinks"]');
  await p.click('#book [data-learn="k:檸水"]');
  let s = await shopNow(p);
  assert.equal(s.bank, 4700); assert.ok(s.recipes.includes('k:檸水')); assert.equal(s.ing['檸檬'], 0);
  assert.match(await text(p, '#toast'), /學識咗檸水/);
  assert.match(await p.locator('#book .sh-head span').innerText(), /\$4700/);
  assert.equal(await p.locator('#book [data-learn="k:檸水"]').count(), 0, 'learn button is replaced by the stars row');
  await p.click('#book [data-learn="k:咖啡"]');   // 咖啡豆 2 -> fine
  s = await shopNow(p);
  assert.equal(s.bank, 4400); assert.equal(s.ing['咖啡豆'], 2);
  await p.click('#book [data-learn="k:鴛鴦"]');   // 茶葉 2 + 咖啡豆 2 -> fine
  s = await shopNow(p);
  assert.equal(s.bank, 4000); assert.equal(s.ing['咖啡豆'], 0); assert.equal(s.ing['茶葉'], 0);
  await p.click('#book [data-learn="k:齋啡"]');   // needs 咖啡豆 3, has 0
  s = await shopNow(p);
  assert.equal(s.bank, 4000); assert.ok(!s.recipes.includes('k:齋啡'));
  assert.match(await text(p, '#toast'), /食材唔夠/);
  assert.deepEqual((await store(p)).recipes.sort(), ['k:咖啡', 'k:檸水', 'k:鴛鴦'].sort());
  await done(p);
  const q = await open(w, vet('x', { bank: 100 }));
  await q.click('#shopBtn'); await q.click('#recipeBtn'); await q.click('#book [data-rt="lunch"]');
  await q.click('#book [data-learn="f:沙嗲牛麵"]');
  s = await shopNow(q);
  assert.equal(s.bank, 100); assert.ok(!s.recipes.includes('f:沙嗲牛麵'));
  assert.match(await text(q, '#toast'), /唔夠錢，仲差 \$300/);
  await done(q);
});

test('recipes: upgrade to 2 then 3 stars spends money + 2x / 3x ingredients, then it is a signature dish', async () => {
  const p = await open(w, vet('x', { bank: 5000, ingStart: true, ing: { 檸檬: 12 }, recipes: ['k:檸水'] }));
  await p.click('#shopBtn'); await p.click('#recipeBtn'); await p.click('#book [data-rt="drinks"]');
  await p.click('#book [data-up="k:檸水"]');
  let s = await shopNow(p);
  assert.equal(s.rlv['k:檸水'], 2); assert.equal(s.bank, 4700); assert.equal(s.ing['檸檬'], 8);
  await p.click('#book [data-up="k:檸水"]');
  s = await shopNow(p);
  assert.equal(s.rlv['k:檸水'], 3); assert.equal(s.bank, 3900); assert.equal(s.ing['檸檬'], 2);
  assert.match(await text(p, '#toast'), /招牌菜/);
  assert.equal(await p.locator('#book [data-up="k:檸水"]').count(), 0, 'no further upgrade offered');
  assert.match(await text(p, '#book li.sig'), /招牌檸水/);
  await done(p);
});

test('recipes: 上咗餐牌 toggles a dish off and on, saved; the last dish of a kind cannot be switched off', async () => {
  const p = await open(w, vet('x'));
  await p.click('#shopBtn'); await p.click('#recipeBtn'); await p.click('#book [data-rt="drinks"]');
  await p.click('#book [data-sell="k:奶茶"]');
  assert.deepEqual((await shopNow(p)).off, ['k:奶茶']);
  assert.match(await text(p, '#book [data-sell="k:奶茶"]'), /冇擺上餐牌/);
  await p.click('#book [data-sell="k:奶茶"]');
  assert.deepEqual((await shopNow(p)).off, []);
  await p.click('#book [data-sell="k:奶茶"]'); await p.click('#book [data-sell="k:檸茶"]');   // the only two drinks known
  assert.deepEqual((await shopNow(p)).off, ['k:奶茶'], 'second one refused');
  assert.match(await text(p, '#toast'), /最少要賣一樣/);
  await done(p);
});

test('recipes: secret recipes stay locked until their level has stars', async () => {
  const p = await open(w, vet('x', { bank: 99999, ing: { 雞蛋: 99, 麵包: 99 }, ingStart: true }));
  await p.click('#shopBtn'); await p.click('#recipeBtn'); await p.click('#book [data-rt="special"]');
  assert.ok(await p.locator('#book .rlock').count() > 3);
  await p.evaluate(() => { document.querySelector('#book').insertAdjacentHTML('beforeend', '<button id="fakeLearn" data-learn="f:蛋撻"></button>'); });
  await p.click('#fakeLearn', { force: true });
  assert.ok(!(await shopNow(p)).recipes.includes('f:蛋撻'));
  assert.match(await text(p, '#toast'), /攞 2 粒星先報讀/);
  await done(p);
});

test('pantry: buying an ingredient costs $80, no daily cap; no money = no purchase', async () => {
  const p = await open(w, vet('x', { bank: 100, ingStart: true }));
  await p.click('#shopBtn'); await p.click('#recipeBtn'); await p.click('#pantryBtn');
  assert.match(await text(p, '#book'), /雪櫃/);
  await p.click('#book [data-buying="雞蛋"]');
  let s = await shopNow(p);
  assert.equal(s.bank, 20); assert.equal(s.ing['雞蛋'], 1); assert.equal(s.buyN, 1);
  assert.match(await text(p, '#toast'), /買咗一份雞蛋/);
  await p.click('#book [data-buying="雞蛋"]');
  assert.equal((await shopNow(p)).bank, 20, 'poor: no second purchase');
  assert.match(await text(p, '#toast'), /唔夠錢，仲差 \$60/);
  await done(p);
  const q = await open(w, vet('x', { bank: 1000, ingStart: true }));
  await q.click('#shopBtn'); await q.click('#recipeBtn'); await q.click('#pantryBtn');
  for (let i = 0; i < 5; i++) await q.click('#book [data-buying="午餐肉"]');
  s = await shopNow(q);
  assert.equal(s.bank, 600); assert.equal(s.ing['午餐肉'], 5, 'five in one day: the old cap of 3 is gone');
  assert.equal(await q.locator('#book [data-buying][disabled]').count(), 0, 'no buy button is ever disabled by a count');
  assert.match(await text(q, '#book .hint'), /冇上限/);
  assert.doesNotMatch(await text(q, '#book .hint'), /仲買得/);
  // after a reload (the old per-day count is still in the save): buying goes on, limited by money only
  await reload(q);
  await q.click('#shopBtn'); await q.click('#recipeBtn'); await q.click('#pantryBtn');
  await q.click('#book [data-buying="午餐肉"]');
  assert.equal((await shopNow(q)).ing['午餐肉'], 6);
  await done(q);
});

test('mortgage: limited by money, not by day: several instalments in one day, the button says what is short, saved', async () => {
  // 熟手 (pro gate) in 深水埗 (12000 / 12 = $1000 an instalment)
  const p = await open(w, vet('x', { bank: 2500, mort: { 'pl-town': 3 }, mortDay: '' }));
  await p.click('#shopBtn');
  assert.match(await text(p, '#mortBox'), /供舖 3\/12 期/);
  assert.match(await text(p, '#mortBox'), /一日供幾多期都得/);
  await p.click('#mortPay');
  await p.click('#mortPay');
  let s = await shopNow(p);
  assert.equal(s.mort['pl-town'], 5, 'two instalments on the same day');
  assert.equal(s.bank, 500);
  assert.match(await text(p, '#mortBox'), /供舖 5\/12 期/);
  // not enough money: the button is disabled and says the price; nothing paid
  assert.equal(await p.locator('#mortPay').isDisabled(), true);
  assert.match(await text(p, '#mortPay'), /供一期要 \$1000/);
  await p.evaluate(() => mortPay());
  s = await shopNow(p);
  assert.equal(s.mort['pl-town'], 5); assert.equal(s.bank, 500);
  assert.match(await text(p, '#toast'), /唔夠錢，仲差 \$500/);
  // after-effect: a shift no longer pays an instalment by itself, its card says how to pay
  await p.evaluate(() => { SHOP.bank = 9000; saveShop(); });
  await p.evaluate(() => start());
  await p.waitForFunction(() => G.running && document.getElementById('startView').hidden);
  await p.evaluate(() => { Object.assign(G, { revenue: 100, angry: 0, mistakes: 0 }); endGame(); });
  assert.equal((await shopNow(p)).mort['pl-town'], 5, 'no automatic instalment');
  assert.match(await text(p, '#result'), /有錢就喺「我的茶餐廳」撳「供一期」/);
  // the last instalments make the player the owner
  await p.click('#homeBtn');
  if (await p.evaluate(() => document.querySelector('.home').dataset.step) !== 'shop') await p.click('#shopBtn');
  for (let i = 0; i < 7; i++) await p.click('#mortPay');
  s = await shopNow(p);
  assert.equal(s.mort['pl-town'], 12);
  assert.match(await text(p, '#mortBox'), /業主/);
  await reload(p);
  await p.click('#shopBtn');
  assert.match(await text(p, '#mortBox'), /業主/, 'ownership saved');
  await done(p);
});

test('market crate: collect once for 3 ingredients, then it counts down; survives reload', async () => {
  const p = await open(w, vet('x', { ingStart: true }));
  assert.equal(await shown(p, '#crateBtn'), true);
  const total = () => p.evaluate(() => Object.values(SHOP.ing).reduce((a, b) => a + b, 0));
  const before = await total();
  await p.click('#crateBtn');
  assert.equal(await total(), before + 3);
  assert.match(await text(p, '#toast'), /街市送貨到/);
  assert.equal(await shown(p, '#crateBtn'), false, 'button is gone, replaced by the countdown');
  assert.match(await text(p, '#career .crate'), /下一車貨/);
  const next = (await shopNow(p)).crateNext;
  assert.ok(next > Date.now() + 3.9 * 3600e3 && next < Date.now() + 4.1 * 3600e3, '4 hours');
  await reload(p);
  assert.equal(await shown(p, '#crateBtn'), false);
  assert.equal((await shopNow(p)).crateNext, next);
  await done(p);
});

test('market crate: a next crate later than one wait away (clock ahead elsewhere) is pulled back to 4 hours', async () => {
  const p = await open(w, vet('x', { ingStart: true, crateNext: Date.now() + 30 * 24 * 3600e3 }));
  const r = await p.evaluate(() => {
    const ready = crateReady(), left = crateLeft();
    return { ready, left, next: SHOP.crateNext, saved: JSON.parse(localStorage.getItem('ckf-shop')).crateNext };
  });
  assert.equal(r.ready, false, 'still waiting, not handed out early');
  assert.ok(r.next > Date.now() + 3.9 * 3600e3 && r.next <= Date.now() + 4 * 3600e3, 'at most 4 hours away');
  assert.equal(r.saved, r.next, 'the corrected time is saved');
  assert.doesNotMatch(r.left, /^\d{3,} 個鐘/, 'the countdown does not show hundreds of hours');
  assert.match(await text(p, '#career .crate'), /下一車貨/);
  await done(p);
});

test('decor: reset puts the six starting tables back and keeps everything bought', async () => {
  const p = await open(w, veteran('x', { bank: 0, items: [{ type: 'plant', tx: 6, ty: 1 }] }));
  await decor(p, 'move');
  await p.click('#decorReset');
  const s = await shopNow(p);
  assert.equal(s.tables.length, 6); assert.equal(s.items.length, 1);
  assert.deepEqual(s.tables.map(t => [t.tx, t.ty]), [[1, .5], [4.5, .5], [1, 3.5], [4.5, 3.5], [1, 6.5], [4.5, 6.5]]);
  await done(p);
});

// branchAt can come from another phone whose clock is ahead (through the cloud save), or this phone's clock can be
// set back. Income since a time in the future is zero, never negative, and the start time is pulled back to now.
test('branch income never goes negative when the saved time is ahead of this phone\'s clock', async () => {
  const lvst = { estate: { waiter: 3, kitchen: 3, bar: 3, till: 3 } };
  const p = await open(w, vet('x', { bank: 1000, lvst, branchAt: Date.now() + 5 * 60e3 }));
  const r = await p.evaluate(() => {
    const n = branches().length, due = branchDue(), html = branchHtml();
    collectBranches();
    return { n, due, negInUi: /\$-/.test(html), bank: SHOP.bank, aheadAfter: SHOP.branchAt > Date.now() };
  });
  assert.ok(r.n >= 1, 'the player has a branch');
  assert.equal(r.due, 0);
  assert.equal(r.negInUi, false, 'no negative amount on the button');
  assert.equal(r.bank, 1000, 'collecting takes nothing from the bank');
  assert.equal(r.aheadAfter, false, 'the start time is no longer in the future');
  await done(p);
});
