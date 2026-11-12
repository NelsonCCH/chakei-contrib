// The core tuning rules (easing, the third star, fever and tips, the player picking the ticket) on the shop's rules alone: no browser, a fresh
// copy of src/core per test, the clock stepped by hand. Each rule is checked on its happy path, its unhappy paths and
// what it leaves behind; the screens that show these rules are checked in the browser suites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore, simPort } from './core.js';

/** A fresh shop with the player at `station` and nobody arriving by themselves (G.nextSpawn far away). */
function shop({ station = 'waiter', slot = 'lunch', diff = 'pro', seed = 7 } = {}) {
  const C = freshCore();
  C.setRng(C.mulberry32(seed)); C.setPort(simPort(C));
  C.setStation(station); C.setSlot(slot); C.setDiff(diff);
  C.newGame();
  const G = C.G;
  G.nextSpawn = 1e9;
  return { C, G };
}
/** Steps the rules `sec` seconds in 1/60 s steps (as the page's fixed-step clock does). */
const play = (C, sec) => { for (let i = 0; i < Math.round(sec * 60) && C.G.running; i++) C.CORE_HOOK.update(1 / 60); };
/** A seated group that has ordered `keys` (the right order), at table 0. */
function ordered(C, wantMeals = 1) {
  for (let tries = 0; tries < 200; tries++) {
    const g = C.makeGroup();
    if (g.items.filter(C.isMeal).length < wantMeals || g.size > 4) continue;
    C.CORE_HOOK.enqueue(g); C.seat(g, C.G.tables[0]);
    C.submitOrder(g, [...g.items]);
    return g;
  }
  throw new Error('no group with ' + wantMeals + ' meals');
}

/* ---------------------------------------------------------------- the computer kitchen */
test('the computer kitchen plates the first dish 8 s after the order and each further dish 1.5 s later', () => {
  const { C, G } = shop({ station: 'waiter' });
  assert.equal(C.CFG.cook, 8);
  const g = ordered(C, 2), t0 = G.t;
  assert.deepEqual(g.meals.map(m => m.doneAt - t0), g.meals.map((_, i) => 8 + 1.5 * i));
  play(C, 7.9);
  assert.ok(g.meals.every(m => !m.done), 'nothing is ready before 8 s');
  play(C, .2);
  assert.ok(g.meals[0].done && !g.meals[1].done, 'the first dish at 8 s, the second still cooking');
  play(C, 1.5);
  assert.ok(g.meals.slice(0, 2).every(m => m.done), 'the second at 9.5 s');
});

test('a human kitchen is never cooked for by the computer, however long the order waits', () => {
  const { C, G } = shop({ station: 'kitchen' });
  const g = ordered(C, 1);
  play(C, 20);
  assert.ok(g.meals.every(m => !m.done), 'the player cooks: the computer leaves the dish alone');
  assert.ok(G.groups.includes(g), 'and the group still waits (food patience 70 s)');
});

/* ---------------------------------------------------------------- the bar opens by itself */
test('nobody boils the tea pot: at 20 s the computer boils the first pot, the shop opens and the shift clock starts from 0', () => {
  const { C, G } = shop({ station: 'bar' });
  G.nextSpawn = 1.5;
  assert.deepEqual([G.phase, G.pot.st], ['prep', 'empty']);
  C.drainFx();
  play(C, 19.9);
  assert.deepEqual([G.phase, G.pot.st, G.t], ['prep', 'empty', 0], 'still closed just before 20 s, and the shift clock waits');
  assert.equal(G.groups.length, 0, 'nobody comes in before the shop opens');
  play(C, .2);
  assert.deepEqual([G.phase, G.pot.st, G.pot.level], ['open', 'ready', C.CFG.potCap], 'a full pot and the doors open');
  const fx = C.drainFx();
  assert.ok(fx.some(e => e.k === 'say' && e.role === 'bar' && /師傅幫你煲咗頭一壺/.test(e.msg)), 'the bar is told who boiled it');
  assert.ok(fx.some(e => e.k === 'toast' && e.msg === '開門！'));
  assert.ok(G.t < .1, 'the 180 s shift starts at the opening, not at the first tap');
  play(C, 3);
  assert.ok(G.groups.length > 0, 'customers arrive after it opens');
  // the player can work straight away, with tea from the pot the computer boiled
  C.barKey('hot'); C.barKey('茶');
  assert.equal(G.pot.level, C.CFG.potCap - 1);
});

