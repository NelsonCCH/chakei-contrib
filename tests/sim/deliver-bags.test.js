// 送外賣 multi-bag runs under jittery links: a rider claims 2-3 bags at the door,
// item by item through the referee (taskWant), while a teammate races for one of them; the run starts only through
// core/coop/plugins/deliver.ts deliverSetOff, which waits until the referee has granted every claim and leaves out only
// a bag that was lost. Three phones hold the three floor seats of 打風前夕; the referee is the room's. The other floor work goes
// on around them (the brains of tests/sim/floor.js); the bags are put at the door on the referee so the run is the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFloor } from './floor.js';

const FREEZE = id => ({ id, until: Infinity, phase: 'out' });   // a harness job that never finishes: the brain stays off

/**
 * One scripted run. n: bags phone 0 takes; race: 'same' (phone 1 claims bag 2 in the same frame), 'early' (phone 1
 * claims it 0.5 s before), or null. Returns what happened, with every check that must hold on every frame.
 */
function bagRun({ seed, shape, n = 2, race = 'same' }) {
  const L = { go: null, waits: 0, errs: [], awaySeen: false, back: false, drops: [], wanted: null, lost1: null, held1: null };
  let phase = 'look', t0 = 0, ids = [];
  const each = ({ phones, room }) => {
    const R = room.C.G, F = R.floor, [p0, p1] = phones, C0 = p0.C, C1 = p1.C;
    if (!F || !R.running) return;
    const openRef = F.tasks.filter(x => x.k === 'deliver' && x.by === null).map(x => x.id);
    const seen = ph => (ph.C.G.floor?.tasks ?? []).filter(x => x.k === 'deliver' && x.by === null).map(x => x.id);
    if (phase !== 'look' && phase !== 'done') { C0.noteInput(p0.seat); C1.noteInput(p1.seat); }   // both players are at their phones
    if (phase === 'look') {
      if (R.t < 20) return;
      // bags at the door on the referee (the bagging that makes them is tested elsewhere: tests/sim/floor.test.js)
      if (!L.stocked) { L.stocked = true; for (let k = 0; k < n + 1; k++) F.out.push({ gid: 90001 + k, no: 61 + k, cold: R.t + 120, items: 2, rider: null }); return; }
      const both = openRef.filter(id => seen(p0).includes(id) && seen(p1).includes(id));
      if (both.length < n || p0.job?.phase === 'out' || p1.job?.phase === 'out') return;   // neither is out on a ride of its own
      if (p0.job) C0.taskDrop(p0.job.id);
      ids = both.slice(0, n);
      L.wanted = ids.map(id => Number(id.split(':')[1]));
      p0.job = FREEZE('x');
      C0.setWorking(() => ids);
      if (p1.job) C1.taskDrop(p1.job.id);
      // phone 1 rides bag 2 if it wins it (the harness job: claim, ride 20 s, drop, back); it lets go if the referee says no
      p1.job = { id: ids[1], until: C1.G.t + 3, phase: 'go', dur: 20 };
      if (race === 'early') { C1.taskWant(ids[1]); phase = 'early'; t0 = R.t; return; }
      for (const id of ids) C0.taskWant(id);
      if (race === 'same') C1.taskWant(ids[1]);
      phase = 'claim'; return;
    }
    if (phase === 'early') {
      if (R.t - t0 < 0.5) return;
      for (const id of ids) C0.taskWant(id);
      phase = 'claim'; return;
    }
    if (phase === 'claim') {
      const r = C0.deliverSetOff(L.wanted);
      if (r.st === 'wait') { L.waits++; return; }
      if (r.st === 'none') { L.go = r; phase = 'done'; return; }
      L.go = r;
      // the run left the door only with bags the referee had already given to phone 0
      for (const g of r.gids) { const x = F.tasks.find(y => y.id === 'deliver:' + g); if (!x || x.by !== 'p0') L.errs.push(`rode with deliver:${g} held by ${x ? x.by : 'nobody'} on the referee`); }
      const x1 = F.tasks.find(y => y.id === ids[1]);
      L.held1 = x1 ? x1.by : 'gone';
      phase = 'ride'; return;
    }
    if (phase === 'ride') {
      if (F.away.p0 !== undefined) L.awaySeen = true;
      for (const o of F.out) if (o.rider === 'p0' && !L.go.gids.includes(o.gid)) L.errs.push(`deliver:${o.gid} on p0's run but not chosen`);
      C0.deliverBotPress(); C0.deliverDrive(1 / 60);
      if (C0.deliverHome()) { phase = 'home'; t0 = R.t; }
      return;
    }
    if (phase === 'home' && R.t - t0 > 2) {
      L.back = F.away.p0 === undefined;
      L.left = L.go.gids.filter(g => F.out.some(o => o.gid === g));
      phase = 'done';
    }
  };
  const r = runFloor({ seed, players: 3, shape, sec: 150, pick: 0.06, work: 1.5, each });
  return { r, L, phase };
}

