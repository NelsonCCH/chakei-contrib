// Push-to-talk pure parts, without a browser (Node loads the .ts files directly; they import nothing):
// the mu-law codec and frame layout the room checks, the resampler, and the phone's floor client against a model of
// the room, including a random press / release / drop / silence fuzz whose floor must always end free; and the music's
// duck under a voice against a model of an AudioParam's automation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { muEncode, muDecode, packFrame, parseFrame, Downsampler, upsample, FRAME_SAMPLES, AUDIO_MAGIC, HEAD } from '../src/ptt/codec.ts';
import { FloorClient, HOLD_EVERY_MS, SHOW_SLACK_MS } from '../src/ptt/floor.ts';
import { DUCK, duckRamp } from '../src/ptt/duck.ts';

/**
 * An AudioParam's automation timeline as Web Audio runs it (setValueAtTime steps, linearRampToValueAtTime ramps from
 * the previous event, cancelScheduledValues drops events at or after t). `value` is the value at the clock `now`.
 */
class FakeParam {
  constructor(v) { this.ev = [{ t: -1, v, ramp: false }]; this.now = 0; }
  at(t) {
    let prev = this.ev[0];
    for (const e of this.ev.slice(1)) {
      if (e.t <= t) { prev = e; continue; }
      if (e.ramp) return prev.v + (e.v - prev.v) * (t - prev.t) / (e.t - prev.t);
      return prev.v;
    }
    return prev.v;
  }
  get value() { return this.at(this.now); }
  cancelScheduledValues(t) { this.ev = this.ev.filter((e, i) => i === 0 || e.t < t); }
  setValueAtTime(v, t) { this.ev.push({ t, v, ramp: false }); }
  linearRampToValueAtTime(v, t) { this.ev.push({ t, v, ramp: true }); }
}

test('music duck: down under a voice, held, then back, by ramps only; a voice inside the fade turns it round smoothly', () => {
  const FULL = 0.9, low = FULL * DUCK.depth, g = new FakeParam(FULL), dt = 0.001;
  const sample = (a, b) => { const r = [], n = Math.round((b - a) / dt); for (let i = 0; i <= n; i++) r.push(g.at(a + (b - a) * i / n)); return r; };
  const steepest = xs => Math.max(...xs.slice(1).map((x, i) => Math.abs(x - xs[i])));
  // the fades sit in their target windows: down 80-150 ms, hold 400-700 ms, back 300-500 ms; a real duck (-6 dB or more)
  assert.ok(DUCK.down >= 0.08 && DUCK.down <= 0.15 && DUCK.hold >= 0.4 && DUCK.hold <= 0.7 && DUCK.up >= 0.3 && DUCK.up <= 0.5);
  assert.ok(DUCK.depth > 0 && DUCK.depth <= 0.5);
  // a voice from 1.0 s to 3.0 s
  g.now = 1; duckRamp(g, 1, true, FULL);
  g.now = 3; duckRamp(g, 3, false, FULL);
  const before = sample(0, 1), down = sample(1, 1 + DUCK.down), under = sample(1 + DUCK.down, 3 + DUCK.hold), back = sample(3 + DUCK.hold, 3 + DUCK.hold + DUCK.up);
  assert.ok(before.every(v => Math.abs(v - FULL) < 1e-9), 'full before the voice');
  assert.ok(Math.abs(g.at(1 + DUCK.down) - low) < 1e-9, 'down to the duck level at the end of the fade');
  assert.ok(under.every(v => Math.abs(v - low) < 1e-9), 'held down through the voice and the hold after it');
  assert.ok(Math.abs(g.at(3 + DUCK.hold + DUCK.up) - FULL) < 1e-9 && Math.abs(g.at(10) - FULL) < 1e-9, 'all the way back');
  assert.ok(g.at(3 + DUCK.hold + DUCK.up / 2) > low + 0.01 && g.at(3 + DUCK.hold + DUCK.up / 2) < FULL - 0.01, 'halfway through the fade back');
  // no jump: per millisecond the gain moves no more than a straight fade over each window allows
  const maxDown = (FULL - low) / DUCK.down * dt * 1.01, maxUp = (FULL - low) / DUCK.up * dt * 1.01;
  assert.ok(steepest(down) <= maxDown, 'fade down is a ramp');
  assert.ok(steepest(back) <= maxUp, 'fade back is a ramp');
  assert.ok(steepest(sample(0, 10)) <= maxDown, 'no step anywhere');

  // the next talker starts while the music is fading back: it turns round from where it is, no step
  const t2 = 3 + DUCK.hold + DUCK.up / 2;
  // (the past is already played: only the value at t2 and what follows are compared)
  g.now = t2; const was = g.value; duckRamp(g, t2, true, FULL);
  const turn = sample(t2, t2 + DUCK.down + 0.05);
  assert.ok(Math.abs((turn[0] ?? NaN) - was) < 1e-9 && steepest(turn) <= maxDown, 'turns round with no step');
  assert.ok(Math.abs(g.at(t2 + DUCK.down + 0.01) - low) < 1e-9, 'down again');
  // and a voice that ends and starts again inside the hold never lets the music up
  g.now = 6; duckRamp(g, 6, false, FULL);
  g.now = 6.2; duckRamp(g, 6.2, true, FULL);
  assert.ok(sample(6, 7).every(v => Math.abs(v - low) < 1e-9), 'stays down across a quick reply');
});

