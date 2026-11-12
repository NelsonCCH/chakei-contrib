// The whole restaurant, single player: the journey auditor (tests/helpers/journey.browser.js) follows every customer
// from the door to the till across all four stations and checks that the shop as a whole makes sense - every group
// ends exactly one way, steps come in a legal order, what is made matches the slip, tables and money add up, the end
// card shows the shop's numbers. Played on every level, the three free-play time slots, the daily challenge and every
// tutorial, as each station, by the station bot and by a random-tapping monkey, with the computer on the other seats
// making its usual mistakes. Plus the unlock path from a brand-new player to the 3-star shop looks.
import { go } from './helpers/intro.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, realErrors } from './helpers/browser.js';
import { openSingle, startShift, run, runToEnd, settle, ALL_RECIPES } from './helpers/single.js';
import { injectJourney, endCardMatches } from './helpers/journey.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const STATIONS = ['waiter', 'bar', 'kitchen', 'till'];
const AI_ERR = () => { CFG.aiErr = .12; CFG.aiBarErr = .05; CFG.aiKitErr = .04; };

async function openJ(shop = {}) {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60, recipes: ALL_RECIPES, ...shop } });
  await injectJourney(page);
  return page;
}

/** Plays the running shift to its end with the bot (or the monkey), checking the screen as it goes. Returns problems. */
async function playOut(page, { monkey = 0 } = {}) {
  await page.evaluate(([err, monkey]) => {
    Bot.reset(); J.reset(); new Function(err)();
    let n = 0;
    const act = monkey ? Bot.monkey(monkey) : null;
    // (the screen check repaints first: the bot may have acted since the last paint)
    Bot.hook = () => { if (act) act(); if (++n % 15 === 0) { paint(); J.screen(); } };
    window.__act = act;
  }, [`(${AI_ERR})()`, monkey]);
  if (monkey && await page.evaluate(() => G.station === 'bar')) for (let i = 0; i < 8 && await page.evaluate(() => G.phase !== 'open'); i++) await page.evaluate(() => { const h = Bot.hook; Bot.hook = null; Bot.run(2); Bot.hook = h; });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => !G.running)) break;
    await run(page, 15, { bot: !monkey, every: monkey ? 1 : 3 });
    if (monkey) await page.evaluate(() => { if (G.paused) document.getElementById('resumeBtn').click(); });
  }
  if (await page.evaluate(() => G.running)) {
    // the monkey may have left the price board or a slip open (on rookie the clock then crawls at a quarter speed)
    await page.evaluate(() => { Bot.hook = null; G.paused = false; document.getElementById('pauseView').hidden = true; closeBoard(); closeSheet(); });
    await runToEnd(page, { bot: !monkey });
  }
  await page.evaluate(() => { Bot.hook = null; });
  await settle(page);
  const out = await page.evaluate(() => [...J.audit(), ...Bot.violations.slice(0, 10).map(v => '[invariant] ' + v), ...Bot.errors.slice(0, 5).map(e => '[bot] ' + e)]);
  if (await page.evaluate(() => !G.tut)) out.push(...await endCardMatches(page));
  out.push(...realErrors(page).map(e => '[page] ' + e));
  page.errors.length = 0;
  return out;
}
const summary = page => page.evaluate(() => J.summary());

// ------------------------------------------------------------------ the auditor itself
test('the journey auditor stays quiet on a clean shift and catches re-introduced bugs (lost dirty seats, a drink for a gone customer, money paid twice, a vanished group)', async () => {
  const clean = await openJ();
  await startShift(clean, { station: 'waiter', slot: 'lunch' });
  assert.deepEqual(await playOut(clean), [], 'clean shift');
  const s = await summary(clean);
  assert.ok(s.groups > 15, 'the clean shift saw customers: ' + JSON.stringify(s));
  await clean.context().close();

  const BUGS = {
    // a group pays and leaves, but its table is never marked as needing cleaning
    'tables': `const o = toPay; window.toPay = g => { const tb = G.tables[g.table], d = tb.dirty; o(g); tb.dirty = d; };`,
    // a paid group's drink ticket comes back to life (the bar would make it again for nobody)
    'made-for-gone': `const gone = []; const op = toPay; window.toPay = g => { const r = op(g); gone.push(g); return r; };
      const ou = update; window.update = dt => { const r = ou(dt); const g = gone.shift(); if (g && g.drinks[0]) g.drinks[0].done = false; return r; };`,
    // the computer cashier books a bill twice
    'money': `const o = aiTill; window.aiTill = () => { const c = G.at.cur; o(); if (c && G.at.cur !== c) G.revenue += c.expect; };`,
    // a group disappears from the door queue with no reason
    'one-ending': `const ou = update; let k = 0; window.update = dt => { const r = ou(dt); if (++k > 400 && k < 1e9) { const g = G.groups.find(x => x.state === 'queue'); if (g) { G.groups = G.groups.filter(x => x !== g); k = 1e9; } } return r; };`,
  };
  for (const [rule, code] of Object.entries(BUGS)) {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
    await page.evaluate(code => new Function(code)(), code);   // the bug goes under the auditor's wrappers, like real game code
    await injectJourney(page);
    await startShift(page, { station: 'kitchen', slot: 'lunch' });
    const v = await playOut(page);
    assert.ok(v.some(x => x.startsWith(`[${rule}]`)), `bug "${rule}" caught; got: ${v.slice(0, 3).join(' / ') || 'nothing'}`);
    await page.context().close();
  }
});

