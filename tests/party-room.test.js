// Party mode over the room: two real headless, muted phones in one room on the local Worker. The owner opens a
// party night; both sit through the night's own screens; every round runs the vote, the ready check and the countdown
// on the room's clock, then the round's shift plays on the room's referee with both phones in it (each at the seat the
// night gave it), and its closed books end on the night's end card. Five rounds to 收舖, 再開一日, and back to plain
// shifts. Every press is a real click on the party screens. Screenshots go to tests/out/party-room/ (look at them).
//
// Remote mode: PREVIEW_URL=https://<your-worker>.<your-subdomain>.workers.dev runs the same journey against a deployed
// preview Worker (PLAYTEST=1). The
// preview is a production build (no test surface: G, NET, CFG are not reachable) and has no ROOM_DEBUG (no fast-forward),
// so that run reads only the page's DOM and the room's WebSocket frames, and every round plays at real speed (a 1-day
// night, the shortest there is: about 19 minutes of shifts). Never point it at the live game. Both modes log the room's
// timing (tick gaps, the game clock's rate, the vote's change window, the countdown) from the frames, to compare.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './helpers/server.js';
import { launch, openGame, veteran, realErrors, roomDbg, OUT } from './helpers/browser.js';

const REMOTE = (process.env.PREVIEW_URL || '').replace(/\/+$/, '');
if (REMOTE && process.env.LIVE_URL && REMOTE === process.env.LIVE_URL.replace(/\/+$/, '')) throw new Error('PREVIEW_URL is the live game (LIVE_URL): never run tests against it');
const SHOTS = join(OUT, REMOTE ? 'party-room-remote' : 'party-room');
mkdirSync(SHOTS, { recursive: true });
let srv, browser;
before(async () => { if (!REMOTE) srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const tap = (p, t) => p.click(`#coop .pty [data-t="${t}"]:not([disabled])`);
const shot = (p, name) => p.screenshot({ path: join(SHOTS, name + '.png') });

/** The room's frames as this phone gets them: each tick (wall ms, game t, round) and each change of the night. */
function watch(page) {
  const log = { ticks: [], phases: [], night: null };
  page.on('websocket', ws => ws.on('framereceived', f => {
    if (typeof f.payload !== 'string' || f.payload[0] !== '{') return;
    let m; try { m = JSON.parse(f.payload); } catch { return; }
    const now = Date.now();
    if (m.t === 'env' && m.e && m.e.b && m.e.b.k === 'tick') log.ticks.push([now, m.e.b.t, m.e.round, m.e.b.running]);
    if (m.t === 'party' && 'night' in m) {
      log.night = m.night;
      const ph = m.night ? m.night.phase : 'none';
      if (log.phases.at(-1)?.[1] !== ph) log.phases.push([now, ph, m.night ? m.night.round : -1]);
    }
  }));
  return log;
}
const until = async (f, ms, what) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) assert.fail('timed out: ' + what); await new Promise(r => setTimeout(r, 100)); } };
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
/** Timing as the client phone saw it: per round, tick gaps (ms) and the game clock's rate; the timed windows. */
function timing(log) {
  const rounds = {};
  for (const [now, t, round, running] of log.ticks) if (running) (rounds[round] ??= []).push([now, t]);
  const out = { rounds: [] };
  for (const [round, xs] of Object.entries(rounds)) {
    if (xs.length < 3) continue;
    const gaps = xs.slice(1).map((x, i) => x[0] - xs[i][0]);
    const wall = (xs.at(-1)[0] - xs[0][0]) / 1000, game = xs.at(-1)[1] - xs[0][1];
    out.rounds.push({ round: +round, ticks: xs.length, gapMed: pct(gaps, .5), gapP95: pct(gaps, .95), gapMax: Math.max(...gaps), rate: +(game / wall).toFixed(3) });
  }
  const P = log.phases, span = (a, b) => { const r = []; for (let i = 0; i < P.length - 1; i++) if (P[i][1] === a && P[i + 1][1] === b) r.push(P[i + 1][0] - P[i][0]); return r; };
  out.countdownMs = span('countdown', 'round');
  out.readyToCountdownMs = span('ready', 'countdown');
  out.voteMs = span('vote', 'ready');   // from the vote screen opening to it closing: the clicks plus the 5 s change window
  return out;
}

