// 外賣 station core (src/stations-next/takeaway): in memory, no browser. The bot plays whole shifts on many seeds at each
// difficulty; every slip ends exactly once; the tips add up; the state survives a JSON hand-over mid-tie and continues
// identically; the tie path generator gives the original prototype page's own paths (its code, lifted out of the HTML and run here); the
// strict trace and the packing rules refuse what the prototype refuses; the referee seam (bag / item / cancel events, packed
// and remake results) works with self-feeding off; the drill mode cycles through every pattern of its knot tier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadStation, countingRng, ctxOf, run } from './helpers/stations.js';
import { ROOT } from './helpers/server.js';

const T = await loadStation('takeaway');
const DIFFS = ['rookie', 'pro', 'ace'];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

test('the bot finishes a shift at every difficulty, many seeds, with good bags at a human pace', () => {
  for (const d of DIFFS) for (const seed of SEEDS) {
    const s = T.takeaway.init({ difficulty: d, seed, players: 1 }, 's1');
    const res = run(T.takeaway, s, countingRng(seed), { secs: T.TUNE.shift + 5 });
    assert.equal(s.over, true, `${d}/${seed} ends`);
    assert.equal(res.filter(r => r.kind === 'shiftEnd').length, 1, `${d}/${seed} one end`);
    const n = s.results.length;
    assert.ok(n >= 5, `${d}/${seed} handed ${n}`);
    assert.ok(s.results.reduce((a, r) => a + r.stars, 0) / n >= 2.5, `${d}/${seed} stars ${s.results.map(r => r.stars)}`);
    // human pace: never faster than 0.6 x par, never slow enough to cost a star
    for (const t of s.ties) assert.ok(t.time > 0.6 * t.par && t.time < T.TUNE.slowTie * t.par, `${d}/${seed} tie ${t.time} par ${t.par}`);
    assert.ok(T.validate(JSON.parse(JSON.stringify(s))));
  }
});

// every item is in exactly one place: an order's list (made or not), at most once on the counter or on its way
function checkItems(s, tag) {
  const where = new Map();
  for (const c of s.counter) if (c) { assert.ok(!where.has(c.id), `${tag}: item ${c.id} twice`); where.set(c.id, 'counter'); }
  for (const c of s.incoming) { assert.ok(!where.has(c.id), `${tag}: item ${c.id} twice`); where.set(c.id, 'incoming'); }
  for (const id of where.keys()) { const it = T.itemById(s, id); assert.ok(it, `${tag}: item ${id} belongs to no slip`); assert.equal(it.packed, false, `${tag}: a packed item is still out`); }
}

