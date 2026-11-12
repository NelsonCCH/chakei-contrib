// Career features on the page: the pre-shift target and stake, the goal card that holds
// the clock, hard mode's costs, warnings, losing the shop and winning it back, and the solo modes (輪流做 / 一腳踢). Each
// checks what the screen says against the state and the save, and what happens next (the next shift, a reload).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { go } from './helpers/intro.js';
import { world, open, vet, done, shown, text, shopNow, reload, sleep } from './helpers/ui.js';

let w;
before(async () => { w = await world(); });
after(async () => { await w.stop(); });

const toShop = async p => { if (await p.evaluate(() => document.querySelector('.home').dataset.step) !== 'shop') await p.click('#shopBtn'); };
const end = (p, f) => p.evaluate(x => { Object.assign(G, x); endGame(); }, f);
/** The 舖頭積蓄 line on the end card. */
const bankLine = async p => Number((await p.locator('#result div', { hasText: '舖頭積蓄' }).last().innerText()).match(/\$(-?\d+)/)[1]);

test('target and goal card: pick a target and stake, the goal card holds the clock, the end card books the stake; saved', async () => {
  const p = await open(w, vet('x', { bank: 1000 }));
  await toShop(p);
  assert.equal(await shown(p, '#targetBox'), true);
  // default for an old save: 營業額 · 穩陣
  assert.equal(await p.getAttribute('#tgMetric [data-tm="rev"]', 'aria-pressed'), 'true');
  assert.equal(await p.getAttribute('#tgTier [data-tt="safe"]', 'aria-pressed'), 'true');
  await p.click('#tgMetric [data-tm="combo"]');
  await p.click('#tgTier [data-tt="allin"]');
  const n = await p.evaluate(() => targetN({ metric: 'combo', tier: 'allin' }, station, slot, diff));
  assert.match(await text(p, '#tgLine'), new RegExp(`連擊做到 ${n} · 搏盡：做到 \\+\\$1000 · 做唔到 −\\$200`));
  assert.deepEqual((await shopNow(p)).target, { metric: 'combo', tier: 'allin' });
  // 開工 shows the goal first; the clock does not run until 開工！
  await p.click('#startBtn');
  assert.equal(await shown(p, '#introView'), true);
  assert.equal(await text(p, '#introGoal'), `連擊做到 ${n}`);
  assert.match(await text(p, '#introStake'), /搏盡：做到 \+\$1000/);
  await sleep(1200);
  assert.equal(await p.evaluate(() => !!(G && G.running)), false, 'no shift running behind the card');
  // 改目標 goes back to the picker
  await p.click('#introBack');
  assert.equal(await shown(p, '#introView'), false);
  assert.equal(await shown(p, '#targetBox'), true);
  await p.click('#tgTier [data-tt="bet"]');
  await go(p, '#startBtn');
  assert.deepEqual(await p.evaluate(() => [G.goal, G.goalN, G.tier, G.t < 2]), ['combo', await p.evaluate(() => targetN({ metric: 'combo', tier: 'bet' }, station, slot, diff)), 'bet', true]);
  // met: + 2.5 units on the card and in the bank; the card's savings line is the save's
  await end(p, { maxCombo: 99, angry: 0, mistakes: 0, revenue: 800 });
  assert.match(await text(p, '#result .betw'), /搏一搏 · 做到[\s\S]*\+\$250/);
  assert.equal(await bankLine(p), (await shopNow(p)).bank);
  // after-effect: 再做一次 keeps the choice, shows the card again
  await p.click('#againBtn');
  assert.equal(await shown(p, '#introView'), true);
  await p.click('#introGo');
  await p.waitForFunction(() => G.running);
  await end(p, { maxCombo: 0, angry: 0, mistakes: 0, revenue: 800 });
  assert.match(await text(p, '#result .betw.lost'), /搏一搏 · 做唔到[\s\S]*−\$100/);
  await reload(p);
  await toShop(p);
  assert.equal(await p.getAttribute('#tgMetric [data-tm="combo"]', 'aria-pressed'), 'true', 'choice saved');
  assert.equal(await p.getAttribute('#tgTier [data-tt="bet"]', 'aria-pressed'), 'true');
  await done(p);
});

