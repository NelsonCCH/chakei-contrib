// Co-op in memory: whole shifts on several phones joined by SimBus,
// under every network condition (the link shapes), with the invariants checked every frame and at the end (tests/sim/coop.js).
// SIM_SEEDS=n for more seeds per scenario.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCoop } from './coop.js';

const SEEDS = Number(process.env.SIM_SEEDS) || 2;
const FOUR = ['waiter', 'bar', 'kitchen', 'till'];
const ROT = s => FOUR.map((_, i) => FOUR[(i + s) % 4]);

function scenario(name, make) {
  test(`co-op sim: ${name}`, () => {
    const out = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = runCoop({ seed, ...make(seed) });
      if (r.errs.length) out.push(`seed ${seed}:\n    ` + r.errs.slice(0, 8).join('\n    '));
      else assert.ok(r.S.served >= 2, `seed ${seed}: only ${r.S.served} customers served`);   // 熟手 sends fewer customers
    }
    assert.deepEqual(out, [], out.join('\n'));
  });
}

scenario('clean, four players', s => ({ seats: ROT(s) }));
scenario('lan (5 ms)', s => ({ seats: ROT(s), shape: 'lan' }));
scenario('4g (80 ± 40 ms)', s => ({ seats: ROT(s), shape: '4g' }));
scenario('bad (200 ± 150 ms, 5% loss, 2% dup, reorder)', s => ({ seats: ROT(s), shape: 'bad' }));
scenario('burst (2 s holds)', s => ({ seats: ROT(s), shape: '4g', events: [30, 70, 110, 150].map((at, i) => ({ at, kind: 'burst', phone: 1 + i % 3, dur: 2 })) }));
scenario('flap (link down 1-8 s every 20 s)', s => ({ seats: ROT(s), shape: 'lan', events: [20, 40, 60, 80, 100, 120, 140].map((at, i) => ({ at, kind: 'down', phone: 1 + i % 3, dur: 1 + (i * 3 + s) % 8 })) }));
scenario('frozen phone (10-40 s)', s => ({ seats: ROT(s), shape: 'lan', events: [{ at: 30, kind: 'freeze', phone: 2, dur: 10 + s * 10 }] }));
scenario('room restart mid-shift (the Durable Object evicted, back from its last save)', s => ({ seats: ROT(s), shape: '4g', events: [{ at: 50 + s * 20, kind: 'restart' }, { at: 130 + s * 7, kind: 'restart' }] }));
scenario('reload storm', s => ({ seats: ROT(s), shape: 'lan', events: [25, 55, 85, 115, 145].map((at, i) => ({ at, kind: 'reload', phone: 1 + i % 3 })) }));
scenario('random hand-overs (release, the computer covers, claim back)', s => ({ seats: ROT(s), shape: '4g', events: [20, 45, 70, 95, 120, 145].map((at, i) => ({ at, kind: 'release', phone: 1 + (i + s) % 3, dur: 3 + i % 4 })) }));
scenario('8 players and 2 viewers (four seats, four phones watching)', s => ({ seats: [...ROT(s), null, null, null, null], viewers: 2, shape: 'lan' }));
scenario('paused referee: results sent meanwhile are held, applied on resume', s => ({ seats: ROT(s), shape: 'lan', events: [{ at: 60, kind: 'pause', phone: 1, dur: 5 }] }));

// "The books moved after the bell": a till payment still on its way when the referee's shift ends
// (journey-coop 4p central: card $502, shop $545). Every co-op sim also checks the books at the end card = the books at
// the end (tests/sim/coop.js).
function payAtBell(stamp) {
  let sent = 0, bell = null;
  const r = runCoop({ seed: 1, seats: FOUR, shape: '4g', each: ({ phones, ref }) => {
    const till = phones[3], T = till.C.G;
    if (sent < 3 && !ref.C.G.running && T.running && T.roles.till === 'me') {
      if (bell === null) bell = ref.C.G.revenue;
      T.t = ref.C.G.t + stamp;   // when the till phone made it (its clock trails or leads the referee's)
      till.C.submit('till', { k: 'tillPaid', cid: 900000 + sent, charged: 43 }); sent++;
    }
  } });
  assert.equal(sent, 3, 'the till phone was still running when the referee rang the bell');
  assert.deepEqual(r.errs, []);
  return { r, bell };
}
test('a result made before the bell but reaching the referee after it is counted, and the end card shows it', () => {
  const { r, bell } = payAtBell(-0.1);
  assert.ok(r.atEnd.revenue >= bell + 3 * 43, `end card $${r.atEnd.revenue}, $${bell} at the bell plus three payments of $43`);
});
test('a result made after the bell is refused, and the books stay what the end card shows', () => {
  const { r, bell } = payAtBell(0.3);
  assert.equal(r.atEnd.revenue, bell, 'none of the late payments counted');
});

test('every result is applied exactly once or refused (clean and with duplicates)', () => {
  for (const shape of ['clean', 'bad']) {
    const r = runCoop({ seed: 5, seats: FOUR, shape });
    assert.deepEqual(r.errs, []);
    assert.equal(r.R.stats.applied + r.R.stats.nacked, r.sentRes, `${shape}: ${r.R.stats.applied} applied + ${r.R.stats.nacked} refused vs ${r.sentRes} sent`);
    if (shape === 'bad') assert.ok(r.R.stats.dup > 0, 'the bad link delivered duplicates, and they were dropped');
  }
});
