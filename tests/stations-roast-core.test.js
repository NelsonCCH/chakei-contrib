// 燒味 station core (src/stations-next/roast): in memory, no browser. The bot plays whole shifts on many seeds at each
// difficulty; every customer ends exactly once; the money adds up; the state survives a JSON hand-over mid-shift and
// continues identically; 斬料 is cutting along dashed guides (even pieces, the right count, the 燒鴨 joints, guides
// that stay true after any cut); the referee seam (order / cancel events, lineDone results) works with self-feeding off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStation, countingRng, ctxOf, run } from './helpers/stations.js';

const R = await loadStation('roast');
const DIFFS = ['rookie', 'pro', 'ace'];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

test('the bot finishes a shift at every difficulty, many seeds, with good plates', () => {
  for (const d of DIFFS) for (const seed of SEEDS) {
    const s = R.roast.init({ difficulty: d, seed, players: 1 }, 's1');
    const res = run(R.roast, s, countingRng(seed), { secs: R.TUNE.shift + 1 });
    assert.equal(s.over, true, `${d}/${seed} ends`);
    assert.equal(res.filter(r => r.kind === 'shiftEnd').length, 1, `${d}/${seed} one end`);
    assert.ok(s.served >= 6, `${d}/${seed} served ${s.served}`);
    assert.ok(s.starsSum / s.served >= 2.5, `${d}/${seed} avg stars ${s.starsSum / s.served}`);
    assert.equal(s.left, 0, `${d}/${seed} nobody walks out on the bot`);
    assert.ok(R.validate(JSON.parse(JSON.stringify(s))));
  }
});

test('no customer is lost or served twice; the money adds up', () => {
  let walkouts = 0;
  for (const d of DIFFS) for (const seed of SEEDS) {
    const s = R.roast.init({ difficulty: d, seed, players: 1 }, 's1');
    const seen = new Map();
    // a clumsy bot: every 4th gesture is dropped half way (the finger lifts) and its aim is shaky, so walk-outs and dumps
    // happen too
    let n = 0;
    const res = run(R.roast, s, countingRng(seed * 7), {
      secs: R.TUNE.shift + 1,
      onStep: st => { for (const c of st.q) seen.set(c.gid, c); if (st.ai.steps.length > 3 && ++n % 4 === 0) st.ai.steps.splice(1, st.ai.steps.length - 2); if (st.ai.aim < 4) R.setBotAim(st, 4); },
    });
    const done = res.filter(r => r.kind === 'lineDone'), out = res.filter(r => r.kind === 'walkout');
    const ids = [...done, ...out].map(r => r.gid);
    assert.equal(new Set(ids).size, ids.length, `${d}/${seed}: a customer ended twice`);
    for (const id of ids) assert.ok(seen.has(id), `${d}/${seed}: result for unknown customer ${id}`);
    const pending = s.q.map(c => c.gid);
    assert.equal(seen.size, ids.length + pending.length, `${d}/${seed}: every customer is served, gone or still waiting`);
    assert.equal(done.length, s.served); assert.equal(out.length, s.left); walkouts += out.length;
    assert.equal(res.filter(r => r.kind === 'dumped').length, s.dumped);
    const pay = done.reduce((a, r) => a + r.pay, 0), tip = done.reduce((a, r) => a + r.tip, 0), loss = done.reduce((a, r) => a + r.loss, 0);
    assert.equal(pay, s.earned); assert.equal(tip, s.tips); assert.equal(loss, s.loss);
    assert.equal(s.score, s.earned + s.tips - s.loss - s.left * R.TUNE.leaveCost - s.dumped * R.TUNE.dumpCost, `${d}/${seed} score`);
    assert.equal(s.starsSum, done.reduce((a, r) => a + r.stars, 0));
    for (const r of done) {
      const [a, b, c] = R.TUNE.stars, m = R.MENU.find(x => x.name === r.made.item);
      assert.equal(r.stars, r.q >= c ? 3 : r.q >= b ? 2 : r.q >= a ? 1 : 0, 'stars follow quality');
      assert.ok(m && r.pay <= m.price + R.TUNE.vegPrice && r.tip <= R.TUNE.tipMax && (r.stars >= 2 || r.tip === 0), 'pay and tip in range');
    }
  }
  assert.ok(walkouts > 10, `the clumsy bot lets customers walk out (${walkouts}), so that path is covered`);
});

