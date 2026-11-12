// 執枱 table-clearing station core (src/stations-next/clear/core.ts), in memory: the bot clears many tables on many
// seeds at every tier (and a sloppy bot over-taps, so resets happen) while invariants are checked after every command:
// each item is removed exactly once per attempt, an over-tap restores the starting set, `cleared` comes once per table.
// Also the referee seam (table / cancel events), a JSON hand-over mid-table, fair layouts, and purity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStation, countingRng, ctxFor } from './helpers/stations-sim.js';

const core = await loadStation('clear');
const bots = await loadStation('clear', 'bot');
const { clear, TUNE, TIER_MAX } = core;
const STEP = 1 / 60;
const startSet = tb => JSON.stringify(tb.items.map(({ goneAt, ...rest }) => rest));

/** Drives the core with a bot until `until` or maxT, checking the invariants on every result. */
function play(s, { rng = countingRng(1), t = 0, maxT = 120, bot = clear.bot.next, until = () => false, results = [], track = new Map() } = {}) {
  while (t < maxT && !until(s, t)) {
    const ctx = ctxFor(t, rng);
    const tb = s.tables[0];
    if (tb && !track.has(tb.table)) track.set(tb.table, { start: startSet(tb), removed: new Set(), resets: 0 });
    const c = bot(s, ctx);
    if (c) {
      const before = tb ? tb.items.map(it => it.goneAt) : [];
      const out = clear.command(s, c, ctx);
      results.push(...out);
      if (tb && c.t === 'tap') {
        const tr = track.get(tb.table);
        const reset = out.find(r => r.kind === 'reset');
        if (reset) {
          tr.resets++; tr.removed = new Set();
          assert.ok(tb.items.every(it => it.goneAt === null), 'a reset brings every item back');
          assert.equal(startSet(tb), tr.start, 'a reset restores the starting set exactly');
          assert.ok(tb.items.every((it, i) => it.k !== c.k || before[i] !== null), 'a reset only on a kind with none left');
        } else if (before.length) {
          const now = tb.items.map(it => it.goneAt), changed = now.map((g, i) => (g !== null && before[i] === null ? i : -1)).filter(i => i >= 0);
          if (s.pen === 0 && before.some(g => g === null)) {
            assert.equal(changed.length, 1, 'one tap removes exactly one item');
            const i = changed[0];
            assert.equal(tb.items[i].k, c.k, 'the removed item is of the tapped kind');
            assert.ok(!tr.removed.has(i), 'never removed twice in one attempt');
            tr.removed.add(i);
          }
        }
      }
    }
    results.push(...clear.step(s, STEP, ctx));
    t += STEP;
  }
  return { s, results, t, track };
}

test('the bot clears tables on many seeds at every tier: each item once per attempt, cleared once per table', () => {
  for (let tier = 1; tier <= TIER_MAX; tier++) {
    for (let k = 0; k < 4; k++) {
      const seed = 500 + tier * 97 + k * 13, rng = countingRng(seed);
      const s = clear.init({ difficulty: 'pro', tier, seed, players: 1 }, 's1');
      const { results, track } = play(s, { rng, maxT: 90, until: st => st.sess.tables >= 3 });
      assert.equal(s.sess.tables, 3, `tier ${tier} seed ${seed}: three tables cleared`);
      const cleared = results.filter(r => r.kind === 'cleared');
      assert.equal(cleared.length, 3, 'one cleared result per table');
      assert.equal(new Set(cleared.map(r => r.table)).size, 3, 'never cleared twice');
      assert.equal(results.filter(r => r.kind === 'reset').length, 0, 'a careful bot never over-taps');
      for (const r of cleared) {
        const tr = track.get(r.table), n = JSON.parse(tr.start).length;
        assert.equal(tr.removed.size, n, 'every item removed exactly once');
        assert.equal(r.taps, n, 'taps = items when nothing went wrong');
        assert.ok(r.secs > 0 && typeof r.at === 'number');
      }
      const T = TUNE.tiers[tier - 1];
      for (const [, tr] of track) for (const kd of ['plate', 'bowl', 'cup']) {
        const c = JSON.parse(tr.start).filter(it => it.k === kd).length;
        if (tr.removed.size) assert.ok(c >= T.lo && c <= T.hi, `tier ${tier}: ${kd} count ${c} in ${T.lo}..${T.hi}`);
      }
    }
  }
});

