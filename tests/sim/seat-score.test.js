// The new seats' score: every seat feeds 連擊, 少出錯 and 冇人嬲走 from its own results, has a third-star speed
// measure, and its targets are ones the seat can affect. The guard: at every new seat and every measure, a player who
// does nothing misses and the station's bot at full pace (the "perfect" player) meets it, on a level (屋邨茶記) and in
// the player's own shop (新人). Plus: progress code counts seats from one list (core/career/seats.ts), never its own
// array of the shop's four.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSeat } from './xseat.js';
import { STAR_LINES } from './levels.js';

const ROOT = new URL('../../', import.meta.url);
const KINDS = ['runner', 'roast', 'takeaway'];
// on a level, the seat's own intro level (a solo seat is offered only where the level has the station)
const INTRO = { runner: { name: '中環早餐', lv: 'central' }, takeaway: { name: '旺角晚市', lv: 'mongkok' }, roast: { name: '年廿八洗邋遢', lv: 'newyear' } };
const placesOf = kind => [INTRO[kind], { name: '自己舖 新人', diff: 'rookie', slot: 'lunch' }];

/** What one shift at `kind` scored, against every target a player can pick there and the third star. */
function score(kind, place, pace) {
  const r = runSeat({ seed: 11, kind, pace, ...(place.lv ? { lv: place.lv } : { diff: place.diff, slot: place.slot }) });
  assert.deepEqual(r.errs, [], `${kind} ${place.name}`);
  const { C, G } = r, sl = C.shiftSlips(G), rev = C.shiftMeasure(G);
  const s = { revenue: rev, mistakes: sl.mistakes, angry: sl.angry, maxCombo: G.maxCombo ?? 0, goods: G.goods ?? 0 };
  const out = {};
  // the first star (a level's line) or the 穩陣 營業額 target (the own shop), on the seat's own measure
  out.rev = place.lv ? rev >= STAR_LINES[place.lv][kind][0] : C.targetMet('rev', C.targetN({ metric: 'rev', tier: 'safe' }, kind, place.slot, place.diff), s);
  if (!place.lv) for (const metric of ['clean', 'calm', 'combo']) for (const tier of ['safe', 'bet'])
    out[`${metric}/${tier}`] = C.targetMet(metric, C.targetN({ metric, tier }, kind, place.slot, place.diff), s);
  out.speed = C.speedGoal(kind, !!place.lv).ok;
  return { out, s, sp: C.speedGoal(kind, !!place.lv) };
}

// No exceptions: every line and target was re-derived from the current rules.
for (const kind of KINDS) for (const place of placesOf(kind)) {
  test(`${kind} at ${place.name}: idle misses every measure, the station's bot at full pace meets every one`, { timeout: 120000 }, () => {
    const idle = score(kind, place, 0), bot = score(kind, place, 1);
    for (const [m, ok] of Object.entries(idle.out)) assert.equal(ok, false, `idle ${kind} ${place.name} passes ${m}: ${JSON.stringify(idle.s)}`);
    for (const [m, ok] of Object.entries(bot.out)) assert.equal(ok, true, `the bot at ${kind} ${place.name} misses ${m}: ${JSON.stringify(bot.s)} speed ${JSON.stringify(bot.sp)}`);
  });
}

// 傳菜: its measure is its own hot dishes, never the shop's takings (with the computer's 外賣 and 燒味 sales an
// idle runner made the first star on 年廿八 / 通宵 / 地獄午市); its speed, 每碟上枱, is per dish, so the station's bot
// at full pace, which carries the fullest trays, meets each level's line (STAR3_LEVEL).
test('傳菜 on every level that has it: idle earns no star; the bot at full pace meets the third-star speed', { timeout: 240000 }, async () => {
  const { LEVELS, LEVEL_ORDER } = await import('./levels.js');
  for (const lv of LEVEL_ORDER.filter(id => LEVELS[id].roles?.runner)) {
    const idle = runSeat({ seed: 11, kind: 'runner', pace: 0, lv });
    assert.deepEqual(idle.errs, [], lv);
    assert.equal(idle.C.shiftMeasure(idle.G), 0, `${lv}: an idle runner's measure`);
    assert.ok(idle.C.shiftMeasure(idle.G) < STAR_LINES[lv].runner[0] && !idle.C.speedGoal('runner', true).ok, `${lv}: idle earns no star`);
    const bot = runSeat({ seed: 11, kind: 'runner', pace: 1, lv }), sp = bot.C.speedGoal('runner', true);
    assert.ok(sp.ok, `${lv}: the bot at full pace ${sp.have?.toFixed(1)} s a dish against ${sp.need}`);
  }
});

