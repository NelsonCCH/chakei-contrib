// Push-to-talk in real (headless, muted) browsers: the talk button in the co-op HUD, with Chromium's fake microphone
// (WebKit: its mock capture device). Two and four players: grant / busy / release, who is talking on every screen, the
// audio path (frames from the holder reach the others and play, a non-holder's are dropped), the holder leaving,
// dropping or going silent mid-turn, the 12 s limit, press spam, the page hidden while holding, and a refused mic.
// Invariant after every scenario: the floor ends free on every screen and in the room.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, roomSocket, sleep } from './helpers/server.js';
import { launch, openGame, veteran, realErrors, shot, roomFastForward, roomDbg, WEBKIT } from './helpers/browser.js';

let srv, browser;
const pages = [];
before(async () => { srv = await startServer(); browser = await launch({ fakeMic: true }); });
after(async () => { await browser?.close(); await srv?.stop(); });

/**
 * WebKit: Playwright's Windows WebKit build has neither Web Audio (no AudioContext) nor a capture device, so WebKit runs
 * get a test-only stand-in: an AudioContext whose ScriptProcessor feeds a 440 Hz tone on a timer, and a getUserMedia
 * that returns a dummy stream. On WebKit the floor, the strip, the pointer handling, the codec and the frame relay are
 * real; the audio graph is not (Chromium runs the real one with its fake device: launch({ fakeMic })).
 */
function fakeWebAudio() {
  if (window.AudioContext || window.webkitAudioContext) return;
  // the game's own sound effects (juice.ts) touch the graph too, with sound off: enough of AudioParam for them
  class Param { constructor(v) { this.value = v; } setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} setTargetAtTime() {} cancelScheduledValues() {} }
  class Node { constructor(ctx) { this.context = ctx; } connect(n) { return n; } disconnect() {} }
  const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
  class Ctx {
    constructor() { this.sampleRate = 48000; this.state = 'suspended'; this.t0 = performance.now(); this.destination = new Node(this); }
    get currentTime() { return (performance.now() - this.t0) / 1000; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    addEventListener() {}   // statechange: the stand-in never stops by itself
    createGain() { const n = new Node(this); n.gain = new Param(1); return n; }
    createBiquadFilter() { const n = new Node(this); n.frequency = new Param(350); n.Q = new Param(1); n.type = 'lowpass'; return n; }
    createDynamicsCompressor() { return new Node(this); }
    createOscillator() { const n = new Node(this); n.frequency = new Param(440); n.start = () => {}; n.stop = () => {}; return n; }
    createBuffer(ch, len, rate) { const d = new Float32Array(len); return { duration: len / rate, length: len, sampleRate: rate, numberOfChannels: ch, getChannelData: () => d }; }
    createBufferSource() { const n = new Node(this); n.start = () => {}; n.stop = () => {}; return n; }
    createMediaStreamSource(s) { const n = new Node(this); n.stream = s; return n; }
    createScriptProcessor(size) {
      const n = new Node(this);
      let ph = 0;
      const t = setInterval(() => {
        const d = new Float32Array(size);
        for (let i = 0; i < size; i++) d[i] = Math.sin(ph++ * 2 * Math.PI * 440 / 48000) * 0.5;
        if (n.onaudioprocess) n.onaudioprocess({ inputBuffer: { getChannelData: () => d } });
      }, size / 48);
      n.disconnect = () => clearInterval(t);
      return n;
    }
  }
  window.AudioContext = Ctx;
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { track.readyState = 'live'; return stream; } } });
}
async function player(nick, opts = {}) {
  const init = WEBKIT ? `(${fakeWebAudio})();${opts.init ? `(${opts.init})();` : ''}` : opts.init;
  const p = await openGame(browser, srv.url, { storage: veteran(nick), ...opts, init });
  p.nick = nick;
  pages.push(p);
  return p;
}
async function closeAll() { for (const p of pages.splice(0)) { try { await p.context().close(); } catch {} } }
afterEach(closeAll);

