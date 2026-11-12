// Notifications: toasts, boss banner, unlock pop-ups (once per unlock), end-of-shift messages, rank-up and level toasts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { world, open, vet, done, shown, text, shopNow, reload, startShift, endShift, sleep } from './helpers/ui.js';

let w;
before(async () => { w = await world(); });
after(async () => { await w.stop(); });

const toastHidden = p => p.waitForFunction(() => document.getElementById('toast').hidden, null, { timeout: 5000 });

test('toast: shows, is not tappable, disappears by itself after ~2 s; a tap dismisses it early', async () => {
  const p = await open(w, vet());
  await p.click('#shopBtn'); await p.click('#shopRename'); await p.fill('#shopIn', '甲'); await p.click('#shopForm button[type=submit]');
  assert.equal(await shown(p, '#toast'), true);
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('toast')).pointerEvents), 'none');
  const t0 = Date.now();
  await toastHidden(p);
  const dt = Date.now() - t0;
  assert.ok(dt > 800 && dt < 2600, 'visible about 1.8 s, was ' + dt);
  await p.evaluate(() => toast('第二個提示'));
  assert.equal(await shown(p, '#toast'), true);
  await p.mouse.click(5, 500);
  assert.equal(await shown(p, '#toast'), false, 'tap anywhere dismisses');
  await done(p);
});

test('toast: a newer toast replaces the older one and restarts the timer (no early hide)', async () => {
  const p = await open(w, vet());
  await p.evaluate(() => toast('第一個'));
  await sleep(1200);
  await p.evaluate(() => toast('第二個'));
  await sleep(1200);   // 2.4 s after the first, 1.2 s after the second
  assert.equal(await shown(p, '#toast'), true, 'second toast is still up');
  assert.equal(await text(p, '#toast'), '第二個');
  assert.equal(await p.locator('#toast').count(), 1, 'only one toast element');
  await toastHidden(p);
  await done(p);
});

test('toast sits above overlays (visible on the home screen and over an open book)', async () => {
  const p = await open(w, vet());
  await p.click('#wardBtn');
  await p.evaluate(() => toast('買咗啲嘢'));
  const z = await p.evaluate(() => [+getComputedStyle(document.getElementById('toast')).zIndex, +getComputedStyle(document.getElementById('bookView')).zIndex]);
  assert.ok(z[0] > z[1], 'toast z-index above the book overlay: ' + z);
  const box = await p.locator('#toast').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'toast fits the phone width: ' + JSON.stringify(box));
  await done(p);
});

test('long toast text still fits inside a phone screen', async () => {
  const p = await open(w, vet());
  await p.evaluate(() => toast('四個位都三星！「屋邨茶記」交俾你做加盟分店，記得返嚟主畫面撳收數'));
  const box = await p.locator('#toast').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390 + 1, 'toast must not overflow: ' + JSON.stringify(box));
  await done(p);
});

test('boss banner: appears at the start of a shift and goes away by itself', async () => {
  const p = await open(w, vet());
  await startShift(p, { station: 'waiter' });
  assert.equal(await shown(p, '#bossSay'), true);
  assert.match(await text(p, '#bossSay'), /老闆|每日挑戰/);
  await p.waitForFunction(() => document.getElementById('bossSay').hidden, null, { timeout: 5000 });
  await done(p);
});

test('bar shift tells you to boil the tea first', async () => {
  const p = await open(w, vet());
  await startShift(p, { station: 'bar' });
  assert.match(await text(p, '#toast'), /煲茶/);
  await done(p);
});

