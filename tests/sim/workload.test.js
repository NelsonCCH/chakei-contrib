// The workload model: customers put work on the seats.
// - Balance: on every level with `roles`, each seat's busy share at the human mid profile (the customers'
//   demand in the load table's seconds, tests/sim/workload.js) is within BAND of the roster's mean, with the level's
//   solved spec (core/work/spec.ts WORK_LEVELS). Prints the table. OVER lists the levels the levers cannot
//   bring inside the band (no takeaway stream to steer, a lunch meal is 4.5 s against a drink's 5.8 s, and the
//   floor's players are whole people), each held to its measured spread so it cannot get worse unnoticed.
// - Determinism: the same seed makes the same customers and the same work (G.work), and G.work is plain JSON (it travels
//   in keyframes and the room's saves). Every draw is from the shift's one stream, which the computer's seats draw from
//   too, so a different player changes the customers after their first action, in the room and solo alike.
// - The takeaway flow: an order's bill goes to the till while the order is made; a bill that runs (走數) calls its order
//   off; a paid order is bagged and handed over (served) once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore } from './core.js';
import { LEVELS, LEVEL_ORDER } from './levels.js';
import { levelBalance } from './workload.js';
import { runShift } from './shift.js';

const C = freshCore();
const WITH = LEVEL_ORDER.filter(id => LEVELS[id].roles);
const SEEDS = [101, 102, 103, 104, 105];   // the solver's (scripts/workload-solve.mjs --seeds 5)
const OVER = { kwc: .22 };   // bingsutt and silver had only 洗碗: no roles since it was retired   // kwc .21 -> .22: the solver finds none better; milktea inside since the bag was measured

test('balance: on every level with extra stations, each seat\'s mid busy share is within BAND of the mean (OVER aside)', () => {
  const rows = WITH.map(id => levelBalance(id, SEEDS));
  console.log(`\n${SEEDS.length} seeds each; busy share = the customers' work in a mid player's seconds / (shift x players at the seat)\n| level | floor (players) | bar | kitchen | 燒味 | till | worst off the mean |\n|---|---|---|---|---|---|---|`);
  const pc = (b, k) => b.share[k] === undefined ? '' : `${(100 * b.share[k]).toFixed(0)}%`;
  for (const b of rows) console.log(`| ${b.lv} | ${pc(b, 'floor')} (${b.spec.floor}) | ${pc(b, 'bar')} | ${pc(b, 'kitchen')} | ${pc(b, 'roast')} | ${pc(b, 'till')} | ${(100 * b.worst).toFixed(1)}% |`);
  for (const b of rows) {
    assert.deepEqual(b.errs, [], b.lv);
    assert.ok(C.WORK_LEVELS[b.lv], `${b.lv} has a solved spec`);
    const band = OVER[b.lv] ?? C.BAND;
    assert.ok(b.worst <= band, `${b.lv}: ${b.roster.map(k => `${k} ${(100 * b.off[k]).toFixed(0)}%`).join(', ')} (band ${(100 * band).toFixed(0)}%)`);
  }
  for (const [lv, band] of Object.entries(OVER)) {
    const b = rows.find(x => x.lv === lv);
    assert.ok(b.worst > C.BAND, `${lv} is inside the band now (${(100 * b.worst).toFixed(1)}%): take it off OVER`);
    assert.ok(band <= C.BAND + .1, lv);
  }
});

test('determinism: the same seed makes the same customers and work; G.work is plain JSON', () => {
  for (const lv of ['latenight', 'hell']) {
    const run = o => runShift({ seed: 7, station: 'waiter', slot: LEVELS[lv].slot, lv, roles: true, diff: 'pro', ...o });
    const a = run({}), b = run({});
    const W = r => r.C.G.work;
    assert.deepEqual(W(a), W(b), `${lv}: the same shift twice`);
    assert.deepEqual(JSON.parse(JSON.stringify(W(a))), W(a), `${lv}: G.work survives JSON`);
    assert.ok(W(a).takes > 0 && W(a).chops > 0, `${lv}: takeaway orders and 斬料 walk-ins came`);
  }
});

test('the takeaway flow: the bill goes to the till while the order is made; a bill that runs calls the order off', () => {
  const n = { bills: 0, paid: 0, ran: 0, handed: 0 };
  const atTill = (G, b) => G.payQ.some(c => String(c.id) === b) || String(G.cur?.id) === b || String(G.at.cur?.id) === b;
  // a till that works (the pace bot) and one nobody works, so its bills run
  for (const [seed, bot] of [[11, true], [12, false]]) {
    const bill = new Map();   // bill id -> { gid, out: 'paid' | 'ran' once it left the till }
    const r = runShift({ seed, station: 'till', slot: LEVELS.typhoon.slot, lv: 'typhoon', roles: true, diff: 'pro', bot, before: X => {
      const G = X.G, W = G.work; if (!W) return;
      for (const [b, gid] of Object.entries(W.bills)) if (!bill.has(b)) {
        bill.set(b, { gid, out: null }); n.bills++;
        const g = G.groups.find(x => x.id === gid);
        assert.ok(g && g.via === 'pack' && g.prepaid, `bill ${b}: its order ${gid} is being made, prepaid`);
      }
      for (const [b, v] of bill) {
        if (v.out || atTill(G, b)) continue;
        // a paid bill keeps its entry (the order goes on to be bagged); a bill that ran is struck off with its order
        v.out = b in W.bills ? 'paid' : 'ran'; n[v.out]++;
        if (v.out === 'ran') assert.ok(!G.groups.some(g => g.id === v.gid), `bill ${b} ran: its order ${v.gid} is called off`);
      }
    } });
    assert.deepEqual(r.errs, []);
    for (const v of bill.values()) if (v.out === 'paid' && !r.C.G.groups.some(g => g.id === v.gid)) n.handed++;
  }
  console.log(`takeaway bills ${n.bills}: paid ${n.paid} (orders handed over or gone by the bell ${n.handed}), run ${n.ran}`);
  assert.ok(n.bills > 0 && n.paid > 0, 'takeaway bills reached the till and were paid');
  assert.ok(n.handed > 0, 'paid orders were bagged and left');
  assert.ok(n.ran > 0, 'at an unworked till the bills ran, and their orders were called off');
});