// ------------------------------------------------------------------ every level and free play, each station, bot and monkey
// The matrix is CPU-bound lock-step play and every shift is independent: run it on POOL pages at once.
const POOL = +(process.env.JOURNEY_POOL || 6);
async function matrix(jobs, play) {
  const fails = [], seen = {}, queue = [...jobs];
  const worker = async () => {
    const page = await openJ();
    for (let job; (job = queue.shift());) {
      const v = await play(page, job);
      if (v.length) fails.push(`${job.name}: ${v.slice(0, 4).join('\n   ')}`);
      const s = await summary(page); for (const [k, n] of Object.entries(s.endings)) seen[k] = (seen[k] || 0) + n;
      await page.click('#homeBtn');
    }
    await page.context().close();
  };
  await Promise.all(Array.from({ length: Math.min(POOL, jobs.length) }, worker));
  return { fails, seen };
}
const levelIds = async () => { const p = await openJ(); const ids = await p.evaluate(() => Object.keys(LEVELS)); await p.context().close(); return ids; };
const startLevel = (page, id, st) => page.evaluate(([id, st]) => { document.getElementById('startView').hidden = true; station = st; armLevel(id); start(); }, [id, st]);

test('every level + free play breakfast/lunch/dinner, each station played by the bot: every customer\'s journey makes sense', async () => {
  const LEVEL_IDS_ALL = await levelIds();
  assert.ok(LEVEL_IDS_ALL.length >= 18, "levels: " + LEVEL_IDS_ALL.length);
  const jobs = STATIONS.flatMap(st => [...LEVEL_IDS_ALL.map(id => ({ name: `${st} @ ${id}`, st, id })), ...['breakfast', 'lunch', 'dinner'].map(slot => ({ name: `${st} @ free ${slot}`, st, slot }))]);
  const t0 = Date.now();
  const { fails, seen } = await matrix(jobs, async (page, j) => {
    if (j.id) await startLevel(page, j.id, j.st); else await startShift(page, { station: j.st, slot: j.slot, visitors: true });
    return playOut(page);
  });
  console.log(`${jobs.length} shifts in ${((Date.now() - t0) / 1000).toFixed(0)} s; endings: ${JSON.stringify(seen)}`);
  assert.deepEqual(fails, []);
});

test('every level, each station played by a random-tapping monkey: the shop still makes sense', async () => {
  const LEVEL_IDS_ALL = await levelIds();
  const jobs = STATIONS.flatMap((st, si) => LEVEL_IDS_ALL.map((id, li) => ({ name: `${st} monkey @ ${id}`, st, id, seed: 7919 * (li + 1) + si })));
  const t0 = Date.now();
  const { fails, seen } = await matrix(jobs, async (page, j) => { await startLevel(page, j.id, j.st); return playOut(page, { monkey: j.seed }); });
  console.log(`${jobs.length} monkey shifts in ${((Date.now() - t0) / 1000).toFixed(0)} s; endings: ${JSON.stringify(seen)}`);
  assert.deepEqual(fails, []);
});

