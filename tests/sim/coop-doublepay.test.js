// A leave-and-rejoin race, re-checked under the room's referee: journey-coop at 4x once saw one group
// paid twice, "paid $40 at a teammate's till ... paid $40 at the computer till". The scenario played here: the
// till player pays a customer and, a moment later (0-400 ms, on a jittery link), leaves the room (release, the room's own
// roomLeave, the link gone), then comes back as a fresh page a few seconds later and takes the till again. Several times
// per shift, many seeds. Every bill must be paid exactly once: by a teammate's till (an applied tillPaid) or by the
// computer till, never both, never twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCoop } from './coop.js';
import { mulberry32 } from './core.js';

const FOUR = ['waiter', 'bar', 'kitchen', 'till'];
const TILL = 3;

function leaveAroundPayments(seed, shape) {
  const pays = new Map(), log = [], rnd = mulberry32(seed * 977);
  const book = (cid, by, t) => { pays.set(cid, (pays.get(cid) ?? 0) + 1); log.push(`${t.toFixed(1)} ${by} paid #${cid}`); };
  let hooked = null, lastPaidOnPhone = null, plan = null, cycles = 0;
  const r = runCoop({ seed, seats: FOUR, shape, maxSec: 200, each: ({ t, now, phones, room, bus, reload }) => {
    const C = room.C;
    if (hooked !== C) {
      hooked = C;
      // a teammate's payment, as the referee applied it
      C.onRefEvent(e => { if (e.ok === true && e.r.k === 'tillPaid') book(e.r.cid, e.player, C.G.t); });
      // the computer till's payment: its customer is gone and the count went up
      const ai = C.CORE_HOOK.aiTill;
      C.CORE_HOOK.aiTill = (...a) => {
        const G = C.G, cur = G.at.cur, n = G.paidCount;
        const out = ai(...a);
        if (cur && G.paidCount > n) book(cur.id, 'computer', G.t);
        return out;
      };
    }
    const ph = phones[TILL], G = ph.C.G;
    // the till phone has just paid someone: leave a moment later (once the last cycle is over)
    const paid = G.lastCust ? G.lastCust.id : null;
    if (!plan && paid !== null && paid !== lastPaidOnPhone && G.running && t < 150 && G.roles.till === 'me') plan = { leaveAt: now + rnd() * 400, dropAt: 0, backAt: 0 };
    lastPaidOnPhone = paid;
    if (plan && plan.leaveAt && now >= plan.leaveAt) {
      // the page's netLeave: release the seat, then the room hears the socket's seat:null (roomLeave) after the link's lag
      ph.C.release('till'); ph.claimed = true; ph.lastClaim = now + 1e9;
      plan.leaveAt = 0; plan.dropAt = now + 20 + rnd() * 200; plan.backAt = now + 3000 + rnd() * 3000;
    }
    if (plan && plan.dropAt && now >= plan.dropAt) { C.roomLeave(ph.id); bus.down(ph.id, true); plan.dropAt = 0; }
    if (plan && plan.backAt && now >= plan.backAt) {
      // back as a fresh page (joinRoom after netLeave): a new phone that says hello and takes the till again
      bus.down(ph.id, false);
      reload(ph);
      plan = null; cycles++; lastPaidOnPhone = null;
    }
  } });
  return { r, pays, log, cycles };
}

test('leave and rejoin around a till payment (jittery link, many seeds): every bill is paid exactly once', t => {
  let cycles = 0, bills = 0;
  const bad = [];
  for (const [i, shape] of ['4g', 'bad', '4g', 'bad', '4g', 'bad', '4g', 'bad', '4g', 'bad', '4g', 'bad'].entries()) {
    const seed = 40 + i;
    const { r, pays, log, cycles: n } = leaveAroundPayments(seed, shape);
    cycles += n; bills += pays.size;
    assert.deepEqual(r.errs, [], `seed ${seed}`);
    const twice = [...pays].filter(([, k]) => k > 1);
    if (twice.length) bad.push(`seed ${seed} (${shape}): bills paid more than once ${JSON.stringify(twice)}\n${log.join('\n')}`);
    assert.equal([...pays.values()].reduce((a, b) => a + b, 0), r.S.paidCount, `seed ${seed}: every payment the shop counted was booked once`);
  }
  t.diagnostic(`${cycles} leave-and-rejoin cycles around a payment, ${bills} bills, ${bad.length} seeds with a bill paid twice`);
  assert.deepEqual(bad, []);
  assert.ok(cycles >= 30, `the till left and came back around a payment ${cycles} times`);
});
