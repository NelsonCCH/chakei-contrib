// Backend tests: auth, saves, daily leaderboard, stats. Run against a real local Worker (wrangler dev).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, client, googleToken, otherKey } from './helpers/server.js';

let srv, anon;
before(async () => { srv = await startServer(); anon = client(srv.url); });
after(async () => { await srv?.stop(); });

const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
async function devLogin(name) {
  const r = await anon('/api/auth/dev', { method: 'POST', body: { name } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

test('config reports google client id, dev auth and stats', async () => {
  const r = await anon('/api/config');
  assert.equal(r.status, 200);
  assert.equal(r.body.devAuth, true);
  assert.ok(r.body.googleClientId.endsWith('.apps.googleusercontent.com'));
  assert.equal(r.body.stats, true);
});

test('static game is served and unknown api is 404', async () => {
  const html = await (await fetch(srv.url + '/')).text();
  assert.match(html, /香城茶餐廳/);
  assert.doesNotMatch(html, /firebase/i, 'Firebase scripts must be gone');
  assert.equal((await anon('/api/nope')).status, 404);
  assert.equal((await fetch(srv.url + '/vendor/firebase/firebase-app-compat.js')).status, 404);
});

test('dev login: same name is the same account, keeps Chinese names intact', async () => {
  const a = await devLogin('阿明'), b = await devLogin('阿明'), c = await devLogin('阿強');
  assert.equal(a.user.uid, b.user.uid);
  assert.notEqual(a.user.uid, c.user.uid);
  assert.equal(a.user.name, '阿明');
  assert.equal(a.user.provider, 'dev');
  const me = await client(srv.url, a.token)('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.uid, a.user.uid);
});

test('dev login strips markup and caps the name at 10 characters', async () => {
  const r = await devLogin('<b>一二三四五六七八九十十一</b>');
  assert.ok(!/[<>]/.test(r.user.name));
  assert.ok([...r.user.name].length <= 10);
});

test('google login accepts a valid ID token and rejects forged / wrong ones', async () => {
  const ok = await anon('/api/auth/google', { method: 'POST', body: { credential: googleToken() } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.user.uid, 'g:1234567890');
  assert.equal(ok.body.user.name, '大文');
  assert.equal(ok.body.user.provider, 'google');

  const again = await anon('/api/auth/google', { method: 'POST', body: { credential: googleToken() } });
  assert.equal(again.body.user.uid, ok.body.user.uid, 'same Google account -> same uid');

  const bad = async (cred, why) => {
    const r = await anon('/api/auth/google', { method: 'POST', body: { credential: cred } });
    assert.equal(r.status, 401, why + ' should be rejected, got ' + JSON.stringify(r.body));
  };
  await bad(googleToken({ aud: 'someone-else.apps.googleusercontent.com' }), 'wrong audience');
  await bad(googleToken({ iss: 'https://evil.example.com' }), 'wrong issuer');
  await bad(googleToken({ exp: Math.floor(Date.now() / 1000) - 3600 }), 'expired');
  await bad(googleToken({}, { key: otherKey }), 'signed by another key');
  await bad(googleToken({}, { kid: 'unknown-kid' }), 'unknown key id');
  const t = googleToken().split('.');
  await bad(t[0] + '.' + Buffer.from(JSON.stringify({ sub: 'attacker', aud: 'x' })).toString('base64url') + '.' + t[2], 'tampered payload');
  await bad('not-a-jwt', 'garbage');
});

test('session tokens: missing, tampered or foreign tokens get 401', async () => {
  assert.equal((await anon('/api/save')).status, 401);
  const { token } = await devLogin('阿珍');
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 'g:someone', exp: Date.now() + 1e9 })).toString('base64url') + '.' + sig;
  assert.equal((await client(srv.url, forged)('/api/save')).status, 401);
  assert.equal((await client(srv.url, body + '.AAAA')('/api/save')).status, 401);
  assert.equal((await client(srv.url, token)('/api/save')).status, 200);
});

test('save: empty at first, round-trips the shop, rejects junk and oversize', async () => {
  const { token } = await devLogin('存檔員');
  const c = client(srv.url, token);
  assert.deepEqual((await c('/api/save')).body, { shop: null });
  const shop = { stars: 7, servedTotal: 42, name: '我的茶餐廳', nick: '存檔員', t: Date.now(), outfit: { hat: 'paper' }, recipes: ['a', 'b'] };
  const put = await c('/api/save', { method: 'PUT', body: { shop } });
  assert.equal(put.status, 200);
  const got = await c('/api/save');
  assert.deepEqual(got.body.shop, shop);
  assert.ok(got.body.updated > 0);
  assert.equal((await c('/api/save', { method: 'PUT', body: '{nope' })).status, 400);
  assert.equal((await c('/api/save', { method: 'PUT', body: { shop: [1, 2] } })).status, 400);
  assert.equal((await c('/api/save', { method: 'PUT', body: { shop: null } })).status, 400);
  assert.equal((await c('/api/save', { method: 'PUT', body: { shop: { big: 'x'.repeat(300 * 1024) } } })).status, 413);
  assert.deepEqual((await c('/api/save')).body.shop, shop, 'failed writes must not change the save');
});

test('saves are per account', async () => {
  const a = client(srv.url, (await devLogin('甲')).token), b = client(srv.url, (await devLogin('乙')).token);
  await a('/api/save', { method: 'PUT', body: { shop: { stars: 1 } } });
  await b('/api/save', { method: 'PUT', body: { shop: { stars: 2 } } });
  assert.equal((await a('/api/save')).body.shop.stars, 1);
  assert.equal((await b('/api/save')).body.shop.stars, 2);
});

// L14: compare-and-set. A client sends the version it read; a write from an older version is refused (409 stale) and
// changes nothing. A client from before versions sends none and is written unconditionally, as before.
test('save versions: each write bumps ver, a write from an older version is refused, no ver (old client) still writes', async () => {
  const c = client(srv.url, (await devLogin('版本員')).token);
  assert.deepEqual((await c('/api/save')).body, { shop: null }, 'no save yet: no version (read as 0)');
  const first = await c('/api/save', { method: 'PUT', body: { shop: { stars: 1 }, ver: 0 } });
  assert.equal(first.status, 200); assert.equal(first.body.ver, 1);
  assert.equal((await c('/api/save')).body.ver, 1);
  // A second device that also read "no save" (version 0) is refused; nothing is written.
  const stale = await c('/api/save', { method: 'PUT', body: { shop: { stars: 9 }, ver: 0 } });
  assert.equal(stale.status, 409); assert.equal(stale.body.error, 'stale'); assert.equal(stale.body.ver, 1);
  assert.equal((await c('/api/save')).body.shop.stars, 1);
  assert.equal((await c('/api/save', { method: 'PUT', body: { shop: { stars: 2 }, ver: 1 } })).body.ver, 2);
  // Old client (cached by the service worker): no ver, written as before, and the version still moves on.
  const old = await c('/api/save', { method: 'PUT', body: { shop: { stars: 3 } } });
  assert.equal(old.status, 200); assert.equal(old.body.ver, 3);
  assert.equal((await c('/api/save', { method: 'PUT', body: { shop: { stars: 4 }, ver: 2 } })).status, 409, 'a client that read before the old client wrote must merge first');
  for (const bad of [-1, 1.5, '3', null, {}]) assert.equal((await c('/api/save', { method: 'PUT', body: { shop: { stars: 5 }, ver: bad } })).status, 400, 'ver ' + JSON.stringify(bad));
  const got = await c('/api/save');
  assert.equal(got.body.shop.stars, 3); assert.equal(got.body.ver, 3);
});

test('daily leaderboard keeps each player best score, sorts, marks me', async () => {
  const day = today();
  const a = await devLogin('一號'), b = await devLogin('二號');
  const ca = client(srv.url, a.token), cb = client(srv.url, b.token);
  const post = (c, revenue, stars = 2) => c('/api/daily/' + day, { method: 'POST', body: { name: 'x', revenue, stars, station: 'waiter', slot: 'lunch' } });
  assert.equal((await post(ca, 500)).status, 200);
  await post(ca, 300);            // worse: ignored
  await post(cb, 800, 3);
  await post(ca, 650, 3);         // better: replaces
  const lb = await ca('/api/daily/' + day);
  const mine = lb.body.rows.filter(r => r.me);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].revenue, 650);
  const revs = lb.body.rows.map(r => r.revenue);
  assert.deepEqual(revs, [...revs].sort((x, y) => y - x), 'sorted best first');
  assert.ok(revs.includes(800));
  const anonLb = await anon('/api/daily/' + day);
  assert.ok(anonLb.body.rows.every(r => r.me === false));
  assert.equal((await anon('/api/daily/' + day, { method: 'POST', body: { revenue: 1 } })).status, 401);
  assert.equal((await post(ca, 100).then(() => ca('/api/daily/1999-1-1', { method: 'POST', body: { revenue: 9 } }))).status, 400, 'stale day');
  assert.equal((await anon('/api/daily/not-a-day')).status, 404);
  assert.equal((await anon('/api/daily/2026-13-99x')).status, 404);
  const capped = await ca('/api/daily/' + day, { method: 'POST', body: { revenue: 1e12, stars: 99 } });
  assert.equal(capped.status, 200);
  const top = (await anon('/api/daily/' + day)).body.rows[0];
  assert.ok(top.revenue <= 1e6 && top.stars <= 3, 'values are clamped');
});