test('燒味 counts a plate as done well at the counter\'s own 2-star quality', async () => {
  const { freshCore } = await import('./core.js');
  const C = freshCore(), src = readFileSync(new URL('src/stations-next/roast/core.ts', ROOT), 'utf8');
  const stars = /stars: \[(\d+), (\d+), (\d+)\]/.exec(src);
  assert.ok(stars, 'roast TUNE.stars found');
  assert.equal(C.ROAST_GOOD_Q, Number(stars[2]));
});

test('progress code has no array of the shop\'s four seats of its own (one seat list: core/career/seats.ts)', () => {
  const FOUR = ['waiter', 'kitchen', 'bar', 'till'];
  for (const f of ['ui/levels.ts', 'ui/market.ts', 'ui/dex.ts', 'ui/mastery.ts', 'ui/career.ts', 'ui/gates.ts']) {
    const src = readFileSync(new URL('src/' + f, ROOT), 'utf8');
    for (const m of src.matchAll(/\[[^[\]]*\]/g)) {
      const lit = m[0];
      assert.ok(!FOUR.every(s => lit.includes(`'${s}'`) || lit.includes(`"${s}"`)), `${f} lists the four itself: ${lit.slice(0, 80)}`);
    }
  }
});

// The daily challenge's seat: every seat can be drawn; a new seat only for a player who learned it and
// passed the main-ladder level that introduces it (ROLE_INTRO), else one of the four from the same draw.
test('daily challenge seat: a fresh save only gets the four; a new seat once learned and its intro level passed', async () => {
  const { freshCore } = await import('./core.js');
  const { LEVELS } = await import('./levels.js');
  // the draw is over the seats a player sits at: the four and the roles, never a 樓面 task
  const C = freshCore(), all = C.roleSeats(), FOUR = ['waiter', 'kitchen', 'bar', 'till'];
  const main = Object.entries(LEVELS).filter(([, L]) => !L.era && !L.hell && !L.fest).map(([id, L]) => ({ id, n: L.n }));
  const introId = k => main.find(l => l.n === C.ROLE_INTRO[k]).id;
  const draws = Array.from({ length: 800 }, (_, i) => (i + .5) / 800);
  const fresh = k => C.dailyOpen(k, {}, {}, main);
  const seen = new Set(draws.map(u => C.dailySeat(u, fresh)));
  assert.deepEqual([...seen].sort(), [...FOUR].sort(), 'a fresh save: the four only, each of them');
  assert.ok(!all.some(k => C.isFloorTask(k)), 'no 傳菜 / 外賣 day');
  for (const k of C.EXTRA_KINDS.filter(k => !C.isFloorTask(k))) {
    const learned = { [k]: true }, passed = { [introId(k)]: 1 };
    assert.equal(C.dailyOpen(k, learned, {}, main), false, k + ': learned but its intro level not passed');
    assert.equal(C.dailyOpen(k, {}, passed, main), false, k + ': intro level passed but not learned');
    assert.equal(C.dailyOpen(k, learned, passed, main), true, k + ': open');
    const open = x => C.dailyOpen(x, learned, passed, main);
    for (const u of draws) {
      const drawn = all[Math.floor(u * all.length)], got = C.dailySeat(u, open);
      if (FOUR.includes(drawn) || drawn === k) assert.equal(got, drawn, 'the day\'s draw, the same as for everyone with it open');
      else { assert.ok(FOUR.includes(got)); assert.equal(got, C.dailySeat(u, fresh), 'a closed new seat falls back the same way for everyone'); }
    }
  }
});
