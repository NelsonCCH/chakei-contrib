// Menus: every home button and overlay opens what it should and closes back; gating; pause; Escape.
import { go } from './helpers/intro.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { veteran, DESKTOP } from './helpers/browser.js';
import { world, open, vet, done, overlays, shown, text, topAt, startShift, shopNow } from './helpers/ui.js';

let w;
before(async () => { w = await world(); });
after(async () => { await w.stop(); });

const bookTitle = p => p.locator('#book .sh-head b').first().innerText();
async function bookRoundTrip(p, openSel, title) {
  await p.click(openSel);
  assert.equal(await shown(p, '#bookView'), true, openSel + ' should open the book overlay');
  if (title) assert.match(await p.locator('#book').innerText(), title);
  assert.equal(await topAt(p, 195, 420), 'bookView', 'book must be on top of the home screen');
  await p.click('#bookClose');
  assert.equal(await shown(p, '#bookView'), false, openSel + ': 返回 closes it');
  assert.equal(await shown(p, '#startView'), true, 'back on the home screen');
}

test('home (mode step): every button opens its overlay and closes back', async () => {
  const p = await open(w, veteran());
  assert.equal(await shown(p, '#startView'), true);
  await bookRoundTrip(p, '#wardBtn', /換裝/);
  await bookRoundTrip(p, '#gradeBtn', /茶記評級/);
  await bookRoundTrip(p, '#levelBtn', /關卡/);
  await bookRoundTrip(p, '#tutBtn', /僱員培訓/);
  // help
  await p.click('#helpBtn');
  assert.deepEqual(await overlays(p), ['startView', 'helpView']);
  assert.equal(await topAt(p, 195, 420), 'helpView');
  await p.click('#helpClose');
  assert.deepEqual(await overlays(p), ['startView']);
  // coop lobby
  await p.click('#coopBtn');
  assert.equal(await shown(p, '#coopView'), true);
  assert.match(await text(p, '#coop'), /開房/);
  await p.click('#coopClose');
  assert.equal(await shown(p, '#coopView'), false);
  // my shop <-> back
  await p.click('#shopBtn');
  assert.equal(await p.evaluate(() => document.querySelector('.home').dataset.step), 'shop');
  assert.equal(await shown(p, '#startBtn'), true);
  assert.equal(await shown(p, '#levelBtn'), false, 'mode buttons hide in the shop step');
  await p.click('#homeBack');
  assert.equal(await p.evaluate(() => document.querySelector('.home').dataset.step), 'mode');
  await done(p);
});

test('home (shop step): decor, estate, recipes, regulars book, dex open and close', async () => {
  const p = await open(w, vet());
  await p.click('#shopBtn');
  await bookRoundTrip(p, '#recipeBtn', /中國廚藝訓練學院/);
  await bookRoundTrip(p, '#bookBtn', /熟客簿/);
  await bookRoundTrip(p, '#dexBtn', /茶餐廳圖鑑/);
  // decor: replaces the home screen, 搞掂 brings it back (to the same step)
  await p.click('#decorBtn');
  assert.equal(await shown(p, '#decorBar'), true);
  assert.equal(await shown(p, '#startView'), false);
  assert.equal(await shown(p, '#floorWrap'), true);
  for (const tab of ['look', 'buy', 'grow', 'move']) {
    await p.click(`#decorBar [data-tab="${tab}"]`);
    assert.equal(await p.getAttribute(`#decorBar [data-tab="${tab}"]`, 'aria-pressed'), 'true');
  }
  await p.click('#decorDone');
  assert.equal(await shown(p, '#decorBar'), false);
  assert.equal(await shown(p, '#startView'), true);
  const pb = await p.locator('#pauseBtn').boundingBox();
  assert.equal(await topAt(p, pb.x + 5, pb.y + 5), 'startView', 'the shift HUD behind the home screen is covered, not tappable');
  // estate = decor on the 舖位 tab
  await p.click('#estateBtn');
  assert.equal(await p.getAttribute('#decorBar [data-tab="grow"]', 'aria-pressed'), 'true');
  await p.click('#decorDone');
  assert.equal(await shown(p, '#startView'), true);
  await done(p);
});