test('a player who started the pot keeps it (no takeover mid-boil); the other stations never had a prep phase', () => {
  const { C, G } = shop({ station: 'bar' });
  play(C, 19);
  C.barKey('pot');
  assert.equal(G.pot.st, 'boil');
  play(C, 2);
  assert.deepEqual([G.phase, G.pot.st], ['prep', 'boil'], 'past 20 s but the player is boiling: the computer stays out');
  play(C, 2.1);
  assert.equal(G.pot.st, 'steep');
  play(C, 3.1);
  assert.deepEqual([G.phase, G.pot.st], ['prep', 'pull'], 'and the player still pulls it');
  while (G.pot.st === 'pull') C.barKey('pot');
  play(C, .1);
  assert.equal(G.phase, 'open');
  for (const station of ['waiter', 'kitchen', 'till']) {
    const s = shop({ station });
    assert.deepEqual([s.G.phase, s.G.pot.st], ['open', 'ready'], station);
  }
});

/* ---------------------------------------------------------------- fever and tips: see fever.test.js */

/* ---------------------------------------------------------------- a ceiling to chase */
test('easing: a mistake spaces customers out by .12, never past 1.2, and it wears off to 1 at .01 a second; good work still tightens it', () => {
  const { C, G } = shop();
  C.juiceTick();
  for (let i = 0; i < 5; i++) { G.mistakes++; C.juiceTick(); }
  assert.equal(G.ease, 1.2, 'five mistakes: capped at 1.2 (was 1.5)');
  play(C, 10);
  assert.ok(Math.abs(G.ease - 1.1) < 1e-6, 'half way back after 10 s: ' + G.ease);
  play(C, 10.1);
  assert.equal(G.ease, 1, 'back to 1 after 20 s, and no lower by itself');
  for (let i = 0; i < 10; i++) C.good();
  assert.ok(Math.abs(G.ease - .9) < 1e-9, 'a run of good work brings customers closer, as before (pro floor .9)');
  play(C, 5);
  assert.ok(Math.abs(G.ease - .9) < 1e-9, 'the wear-off only brings a spaced-out shop back, never a busy one');
});

test('third star: each station times its own jobs only, from the right start, and the line decides', () => {
  // waiter: sitting down to the order sent, by the player only (timed where the order result is applied)
  {
    const { C, G } = shop({ station: 'waiter' });
    const g = C.makeGroup(); C.CORE_HOOK.enqueue(g); C.seat(g, G.tables[0]);
    play(C, 2.5); C.submit('waiter', { k: 'order', gid: g.id, keys: [...g.items], peeked: false });
    const h = C.makeGroup(); C.CORE_HOOK.enqueue(h); C.seat(h, G.tables[1]); play(C, 9); C.submitOrder(h, [...h.items]);
    assert.equal(G.spd.waiter[0], 1, 'a slip the player did not send is not the player\'s speed');
    assert.ok(Math.abs(G.spd.waiter[1] - 2.5) < .02);
    assert.deepEqual([C.speedGoal('waiter', false).ok, C.speedGoal('waiter', false).need, C.speedGoal('waiter', true).need], [true, 14, 14]);
    G.spd.waiter = [2, 28.2];
    assert.equal(C.speedGoal('waiter', false).ok, false, 'an average of 14.1 s misses the free-play line of 14 s');
    assert.equal(C.speedGoal('waiter', true).ok, false, 'and the level line of 14 s');
    G.spd.waiter = [2, 27.8];
    assert.equal(C.speedGoal('waiter', true).ok, true, '13.9 s makes it');
    C.noteSpeed('bar', 1);
    assert.equal(G.spd.bar, undefined, 'a station the computer runs is never timed');
  }
  // bar: the order sent to the cup served (queue included)
  {
    const { C, G } = shop({ station: 'bar' });
    G.phase = 'open'; G.pot.st = 'ready'; G.pot.level = C.CFG.potCap;
    let g; do g = ordered(C, 0); while (!g.drinks.length);
    play(C, 6);
    G.bench.target = { gid: g.id, i: 0 }; C.barKey('hot'); C.barKey('serve');
    assert.equal(G.spd.bar[0], 1); assert.ok(Math.abs(G.spd.bar[1] - 6) < .02);
    assert.equal(C.speedGoal('bar', false).ok, true);
    G.spd.bar = [1, 26];
    assert.deepEqual([C.speedGoal('bar', false).ok, C.speedGoal('bar', true).ok], [true, false], '26 s: makes free play\'s 27 s, misses the levels\' 25.5 s');
  }
  // till: the bill reaching the counter to the customer done
  {
    const { C, G } = shop({ station: 'till' });
    C.tillWarmup();
    while (!G.cur && G.t < 30) play(C, .1);
    assert.ok(G.cur, 'a bill reached the till');
    const at = G.billAt; play(C, 3); C.finishCust('唔該！');
    assert.equal(G.spd.till[0], 1); assert.ok(Math.abs(G.spd.till[1] - (G.t - at)) < 1e-9 && G.spd.till[1] >= 3);
  }
  // kitchen: dishes plated in free play (27), the ticket time in the levels (29 s); nothing done is never a pass
  {
    const { C, G } = shop({ station: 'kitchen' });
    assert.deepEqual(C.speedGoal('kitchen', true), { st: 'kitchen', kind: 'avg', need: 29, have: null, ok: false });
    G.dishes = 26; assert.deepEqual(C.speedGoal('kitchen', false), { st: 'kitchen', kind: 'count', need: 27, have: 26, ok: false });
    G.dishes = 27; assert.equal(C.speedGoal('kitchen', false).ok, true);
    C.noteSpeed('kitchen', 30); assert.equal(C.speedGoal('kitchen', true).ok, false);
    C.noteSpeed('kitchen', 20); assert.equal(C.speedGoal('kitchen', true).ok, true, 'average 25 s');
    C.newGame();
    assert.equal(C.G.spd, undefined, 'a new shift starts with no timings');
  }
});