test('no slip is lost or handed over twice; items are never duplicated; the tips add up', () => {
  let wrong = 0, spills = 0;
  for (const d of DIFFS) for (const seed of [...SEEDS, 9, 10, 11, 12]) {   // more seeds than the rest: wrong items are rare
    const s = T.takeaway.init({ difficulty: d, seed, players: 1 }, 's1');
    const rng = countingRng(seed * 7), mess = countingRng(seed * 13), seen = new Map(), res2 = [];
    // a clumsy hand: now and then a gesture is cut short, or a random spot of the counter is pressed and dragged to the bag
    const res = run(T.takeaway, s, rng, {
      secs: T.TUNE.shift + 5,
      onStep: (st, ctx) => {
        for (const o of st.orders) seen.set(o.gid, o);
        checkItems(st, `${d}/${seed} t${st.t.toFixed(2)}`);
        if (st.ai.steps.length > 4 && mess.next() < 0.02) st.ai.steps.splice(1, st.ai.steps.length - 2);
        if (st.phase === 'pack' && !st.f.down && !st.ai.steps.length && mess.next() < 0.01) {
          const L = T.LY(st), p = T.slotXY(L, Math.floor(mess.next() * 6)), b = { x: L.bag.x + 28, y: L.bag.y + 40 + T.TUNE.lift / st.view.S }, S = st.view.S;
          const c = (k, q) => res2.push(...T.takeaway.command(st, { k, x: q.x, y: q.y, cx: q.x * S, cy: q.y * S, ms: st.t * 1000 }, ctx));
          c('down', p); c('move', b); c('up', b);
        }
        if (st.phase === 'pack' && !st.f.down && !st.ai.steps.length && mess.next() < 0.01) {
          const L = T.LY(st), r = T.trayRect(L, T.EXK[Math.floor(mess.next() * 5)]), q = { x: r.x + r.w / 2, y: r.y + r.h / 2 }, S = st.view.S;
          for (const k of ['down', 'up']) res2.push(...T.takeaway.command(st, { k, x: q.x, y: q.y, cx: q.x * S, cy: q.y * S, ms: st.t * 1000 }, ctx));
        }
      },
    });
    const all = [...res, ...res2], packed = all.filter(r => r.kind === 'packed'), gids = packed.map(r => r.gid);
    assert.equal(new Set(gids).size, gids.length, `${d}/${seed}: a slip handed over twice`);
    for (const id of gids) assert.ok(seen.has(id), `${d}/${seed}: result for unknown slip ${id}`);
    const pending = s.orders.filter(o => !o.done).length;
    assert.equal(seen.size, gids.length + pending, `${d}/${seed}: every slip is handed over or still open`);
    assert.equal(packed.length, s.results.length);
    assert.ok(Math.abs(packed.reduce((a, r) => a + r.tip, 0) - s.tips) < 1e-9, `${d}/${seed} tips`);
    assert.equal(all.filter(r => r.kind === 'remake').length, 0, 'self-fed: the station remakes its own');
    for (const r of packed) {
      assert.ok(r.stars >= 0 && r.stars <= 3 && r.tip >= 0 && r.tip <= T.TUNE.tip.base + T.TUNE.tip.tie + T.TUNE.tip.wait, 'stars and tip in range');
      assert.equal(r.stars === 3, !r.why.some(w => !['over', 'wrongHand'].includes(w)), `${d}/${seed}: 3 stars exactly when nothing costs one (${r.why})`);
    }
    wrong += s.why.wrongItem ?? 0; spills += s.why.spill ?? 0;
  }
  assert.ok(wrong > 0 && spills > 0, `the clumsy hand covers wrong items (${wrong}) and spills (${spills})`);
});

test('the state hands over by value mid-tie and the run continues identically', () => {
  for (const d of DIFFS) for (const seed of [11, 12, 13]) {
    const s = T.takeaway.init({ difficulty: d, seed, players: 1 }, 's1');
    const rng = countingRng(seed);
    let at = 0;
    // run to the middle of a tie, finger down, some way along the path
    for (let i = 0; i < 60 * 120; i++) {
      at = (i + 1) / 60; const ctx = ctxOf(at, rng);
      T.takeaway.step(s, 1 / 60, ctx); const c = T.takeaway.bot.next(s, ctx); if (c) T.takeaway.command(s, c, ctx);
      if (s.t > 20 && s.phase === 'tie' && s.f.down && s.tie.i > 20) break;
    }
    assert.equal(s.phase, 'tie');
    const copy = JSON.parse(JSON.stringify(s));
    assert.ok(T.validate(copy));
    assert.deepEqual(copy, s);
    assert.ok(JSON.stringify(s).length < 16000, `a checkpoint stays small (${JSON.stringify(s).length} bytes)`);
    const rng2 = countingRng(seed, rng.count);
    const a = run(T.takeaway, s, rng, { secs: 60, from: at });
    const b = run(T.takeaway, copy, rng2, { secs: 60, from: at });
    assert.deepEqual(b, a, `${d}/${seed} results`);
    assert.deepEqual(copy, s, `${d}/${seed} state`);
    assert.ok(s.results.length >= 2);
  }
});

test('validate refuses broken hand-overs', () => {
  const s = T.takeaway.init({ difficulty: 'pro', seed: 1, players: 1 }, 's1');
  assert.ok(T.validate(s));
  for (const bad of [null, 3, [], {}, { ...s, v: 2 }, { ...s, diff: 'boss' }, { ...s, orders: [{}] }, { ...s, phase: 'nap' }, { ...s, t: 'x' }, { ...s, tie: { dk: 'pro' } },
    { ...s, counter: [{ id: 'a' }] }, { ...s, bag: { ...s.bag, log: ['spoon'] } }, { ...s, drag: { kind: 'item' } }, { ...s, ai: { at: 0, steps: [] } }])
    assert.equal(T.validate(bad), false, JSON.stringify(bad)?.slice(0, 80));
});

