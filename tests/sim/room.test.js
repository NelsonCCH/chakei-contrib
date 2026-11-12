// The room's referee on its own: core/coop/room.ts, what the room's Durable Object runs. Each
// room is its own copy of the core (worker/room-core.js is the same bundle wrapped in a factory), the shift plays on the
// room's timer with no messages at all, and a restart carries on from the last save. The co-op sims (coop.js) run
// whole shifts with phones against this same code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore } from './core.js';

const WAKE_MS = 50;
const start = (C, seed, sent) => {
  const sh = C.roomShiftOf({ slot: 'lunch', diff: 'pro', extra: [], port: { rank: 2, rlv: {}, names: {} } }, {});
  assert.ok(sh, 'the start message is accepted');
  C.roomStart({ room: 'R' + seed, send: e => sent.push(e), now: 0, round: 1, seed }, sh);
};
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(q => [q, x[q]])) : x);

test('two rooms in one Worker share nothing (one core per room)', () => {
  const a = freshCore(), b = freshCore(), sa = [], sb = [];
  start(a, 1, sa); start(b, 2, sb);
  for (let now = WAKE_MS; now <= 20000; now += WAKE_MS) a.roomAdvance(now);
  assert.ok(a.G.t > 19, 'room A played 20 s: ' + a.G.t);
  assert.equal(b.G.t, 0, 'room B did not move');
  assert.notEqual(a.referee(), b.referee());
  assert.equal(a.referee().headless, true, 'the room is never a player');
  assert.deepEqual(Object.keys(a.referee().players), [], 'no player in an empty room');
});

test('with nobody sending anything the room plays the whole shift on its timer and closes the books', () => {
  const C = freshCore(), sent = [];
  start(C, 3, sent);
  let now = 0, wakes = 0, cpu = 0;
  while (now < 400000) {
    now += WAKE_MS; wakes++;
    const t0 = performance.now(); C.roomAdvance(now); cpu += performance.now() - t0;
    if (C.roomStatus().closed) break;
  }
  const st = C.roomStatus();
  assert.equal(st.running, false, 'the bell rang');
  assert.equal(st.closed, true, 'the books closed');
  assert.ok(C.G.served > 0, 'the computer served customers: ' + C.G.served);
  const keys = sent.filter(e => e.b.k === 'key').length, ticks = sent.filter(e => e.b.k === 'tick').length;
  assert.ok(ticks > 4 * 150, `ticks ${ticks} went out with no phone asking (keyframes: ${keys}, sent to phones that join)`);
  // the Durable Object's cost: CPU per wake, here on Node (workerd runs the same JS)
  console.log(`  room CPU: ${(cpu / wakes).toFixed(3)} ms per ${WAKE_MS} ms wake, ${wakes} wakes, ${cpu.toFixed(0)} ms per shift`);
  assert.ok(cpu / wakes < 5, 'a wake costs well under the Durable Object\'s CPU budget');
});

test('a restart carries the shift on from the last save (a JSON round trip, as the storage does it)', () => {
  const C = freshCore(), sent = [];
  start(C, 4, sent);
  for (let now = WAKE_MS; now <= 60000; now += WAKE_MS) C.roomAdvance(now);
  const saved = JSON.parse(JSON.stringify(C.roomSave()));
  assert.ok(JSON.stringify(saved).length < 64 * 1024, 'the save fits one storage value');
  const was = canon(C.sharedOf(C.G));
  const D = freshCore(), sent2 = [];
  D.roomRestore({ room: 'R4', send: e => sent2.push(e), now: 60000, round: saved.round, seed: saved.seed }, D.roomShiftOf(saved.sh, saved.sh.seated), saved.key);
  assert.equal(canon(D.sharedOf(D.G)), was, 'the restored shop is the saved one');
  assert.ok(D.referee().refEpoch > C.referee().refEpoch, 'a new referee epoch: phones resend what the save lacks');
  for (let now = 60000 + WAKE_MS; now < 400000 && !D.roomStatus().closed; now += WAKE_MS) D.roomAdvance(now);
  assert.equal(D.roomStatus().closed, true, 'the restarted room finishes the shift');
});