/* ---------------------------------------------------------------- the player picks the ticket */
test('bar: after a cup nothing is picked for the player; serving with nothing picked says so; a redo or a leaving table only drops the pick', () => {
  const { C, G } = shop({ station: 'bar' });
  G.phase = 'open'; G.pot.st = 'ready'; G.pot.level = C.CFG.potCap;
  let g; do g = ordered(C, 0); while (g.drinks.length < 2);
  C.drainFx();
  C.barKey('hot'); C.barKey('serve');
  assert.equal(G.bench.target, null, 'no ticket picked at the start');
  assert.ok(C.drainFx().some(e => e.k === 'toast' && e.msg === '撳上面張飛揀做邊杯'), 'serving with nothing picked asks for a ticket');
  assert.equal(g.drinks[0].done, false, 'and serves nothing');
  G.bench.target = { gid: g.id, i: 0 }; C.barKey('serve');
  assert.equal(g.drinks[0].done, true);
  assert.equal(G.bench.target, null, 'the next cup of the same table is not picked by itself (it used to be)');
  assert.ok(C.nextTarget(null), 'though there is one waiting');
  // a wrong cup sent back: the ticket returns to the rail, unpicked
  g.drinks.forEach(d => { d.done = true; d.ok = false; });
  g.meals.forEach(m => { m.done = true; });
  G.bench.target = null;
  C.serve(g);
  assert.deepEqual([g.drinks.every(d => !d.done && d.redo), G.bench.target], [true, null], 'the redo waits for the player to pick it');
  // a table served while its cup is picked: the pick is dropped, nothing else is picked
  const h = ordered(C, 0);
  G.bench.target = { gid: g.id, i: 0 };
  g.drinks.forEach(d => { d.done = true; d.ok = true; });
  C.serve(g);
  assert.equal(G.bench.target, null);
  assert.ok(G.groups.includes(h));
});

test('kitchen: after a dish nothing is picked; serving with nothing picked asks for a ticket (or says there is none); a redo waits to be picked', () => {
  const { C, G } = shop({ station: 'kitchen' });
  C.drainFx();
  C.kitKey('serve');
  assert.ok(C.drainFx().some(e => e.k === 'toast' && e.msg === '暫時冇飛'), 'no tickets at all: none');
  const g = ordered(C, 2);
  C.kitKey('serve');
  assert.ok(C.drainFx().some(e => e.k === 'toast' && e.msg === '撳上面張飛揀做邊碟'), 'tickets waiting, none picked: pick one');
  assert.equal(G.ksel, null);
  C.assignMeal(g.id, 0);
  C.activePlate().tokens = [...C.kitRecipe(g.meals[0].k)];
  C.kitKey('serve');
  assert.deepEqual([g.meals[0].done, g.meals[0].ok, G.ksel], [true, true, null], 'plated, and the next dish is not picked by itself');
  assert.ok(C.nextMeal(null), 'though one is waiting');
  // a dish sent back
  g.meals.forEach(m => { m.done = true; m.ok = false; });
  g.drinks.forEach(d => { d.done = true; });
  C.serve(g);
  assert.deepEqual([g.meals.every(m => !m.done && m.redo), G.ksel], [true, null]);
});