/* ---------- the tie path generator against the original prototype page's own code ---------- */
function labPaths() {
  const html = readFileSync(join(ROOT, 'site', 'lab', 'takeaway.html'), 'utf8');
  const tune = html.slice(html.indexOf('const TUNE = {'), html.indexOf('/* =====', html.indexOf('const TUNE = {')));
  const gen = html.slice(html.indexOf('/* ---------- path generator'), html.indexOf('/* ---------- trace matching'));
  return new Function(`'use strict'; ${tune}; const clamp = (v, a, b) => v < a ? a : v > b ? b : v; ${gen}; return { buildPath, famsFor };`)();
}
// The prototype page is not part of this repo: the check runs only when site/lab/takeaway.html is present.
const NO_PROTO = !existsSync(join(ROOT, 'site', 'lab', 'takeaway.html')) && 'needs the original prototype page site/lab/takeaway.html';
test('the tie paths are the prototype\'s, sample for sample (every family, every difficulty)', { skip: NO_PROTO }, () => {
  const lab = labPaths(), R = T.tieRect(T.layout(130, 253), 3);
  let same = 0, tangle = 0;
  for (const d of DIFFS) {
    const fams = T.famsFor(T.TUNE.diff[d].lv);
    assert.deepEqual(fams, lab.famsFor(d), `${d}: the same families`);
    for (const fam of fams) for (let seed = 1; seed <= 6; seed++) {
      const a = lab.buildPath(d, seed * 1000003, R, fam), b = T.buildPath(T.TUNE.diff[d], T.TUNE.diff.rookie, seed * 1000003, R, fam);
      // 亂線頭 shuffles its curls with a Fisher-Yates instead of the prototype's engine-dependent sort, so its draws differ
      if (a.fam === 'tangle' || b.fam === 'tangle') { tangle++; continue; }
      assert.equal(b.fam, a.fam, `${d}/${fam}/${seed} family`); assert.equal(b.name, a.name);
      assert.equal(b.pts.length, a.pts.length, `${d}/${fam}/${seed} samples`);
      for (let i = 0; i < a.pts.length; i++) {
        assert.ok(Math.abs(a.pts[i][0] - b.pts[i][0]) < 1e-9 && Math.abs(a.pts[i][1] - b.pts[i][1]) < 1e-9 && !!a.pts[i][2] === !!b.pts[i][2], `${d}/${fam}/${seed} sample ${i}`);
      }
      assert.ok(Math.abs(a.par - b.par) < 1e-9, `${d}/${fam}/${seed} par`);
      same++;
    }
  }
  assert.ok(same > 200, `compared ${same} paths (${tangle} 亂線頭 skipped)`);
});
test('亂線頭 (the one family not compared) still passes every finger rule', () => {
  const R = T.tieRect(T.layout(130, 253), 3);
  for (const d of DIFFS) for (let seed = 1; seed <= 20; seed++) {
    const p = T.buildPath(T.TUNE.diff[d], T.TUNE.diff.rookie, seed, R, 'tangle');
    if (p.fam !== 'tangle') continue;
    assert.equal(T.checkPath(p.pts, T.TUNE.diff[d], R, T.FAM.tangle.lenMul).why, '', `${d}/${seed}`);
  }
});

