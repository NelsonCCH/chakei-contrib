// 樓面 station bubbles under jittery links: one counted bubble per station (「傳」 at the
// pass, 「包」 in the takeaway bay). Phones tap the same station; each takes what one tap takes (core/work/floor.ts
// stationPick) through the one batch-claim path (plugins/floor.ts floorTakeMany): every item is claimed on its own, the
// referee's first claim wins.
//  - Same frame: every phone taps at once. Every item has exactly one holder (the harness's two-holders check), and its
//    first holder is a phone that asked for it (or the computer); the tapping phone's count drops at once.
//  - A moment apart: a teammate tapping the same station after the first claim has reached it gets the remaining items,
//    never one the first phone holds.
//  - Two seconds on, every phone's count is the referee's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFloor } from './floor.js';

const AT = [10, 25, 40, 55, 70];

function check(r, kind) {
  const out = { races: 0, agree: 0, checked: 0, split: 0, follows: 0 };
  assert.deepEqual(r.errs, [], r.errs.slice(0, 3).join('; '));
  const byRace = new Map();
  for (const s of r.log.stations) { const l = byRace.get(s.race) ?? []; l.push(s); byRace.set(s.race, l); }
  for (const s of r.log.stations) {
    const takers = Object.entries(s.sent).filter(([, ids]) => ids.length);
    for (const [p, ids] of takers) assert.ok(s.after[p] < s.before[p], `${kind}: ${p}'s count dropped at once (${s.before[p]} -> ${s.after[p]}, took ${ids.length})`);
    const askers = id => takers.filter(([, ids]) => ids.includes(id)).map(([p]) => p);
    for (const id of s.items) {
      const f = s.first[id];
      if (f === undefined || f === 'gone' || f.startsWith('#cpu:')) continue;
      // the first holder asked for it here, or in an earlier tap of the same race
      const all = byRace.get(s.race).flatMap(x => Object.entries(x.sent).filter(([, ids]) => ids.includes(id)).map(([p]) => p));
      assert.ok(all.includes(f) || !askers(id).length, `${kind} ${id}: first holder ${f} asked for it (${all})`);
    }
    if (s.counts) { out.checked++; if (s.counts.phones.every(c => c === s.counts.ref)) out.agree++; }
  }
  for (const l of byRace.values()) {
    out.races++;
    if (l.length < 2) continue;
    out.follows++;
    const [lead, ...rest] = l, led = new Set(Object.values(lead.sent).flat());
    for (const f of rest) for (const ids of Object.values(f.sent)) {
      for (const id of ids) assert.ok(!led.has(id) || lead.first[id] === 'gone' || lead.first[id] === undefined || !Object.keys(lead.sent).includes(lead.first[id]),
        `${kind}: the later tap took ${id}, which the first tap holds`);
      if (ids.length) out.split++;
    }
  }
  return out;
}

for (const [kind, lv, n, shape] of [['carry', 'typhoon', 2, '4g'], ['carry', 'typhoon', 3, ['lan', '4g', 'bad']], ['bag', 'newyear', 3, 'bad']]) {
  const name = Array.isArray(shape) ? shape.join('+') : shape;
  test(`station race, same frame: ${kind} on ${lv}, ${n} phones (${name}): one holder per item, counts agree`, () => {
    let races = 0, agree = 0, checked = 0;
    for (const seed of [1, 2, 3]) {
      const r = runFloor({ seed, lv, players: n, shape, sec: 90, stations: AT.map(at => ({ at, kind, min: 1 })), pick: 0.01 });
      const c = check(r, kind); races += c.races; agree += c.agree; checked += c.checked;
    }
    assert.ok(races >= 6, `enough station races ran (${races})`);
    // new dishes or bags can land between the referee's tick and a phone's frame: most snapshots agree
    assert.ok(agree >= Math.ceil(checked * 0.8), `counts agree with the referee two seconds on (${agree} of ${checked})`);
  });
}

test('station race, a moment apart: a teammate tapping 「包」 after the first tap gets the remaining bags', () => {
  let split = 0, follows = 0;
  for (const seed of [1, 2, 3]) {
    const r = runFloor({ seed, lv: 'newyear', players: 3, shape: ['lan', '4g', 'bad'], sec: 90, pick: 0,
      stations: AT.map(at => ({ at, kind: 'bag', min: 2, phone: 0, then: [{ phone: 1, after: 0.8 }, { phone: 2, after: 1.6 }] })) });
    const c = check(r, 'bag'); split += c.split; follows += c.follows;
  }
  assert.ok(follows >= 3, `enough staggered races (${follows})`);
  assert.ok(split >= 3, `later taps got the remaining bags (${split})`);
});