test('the state hands over by value mid-shift and the run continues identically', () => {
  for (const d of DIFFS) for (const seed of [11, 12, 13]) {
    const s = R.roast.init({ difficulty: d, seed, players: 1 }, 's1');
    const rng = countingRng(seed);
    // stop in the middle of a gesture, with a board and a plate in progress
    let at = 0;
    run(R.roast, s, rng, { secs: 40 + seed, onStep: (st, ctx) => { at = ctx.t; } });
    const copy = JSON.parse(JSON.stringify(s));
    assert.ok(R.validate(copy));
    assert.deepEqual(copy, s);
    const rng2 = countingRng(seed, rng.count);
    const a = run(R.roast, s, rng, { secs: 70, from: at });
    const b = run(R.roast, copy, rng2, { secs: 70, from: at });
    assert.deepEqual(b, a, `${d}/${seed} results`);
    assert.deepEqual(copy, s, `${d}/${seed} state`);
    assert.ok(s.served > 3);
  }
});

test('validate refuses broken hand-overs', () => {
  const s = R.roast.init({ difficulty: 'pro', seed: 1, players: 1 }, 's1');
  assert.ok(R.validate(s));
  for (const bad of [null, 3, [], {}, { ...s, v: 2 }, { ...s, diff: 'boss' }, { ...s, q: [{}] }, { ...s, plate: { ...s.plate, base: 'pizza' } }, { ...s, t: 'x' }, { ...s, board: { k: 'char' } }])
    assert.equal(R.validate(bad), false);
});

/* ---------- strict gestures, finger by finger ---------- */
function fed(diff, item = '叉燒飯', extra = {}) {
  const s = R.roastFed.init({ difficulty: diff, seed: 1, players: 1 }, 's1');
  const rng = countingRng(5);
  R.roastFed.onEvent(s, { kind: 'order', gid: 1, i: 0, item, ...extra }, ctxOf(0, rng));
  const L = R.LY(s), S = s.view.S, out = [];
  const c = (k, x, y) => out.push(...R.roastFed.command(s, { k, x, y, cx: x * S, cy: y * S }, ctxOf(s.t, rng)));
  const wait = secs => { for (let i = 0; i < Math.round(secs * 60); i++) out.push(...R.roastFed.step(s, 1 / 60, ctxOf(s.t, rng))); };
  const tap = (x, y) => { c('down', x, y); wait(0.07); c('up', x, y); wait(0.05); };
  const drag = (x0, y0, x1, y1, n = 8) => { c('down', x0, y0); for (let i = 1; i <= n; i++) { wait(0.02); c('move', x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); } c('up', x1, y1); wait(0.05); };
  const mid = r => [r.x + r.w / 2, r.y + r.h / 2];
  const pull = k => { const h = L.hooks.find(q => q.k === k); drag(h.x, L.rail.y + L.rail.h / 2, ...mid(L.board)); };
  return { s, L, c, wait, tap, drag, mid, pull, out, msgs: () => s.msgs.map(m => m.text) };
}

/** Chops a bone-in or 燒肉 roast in fed test `g` at x: pressed down, held `hold` s (a firm chop is slow to lift), lifted. */
const chop = (g, x, hold = 0.07) => { g.c('down', x, g.L.meatCy); g.wait(hold); g.c('up', x, g.L.meatCy); g.wait(0.05); };
/** Slices 叉燒 at x: the finger drawn down the line from the top. */
function slice(g, x) {
  const b = g.s.board, top = g.L.meatCy - b.h / 2, bot = g.L.meatCy + b.h / 2;
  g.c('down', x, top + 2); for (let y = top + 4; y <= bot + 2; y += 2) { g.wait(0.02); g.c('move', x, y); } g.c('up', x, bot + 2); g.wait(0.05);
}
const even = b => R.widths(b).every(w => Math.abs(w - b.w) < 1e-9);