test('a sloppy bot over-taps: the table resets to its start set, taps lock for a moment, the time grows', () => {
  let resets = 0;
  for (let k = 0; k < 6; k++) {
    const seed = 70 + k, rng = countingRng(seed), bot = bots.makeClearBot({ skill: 0.5 });
    const s = clear.init({ difficulty: 'ace', seed, players: 1 }, 's1');
    const { results } = play(s, { rng, bot, maxT: 300, until: st => st.sess.tables >= 3 });
    assert.equal(s.sess.tables, 3, 'still clears in the end');
    const rs = results.filter(r => r.kind === 'reset'), cl = results.filter(r => r.kind === 'cleared');
    assert.equal(rs.length, s.sess.resets);
    assert.equal(cl.reduce((a, r) => a + r.resets, 0), rs.length, 'the cleared results carry their resets');
    resets += rs.length;
  }
  assert.ok(resets >= 4, `resets happen (${resets})`);
  // by hand: an over-tap locks taps for resetPen
  const s = clear.init({ difficulty: 'rookie', seed: 3, players: 1 }, 's1'), rng = countingRng(3);
  clear.step(s, STEP, ctxFor(0, rng));
  clear.onEvent(s, { kind: 'noop' }, ctxFor(0, rng));
  const tb = s.tables[0], cups = tb.items.filter(it => it.k === 'cup').length;
  for (let i = 0; i < cups; i++) assert.deepEqual(clear.command(s, { t: 'tap', k: 'cup' }, ctxFor(0, rng)), []);
  const out = clear.command(s, { t: 'tap', k: 'cup' }, ctxFor(1, rng));
  assert.deepEqual(out, [{ kind: 'reset', at: 1, table: tb.table }]);
  assert.equal(s.pen, TUNE.resetPen);
  assert.deepEqual(clear.command(s, { t: 'tap', k: 'plate' }, ctxFor(1, rng)), [], 'locked');
  assert.ok(tb.items.every(it => it.goneAt === null), 'the locked tap took nothing');
  assert.equal(tb.taps, cups + 1, 'locked taps are not counted');
  clear.step(s, TUNE.resetPen + 0.01, ctxFor(1, rng));
  clear.command(s, { t: 'tap', k: 'plate' }, ctxFor(2, rng));
  assert.equal(tb.items.filter(it => it.goneAt !== null).length, 1, 'taps work again after the lock');
});

test('referee seam: table events feed, resends and junk are ignored, cancel takes one back, secs run from the feed', () => {
  const rng = countingRng(9), s = clear.init({ difficulty: 'pro', seed: 9, players: 2, selfFeed: false }, 's2');
  play(s, { rng, maxT: 2 });
  assert.equal(s.tables.length, 0, 'fed mode makes no tables of its own');
  assert.equal(clear.status(s, ctxFor(2, rng)).waiting, 0);
  assert.ok(clear.status(s, ctxFor(2, rng)).idleFor > 1.5);
  clear.onEvent(s, { kind: 'table', table: 3, name: '三號卡', items: { plate: 2, bowl: 1, cup: 3 } }, ctxFor(2, rng));
  clear.onEvent(s, { kind: 'table', table: 3, name: '三號卡', items: { plate: 9, bowl: 9, cup: 9 } }, ctxFor(2, rng));
  clear.onEvent(s, { kind: 'table', table: 4, name: 'x', items: { plate: -1, bowl: 1, cup: 1 } }, ctxFor(2, rng));
  clear.onEvent(s, { kind: 'table', table: 5, name: 'x', items: { plate: 0, bowl: 0, cup: 0 } }, ctxFor(2, rng));
  clear.onEvent(s, { kind: 'table', table: 7, name: '七號枱', items: { plate: 1, bowl: 2, cup: 1 } }, ctxFor(2, rng));
  clear.onEvent(s, { kind: 'table', table: 8, name: '八號枱', items: { plate: 1, bowl: 0, cup: 0 } }, ctxFor(2, rng));
  assert.deepEqual(s.tables.map(tb => tb.table), [3, 7, 8]);
  assert.equal(s.tables[0].items.length, 6, 'the resend did not change table 3');
  assert.equal(clear.status(s, ctxFor(2, rng)).waiting, 3);
  clear.onEvent(s, { kind: 'cancel', table: 7 }, ctxFor(2, rng));
  clear.onEvent(s, { kind: 'cancel', table: 99 }, ctxFor(2, rng));
  assert.deepEqual(s.tables.map(tb => tb.table), [3, 8]);
  const { results } = play(s, { rng, t: 2, maxT: 60, until: st => st.tables.length === 0 && st.hold === 0 });
  assert.deepEqual(results.map(r => [r.kind, r.table]), [['cleared', 3], ['cleared', 8]]);
  const r8 = results[1];
  assert.ok(r8.secs > results[0].secs, 'table 8 waited behind table 3: its secs run from its feed');
  // cancelling the table on screen brings the next one up at once
  clear.onEvent(s, { kind: 'table', table: 1, name: 'a', items: { plate: 1, bowl: 1, cup: 1 } }, ctxFor(60, rng));
  clear.onEvent(s, { kind: 'table', table: 2, name: 'b', items: { plate: 1, bowl: 1, cup: 1 } }, ctxFor(60, rng));
  clear.command(s, { t: 'tap', k: 'plate' }, ctxFor(60, rng));
  clear.onEvent(s, { kind: 'cancel', table: 1 }, ctxFor(60, rng));
  assert.equal(s.tables[0].table, 2);
  assert.ok(s.tables[0].items.every(it => it.goneAt === null) && s.lastK === null);
});

