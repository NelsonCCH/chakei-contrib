// Real-network checks against a deployed Worker. Skipped unless LIVE_URL is set:
//   LIVE_URL=https://<your-worker>.<your-subdomain>.workers.dev node --test tests/live.test.js
// Never signs in (the live site has dev login off and Google sign-in needs a person) and never posts daily scores,
// so it leaves no trace in the database. Signed-in save round trips are covered offline by api.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { client, roomSocket, sleep } from './helpers/server.js';
import { launch, openGame, veteran, realErrors, shot } from './helpers/browser.js';

const URL = process.env.LIVE_URL;
const opts = { skip: !URL && 'set LIVE_URL to run', timeout: 180000 };
let browser;
before(async () => { if (URL) browser = await launch(); });
after(async () => { await browser?.close(); });

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

test('live API: Google login only, saves need a session, timings', opts, async () => {
  const anon = client(URL);
  const cfg = await anon('/api/config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.devAuth, false, 'test login is off on the real site');
  assert.match(cfg.body.googleClientId, /\.apps\.googleusercontent\.com$/);
  assert.equal((await anon('/api/auth/dev', { method: 'POST', body: { name: 'zz測試' } })).status, 404);
  assert.equal((await anon('/api/save')).status, 401);
  assert.equal((await anon('/api/auth/google', { method: 'POST', body: { credential: 'not-a-token' } })).status, 401);
  const times = [];
  for (let i = 0; i < 10; i++) {
    const t = performance.now();
    assert.equal((await anon('/api/config')).status, 200);
    times.push(performance.now() - t);
  }
  console.log(`config GET median ${pct(times, .5).toFixed(0)} ms p90 ${pct(times, .9).toFixed(0)}`);
  assert.ok(pct(times, .5) < 1500);
});

test('live room relay: round-trip times over the internet', opts, async () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * 32)]).join('');
  const h = roomSocket(URL, code, 'livehost', 'host');
  await h.wait(m => m.t === 'hello', 10000);
  h.send({ t: 'meta', meta: { hostStation: 'waiter', state: 'lobby' } });
  const a = roomSocket(URL, code, 'livecli1', 'client');
  await a.wait(m => m.t === 'hello', 10000);
  a.send({ t: 'seat', seat: { name: 'x', station: 'bar' } });
  await h.wait(m => m.t === 'seats' && m.seats.livecli1, 10000);
  const rt = [];
  for (let i = 0; i < 40; i++) {
    const t0 = performance.now();
    a.send({ t: 'env', e: { p: 1, room: code, from: 'x', round: 1, seq: i + 1, at: 0, b: { k: 'status', seats: {} } } });
    await h.wait(m => m.t === 'env' && m.e.seq === i + 1, 10000);
    h.send({ t: 'env', e: { p: 1, room: code, from: 'livehost', round: 1, seq: i + 1, at: 0, b: { k: 'ack', seq: i + 1 } } });
    await a.wait(m => m.t === 'env' && m.e.seq === i + 1, 10000);
    rt.push(performance.now() - t0);
    await sleep(50);
  }
  console.log(`phone envelope -> referee -> envelope back to phone: median ${pct(rt, .5).toFixed(0)} ms, p90 ${pct(rt, .9).toFixed(0)}, max ${Math.max(...rt).toFixed(0)}`);
  assert.ok(pct(rt, .5) < 400, 'median round trip ' + pct(rt, .5));
  h.send({ t: 'close' });
  [h, a].forEach(s => s.close());
});