test('a party night over the room, end to end: open, sit, five rounds (vote, ready, countdown, shift, end card), 收舖, 再開一日, plain again', { timeout: 300000, skip: !!REMOTE }, async () => {
  const phase = (p, ph, timeout = 15000) => p.waitForFunction(x => NET.night && NET.night.phase === x && document.querySelector(`#coop .pty[data-phase="${x}"]`), ph, { timeout });
  const host = await openGame(browser, srv.url, { storage: veteran('老闆') });
  const cli = await openGame(browser, srv.url, { storage: veteran('阿明') });
  const log = watch(cli);
  await host.click('#coopBtn'); await host.click('#hostBtn');
  await host.waitForFunction(() => NET.t && NET.t.up && NET.code);
  const code = await host.evaluate(() => NET.code);
  await host.click('#partyOpen');
  await phase(host, 'lobby');
  await cli.click('#coopBtn'); await cli.fill('#roomIn', code); await cli.click('#joinBtn');
  // the client's phone joins the night by itself (partySync) and shows its lobby
  await phase(cli, 'lobby');
  await host.waitForFunction(() => NET.night.players.length === 2);
  await host.click('#coop .pty [data-seat="floor1"]');   // 樓面1's tile (every party shop seats 樓面; a tile per place)
  await cli.click('#coop .pty [data-seat="till"]');
  await host.waitForFunction(() => NET.night.seats.floor1 === NET.id && NET.night.seats.till !== null);
  // 樓面2 switched off over the room: the night keeps it, the rounds' shift has one 樓面 place on
  await cli.click('#coop .pty [data-slot="floor2"] [data-t="slotsw"]');
  await host.waitForFunction(() => (NET.night.floorOff ?? []).includes('floor2') && document.querySelector('#coop .pty [data-seat="floor2"].off'));
  await shot(host, '1-lobby-host'); await shot(cli, '1-lobby-client');
  assert.equal(await cli.locator('#coop .pty [data-t="start"]').count(), 0, 'only the host has 開工');
  await tap(host, 'start');
  for (let r = 0; r < 5; r++) {
    await phase(host, 'vote'); await phase(cli, 'vote');
    for (const p of [host, cli]) await p.click(`#coop .pty .pty-card[data-card="${r % 3}"]`);
    if (r === 0) { await shot(cli, '2-vote-client'); }
    await phase(host, 'ready'); await phase(cli, 'ready');
    for (const p of [host, cli]) await tap(p, 'ready');
    await tap(host, 'go');
    // the countdown, then the round: both phones play the room's shift at the night's seats
    await phase(cli, 'countdown');
    for (const [p, st] of [[host, 'waiter'], [cli, 'till']]) {
      await p.waitForFunction(s => G && G.coop && G.running && G.party && NET.myStation === s && G.roles[s] === 'me' && document.getElementById('coopView').hidden, st, { timeout: 20000 });
    }
    assert.equal(await cli.evaluate(() => CFG.gameSec), await cli.evaluate(() => G.party && NET.night.schedule[NET.night.round].sec), 'the phone plays the round\'s length');
    assert.equal(await cli.evaluate(() => G.party.floorOn), 1, 'the room\'s shift has one 樓面 place on (樓面2 off)');
    if (r === 0) { await shot(host, '3-round-host'); await shot(cli, '3-round-client'); }
    if (r === 0) await new Promise(res => setTimeout(res, 3000));   // a few seconds at real speed, for the tick timing
    await roomDbg(host, { op: 'ff', sec: 2000 });
    // the books close: each phone shows the night's end card, not the game's own
    for (const p of [host, cli]) {
      await phase(p, 'endcard', 20000);
      const ok = await p.waitForFunction(() => !document.getElementById('coopView').hidden && document.getElementById('endView').hidden && !G.running, null, { timeout: 15000 }).then(() => true, () => false);
      if (!ok) assert.fail((p === host ? 'host ' : 'client ') + JSON.stringify(p.errors) + JSON.stringify(await p.evaluate(() => ({ coop: document.getElementById('coopView').hidden, end: document.getElementById('endView').hidden, running: G.running, t: G.t, party: G.party, night: NET.night.phase }))));
    }
    if (r === 0) { await shot(host, '4-endcard-host'); await shot(cli, '4-endcard-client'); }
    for (const p of [host, cli]) await tap(p, 'next');
  }
  await phase(host, 'close'); await phase(cli, 'close');
  await shot(host, '5-close-host');
  const n = await host.evaluate(() => ({ rounds: NET.night.history.length, nights: NET.night.nights }));
  assert.equal(n.rounds, 5);
  await tap(host, 'again');
  await phase(host, 'lobby'); await phase(cli, 'lobby');
  assert.equal(await cli.evaluate(() => NET.night.nights), n.nights + 1, '再開一日: the next night');
  // the owner goes back to plain shifts: both lobbies are the plain ones again
  await host.click('#partyClose');
  await host.waitForFunction(() => !NET.night && document.getElementById('hostGo'));
  await cli.waitForFunction(() => !NET.night && !document.querySelector('#coop .pty') && document.querySelector('#coop [data-seat]'));
  await host.waitForFunction(() => NET.meta.state === 'lobby');
  await shot(cli, '6-plain-client');
  for (const p of [host, cli]) assert.deepEqual(realErrors(p), [], 'no page errors');
  console.log('party-room timing (local, client phone): ' + JSON.stringify(timing(log)));
  await Promise.all([host.context().close(), cli.context().close()]);
});

