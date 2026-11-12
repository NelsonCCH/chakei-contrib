// Push-to-talk and the game's sound. Headless, muted Chromium with its fake microphone; the tests assert
// state, never listen. (1) The game's music comes back by itself after a talk turn, our own and another talker's,
// even when the mic's route change stopped every AudioContext (iOS does that; here the test suspends them). (2) Two
// phones in a room's lobby, seated, before any shift: one takes the floor, both hear the chirp (sfx counters), the
// strip sits at the bottom of the lobby without covering it. (3) The 燒味 screen re-reads the output latency every
// time it schedules (a route change moves it) and its sound comes back on the walkie-talkie's word.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { startStatic, openStation } from './helpers/static.js';
import { launch, openGame, veteran, realErrors, shot } from './helpers/browser.js';

let srv, stat, browser;
before(async () => { srv = await startServer(); stat = await startStatic(); browser = await launch({ fakeMic: true }); });
after(async () => { await browser?.close(); await srv?.stop(); await stat?.stop(); });

/** Every AudioContext the page makes (the game's, the walkie-talkie's), so the test can suspend them all as iOS would. */
function recordContexts() {
  const Real = window.AudioContext;
  window.__ctxs = [];
  window.AudioContext = class extends Real { constructor(...a) { super(...a); window.__ctxs.push(this); } };
}
/** iOS Safari's navigator.audioSession, faked: the test reads the session type the page set, and every change. */
function fakeAudioSession() {
  const s = { t: 'auto', log: [], get type() { return this.t; }, set type(v) { this.t = v; this.log.push(v); } };
  Object.defineProperty(navigator, 'audioSession', { configurable: true, value: s });
}
/** Every gain stage of the game's sound (a talk turn must leave each one exactly where it was) and the session. */
const levels = p => p.evaluate(() => ({ master: master.gain.value, music: musicG ? musicG.gain.value : null, noise: noiseG.gain.value, sound: soundOn, musicOn, session: navigator.audioSession.type }));
const suspendAll = p => p.evaluate(() => Promise.all(window.__ctxs.map(c => c.suspend())));
/** Every context running again and the music's schedule moving on (bgmStep advances only while it plays). */
async function musicBack(p, ms = 3000) {
  const s0 = await p.evaluate(() => bgmStep);
  const h = await p.waitForFunction(s => window.__ctxs.length >= 2 && window.__ctxs.every(c => c.state === 'running') && AC.state === 'running' && musicG && bgmStep > s + 2,
    s0, { timeout: ms }).catch(() => null);
  if (h) return;
  const st = await p.evaluate(() => ({ ctxs: window.__ctxs.map(c => c.state), step: bgmStep, ac: AC && AC.state }));
  assert.fail('music did not come back: ' + JSON.stringify(st));
}

/** The music gain goes down to the duck level while a voice is on, rising back only after it ends. */
async function ducked(p) {
  const ok = await p.waitForFunction(() => musicG && musicG.gain.value <= MUSIC_GAIN * 0.5 && musicG.gain.value > 0, null, { timeout: 2000 }).catch(() => null);
  assert.ok(ok, 'music ducked under the voice: ' + await p.evaluate(() => musicG && musicG.gain.value));
}
async function unducked(p) {
  const ok = await p.waitForFunction(() => musicG && musicG.gain.value === Math.fround(MUSIC_GAIN), null, { timeout: 4000 }).catch(() => null);
  assert.ok(ok, 'music back to full after the voice: ' + await p.evaluate(() => musicG && musicG.gain.value));
}