test('斬料: n pieces = n cuts on the n guides; a cut near a guide lands on it, so the pieces come out even', () => {
  const g = fed('rookie', '燒肉飯');
  g.pull('pork');
  const b = g.s.board, gs = R.guides(b), snap = R.snapPx(g.s, b);
  assert.equal(gs.length, b.n, 'exactly n guides');
  assert.equal(R.guideMode(g.s), 'full');
  assert.ok(snap > 0 && snap < b.w / 2, `snap ${snap} under half a piece`);
  assert.ok(R.nextStep(g.s).startsWith(R.cutRule(g.s, b)), R.nextStep(g.s));
  // each cut lands a little off its guide, inside the snap: it snaps on, the combo counts, the board marks it done
  gs.forEach((x, i) => chop(g, x + (i % 2 ? 1 : -1) * snap * 0.8));
  assert.equal(b.cuts.length, b.n); assert.deepEqual(b.cuts, gs); assert.deepEqual(b.on, gs);
  assert.ok(even(b), 'every piece the same width');
  assert.equal(g.s.cleanCuts, b.n); assert.equal(g.s.combo, b.n);
  assert.ok(R.boardDone(g.s, b));
  // plated, the even right count grades clean
  g.tap(...g.mid(g.L.bases.rice));
  assert.ok(R.nextStep(g.s).includes(`拖斬好嗰 ${b.n} 件去碟`), R.nextStep(g.s));
  g.drag((b.x0 + R.lastCut(b)) / 2, g.L.meatCy + b.h * 0.3, g.L.plate.cx, g.L.plate.cy);
  assert.equal(g.s.plate.items[0].widths.length, b.n);
  const gr = R.grade(g.s.q[0].ord, g.s.plate);
  assert.ok(!gr.why.some(x => x.tag === 'uneven' || x.tag === 'count' || x.tag === 'splinter'), JSON.stringify(gr.why));
});

test('斬料: a cut off every guide falls where it fell: an extra, uneven piece; the combo breaks', () => {
  const g = fed('rookie', '燒肉飯');
  g.pull('pork');
  const b = g.s.board, gs = R.guides(b);
  chop(g, gs[0]); assert.equal(g.s.combo, 1);
  const mid = (gs[0] + gs[1]) / 2;                   // half way between guides 1 and 2: outside both snaps
  chop(g, mid);
  assert.equal(b.cuts.length, 2); assert.ok(Math.abs(b.cuts[1] - mid) < 1e-9, 'the knife stays where it fell');
  assert.equal(g.s.combo, 0); assert.equal(g.s.cleanCuts, 1); assert.equal(g.s.cuts, 2);
  assert.ok(g.msgs().includes('歪咗，唔喺線上'));
  assert.ok(!R.boardDone(g.s, b), 'guide 2 still to cut');
  for (const x of gs.slice(1)) chop(g, x);
  assert.equal(b.cuts.length, b.n + 1, 'one piece too many');
  assert.ok(!even(b));
});

test('斬料: the roast never moves, so the guides left stay true after any cut, in any order', () => {
  const g = fed('pro', '燒肉飯');
  g.pull('pork');
  const b = g.s.board, x0 = b.x0, gs = R.guides(b);
  // from the right first (players may cut from the right), then a stray cut, then the rest
  chop(g, gs[gs.length - 1]); chop(g, gs[1] + b.w * 0.5); chop(g, gs[0]);
  assert.equal(b.x0, x0, 'the roast is where it was put'); assert.deepEqual(R.guides(b), gs, 'the guides have not moved');
  assert.deepEqual(R.uncut(g.s, b), gs.slice(1, -1), 'the uncut guides are exactly the ones not chopped');
  for (const x of R.uncut(g.s, b)) chop(g, x + 0.5);
  for (const x of gs) assert.ok(b.cuts.some(c => Math.abs(c - x) < 1e-9), `guide at ${x} cut exactly on it`);
  assert.equal(b.cuts.length, b.n + 1);
});