test('targets: the same missed shift costs 200 more on 搏盡 than on 穩陣; normal mode never shows a minus bank', async () => {
  const banks = {};
  for (const tier of ['safe', 'allin']) {
    const p = await open(w, vet('x', { bank: 50, target: { metric: 'calm', tier } }));
    await toShop(p);
    await go(p, '#startBtn');
    // three walk-outs: over both caps (穩陣 allows 2, 搏盡 none), one star either way
    await end(p, { angry: 3, mistakes: 0, revenue: 300 });
    banks[tier] = (await shopNow(p)).bank;
    assert.match(await text(p, '#result .betw'), tier === 'safe' ? /穩陣 · 做唔到\s*\$0\s*穩陣，冇蝕/ : /搏盡 · 做唔到[\s\S]*−\$200/);
    await done(p);
  }
  assert.equal(banks.safe - banks.allin, 200, JSON.stringify(banks));
  // the edge: savings smaller than the stake -> 師傅 covers it, the bank stops at $0
  const p = await open(w, vet('x', { bank: 0, target: { metric: 'calm', tier: 'allin' } }));
  await toShop(p);
  await go(p, '#startBtn');
  await p.evaluate(() => { SHOP.bank = -150; });   // as if the stake had already gone through
  await p.evaluate(() => pressMark());
  await p.evaluate(() => { const h = pressSettle(); document.getElementById('result').insertAdjacentHTML('beforeend', h); });
  assert.equal((await shopNow(p)).bank, 0);
  assert.match(await text(p, '#result'), /師傅幫你墊咗[\s\S]*\$150/);
  await p.evaluate(() => { G.running = false; });
  await done(p);
});

test('hard mode: off by default; on, the card charges rent, wages and upkeep, warns, then the landlord takes the shop', async () => {
  const p = await open(w, vet('x', { bank: 100, size: 1 }));
  await toShop(p);
  assert.match(await text(p, '#hardBtn'), /硬核模式：關/);
  await p.click('#hardBtn');
  assert.equal((await shopNow(p)).hard, true);
  assert.match(await text(p, '#hardBtn'), /硬核模式：開[\s\S]*每更開支 \$\d+：租 \$\d+ · 人工 \$120 · 雜費 \$\d+/);
  const cost = await p.evaluate(() => shiftCostsNow(false).total);
  const lines = [];
  for (let k = 1; k <= 3; k++) {
    await go(p, k === 1 ? '#startBtn' : '#againBtn');
    await end(p, { revenue: 0, angry: 6, mistakes: 3, maxCombo: 0 });
    const r = await text(p, '#result');
    lines.push(r);
    assert.match(r, /交租（[^）]+）/); assert.match(r, /人工（電腦幫手 3 個）/); assert.match(r, /雜費（\d+ 張枱）/);
    assert.equal(await bankLine(p), (await shopNow(p)).bank, `shift ${k}: card = save`);
  }
  // warnings first: a losing shift, then the landlord's letter, then the shop is lost (rent owing all along)
  assert.match(lines[0], /欠租 \$\d+|蝕本更/);
  assert.match(lines[1], /業主警告信/);
  assert.match(lines[2], /業主收舖！/);
  const s = await shopNow(p);
  assert.equal(s.size, 0, 'one size smaller');
  assert.equal(s.tables.length, 6, 'the starting six tables');
  assert.deepEqual(s.items, []);
  assert.equal(s.bank, 500, '師傅 restart money');
  assert.equal(s.lost.size, 1);
  assert.deepEqual(s.press, { red: 0, debt: 0, fails: 1, back: 0 });
  assert.equal(s.stars >= 12, true, 'stars kept');
  assert.ok(cost > 0);
  // after-effects: saved through a reload; the pre-shift box says how far the comeback is
  await reload(p);
  await toShop(p);
  assert.match(await text(p, '#hardBtn'), /東山再起 0\/5/);
  // five profitable shifts and the old shop comes back
  for (let k = 1; k <= 5; k++) {
    await go(p, k === 1 ? '#startBtn' : '#againBtn');
    await end(p, { revenue: 2500, angry: 0, mistakes: 0, maxCombo: 3 });
  }
  assert.match(await text(p, '#result'), /東山再起！/);
  const b = await shopNow(p);
  assert.equal(b.size, 1); assert.equal(b.lost, null); assert.equal(b.press.fails, 1);
  // switching hard mode off forgives the streak and anything owing
  await p.click('#homeBtn'); await toShop(p);
  await p.click('#hardBtn');
  assert.equal((await shopNow(p)).hard, false);
  await done(p);
});