test('every decor sub-tab renders chips and no tab is a dead end', async () => {
  const p = await open(w, veteran('老闆', { bank: 99999 }));
  await p.click('#shopBtn'); await p.click('#decorBtn');
  const subs = { look: ['wall', 'floor', 'sign', 'awning'], buy: ['tables', 'items'], grow: ['size', 'place'] };
  for (const [tab, list] of Object.entries(subs)) {
    await p.click(`#decorBar [data-tab="${tab}"]`);
    for (const s of list) {
      await p.click(`#decorBar [data-sub="${s}"]`);
      assert.equal(await p.getAttribute(`#decorBar [data-sub="${s}"]`, 'aria-pressed'), 'true');
      assert.ok(await p.locator('#decorBar .dbody *').count() > 3, `${tab}/${s} has content`);
    }
  }
  // the set tabs under 買嘢
  await p.click('#decorBar [data-tab="buy"]');
  const sets = await p.$$eval('#decorBar .dsubs button', bs => bs.map(b => b.dataset.sub));
  assert.ok(sets.length > 2);
  for (const s of sets) { await p.click(`#decorBar [data-sub="${s}"]`); assert.ok(await p.locator('#decorBar .dchip').count() > 0, s + ' has chips'); }
  await p.click('#decorDone');
  await done(p);
});

test('book overlay: tapping the dark backdrop closes it; reopening gives fresh content', async () => {
  const p = await open(w, veteran());
  await p.click('#levelBtn');
  assert.equal(await shown(p, '#bookView'), true);
  await p.mouse.click(3, 3);
  assert.equal(await shown(p, '#bookView'), false);
  await p.click('#wardBtn');
  assert.match(await bookTitle(p), /換裝/);
  await p.mouse.click(3, 3);
  assert.equal(await shown(p, '#bookView'), false);
  await done(p);
});

test('levels list: five tabs switch, a level can be started and the shift runs', async () => {
  const p = await open(w, veteran());
  await p.click('#levelBtn');
  const tabs = await p.$$eval('#book .lvtabs [data-lvt]', bs => bs.map(b => b.dataset.lvt));
  assert.ok(tabs.length >= 5, 'five categories: ' + tabs);
  for (const t of tabs) { await p.click(`#book [data-lvt="${t}"]`); assert.equal(await p.getAttribute(`#book [data-lvt="${t}"]`, 'aria-selected'), 'true'); }
  await p.click('#book [data-lvt="main"]');
  const first = await p.locator('#book .levels button[data-lv]:not([disabled])').first();
  const id = await first.getAttribute('data-lv');
  await first.click();
  await p.waitForFunction(() => G.running);
  assert.equal(await p.evaluate(() => G.level), id);
  assert.equal(await shown(p, '#bookView'), false);
  assert.equal(await shown(p, '#startView'), false);
  await done(p);
});

test('help: every station tab shows its own text', async () => {
  const p = await open(w, veteran());
  await p.click('#helpBtn');
  const n = await p.locator('#helpTabs button').count();
  assert.ok(n >= 4);
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    await p.locator('#helpTabs button').nth(i).click();
    const vis = await p.$$eval('#helpView dl.howto', ds => ds.filter(d => d.getClientRects().length).map(d => d.id));
    assert.equal(vis.length >= 1, true);
    vis.forEach(v => seen.add(v));
  }
  assert.ok(seen.size >= 4, 'tabs reveal ' + [...seen]);
  await p.click('#helpClose');
  await done(p);
});

test('shop name: rename form, max 10 chars, shown on both buttons, toast', async () => {
  const p = await open(w, veteran());
  await p.click('#shopBtn');
  assert.equal(await shown(p, '#shopForm'), false);
  await p.click('#shopRename');
  assert.equal(await shown(p, '#shopForm'), true);
  await p.fill('#shopIn', '一二三四五六七八九十十一');
  assert.equal(await p.inputValue('#shopIn'), '一二三四五六七八九十', 'input is capped at 10');
  await p.click('#shopForm button[type=submit]');
  assert.equal(await shown(p, '#shopForm'), false);
  assert.equal(await text(p, '#shopName2'), '一二三四五六七八九十');
  assert.equal(await text(p, '#shopName'), '一二三四五六七八九十');
  assert.match(await text(p, '#toast'), /一二三四五六七八九十/);
  await done(p);
});

test('nickname: 改名 turns into an input, 存 saves it, empty keeps the old one', async () => {
  const p = await open(w, veteran('老闆'));
  await p.click('#nickBtn');
  await p.fill('#nickIn', '阿芬');
  await p.click('#nickSave');
  assert.equal(await text(p, '#me .who b'), '阿芬');
  await p.click('#nickBtn'); await p.fill('#nickIn', '   '); await p.click('#nickSave');
  assert.equal(await text(p, '#me .who b'), '阿芬');
  await done(p);
});

