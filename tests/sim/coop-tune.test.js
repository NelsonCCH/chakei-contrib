// The core tuning through the referee: the third star's speed timings are taken where the referee
// applies a result and count only while a player drives the station. The fever on every
// phone: fever.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCoop } from './coop.js';

test('speed: a bar held on a teammate\'s phone earns the third star\'s timing, at the time the phone made each cup', () => {
  // p0 waits tables, p1 holds the bar over a bad link (the room's own link is clean); at 60 s p1 lets go for 25 s
  // (the computer covers)
  const sent = new Map(), applied = [];
  let coverJobs = 0, coverFrames = 0, lastN = 0, wasAi = false, hooked = false;
  const r = runCoop({ seed: 2, seats: ['waiter', 'bar'], shape: ['4g', 'bad'], events: [{ at: 60, kind: 'release', phone: 1, dur: 25 }],
    each: ({ phones, ref }) => {
      const C = ref.C, P = phones[1].C.phone();
      if (P) for (const o of P.outbox) if (o.e.b.k === 'res' && o.e.b.r.k === 'lineDone') sent.set(o.seq, o.e.at);
      if (!hooked){
        hooked = true;
        C.onRefEvent(e => {
          if (e.ok !== null || e.r.k !== 'lineDone' || e.r.dest !== 'bar') return;
          const g = C.G.groups.find(x => x.id === e.r.gid);
          if (g && g.state === 'wait') applied.push({ seq: e.seq, t: C.G.t, orderAt: g.orderAt });
        });
      }
      const n = C.G.spd?.bar?.[0] ?? 0;
      const ai = C.G.roles.bar === 'ai' && C.G.t > 1;
      if (ai && wasAi){ coverJobs += n - lastN; coverFrames++; }
      wasAi = ai; lastN = n;
    } });
  assert.deepEqual(r.errs, []);
  const spd = r.S.spd ?? {};
  assert.ok(spd.bar && spd.bar[0] >= 5, 'the phone-held bar has timed cups: ' + JSON.stringify(spd));
  assert.ok(spd.waiter && spd.waiter[0] >= 5, 'the referee\'s own waiter has timed orders: ' + JSON.stringify(spd));
  assert.equal(spd.kitchen, undefined, 'the computer kitchen is never timed');
  assert.equal(spd.till, undefined, 'the computer till is never timed');
  assert.ok(coverFrames > 60 * 20, 'the computer covered the bar for a while: ' + coverFrames + ' frames');
  assert.equal(coverJobs, 0, 'no cup is timed while the computer holds the bar');
  // the timing is the phone's: the envelope's game time minus the order's, not the referee's clock when it arrived
  let want = 0, lag = 0;
  for (const a of applied){ const at = sent.get(a.seq); assert.ok(at !== undefined, 'seq ' + a.seq + ' was sent by p1'); want += Math.max(0, Math.min(at, a.t) - a.orderAt); lag += a.t - Math.min(at, a.t); }
  assert.equal(spd.bar[0], applied.length, 'one timing per bar result the referee applied');
  assert.ok(Math.abs(spd.bar[1] - want) < 1e-6, `bar seconds ${spd.bar[1]} = the cups' own times ${want}`);
  assert.ok(lag > 0.5, `the link lag (${lag.toFixed(2)} s in all) is left out of the timing`);
  // every phone sees the referee's count (G.spd is shared), so the bar phone's end card has the same third star
  const pg = r.phones[1].C.speedGoal('bar', false), rg = r.ref.C.speedGoal('bar', false);
  assert.deepEqual(pg, rg);
  assert.ok(pg.have !== null && pg.have > 0, 'the bar phone has an average: ' + JSON.stringify(pg));
});

test('speed: a bar the computer holds all shift has no timing (only the players\' stations are timed)', () => {
  const r = runCoop({ seed: 3, seats: ['waiter', 'till'], shape: 'lan' });
  assert.deepEqual(r.errs, []);
  const spd = r.S.spd ?? {};
  assert.equal(spd.bar, undefined, 'computer bar: ' + JSON.stringify(spd));
  assert.ok(spd.waiter && spd.waiter[0] > 0 && spd.till && spd.till[0] > 0, 'the referee\'s and the teammate\'s stations are timed: ' + JSON.stringify(spd));
  const g = r.phones[1].C.speedGoal('bar', false);
  assert.equal(g.have, null); assert.equal(g.ok, false);
});