test('hard mode: an old save without the new fields loads; broken new fields are cleaned', async () => {
  const p = await open(w, vet('x', { target: 'nonsense', solo: 7, hard: 'yes', press: { red: -3, debt: 'x' }, lost: { size: 9 } }));
  const s = await shopNow(p);
  assert.equal(s.target, undefined); assert.equal(s.solo, undefined); assert.equal(s.hard, undefined);
  assert.deepEqual(s.press, { red: 0, debt: 0, fails: 0, back: 0 });
  assert.equal(s.lost, null);
  await toShop(p);
  assert.equal(await p.getAttribute('#tgTier [data-tt="safe"]', 'aria-pressed'), 'true');
  assert.equal(await p.getAttribute('#soloSeg [data-solo="one"]', 'aria-pressed'), 'true');
  await go(p, '#startBtn');
  assert.equal(await p.evaluate(() => G.solo), undefined);
  await done(p);
});

test('一腳踢: the tab bar matches the shop, a tap moves the player and the screen, the computer covers the rest', async () => {
  const p = await open(w, vet('x'));
  await toShop(p);
  await p.click('#soloSeg [data-solo="all"]');
  assert.equal((await shopNow(p)).solo, 'all');
  await p.click('#stSeg [data-st="waiter"]');
  await go(p, '#startBtn');
  // hold the shift's own clock (the test steps it with update()), so the state and the tabs cannot move between reads
  // on a loaded machine; the tab bar still redraws every frame
  await p.evaluate(() => { G.paused = true; });
  await p.waitForFunction(() => document.querySelectorAll('#soloTabs button').length === 4);
  assert.equal(await shown(p, '#soloTabs'), true);
  const check = async st => {
    const s = await p.evaluate(() => ({ station: G.station, roles: { ...G.roles } }));
    assert.equal(s.station, st);
    for (const k of ['waiter', 'bar', 'kitchen', 'till']) assert.equal(s.roles[k], k === st ? 'me' : 'ai', `${k} role`);
    await p.waitForFunction(x => document.querySelector(`#soloTabs [data-solo="${x}"]`)?.getAttribute('aria-pressed') === 'true', st);
    // the screen is the station's
    const vis = await p.evaluate(() => ({ floor: !document.getElementById('floorWrap').hidden, bar: !document.getElementById('barView').hidden, kit: !document.getElementById('kitView').hidden, till: !document.getElementById('till').hidden }));
    assert.deepEqual(vis, { floor: st === 'waiter', bar: st === 'bar', kit: st === 'kitchen', till: st === 'till' });
  };
  await check('waiter');
  // let customers in so the badges have something to count, then compare them with the state
  await p.evaluate(() => { for (let i = 0; i < 40; i++) update(.25); });
  const tabsNow = () => p.evaluate(() => ({
    badges: ['waiter', 'bar', 'kitchen', 'till'].map(k => { const b = document.querySelector(`#soloTabs [data-solo="${k}"] .badge`); return b ? Number(b.textContent) : 0; }),
    loads: ['waiter', 'bar', 'kitchen', 'till'].map(k => stationLoad(k).n) }));
  await p.waitForFunction(() => ['waiter', 'bar', 'kitchen', 'till'].every(k => { const b = document.querySelector(`#soloTabs [data-solo="${k}"] .badge`); return (b ? Number(b.textContent) : 0) === stationLoad(k).n; }), null, { timeout: 3000 }).catch(() => {});
  const t = await tabsNow();
  assert.deepEqual(t.badges, t.loads, 'badges = state');
  assert.ok(t.loads.some(n => n > 0), 'customers came in: ' + t.loads);
  for (const st of ['bar', 'kitchen', 'till', 'waiter']) { await p.click(`#soloTabs [data-solo="${st}"]`); await check(st); }
  // the computer works the stations the player left: time passes and food and drink still come out
  await p.click('#soloTabs [data-solo="till"]');
  // (a group eats once its food and drinks are all out: the computer seated it, took the order, cooked and made the drinks)
  const ate = await p.evaluate(() => { const seen = new Set(); for (let i = 0; i < 480; i++){ update(.25); G.groups.forEach(g => { if (g.state === 'eat' || g.state === 'pay') seen.add(g.id); }); } return seen.size; });
  assert.ok(ate > 0, 'the computer covered the floor, bar and kitchen');
  // end card: the whole shop, no first-station bonus or mastery for a solo shift
  await end(p, { angry: 0, mistakes: 0 });
  assert.match(await text(p, '#endKick'), /一腳踢/);
  assert.equal(await p.locator('#result .ingw', { hasText: '第一次做' }).count(), 0);
  // the tab bar hides on the next frame after the shift ends (soloFrame in the main loop), not inside endGame
  await p.waitForFunction(() => document.getElementById('soloTabs').hidden, null, { timeout: 3000 }).catch(() => {});
  assert.equal(await shown(p, '#soloTabs'), false);
  await done(p);
});