test('燒鴨 1-2-3-4: firm chops on the numbered guides are right; chopping between joints splinters', () => {
  // the 雙拼 duck is four pieces at tier 0: the numbers 1 2 3 4 stand on the four guides, which are the joints
  const g = fed('rookie', '燒鴨叉燒雙拼飯');
  g.pull('duck');
  const b = g.s.board, mk = R.boardMarks(g.s, b);
  assert.equal(b.n, 4);
  assert.deepEqual(mk.nums.map(m => m.n), [1, 2, 3, 4]);
  assert.deepEqual(mk.nums.map(m => m.x), R.guides(b), 'each number sits on its guide');
  assert.ok(R.cutRule(g.s, b).includes('骨位'), 'the rule on screen says the guides are the joints');
  // a player's chops: firm (held 0.6 s, longer than a tap), each a hair off the number, in order 1, 2, 3, 4
  mk.nums.forEach((m, i) => chop(g, m.x + [0.6, -0.9, 1.2, -0.4][i], 0.6));
  assert.equal(b.cuts.length, 4); assert.deepEqual(b.cuts, R.guides(b));
  assert.equal(b.splinter, 0, 'no bone splinters'); assert.equal(g.s.cleanCuts, 4);
  assert.ok(!g.msgs().some(m => m.includes('骨碎')));
  assert.ok(even(b)); assert.ok(R.boardDone(g.s, b));
  // what went wrong before: the numbers stood in the middle of each piece, so chopping on them hit between the joints
  const h = fed('rookie', '燒鴨叉燒雙拼飯');
  h.pull('duck');
  const hb = h.s.board;
  chop(h, hb.x0 + hb.w * 0.5, 0.6);
  assert.equal(hb.splinter, 1); assert.ok(h.msgs().includes('斬歪咗骨位，骨碎！要斬喺虛線'));
});

test('a press held on a guide chops at once (a long press is still a chop); a drag off a cut picks the pieces up', () => {
  const g = fed('rookie', '燒鴨飯');
  g.pull('duck');
  const b = g.s.board, gs = R.guides(b);
  g.c('down', gs[0], g.L.meatCy);
  assert.equal(b.cuts.length, 1, 'chopped on the press, before the lift');
  g.wait(1.2); g.c('up', gs[0], g.L.meatCy); assert.equal(b.cuts.length, 1, 'the lift adds nothing');
  // a slow press off any guide still chops where it went down when it lifts
  g.c('down', gs[1] + b.w * 0.5, g.L.meatCy); g.wait(0.9); g.c('up', gs[1] + b.w * 0.5, g.L.meatCy);
  assert.equal(b.cuts.length, 2);
  // once something is cut, a drag that starts off the guides picks the cut pieces up instead
  g.drag(b.x0 + 2, g.L.meatCy, b.x0 + 2, g.L.meatCy + 30);
  assert.equal(b.cuts.length, 2);
});

test('the playtest knob: pieces added to new orders, snap scaled at once', () => {
  const g = fed('pro', '燒肉飯');
  const base = R.portion('pork', 1, g.s.tier);
  g.pull('pork');
  const b = g.s.board, s0 = R.snapPx(g.s, b);
  assert.equal(b.n, base);
  g.s.knob = { pcs: 2, snap: 0.5 };
  assert.ok(Math.abs(R.snapPx(g.s, b) - s0 * 0.5) < 1e-9);
  assert.equal(R.portion('pork', 1, g.s.tier, g.s.knob.pcs), base + 2);
  g.s.knob = { pcs: 0, snap: 9 };
  assert.ok(R.snapPx(g.s, b) <= b.w * 0.48 + 1e-9, 'never half a piece or more');
});

