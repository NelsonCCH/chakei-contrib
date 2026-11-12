// The co-op protocol's validators (src/core/proto/validate.ts): every good
// message of every kind passes, and seeded junk (random values, every message with one field broken, deep nonsense)
// is refused without throwing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore, mulberry32 } from './core.js';

const C = freshCore();
const isEmptyRec = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length;
const env = (b, from = 'p1') => ({ p: 1, room: 'ABCD', from, round: 1, seq: 3, at: 12.5, b });
const caps = { z: true, cs: true, ptt: false };
const view = { id: 'bar', kind: 'bar', driver: { type: 'computer' }, epoch: 2, away: false, coverReason: 'empty', last: null };
const shared = { t: 1, rt: 1, running: true, paused: false, groups: [], payQ: [], tables: [], revenue: 0, mistakes: 0, angry: 0, slot: 'lunch', phase: 'open' };
const key = { rseq: 4, round: 1, refEpoch: 0, seed: 9, shared, seats: { bar: view }, players: { p1: { name: '阿明', role: 'player', build: 'b', caps, online: true } }, acks: { p1: 3 }, durable: { p1: 2 } };
const blob = { kind: 'bar', v: 1, s: { pot: {} } };
const PHONE = [
  { k: 'hello', proto: 1, build: 'x', caps, role: 'player', name: '阿明', player: 'p1', resume: null },
  { k: 'hello', proto: 1, build: 'x', caps, role: 'viewer', name: 'tv', player: 'tv1', resume: { round: 2, seq: 5, ack: 4 } },
  { k: 'claim', seat: 'bar' }, { k: 'release', seat: 'till' },
  { k: 'res', seat: 'bar', epoch: 1, r: { k: 'lineDone', gid: 4, dest: 'bar', i: 0, made: { t: 'cup', cup: 'hot', ing: { 茶: 1 } } } },
  { k: 'res', seat: 'kitchen', epoch: 1, r: { k: 'lineDone', gid: 4, dest: 'kitchen', i: 1, made: { t: 'plate', tokens: ['通粉', '火腿'] } } },
  { k: 'res', seat: 'waiter', epoch: 1, r: { k: 'order', gid: 4, keys: ['k熱奶茶'], peeked: false } },
  { k: 'res', seat: 'waiter', epoch: 1, r: { k: 'seat', gid: 4, table: 2 } },
  { k: 'res', seat: 'waiter', epoch: 1, r: { k: 'slipOpen', gid: 4, regSeen: true } },
  { k: 'res', seat: 'till', epoch: 1, r: { k: 'tillPaid', cid: 4, charged: 7 } },
  { k: 'res', seat: 'till', epoch: 1, r: { k: 'tillMiss', cid: 4, loss: 0 } },
  { k: 'res', seat: 'till', epoch: 1, r: { k: 'tillTake', cid: 4 } },
  { k: 'res', seat: 'bar', epoch: 1, r: { k: 'potReady' } },
  { k: 'res', seat: 'runner', epoch: 1, r: { k: 'carried', refs: [{ gid: 1, dest: 'kitchen', i: 0 }], table: 3 } },
  { k: 'res', seat: 'roast', epoch: 1, r: { k: 'walkout', gid: 7, i: 0 } },
  { k: 'res', seat: 'takeaway', epoch: 1, r: { k: 'packed', gid: 7, stars: 3, tip: 4.5 } },
  { k: 'res', seat: 'takeaway', epoch: 1, r: { k: 'remake', gid: 7, i: 1 } },
  { k: 'focus', seat: 'waiter', board: false, sheet: true },
  { k: 'status', seats: { bar: { inputs: 3, waiting: 2, load: .5, ckpt: blob } } },
  { k: 'away', why: 'pagehide' }, { k: 'back', why: 'hidden' },
  { k: 'handover', seat: 'bar', epoch: 2, state: blob },
  { k: 'pause', on: true }, { k: 'resync', from: 10 },
  { k: 'floorReq' }, { k: 'floorHold', turn: 2 }, { k: 'floorRelease', turn: 2 }, { k: 'nudge', seat: 'bar', kind: 'help' },
];
const REF = [
  { k: 'welcome', you: 'p1', key }, { k: 'reject', reason: 'proto', newer: true },
  { k: 'tick', t: 3, rt: 3, running: true, paused: false, scale: 1, acks: { p1: 2 }, rseq: 7, round: 1 },
  { k: 'ev', rseq0: 1, list: [{ e: 'left', gid: 3 }, { e: 'fx', to: 'bar', fx: { k: 'say', role: 'bar', msg: 'x' } }, { e: 'driver', seat: 'bar', driver: { type: 'player', player: 'p1' }, epoch: 3, why: 'claim' }, { e: 'tillNext', to: 'till', cust: { id: 4 } }, { e: 'end' }] },
  { k: 'keyframe', key }, { k: 'grant', seat: 'bar', epoch: 3, state: blob }, { k: 'grant', seat: 'bar', epoch: 3, state: null },
  { k: 'revoke', seat: 'bar', epoch: 3, why: 'quiet' }, { k: 'nack', player: 'p1', seq: 4, reason: 'closed' },
  { k: 'floor', holder: null, turn: 0, until: 0, busyFor: 0 },
];