test('mu-law: G.711 reference points, round trip within the codec\'s step, monotonic', () => {
  assert.equal(muEncode(0), 0xff);
  assert.equal(muEncode(1), 0x80);
  assert.equal(muEncode(-1), 0x00);
  let prev = -2;
  for (let i = -1000; i <= 1000; i++) {
    const x = i / 1000, y = muDecode(muEncode(x));
    assert.ok(Math.abs(y - x) <= Math.max(0.002, Math.abs(x) * 0.07), `x=${x} y=${y}`);
    assert.ok(y >= prev - 1e-9, 'monotonic at ' + x);
    prev = y;
  }
  for (let u = 0; u < 256; u++) assert.equal(muEncode(muDecode(u)), u === 0x7f ? 0xff : u, 'byte ' + u);   // 0x7f is "-0"
});

test('frame layout: magic, turn (u32 LE), number (u16 LE), samples; what the room checks', () => {
  const s = new Float32Array(FRAME_SAMPLES).map((_, i) => Math.sin(i / 7) * 0.5);
  const buf = packFrame(0xdeadbeef, 70000, s), v = new DataView(buf);
  assert.equal(buf.byteLength, HEAD + FRAME_SAMPLES);
  assert.equal(v.getUint8(0), AUDIO_MAGIC);
  assert.equal(v.getUint32(1, true), 0xdeadbeef);
  assert.equal(v.getUint16(5, true), 70000 & 0xffff);
  const f = parseFrame(buf);
  assert.equal(f.turn, 0xdeadbeef);
  assert.equal(f.samples.length, FRAME_SAMPLES);
  for (let i = 0; i < s.length; i++) assert.ok(Math.abs(f.samples[i] - s[i]) < 0.03);
  assert.equal(parseFrame(new ArrayBuffer(3)), null);
  const bad = new Uint8Array(buf.slice(0)); bad[0] = 0; assert.equal(parseFrame(bad.buffer), null);
});

/** Peak amplitude of the middle of a signal (skips the filters' start-up). */
const peak = a => { let m = 0; for (let i = Math.floor(a.length / 4); i < a.length * 3 / 4; i++) m = Math.max(m, Math.abs(a[i])); return m; };
function through(inRate, freq, sec, chunk) {
  const d = new Downsampler(inRate), n = Math.round(inRate * sec), out = [];
  for (let i = 0; i < n; i += chunk) {
    const c = new Float32Array(Math.min(chunk, n - i)).map((_, k) => Math.sin(2 * Math.PI * freq * (i + k) / inRate) * 0.8);
    out.push(...d.push(c));
  }
  return Float32Array.from(out);
}