test('remote: the same night on a deployed preview, at real speed, from the DOM and the room\'s frames only', { timeout: 45 * 60000, skip: !REMOTE }, async () => {
  const ready = () => !!document.getElementById('coopBtn');
  const phase = (p, ph, timeout = 20000) => p.waitForSelector(`#coop .pty[data-phase="${ph}"]`, { timeout });
  const host = await openGame(browser, REMOTE, { storage: veteran('老闆'), ready });
  const cli = await openGame(browser, REMOTE, { storage: veteran('阿明'), ready });
  const hlog = watch(host), log = watch(cli);
  await host.click('#coopBtn'); await host.click('#hostBtn');
  const code = (await (await host.waitForSelector('#coop .roomcode', { timeout: 20000 })).textContent()).trim();
  assert.match(code, /^[A-Z0-9]{4}$/, 'a room code: ' + code);
  // the room's socket is up (the badge, redrawn every 2 s, says so) before the owner opens the night
  await host.waitForSelector('#netBadge[data-st="ok"], #netBadge[data-st="slow"]', { timeout: 20000 });
  await host.click('#partyOpen');
  await phase(host, 'lobby').catch(async e => { await shot(host, 'x-fail-host'); throw new Error(e.message + ' frames: ' + JSON.stringify(hlog.phases) + ' badge: ' + await host.locator('#netBadge').textContent() + ' errors: ' + JSON.stringify(host.errors)); });
  await cli.click('#coopBtn'); await cli.fill('#roomIn', code); await cli.click('#joinBtn');
  await phase(cli, 'lobby');
  await until(() => hlog.night && hlog.night.players.length === 2, 20000, 'both in the night');
  await host.click('#coop .pty [data-seat="floor1"]');   // 樓面1's tile (every party shop seats 樓面; a tile per place)
  await cli.click('#coop .pty [data-seat="till"]');
  await until(() => hlog.night.seats.floor1 && hlog.night.seats.till, 20000, 'both seated');
  await shot(host, '1-lobby-host'); await shot(cli, '1-lobby-client');
  assert.equal(await cli.locator('#coop .pty [data-t="start"]').count(), 0, 'only the host has 開工');
  await tap(host, 'start');
  for (let r = 0; r < 5; r++) {
    await phase(host, 'vote'); await phase(cli, 'vote');
    for (const p of [host, cli]) await p.click(`#coop .pty .pty-card[data-card="${r % 3}"]`);
    if (r === 0) await shot(cli, '2-vote-client');
    await phase(host, 'ready'); await phase(cli, 'ready');
    for (const p of [host, cli]) await tap(p, 'ready');
    await tap(host, 'go');
    await phase(cli, 'countdown');
    // the round: the room view gives way to the shift on both phones
    for (const p of [host, cli]) await p.waitForSelector('#coopView', { state: 'hidden', timeout: 30000 });
    const sec = log.night.schedule[log.night.round].sec;
    console.log(`remote round ${r + 1}/5: ${sec} s at real speed`);
    if (r === 0) { await new Promise(res => setTimeout(res, 8000)); await shot(host, '3-round-host'); await shot(cli, '3-round-client'); }
    // the books close after the round's length (plus the close grace): each phone shows the night's end card
    for (const p of [host, cli]) await phase(p, 'endcard', (sec + 60) * 1000);
    for (const p of [host, cli]) await p.waitForSelector('#coopView', { state: 'visible', timeout: 15000 });
    assert.ok(await cli.locator('#endView').isHidden(), 'the night\'s end card, not the game\'s own');
    if (r === 0) { await shot(host, '4-endcard-host'); await shot(cli, '4-endcard-client'); }
    for (const p of [host, cli]) await tap(p, 'next');
  }
  await phase(host, 'close'); await phase(cli, 'close');
  await shot(host, '5-close-host'); await shot(cli, '5-close-client');
  const nights = log.night.nights;
  assert.equal(log.night.history.length, 5);
  await tap(host, 'again');
  await phase(host, 'lobby'); await phase(cli, 'lobby');
  await until(() => log.night && log.night.nights === nights + 1, 10000, '再開一日: the next night');
  await host.click('#partyClose');
  await host.waitForSelector('#hostGo', { timeout: 15000 });
  await cli.waitForFunction(() => !document.querySelector('#coop .pty') && document.querySelector('#coop [data-seat]'), null, { timeout: 15000 });
  await shot(cli, '6-plain-client');
  console.log('party-room timing (remote, client phone): ' + JSON.stringify(timing(log)));
  for (const p of [host, cli]) assert.deepEqual(realErrors(p), [], 'no page errors');
  await Promise.all([host.context().close(), cli.context().close()]);
});