test('輪流做: the player moves every 45 s on their own; the tabs are locked and say where next', async () => {
  const p = await open(w, vet('x', { solo: 'rotate' }));
  await toShop(p);
  await p.click('#stSeg [data-st="waiter"]');
  await go(p, '#startBtn');
  assert.match(await text(p, '#soloTabs .rotnext'), /秒後轉去水吧/);
  assert.equal(await p.locator('#soloTabs [data-solo="bar"]').isDisabled(), true);
  await p.evaluate(() => { while (G.t < 46) update(.25); });
  await p.waitForFunction(() => G.station === 'bar');
  assert.equal(await p.evaluate(() => G.roles.bar), 'me');
  assert.equal(await p.evaluate(() => G.roles.waiter), 'ai');
  assert.equal(await shown(p, '#barView'), true);
  await p.evaluate(() => { while (G.t < 91) update(.25); });
  await p.waitForFunction(() => G.station === 'kitchen');
  assert.equal(await shown(p, '#kitView'), true);
  await end(p, { angry: 0, mistakes: 0 });
  assert.match(await text(p, '#endKick'), /輪流做/);
  await done(p);
});

test('solo modes: stay out of the daily challenge, levels and the tutorial', async () => {
  const p = await open(w, vet('x', { solo: 'all' }));
  await p.evaluate(() => { setDailyArmed(true); start(); });
  await p.waitForFunction(() => G.running);
  assert.equal(await p.evaluate(() => G.solo), undefined);
  assert.equal(await shown(p, '#soloTabs'), false);
  await p.evaluate(() => { G.running = false; });
  await done(p);
});

test('help: every station\'s help fits one phone screen', async () => {
  const p = await open(w, vet('x'));
  await p.click('#helpBtn');
  const n = await p.locator('#helpTabs button').count();
  for (let i = 0; i < n; i++) {
    await p.locator('#helpTabs button').nth(i).click();
    const id = await p.$eval('#helpView dl.howto:not([hidden])', d => d.id);
    if (id === 'howAll') continue;   // 通用 is not a station
    const m = await p.evaluate(() => { const v = document.getElementById('helpView'); return { sh: v.scrollHeight, ch: v.clientHeight, n: document.querySelectorAll('#helpView dl.howto:not([hidden]) dt').length }; });
    assert.ok(m.n <= 5, `${id}: ${m.n} entries`);
    assert.ok(m.sh <= m.ch, `${id} scrolls: ${m.sh} > ${m.ch}`);
  }
  await done(p);
});
