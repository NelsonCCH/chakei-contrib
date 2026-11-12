// The extra seats in the real shop: 傳菜 runner, 燒味 roast and 外賣 takeaway (洗碗 is retired) as seats of a
// co-op shift, driven by phones (their station module's own bot pressing for the player) or by the computer on the
// referee. Each run checks the harness invariants (every result applied once, replicas equal the referee,
// plain JSON, clocks) and what the extra stations did to the shop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCoop } from './coop.js';
import { freshCore, simPort } from './core.js';

const ALL = ['runner', 'roast', 'takeaway'];
/**
 * 傳菜 and 外賣 as seats a phone holds: outside a party round they are 樓面's tasks (a level or a
 * free-play room with them runs the floor). Party rounds fold them into 樓面 too (floor1 and
 * floor2, played by tests/sim/floor-human.js) and seat no 洗碗, so the phone-held runs play a party round of 地獄午市
 * (樓面 x2 + 燒味) or 中環早餐 (樓面): the party shop's roles replace extraSeats.
 */
const seatsRound = shop => ({ party: { shop, sec: 180, round: 0 } });

/** Watches the referee's shop every frame: pass size, rack stock, takeaway orders and what they held. */
function watcher() {
  const w = { maxPass: 0, packs: new Map(), walkIns: new Set(), roastSeated: 0 };
  w.each = ({ ref }) => {
    const C = ref.C, G = C.G;
    w.maxPass = Math.max(w.maxPass, C.passCount());
    for (const g of G.groups) {
      if (g.via === 'pack') w.packs.set(g.id, { kinds: new Set([g.drinks.length && 'bar', g.meals.length && 'kitchen', g.roast?.length && 'roast'].filter(Boolean)), allDone: C.linesOf(g).every(x => x.l.done), until: g.until, t: G.t });
      if (g.via === 'roast') w.walkIns.add(g.id);
      if (!g.take && g.roast && g.roast.some(l => l.done)) w.roastSeated++;
    }
  };
  /** Takeaway orders that left with every line made before their time was up: handed over (packed). */
  w.packed = G => [...w.packs.entries()].filter(([id, p]) => !G.groups.some(g => g.id === id) && p.allDone && p.t < p.until);
  return w;
}
const ok = r => assert.equal(r.R.stats.applied + r.R.stats.nacked, r.sentRes, 'every result a phone sent was applied or refused, once');

test('extra seats with nobody on them: the computer runs the pass, the roast counter and the takeaway bench', () => {
  const w = watcher();
  const r = runCoop({ seed: 21, seats: ['waiter', 'bar'], extraSeats: ALL, shape: 'lan', each: w.each });
  assert.deepEqual(r.errs, []); ok(r);
  const S = r.S;
  for (const k of ALL) assert.equal(r.driverLog.filter(d => d.seat === k).every(d => d.driver === 'computer'), true, k + ' stayed with the computer');
  assert.ok(S.pass.carried > 0, 'the computer runner carried lines: ' + JSON.stringify(S.pass));
  assert.ok(w.maxPass > 0, 'lines waited on the pass');
  assert.ok(w.walkIns.size > 0, '斬料 walk-ins came');
  assert.ok(w.packed(S).length > 0, 'takeaway orders were packed and handed over');
  assert.ok(S.served > 0 && S.revenue > 0);
});

test('extra seats held by phones: each player plays their station (its bot pressing), the shop books what they did', () => {
  const w = watcher();
  const seats = ['floor1', 'floor2', 'roast'];
  const r = runCoop({ seed: 22, seats, shape: 'lan', each: w.each, ...seatsRound('hell') });
  assert.deepEqual(r.errs, []); ok(r);
  for (const [i, k] of seats.entries()) assert.ok(r.driverLog.some(d => d.seat === k && d.driver === 'p' + i), k + ' was driven by its phone');
  const S = r.S, P = r.phones;
  assert.equal(S.wash, undefined, 'no 洗碗 on a party night');
  for (const i of [0, 1]) assert.ok(P[i].human.stats.jobs > 0, `樓面 phone ${i} did floor work: ${JSON.stringify(P[i].human.stats)}`);
  assert.ok(P[2].C.roastState().served > 0, 'the roast phone served');
  assert.ok(r.bus.stats.bytesByKind.res > 0);
});

test('takeaway orders carry items from the bar, the kitchen and the roast counter, and each is packed once', () => {
  const w = watcher();
  const r = runCoop({ seed: 23, seats: ['floor1', 'roast'], shape: 'lan', maxSec: 260, each: w.each, ...seatsRound('hell') });
  assert.deepEqual(r.errs, []); ok(r);
  const S = r.S, packed = w.packed(S);
  // the workload model's mixer picks each item for the prep seat furthest behind, so one order is a drink and a
  // meal, another a roast box: over a few shifts the packed orders draw on all three
  const kinds = new Set(packed.flatMap(([, p]) => [...p.kinds]));
  for (const seed of [24, 25]) {
    const v = watcher(), q = runCoop({ seed, seats: ['floor1', 'roast'], shape: 'lan', maxSec: 260, each: v.each, ...seatsRound('hell') });
    assert.deepEqual(q.errs, []);
    for (const [, p] of v.packed(q.S)) for (const k of p.kinds) kinds.add(k);
  }
  assert.deepEqual([...kinds].sort(), ['bar', 'kitchen', 'roast'], 'packed orders held drinks, meals and roast: ' + JSON.stringify(packed.map(([id, p]) => [id, [...p.kinds]])));
  // 樓面 packs the bags (floor tasks with per-item claims, applied once: ok(r) above)
  assert.ok((r.phones[0].human.stats.by.bag ?? 0) > 0, 'the 樓面 phone packed bags: ' + JSON.stringify(r.phones[0].human.stats.by));
});