test('a hand-over by value mid-table (JSON) continues identically', () => {
  for (const tier of [1, 4, 8]) {
    const seed = 4242 + tier, rng = countingRng(seed), bot = bots.makeClearBot({ skill: 0.6 });
    const s = clear.init({ difficulty: 'pro', tier, seed, players: 1 }, 's1');
    play(s, { rng, bot, until: st => st.sess.tables >= 1 && st.tables[0] && st.tables[0].items.some(it => it.goneAt !== null) });
    const t0 = s.t, n0 = rng.n, copy = JSON.parse(JSON.stringify(s));
    assert.ok(clear.validate(copy));
    assert.equal(JSON.stringify(copy), JSON.stringify(s), 'the state is plain JSON');
    const a = play(s, { rng, bot, t: t0, maxT: t0 + 40 }), b = play(copy, { rng: countingRng(seed, n0), bot, t: t0, maxT: t0 + 40 });
    assert.equal(JSON.stringify(b.s), JSON.stringify(a.s), `tier ${tier}: identical after 40 s`);
    assert.deepEqual(b.results, a.results);
  }
});

test('layouts are fair: dishes stay on the table and every one shows enough of itself to be counted', () => {
  const vis = (tb, i) => {
    const a = tb.items[i], above = tb.items.slice(i + 1);
    let n = 0, free = 0;
    for (let gy = -1; gy <= 1; gy += 0.1) for (let gx = -1; gx <= 1; gx += 0.1) {
      if (gx * gx + gy * gy > 1) continue;
      n++;
      const x = a.x + gx * a.r, y = a.y + gy * a.r;
      if (!above.some(b => Math.hypot(x - b.x, y - b.y) < b.r)) free++;
    }
    return free / n;
  };
  let worst = 1;
  for (let tier = 1; tier <= TIER_MAX; tier++) for (let k = 0; k < 25; k++) {
    const rng = countingRng(tier * 1000 + k), T = TUNE.tiers[tier - 1];
    const tb = core.layTable(rng, tier, k, 't', { plate: T.hi, bowl: T.hi, cup: T.hi }, 0);
    tb.items.forEach((it, i) => {
      assert.ok(it.x - it.r >= 0 && it.x + it.r <= TUNE.tw && it.y - it.r >= 0 && it.y + it.r <= TUNE.th, 'on the table');
      worst = Math.min(worst, vis(tb, i));
    });
  }
  assert.ok(worst >= 0.2, `the most hidden dish still shows ${worst.toFixed(2)} of itself`);
});

test('validate refuses broken hand-overs', () => {
  const s = clear.init({ difficulty: 'pro', seed: 5, players: 1 }, 's1');
  clear.step(s, STEP, ctxFor(0, countingRng(5)));
  assert.ok(clear.validate(s));
  const tb = s.tables[0];
  for (const bad of [null, 1, {}, { ...s, v: 2 }, { ...s, tier: 9 }, { ...s, tables: [{ ...tb, items: [{ k: 'fork' }] }] }, { ...s, lastK: 'pan' }, { ...s, sess: null }, { ...s, last: { ...tb } }])
    assert.equal(clear.validate(bad), false);
});

test('the core is pure: no clock and no Math.random while it runs', () => {
  const keep = { random: Math.random, now: Date.now, perf: performance.now };
  Math.random = () => { throw new Error('Math.random in core'); };
  Date.now = () => { throw new Error('Date.now in core'); };
  performance.now = () => { throw new Error('performance.now in core'); };
  try {
    const s = clear.init({ difficulty: 'ace', tier: 8, seed: 31337, players: 1 }, 's1');
    play(s, { rng: countingRng(3), bot: bots.makeClearBot({ skill: 0.5 }), maxT: 60 });
    assert.ok(s.sess.tables >= 1);
  } finally { Math.random = keep.random; Date.now = keep.now; performance.now = keep.perf; }
});