test('music comes back after our own turn and after another talker\'s, every AudioContext running again', async () => {
  const p = await openGame(browser, srv.url, { storage: veteran('阿明'), init: `(${recordContexts})();(${fakeAudioSession})();` });
  await p.evaluate(() => {
    setSound(true); setMusic(true);   // the harness starts with both off; --mute-audio keeps the run silent anyway
    window.__sent = [];
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;right:0;top:200px;z-index:99999';
    document.body.appendChild(host);
    pttBind({ id: 'me', up: () => true, send: m => { if (!(m instanceof ArrayBuffer)) window.__sent.push(m); } },
      { name: () => '阿明', shown: () => true, mount: () => host });
  });
  const floor = m => p.evaluate(x => { pttIn({ t: 'floor', name: '', turn: 0, left: 12000, ...x }); }, m);
  const b = await p.locator('#pttBtn').boundingBox();

  // a tap (not on a button) starts the game's sound and music; the room's session is playback from the bind on
  await p.click('#ptt', { position: { x: 2, y: 2 } });
  await musicBack(p);
  const before = await levels(p);
  assert.equal(before.session, 'playback', 'playback from entering the room, before any mic');
  // our press: play-and-record only while the mic is open
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.down();
  await p.waitForFunction(() => window.__sent.some(m => m.t === 'floorReq') && PTT.mic === 'on');
  await floor({ holder: 'me', name: '阿明', turn: 1 });
  assert.equal(await p.evaluate(() => PTT.turn), 1);
  assert.equal((await levels(p)).session, 'play-and-record');
  await musicBack(p);
  // the music ducks under our voice (by a ramp: the unit test checks its shape)
  await ducked(p);
  // the mic's route change stops every context (iOS); we let go: the music must come back by itself
  await suspendAll(p);
  const r0 = await p.evaluate(() => PTT.stats.revive);
  await p.mouse.up();
  await p.waitForFunction(() => window.__sent.some(m => m.t === 'floorRelease'));
  await floor({ holder: null, turn: 1, left: 0, why: 'release' });
  assert.ok(await p.evaluate(r => PTT.stats.revive > r, r0), 'our turn ending asks for the sound back');
  await musicBack(p);
  await unducked(p);

  // another talker's turn: ducked under it; stopped during it, back after it, with no tap
  await floor({ holder: 'x', name: '阿強', turn: 2 });
  await ducked(p);
  await suspendAll(p);
  await floor({ holder: null, turn: 2, left: 0, why: 'release' });
  await musicBack(p);
  await unducked(p);
  // no gain stage moved through both turns (the session is still play-and-record: our mic's 8 s hold window)
  assert.deepEqual({ ...await levels(p), session: 'playback' }, before, 'gains after the turns equal gains before');

  // the mic's hold window ending (here: the walkie-talkie closing it): stopped as the route goes back, back again
  await suspendAll(p);
  await p.evaluate(() => { pttUnbind(); });
  await musicBack(p);
  // every gain stage and the session exactly as before the turns; the session went only playback <-> play-and-record
  assert.deepEqual(await levels(p), before, 'a talk turn never changes the level');
  assert.deepEqual(await p.evaluate(() => navigator.audioSession.log), ['playback', 'play-and-record', 'playback']);
  assert.deepEqual(realErrors(p), []);
  await p.context().close();
});