test('hand-overs mid-shift: each extra seat goes phone -> computer -> phone (release, link loss, page reload) and nothing is lost', () => {
  const ev = [
    { at: 40, kind: 'release', phone: 1, dur: 25 },
    { at: 55, kind: 'down', phone: 2, dur: 30 },
    { at: 70, kind: 'reload', phone: 3 },
    { at: 90, kind: 'release', phone: 3, dur: 20 },
  ];
  // party: 樓面 x2 and 燒味 at phones 0-2: 樓面 released, 樓面 link down, 燒味 reloaded then released
  const r = runCoop({ seed: 24, seats: ['floor1', 'floor2', 'roast'], shape: 'lan', events: ev.map(e => ({ ...e, phone: e.phone - 1 })), ...seatsRound('hell') });
  assert.deepEqual(r.errs, []); ok(r);
  for (const k of ['floor1', 'floor2', 'roast']) {
    const log = r.driverLog.filter(d => d.seat === k).map(d => d.driver), i = log.indexOf('computer', 1);
    assert.ok(i > 0 && log.slice(i).some(d => d.startsWith('p')), k + ' went to the computer and back: ' + log.join(' '));
  }
  assert.ok(r.S.pass.carried > 0);
});

test('a room restart keeps the extra seats and their shared work (the pass, the takeaway orders)', () => {
  const w = watcher();
  const r = runCoop({ seed: 25, seats: ['waiter', 'runner', 'takeaway'], extraSeats: ALL, shape: 'lan', events: [{ at: 80, kind: 'restart' }], each: w.each });
  assert.deepEqual(r.errs, []);
  assert.equal(r.restarts, 1, 'the room restarted from its last save');
  assert.deepEqual(r.S.extra, ALL, 'the restarted room runs the same shop');
  assert.ok(r.S.pass.carried > 0 && w.packed(r.S).length > 0);
});

test('pass back-pressure: with the runner away the pass fills to its cap and the kitchen holds back (drinks skip it)', () => {
  const w = watcher();
  // both 樓面 phones (who carry the pass on a party night) sit still for the whole shift with one other player
  // online: the cover rule hands their seats to the computer after 30 s of quiet; before that the pass fills
  const r = runCoop({ seed: 26, seats: ['bar', 'floor1', 'floor2'], shape: 'lan', lazy: { 1: [0, 400], 2: [0, 400] }, each: w.each, ...seatsRound('hell') });
  assert.deepEqual(r.errs, []); ok(r);
  const C = r.ref.C;
  assert.ok(w.maxPass >= C.PASS_CAP, 'the pass reached its cap: ' + w.maxPass);
  // the computer kitchen may finish each meal already due: a little over at most
  assert.ok(w.maxPass <= C.PASS_CAP + 2, 'the pass never ran far over its cap: ' + w.maxPass);
  assert.ok(r.driverLog.some(d => d.seat === 'floor1' && d.driver === 'computer' && d.why === 'quiet'), 'the computer covered the quiet 樓面');
});

test('drinks skip the pass: a player\'s bar serves even with the pass full, and the drink reaches the table', () => {
  const C = freshCore();
  C.setPort(simPort(C)); C.setRng(C.mulberry32(5)); C.setSlot('lunch'); C.setDiff('pro'); C.setStation('bar');
  C.newGame(); C.resetClock();
  C.refStart({ room: 'U1', me: 'p0', name: 'x', send: () => {}, seed: 1, round: 1, now: 0, extraSeats: ['runner'] });
  const G = C.G; G.phase = 'open'; G.pot = { level: 9, st: 'ready', until: 0, pulls: 0 };
  const g = C.makeGroup(); g.table = 0; G.groups.push(g); C.CORE_HOOK.seat(g, G.tables[0]);
  C.CORE_HOOK.submitOrder(g, ['熱奶茶', '熱奶茶', '熱奶茶', '熱奶茶', '熱奶茶', '熱奶茶', '熱奶茶'], false);
  g.drinks.slice(0, 6).forEach(d => { d.done = true; d.passT = 0; });
  assert.equal(C.passCount(), 6);
  G.bench.target = { gid: g.id, i: 6 }; G.bench.cup = 'hot'; G.bench.ing = { 茶: 1 };
  C.barKey('serve');
  assert.equal(g.drinks[6].done, true, 'served with the pass full');
  assert.equal(g.drinks[6].passT, undefined, 'it goes out over the bar\'s counter, not onto the pass');
  assert.equal(C.passCount(), 6);
});

test('the default shop has no extra rules: no G.extra, no pass, no racks, and the roast/takeaway customers never come', () => {
  const r = runCoop({ seed: 28, seats: ['waiter', 'bar', 'kitchen', 'till'], shape: 'lan' });
  assert.deepEqual(r.errs, []);
  const S = r.S;
  assert.equal(S.extra, undefined); assert.equal(S.pass, undefined);
  assert.equal(S.nextRoast, undefined); assert.equal(S.nextPack, undefined);
});

// The books for an extra seat's results were checked through the 洗碗 phone's `broken` results; that seat is retired.
// The books close the same way for every seat (coop.test.js, the till's payments at the bell).

test('the pass marks lines that waited too long as stale (counted, no money effect)', () => {
  const r = runCoop({ seed: 29, seats: ['waiter', 'runner'], extraSeats: ['runner'], shape: 'lan', lazy: { 1: [0, 400] } });
  assert.deepEqual(r.errs, []);
  assert.ok(r.S.pass.stale > 0, 'lines went stale: ' + JSON.stringify(r.S.pass));
});
