// The new roles follow the ladder (guards "Gates", "Data" and "Party").
// - Gates: a fresh save has no new role; each opens (its 員工培訓 lesson, then its seat) once the main level that brings
//   it (core/work/roles.ts ROLE_INTRO) is open, in the ladder's order; a save that already learned a seat keeps it.
// - Data: a picker never offers a seat outside a level's `roles`; off the levels only the roles the save has reached.
// - Party: the party ladder runs in the solo order, each shop's roles are its level's and arrive where the solo ladder
//   brings them; every seat a night uses is one of that shop's (the four and its `roles`), and the room runs exactly
//   those stations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore } from './core.js';
import { LEVELS, LEVEL_ORDER } from './levels.js';
import { buildPool, playNight, SHOP_TEAM } from './party-team.js';

const C = freshCore();
const KINDS = ['runner', 'roast', 'takeaway'];
const MAIN = LEVEL_ORDER.filter(id => !LEVELS[id].era && !LEVELS[id].fest && !LEVELS[id].hell).map(id => ({ id, n: LEVELS[id].n }));
/** A save that passed the main ladder up to level `n` with a star each. */
const passed = n => Object.fromEntries(MAIN.filter(l => l.n <= n).map(l => [l.id, 1]));
const openAt = n => k => C.roleOpen(k, {}, passed(n), MAIN);

test('gates: a fresh save has no new role; each opens with the main level that brings it; bonus stars do not; a learned seat stays', () => {
  for (const k of KINDS) assert.equal(C.roleOpen(k, {}, {}, MAIN), false, `${k} on a fresh save`);
  const rows = [];
  for (let n = 0; n <= 7; n++) {
    const open = KINDS.filter(openAt(n));
    rows.push(`${n}: ${open.join(',') || '-'}`);
    assert.deepEqual(open, KINDS.filter(k => C.ROLE_INTRO[k] <= n + 1), `main ladder passed up to ${n}`);
  }
  console.log('roles open after each main level:', rows.join(' | '));
  assert.deepEqual(C.ROLE_INTRO, { runner: 2, takeaway: 3, roast: 6 });   // 洗碗 retired
  // a bonus level with a role (e.g. 九龍城寨 has 燒味) does not bring the role ahead of the main ladder
  const bonus = Object.fromEntries(LEVEL_ORDER.filter(id => LEVELS[id].era).map(id => [id, 3]));
  for (const k of KINDS) assert.equal(C.roleOpen(k, {}, { ...bonus, estate: 1 }, MAIN), k === 'runner', `${k} with every bonus level at three stars`);
  // an old save that learned a seat before the gates keeps it
  assert.equal(C.roleOpen('roast', { roast: true }, {}, MAIN), true);
});

test('data: no seat is offered outside a level\'s roles; off the levels, only the roles the save has reached', () => {
  const all = () => true;
  for (const id of LEVEL_ORDER) {
    const L = LEVELS[id], offered = C.seatsOffered(L, all);
    for (const k of offered) assert.ok((L.roles?.[k] ?? 0) > 0, `${id} offers ${k} without the station`);
    // roles only: 傳菜 / 外賣 are 樓面's tasks, never offered as seats
    assert.ok(!offered.some(k => C.isFloorTask(k)), `${id} offers a 樓面 task as a seat`);
    assert.deepEqual(offered, C.levelRoles(L).filter(k => !C.isFloorTask(k)), `${id} offers every role it has`);
    assert.deepEqual(C.seatsOffered(L, openAt(0)), [], `${id}: nothing on a fresh save`);
  }
  for (let n = 0; n <= 7; n++) assert.deepEqual(C.seatsOffered(null, openAt(n)), KINDS.filter(k => !C.isFloorTask(k)).filter(openAt(n)), `free play after level ${n}`);
  assert.deepEqual(C.seatsOffered(null, openAt(0)), [], 'a fresh save gets no new seat in free play');
});