test('lobby: two seated phones take the floor before any shift; both hear the chirp; the strip covers nothing', async () => {
  const host = await openGame(browser, srv.url, { storage: veteran('老闆'), init: `(${fakeAudioSession})();` });
  const a = await openGame(browser, srv.url, { storage: veteran('阿明') });
  await host.evaluate(() => { station = 'waiter'; saveSet('ckf-station', 'waiter'); buildMenus(); });
  await host.click('#coopBtn');
  await host.click('#hostBtn');
  await host.waitForFunction(() => NET.t && NET.t.up && NET.code);
  const code = await host.evaluate(() => NET.code);
  await a.click('#coopBtn');
  await a.fill('#roomIn', code);
  await a.click('#joinBtn');
  await a.waitForFunction(() => NET.meta);
  // not seated yet: no strip on the joiner's screen; the owner sits from the start
  await host.waitForSelector('#pttBtn', { state: 'visible' });
  // the room-entry mic request is a capture too: play-and-record for it, then the room's playback,
  // so the level the room starts at is the level after every turn
  await host.waitForFunction(() => navigator.audioSession.log.includes('play-and-record') && navigator.audioSession.type === 'playback');
  assert.deepEqual(await host.evaluate(() => navigator.audioSession.log), ['playback', 'play-and-record', 'playback']);
  assert.ok(await a.isHidden('#pttBtn'), 'no talk button before sitting');
  await a.click('#coop [data-seat="bar"]');
  await a.waitForSelector('#pttBtn', { state: 'visible' });
  for (const p of [host, a]) {
    await p.evaluate(() => { setSound(true); });
    await p.click('#coop .sh-head');   // a tap, as a player makes: lets the page's audio start
    assert.ok(await p.evaluate(() => !G || !G.running), 'no shift running');
  }

  const st = p => p.evaluate(() => ({ key: PTT.stats.asked.key, sfx: PTT.stats.sfx }));
  const [h0, a0] = [await st(host), await st(a)];
  const lb = await a.locator('#pttBtn').boundingBox();
  await a.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await a.mouse.down();
  await a.waitForFunction(() => PTT.turn > 0, null, { timeout: 8000 });
  const aId = await a.evaluate(() => NET.id);
  await host.waitForFunction(i => PTT.holder === i, aId);
  assert.match(await host.evaluate(() => document.getElementById('pttBtn').textContent), /阿明講緊/);
  await host.waitForFunction(() => PTT.stats.rx >= 4, null, { timeout: 5000 });   // the voice reaches the lobby too
  const [h1, a1] = [await st(host), await st(a)];
  assert.equal(a1.key - a0.key, 1, 'own chirp asked');
  assert.equal(h1.key - h0.key, 1, 'remote chirp asked');
  assert.ok(a1.sfx > a0.sfx && h1.sfx > h0.sfx, 'the chirp played on both phones');
  await shot(a, 'ptt-lobby-talking');
  await shot(host, 'ptt-lobby-listening');
  await a.mouse.up();
  for (const p of [host, a]) await p.waitForFunction(() => PTT.holder === null && PTT.turn === 0, null, { timeout: 5000 });

  // the strip is the bottom row of the screen and covers none of the lobby's buttons, scrolled to the end
  for (const p of [host, a]) {
    const bad = await p.evaluate(() => {
      const v = document.getElementById('coopView'); v.scrollTop = v.scrollHeight;
      const r = document.getElementById('ptt').getBoundingClientRect(), out = [];
      if (Math.abs(r.bottom - innerHeight) > 1 || r.height < 44) out.push('strip not at the bottom ' + JSON.stringify(r));
      for (const e of document.querySelectorAll('#coop button')) { const q = e.getBoundingClientRect(); if (q.height && q.bottom > r.top + 0.5 && q.top < r.bottom) out.push(e.id || e.textContent); }
      return out;
    });
    assert.deepEqual(bad, []);
  }
  for (const p of [host, a]) { assert.deepEqual(realErrors(p), []); await p.context().close(); }
});

test('燒味 screen: the output latency is read fresh each time (a route change moves it); its sound comes back on the walkie-talkie\'s word', async () => {
  const p = await openStation(browser, stat.url, { path: '/stations/roast.html' });
  await p.waitForFunction(() => window.__station);
  await p.evaluate(recordContexts);   // the page makes its context only when sound is switched on
  await p.evaluate(() => { window.__lat = 0.02; Object.defineProperty(AudioContext.prototype, 'outputLatency', { configurable: true, get: () => window.__lat }); });
  await p.evaluate(() => { localStorage.setItem('ckf-beat-lat', '0'); });   // calibrated: 開工 starts the run at once
  await p.click('#bGo');   // a tap (lets the page start audio)
  await p.evaluate(() => { document.getElementById('bSnd').click(); });
  await p.waitForFunction(() => window.__station.sound && window.__station.audioState === 'running');
  assert.equal(await p.evaluate(() => window.__station.outLatNow), 0.02);
  await p.evaluate(() => { window.__lat = 0.18; });   // the mic opened: a slower route
  assert.equal(await p.evaluate(() => window.__station.outLatNow), 0.18);
  await p.evaluate(() => { window.__lat = 0.03; });   // and closed again
  assert.equal(await p.evaluate(() => window.__station.outLatNow), 0.03);
  await p.evaluate(() => { window.__lat = 4; });       // a bad reading never moves the beat by more than half a second
  assert.equal(await p.evaluate(() => window.__station.outLatNow), 0.5);
  // stopped by the route change, back on the game page's AUDIO_REVIVE (this page is the seat's iframe there)
  assert.equal(await p.evaluate(() => window.__ctxs.length), 1);
  await p.evaluate(() => window.__ctxs[0].suspend());
  await p.evaluate(() => { dispatchEvent(new Event('ckf-audio-revive')); });
  await p.waitForFunction(() => window.__station.audioState === 'running', null, { timeout: 3000 });
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