test('station / slot / difficulty selectors: one pressed at a time, locked difficulty is disabled', async () => {
  const p = await open(w, veteran());
  await p.click('#shopBtn');
  for (const st of ['kitchen', 'bar', 'till', 'waiter']) {
    await p.click(`#stSeg [data-st="${st}"]`);
    assert.equal(await p.$$eval('#stSeg [aria-pressed="true"]', b => b.map(x => x.dataset.st).join()), st);
  }
  for (const s of ['breakfast', 'dinner', 'lunch']) {
    await p.click(`#slotSeg [data-s="${s}"]`);
    assert.equal(await p.$$eval('#slotSeg [aria-pressed="true"]', b => b.map(x => x.dataset.s).join()), s);
  }
  // a rookie (3 stars) cannot take the pro difficulty
  const q = await open(w, veteran('新手', { stars: 3 }));
  await q.click('#shopBtn');
  const dis = await q.$$eval('#diffSeg button', bs => bs.filter(b => b.disabled).length);
  assert.ok(dis >= 1, 'some difficulty is locked for a rookie');
  await done(p); await done(q);
});

test('gating: a brand-new player sees only the first-day card; 開工 starts training, 識玩 starts level 1', async () => {
  const p = await open(w, {});
  assert.equal(await shown(p, '#firstCard'), true);
  for (const id of ['#levelBtn', '#coopBtn', '#shopBtn', '#me', '#career']) assert.equal(await shown(p, id), false, id + ' hidden for a new player');
  await p.click('#firstGo');
  await p.waitForFunction(() => G.running);
  assert.equal(await p.evaluate(() => G.tut), true);
  await done(p);
  const q = await open(w, {});
  await q.click('#firstSkip');
  await q.waitForFunction(() => G.running);
  assert.equal(await q.evaluate(() => G.level), 'estate');
  assert.equal((await shopNow(q)).skipTut, true);
  await done(q);
});

test('gating: trained but no shift yet -> shop button is locked with a message; level 1 shortcut works', async () => {
  const p = await open(w, { 'ckf-shop': JSON.stringify({ skipTut: true, nick: 'x' }) });
  assert.equal(await p.getAttribute('#shopBtn', 'data-gate'), 'shop');
  await p.click('#shopBtn');
  assert.equal(await p.evaluate(() => document.querySelector('.home').dataset.step), 'mode', 'locked: stays on mode step');
  assert.match(await text(p, '#toast'), /第一更/);
  assert.equal(await shown(p, '#firstLvGo'), true);
  await p.click('#firstLvGo');
  await p.waitForFunction(() => G.running && G.level === 'estate');
  await done(p);
});

test('gating: after one shift buttons for rookie/dex/estate are locked with their message, and open for a veteran', async () => {
  const p = await open(w, { 'ckf-shop': JSON.stringify({ shifts: 1, nick: 'x', tutDone: { waiter: 1 } }) });
  await p.click('#shopBtn');
  for (const [id, msg] of [['#bookBtn', /新人/], ['#dexBtn', /新人/], ['#estateBtn', /熟手/]]) {
    assert.match(await p.getAttribute(id, 'class'), /gated/);
    await p.click(id);
    assert.equal(await shown(p, '#bookView'), false, id + ' must not open');
    assert.equal(await shown(p, '#decorBar'), false, id + ' must not open decor');
    assert.match(await text(p, '#toast'), msg);
  }
  await p.click('#homeBack'); await p.click('#levelBtn');
  await p.click('#book [data-lvt="era"]');
  assert.match(await text(p, '#book .lv-lock'), /新人/, 'era levels are locked for rookies');
  await p.click('#bookClose');
  await done(p);
  const v = await open(w, vet());
  await v.click('#shopBtn');
  for (const id of ['#bookBtn', '#dexBtn', '#estateBtn']) assert.doesNotMatch((await v.getAttribute(id, 'class')) || '', /gated/);
  await v.click('#bookBtn'); assert.equal(await shown(v, '#bookView'), true); await v.click('#bookClose');
  await done(v);
});