/* ---------- finger by finger, with the referee feeding the work ---------- */
function fed(diff) {
  const s = T.takeawayFed.init({ difficulty: diff, seed: 1, players: 1 }, 's1');
  const rng = countingRng(5), out = [];
  const L = T.LY(s), S = s.view.S, lift = T.TUNE.lift / S;
  const ev = e => T.takeawayFed.onEvent(s, e, ctxOf(s.t, rng));
  const c = (k, x, y) => out.push(...T.takeawayFed.command(s, { k, x, y, cx: x * S, cy: y * S, ms: s.t * 1000 }, ctxOf(s.t, rng)));
  const css = (k, cx, cy) => c(k, cx / S, cy / S);
  const wait = secs => { for (let i = 0; i < Math.round(secs * 60); i++) out.push(...T.takeawayFed.step(s, 1 / 60, ctxOf(s.t, rng))); };
  const tap = (x, y) => { c('down', x, y); wait(0.07); c('up', x, y); wait(0.05); };
  const drag = (x0, y0, x1, y1, n = 8) => { c('down', x0, y0); for (let i = 1; i <= n; i++) { wait(0.02); c('move', x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); } c('up', x1, y1); wait(0.05); };
  const mid = r => [r.x + r.w / 2, r.y + r.h / 2];
  const slotOf = id => s.counter.findIndex(q => q?.id === id);
  const toBag = id => { const p = T.slotXY(L, slotOf(id)); drag(p.x, p.y, L.bag.x + L.bag.w / 2, L.bag.y + L.bag.h / 2 + lift); };
  const extras = () => { const o = T.active(s), need = T.needEx(o); for (const k of T.EXK) while (s.bag.ex[k] < need[k]) tap(...mid(T.trayRect(L, k))); };
  // trace the whole path at a steady 200 css px/s
  const trace = () => { const P = T.tiePath(s.tie).pts; css('down', P[0][0], P[0][1]); for (let i = 2; i < P.length; i += 2) { wait(0.03); css('move', P[i][0], P[i][1]); } const e = P[P.length - 1]; css('move', e[0], e[1]); css('up', e[0], e[1]); };
  const handTo = i => { const w = L.LW / T.TUNE.maxOrders; drag(...mid(L.bag), i * w + w / 2, L.cust.y + L.cust.h / 2 + lift); };
  return { s, L, S, out, ev, c, css, wait, tap, drag, mid, toBag, extras, trace, handTo, msgs: () => s.msgs.map(m => m.text) };
}

test('the referee seam: bag and item events in, packed out; remakes go back to the referee; cancel and de-duplication', () => {
  const g = fed('pro'), s = g.s;
  assert.equal(s.selfFeed, false);
  g.wait(30); assert.equal(s.orders.length, 0, 'fed: no slips of its own');
  g.ev({ kind: 'bag', gid: 7, no: 21, items: ['焗豬扒飯', '凍檸茶少甜'], people: 2, who: 'rider' });
  g.ev({ kind: 'bag', gid: 7, items: ['西多士'] });
  g.ev({ kind: 'bag', gid: 8, no: 22, items: ['熱奶茶走甜', '西多士'], ready: true });
  g.ev({ kind: 'bag', gid: 9, items: ['麻辣火鍋'] });
  assert.deepEqual(s.orders.map(o => o.gid), [7, 8], 'a gid is taken once; an unknown item refuses the bag');
  assert.deepEqual(T.needEx(s.orders[0]), { cut: 2, nap: 2, str: 1, sug: 0, syr: 0 });
  assert.deepEqual(T.needEx(s.orders[1]), { cut: 1, nap: 1, str: 0, sug: 0, syr: 1 });
  g.wait(0.5); assert.equal(s.counter.filter(Boolean).length, 0, 'not ready: nothing lands until the referee says');
  g.ev({ kind: 'item', gid: 7, i: 0 }); g.ev({ kind: 'item', gid: 7, i: 0 }); g.wait(0.3);
  assert.equal(s.counter.filter(Boolean).length, 1, 'an item lands once');
  g.wait(8); assert.equal(s.counter.filter(Boolean).length, 3, 'a ready bag lands by itself, as in the prototype');
  // pro: an item of #22 packed into #21's bag goes in, and the referee is asked for another
  const [o7, o8] = s.orders, toast = o8.items[1];
  g.toBag(toast.id);
  const rm = g.out.find(r => r.kind === 'remake');
  assert.deepEqual([rm.gid, rm.i], [8, 1]); assert.notEqual(o8.items[1].id, toast.id, 'the slip waits for a new one');
  assert.ok(s.bag.items[0].wrong);
  g.toBag(o7.items[0].id); g.ev({ kind: 'item', gid: 7, i: 1 }); g.wait(0.4); g.toBag(o7.items[1].id); g.extras();
  g.tap(...g.mid(g.L.tieBtn)); assert.equal(s.phase, 'tie');
  g.wait(0.4); g.trace(); assert.equal(s.phase, 'fx'); g.wait(1.3); assert.equal(s.phase, 'hand');
  g.handTo(0);
  const p = g.out.find(r => r.kind === 'packed');
  assert.equal(p.gid, 7); assert.equal(p.no, 21); assert.ok(p.why.includes('wrongItem')); assert.equal(p.stars, 2);
  // cancel takes the slip and its things off the counter
  g.ev({ kind: 'item', gid: 8, i: 1 }); g.wait(0.3);
  g.ev({ kind: 'cancel', gid: 8 });
  assert.equal(s.orders.length, 1); assert.equal(s.counter.filter(Boolean).length, 0); assert.equal(s.incoming.length, 0);
  assert.equal(T.takeawayFed.status(s, ctxOf(s.t, countingRng(1))).waiting, 0);
});