test('live co-op in browsers: 3 players, play, host leaves, client takes over', opts, async () => {
  const host = await openGame(browser, URL, { storage: veteran('zz測試老闆') });
  const till = await openGame(browser, URL, { storage: veteran('zz測試收銀') });
  const kit = await openGame(browser, URL, { storage: veteran('zz測試廚房') });
  await host.evaluate(() => { station = 'waiter'; buildMenus(); });
  await host.click('#coopBtn'); await host.click('#hostBtn');
  await host.waitForFunction(() => NET.t && NET.t.up && NET.t.kind === 'online', null, { timeout: 15000 });
  const code = await host.evaluate(() => NET.code);
  for (const [p, st] of [[till, 'till'], [kit, 'kitchen']]) {
    await p.click('#coopBtn'); await p.fill('#roomIn', code); await p.click('#joinBtn');
    await p.waitForFunction(() => NET.meta, null, { timeout: 15000 });
    await p.click(`#coop [data-seat="${st}"]`);
    await host.waitForFunction(s => Object.values(NET.seats).some(x => x.station === s), st, { timeout: 15000 });
  }
  await host.click('#hostGo');
  await till.waitForFunction(() => G && G.coop && G.running && G.roles.till === 'me', null, { timeout: 15000 });
  await kit.waitForFunction(() => G && G.coop && G.running && G.roles.kitchen === 'me', null, { timeout: 15000 });
  // The referee's tick rhythm on a teammate (should be ~250 ms apart).
  const gaps = await till.evaluate(async () => {
    const ws = window.__net.socks[window.__net.socks.length - 1].real, ts = [];
    const f = e => { if (typeof e.data === 'string' && e.data.startsWith('{"t":"env"') && JSON.parse(e.data).e.b.k === 'tick') ts.push(performance.now()); };
    ws.addEventListener('message', f); await new Promise(r => setTimeout(r, 8000)); ws.removeEventListener('message', f);
    return ts.slice(1).map((t, i) => t - ts[i]);
  });
  console.log(`tick gaps over the internet: median ${pct(gaps, .5).toFixed(0)} ms, p95 ${pct(gaps, .95).toFixed(0)}, max ${Math.max(...gaps).toFixed(0)}`);
  assert.ok(pct(gaps, .5) < 400 && pct(gaps, .95) < 1000);
  // Badge shows a real ping.
  const rtts = await Promise.all([host, till, kit].map(p => p.evaluate(() => NET.t.rtt)));
  console.log('badge ping ms (host, till, kitchen):', rtts.join(', '));
  // Till plays one customer through the internet.
  await till.waitForFunction(() => G.cur && G.step === 'total', null, { timeout: 30000 });
  const expect = await till.evaluate(() => G.cur.expect);
  const t0 = Date.now();
  for (const d of String(expect)) await till.evaluate(k => tillKey(k), d);
  await till.evaluate(() => tillKey('ok'));
  await till.waitForFunction(() => unacked() === 0, null, { timeout: 15000 });
  console.log('till results acknowledged by the referee after', Date.now() - t0, 'ms');
  if (await till.evaluate(() => G.cur && G.step === 'cash')) {
    let left = await till.evaluate(() => G.paid - G.charged);
    for (const n of [100, 50, 20, 10, 5, 2, 1]) while (left >= n) { await till.evaluate(k => tillKey(String(k)), n); left -= n; }
    await till.evaluate(() => tillKey('ok'));
    await till.waitForFunction(() => unacked() === 0, null, { timeout: 15000 });
  }
  assert.equal(await host.evaluate(() => G.mistakes), 0);
  await shot(till, 'live-till'); await shot(kit, 'live-kitchen');
  // Host vanishes; till (first seated) takes over within the grace period plus network time.
  const tLeave = Date.now();
  await host.context().close();
  await till.waitForFunction(() => NET.role === 'host', null, { timeout: 30000 });
  console.log('client promoted to host after', Date.now() - tLeave, 'ms');
  const a = await till.evaluate(() => G.t);
  await sleep(3000);
  assert.ok(await till.evaluate(() => G.t) > a + 2, 'new host runs the shop');
  await kit.waitForFunction(() => NET.role === 'client' && NET.t.up, null, { timeout: 15000 });
  await sleep(1500);
  const [tt, kt] = await Promise.all([till.evaluate(() => G.t), kit.evaluate(() => G.t)]);
  assert.ok(Math.abs(tt - kt) < 3, `kitchen follows the new host (${kt} vs ${tt})`);
  assert.deepEqual(realErrors(till), []); assert.deepEqual(realErrors(kit), []);
  await till.evaluate(() => { document.getElementById('pauseBtn').click(); document.getElementById('quitBtn').click(); });
  await till.context().close(); await kit.context().close();
});