test('叉燒 cuts only by drawing the knife down the line from the top', () => {
  const g = fed('pro');
  g.pull('char');
  const b = g.s.board, top = g.L.meatCy - b.h / 2, bot = g.L.meatCy + b.h / 2, x = R.guides(b)[0];
  assert.equal(b.k, 'char');
  // starting low (below the top band) is refused
  // (the press holds the roast, 'slab', so a drag up can hang it back; a lift where it went down cuts nothing)
  g.c('down', x, top + b.h * 0.6); assert.equal(g.s.f.mode, 'slab'); g.c('up', x, top + b.h * 0.6); assert.equal(b.cuts.length, 0);
  assert.ok(g.msgs().includes('由上面𠝹落嚟 ↓'));
  // a tap is not a cut
  g.tap(x, top + 2); assert.equal(b.cuts.length, 0);
  // drifting off the line stops the knife, and the half cut is kept
  g.c('down', x, top + 2); for (let y = top + 4; y <= bot + 2; y += 2) { g.wait(0.02); g.c('move', x + (y > top + 8 ? 8 : 0), y); }
  assert.equal(b.cuts.length, 0); assert.ok(g.s.f.off); g.c('up', x + 8, bot + 2);
  assert.ok(b.partial, 'the half cut is kept');
  // resuming at the half cut finishes it, on the guide
  g.c('down', x, b.partial.front); for (let y = b.partial.front + 2; y <= bot + 2; y += 2) { g.wait(0.02); g.c('move', x, y); }
  g.c('up', x, bot + 2);
  assert.equal(b.cuts.length, 1); assert.ok(Math.abs(b.cuts[0] - x) < 1e-9);
  slice(g, R.guides(b)[1] + 1);
  assert.equal(b.cuts.length, 2); assert.equal(b.cuts[1], R.guides(b)[1], 'a slice a hair off the guide lands on it');
});

test('the rail locks after a wrong roast; the plate takes pieces only on a base; swipes need 45 css px', () => {
  const g = fed('rookie');
  g.pull('duck');
  assert.equal(g.s.board, null); assert.ok(g.s.lock > g.s.t);
  g.c('down', g.L.hooks[0].x, g.L.rail.y + 10); assert.equal(g.s.f.mode, 'none'); g.c('up', g.L.hooks[0].x, g.L.rail.y + 10);
  assert.ok(g.msgs().some(m => m.startsWith('客冇叫燒鴨') || m === '掛緊返去…'));
  g.wait(1.4);
  g.pull('char');
  const b = g.s.board, n = b.n;
  for (const x of R.guides(b)) g.tap(x, g.L.meatCy - b.h / 2 + 2);   // taps never cut 叉燒
  assert.equal(b.cuts.length, 0);
  for (const x of R.guides(b)) slice(g, x);
  assert.equal(b.cuts.length, n);
  const pc = [g.L.plate.cx, g.L.plate.cy], from = [(b.x0 + R.lastCut(b)) / 2, g.L.meatCy + b.h * 0.3];
  // no base yet: the pieces stay on the board
  g.drag(...from, ...pc); assert.ok(g.s.board); assert.equal(g.s.plate.items.length, 0);
  g.tap(...g.mid(g.L.bases.rice)); assert.equal(g.s.plate.base, 'rice');
  // dropped short of the plate: still on the board
  g.drag(...from, pc[0], g.L.board.y + g.L.board.h + 2); assert.ok(g.s.board);
  g.drag(...from, ...pc); assert.equal(g.s.board, null); assert.equal(g.s.plate.items[0].widths.length, n);
  assert.ok(g.s.restBack, 'the leftover end flies back to the rail');
  // the base cannot change under meat
  g.tap(...g.mid(g.L.bases.ho)); assert.equal(g.s.plate.base, 'rice');
  // soy: hold to pour into the band
  g.c('down', ...g.mid(g.L.soy)); g.wait(1.0); g.c('up', ...g.mid(g.L.soy));
  assert.ok(g.s.plate.soy >= R.TUNE.soy.lo && g.s.plate.soy <= R.TUNE.soy.hi, `soy ${g.s.plate.soy}`);
  // a 40 css px swipe up does nothing; 50 serves
  g.drag(pc[0], pc[1], pc[0], pc[1] - 40 / g.s.view.S); assert.equal(g.s.served, 0);
  g.drag(pc[0], pc[1], pc[0], pc[1] - 50 / g.s.view.S); assert.equal(g.s.served, 1);
  const done = g.out.filter(r => r.kind === 'lineDone');
  assert.equal(done.length, 1); assert.equal(done[0].gid, 1); assert.equal(done[0].dest, 'roast'); assert.equal(done[0].stars, 3);
});