test('packing: boxes first or the drink spills; rookies get a wrong item bounced; the tie waits for every item', () => {
  const g = fed('rookie'), s = g.s;
  g.ev({ kind: 'bag', gid: 1, no: 11, items: ['揚州炒飯', '凍奶茶'], ready: true });
  g.ev({ kind: 'bag', gid: 2, no: 12, items: ['乾炒牛河'], ready: true });
  g.wait(10);
  const [o1, o2] = s.orders;
  g.tap(...g.mid(g.L.tieBtn)); assert.equal(s.phase, 'pack'); assert.ok(g.msgs().includes('仲未齊嘢'));
  g.toBag(o2.items[0].id);
  assert.equal(s.bag.items.length, 0, 'rookie: the wrong slip\'s item bounces back'); assert.ok(g.msgs().includes('呢樣係 #12 嘅！'));
  g.toBag(o1.items[1].id); g.toBag(o1.items[0].id);
  assert.equal(s.bag.spills, 1); assert.ok(s.bag.items[0].squashed); assert.ok(g.msgs().includes('壓住杯嘢！瀉咗'));
  // a drag dropped short of the bag goes back to the counter
  const p = T.slotXY(g.L, s.counter.findIndex(Boolean));
  g.drag(p.x, p.y, p.x - 10, p.y); assert.ok(s.counter.some(Boolean));
  // too many extras, and ↶ takes the last one back
  g.extras(); g.tap(...g.mid(T.trayRect(g.L, 'sug'))); assert.equal(s.bag.ex.sug, 1);
  g.tap(...g.mid(T.undoRect(g.L))); assert.equal(s.bag.ex.sug, 0);
  g.tap(...g.mid(g.L.tieBtn)); g.wait(0.4); g.trace(); g.wait(1.3);
  // the wrong customer refuses the bag; the right one takes it
  g.handTo(1); assert.equal(s.phase, 'hand'); assert.equal(s.bag.wrongHand, 1); assert.ok(o2.huff > 0);
  g.handTo(0);
  const r = g.out.find(x => x.kind === 'packed');
  assert.deepEqual(r.why.sort(), ['spill', 'wrongHand']); assert.equal(r.stars, 2);
});