test('downsampler: 48 / 44.1 kHz to 8 kHz across odd chunk sizes; voice kept, high tones cut', () => {
  for (const rate of [48000, 44100]) {
    for (const chunk of [128, 1024, 333]) {
      const y = through(rate, 440, 1, chunk);
      assert.ok(Math.abs(y.length - 8000) <= 2, `${rate}/${chunk}: ${y.length} samples for 1 s`);
      assert.ok(peak(y) > 0.7 && peak(y) < 0.85, `440 Hz kept: ${peak(y)}`);
      // 440 Hz: ~880 zero crossings per second
      let zc = 0; for (let i = 2001; i < 6000; i++) if ((y[i - 1] < 0) !== (y[i] < 0)) zc++;
      assert.ok(Math.abs(zc - 440) <= 4, 'frequency kept: ' + zc);
    }
    assert.ok(peak(through(rate, 7000, 1, 512)) < 0.25, '7 kHz (would alias to 1 kHz) is cut');
  }
});

test('upsample: 8 kHz frame to the playback rate, endpoints and length', () => {
  const s = new Float32Array([0, 1, 0, -1]);
  const u = upsample(s, 48000);
  assert.equal(u.length, 24);
  assert.equal(u[0], 0);
  assert.ok(Math.abs(u[6] - 1) < 1e-6);
  assert.ok(Math.abs(u[3] - 0.5) < 1e-6);
  assert.equal(upsample(new Float32Array(FRAME_SAMPLES), 44100).length, Math.round(FRAME_SAMPLES * 44100 / 8000));
});

const sends = fx => fx.filter(f => f.send).map(f => f.send);
const has = (fx, k, v) => fx.some(f => k in f && (v === undefined || f[k] === v));

test('floor client: press, grant, keep-alive every second, release; a grant after the finger left is given back', () => {
  const c = new FloorClient('me', () => '阿明');
  let fx = c.press();
  assert.deepEqual(sends(fx), [{ t: 'floorReq', name: '阿明' }]);
  assert.ok(has(fx, 'mic'));
  assert.equal(c.btn(), 'asking');
  fx = c.floor({ t: 'floor', holder: 'me', name: '阿明', turn: 7, left: 12000 }, 0);
  assert.ok(has(fx, 'stream', 7) && has(fx, 'beep', 'key'));
  assert.equal(c.btn(), 'talking');
  assert.deepEqual(sends(c.tick(500)), []);
  assert.deepEqual(sends(c.tick(HOLD_EVERY_MS)), [{ t: 'floorHold', turn: 7 }]);
  assert.deepEqual(sends(c.tick(HOLD_EVERY_MS + 300)), []);
  assert.deepEqual(sends(c.tick(2 * HOLD_EVERY_MS)), [{ t: 'floorHold', turn: 7 }]);
  fx = c.release();
  assert.equal(Object.keys(fx[0])[0], 'stop', 'the last part-frame goes before the release');
  assert.deepEqual(sends(fx), [{ t: 'floorRelease', turn: 7 }]);
  assert.ok(has(fx, 'beep', 'roger'));
  assert.equal(c.turn, 0);
  assert.deepEqual(c.release(), [], 'a second release does nothing');
  // pressed and let go before the room answered: the grant is given back at once, nothing streams
  c.press(); c.release();
  fx = c.floor({ t: 'floor', holder: 'me', name: '阿明', turn: 8, left: 12000 }, 3000);
  assert.deepEqual(sends(fx), [{ t: 'floorRelease', turn: 8 }]);
  assert.ok(!has(fx, 'stream'));
});