async function hostRoomAs(p, st) {
  await p.evaluate(s => { station = s; saveSet('ckf-station', s); buildMenus(); }, st);
  await p.click('#coopBtn');
  await p.click('#hostBtn');
  await p.waitForFunction(() => NET.t && NET.t.up && NET.code);
  return p.evaluate(() => NET.code);
}
async function joinAs(p, code, st, host) {
  if (await p.isHidden('#coopView')) await p.click('#coopBtn');
  await p.fill('#roomIn', code);
  await p.click('#joinBtn');
  await p.waitForFunction(() => NET.meta);
  await p.click(`#coop [data-seat="${st}"]`);
  await host.waitForFunction(s => Object.values(NET.seats).some(x => x.station === s), st);
}
/** A room with the host on `stations[0]` and one teammate per other station, shift running (and not ending). */
async function room(stations) {
  const nicks = ['老闆', '阿明', '阿強', '阿珍'];
  const all = [];
  for (let i = 0; i < stations.length; i++) all.push(await player(nicks[i]));
  const [host, ...clients] = all;
  const code = await hostRoomAs(host, stations[0]);
  for (let i = 0; i < clients.length; i++) await joinAs(clients[i], code, stations[i + 1], host);
  await host.click('#hostGo');
  await host.waitForFunction(() => G.coop && G.running);
  await roomDbg(host, { op: 'set', gameSec: 1e6 });   // a shift that never ends (on the room's referee)
  for (const c of clients) await c.waitForFunction(() => G && G.coop && G.running && G.roles[NET.myStation] === 'me', null, { timeout: 10000 });
  for (const p of all) await p.waitForSelector('#pttBtn', { state: 'visible' });
  // a tap on each screen, as a player makes all the time: lets its audio start (browsers need a gesture)
  for (const p of all) await p.mouse.click(5, 300);
  return { code, all, host, clients };
}