test('the trace: start at 起, follow the path in order, no shortcuts; leaving the line undoes above 新人', () => {
  for (const d of DIFFS) {
    const g = fed(d), s = g.s;
    g.ev({ kind: 'bag', gid: 1, items: ['西多士'], ready: true }); g.wait(9);
    g.toBag(s.orders[0].items[0].id); g.extras(); g.tap(...g.mid(g.L.tieBtn));
    assert.equal(s.phase, 'tie');
    const P = T.tiePath(s.tie).pts, n = P.length, band = T.TUNE.diff[d].band, undo = T.TUNE.diff[d].undo;
    // too early: the intro is still showing
    g.css('down', P[0][0], P[0][1]); assert.equal(s.tie.fingerDown, false); g.css('up', P[0][0], P[0][1]);
    g.wait(0.4);
    // away from the start: nothing, and a hint
    const far = P[Math.floor(n / 2)];
    g.css('down', far[0], far[1]); assert.equal(s.tie.i, 0); assert.equal(s.tie.on, false); assert.ok(g.msgs().includes('由「起」嗰點開始'));
    g.css('up', far[0], far[1]);
    // a straight line from the start to the end only covers the stretch of path it really runs along
    const A = P[0], B = P[n - 1], segD = q => { const vx = B[0] - A[0], vy = B[1] - A[1], u = Math.max(0, Math.min(1, ((q[0] - A[0]) * vx + (q[1] - A[1]) * vy) / (vx * vx + vy * vy))); return Math.hypot(q[0] - A[0] - u * vx, q[1] - A[1] - u * vy); };
    g.css('down', A[0], A[1]); g.css('move', B[0], B[1]);
    assert.ok(s.tie.i < n - 1, `${d}: the shortcut does not tie the bag`);
    for (let j = 0; j <= s.tie.i; j++) assert.ok(segD(P[j]) <= band + T.TUNE.trace.gap, `${d}: sample ${j} of ${s.tie.i} covered without the finger near it`);
    g.css('up', P[n - 1][0], P[n - 1][1]);
    // follow it properly a way, then step off the line
    const at0 = s.tie.offs;
    g.css('down', P[s.tie.i][0], P[s.tie.i][1]);
    for (let i = s.tie.i; i < Math.min(n - 1, 80); i += 2) { g.wait(0.02); g.css('move', P[i][0], P[i][1]); }
    const before = s.tie.i, q = P[before];
    // one step straight off to the side (across the path at the head, to the side clear of the rest of the live stretch)
    const tg = [P[before + 2][0] - P[before - 2][0], P[before + 2][1] - P[before - 2][1]], tl = Math.hypot(tg[0], tg[1]), off = band * T.TUNE.trace.offK + 3;
    const sides = [1, -1].map(sg => [q[0] - sg * tg[1] / tl * off, q[1] + sg * tg[0] / tl * off]), clear = p => Math.min(...P.slice(Math.max(0, before - 20), before + 30).map(r => Math.hypot(r[0] - p[0], r[1] - p[1])));
    const side = clear(sides[0]) >= clear(sides[1]) ? sides[0] : sides[1];
    g.css('move', side[0], side[1]);
    assert.equal(s.tie.offs, at0 + 1, `${d}: off the line (${at0} -> ${s.tie.offs}, i ${before} -> ${s.tie.i}, on ${s.tie.on}, dist ${s.tie.dist})`);
    // (the first few px of the step off still count, then the slip takes `undo` px back)
    const back = Math.round(undo / T.TUNE.trace.step), slack = Math.ceil(2 * band / T.TUNE.trace.step);
    assert.ok(s.tie.i >= before - back && s.tie.i <= before - back + slack, `${d}: undo ${undo}: ${before} -> ${s.tie.i}`);
    g.css('up', q[0], q[1]);
    // back on at the head and to the end
    g.trace(); assert.equal(s.phase, 'fx', `${d}: tied`);
    assert.ok(s.tie.time > 0); assert.equal(s.ties.length, 1); assert.equal(s.ties[0].offs, s.tie.offs);
  }
});

test('drill mode: tie after tie from the knot library, all ten patterns of the tier before any repeats, no slips', () => {
  const s = T.takeawayDrill.init({ difficulty: 'ace', seed: 3, players: 1 }, 's1');
  assert.equal(s.mode, 'drill');
  run(T.takeawayDrill, s, countingRng(3), { secs: 200 });
  const first = s.ties.slice(0, T.KNOT_PATTERNS);
  assert.ok(s.ties.length > T.KNOT_PATTERNS, `ties ${s.ties.length}`);
  assert.equal(s.orders.length, 0); assert.equal(s.over, false);
  assert.ok(first.every(t => t.tier === T.KNOT_TUNE.base.ace), 'every tie at 阿姐\'s knot tier');
  assert.equal(new Set(first.map(t => t.pat)).size, T.KNOT_PATTERNS, `the first ten ties are the ten patterns: ${first.map(t => t.pat)}`);
  assert.equal(s.drillN, s.ties.length - (s.phase === 'fx' ? 1 : 0));
});

test('a view change mid-shift keeps the run going', () => {
  const s = T.takeaway.init({ difficulty: 'pro', seed: 4, players: 1 }, 's1'), rng = countingRng(4);
  run(T.takeaway, s, rng, { secs: 30 });
  T.takeaway.command(s, { k: 'view', LW: 150, LH: 300, S: 2.6 }, ctxOf(s.t, rng));
  assert.equal(T.LY(s).LW, 150);
  run(T.takeaway, s, rng, { secs: 125, from: 30 });
  assert.equal(s.over, true); assert.ok(s.results.length >= 5);
});