test('floor client: busy, auto re-ask when the channel clears, the limit, a lost floor, the link dropping', () => {
  const c = new FloorClient('me', () => '我');
  c.floor({ t: 'floor', holder: 'x', name: '阿強', turn: 3, left: 12000 }, 0);
  assert.equal(c.btn(), 'idle');
  let fx = c.press();
  assert.equal(c.btn(), 'busy', 'busy shown at once from what the phone knows');
  fx = c.no({ t: 'floorNo', why: 'busy', holder: 'x', name: '阿強', turn: 3, left: 9000 }, 100);
  assert.ok(has(fx, 'beep', 'busy'));
  assert.equal(c.refused.name, '阿強');
  fx = c.floor({ t: 'floor', holder: null, name: '', turn: 3, left: 0, why: 'release' }, 2000);
  assert.ok(has(fx, 'beep', 'roger'), 'the listener hears the roger beep');
  assert.deepEqual(sends(fx), [{ t: 'floorReq', name: '我' }], 'still holding: asks again');
  c.floor({ t: 'floor', holder: 'me', name: '我', turn: 4, left: 12000 }, 2100);
  assert.equal(c.btn(), 'talking');
  fx = c.floor({ t: 'floor', holder: null, name: '', turn: 4, left: 0, why: 'limit' }, 14100);
  assert.ok(has(fx, 'stop') && has(fx, 'beep', 'limit'));
  assert.equal(c.btn(), 'limit');
  // a stale grant while the finger is still down after the limit: given back, the player must press again
  fx = c.floor({ t: 'floor', holder: 'me', name: '我', turn: 5, left: 12000 }, 14200);
  assert.deepEqual(sends(fx), [{ t: 'floorRelease', turn: 5 }]);
  c.release();
  assert.equal(c.btn(), 'idle');
  c.press();
  c.floor({ t: 'floor', holder: 'me', name: '我', turn: 6, left: 12000 }, 20000);
  fx = c.linkDown();
  assert.ok(has(fx, 'stop'));
  assert.equal(c.btn(), 'link');
  assert.equal(c.holder, null);
  c.release();
  assert.equal(c.btn(), 'idle');
  fx = c.no({ t: 'floorNo', why: 'slow', holder: null, name: '', turn: 6, left: 0 }, 30000);
  assert.deepEqual(fx, [], 'a refusal after the finger left changes nothing');
});

test('floor client: local safety nets: a turn past its end stops by itself; a floor never heard to end is forgotten', () => {
  const c = new FloorClient('me', () => '我');
  c.press();
  c.floor({ t: 'floor', holder: 'me', name: '我', turn: 9, left: 12000 }, 0);
  let fx = c.tick(12400);
  assert.equal(c.turn, 9, 'within the slack');
  fx = c.tick(12600);
  assert.ok(has(fx, 'stop') && has(fx, 'beep', 'limit'));
  assert.deepEqual(sends(fx), [{ t: 'floorRelease', turn: 9 }]);
  c.release();
  const d = new FloorClient('me', () => '我');
  d.floor({ t: 'floor', holder: 'x', name: '阿強', turn: 1, left: 5000 }, 0);
  d.tick(5000 + SHOW_SLACK_MS - 10);
  assert.ok(d.holder);
  d.tick(5000 + SHOW_SLACK_MS + 10);
  assert.equal(d.holder, null);
});

/**
 * A model of the room's floor (worker/index.ts): grant if free, busy otherwise, release only with the current turn,
 * free after FLOOR_SILENT_MS without a keep-alive or at FLOOR_MAX_MS, and on a holder's link drop.
 */