// ------------------------------------------------------------------ daily challenge and tutorials
test('the daily challenge and every station\'s tutorial: every customer\'s journey makes sense', async () => {
  const page = await openJ();
  await go(page, '#dailyBtn');
  await page.waitForFunction(() => G && G.running && G.daily);
  assert.deepEqual(await playOut(page), [], 'daily challenge as ' + await page.evaluate(() => G.station));
  await page.click('#homeBtn');
  for (const st of STATIONS) {
    await page.evaluate(() => { document.getElementById('startView').hidden = false; });
    await page.click('#tutBtn');
    await page.click(`#book [data-train="${st}"]`);
    await page.waitForFunction(() => G && G.running && G.tut);
    const v = await playOut(page);
    assert.equal(await page.evaluate(() => G.running), false, st + ' tutorial finished');
    assert.deepEqual(v, [], 'tutorial ' + st);
    const s = await summary(page);
    // the three set customers come first (once all three have come in, ordinary customers start arriving too);
    // the till starts like every till shift, with three random tables already eating (open question in the report)
    const firsts = await page.evaluate(() => [...J.g.values()].map(r => [r.label, r.steps[0]]));
    if (st === 'till') assert.ok(firsts.slice(0, 3).every(([, s]) => /already eat/.test(s)), 'till training head start: ' + JSON.stringify(firsts));
    else assert.deepEqual(firsts.slice(0, 3).map(f => f[0]), await page.evaluate(() => TUT_GROUPS.map(g => g.label)), 'training customers: ' + JSON.stringify(s));
    await page.click('#homeBtn');
  }
  await page.context().close();
});