// ---- end-of-shift messages ----
const OUTCOMES = {
  waiter: [[{ angry: 0, mistakes: 0 }, '頂呱呱'], [{ angry: 2, mistakes: 2 }, '唔錯'], [{ angry: 1, mistakes: 4 }, '眼大睇過龍'], [{ angry: 5, mistakes: 3 }, '手腳慢']],
  kitchen: [[{ angry: 0, mistakes: 0 }, '鑊氣十足'], [{ angry: 3, mistakes: 1 }, '火候慢'], [{ angry: 1, mistakes: 4 }, '亂咁整'], [{ angry: 1, mistakes: 1 }, '唔錯']],
  bar: [[{ angry: 0, mistakes: 0 }, '絲襪王'], [{ angry: 3, mistakes: 1 }, '手腳慢'], [{ angry: 1, mistakes: 4 }, '亂咁沖'], [{ angry: 1, mistakes: 1 }, '唔錯']],
  till: [[{ angry: 0, mistakes: 0 }, '數口精'], [{ angry: 0, mistakes: 2, loss: 150 }, '蝕本貨'], [{ angry: 3, mistakes: 1, loss: 0 }, '手腳慢'], [{ angry: 1, mistakes: 2, loss: 0 }, '計數要準']],
};
for (const [station, list] of Object.entries(OUTCOMES)) {
  test(`end of shift (${station}): each outcome shows its own sign, boss line and the money`, async () => {
    const p = await open(w, vet('x', { bank: 0 }));
    for (const [fields, sign] of list) {
      await startShift(p, { station, slot: 'lunch' });
      await endShift(p, { revenue: 321, ...fields });
      assert.equal(await shown(p, '#endView'), true);
      assert.equal(await text(p, '#endSign'), sign);
      assert.ok((await text(p, '#boss')).length > 8, 'boss says something');
      assert.match(await text(p, '#result'), /\$321/, 'revenue shown');
      assert.match(await text(p, '#result'), /舖頭積蓄/, 'savings line shown');
      assert.match(await text(p, '#endKick'), /第 \d+ 日/);
      await p.click('#homeBtn');
      assert.equal(await shown(p, '#endView'), false);
    }
    await done(p);
  });
}

test('end of shift: regular customers, error log and the day total appear when relevant', async () => {
  const p = await open(w, vet());
  await startShift(p, { station: 'waiter', slot: 'dinner' });
  await endShift(p, { revenue: 500, mistakes: 1, angry: 0, errLog: [{ tb: '一號卡', said: '奶茶', wrote: [], want: ['奶茶'] }], regHit: 2 });
  assert.match(await text(p, '#result'), /睇返邊幾張單落錯（1）/);
  assert.match(await text(p, '#boss'), /照舊/);
  assert.match(await text(p, '#result'), /全日營業額/, 'last shift of the day shows the day total');
  await done(p);
});

test('end of shift is shown once: ending twice does not double the bank or the result rows', async () => {
  const p = await open(w, vet('x', { bank: 0 }));
  await startShift(p, { station: 'waiter' });
  await endShift(p, { revenue: 400, mistakes: 0, angry: 0 });
  const b1 = (await shopNow(p)).bank;
  const rows = await p.locator('#result > div').count();
  await p.evaluate(() => { bankRevenue(); careerEnd(); });
  assert.equal((await shopNow(p)).bank, b1, 'no double banking');
  assert.equal(await p.locator('#result > div').count(), rows, 'no double rows');
  await done(p);
});

test('rank-up: a toast "升職" shows once, the result says it, the new-unlock pop-up follows, never again', async () => {
  const p = await open(w, { 'ckf-shop': JSON.stringify({ shifts: 1, stars: 2, servedTotal: 10, tutDone: { waiter: 1 }, nick: 'x', t: 1 }) });
  await startShift(p, { station: 'waiter' });
  await endShift(p, { goal: 'calm', revenue: 100, angry: 0, mistakes: 0 });
  assert.match(await text(p, '#toast'), /升職做新人/);
  assert.match(await text(p, '#result .stars'), /升職/);
  await p.click('#homeBtn');
  await p.waitForSelector('#gatePop', { timeout: 3000 });
  assert.match(await text(p, '#gatePop'), /升咗新人/);
  await p.click('#gateLater');
  await sleep(700);
  assert.equal(await p.locator('#gatePop').count(), 0, 'no second pop-up for the same unlock');
  await reload(p);
  await sleep(900);
  assert.equal(await p.locator('#gatePop').count(), 0, 'not after a reload either');
  assert.ok((await shopNow(p)).gates.includes('rookie'));
  await done(p);
});

