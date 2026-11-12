// Cloud in the browser: dev sign-in against the local Worker, save sync both ways, second device, sign-out,
// bad tokens, leaderboard, and the game staying playable (and losing nothing) when the backend is down.
import { go } from './helpers/intro.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { googleToken, client } from './helpers/server.js';
import { world, open, vet, done, shown, text, shopNow, store, sleep, startShift, endShift, settle } from './helpers/ui.js';

let w, w2;
before(async () => { w = await world(); });
after(async () => { await w.stop(); await w2?.stop(); });

let n = 0;
const uname = () => '測' + Date.now().toString(36).slice(-5) + (n++);
const synced = p => p.waitForFunction(() => cloudState === 'on', null, { timeout: 8000 });
const acct = p => text(p, '#acct');
/** Click 測試登入 (the harness auto-accepts the name prompt) and wait for the first sync to finish. */
async function login(p) {
  await p.click('#devSignInBtn');
  await p.waitForSelector('#signOutBtn');
  await synced(p);
}
const cloudSave = async (name, url = w.url) => {
  const r = await fetch(url + '/api/auth/dev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  const { token } = await r.json();
  return (await client(url, token)('/api/save')).body.shop;
};
/** Newer-than-anything seed: progress decides, so give each device a clear star count. */
const seed = (stars, extra = {}) => vet('x', { stars, servedTotal: stars * 10, ...extra });

test('guest: the account box offers 測試登入 and the game works without signing in', async () => {
  const p = await open(w, vet());
  assert.equal(await shown(p, '#acct'), true);
  assert.equal(await shown(p, '#devSignInBtn'), true);
  assert.match(await acct(p), /唔登入照玩/);
  assert.equal(await p.evaluate(() => cloudState), 'guest');
  assert.equal(await shown(p, '#lbBtn'), true, 'leaderboard is reachable as a guest');
  await done(p);
});

test('dev sign-in: shows the name with （測試）, stores the token, uploads the save, sign-out goes back to guest', async () => {
  const name = uname();
  const p = await open(w, vet('老闆', { bank: 1234 }), { promptAnswer: name });
  await login(p);
  assert.match(await acct(p), new RegExp(name));
  assert.match(await acct(p), /（測試）/);
  assert.match(await acct(p), /已經存上雲端|已存雲端/);
  assert.ok(await store(p, 'ckf-auth'), 'token kept for next visit');
  assert.equal(await shown(p, '#devSignInBtn'), false);
  assert.equal((await cloudSave(name)).bank, 1234, 'the first sign-in uploads the local save');
  // reload: still signed in without asking again
  await p.reload(); await p.waitForFunction(() => typeof cloudReady !== 'undefined'); await p.evaluate(() => cloudReady);
  await p.waitForSelector('#signOutBtn');
  assert.match(await acct(p), new RegExp(name));
  // sign out
  await p.click('#signOutBtn');
  assert.equal(await shown(p, '#devSignInBtn'), true);
  assert.equal(await store(p, 'ckf-auth'), null);
  assert.equal(await p.evaluate(() => cloudState), 'guest');
  assert.equal((await shopNow(p)).bank, 1234, 'local save untouched by sign-out');
  await done(p);
});

test('changes made while signed in go up to the cloud (debounced, plus flushed by pushNow)', async () => {
  const name = uname();
  const p = await open(w, vet('老闆', { bank: 100 }), { promptAnswer: name });
  await login(p);
  await p.click('#nickBtn'); await p.fill('#nickIn', '雲端仔'); await p.click('#nickSave');
  await p.evaluate(() => { SHOP.bank = 4321; saveShop(); });
  await p.waitForFunction(() => true);
  // the debounce is 3 s; wait for it rather than calling pushNow so the real path is exercised
  const t0 = Date.now(); let got;
  while (Date.now() - t0 < 7000) { got = await cloudSave(name); if (got && got.bank === 4321) break; await sleep(400); }
  assert.equal(got.bank, 4321); assert.equal(got.nick, '雲端仔');
  await done(p);
});

test('second device (new browser context, same name) receives the first device\'s progress', async () => {
  const name = uname();
  const a = await open(w, seed(20, { bank: 5000, wall: 'blue', own: ['green', 'mosaic', 'sg-red', 'aw-none', 'pl-town', 'blue'], nick: '甲機' }), { promptAnswer: name });
  await login(a);
  const b = await open(w, {}, { promptAnswer: name });   // fresh phone, nothing saved
  await b.click('#firstSkip').catch(() => {});
  await b.evaluate(() => { document.querySelector('#startView').hidden = false; });
  await b.evaluate(() => { document.querySelector('.home').classList.remove('first'); renderAcct(); });
  await b.click('#devSignInBtn');
  await b.waitForFunction(() => cloudState === 'on' && SHOP.stars >= 20, null, { timeout: 8000 }).catch(() => {});
  const s = await shopNow(b);
  assert.equal(s.stars, 20); assert.equal(s.bank, 5000); assert.equal(s.wall, 'blue');
  assert.match(await text(b, '#acct'), /攞返雲端紀錄/);
  assert.equal((await store(b)).bank, 5000, 'and it is written to the second device\'s localStorage');
  await done(a); await done(b);
});

test('progress wins: a device with more progress overwrites the cloud; one with less takes the cloud', async () => {
  const name = uname();
  // cloud starts with 10 stars
  const a = await open(w, seed(10, { bank: 111 }), { promptAnswer: name });
  await login(a); await done(a);
  // a device with MORE progress signs in: cloud is replaced by it
  const hi = await open(w, seed(30, { bank: 999 }), { promptAnswer: name });
  await login(hi);
  assert.equal((await shopNow(hi)).stars, 30);
  assert.equal((await cloudSave(name)).stars, 30);
  assert.match(await acct(hi), /已經存上雲端/);
  // a device with LESS progress (but a newer timestamp) signs in: it takes the cloud
  const lo = await open(w, seed(5, { bank: 5, t: Date.now() + 1e9 }), { promptAnswer: name });
  await login(lo);
  const s = await shopNow(lo);
  assert.equal(s.stars, 30); assert.equal(s.bank, 999);
  assert.equal((await cloudSave(name)).stars, 30, 'cloud keeps the better save');
  await done(hi); await done(lo);
});

// On a slow network the first sync can land after the player has started a shift. The cloud save (a bigger shop)
// wins, but the restaurant must not change under the running shift: it is applied once the shift is over.
for (const kind of ['level', 'free play']) {
  test(`cloud save arriving mid-shift (${kind}) does not swap the restaurant under the shift; it applies after`, async () => {
    const name = uname();
    const a = await open(w, seed(30, { size: 2, bank: 777 }), { promptAnswer: name });
    await login(a); await done(a);
    const b = await open(w, seed(5), { promptAnswer: name });
    let release; const held = new Promise(r => { release = r; });
    let asked = false;
    await b.context().route('**/api/save', async r => { if (r.request().method() === 'GET') { asked = true; await held; } await r.fallback(); });
    await b.click('#devSignInBtn');
    await b.waitForSelector('#signOutBtn');
    assert.equal(asked || await b.evaluate(() => syncBusy), true, 'the first sync is under way and held');
    const before = await b.evaluate(lv => {
      document.querySelectorAll('#gatePop').forEach(e => e.remove());
      if (lv) armLevel(LEVEL_IDS.find(id => LEVELS[id].lay));
      start();
      return { gx: ISO.GX, gy: ISO.GY, n: TABLES.length, tpos: JSON.stringify(TPOS), g: G.tables.length };
    }, kind === 'level');
    release();
    await b.waitForFunction(() => cloudState === 'on' && SHOP.stars === 30, null, { timeout: 8000 });
    const mid = await b.evaluate(() => { for (let i = 0; i < 40; i++) update(0.05); return { gx: ISO.GX, gy: ISO.GY, n: TABLES.length, tpos: JSON.stringify(TPOS), g: G.tables.length, running: G.running }; });
    assert.equal(mid.running, true);
    assert.deepEqual(mid, { ...before, running: true }, 'the restaurant under the running shift is unchanged');
    // Shift over, back home: now the player's own (cloud) shop is the one shown.
    await endShift(b);
    await b.evaluate(() => backToStart());
    const after = await b.evaluate(() => ({ gx: ISO.GX, gy: ISO.GY, n: TABLES.length, size: SHOP.size }));
    assert.deepEqual(after, { gx: 13, gy: 11, n: (await shopNow(b)).tables.length, size: 2 });
    await done(b);
  });
}

// After a failed first sync the game retries a minute later; a clock set back must not push that out for hours.
test('retry of a failed first sync is not postponed when the phone\'s clock was set back', async () => {
  const p = await open(w, seed(3), { promptAnswer: uname() });
  await login(p);
  const r = await p.evaluate(() => {
    cloudSynced = false; syncLast = Date.now() + 3600e3;   // the last attempt "happened" an hour ahead of this clock
    let retried = false; const real = syncDown; syncDown = () => { retried = true; };
    try { cloudPush(); } finally { syncDown = real; }
    return retried;
  });
  assert.equal(r, true);
  await done(p);
});

test('equal progress: the newer save wins', async () => {
  const name = uname();
  const a = await open(w, seed(8, { bank: 100, t: 1000 }), { promptAnswer: name });
  await login(a); await done(a);
  const b = await open(w, seed(8, { bank: 200, t: Date.now() + 5e8 }), { promptAnswer: name });
  await login(b);
  assert.equal((await cloudSave(name)).bank, 200);
  await done(b);
});

test('expired / invalid token: cleared on load, player is a guest, game and local save untouched', async () => {
  for (const bad of ['garbage', 'abc.def', '123.4567890123.AAAA']) {
    const p = await open(w, { ...vet('老闆', { bank: 777 }), 'ckf-auth': bad });
    await p.evaluate(() => cloudReady);
    assert.equal(await p.evaluate(() => cloudState), 'guest', 'guest for token ' + bad);
    assert.equal(await store(p, 'ckf-auth'), null, 'bad token removed');
    assert.equal(await shown(p, '#devSignInBtn'), true);
    assert.equal((await shopNow(p)).bank, 777);
    await done(p);
  }
});

test('token goes bad mid-session: next sync signs out with a message, nothing local is lost', async () => {
  const name = uname();
  const p = await open(w, vet('老闆', { bank: 321 }), { promptAnswer: name });
  await login(p);
  await p.evaluate(() => { CLOUD.token = 'expired.token.value'; cloudSynced = false; syncBusy = false; });
  await p.evaluate(() => syncDown());
  assert.match(await text(p, '#toast'), /登入過咗期/);
  assert.equal(await shown(p, '#devSignInBtn'), true);
  assert.equal(await store(p, 'ckf-auth'), null);
  assert.equal((await shopNow(p)).bank, 321);
  await done(p);
});

test('sign-in that the server refuses shows a message and stays a guest', async () => {
  const p = await open(w, vet(), { promptAnswer: '測試' });
  await p.context().route('**/api/auth/dev', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
  await p.click('#devSignInBtn');
  await p.waitForFunction(() => document.getElementById('toast') && !document.getElementById('toast').hidden);
  assert.match(await text(p, '#toast'), /登入唔到/);
  assert.equal(await p.evaluate(() => cloudState), 'guest');
  assert.equal(await shown(p, '#devSignInBtn'), true);
  await done(p);
});

test('google sign-in path: a valid ID token signs in (no 測試 tag); a forged one is refused with a message', async () => {
  const p = await open(w, vet('老闆', { bank: 55 }));
  const good = googleToken({ sub: 'g-' + uname(), name: '陳大文', given_name: '大文' });
  await p.evaluate(t => finishLogin('/api/auth/google', { credential: t }), good);
  await p.waitForSelector('#signOutBtn'); await synced(p);
  assert.match(await acct(p), /大文/);
  assert.doesNotMatch(await acct(p), /（測試）/);
  await p.click('#signOutBtn');
  await p.evaluate(() => finishLogin('/api/auth/google', { credential: 'a.b.c' }));
  await p.waitForFunction(() => !document.getElementById('toast').hidden);
  assert.match(await text(p, '#toast'), /Google 登入驗證唔過/);
  assert.equal(await p.evaluate(() => cloudState), 'guest');
  await done(p);
});

test('daily challenge score reaches the leaderboard and the list shows name, stars and revenue', async () => {
  const name = uname();
  const p = await open(w, vet('老闆'), { promptAnswer: name });
  await login(p);
  await go(p, '#dailyBtn');
  await p.waitForFunction(() => G.running && G.daily);
  const { station, slot } = await p.evaluate(() => ({ station: G.station, slot: G.slot }));
  await endShift(p, { goal: 'calm', angry: 0, mistakes: 0, revenue: 654 });
  await p.click('#homeBtn');
  await settle(p);
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) { const r = await fetch(w.url + '/api/daily/' + await p.evaluate(() => todayStr())).then(r => r.json()); if (r.rows.some(x => x.revenue === 654)) break; await sleep(300); }
  await p.click('#lbBtn');
  assert.equal(await shown(p, '#bookView'), true);
  await p.waitForSelector('#lbList li');
  const row = await p.locator('#lbList li.me').first().innerText();
  assert.match(row, /654/);
  assert.match(row, /★/);
  assert.match(await text(p, '#lbMsg'), /挑戰目標/);
  await p.click('#bookClose');
  assert.equal(await shown(p, '#bookView'), false);
  assert.ok(station && slot);
  await done(p);
});

test('leaderboard: a lower later score does not replace the best; guests see it with a sign-in hint', async () => {
  const name = uname();
  const p = await open(w, vet('老闆'), { promptAnswer: name });
  await login(p);
  await p.evaluate(() => cloudScore({ revenue: 900, stars: 3, station: 'waiter', slot: 'lunch' }));
  await p.evaluate(() => cloudScore({ revenue: 100, stars: 1, station: 'waiter', slot: 'lunch' }));
  await p.click('#signOutBtn');
  await p.click('#lbBtn');
  await p.waitForSelector('#lbList li');
  assert.match(await text(p, '#lbList'), /\$900/);
  assert.doesNotMatch(await text(p, '#lbList'), /\$100\b/);
  assert.match(await text(p, '#lbMsg'), /登入咗先可以入榜/);
  await p.click('#bookClose');
  await done(p);
});

test('backend down at load: no cloud box, game plays, nothing breaks (even with a stored token)', async () => {
  const p = await open(w, { ...vet('老闆', { bank: 88 }), 'ckf-auth': 'sometoken' }, {});
  await p.context().route('**/api/**', r => r.abort());
  await p.reload(); await p.waitForFunction(() => typeof cloudReady !== 'undefined'); await p.evaluate(() => cloudReady);
  assert.equal(await p.evaluate(() => CLOUD.on), false);
  assert.equal(await shown(p, '#acct'), false, 'cloud UI hidden');
  assert.equal(await shown(p, '#lbBtn'), false);
  await startShift(p, { station: 'waiter' });
  await endShift(p, { revenue: 200, angry: 0, mistakes: 0 });
  assert.equal(await shown(p, '#endView'), true);
  assert.ok((await shopNow(p)).bank >= 288);
  await done(p);
});

test('backend goes down after sign-in: message shown, game keeps working, local save intact, recovers and uploads later', async () => {
  const name = uname();
  const p = await open(w, vet('老闆', { bank: 100 }), { promptAnswer: name });
  await login(p);
  let down = true;
  await p.context().route('**/api/**', r => down ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' }) : r.fallback());
  await startShift(p, { station: 'waiter' });
  await endShift(p, { revenue: 500, angry: 0, mistakes: 0 });
  await p.evaluate(() => pushNow());
  assert.equal(await p.evaluate(() => cloudState), 'err');
  assert.match(await text(p, '#acct'), /雲端連唔到/);
  const local = await shopNow(p);
  assert.ok(local.bank >= 600);
  assert.equal((await store(p)).bank, local.bank, 'saved locally');
  assert.equal((await cloudSave(name)).bank, 100, 'cloud still has the old one');
  // the player can still play and spend
  await p.click('#homeBtn');
  await p.click('#wardBtn'); await p.click('#book [data-wk="cap"]'); await p.click('#book [data-wk="cap"]'); await p.click('#bookClose');
  assert.equal((await shopNow(p)).outfit.hat, 'cap');
  // back up
  down = false;
  await p.evaluate(() => pushNow());
  await synced(p);
  assert.match(await text(p, '#acct'), /已經存上雲端/);
  assert.equal((await cloudSave(name)).outfit.hat, 'cap');
  assert.equal((await cloudSave(name)).bank, (await shopNow(p)).bank);
  await done(p);
});

test('backend down at sign-in time (save endpoint fails): signed in but marked as error, local data kept', async () => {
  const name = uname();
  const p = await open(w, vet('老闆', { bank: 66 }), { promptAnswer: name });
  await p.context().route('**/api/save', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
  await p.click('#devSignInBtn');
  await p.waitForSelector('#signOutBtn');
  await p.waitForFunction(() => cloudState === 'err');
  assert.match(await text(p, '#acct'), /雲端連唔到/);
  assert.equal((await shopNow(p)).bank, 66);
  await done(p);
});

test('a failed first sync does not let an empty local save overwrite the cloud', async () => {
  const name = uname();
  const a = await open(w, seed(25, { bank: 2500 }), { promptAnswer: name });
  await login(a); await done(a);
  const b = await open(w, {}, { promptAnswer: name });
  await b.context().route('**/api/save', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
  await b.evaluate(() => { document.querySelector('.home').classList.remove('first'); });
  await b.evaluate(() => finishLogin('/api/auth/dev', { name: prompt('n') }));
  await b.waitForFunction(() => cloudState === 'err');
  await b.evaluate(() => { SHOP.bank = 1; saveShop(); });
  await sleep(3600);
  assert.equal((await cloudSave(name)).stars, 25, 'cloud keeps the real progress');
  await done(b);
});

test('with dev login switched off the 測試登入 button is gone and Google sign-in is the only way', async () => {
  w2 = await world({ DEV_AUTH: '0' });
  const p = await open(w2, vet());
  assert.equal(await shown(p, '#devSignInBtn'), false);
  assert.equal(await shown(p, '#acct'), true);
  assert.match(await p.getAttribute('#signInBtn', 'disabled') ?? 'x', /.*/);
  assert.match(await text(p, '#acct'), /Google/);
  await done(p);
});

// L14: saves are versioned (compare-and-set) and merged per field instead of "the whole save with more progress wins".
/** Counts this page's save writes the Worker refused as stale (409). */
const staleCount = p => { const n = { v: 0 }; p.on('response', r => { if (r.url().endsWith('/api/save') && r.request().method() === 'PUT' && r.status() === 409) n.v++; }); return n; };
/** saveShop(), then write now instead of after the 3 s debounce (so the test controls the order of the two devices). */
const saveAndPush = p => p.evaluate(async () => { saveShop(); clearTimeout(pushT); pushT = 0; await pushNow(); });

test('two devices on one account: both keep their progress, money adds up, the stale write is refused and merged (L14)', async () => {
  const name = uname();
  const a = await open(w, seed(10, { bank: 1000 }), { promptAnswer: name });
  await login(a);
  const b = await open(w, {}, { promptAnswer: name });
  await b.evaluate(() => { document.querySelector('.home').classList.remove('first'); });
  await b.evaluate(() => finishLogin('/api/auth/dev', { name: prompt('n') }));
  await b.waitForFunction(() => cloudState === 'on' && SHOP.stars === 10, null, { timeout: 8000 });
  await b.evaluate(() => { SHOP.nick = '乙機'; });
  await saveAndPush(b);   // B writes: the version A read is now old
  const sa = staleCount(a), sb = staleCount(b);
  // A, behind B: earns money, serves customers, learns a recipe, three stars on a level, changes its hat.
  await a.evaluate(() => {
    SHOP.bank += 300; SHOP.servedTotal += 50; SHOP.recipes = [...SHOP.recipes, 'f:菠蘿油'];
    SHOP.lvst = { ...SHOP.lvst, estate: { waiter: 3 } }; SHOP.outfit = { ...SHOP.outfit, hat: 'cap' };
  });
  await saveAndPush(a);
  assert.ok(sa.v >= 1, 'A wrote from an old version: refused, then merged and written');
  // B, now behind A: spends money, earns stars, learns another recipe, stars on another level.
  await b.evaluate(() => { SHOP.bank -= 200; SHOP.stars += 2; SHOP.recipes = [...SHOP.recipes, 'k:鴛鴦']; SHOP.lvst = { ...SHOP.lvst, central: { kitchen: 2 } }; });
  await saveAndPush(b);
  assert.ok(sb.v >= 1);
  const want = (s, where) => {
    assert.equal(s.bank, 1100, where + ': A earned 300 and B spent 200, each counted once');
    assert.equal(s.stars, 12, where); assert.equal(s.servedTotal, 150, where);
    assert.ok(s.recipes.includes('f:菠蘿油') && s.recipes.includes('k:鴛鴦'), where + ' ' + JSON.stringify(s.recipes));
    assert.equal(s.lvst.estate.waiter, 3, where); assert.equal(s.lvst.central.kitchen, 2, where);
    assert.equal(s.outfit.hat, 'cap', where + ': a choice changed on one device only keeps that change');
    assert.equal(s.nick, '乙機', where);
  };
  want(await cloudSave(name), 'cloud'); want(await shopNow(b), 'B');
  await a.evaluate(() => syncDown());
  want(await shopNow(a), 'A'); want(await store(a), 'A storage');
  assert.equal(await a.evaluate(() => cloudState), 'on');
  await done(a); await done(b);
});

test('an old client (no save version) writing in between: the new client is refused, merges and keeps both saves\' progress (L14)', async () => {
  const name = uname();
  const p = await open(w, seed(10, { bank: 1000 }), { promptAnswer: name });
  await login(p);
  const st = staleCount(p);
  // An old cached client of the same account writes its whole save without a version, as before L14.
  const { token } = await (await fetch(w.url + '/api/auth/dev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })).json();
  const old = { ...(await cloudSave(name)), bank: 1500, stars: 15, recipes: ['k:鴛鴦'] };
  assert.equal((await client(w.url, token)('/api/save', { method: 'PUT', body: { shop: old } })).status, 200);
  await p.evaluate(() => { SHOP.bank += 100; SHOP.recipes = [...SHOP.recipes, 'f:菠蘿油']; });
  await saveAndPush(p);
  assert.ok(st.v >= 1, 'the write made before the old client\'s is refused');
  const s = await cloudSave(name);
  assert.equal(s.bank, 1600, 'the old client\'s +500 and this one\'s +100');
  assert.equal(s.stars, 15);
  assert.ok(s.recipes.includes('k:鴛鴦') && s.recipes.includes('f:菠蘿油'), JSON.stringify(s.recipes));
  assert.equal((await shopNow(p)).bank, 1600);
  await done(p);
});

test('stale again during the retry: the second merge does not count the first merge\'s money twice (L14)', async () => {
  const name = uname();
  const p = await open(w, seed(10, { bank: 1000 }), { promptAnswer: name });
  await login(p);
  const { token } = await (await fetch(w.url + '/api/auth/dev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })).json();
  /** Another (old, unversioned) client of the account adds money to the cloud save. */
  const otherEarns = async n => { const s = await cloudSave(name); s.bank += n; assert.equal((await client(w.url, token)('/api/save', { method: 'PUT', body: { shop: s } })).status, 200); };
  await otherEarns(500);
  // This device's first write is stale; just before its retry reaches the Worker, the other client writes again.
  let puts = 0;
  await p.context().route('**/api/save', async r => { if (r.request().method() === 'PUT' && ++puts === 2) await otherEarns(50); await r.fallback(); });
  const st = staleCount(p);
  await p.evaluate(() => { SHOP.bank += 100; });
  await saveAndPush(p);
  assert.equal(st.v, 2, 'refused twice, written on the third try');
  assert.equal((await cloudSave(name)).bank, 1650, '1000 + 500 + 50 elsewhere + 100 here');
  assert.equal((await shopNow(p)).bank, 1650);
  await done(p);
});

test('new client against a Worker without save versions (deployed before the migration): sign-in and uploads work as before', async () => {
  const name = uname();
  const p = await open(w, seed(7, { bank: 700 }), { promptAnswer: name });
  // Make the local Worker look old: it never sees a version and never sends one.
  await p.context().route('**/api/save', async r => {
    const req = r.request(); let postData = req.postData() ?? undefined;
    if (req.method() === 'PUT' && postData) { const body = JSON.parse(postData); delete body.ver; postData = JSON.stringify(body); }
    const res = await r.fetch({ postData });
    const j = await res.json(); delete j.ver;
    await r.fulfill({ response: res, json: j });
  });
  await login(p);
  assert.equal((await cloudSave(name)).bank, 700, 'the first sign-in uploads the local save');
  await p.evaluate(() => { SHOP.bank = 777; });
  await saveAndPush(p);
  assert.equal((await cloudSave(name)).bank, 777);
  assert.equal(await p.evaluate(() => cloudState), 'on');
  await done(p);
});