// The ladder (外賣 at 旺角, tier 2 at 機場) holds for the party shops too; 傳菜 and 外賣 are 樓面's tasks there
test('party: the ladder runs in the solo order and each shop brings its roles where the solo ladder does', () => {
  const ladder = [...C.SHOP_LADDER], main = ladder.filter(id => !LEVELS[id].hell);
  assert.deepEqual(ladder, ['estate', 'central', 'mongkok', 'airport', 'hell']);
  for (let i = 1; i < main.length; i++) assert.ok(LEVELS[main[i]].n > LEVELS[main[i - 1]].n, `${main[i]} after ${main[i - 1]}`);
  assert.ok(LEVELS[ladder[ladder.length - 1]].hell, 'the top rung is the 修羅場 level');
  let had = [];
  for (const shop of ladder) {
    const lv = { ...(LEVELS[shop].roles ?? {}) }; delete lv.wash;   // no 洗碗 on party nights
    assert.deepEqual(C.PARTY_SHOPS[shop].roles ?? {}, lv, `${shop}: the level's own roles and tiers, less 洗碗`);
    const roles = C.levelRoles(C.PARTY_SHOPS[shop]);
    // every party shop seats 樓面's two places in 伙記's (and 傳菜's and 外賣's) (屋邨 too)
    assert.equal(C.partyFloor(shop), true);
    assert.deepEqual(C.partySeats(shop), ['floor1', 'floor2', 'bar', 'kitchen', 'till', ...roles.filter(k => k !== 'runner' && k !== 'takeaway')]);
    assert.ok(!C.partySeats(shop).includes('wash'), `${shop}: no 洗碗 seat`);
    for (const k of had) assert.ok(roles.includes(k), `${shop} keeps ${k}`);
    for (const k of roles.filter(x => !had.includes(x))) assert.ok(LEVELS[shop].hell || LEVELS[shop].n === C.ROLE_INTRO[k], `${k} first appears at ${shop}, the solo ladder brings it at level ${C.ROLE_INTRO[k]}`);
    had = roles;
  }
});

test('party guard: every seat a night uses is in that shop\'s roles, the room runs exactly them, and a climb brings the next shop\'s', async () => {
  const pool = await buildPool({ cells: C.SHOP_LADDER.map(shop => ({ shop, model: SHOP_TEAM[shop] })), n: 2, seed0: 860001 });
  let extraDriven = 0;
  for (const [i, shop] of C.SHOP_LADDER.entries()) {
    const night = playNight(C, { seed: 8600 + i, pool, cfg: { shop }, players: 5, moves: .8, churn: .1, check: true });
    assert.deepEqual(night.errs, [], shop);   // checkNight: every seat of the night is one of the shop's
    const ok = C.partySeats(shop);
    for (const plan of night.plans) {
      for (const seat of Object.keys(plan.seats)) assert.ok(ok.includes(seat), `${shop} round ${plan.round}: seat ${seat}`);
      for (const [seat, p] of Object.entries(plan.seats)) if (p && !C.PARTY_SEATS.includes(seat)) extraDriven++;
      const sh = C.roomPartyShift(plan, {});
      assert.deepEqual(sh.extra, C.levelRoles(C.PARTY_SHOPS[shop]), `${shop}: the room runs the shop's stations`);
      for (const seat of Object.keys(sh.seated)) assert.ok(ok.includes(seat));
      assert.deepEqual(sh.party.roles ?? {}, C.PARTY_SHOPS[shop].roles ?? {}, 'the stations read the shop\'s tiers');
    }
  }
  assert.ok(extraDriven > 0, 'players took the new seats on some rounds');
  // 再開一日 one shop up: the seats follow the shop; who sat at the four keeps their seat
  const N = C.partySeam(7, { shop: 'estate' });
  N.input({ k: 'join', player: 'a', name: 'a' }); N.input({ k: 'seat', player: 'a', seat: 'bar' });
  assert.deepEqual(Object.keys(N.night().seats), C.partySeats('estate'));
  N.input({ k: 'setup', player: 'a', cfg: { shop: 'airport' } });
  assert.deepEqual(Object.keys(N.night().seats), C.partySeats('airport'));
  // every party shop seats 樓面: a 樓面 place is kept up and down the ladder
  N.input({ k: 'seat', player: 'a', seat: 'floor2' });
  assert.equal(N.night().seats.floor2, 'a');
  N.input({ k: 'setup', player: 'a', cfg: { shop: 'estate' } });
  assert.equal(N.night().seats.floor2, 'a');
  N.input({ k: 'setup', player: 'a', cfg: { shop: 'hell' } });
  N.input({ k: 'seat', player: 'a', seat: 'roast' });
  N.input({ k: 'setup', player: 'a', cfg: { shop: 'estate' } });
  assert.deepEqual(Object.keys(N.night().seats), C.partySeats('estate'));
  assert.equal(N.night().players[0].seat, null, 'a seat the new shop does not have: the player stands up');
  assert.deepEqual(C.checkNight(N.night()), []);
});