test('unlock pop-ups come one at a time, once each; 去睇吓 goes there; none after a reload', async () => {
  const seed = { shifts: 5, stars: 12, servedTotal: 120, tutDone: { waiter: 1, bar: 1, kitchen: 1, till: 1 }, nick: 'x', t: 1, levels: { estate: 3, central: 3 }, gates: [] };
  const p = await open(w, { 'ckf-shop': JSON.stringify(seed) });
  const titles = [];
  for (let i = 0; i < 6; i++) {
    const got = await p.waitForSelector('#gatePop', { timeout: 1800 }).then(() => true, () => false);
    if (!got) break;
    assert.equal(await p.locator('#gatePop').count(), 1, 'only one at a time');
    titles.push(await text(p, '#gatePop h2'));
    assert.equal(await shown(p, '#gateGo'), true); assert.equal(await shown(p, '#gateLater'), true);
    if (titles.length === 1) { await p.click('#gateGo'); await sleep(100); assert.equal(await p.evaluate(() => document.querySelector('.home').dataset.step), 'shop', 'first one leads to the shop'); await p.click('#homeBack'); }
    else await p.click('#gateLater');
  }
  assert.deepEqual(titles, ['你都想有自己間舖？', '升咗新人！', '茶餐廳圖鑑', '升咗熟手！']);
  assert.deepEqual((await shopNow(p)).gates.sort(), ['dex', 'pro', 'rookie', 'shop']);
  await reload(p);
  await sleep(900);
  assert.equal(await p.locator('#gatePop').count(), 0);
  await done(p);
});

test('unlock pop-up does not appear over a running shift or an open overlay', async () => {
  const seed = { shifts: 5, stars: 12, servedTotal: 120, tutDone: { waiter: 1 }, nick: 'x', t: 1, gates: [] };
  const p = await open(w, { 'ckf-shop': JSON.stringify(seed) });
  // open the wardrobe before any pop-up, in one page turn: on a slow engine the first pop-up can already be up when the
  // page is ready (then answer 遲啲, which schedules the next one 400 ms later, and open the wardrobe in the same turn)
  await p.evaluate(() => { const later = document.getElementById('gateLater'); if (later) later.click(); document.getElementById('wardBtn').click(); });
  await sleep(1000);
  // the pop-up checks #bookView only for the regulars book; make sure it never blocks the controls of an open overlay
  const pops = await p.locator('#gatePop').count();
  if (pops) assert.equal(await p.evaluate(() => { const g = document.getElementById('gatePop'), b = document.getElementById('bookView'); return g.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 'pop-after-book' : 'pop-before-book'; }), 'pop-after-book', 'the pop-up must be on top of the open book');
  await done(p);
});

test('first shift for a new player: the shop unlock pop-up appears when back on the home screen', async () => {
  const p = await open(w, { 'ckf-shop': JSON.stringify({ skipTut: true, nick: 'x' }) });
  await p.click('#firstLvGo');
  await p.waitForFunction(() => G.running && G.level === 'estate');
  await endShift(p, { revenue: 99999, spd: { waiter: [1, 1], bar: [1, 1], kitchen: [1, 1], till: [1, 1] } });   // three stars: revenue and speed
  assert.match(await text(p, '#endSign'), /完美|好嘢|過關/);
  await p.click('#homeBtn');
  await p.waitForSelector('#gatePop', { timeout: 3000 });
  assert.match(await text(p, '#gatePop'), /我的茶餐廳/);
  await p.click('#gateLater');
  await sleep(700);
  // earning 3 stars also ranks the player up, so the next pop-up is a different one, never the shop one again
  if (await p.locator('#gatePop').count()) assert.doesNotMatch(await text(p, '#gatePop'), /我的茶餐廳/);
  await done(p);
});