function roomModel() {
  const R = { floor: null, turn: 0, out: [] };
  R.recv = (who, m, now) => {
    if (m.t === 'floorReq') {
      if (R.floor && R.floor.id !== who) R.out.push([who, { t: 'floorNo', why: 'busy', holder: R.floor.id, name: R.floor.id, turn: R.floor.turn, left: R.floor.until - now }]);
      else if (!R.floor) { R.floor = { id: who, turn: ++R.turn, until: now + 12000, hold: now }; R.bcast(now); }
      else R.out.push([who, R.msg(now)]);
    } else if (m.t === 'floorHold') { if (R.floor && R.floor.id === who && m.turn === R.floor.turn) R.floor.hold = now; else R.out.push([who, R.msg(now)]); }
    else if (m.t === 'floorRelease') { if (R.floor && R.floor.id === who && m.turn === R.floor.turn) R.free('release', now); }
  };
  R.msg = (now, why) => R.floor ? { t: 'floor', holder: R.floor.id, name: R.floor.id, turn: R.floor.turn, left: R.floor.until - now } : { t: 'floor', holder: null, name: '', turn: R.turn, left: 0, ...(why ? { why } : {}) };
  R.bcast = (now, why) => { R.out.push(['*', R.msg(now, why)]); };
  R.free = (why, now) => { R.floor = null; R.bcast(now, why); };
  R.tick = now => { if (R.floor && now >= R.floor.until) R.free('limit', now); else if (R.floor && now - R.floor.hold >= 2500) R.free('silent', now); };
  R.gone = (who, now) => { if (R.floor && R.floor.id === who) R.free('gone', now); };
  return R;
}

test('fuzz: four phones and the room model, random presses, releases, drops and silences; the floor always ends free', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  for (let run = 0; run < 300; run++) {
    const R = roomModel(), ids = ['a', 'b', 'c', 'd'];
    const P = ids.map(id => ({ id, c: new FloorClient(id, () => id), up: true, silent: false, streams: 0 }));
    const deliver = now => {
      // messages arrive in order; a phone whose link is down or silent hears nothing
      while (R.out.length) {
        const [to, m] = R.out.shift();
        for (const p of P) if ((to === '*' || to === p.id) && p.up && !p.silent) run1(p, m.t === 'floor' ? p.c.floor(m, now) : p.c.no(m, now), now);
      }
    };
    const run1 = (p, fx, now) => {
      for (const f of fx) {
        if (f.send && p.up && !p.silent) R.recv(p.id, f.send, now);
        if ('stream' in f) { p.streams++; assert.equal(p.streams, 1, 'one stream at a time'); }
        if (f.stop) p.streams = Math.max(0, p.streams - 1);
      }
      // the phone never sends audio without a finger on the button
      assert.ok(!p.c.turn || p.c.pressed, 'turn without a finger');
    };
    let now = 0;
    for (let step = 0; step < 200; step++) {
      now += Math.floor(rnd() * 400);
      const p = P[Math.floor(rnd() * 4)], r = rnd();
      if (r < 0.3) run1(p, p.c.press(), now);
      else if (r < 0.6) run1(p, p.c.release(), now);
      else if (r < 0.65 && p.up) { p.up = false; R.gone(p.id, now); run1(p, p.c.linkDown(), now); }
      else if (r < 0.7 && !p.up) { p.up = true; p.silent = false; }
      else if (r < 0.73) p.silent = true;   // half-open: the room hears nothing from it, it hears nothing
      else if (r < 0.76) p.silent = false;
      for (const q of P) run1(q, q.c.tick(now), now);
      R.tick(now);
      deliver(now);
    }
    // every finger lifts; within the limit + silence + slack the floor is free in the room and on every phone
    for (const p of P) { run1(p, p.c.release(), now); p.up = true; p.silent = false; }
    deliver(now);
    for (let t = 0; t < 16000; t += 200) { now += 200; for (const q of P) run1(q, q.c.tick(now), now); R.tick(now); deliver(now); }
    assert.equal(R.floor, null, 'run ' + run + ': room floor free');
    for (const p of P) { assert.equal(p.c.turn, 0); assert.equal(p.streams, 0, 'stream stopped'); assert.equal(p.c.holder, null, 'run ' + run + ' ' + p.id + ' still shows a talker'); }
  }
});