test('multi-bag: a same-frame race for one bag has one winner; the rider sets off with exactly the bags it was granted', () => {
  const outcomes = new Set();
  for (const [seed, shape, n] of [[1, ['4g', 'bad', '4g'], 2], [2, ['bad', '4g', 'lan'], 2], [3, ['4g', '4g', 'bad'], 3], [4, ['bad', 'bad', '4g'], 3]]) {
    const { r, L, phase } = bagRun({ seed, shape, n });
    assert.deepEqual(r.errs, [], `seed ${seed}: ${r.errs.slice(0, 3).join('; ')}`);
    assert.deepEqual(L.errs, [], `seed ${seed}: ${L.errs.slice(0, 3).join('; ')}`);
    assert.ok(L.go && L.go.st === 'go', `seed ${seed}: the rider set off (phase ${phase}, ${JSON.stringify(L.go)})`);
    assert.ok(L.waits > 0, `seed ${seed}: it waited for the referee's word before leaving (${L.waits} frames)`);
    const won = L.go.gids.includes(L.wanted[1]);
    outcomes.add(won ? 'rider' : 'teammate');
    // bag 2 went to exactly one of them; the rider's run holds the rest of what it wanted
    assert.equal(L.held1, won ? 'p0' : 'p1', `seed ${seed}: bag 2's holder matches the run`);
    assert.deepEqual([...L.go.gids, ...L.go.lost].sort(), [...L.wanted].sort(), `seed ${seed}: every wanted bag either rides or is lost`);
    assert.deepEqual(L.go.lost, won ? [] : [L.wanted[1]], `seed ${seed}: only the contested bag can be lost`);
    assert.ok(L.awaySeen, `seed ${seed}: the referee has the rider out of the shop`);
    assert.equal(phase, 'done', `seed ${seed}: the run came home (${phase})`);
    assert.ok(L.back, `seed ${seed}: back at the shop on the referee`);
    assert.deepEqual(L.left, [], `seed ${seed}: every bag of the run was dropped off`);
  }
  assert.deepEqual([...outcomes].sort(), ['rider', 'teammate'], 'over these seeds the bag goes each way at least once');
});

test('multi-bag: a bag a teammate claimed first is left out, only that bag; the run goes with the others', () => {
  for (const [seed, shape] of [[5, ['4g', 'lan', '4g']], [6, ['bad', '4g', 'lan']]]) {
    const { r, L, phase } = bagRun({ seed, shape, n: 3, race: 'early' });
    assert.deepEqual(r.errs, []);
    assert.deepEqual(L.errs, [], `seed ${seed}: ${L.errs.slice(0, 3).join('; ')}`);
    assert.ok(L.go && L.go.st === 'go', `seed ${seed}: set off (${phase})`);
    assert.deepEqual(L.go.lost, [L.wanted[1]], `seed ${seed}: the teammate's bag is the one left out`);
    assert.deepEqual(L.go.gids, [L.wanted[0], L.wanted[2]], `seed ${seed}: the other two ride`);
    assert.equal(L.held1, 'p1', `seed ${seed}: the teammate holds it`);
    assert.equal(phase, 'done');
    assert.deepEqual(L.left, []);
  }
});