test('level result: star sign per revenue and speed, "unlock next level" toast only the first time', async () => {
  const p = await open(w, vet('x', { levels: {} }));
  const th = await p.evaluate(() => STAR_LINES.estate[station]);   // one person: the station's own line
  // the third star is two stars plus the station's speed: fast = 1 s a job, slow = 60 s a job, at every station
  const fast = { waiter: [3, 3], bar: [3, 3], kitchen: [3, 3], till: [3, 3] }, slow = { waiter: [1, 60], bar: [1, 60], kitchen: [1, 60], till: [1, 60] };
  const cases = [[0, fast, '唔夠數'], [th[0], fast, '過關'], [th[1], slow, '好嘢'], [th[2] * 2, slow, '好嘢'], [th[1], fast, '完美']];
  for (const [rev, spd, sign] of cases) {
    await p.click('#levelBtn'); await p.click('#book [data-lvt="main"]'); await p.click('#book [data-lv="estate"]');
    await p.waitForFunction(() => G.running && G.level === 'estate');
    await endShift(p, { revenue: rev, spd });
    assert.equal(await text(p, '#endSign'), sign);
    const unlockToast = (await shown(p, '#toast')) && /解鎖新關卡/.test(await text(p, '#toast'));
    if (rev === th[0]) assert.equal(unlockToast, true, 'first clear unlocks the next level');
    else assert.equal(unlockToast, false, 'no repeat unlock toast for ' + sign);
    await p.click('#homeBtn');
    await p.evaluate(() => { document.getElementById('toast').hidden = true; });
  }
  await done(p);
});

test('tutorial end: 學識喇 with the $300 gift only the first time per station', async () => {
  const p = await open(w, { 'ckf-shop': JSON.stringify({ skipTut: false, nick: 'x', bank: 0 }) });
  for (const expect of [300, 0]) {
    await p.evaluate(() => { document.getElementById('firstGo') && document.getElementById('firstGo').click(); });
    if (!await p.evaluate(() => G.running)) { await p.click('#tutBtn'); await p.click('#book [data-train="waiter"]'); }
    await p.waitForFunction(() => G.running && G.tut);
    await p.evaluate(() => endGame());
    await p.waitForSelector('#endView:not([hidden])');
    assert.equal(await text(p, '#endSign'), '學識喇');
    assert.match(await text(p, '#result'), expect ? /第一次完成，獎 \$300/ : /已經學過/);
    assert.equal((await shopNow(p)).bank, 300, 'the $300 is paid once, not again');
    await p.click('#homeBtn');
  }
  await done(p);
});

test('streak bonus on the first shift of the day shows once', async () => {
  const p = await open(w, vet('x', { bank: 0 }));
  await startShift(p, { station: 'waiter' });
  await endShift(p, { revenue: 50, angry: 0, mistakes: 0 });
  assert.match(await text(p, '#result'), /返工第 1 日/);
  await p.click('#homeBtn');
  await startShift(p, { station: 'waiter' });
  await endShift(p, { revenue: 50, angry: 0, mistakes: 0 });
  assert.doesNotMatch(await text(p, '#result'), /返工第 \d+ 日/);
  await done(p);
});

test('days at work never reset: ten days away, the count goes on from where it was (card, home line, save)', async () => {
  const p = await open(w, vet('x', { bank: 0, stars: 5, streak: { n: 5, last: '2000-1-1' } }));
  await p.click('#shopBtn');
  assert.match(await text(p, '#career .streak'), /返咗 5 日工/, 'the home line shows the total, not 0, after the gap');
  await startShift(p, { station: 'waiter' });
  await endShift(p, { revenue: 50, angry: 0, mistakes: 0 });
  assert.match(await text(p, '#result'), /返工第 6 日/);
  assert.equal((await shopNow(p)).streak.n, 6, 'saved');
  await p.click('#homeBtn');
  assert.match(await text(p, '#career .streak'), /返咗 6 日工 ✓/);
  await done(p);
});

test('dex: opening a card for the first time toasts once; the 圖鑑 button shows the new-card colour until opened', async () => {
  const p = await open(w, vet('x', { levels: { estate: 3 }, dex: { estate: 2 }, dexNew: false, gates: ['shop', 'rookie', 'dex', 'pro'] }));
  await p.click('#levelBtn'); await p.click('#book [data-lvt="main"]'); await p.click('#book [data-lv="central"]');
  await p.waitForFunction(() => G.running && G.level === 'central');
  await endShift(p, { revenue: 1 });
  await p.click('#homeBtn');
  await p.click('#shopBtn');
  assert.match(await p.getAttribute('#dexBtn', 'class'), /new/);
  await p.click('#dexBtn');
  assert.equal(await p.evaluate(() => SHOP.dexNew), false);
  await p.click('#bookClose');
  assert.doesNotMatch((await p.getAttribute('#dexBtn', 'class')) || '', /new/);
  await done(p);
});
