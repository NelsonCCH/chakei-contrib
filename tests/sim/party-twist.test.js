// The 搏盡 card's mishap (core/referee/twist.ts): the night deals it with the card, the
// room's referee plays it in that round's shift, and every phone shows it from the shared state at the same game time.
// Without the card nothing happens: no draw, no extra customers, no announcement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCoop } from './coop.js';
import { freshCore } from './core.js';

const SEATS = ['floor1', 'bar', 'kitchen', 'till'];   // every party shop seats 樓面

/** One party round over the room with four bot phones; what the room's shop and every phone saw of the mishap. */
function round(twist, seed) {
  const seen = { critic: null, big: [], normalMax: null, phoneGroups: {} }, told = {}, fevers = {};
  const r = runCoop({ seed, seats: SEATS, slot: 'breakfast', party: { shop: 'estate', sec: 150, round: 0, twist },
    each: ({ room, phones }) => {
      const G = room.C.G;
      for (const g of G.groups) {
        if (g.critic && !seen.critic) seen.critic = { t: G.t, max: g.max, size: g.size, label: g.label, state: g.state };
        if (g.big && !seen.big.some(b => b.id === g.id)) seen.big.push({ id: g.id, t: G.t, size: g.size, label: g.label });
        if (!g.critic && !g.big && !g.take && g.state === 'queue' && seen.normalMax === null && g.until - G.t > g.max - .05) seen.normalMax = g.max;
      }
      for (const ph of phones) {
        if (!ph.alive) continue;
        ph.C.juiceTick();
        for (const g of ph.C.G.groups) if (g.critic || g.big) (seen.phoneGroups[ph.id] ??= new Set()).add(g.id);
      }
    },
    onFx: (ph, e) => {
      if (e.k === 'twist') (told[ph.id] ??= []).push([e.twist, e.on, ph.C.G.t]);
      if (e.k === 'fever') (fevers[ph.id] ??= []).push([e.on, ph.C.G.t]);
    } });
  return { r, seen, told, fevers };
}

const near = (a, b, eps = .3) => Math.abs(a - b) < eps;

test('搏盡 critic: one 食評家 table at the drawn time, half patience, on the referee and every phone', () => {
  const { r, seen, told } = round('critic', 11);
  assert.deepEqual(r.errs, []);
  const at = r.S.twistAt;
  assert.ok(at >= 150 * .2 && at <= 150 * .6, 'strikes inside its window: ' + at);
  assert.ok(r.S.twistHit, 'it happened');
  assert.ok(seen.critic && near(seen.critic.t, at, .05), 'the critic walked in at twistAt: ' + JSON.stringify(seen.critic));
  assert.equal(seen.critic.label, '食評家'); assert.ok(seen.critic.size <= 2);
  assert.ok(seen.normalMax !== null && near(seen.critic.max, seen.normalMax / 2, .01), `half the queue patience: ${seen.critic.max} vs ${seen.normalMax}`);
  for (const p of r.phones) {
    assert.equal(p.C.G.twistAt, at, p.id + ' has the referee\'s twistAt');
    assert.ok(seen.phoneGroups[p.id]?.size === 1, p.id + ' saw the critic\'s table');
    const s = told[p.id] ?? [];
    assert.equal(s.length, 1, p.id + ' told it once: ' + JSON.stringify(s));
    assert.ok(s[0][0] === 'critic' && s[0][1] && s[0][2] >= at && s[0][2] - at < 2.5, p.id + ' told it when it came: ' + JSON.stringify(s) + ' vs ' + at);
  }
});

test('搏盡 big table: two groups of four walk in together, on every phone', () => {
  const { r, seen, told } = round('bigTable', 12);
  assert.deepEqual(r.errs, []);
  const at = r.S.twistAt;
  assert.equal(seen.big.length, 2, 'two groups: ' + JSON.stringify(seen.big));
  for (const b of seen.big) { assert.equal(b.size, 4); assert.ok(near(b.t, at, .05)); assert.match(b.label, /^八人大枱/); }
  for (const p of r.phones) {
    assert.equal(seen.phoneGroups[p.id]?.size, 2, p.id + ' saw both');
    assert.deepEqual((told[p.id] ?? []).map(x => x[0] + x[1]), ['bigTabletrue'], p.id);
  }
});