test('pause: 暫停 -> overlay with 返工 / sound / music / quit; 返工 resumes, quit goes home', async () => {
  const p = await open(w, veteran());
  await startShift(p, { station: 'waiter' });
  assert.equal(await shown(p, '#pauseBtn'), true);
  await p.click('#pauseBtn');
  assert.equal(await shown(p, '#pauseView'), true);
  assert.equal(await p.evaluate(() => G.paused), true);
  assert.match(await text(p, '#pauseGoal'), /老闆目標|每日挑戰/);
  assert.equal(await shown(p, '#pauseView .soundBtn'), true);
  assert.equal(await shown(p, '#pauseView .musicBtn'), true);
  assert.equal(await shown(p, '#smokeCv'), true);
  await p.click('#resumeBtn');
  assert.equal(await shown(p, '#pauseView'), false);
  assert.equal(await p.evaluate(() => G.paused), false);
  await p.click('#pauseBtn'); await p.click('#quitBtn');
  assert.equal(await shown(p, '#startView'), true);
  assert.equal(await shown(p, '#pauseView'), false);
  assert.equal(await p.evaluate(() => G.running), false);
  assert.equal(await shown(p, '#shopBtn') || await shown(p, '#startBtn'), true);
  await done(p);
});

test('Escape closes the order sheet and the price board during a shift', async () => {
  const p = await open(w, veteran());
  await startShift(p, { station: 'till' });
  await p.click('#boardBtn');
  assert.equal(await shown(p, '#boardWrap'), true);
  assert.equal(await topAt(p, 195, 300), 'boardWrap');
  await p.keyboard.press('Escape');
  assert.equal(await shown(p, '#boardWrap'), false);
  assert.equal(await p.evaluate(() => G.board), false);
  await p.click('#pauseBtn'); await p.click('#quitBtn');
  // waiter: open the order sheet on a table that is ready to order
  await startShift(p, { station: 'waiter' });
  await p.evaluate(() => { const g = makeGroup(); g.table = 0; g.state = 'order'; g.until = G.t + 100; g.max = 100; G.groups.push(g); bump(); openSheet(g); renderSheet(); });
  assert.equal(await shown(p, '#sheetWrap'), true);
  await p.keyboard.press('Escape');
  assert.equal(await shown(p, '#sheetWrap'), false);
  await done(p);
});

test('end screen: next / again / home / decor / share all lead somewhere and back', async () => {
  const p = await open(w, veteran());
  await startShift(p, { station: 'waiter', slot: 'lunch' });
  await p.evaluate(() => endGame());
  assert.equal(await shown(p, '#endView'), true);
  assert.match(await text(p, '#nextBtn'), /晚市/);
  // share card: opens over the end screen, closes back to it
  await p.click('#shareBtn');
  assert.equal(await shown(p, '#bookView'), true);
  assert.equal(await p.locator('#book img.sharecard').count(), 1);
  assert.equal(await shown(p, '#shareGo'), true);
  await p.click('#bookClose');
  assert.equal(await shown(p, '#endView'), true);
  // decor from the end screen, then back to home
  await p.click('#endDecorBtn');
  assert.equal(await shown(p, '#decorBar'), true);
  assert.equal(await shown(p, '#endView'), false);
  await p.click('#decorDone');
  assert.equal(await shown(p, '#startView'), true);
  assert.equal(await shown(p, '#endView'), false);
  // again -> a fresh shift of the same slot
  await startShift(p, { station: 'waiter', slot: 'lunch' });
  await p.evaluate(() => endGame());
  await go(p, '#againBtn');
  await p.waitForFunction(() => G.running);
  assert.equal(await p.evaluate(() => G.slot), 'lunch');
  await p.evaluate(() => endGame());
  await go(p, '#nextBtn');
  await p.waitForFunction(() => G.running);
  assert.equal(await p.evaluate(() => G.slot), 'dinner');
  await p.evaluate(() => endGame());
  assert.match(await text(p, '#nextBtn'), /收舖/);
  await p.click('#homeBtn');
  assert.equal(await shown(p, '#startView'), true);
  assert.equal(await shown(p, '#endView'), false);
  await done(p);
});

test('desktop: overlays are centred cards, still closable (1280x900)', async () => {
  const p = await open(w, veteran(), { device: DESKTOP });
  await p.click('#levelBtn');
  const box = await p.locator('#book').boundingBox();
  assert.ok(box.width < 700, 'book card does not stretch across the desktop: ' + box.width);
  await p.click('#bookClose');
  await p.click('#helpBtn'); await p.click('#helpClose');
  assert.deepEqual(await overlays(p), ['startView']);
  await done(p);
});