test('every good message passes its validator', () => {
  for (const b of PHONE) assert.ok(C.isPhoneEnv(env(b)), JSON.stringify(b));
  for (const b of REF) assert.ok(C.isRefEnv(env(b, 'ref')), JSON.stringify(b));
  assert.ok(!C.isRefEnv(env(REF[0], 'p1')), 'only the referee sends referee messages');
});

test('fuzz: junk never passes and never throws', () => {
  const r = mulberry32(42);
  const pick = a => a[Math.floor(r() * a.length)];
  const junk = d => {
    const x = r();
    if (d > 3 || x < .15) return pick([null, undefined, 0, -1, 1.5, NaN, Infinity, '', 'x'.repeat(200), true, [], {}, 'bar', 1e9]);
    if (x < .3) return Array.from({ length: Math.floor(r() * 5) }, () => junk(d + 1));
    const o = {}; for (let i = Math.floor(r() * 6); i > 0; i--) o[pick(['k', 'b', 'p', 'from', 'seat', 'r', 'gid', 'made', 't', 'cup', 'ing', 'list', 'e', 'key', 'shared', 'seats'])] = junk(d + 1);
    return o;
  };
  let n = 0;
  for (let i = 0; i < 20000; i++) { const v = junk(0); assert.doesNotThrow(() => { if (C.isPhoneEnv(v) || C.isRefEnv(v)) n++; }); }
  assert.equal(n, 0, 'random junk passed a validator');
  // every good message with one field broken (removed, or replaced with junk) is refused
  const breakOne = (o, path = []) => Object.keys(o).flatMap(k => {
    const out = [];
    for (const bad of [undefined, null, 'x'.repeat(300), -0.5, {}, []]) { const c = structuredClone(o); if (bad === undefined) delete c[k]; else c[k] = bad; out.push([[...path, k], c]); }
    return out;
  });
  for (const [b, check, from] of [...PHONE.map(b => [b, C.isPhoneEnv, 'p1']), ...REF.map(b => [b, C.isRefEnv, 'ref'])]) {
    for (const [path, c] of breakOne(b)) {
      const e = env(c, from);
      let ok; assert.doesNotThrow(() => { ok = check(e); });
      // A few fields accept more than one shape on purpose: resume and a grant's state may be null, a record or a list
      // may be empty (a viewer's status has no seats), and a handover's / status's station state is any value.
      const f = path.at(-1), v = c[f];
      const fine = (v === null && ['resume', 'state', 'holder', 'to', 'last', 'coverReason', 'cup'].includes(f)) || (isEmptyRec(v) && ['seats', 'acks', 'durable', 'players', 'ing', 'cust'].includes(f))
        || (Array.isArray(v) && !v.length && ['keys', 'tokens', 'refs', 'list'].includes(f));
      if (ok) assert.ok(fine, `${b.k}: broken ${path.join('.')} passed: ${JSON.stringify(c).slice(0, 120)}`);
    }
  }
});