// The board is ranked per seat, takings and the sink's points do not compare; a row stored without
// a seat counts as the day's seat for the four (the page's boardBySeat)
test('daily leaderboard ranks each seat on its own; a row without a seat joins the day\'s seat for the four', async () => {
  const d = new Date(Date.now() + 864e5), day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;   // a day no other test posts to
  const post = async (who, revenue, station) => client(srv.url, (await devLogin(who)).token)('/api/daily/' + day, { method: 'POST', body: { name: who, revenue, stars: 2, station, slot: 'lunch' } });
  for (const [who, rev, st] of [['燒一', 180, 'roast'], ['燒二', 240, 'roast'], ['企一', 900, 'waiter'], ['企二', 700, 'waiter'], ['舊人', 800, '']]) assert.equal((await post(who, rev, st)).status, 200);
  const rows = (await anon('/api/daily/' + day)).body.rows;
  assert.equal(rows.length, 5, 'a seat with small numbers is not pushed off by another seat\'s');
  for (const st of ['roast', 'waiter', '']) { const r = rows.filter(x => x.station === st).map(x => x.revenue); assert.deepEqual(r, [...r].sort((a, b) => b - a), st + ': best first'); }
  const { freshCore } = await import('./sim/core.js');
  const C = freshCore(), g = C.boardBySeat(rows, 'waiter', 'roast');
  assert.deepEqual(g.map(x => x.seat), ['roast', 'waiter'], 'the viewer\'s seat first, then seats() order');
  assert.deepEqual(g[1].rows.map(x => x.revenue), [900, 800, 700], 'the old row ranks with the four\'s seat of the day');
  assert.deepEqual(C.boardBySeat(rows, 'till', 'till').map(x => [x.seat, x.rows.length]), [['till', 1], ['waiter', 2], ['roast', 2]]);
});