test('noodles: a bowl, one ladle of soup and 蔥花 before the meat; soy refused', () => {
  const g = fed('pro', '叉燒湯河');
  g.tap(...g.mid(g.L.bases.ho)); assert.equal(g.s.plate.base, 'ho');
  g.c('down', ...g.mid(g.L.soy)); assert.equal(g.s.f.mode, 'none'); g.c('up', ...g.mid(g.L.soy));
  assert.ok(g.msgs().includes('湯粉唔使豉油'));
  g.drag(...g.mid(g.L.soup), g.L.plate.cx, g.L.plate.cy); assert.equal(g.s.plate.soup, 1);
  g.tap(...g.mid(g.L.scal)); assert.equal(g.s.plate.scal, true);
  assert.equal(R.nextStep(g.s), '將叉燒拖落砧板');
  // swiping down tips the bowl
  g.drag(g.L.plate.cx, g.L.plate.cy, g.L.plate.cx, g.L.plate.cy + 20); assert.equal(g.s.dumped, 1); assert.equal(g.s.plate.base, null);
  assert.equal(g.out.filter(r => r.kind === 'dumped').length, 1);
});

test('referee seam: fed orders queue in turn, de-duplicate, cancel, and only timed ones walk out', () => {
  const s = R.roastFed.init({ difficulty: 'pro', seed: 3, players: 4 }, 'roast-1');
  const rng = countingRng(3), ctx = () => ctxOf(s.t, rng);
  assert.equal(s.selfFeed, false);
  R.roastFed.step(s, 30, ctx()); assert.equal(s.q.length, 0, 'no own customers');
  assert.equal(R.roastFed.status(s, ctx()).waiting, 0);
  R.roastFed.onEvent(s, { kind: 'order', gid: 7, i: 1, item: '三寶飯' }, ctx());
  R.roastFed.onEvent(s, { kind: 'order', gid: 7, i: 1, item: '三寶飯' }, ctx());
  R.roastFed.onEvent(s, { kind: 'order', gid: 8, i: 0, item: '燒鴨瀨粉', patience: 5 }, ctx());
  R.roastFed.onEvent(s, { kind: 'order', gid: 9, i: 0, item: '漢堡包' }, ctx());
  assert.deepEqual(s.q.map(c => [c.gid, c.i]), [[7, 1], [8, 0]]);
  assert.equal(R.roastFed.status(s, ctx()).waiting, 2);
  const res = R.roastFed.step(s, 6, ctx());
  assert.deepEqual(res.map(r => [r.kind, r.gid]), [['walkout', 8]]);
  assert.equal(s.q.length, 1, 'the untimed shop line waits for the referee');
  R.roastFed.onEvent(s, { kind: 'cancel', gid: 7, i: 1 }, ctx());
  assert.equal(s.q.length, 0);
  // the bot serves fed lines; every lineDone names the line it made
  for (let k = 0; k < 4; k++) R.roastFed.onEvent(s, { kind: 'order', gid: 20 + k, i: 0, item: R.MENU[k * 3].name }, ctx());
  const out = run(R.roastFed, s, rng, { secs: 90, from: s.t });
  assert.deepEqual(out.filter(r => r.kind === 'lineDone').map(r => r.gid), [20, 21, 22, 23]);
  assert.ok(out.every(r => r.kind !== 'shiftEnd'), 'the referee ends the shift, not the station');
});

test('a screen size change keeps the roast where it lies on the board', () => {
  const g = fed('rookie');
  g.pull('char');
  const b = g.s.board;
  slice(g, R.guides(b)[0]);
  assert.equal(b.cuts.length, 1);
  const rel = [b.x0 - g.L.board.x, b.cuts[0] - g.L.board.x];
  R.roastFed.command(g.s, { k: 'view', LW: 160, LH: 300, S: 2.5 }, ctxOf(g.s.t, countingRng(1)));
  const L2 = R.LY(g.s);
  assert.deepEqual([g.s.board.x0 - L2.board.x, g.s.board.cuts[0] - L2.board.x], rel);
});
