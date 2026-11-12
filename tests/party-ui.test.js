// Party mode's phone screens (src/ui/party/) on the playtest page site/party.html, in a headless,
// muted browser. The night is the real state machine (src/core/party/ through partySeam); the rounds are the page's
// stand-in. Real presses (mouse clicks on the phone's buttons and on the page's player switcher) drive whole nights;
// after every step the screen is checked against the night's state by a checker written here, apart from the screens'
// own code. Screenshots of every phase at 390x844, 360x740 and a landscape tablet go to tests/out/party/ (look at them).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { launch, PHONE, WEBKIT, OUT } from './helpers/browser.js';
import { ROOT } from './helpers/server.js';
import { staticServer } from './helpers/stations-sim.js';

const SHOTS = join(OUT, 'party');
mkdirSync(SHOTS, { recursive: true });
const SIZES = { phone: { width: 390, height: 844 }, narrow: { width: 360, height: 740 }, tablet: { width: 1024, height: 768 } };

let srv, browser;
before(async () => { srv = await staticServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

/** The playtest page with no running clock and no automatic fake players unless asked: every step is a press. */
async function open(query = '', size = 'phone') {
  const ctx = await browser.newContext({ ...PHONE, viewport: SIZES[size], ...(size === 'tablet' ? { isMobile: false, hasTouch: true } : {}), locale: 'zh-HK', serviceWorkers: 'block' });
  // offline: the web fonts are answered empty (the game's fonts fall back to the system's, as on a phone offline)
  await ctx.route(u => !u.href.startsWith(srv.url), r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  await page.goto(`${srv.url}/party.html?clock=0&auto=0${query}`);
  await page.waitForFunction(() => window.__party && document.querySelector('.pty'));
  page.size = size;
  return page;
}
const night = page => page.evaluate(() => window.__party.night());
/** Look at another fake player's phone (the page's switcher, a real press). */
const view = (page, id) => page.click(`#rig .rv[data-p="${id}"]`);
const skip = page => page.click('#rig [data-r="skip"]');
const inout = (page, id) => page.click(`#rig .rin[data-p="${id}"]`);
/** Game seconds pass (the page's clock is off in these tests). */
const wait = (page, sec) => page.evaluate(d => window.__party.step(d), sec);
/** Presses `sel` on player `id`'s phone. */
async function as(page, id, sel) { await view(page, id); await page.click(sel); }
async function shot(page, name) {
  await page.evaluate(() => { document.getElementById('rig').hidden = true; window.__party.ui.update(); });
  await page.screenshot({ path: join(SHOTS, `${name}-${page.size}${WEBKIT ? '-webkit' : ''}.png`) });
  await noOverflow(page, name);
  // the game's style sheet is linked for its tokens only: none of its rules may land on the party screens
  const leaks = await page.evaluate(() => {
    const sheet = [...document.styleSheets].find(s => s.href?.includes('css/style.css')), out = new Set();
    const els = [...document.querySelectorAll('.pty, .pty *')];
    for (const r of sheet?.cssRules ?? []) {
      if (!(r instanceof CSSStyleRule) || /^(\*|html|body|button|\[hidden\]|:root)$/.test(r.selectorText.trim())) continue;
      for (const sel of r.selectorText.split(',')) {
        if (/^\s*(button|\*|\[hidden\])\s*$/.test(sel)) continue;
        try { if (els.some(e => e.matches(sel))) out.add(sel.trim()); } catch { /* selectors the engine cannot test */ }
      }
    }
    return [...out];
  });
  assert.deepEqual(leaks, [], `${name}: game CSS rules on party elements`);
  await page.evaluate(() => { document.getElementById('rig').hidden = false; });
}

/**
 * The screen against the night: returns every mismatch (empty when the phone shows what the night says). Independent of
 * src/ui/party: names, money, counts and who is waited for are read from the state and worked out here.
 */
async function mismatches(page) {
  return page.evaluate(() => {
    const s = window.__party.night(), me = window.__party.view, bad = [];
    const $ = sel => document.querySelector(`.pty ${sel}`), $$ = sel => [...document.querySelectorAll(`.pty ${sel}`)];
    const txt = el => (el?.textContent ?? '').trim();
    const money = n => `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
    const signed = n => n > 0 ? `+${money(n)}` : n < 0 ? money(n) : '$0';
    const name = id => s.players.find(p => p.id === id)?.name ?? id;
    const STN = { waiter: '伙記', bar: '水吧', kitchen: '廚房', till: '收銀', floor1: '樓面', floor2: '樓面' };
    const sorted = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a < b ? -1 : 1));
    const eq = (what, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(`${what}: screen ${JSON.stringify(a)} != night ${JSON.stringify(b)}`); };
    const root = document.querySelector('.pty'), p = s.players.find(x => x.id === me);
    const present = s.players.filter(x => x.present), seated = present.filter(x => x.seat !== null);
    const counting = seated.length ? seated : present;
    eq('me', root.dataset.me, me);
    if (!p?.present && s.phase !== 'done') { eq('screen', root.dataset.screen, 'away'); return bad; }
    eq('phase', root.dataset.phase, s.phase);
    eq('screen', root.dataset.screen, s.phase);
    if (s.phase !== 'lobby') eq('till on the wall', txt($('[data-t="bank"]')), money(s.bank));
    if (s.phase !== 'lobby') eq('欠租 on the wall', !!$('.pty-bank.owe'), s.bank < 0);
    eq('host badge', !!$('[data-t="me"] [data-t="host"]'), s.host === me);
    eq('my seat', txt($('[data-t="me"] .pty-badge')), p.seat ? STN[p.seat] : '睇戲');
    const seatsOnScreen = () => Object.fromEntries($$('[data-seat]').map(b => [b.dataset.seat, txt(b.querySelector('[data-t="holder"]')).replace('（你）', '')]));
    // 樓面's two places are a tile each: a player, 電腦, or 熄咗 when switched off
    const off = s.floorOff ?? [], isFloor = k => /^floor\d$/.test(k);
    const byTile = one => Object.fromEntries(Object.entries(s.seats).map(([k, v]) => [k, one(v, k)]));
    const seatsInNight = () => byTile((v, k) => v === null ? (off.includes(k) ? '熄咗' : '電腦') : name(v));
    // a seat is pressable when it is free or mine (sit / stand up), and never at 收舖
    const pressable = () => Object.fromEntries($$('[data-seat]').map(b => [b.dataset.seat, !b.disabled]));
    const canPress = () => byTile(v => v === null || v === me);
    const timer = () => txt($('.pty-secs [data-timer]'));
    const w = s.wager, card = w && w.chosen !== null ? w.cards[w.chosen] : null;
    const lastCard = s.phase === 'endcard' && s.round >= s.schedule.length - 1;
    if (['lobby', 'vote', 'ready', 'countdown', 'round', 'endcard'].includes(s.phase) && !lastCard) { eq('seats', seatsOnScreen(), seatsInNight()); eq('seat taps', pressable(), canPress()); }
    if (lastCard) eq('no seats on the last card', $$('[data-seat]').length, 0);
    if (['vote', 'ready', 'countdown', 'round'].includes(s.phase)) eq('till strip', txt($('[data-t="tillBank"]')), money(s.bank));
    switch (s.phase) {
      case 'lobby': {
        eq('room', $$('[data-t="room"] .pty-chip').map(c => c.dataset.name), present.map(x => x.name));
        for (const [k, v] of [['shop', s.cfg.shop], ['days', s.cfg.days], ['chooser', s.cfg.chooser]]) eq(`setting ${k}`, $(`[data-t="${k}"] [aria-pressed="true"]`)?.dataset.v, String(v));
        eq('five shops', $$('[data-t="shop"] button').map(b => b.dataset.v), ['estate', 'central', 'mongkok', 'airport', 'hell']);
        eq('no 試更 setting', !!$('[data-t="warmup"]'), false);
        eq('settings locked for guests', $$('[data-t="setup"] button').every(b => b.disabled), s.host !== me);
        eq('開工 only for the host', !!$('[data-t="start"]'), s.host === me);
        eq('climbed note', !!$('[data-t="climbed"]'), s.climbed !== null);
        break;
      }
      case 'vote': {
        const cards = $$('[data-card]');
        eq('cards', cards.map(c => [c.dataset.tier, txt(c.querySelector('[data-t="text"]'))]), w.cards.map(c => [c.tier, c.text]));
        cards.forEach((c, i) => {
          eq(`voters on card ${i}`, [...c.querySelectorAll('[data-t="voters"] .pty-chip')].map(x => x.dataset.name), present.filter(x => w.votes[x.id] === i).map(x => x.name));
          eq(`my vote on card ${i}`, c.getAttribute('aria-pressed'), String(w.votes[me] === i));
          eq(`card ${i} pays`, txt(c.querySelector('[data-t="pay"]')), `中 ${signed(w.cards[i].win)} · 唔中 ${w.cards[i].lose ? signed(-w.cards[i].lose) : '$0'}`);
          eq(`card ${i} pressable`, !c.disabled, s.cfg.chooser === 'vote' || s.host === me);
        });
        eq('token toggle', $('[data-t="token"]')?.getAttribute('aria-pressed') ?? null, p.seat ? String(w.token.includes(me)) : null);
        eq('token spent', $('[data-t="token"]')?.disabled ?? null, p.seat ? s.tokenUsed : null);
        const must = s.cfg.chooser === 'host' ? present.filter(x => x.id === s.host) : counting;
        eq('waiting for', $$('[data-t="waiting"] .pty-chip').map(c => c.dataset.name), must.filter(x => w.votes[x.id] === undefined).map(x => x.name));
        // no clock until everyone has voted; then the 5 s change window counts down
        eq('vote clock', timer(), w.allAt === null ? '' : String(Math.ceil(5 - (s.phaseT - w.allAt) - 1e-6)));
        eq('no 我包', !!$('[data-t="pledge"]'), false);
        break;
      }
      case 'ready':
      case 'countdown': {
        eq('chosen card', txt($('[data-card] [data-t="text"]')).replace(/ ×\d$/, ''), card?.text ?? '');
        eq('token on', !!$('[data-card] .x2'), !!w?.tokenOn);
        eq('ready ticks', Object.fromEntries($$('[data-seat]').map(b => [b.dataset.seat, b.dataset.ready])), byTile(v => String(v === null || s.taps.includes(v)), held => String(held.every(v => v === null || s.taps.includes(v)))));
        eq('not ready', $$('[data-t="notReady"] .pty-chip').map(c => c.dataset.name), seated.filter(x => !s.taps.includes(x.id)).map(x => x.name));
        eq('my ready button', $('[data-t="ready"]')?.getAttribute('aria-pressed') ?? null, p.seat ? String(s.taps.includes(me)) : null);
        eq('my ready label', txt($('[data-t="ready"] span')) || null, p.seat ? (s.taps.includes(me) ? '未準備好' : '我準備好') : null);
        const all = seated.every(x => s.taps.includes(x.id));
        eq('boss 開工', $('[data-t="go"]') ? { disabled: $('[data-t="go"]').disabled } : null, s.host === me && s.phase === 'ready' ? { disabled: !all } : null);
        eq('countdown', !!$('[data-timer="count"]'), s.phase === 'countdown');
        eq('ready has no clock', s.phase === 'ready' ? timer() : '', '');
        break;
      }
      case 'round': {
        eq('chosen card', txt($('[data-card] [data-t="text"]')).replace(/ ×\d$/, ''), card?.text ?? '');
        eq('token on', !!$('[data-card] .x2'), !!w?.tokenOn && !!card);
        // on 樓面 with a teammate the line names them
        const mate = p.seat && isFloor(p.seat) ? Object.entries(s.seats).find(([k, v]) => isFloor(k) && v !== null && v !== me)?.[1] : undefined;
        eq('my seat line', txt($('[data-t="me-seat"]')), p.seat ? `你做：${STN[p.seat]}${mate ? `（同${name(mate)}一齊）` : ''}` : '你睇緊戲');
        break;
      }
      case 'endcard': {
        const r = s.history.at(-1), t = r.report.team;
        eq('verdict', $('[data-t="verdict"]')?.dataset.met, String(r.met));
        eq('card money', txt($('[data-t="delta"]')) || null, r.card ? signed(r.cardDelta) : null);
        eq('takings', txt($('[data-t="takings"] b')), signed(r.takings));
        eq('rent', txt($('[data-t="rent"] b')), signed(-r.rent));
        eq('till line', txt($('[data-t="bankline"] b')), `${money(r.bankBefore)} → ${money(r.bankAfter)}`);
        eq('combo', txt($('[data-t="combo"] b')), String(t.maxCombo));
        eq('欠租 note', !!$('[data-t="owe"]'), r.bankAfter < 0);
        const cols = Object.fromEntries($$('[data-col]').map(c => [c.dataset.col, { stars: Number(c.querySelector('[data-stars]').dataset.stars), who: txt(c.querySelector('[data-t="who"]')) }]));
        eq('columns', sorted(cols), sorted(Object.fromEntries(r.report.stations.map(st => {
          const who = st.drivers.filter(d => d.sec > 0).sort((a, b) => b.sec - a.sec).map(d => name(d.player)).join('、') || '電腦';
          return [st.seat, { stars: st.stars, who }];
        }))));
        eq('下一步 pressed', $('[data-t="next"]')?.getAttribute('aria-pressed'), String(s.taps.includes(me)));
        eq('下一步 count', txt($('[data-t="next"] small')), `${counting.filter(x => s.taps.includes(x.id)).length}/${counting.length} 人撳咗`);
        eq('last round says 收舖', txt($('[data-t="next"] span')), r.round >= s.schedule.length - 1 ? '收舖' : '下一步');
        eq('no clock', timer(), '');
        break;
      }
      case 'close':
      case 'done': {
        eq('final till', txt($('[data-t="final"]')), money(s.bank));
        if (s.phase === 'close') {
          eq('people', $$('[data-person]').map(x => x.dataset.person).sort(), s.players.filter(x => x.rounds.length > 0).map(x => x.id).sort());
          eq('everyone has an award', $$('[data-person]').every(x => x.querySelector('[data-award]')), true);
          eq('執笠', !!$('[data-t="fold"]'), s.bank < 0);
          if (s.bank < 0) eq('title', txt($('[data-t="title"]')), '今晚係：執笠');
          else eq('title on the ladder', txt($('[data-rung].here')).replace('今晚', ''), txt($('[data-t="title"]')).replace('今晚係：', ''));
          eq('上次', txt($('[data-t="prev"]')) || null, s.prevBank === null ? null : `上次 ${money(s.prevBank)} → 今晚 ${money(s.bank)}`);
          eq('host buttons', [!!$('[data-t="again"]'), !!$('[data-t="bye"]')], [s.host === me, s.host === me]);
        }
        break;
      }
    }
    return bad;
  });
}
/** Checks the screen for every player's phone (switching views by presses), then comes back. */
async function checkAll(page, label) {
  const back = await page.evaluate(() => window.__party.view), s = await night(page);
  for (const p of s.players) {
    await view(page, p.id);
    assert.deepEqual(await mismatches(page), [], `${label}: ${p.name}'s phone`);
  }
  await view(page, back);
}
/** Nothing sticks out sideways at this size (long names, wide numbers). */
async function noOverflow(page, label) {
  const out = await page.evaluate(() => {
    const root = document.querySelector('.pty'), R = root.getBoundingClientRect(), bad = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${innerWidth}`);
    const body = root.querySelector('[data-t="body"]');
    if (body && body.scrollWidth > body.clientWidth + 1) bad.push(`body scrolls sideways: ${body.scrollWidth} > ${body.clientWidth}`);
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || el.closest('[hidden]')) continue;
      if (r.right > R.right + 1 || r.left < R.left - 1) bad.push(`${el.tagName}.${el.className} "${el.textContent.slice(0, 20)}" ${Math.round(r.left)}-${Math.round(r.right)} outside 0-${Math.round(R.right)}`);
    }
    return bad.slice(0, 8);
  });
  assert.deepEqual(out, [], `${label}: overflow`);
}
const ids = n => Array.from({ length: n }, (_, i) => `f${i + 1}`);
/** Runs 跳 until the night reaches `phase` (跳 moves the whole table on: votes 穩陣, taps 下一步, ready, 開工). */
async function skipTo(page, phase, max = 40) {
  for (let i = 0; i < max && (await night(page)).phase !== phase; i++) await skip(page);
  assert.equal((await night(page)).phase, phase);
}

// ---------------------------------------------------------------- no browser: words and sizes

test('every refusal the night can send has Chinese words; money reads $12,300 and −$800', async () => {
  const code = buildSync({ entryPoints: [join(ROOT, 'src', 'ui', 'party', 'view.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'warning' }).outputFiles[0].text;
  const file = join(SHOTS, `view-${process.pid}.mjs`);
  writeFileSync(file, code);
  const V = await import(pathToFileURL(file).href);
  const src = readFileSync(join(ROOT, 'src', 'core', 'party', 'night.ts'), 'utf8');
  const whys = [...new Set([...src.matchAll(/(?:return|:) '([a-z][^']* [^']*)'/g)].map(m => m[1]))];
  assert.ok(whys.length >= 20, `found the night's refusals (${whys.length})`);
  for (const why of whys) assert.notEqual(V.rejectText(why), why, `"${why}" has no Chinese words`);
  assert.equal(V.money(12300), '$12,300');
  assert.equal(V.money(-450), '−$450');
  assert.equal(V.signed(-800), '−$800');
  assert.equal(V.signed(0), '$0');
});

// ---------------------------------------------------------------- the whole night, by presses

test('a whole night by real presses: shop, seats, wait-for-all votes, ready check, token, end cards, 收舖, 再開一日, 散水', async () => {
  const page = await open('&seed=7');
  await checkAll(page, 'lobby');
  await shot(page, '01-lobby-host');
  await view(page, 'f2');
  await shot(page, '01-lobby-guest');
  // a guest cannot change the night: the buttons are locked (and the night would refuse it anyway)
  assert.equal(await page.locator('[data-t="shop"] button[data-v="hell"]').isDisabled(), true);
  // the host picks the shop and the length
  await as(page, 'f1', '[data-t="shop"] button[data-v="mongkok"]');
  await page.click('[data-t="days"] button[data-v="2"]');
  await page.click('[data-t="days"] button[data-v="1"]');
  let s = await night(page);
  assert.deepEqual(s.cfg, { shop: 'mongkok', days: 1, chooser: 'vote' });
  assert.equal(s.schedule.length, 5);
  // seats: Ken stands up from the till and sits again, by tapping it
  await as(page, 'f4', '[data-seat="till"]');
  assert.equal((await night(page)).seats.till, null);
  await checkAll(page, 'Ken stood up');
  await page.click('[data-seat="till"]');
  assert.equal((await night(page)).seats.till, 'f4');
  await checkAll(page, 'lobby after setup');
  await as(page, 'f1', '[data-t="start"]');
  s = await night(page);
  assert.equal(s.phase, 'vote', '開工 opens the first vote: no 試更');
  await checkAll(page, '早市 vote');
  await shot(page, '02-vote-empty');
  // 早市: three vote 搏一搏; Ken has not voted, and nobody is hurried
  for (const id of ['f1', 'f2', 'f3']) await as(page, id, '[data-card="1"]');
  await wait(page, 120);
  assert.equal((await night(page)).phase, 'vote', 'two minutes later it still waits for Ken');
  await checkAll(page, '早市 waiting for Ken');
  await view(page, 'f4');
  await shot(page, '03-vote-waiting');
  await page.click('[data-card="0"]');
  s = await night(page);
  assert.notEqual(s.wager.allAt, null, 'everyone voted: the 5 s window opens');
  await checkAll(page, '早市 window');
  await shot(page, '04-vote-window');
  await wait(page, 2);
  await page.click('[data-card="1"]');   // Ken changes his mind inside the window
  await checkAll(page, '早市 Ken changed');
  await wait(page, 3.05);
  s = await night(page);
  assert.equal(s.phase, 'ready');
  assert.equal(s.wager.chosen, 1);
  // the ready check: the boss's 開工 stays locked until every seated player is ready
  await checkAll(page, '早市 ready check');
  await view(page, 'f1');
  await shot(page, '05-ready-host');
  assert.equal(await page.locator('[data-t="go"]').isDisabled(), true);
  for (const id of ['f1', 'f2', 'f3']) await as(page, id, '[data-t="ready"]');
  await checkAll(page, 'three ready');
  await view(page, 'f4');
  await shot(page, '06-ready-guest');
  await page.click('[data-t="ready"]');
  await view(page, 'f1');
  assert.equal(await page.locator('[data-t="go"]').isDisabled(), false, 'all ready: 開工 unlocks');
  await checkAll(page, 'all ready');
  await page.click('[data-t="go"]');
  assert.equal((await night(page)).phase, 'countdown');
  await checkAll(page, '早市 countdown');
  await shot(page, '07-countdown');
  await wait(page, 5.05);
  assert.equal((await night(page)).phase, 'round');
  await checkAll(page, '早市 round');
  await shot(page, '08-round');
  await skip(page);
  s = await night(page);
  assert.equal(s.phase, 'endcard');
  await checkAll(page, '早市 end card');
  await view(page, 'f2');
  await shot(page, '09-endcard');
  // the end card waits for everyone's 下一步: no clock
  for (const id of ids(3)) { await as(page, id, '[data-t="next"]'); assert.equal((await night(page)).phase, 'endcard'); }
  await wait(page, 300);
  assert.equal((await night(page)).phase, 'endcard');
  await view(page, 'f4');
  assert.deepEqual(await mismatches(page), []);
  await page.click('[data-t="next"]');
  assert.equal((await night(page)).phase, 'vote');
  // 午市: the 孤注一擲 token — three of four want it (more than half), on 搏盡
  for (const id of ['f1', 'f2', 'f3']) { await as(page, id, '[data-card="2"]'); await page.click('[data-t="token"]'); }
  await as(page, 'f4', '[data-card="2"]');
  await checkAll(page, '午市 token wishes');
  await view(page, 'f1');
  await shot(page, '10-vote-token');
  await wait(page, 5.05);
  s = await night(page);
  assert.equal(s.wager.tokenOn, true);
  assert.equal(s.tokenUsed, true);
  await checkAll(page, '午市 ready with token');
  await skip(page);   // everyone ready, the boss starts, the countdown runs
  assert.equal((await night(page)).phase, 'round');
  await skip(page);
  await checkAll(page, '午市 end card');
  const lunch = (await night(page)).history.at(-1);
  assert.equal(lunch.token, true);
  assert.equal(Math.abs(lunch.cardDelta), lunch.met ? 3600 * 2 : 800 * 2, 'the token doubles the card');
  await skip(page);
  // 下午茶: the token is spent; seats change during the vote: 細妹 stands up, Ken leaves, 細妹 takes his till
  s = await night(page);
  assert.equal(s.phase, 'vote');
  await view(page, 'f1');
  assert.equal(await page.locator('[data-t="token"]').isDisabled(), true, 'the token is spent for the night');
  await as(page, 'f2', '[data-seat="bar"]');
  await inout(page, 'f4');
  await as(page, 'f2', '[data-seat="till"]');
  s = await night(page);
  assert.deepEqual(s.seats, { floor1: 'f1', floor2: null, bar: null, kitchen: 'f3', till: 'f2' });   // 旺角 is a 樓面 shop
  await checkAll(page, '下午茶 seats changed');
  await view(page, 'f2');
  await shot(page, '11-vote-seats');
  await skip(page); await skip(page); await skip(page);
  await checkAll(page, '下午茶 end card');
  // Ken comes back: his till is taken, so he watches, and sits at the computer's bar himself
  await inout(page, 'f4');
  s = await night(page);
  assert.equal(s.players.find(p => p.id === 'f4').seat, null);
  await as(page, 'f4', '[data-seat="bar"]');
  assert.equal((await night(page)).seats.bar, 'f4');
  await checkAll(page, 'Ken back');
  await skip(page);
  await skipTo(page, 'endcard');   // 晚市
  await skip(page);
  s = await night(page);
  assert.equal(s.schedule[s.round].kind, 'late');
  await checkAll(page, '宵夜 vote');
  await skipTo(page, 'endcard');
  await checkAll(page, '宵夜 end card');
  await view(page, 'f3');
  await shot(page, '12-endcard-last');
  for (const id of ids(4)) await as(page, id, '[data-t="next"]');
  s = await night(page);
  assert.equal(s.phase, 'close');
  await checkAll(page, '收舖');
  await view(page, 'f1');
  await shot(page, '13-close-host');
  await view(page, 'f2');
  await shot(page, '13-close-guest');
  const bank = s.bank;
  // 再開一日: back to the lobby, same seats, tonight's till remembered as 上次
  await as(page, 'f1', '[data-t="again"]');
  s = await night(page);
  assert.equal(s.phase, 'lobby');
  assert.equal(s.prevBank, bank);
  assert.equal(s.nights, 2);
  await checkAll(page, 'lobby again');
  await shot(page, '14-lobby-again');
  // a short second night: run it through with 跳, then 散水
  await page.click('[data-t="start"]');
  await skipTo(page, 'close', 60);
  await checkAll(page, 'second 收舖');
  await view(page, 'f1');
  assert.match(await page.textContent('[data-t="prev"]'), /上次 −?\$[\d,]+ → 今晚/);
  await page.click('[data-t="bye"]');
  assert.equal((await night(page)).phase, 'done');
  await checkAll(page, '散水');
  await shot(page, '15-done');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// ---------------------------------------------------------------- the ready check

test('the ready check: computer seats count as ready; un-ready during the countdown; a player leaving and one joining during it', async () => {
  const page = await open('&seed=3&n=3');
  let s = await night(page);
  assert.equal(s.seats.till, null, 'three players: the computer runs the till');
  await as(page, 'f1', '[data-t="start"]');
  await skip(page);   // everyone votes 穩陣, the window runs out
  assert.equal((await night(page)).phase, 'ready');
  await checkAll(page, 'ready check, three players');
  // the computer's till already shows ready
  assert.equal(await page.getAttribute('.pty [data-seat="till"]', 'data-ready'), 'true');
  await as(page, 'f1', '[data-t="ready"]');
  await as(page, 'f2', '[data-t="ready"]');
  await view(page, 'f1');
  assert.equal(await page.locator('[data-t="go"]').isDisabled(), true, '肥仔 is not ready yet');
  await as(page, 'f3', '[data-t="ready"]');
  await view(page, 'f1');
  assert.equal(await page.locator('[data-t="go"]').isDisabled(), false, 'three seated ready + the computer\'s till: 開工 unlocks');
  await checkAll(page, 'all ready with a computer seat');
  await shot(page, '20-ready-cpu-seat');
  // the boss starts; 細妹 taps 未準備好 during the countdown: back to waiting
  await page.click('[data-t="go"]');
  await wait(page, 2);
  assert.equal((await night(page)).phase, 'countdown');
  await view(page, 'f2');
  await shot(page, '21-countdown-guest');
  await page.click('[data-t="ready"]');
  s = await night(page);
  assert.equal(s.phase, 'ready', 'un-ready during the countdown returns to waiting');
  assert.deepEqual([...s.taps].sort(), ['f1', 'f3']);
  await checkAll(page, 'un-ready during the countdown');
  await shot(page, '22-ready-unready');
  await wait(page, 30);
  assert.equal((await night(page)).phase, 'ready', 'and it stays waiting');
  // 細妹 leaves during the ready check: she no longer counts, the computer takes her bar, the boss can start
  await inout(page, 'f2');
  s = await night(page);
  assert.equal(s.seats.bar, null);
  await view(page, 'f1');
  assert.equal(await page.locator('[data-t="go"]').isDisabled(), false, 'the leaver is not waited for');
  await checkAll(page, 'a player left during the ready check');
  // Ken walks in during the ready check: he watches and does not hold anyone up ...
  await inout(page, 'f4');
  await view(page, 'f1');
  assert.equal(await page.locator('[data-t="go"]').isDisabled(), false, 'a newcomer watching is not waited for');
  await checkAll(page, 'a player joined during the ready check');
  await view(page, 'f4');
  await shot(page, '23-ready-joiner');
  // ... until he taps the free bar: now he must be ready too
  await page.click('[data-seat="bar"]');
  await view(page, 'f1');
  assert.equal(await page.locator('[data-t="go"]').isDisabled(), true, 'Ken sat down and is not ready');
  await checkAll(page, 'the joiner sat down');
  await as(page, 'f4', '[data-t="ready"]');
  // 細妹 comes back: her bar is Ken's now, so she watches; she does not block the start
  await inout(page, 'f2');
  assert.equal((await night(page)).players.find(p => p.id === 'f2').seat, null);
  await view(page, 'f1');
  await page.click('[data-t="go"]');
  // someone sitting down during the countdown stops it too
  await as(page, 'f2', '[data-seat="till"]');
  assert.equal((await night(page)).phase, 'ready', 'a new sitter during the countdown stops it');
  await checkAll(page, 'sat down during the countdown');
  await as(page, 'f2', '[data-t="ready"]');
  await as(page, 'f1', '[data-t="go"]');
  await wait(page, 5.05);
  assert.equal((await night(page)).phase, 'round');
  await checkAll(page, 'round after the ready check');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// ---------------------------------------------------------------- the vote's edge cases

test('votes: a tie goes to the boss, a vote can be taken back, a leaver no longer counts, and 老闆話事 waits for the boss', async () => {
  const page = await open('&seed=11');
  await as(page, 'f1', '[data-t="start"]');
  // a tie the host voted in goes to the host's card
  await as(page, 'f1', '[data-card="2"]');
  await as(page, 'f2', '[data-card="2"]');
  await as(page, 'f3', '[data-card="1"]');
  await as(page, 'f4', '[data-card="1"]');
  await checkAll(page, 'tied vote');
  // a vote can be taken back by pressing the card again: the window closes until Ken votes again
  await page.click('[data-card="1"]');
  let s = await night(page);
  assert.equal(s.wager.votes.f4, undefined);
  assert.equal(s.wager.allAt, null);
  await checkAll(page, 'Ken took his vote back');
  await page.click('[data-card="1"]');
  await wait(page, 5.05);
  assert.equal((await night(page)).wager.chosen, 2, 'the host breaks the tie');
  await skipTo(page, 'vote');
  // a player who leaves mid-vote loses their vote and token wish; if everyone else has voted, the window opens
  await as(page, 'f2', '[data-card="1"]');
  await as(page, 'f3', '[data-card="2"]');
  await as(page, 'f4', '[data-card="2"]');
  await page.click('[data-t="token"]');
  await view(page, 'f2');
  assert.deepEqual(await page.locator('[data-card="2"] [data-t="voters"] .pty-chip').evaluateAll(c => c.map(x => x.dataset.name)), ['肥仔', 'Ken']);
  await inout(page, 'f4');   // Ken leaves mid-vote
  s = await night(page);
  assert.equal(s.wager.votes.f4, undefined);
  assert.deepEqual(s.wager.token, []);
  assert.equal(s.wager.allAt, null, '阿明 has not voted yet');
  await checkAll(page, 'after Ken left mid-vote');
  await view(page, 'f4');
  assert.equal(await page.getAttribute('.pty', 'data-screen'), 'away', 'his phone says he left');
  await shot(page, '30-away');
  await as(page, 'f1', '[data-card="0"]');
  await wait(page, 5.05);
  assert.equal((await night(page)).wager.chosen, 0, '1-1-1: the host\'s card');
  // to the next lobby with 老闆話事
  await skipTo(page, 'close', 60);
  await as(page, 'f1', '[data-t="again"]');
  await page.click('[data-t="chooser"] button[data-v="host"]');
  await page.click('[data-t="start"]');
  await checkAll(page, '老闆話事 vote');
  await view(page, 'f2');
  assert.equal(await page.locator('[data-card="2"]').isDisabled(), true, 'only the host picks');
  assert.match(await page.textContent('[data-t="wait"]'), /等阿明揀/);
  await shot(page, '31-vote-host-decides');
  await wait(page, 120);
  assert.equal((await night(page)).phase, 'vote', 'no timer picks for the boss');
  await as(page, 'f1', '[data-card="2"]');
  await wait(page, 5.05);
  assert.equal((await night(page)).wager.chosen, 2);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// ---------------------------------------------------------------- joiners, leavers, the host, the till

test('a late joiner mid-round sits at the computer\'s seat by tapping it; the host leaving hands the night on', async () => {
  const page = await open('&seed=3&n=3');
  await as(page, 'f1', '[data-t="start"]');
  await skip(page); await skip(page);
  assert.equal((await night(page)).phase, 'round');
  await inout(page, 'f5');   // 歐陽小美 walks in mid-round: she watches until she taps a seat
  let s = await night(page);
  assert.equal(s.players.find(p => p.id === 'f5').seat, null);
  await checkAll(page, 'late joiner watching');
  await as(page, 'f5', '[data-seat="till"]');
  s = await night(page);
  assert.equal(s.seats.till, 'f5', 'a free seat mid-round: she takes it at once');
  await checkAll(page, 'late joiner mid-round');
  await shot(page, '40-round-late-joiner');
  await inout(page, 'f6');
  await view(page, 'f6');
  assert.deepEqual(await mismatches(page), []);
  assert.match(await page.textContent('[data-t="me-seat"]'), /睇緊戲/);
  await skip(page);
  s = await night(page);
  const rec = s.history.at(-1);
  assert.ok(rec.report.stations.find(x => x.seat === 'till').drivers.some(d => d.player === 'f5'), 'the till column names her');
  await checkAll(page, 'end card with the late joiner');
  // the host leaves: 細妹 (next to have joined) becomes 老闆 and gets the host's buttons
  await inout(page, 'f1');
  s = await night(page);
  assert.equal(s.host, 'f2');
  await checkAll(page, 'host gone');
  await view(page, 'f2');
  assert.equal(await page.isVisible('[data-t="me"] [data-t="host"]'), true);
  await skipTo(page, 'close', 60);
  await view(page, 'f2');
  assert.equal(await page.isVisible('[data-t="again"]'), true, 'the new host closes the night');
  await view(page, 'f3');
  assert.match(await page.textContent('[data-t="wait"]'), /等細妹/);
  // the old host comes back: a guest now
  await inout(page, 'f1');
  await view(page, 'f1');
  assert.deepEqual(await mismatches(page), []);
  assert.equal(await page.isVisible('[data-t="again"]'), false);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('樓面 takes two players: 樓面1 and 樓面2 are tiles of their own, a tap sits or stands up, the round line names the mate', async () => {
  const page = await open('&seed=4&n=5');
  await as(page, 'f1', '[data-t="shop"] button[data-v="mongkok"]');
  let s = await night(page);
  assert.equal(s.seats.floor1, 'f1', '伙記 moves to 樓面\'s first place');
  assert.deepEqual(await page.$$eval('.pty [data-seat^="floor"] b', els => els.map(e => e.textContent)), ['樓面1', '樓面2'], 'a tile per 樓面 place');
  await view(page, 'f5');
  assert.equal(await page.textContent('[data-seat="floor2"] [data-t="holder"]'), '電腦', 'the default layout: 樓面2 is the computer\'s');
  await as(page, 'f5', '[data-seat="floor2"]');
  s = await night(page);
  assert.equal(s.seats.floor2, 'f5', 'the onlooker takes 樓面2');
  await checkAll(page, '樓面 x2 lobby');
  await view(page, 'f5');
  assert.match(await page.textContent('[data-seat="floor2"] [data-t="holder"]'), /（你）/);
  for (const [size, vp] of [['390x666', { width: 390, height: 666 }], ['640x900', { width: 640, height: 900 }], ['phone', SIZES.phone]]) {
    await page.setViewportSize(vp); page.size = size;
    await shot(page, '45-floor-two-lobby');
  }
  // the round: each 樓面 player's line names the other
  await as(page, 'f1', '[data-t="start"]');
  await skipTo(page, 'round');
  await checkAll(page, '樓面 x2 round');
  await view(page, 'f5');
  assert.match(await page.textContent('[data-t="me-seat"]'), /你做：樓面（同阿明一齊）/);
  await page.setViewportSize({ width: 390, height: 666 }); page.size = '390x666';
  await shot(page, '46-floor-two-round');
  await skip(page);
  s = await night(page);
  assert.equal(s.phase, 'endcard');
  await checkAll(page, '樓面 x2 end card');
  await view(page, 'f5');
  await shot(page, '47-floor-two-endcard');
  // each 樓面 player's own part: a column per place, titled 樓面, naming its player
  const cols = await page.$$eval('.pty [data-col]', els => els.map(e => [e.dataset.col, e.textContent]));
  for (const [seat, who] of [['floor1', '阿明'], ['floor2', '歐陽小美']]) assert.ok(cols.some(([k, t]) => k === seat && t.includes('樓面') && t.includes(who)), `${seat}: ${JSON.stringify(cols)}`);
  await page.locator('.pty [data-t="cols"]').scrollIntoViewIfNeeded();
  await shot(page, '48-floor-two-endcard-cols');
  // standing up from 樓面2 frees her place: the computer's again
  await as(page, 'f5', '[data-seat="floor2"]');
  s = await night(page);
  assert.equal(s.seats.floor2, null);
  await checkAll(page, '樓面 back to one');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('樓面 places switch off and on in the lobby: 熄位 / 開位, the last place stays on, it fits a phone', async () => {
  const page = await open('&seed=4&n=5');
  await as(page, 'f1', '[data-t="shop"] button[data-v="hell"]');
  let s = await night(page);
  assert.equal(s.seats.floor1, 'f1');
  await view(page, 'f1');
  assert.equal(await page.locator('[data-slot="floor1"] [data-t="slotsw"]').count(), 0, 'a seated place has no switch');
  await as(page, 'f1', '[data-slot="floor2"] [data-t="slotsw"]');
  s = await night(page);
  assert.deepEqual(s.floorOff, ['floor2'], '樓面2 is off: one player\'s load, no computer help');
  await checkAll(page, '樓面2 off');
  await view(page, 'f1');
  assert.equal(await page.textContent('[data-seat="floor2"] [data-t="holder"]'), '熄咗');
  assert.equal(await page.textContent('[data-slot="floor2"] [data-t="slotsw"]'), '開位');
  for (const [size, vp] of [['390x666', { width: 390, height: 666 }], ['390x844', { width: 390, height: 844 }], ['640x900', { width: 640, height: 900 }]]) {
    await page.setViewportSize(vp); page.size = size;
    const fit = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.pty [data-slot], .pty [data-seat]')].map(e => e.getBoundingClientRect());
      return { over: document.documentElement.scrollWidth > innerWidth, out: r.filter(b => b.left < 0 || b.right > innerWidth + 0.5).length,
        sw: [...document.querySelectorAll('.pty [data-t="slotsw"]')].map(b => { const x = b.getBoundingClientRect(), t = b.closest('[data-slot]').querySelector('b').getBoundingClientRect(); return x.left >= t.right - 0.5 || x.top >= t.bottom - 0.5; }) };
    });
    assert.deepEqual(fit, { over: false, out: 0, sw: [true] }, `${size}: the seats fit and the switch does not cover the title`);
    await page.locator('.pty [data-t="seats"]').scrollIntoViewIfNeeded();
    await shot(page, '49-floor-slot-off-lobby');
  }
  // f1 stands up: 樓面1 is the computer's now and is the last place on, so it cannot be switched off
  await as(page, 'f1', '[data-seat="floor1"]');
  await view(page, 'f1');
  assert.equal(await page.isDisabled('[data-slot="floor1"] [data-t="slotsw"]'), true, 'the last place on stays on');
  // an onlooker sitting at the off place switches it on
  await as(page, 'f5', '[data-seat="floor2"]');
  s = await night(page);
  assert.equal(s.seats.floor2, 'f5');
  assert.deepEqual(s.floorOff, []);
  await checkAll(page, '樓面2 back on');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a disaster night: the shared till goes below $0 (欠租) and stays there to 收舖, where the shop folds (執笠)', async () => {
  const page = await open('&seed=5');
  await as(page, 'f1', '[data-t="shop"] button[data-v="central"]');
  await page.click('[data-t="start"]');
  await page.click('#rig [data-r="luck"] button[data-v="bad"]');
  for (const id of ids(4)) await as(page, id, '[data-card="2"]');
  await wait(page, 5.05);
  await checkAll(page, 'ready before the disaster');
  await view(page, 'f1');
  await shot(page, '41-ready-till');
  await skip(page); await skip(page);
  let s = await night(page);
  const r = s.history.at(-1);
  assert.equal(r.met, false);
  assert.ok(s.bank < 0, `the till is in debt: ${s.bank}`);
  await checkAll(page, '欠租 end card');
  await view(page, 'f1');
  assert.match(await page.textContent('[data-t="owe"]'), /欠租/);
  assert.match(await page.textContent('.pty-bank'), /欠租/);
  await shot(page, '42-endcard-owe');
  await skip(page);
  await checkAll(page, 'vote in debt');
  await shot(page, '43-vote-owe');
  await skipTo(page, 'close', 60);
  s = await night(page);
  assert.ok(s.bank < 0);
  await checkAll(page, '執笠');
  await view(page, 'f1');
  assert.match(await page.textContent('[data-t="fold"]'), /執笠/);
  await shot(page, '44-close-fold');
  await page.click('[data-t="again"]');
  assert.equal((await night(page)).cfg.shop, 'central', 'folded: the same shop again');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a strong night at 排隊名店 or better moves 再開一日 one shop up, and the lobby says so', async () => {
  const page = await open('&seed=8');
  await page.click('#rig [data-r="luck"] button[data-v="good"]');
  await as(page, 'f1', '[data-t="start"]');
  // a round pays the seats' work (a narrow spread), so a strong night needs its cards too: the table votes
  // 搏一搏 every round (爆單 luck meets it), then 跳 moves on
  for (let i = 0; i < 80 && (await night(page)).phase !== 'close'; i++) {
    const v = await night(page);
    if (v.phase === 'vote' && v.wager) for (const p of v.players.filter(x => x.seat !== null && x.present)) if (v.wager.votes[p.id] === undefined) await as(page, p.id, '[data-card="1"]');
    await skip(page);
  }
  assert.equal((await night(page)).phase, 'close');
  const s = await night(page);
  await view(page, 'f1');
  await checkAll(page, 'strong 收舖');
  const climbs = await page.isVisible('[data-t="again"] small');
  await shot(page, '45-close-climb');
  await page.click('[data-t="again"]');
  const n = await night(page);
  if (climbs) { assert.equal(n.cfg.shop, 'central'); assert.equal(n.climbed, 'estate'); }
  else assert.equal(n.cfg.shop, s.cfg.shop);
  assert.ok(climbs, `a lucky night (till ${s.bank}) reaches 排隊名店`);
  await checkAll(page, 'lobby after the climb');
  await shot(page, '46-lobby-climbed');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('one player alone: every screen works with nobody else', async () => {
  const page = await open('&seed=9&n=1');
  await checkAll(page, 'alone in the lobby');
  await shot(page, '50-lobby-alone');
  await page.click('[data-t="start"]');
  for (let i = 0; i < 80 && (await night(page)).phase !== 'close'; i++) {
    const s = await night(page);
    if (s.phase === 'vote') { if (s.wager.votes.f1 === undefined) { await page.click('[data-card="1"]'); await checkAll(page, 'alone, voted'); } await wait(page, 5.05); continue; }
    if (s.phase === 'ready') { await page.click('[data-t="ready"]'); await page.click('[data-t="go"]'); await wait(page, 5.05); continue; }
    if (s.phase === 'endcard') { await checkAll(page, `alone, ${s.schedule[s.round].kind}`); await page.click('[data-t="next"]'); continue; }
    await skip(page);
  }
  const s = await night(page);
  assert.equal(s.phase, 'close');
  assert.equal(s.history.length, 5);
  await checkAll(page, 'alone at 收舖');
  await shot(page, '51-close-alone');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('eight players: four seated, four onlookers vote as 街坊 and sit when a seat frees; long names at 360 px', async () => {
  const long = ['司徒長長名字王大文', '歐陽小美小美', '阿明', 'Christopher', '上官婉兒婉兒婉兒', '諸葛孔明先生', '細妹', '東方不敗不敗'];
  for (const size of ['narrow', 'phone', 'tablet']) {
    const page = await open(`&seed=13&n=8&names=${encodeURIComponent(long.join(','))}`, size);
    let s = await night(page);
    assert.equal(s.players.filter(p => p.present).length, 8);
    assert.equal(s.players.filter(p => p.seat).length, 4);
    await checkAll(page, `${size}: eight in the lobby`);
    await shot(page, '60-lobby-eight');
    await as(page, 'f1', '[data-t="start"]');
    for (const id of ids(8)) await as(page, id, `[data-card="${id === 'f2' || id === 'f6' || id === 'f7' ? 2 : 1}"]`);
    await as(page, 'f2', '[data-t="token"]');
    await checkAll(page, `${size}: eight voting`);
    await view(page, 'f5');
    assert.match(await page.textContent('[data-card="1"] [data-t="voters"]'), /街坊/);
    await shot(page, '61-vote-eight-onlooker');
    await view(page, 'f1');
    await shot(page, '61-vote-eight-host');
    await wait(page, 5.05);
    await checkAll(page, `${size}: eight, ready check`);
    await shot(page, '62-ready-eight-host');
    await view(page, 'f6');
    await shot(page, '62-ready-eight-onlooker');
    await skip(page);
    await shot(page, '63-round');
    await skip(page);
    await checkAll(page, `${size}: eight, end card`);
    await view(page, 'f1');
    await shot(page, '64-endcard');
    await view(page, 'f6');
    await shot(page, '64-endcard-onlooker');
    // a seated player leaves; an onlooker taps the computer's seat between rounds
    await inout(page, 'f3');
    await as(page, 'f5', '[data-seat="kitchen"]');
    s = await night(page);
    assert.equal(s.seats.kitchen, 'f5');
    await checkAll(page, `${size}: onlooker sat down`);
    await skipTo(page, 'close', 60);
    await checkAll(page, `${size}: eight at 收舖`);
    await view(page, 'f1');
    await shot(page, '65-close');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  }
});

test('every phase at 360 px and on a landscape tablet: screen matches the night, nothing sticks out', async () => {
  for (const size of ['narrow', 'tablet']) {
    const page = await open('&seed=17', size);
    const step = async (name) => { await checkAll(page, `${size} ${name}`); await shot(page, `70-${name}`); };
    // the layout comes from the measured width of the element the screens are drawn in
    const lay = await page.evaluate(() => [document.querySelector('.pty').dataset.lay, getComputedStyle(document.querySelector('.pty')).getPropertyValue('--pu')]);
    assert.deepEqual(lay, size === 'narrow' ? ['narrow', '15px'] : ['wide', '18px']);
    await step('lobby');
    await page.click('[data-t="start"]');
    await as(page, 'f2', '[data-card="2"]');
    await page.click('[data-t="token"]');
    await view(page, 'f1');
    await page.click('[data-card="2"]');
    await page.click('[data-t="token"]');
    await step('vote');
    await as(page, 'f3', '[data-card="0"]');
    await as(page, 'f4', '[data-card="0"]');
    await view(page, 'f1');
    await step('vote-window');
    await wait(page, 5.05);
    await as(page, 'f2', '[data-t="ready"]');
    await view(page, 'f1');
    await step('ready');
    for (const id of ['f1', 'f3', 'f4']) await as(page, id, '[data-t="ready"]');
    await as(page, 'f1', '[data-t="go"]');
    await step('countdown');
    await wait(page, 5.05);
    await step('round');
    await skip(page);
    await step('endcard');
    await skipTo(page, 'close', 60);
    await step('close');
    await view(page, 'f3');
    await shot(page, '70-close-guest');
    await inout(page, 'f3');
    await shot(page, '70-away');
    await as(page, 'f1', '[data-t="bye"]');
    await step('done');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  }
});

// ---------------------------------------------------------------- the clock and the presses

test('with the clock running: no clock while people are missing, the fake players act, and this phone moves the night on', async () => {
  const page = await open('&seed=21&speed=20');
  await page.evaluate(() => { window.__party.setClock(true); window.__party.setAuto(true); });
  await page.click('[data-t="start"]');
  // the others vote by themselves; the vote waits for this phone, with no clock showing
  await page.waitForFunction(() => Object.keys(window.__party.night().wager?.votes ?? {}).length >= 3, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  let s = await night(page);
  assert.equal(s.phase, 'vote');
  assert.equal(await page.textContent('.pty .pty-secs [data-timer]'), '', 'no clock while 阿明 has not voted');
  assert.equal(await page.isHidden('.pty [data-timerbar]'), true);
  await page.click('[data-card="0"]');
  await page.waitForFunction(() => window.__party.night().phase === 'ready', null, { timeout: 15000 });
  // the others tap 我準備好 by themselves; this phone is the boss: ready, then 開工
  await page.waitForFunction(() => window.__party.night().taps.length >= 3, null, { timeout: 15000 });
  await page.click('[data-t="ready"]');
  await page.click('[data-t="go"]');
  await page.waitForFunction(() => window.__party.night().phase === 'round', null, { timeout: 15000 });
  // stop the clock, end the round, then run the end card's 下一步 taps at x1
  await page.click('#rig [data-r="clock"]');
  await page.click('#rig [data-r="speed"] button[data-v="1"]');
  await skip(page);
  assert.equal((await night(page)).phase, 'endcard');
  await page.click('#rig [data-r="clock"]');
  await page.waitForFunction(() => window.__party.night().taps.length >= 3, null, { timeout: 15000 });
  s = await night(page);
  assert.equal(s.phase, 'endcard', 'the card waits for this phone');
  await page.click('[data-t="next"]');
  assert.notEqual((await night(page)).phase, 'endcard');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('the countdown shows 5, 4, 3, 2, 1, 開門！ and a press held across a re-draw keeps its button', async () => {
  const page = await open('&seed=4');
  await as(page, 'f1', '[data-t="start"]');
  await skip(page);
  for (const id of ids(4)) await as(page, id, '[data-t="ready"]');
  await as(page, 'f1', '[data-t="go"]');
  const seen = [];
  for (const dt of [0, 1, 1, 1, 1, .99]) {
    await wait(page, dt);
    seen.push(await page.textContent('[data-timer="count"]'));
  }
  assert.deepEqual(seen, ['5', '4', '3', '2', '1', '1']);
  await wait(page, .02);
  assert.equal((await night(page)).phase, 'round');
  // a finger down on a card while the night changes under it (another vote arrives): the card is not replaced
  await skip(page); await skip(page);
  assert.equal((await night(page)).phase, 'vote');
  await view(page, 'f1');
  const box = await page.locator('[data-card="1"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const before = await page.evaluate(() => { window.__held = document.querySelector('.pty [data-card="1"]'); return true; });
  await page.evaluate(() => { window.__party.seam.input({ k: 'vote', player: 'f2', card: 0 }); window.__party.ui.update(); });
  assert.equal(await page.evaluate(() => window.__held.isConnected), before, 'the pressed card stays while the finger is down');
  await page.mouse.up();
  await page.waitForFunction(() => window.__party.night().wager.votes.f1 === 1);
  await page.waitForFunction(() => !window.__held.isConnected && document.querySelector('.pty [data-card="0"] [data-name="細妹"]'));
  assert.deepEqual(await mismatches(page), []);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a refused press shows why, in Chinese', async () => {
  const page = await open('&seed=2');
  // 細妹 presses Ken's seat in the lobby: it is taken (the tile is not even pressable), so the night is asked directly
  await view(page, 'f2');
  assert.equal(await page.locator('[data-seat="till"]').isDisabled(), true, 'someone else\'s seat cannot be pressed');
  // a press the night refuses: the boss's 開工 while one is not ready, sent as a phone would
  await as(page, 'f1', '[data-t="start"]');
  await skip(page);
  // the locked button is unlocked by hand, as a stale screen could show it: the night still refuses
  await page.evaluate(() => { const b = document.querySelector('.pty [data-t="go"]'); b.disabled = false; });
  await page.click('[data-t="go"]');
  await page.waitForSelector('.pty [data-t="toast"]:not([hidden])');
  assert.equal(await page.textContent('.pty [data-t="toast"]'), '仲有人未準備好');
  await shot(page, '80-toast');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