test('搏盡 blackout: lights out for 5 s at the same game time on every phone', () => {
  const { r, told } = round('blackout', 13);
  assert.deepEqual(r.errs, []);
  const at = r.S.twistAt, C = r.room.C;
  assert.ok(C.blackoutOn(r.S, at + 1) && !C.blackoutOn(r.S, at - .1) && !C.blackoutOn(r.S, at + C.TWIST.blackSec + .01));
  for (const p of r.phones) {
    const s = told[p.id] ?? [];
    assert.deepEqual(s.map(x => x[1]), [true, false], p.id + ': ' + JSON.stringify(s));
    assert.ok(near(s[0][2], at) && near(s[1][2], at + 5), `${p.id} on time: ${JSON.stringify(s)} vs ${at}`);
  }
});

test('搏盡 rush: the round\'s one fever runs 60 s, told alike on every phone', () => {
  const { r, fevers, told } = round('rush', 14);
  assert.deepEqual(r.errs, []);
  assert.equal(r.room.C.CFG.fever.sec, 60);
  const at = r.S.feverAt;
  for (const p of r.phones) {
    const s = fevers[p.id] ?? [];
    assert.deepEqual(s.map(x => x[0]), [true, false], p.id);
    assert.ok(near(s[0][1], at) && near(s[1][1], at + 60), `${p.id}: ${JSON.stringify(s)} vs ${at}`);
    assert.deepEqual(told[p.id] ?? [], [], 'no other announcement');
  }
});

test('no 搏盡 card: no mishap at all; the same seed gives the same mishap', () => {
  const { r, seen, told, fevers } = round(null, 11);
  assert.deepEqual(r.errs, []);
  assert.equal(r.S.twistAt, undefined, 'nothing drawn');
  assert.ok(!seen.critic && !seen.big.length);
  assert.equal(r.room.C.CFG.fever.sec, 40);
  for (const p of r.phones) { assert.deepEqual(told[p.id] ?? [], []); assert.ok(near(fevers[p.id][1][1] - fevers[p.id][0][1], 40)); }
  const a = round('critic', 21).r.S, b = round('critic', 21).r.S;
  assert.equal(a.twistAt, b.twistAt, 'deterministic for the seed');
});

test('the night deals the twist with the 搏盡 card and the room\'s round plays it', () => {
  const C = freshCore();
  let plan = null; const now = { t: 1e6 };
  const outs = os => { for (const o of os) if (o.k === 'roundStart') { plan = o.plan; C.roomStart({ room: 'TWST', now: now.t, round: 1, seed: 99, send: () => {} }, C.partyShift(plan)); } };
  outs(C.partyOpen(5, 'p0', '老闆'));
  outs(C.partyIn({ k: 'seat', seat: 'floor1' }, 'p0'));
  outs(C.partyIn({ k: 'start' }, 'p0'));
  const allin = C.partyNight().wager.cards.findIndex(c => c.tier === 'allin');
  outs(C.partyIn({ k: 'vote', card: allin }, 'p0'));
  for (let i = 0; i < 24; i++) if (C.partyTimed()) outs(C.partyTick(.25));
  outs(C.partyIn({ k: 'ready', on: true }, 'p0'));
  outs(C.partyIn({ k: 'start' }, 'p0'));
  for (let i = 0; i < 24; i++) if (C.partyTimed()) outs(C.partyTick(.25));
  assert.ok(plan, 'the round started');
  assert.ok(C.TWISTS.includes(plan.twist), 'the 搏盡 card carries a twist: ' + plan.twist);
  assert.equal(C.G.party.twist, plan.twist, 'the room\'s shift plays it (and it travels in the keyframe)');
  assert.equal(C.keyframe().shared?.party?.twist ?? C.sharedOf(C.G).party.twist, plan.twist);
});