const center = async p => { const b = await p.locator('#pttBtn').boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
async function hold(p) { const [x, y] = await center(p); await p.mouse.move(x, y); await p.mouse.down(); }
async function letGo(p) { await p.mouse.up(); }
const id = p => p.evaluate(() => NET.id);
const btn = p => p.evaluate(() => document.getElementById('pttBtn').dataset.st);
const btnText = p => p.evaluate(() => document.getElementById('pttBtn').textContent);
const talking = p => p.waitForFunction(() => PTT.turn > 0, null, { timeout: 8000 });

let probeN = 0;
/** The invariant: every open screen shows the floor free, and a phone joining the room now is told it is free. */
async function allFree(code, list, ms = 5000) {
  const t0 = Date.now();
  for (const p of list) if (!p.isClosed()) await p.waitForFunction(() => PTT.holder === null && PTT.turn === 0 && !['talking', 'other', 'busy'].includes(document.getElementById('pttBtn').dataset.st), null, { timeout: ms });
  for (;;) {
    const s = roomSocket(srv.url, code, 'pprobe' + (++probeN), 'client');
    const hello = await s.wait(m => m.t === 'hello');
    s.close();
    if (hello.floor === null) return;
    if (Date.now() - t0 > ms) assert.fail('room still has the floor held: ' + JSON.stringify(hello.floor));
    await sleep(300);
  }
}
const noErrors = list => { for (const p of list) if (!p.isClosed()) assert.deepEqual(realErrors(p), [], p.nick); };

test('two players: hold to talk, the other hears it and sees who; pressing while busy says so; release frees', async () => {
  const { code, all, host, clients: [a] } = await room(['waiter', 'bar']);
  const aId = await id(a);
  const rx0 = await host.evaluate(() => PTT.stats.rx);
  await hold(a);
  await talking(a);
  assert.equal(await btn(a), 'talking');
  assert.match(await btnText(a), /你講緊/);
  assert.match(await btnText(a), /剩 1[12] 秒/);
  await host.waitForFunction(i => PTT.holder === i, aId);
  assert.equal(await btn(host), 'other');
  assert.match(await btnText(host), /阿明講緊/, 'the listener sees who talks, on its (busy) button');
  // audio reaches the listener and is scheduled to play
  await host.waitForFunction(r => PTT.stats.rx >= r + 8 && PTT.stats.played >= 4, rx0, { timeout: 5000 });
  assert.equal(await a.evaluate(() => PTT.stats.rx), 0, 'the talker gets no echo of itself');
  await shot(a, 'ptt-talking');
  await shot(host, 'ptt-listening');

  // the host presses while 阿明 talks: a clear busy answer on the button, never silent
  await hold(host);
  await host.waitForFunction(() => PTT.btn === 'busy');
  assert.match(await btnText(host), /阿明講緊，等等/);
  await shot(host, 'ptt-busy');
  // 阿明 lets go; the host is still holding, so it gets the channel (a radio transmits once it is clear)
  await letGo(a);
  await host.waitForFunction(() => PTT.turn > 0, null, { timeout: 5000 });
  const hostId = await id(host);
  await a.waitForFunction(i => PTT.holder === i, hostId);
  await letGo(host);
  await allFree(code, all);
  // the log: one turn each, closed
  for (const p of all) assert.ok(await p.evaluate(() => PTT.log.length === 1 && PTT.log[0].end > PTT.log[0].start), p.nick);
  noErrors(all);
});

test('four players: two press at once, one talks and three see it; every station keeps its controls clear of the button', async () => {
  const { code, all, host, clients: [a, b, c] } = await room(['waiter', 'bar', 'kitchen', 'till']);
  // the button must not cover any of the station's own controls, on any of the four stations (the till with a slip up)
  await a.evaluate(() => barKey('pot'));   // open the shop: boil, steep and pull the tea from the (remote) bar
  // (the pot is the bar's own: it is watched on the bar's phone; the shop opening is the referee's)
  await a.waitForFunction(() => G.pot.st === 'pull', null, { timeout: 15000 });
  for (let i = 0; i < 8 && await a.evaluate(() => G.pot.st !== 'ready'); i++) { await a.evaluate(() => barKey('pot')); await sleep(150); }
  await host.waitForFunction(() => G.phase === 'open', null, { timeout: 5000 });
  await roomFastForward(host, 30);
  await c.waitForFunction(() => G.cur && document.querySelector('[data-strike]'), null, { timeout: 20000 });
  for (const p of all) {
    const hits = await p.evaluate(() => {
      const strip = document.getElementById('ptt'), r = strip.getBoundingClientRect();
      const over = (x, y) => !(x.right <= y.left || y.right <= x.left || x.bottom <= y.top || y.bottom <= x.top);
      const bad = [...document.querySelectorAll('#app button, #app [role=button], #app [data-strike], #app canvas, #pad *, #barPad *, #kitPad *')]
        .filter(e => !strip.contains(e) && e.offsetParent && e.getClientRects().length)
        .map(e => [e, e.getBoundingClientRect()]).filter(([, q]) => q.width && over(r, q))
        .map(([e]) => e.id || e.className || e.textContent.slice(0, 10));
      // the strip is the bottom row of the game column, under everything else, and every station panel fits above it.
      // (#app itself sits 8 px low: body keeps the browser's default 8 px margin, a pre-existing quirk, not the strip's.)
      const app = document.getElementById('app').getBoundingClientRect();
      if (Math.abs(r.bottom - app.bottom) > 0.5 || r.height < 44 || r.top > innerHeight - 44) bad.push('strip not at the bottom ' + JSON.stringify(r));
      for (const id of ['floorWrap', 'doorWrap', 'till', 'pad', 'barView', 'barPad', 'kitView', 'kitPad']) {
        const e = document.getElementById(id);
        if (e && !e.hidden && e.offsetParent && e.getBoundingClientRect().bottom > r.top + 0.5) bad.push(id + ' runs under the strip');
      }
      return bad;
    });
    assert.deepEqual(hits, [], p.nick + ' (' + await p.evaluate(() => G.station) + ') controls under the talk strip');
    await shot(p, 'ptt-hud-' + await p.evaluate(() => G.station));
  }
  await Promise.all([hold(b), hold(c)]);
  await sleep(1500);
  const states = await Promise.all([b, c].map(p => p.evaluate(() => PTT.btn)));
  assert.equal(states.filter(s => s === 'talking').length, 1, 'exactly one talks: ' + states);
  assert.equal(states.filter(s => s === 'busy').length, 1, 'the other is told busy: ' + states);
  const talker = states[0] === 'talking' ? b : c, tId = await id(talker);
  for (const p of all) await p.waitForFunction(i => PTT.holder === i, tId);
  for (const p of [all[0], a]) {
    assert.equal(await btn(p), 'other');
    await p.waitForFunction(() => PTT.stats.rx >= 5, null, { timeout: 5000 });
  }
  await Promise.all([letGo(b), letGo(c)]);
  await allFree(code, all);
  noErrors(all);
});

test('holder leaves mid-turn: closing the page, or leaving the room, frees the floor at once', async () => {
  const { code, all, host, clients: [a, b] } = await room(['waiter', 'bar', 'kitchen']);
  await hold(a);
  await talking(a);
  await host.waitForFunction(i => PTT.holder === i, await id(a));
  const t0 = Date.now();
  // the page goes away with the finger still down: its socket closes (the room frees the floor at once) or, if the
  // engine drops it without a close frame, its keep-alive stops (freed after 2.5 s)
  await a.close();
  await host.waitForFunction(() => PTT.holder === null, null, { timeout: 6000 });
  assert.ok(Date.now() - t0 < 2500 + 1500, 'freed in ' + (Date.now() - t0) + ' ms');
  await allFree(code, all);

  await hold(b);
  await talking(b);
  await host.waitForFunction(i => PTT.holder === i, await id(b));
  await b.evaluate(() => netLeave());
  await host.waitForFunction(() => PTT.holder === null, null, { timeout: 3000 });
  await b.mouse.up();
  assert.equal(await b.evaluate(() => PTT.bound), false);
  assert.ok(await b.locator('#ptt').isHidden(), 'no talk button outside a room');
  await allFree(code, all);
  noErrors(all);
});

test('network drop mid-turn: a closed link frees it at once, a silent one within 2.5 s; the talker\'s button says so', async () => {
  const { code, all, host, clients: [a] } = await room(['waiter', 'bar']);
  await hold(a);
  await talking(a);
  await host.waitForFunction(i => PTT.holder === i, await id(a));
  let t0 = Date.now();
  await a.evaluate(() => __netDrop());
  await host.waitForFunction(() => PTT.holder === null, null, { timeout: 5000 });
  assert.ok(Date.now() - t0 < 2500, 'drop: freed in ' + (Date.now() - t0) + ' ms');
  await a.waitForFunction(() => PTT.btn === 'link');
  await letGo(a);
  await a.evaluate(() => __netRestore());
  await a.waitForFunction(() => NET.t && NET.t.up, null, { timeout: 15000 });
  await allFree(code, all);

  await hold(a);
  await talking(a);
  await host.waitForFunction(i => PTT.holder === i, await id(a));
  t0 = Date.now();
  await a.evaluate(() => __netSilence());
  await host.waitForFunction(() => PTT.holder === null, null, { timeout: 8000 });
  const took = Date.now() - t0;
  assert.ok(took < 2500 + 2000, 'silence: freed in ' + took + ' ms');
  await letGo(a);
  await a.evaluate(() => __netRestore());
  await allFree(code, [host], 8000);
  noErrors(all);
});

test('forced release at the 12 s limit, with the limit tone; the talker must let go and press again', { timeout: 60000 }, async () => {
  const { code, all, host, clients: [a] } = await room(['waiter', 'bar']);
  await hold(a);
  await talking(a);
  const t0 = Date.now();
  await host.waitForFunction(i => PTT.holder === i, await id(a));
  await a.waitForFunction(() => PTT.btn === 'limit', null, { timeout: 16000 });
  const took = Date.now() - t0;
  assert.ok(took > 10500 && took < 14000, 'limit after ' + took + ' ms');
  assert.match(await btnText(a), /夠鐘/);
  await shot(a, 'ptt-limit');
  await host.waitForFunction(() => PTT.holder === null);
  const rx = await host.evaluate(() => PTT.stats.rx);
  await sleep(600);
  assert.ok(await host.evaluate(r => PTT.stats.rx <= r + 1, rx), 'no audio after the limit while the finger stays down');
  assert.equal(await a.evaluate(() => PTT.turn), 0);
  await letGo(a);
  await a.waitForFunction(() => PTT.btn === 'idle');
  await hold(a);
  await talking(a);
  await letGo(a);
  await allFree(code, all);
  noErrors(all);
});

test('press spam: rapid press / release on two phones at once never leaves the floor stuck', async () => {
  const { code, all, clients: [a, b] } = await room(['waiter', 'bar', 'kitchen']);
  const spam = async p => {
    const [x, y] = await center(p);
    await p.mouse.move(x, y);
    for (let i = 0; i < 25; i++) { await p.mouse.down(); await sleep(10 + (i * 17) % 60); await p.mouse.up(); await sleep((i * 7) % 30); }
  };
  await Promise.all([spam(a), spam(b)]);
  await allFree(code, all, 2500 + 3000);
  // and the channel still works afterwards (possibly after the room's spam limit runs out)
  await sleep(3000);
  await hold(a);
  await talking(a);
  await letGo(a);
  await allFree(code, all);
  noErrors(all);
});

test('page hidden or app switched while holding: the turn is given back at once, not by the timeout', async () => {
  const { code, all, host, clients: [a] } = await room(['waiter', 'bar']);
  for (const how of ['visibility', 'blur']) {
    await hold(a);
    await talking(a);
    await host.waitForFunction(i => PTT.holder === i, await id(a));
    const t0 = Date.now();
    await a.evaluate(h => {
      if (h === 'blur') { dispatchEvent(new Event('blur')); return; }
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, how);
    await host.waitForFunction(() => PTT.holder === null, null, { timeout: 3000 });
    assert.ok(Date.now() - t0 < 1500, how + ': released in ' + (Date.now() - t0) + ' ms (the 2.5 s timeout was not needed)');
    await a.evaluate(() => { delete document.visibilityState; delete document.hidden; });
    await letGo(a);
    await allFree(code, all);
  }
  noErrors(all);
});

test('audio from a phone that does not hold the floor goes nowhere; mute stops the audio but not the name', async () => {
  const { code, all, host, clients: [a, b] } = await room(['waiter', 'bar', 'kitchen']);
  await hold(a);
  await talking(a);
  await b.waitForFunction(() => PTT.stats.rx >= 3, null, { timeout: 5000 });
  // b forges frames for a's turn: the room drops them
  const before = await host.evaluate(() => PTT.stats.rx);
  const turn = await a.evaluate(() => PTT.turn);
  await letGo(a);
  await allFree(code, all);
  const afterA = await host.evaluate(() => PTT.stats.rx);
  await b.evaluate(t => { for (let i = 0; i < 10; i++) { const f = new Uint8Array(647); f[0] = 0xa1; new DataView(f.buffer).setUint32(1, t, true); NET.t.pttSend(f.buffer); } }, turn);
  await sleep(800);
  assert.equal(await host.evaluate(() => PTT.stats.rx), afterA, 'forged frames dropped by the room');
  assert.ok(afterA > before);
  // mute on the host: no audio arrives, the name still shows
  await host.click('#pttMute');
  await host.waitForFunction(() => PTT.muted);
  await sleep(300);
  const rxM = await host.evaluate(() => PTT.stats.rx);
  await hold(a);
  await talking(a);
  await host.waitForFunction(i => PTT.holder === i, await id(a));
  assert.match(await btnText(host), /阿明講緊（你靜咗音）/);
  await sleep(1200);
  assert.equal(await host.evaluate(() => PTT.stats.rx), rxM, 'muted: the room sends no audio');
  assert.ok(await b.evaluate(() => PTT.stats.rx > 3), 'the others still hear it');
  await letGo(a);
  await allFree(code, all);
  assert.equal(await host.evaluate(() => localStorage.getItem('ckf-ptt-mute')), '1', 'the switch is remembered');
  noErrors(all);
});

test('mic blocked for good: the picture guide on joining and on a press, the button explains, the floor ends free', async () => {
  // the browser refuses at once, without a prompt (blocked for good)
  const deny = () => {
    const err = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = err;
  };
  const host = await player('老闆');
  const a = await player('阿明', { init: deny });
  const code = await hostRoomAs(host, 'waiter');
  await a.click('#coopBtn');
  await a.fill('#roomIn', code);
  await a.click('#joinBtn');
  await a.waitForSelector('#permitGuide', { state: 'visible' });
  assert.equal(await a.evaluate(() => document.getElementById('permitGuide').dataset.kind), 'mic');
  await a.click('#pguideOk');
  await a.waitForFunction(() => NET.meta);
  await a.click('#coop [data-seat="bar"]');
  await host.waitForFunction(() => Object.values(NET.seats).some(x => x.station === 'bar'));
  await host.click('#hostGo');
  await a.waitForFunction(() => G && G.coop && G.running && G.roles[NET.myStation] === 'me', null, { timeout: 10000 });
  await roomDbg(host, { op: 'set', gameSec: 1e6 });   // a shift that never ends (on the room's referee)
  await a.waitForSelector('#pttBtn', { state: 'visible' });
  assert.match(await btnText(a), /瀏覽器封咗個咪/);
  await shot(a, 'ptt-nomic');
  // a press shows the guide again; it never takes the floor without a mic
  await hold(a);
  await a.waitForSelector('#permitGuide', { state: 'visible' });
  await letGo(a);
  await allFree(code, [host, a]);
  await a.click('#pguideOk');
  await hold(a);
  await a.waitForSelector('#permitGuide', { state: 'visible' });
  await letGo(a);
  await allFree(code, [host, a]);
  noErrors([host, a]);
});