// 洗碗 is gone; a day's old 'wash' rows stay stored but leave the board (Worker and page both)
test('daily leaderboard leaves out rows of the retired 洗碗 seat', async () => {
  const d = new Date(Date.now() + 2 * 864e5), day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;   // a day no other test posts to
  const post = async (who, revenue, station) => client(srv.url, (await devLogin(who)).token)('/api/daily/' + day, { method: 'POST', body: { name: who, revenue, stars: 2, station, slot: 'lunch' } });
  for (const [who, rev, st] of [['洗一', 150, 'wash'], ['洗二', 9999, 'wash'], ['企三', 900, 'waiter'], ['舊人二', 800, '']]) assert.equal((await post(who, rev, st)).status, 200);
  const rows = (await anon('/api/daily/' + day)).body.rows;
  assert.deepEqual(rows.map(r => r.station).sort(), ['', 'waiter'], 'the Worker\'s board has no wash rows');
  const { freshCore } = await import('./sim/core.js');
  const C = freshCore(), stored = [...rows, { name: '洗二', revenue: 9999, stars: 2, station: 'wash', slot: 'lunch' }];
  const g = C.boardBySeat(stored, 'waiter', 'waiter');
  assert.deepEqual(g.map(x => [x.seat, x.rows.map(r => r.revenue)]), [['waiter', [900, 800]]], 'the page drops a wash row an older Worker sent');
});

test('stats add up and reject bad keys', async () => {
  const day = '2026-11-09';
  assert.equal((await anon('/api/stats', { method: 'POST', body: { day, e: { visit_new: 2, 'BAD KEY': 5, neg: -3 } } })).body.n, 1);
  assert.equal((await anon('/api/stats', { method: 'POST', body: { day, e: { visit_new: 3 } } })).status, 200);
  assert.equal((await anon('/api/stats', { method: 'POST', body: { day: 'x', e: {} } })).status, 400);
});

test('dev login is gone when DEV_AUTH is off', async () => {
  const s2 = await startServer({ vars: { DEV_AUTH: '0', GOOGLE_CLIENT_ID: '' } });
  try {
    const c = client(s2.url);
    assert.equal((await c('/api/auth/dev', { method: 'POST', body: { name: 'x' } })).status, 404);
    assert.equal((await c('/api/auth/google', { method: 'POST', body: { credential: googleToken() } })).status, 503);
    const cfg = (await c('/api/config')).body;
    assert.equal(cfg.devAuth, false);
    assert.equal(cfg.googleClientId, '');
  } finally { await s2.stop(); }
});

test('only our own page may use the backend: a copy of the game on another site gets 403 for the API and for rooms', async () => {
  const other = { Origin: 'https://copied-game.example' }, own = { Origin: srv.url };
  assert.equal((await anon('/api/config', { headers: other })).status, 403);
  assert.equal((await anon('/api/auth/dev', { method: 'POST', body: { name: '抄襲者' }, headers: other })).status, 403);
  assert.equal((await anon('/api/daily/2026-11-9', { headers: other })).status, 403);
  assert.equal((await anon('/api/config', { headers: own })).status, 200, 'our own page still works');
  assert.equal((await anon('/api/config')).status, 200, 'no Origin header (same-origin GET) still works');
  // fetch() refuses an Upgrade header, so make the WebSocket handshake by hand and report the status code
  const ws = headers => new Promise((ok, fail) => {
    const req = http.request(srv.url + '/api/room/ABCD?id=test1&role=host', { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers } });
    req.on('upgrade', (res, socket) => { socket.destroy(); ok(res.statusCode); });
    req.on('response', res => { res.resume(); ok(res.statusCode); });
    req.on('error', fail); req.end();
  });
  assert.equal(await ws(other), 403, 'room from another site refused');
  assert.equal(await ws(own), 101, 'room from our own page accepted');
});