// ------------------------------------------------------------------ the unlock path
test('unlock path: brand-new player -> level 1 -> next levels one star at a time -> categories by rank -> 3-star shop looks', async () => {
  const page = await openSingle(browser, srv.url, { storage: { 'ckf-shop': JSON.stringify({ t: 1 }) } });
  // what the rules say, written out again here (levels.js / gates.js / decor.js): each category opens by rank, inside a
  // category the first level is open and each next one needs a star on the one before; looks need 3 stars on their level
  const expectOpen = () => page.evaluate(() => {
    const rank = RANKS.reduce((a, r, i) => SHOP.stars >= r.s ? i : a, 0);
    const catNeed = { main: 0, era: 1, old: 2, classic: 2 };
    const catOf = M => M.fest ? 'fest' : M.hell ? 'hell' : !M.era ? 'main' : M.era === '舊區' ? 'old' : M.era === '經典茶記' ? 'classic' : 'era';
    const out = {}, d = new Date(), md = (d.getMonth() + 1) * 100 + d.getDate();
    for (const [id, L] of Object.entries(LEVELS)) {
      const cat = catOf(L);
      // festival levels: only on their dates; the hidden level: one 3-star level in each of 似水流年 / 老街舊舖 / 茶記傳奇
      if (cat === 'fest') { const a = L.fest[0] * 100 + L.fest[1], b = L.fest[2] * 100 + L.fest[3]; out[id] = a <= b ? md >= a && md <= b : md >= a || md <= b; continue; }
      if (cat === 'hell') { out[id] = ['era', 'old', 'classic'].every(c => Object.keys(LEVELS).some(x => catOf(LEVELS[x]) === c && (SHOP.levels[x] | 0) >= 3)); continue; }
      const list = Object.keys(LEVELS).filter(x => catOf(LEVELS[x]) === cat).sort((a, b) => LEVELS[a].n - LEVELS[b].n);
      const i = list.indexOf(id);
      out[id] = rank >= catNeed[cat] && (i === 0 || (SHOP.levels[list[i - 1]] | 0) >= 1);
    }
    return out;
  });
  const actualOpen = () => page.evaluate(() => Object.fromEntries(Object.keys(LEVELS).map(id => [id, levelOpen(id)])));
  // the list on screen agrees with levelOpen: every tab, disabled buttons for locked levels
  const listOpen = () => page.evaluate(() => {
    const out = {};
    for (const c of LV_CATS) { lvTab = c.k; const d = document.createElement('div'); d.innerHTML = levelList(); d.querySelectorAll('button[data-lv]').forEach(b => { out[b.dataset.lv] = !b.disabled; }); }
    return out;
  });
  const check = async what => {
    const want = await expectOpen(), got = await actualOpen(), ui = await listOpen();
    assert.deepEqual(got, want, what + ': levelOpen');
    for (const [id, open] of Object.entries(ui)) assert.equal(open, want[id], `${what}: ${id} button on the level list`);
  };

  // brand new: only the first-day card, the shop is locked, only 第 1 關 is open
  assert.equal(await page.locator('#firstCard').isVisible(), true, 'first-day card');
  await check('new player');
  assert.equal(await page.evaluate(() => levelOpen('estate') && !levelOpen('central') && !catOpen('era') && !catOpen('old')), true);
  assert.equal(await page.evaluate(() => gateOk('shop')), false, 'shop locked before the first shift');

  // 識玩 -> level 1 straight away, the bot earns at least one star
  await page.click('#firstSkip');
  await page.waitForFunction(() => G && G.running && G.level === 'estate');
  await page.evaluate(() => { CFG.aiErr = 0; CFG.aiBarErr = 0; CFG.aiKitErr = 0; Bot.reset(); });
  await runToEnd(page);
  const s1 = await page.evaluate(() => SHOP.levels.estate | 0);
  assert.ok(s1 >= 1, 'level 1 earned a star: ' + s1);
  await check('after level 1');
  assert.equal(await page.evaluate(() => levelOpen('central') && !levelOpen('mongkok')), true, 'one star on 第 1 關 opens 第 2 關 only');
  assert.equal(await page.evaluate(() => gateOk('shop')), true, 'the shop opens after the first shift');
  await page.click('#homeBtn');
  await page.waitForSelector('#gatePop', { timeout: 3000 });
  assert.match(await page.locator('#gatePop').innerText(), /自己間舖/);
  await page.click('#gateLater');

  // ranks open the categories exactly at their star counts (3 -> 新人: 似水流年; 10 -> 熟手: 老街舊舖, 茶記傳奇)
  for (const [stars, label] of [[2, 'below 新人'], [3, '新人'], [9, 'below 熟手'], [10, '熟手']]) {
    await page.evaluate(n => { SHOP.stars = n; }, stars);
    await check(label + ` (${stars}★)`);
  }
  // walking each category: a star on each level opens the next, never two at once
  for (const cat of ['main', 'era', 'old', 'classic']) {
    const ids = await page.evaluate(c => { const ids = catIds(c); ids.forEach(id => { SHOP.levels[id] = 0; }); return ids; }, cat);
    for (let i = 0; i < ids.length; i++) {
      assert.equal(await page.evaluate(id => levelOpen(id), ids[i]), true, `${ids[i]} open`);
      if (ids[i + 1]) assert.equal(await page.evaluate(id => levelOpen(id), ids[i + 1]), false, `${ids[i + 1]} locked until ${ids[i]} has a star`);
      await page.evaluate(id => { SHOP.levels[id] = 1; }, ids[i]);
    }
    await check('after walking ' + cat);
  }
  // the hidden level: 3 stars in two of the three old-shop categories is not enough, the third opens it
  assert.equal(await page.evaluate(() => levelOpen('hell')), false, 'hell locked with one star everywhere');
  for (const [i, cat] of ['era', 'old', 'classic'].entries()) {
    await page.evaluate(c => { SHOP.levels[catIds(c)[0]] = 3; }, cat);
    assert.equal(await page.evaluate(() => levelOpen('hell')), i === 2, `hell after 3 stars in ${cat}`);
  }
  await check('hell open');
  // the difficulty buttons follow the rank (新人 always, 熟手 at 10★, 阿姐 at 25★)
  for (const [stars, open] of [[9, ['rookie']], [10, ['rookie', 'pro']], [24, ['rookie', 'pro']], [25, ['rookie', 'pro', 'ace']]]) {
    await page.evaluate(n => { SHOP.stars = n; buildMenus(); }, stars);
    assert.deepEqual(await page.evaluate(() => ['rookie', 'pro', 'ace'].filter(d => !document.querySelector(`#diffSeg [data-d="${d}"]`).disabled)), open, `difficulty at ${stars}★`);
  }

  // shop looks locked behind a level's 3 stars: shown as locked, buying refused, buyable at 3 stars
  const locked = await page.evaluate(() => Object.entries(LOOKS).flatMap(([kind, set]) => Object.entries(set).filter(([, d]) => d.unlock).map(([k, d]) => ({ kind, k, unlock: d.unlock, p: d.p }))));
  assert.ok(locked.length >= 2, 'there are looks behind 3 stars: ' + locked.length);
  for (const L of locked) {
    await page.evaluate(id => { SHOP.levels[id] = 2; SHOP.bank = 99999; }, L.unlock);
    assert.equal(await page.evaluate(L => lookLocked(LOOKS[L.kind][L.k]), L), true, `${L.k} locked with 2 stars on ${L.unlock}`);
    await page.evaluate(id => { SHOP.levels[id] = 3; }, L.unlock);
    assert.equal(await page.evaluate(L => lookLocked(LOOKS[L.kind][L.k]), L), false, `${L.k} open with 3 stars on ${L.unlock}`);
  }
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
