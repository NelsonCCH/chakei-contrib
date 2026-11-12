// Solo at a new seat: one player at 傳菜 / 燒味 / 外賣 for a whole shift, the computer at the shop's
// four. Each shift must run to the bell with one end card, keep the seat the player's throughout, book revenue, and
// the station must have done its work through the player's presses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSeat } from './xseat.js';

const DID = {
  runner: s => s.run.done, roast: s => s.served, takeaway: s => s.results.length,
};
for (const kind of Object.keys(DID)) {
  test(`solo shift at ${kind}: runs to the end, the player keeps the seat, revenue booked`, () => {
    const r = runSeat({ seed: 7, kind });
    assert.deepEqual(r.errs, []);
    assert.equal(r.G.xseat, kind);
    assert.deepEqual(r.G.extra, [kind], 'only that new station is on');
    for (const st of ['waiter', 'bar', 'kitchen', 'till']) assert.equal(r.G.roles[st], 'ai', st + ' is the computer\'s');
    assert.ok(r.revenue > 0, 'revenue booked: ' + r.revenue);
    assert.ok(DID[kind](r.st) > 0, kind + ' did its work');
  });
}
test('外賣 pace: a mid person ties near par and ships 8-10 bags on 打風前夕; the bench gets SOLO_TAKE orders', () => {
  for (const seed of [11, 12]) {
    const r = runSeat({ seed, kind: 'takeaway', human: 'mid', lv: 'typhoon' }), s = r.st;
    assert.deepEqual(r.errs, []);
    const tie = s.ties.reduce((a, t) => a + t.time, 0) / s.ties.length, par = s.ties.reduce((a, t) => a + t.par, 0) / s.ties.length;
    assert.ok(tie < 1.5 * par, `tie ${tie.toFixed(1)} s against par ${par.toFixed(1)}`);
    assert.ok(s.results.length >= 7 && s.results.length <= 11, `${s.results.length} bags`);
    assert.ok(r.G.work.takes >= r.C.SOLO_TAKE - 2, `${r.G.work.takes} orders`);
  }
});
test('solo seat: an idle player gets no cover (one player) and the shift still ends', () => {
  const r = runSeat({ seed: 8, kind: 'roast', pace: 0 });
  assert.deepEqual(r.errs, []);
  assert.equal(r.st.served, 0);
});
