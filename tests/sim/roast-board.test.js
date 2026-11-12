// 燒味: no roast on the chopping board can soft-lock the counter (seen in a 晚市 shift in play: a
// 燒肉 slab could be neither chopped nor moved back). For every roast kind, cutting tier, piece count and screen size, and
// for every way a roast reaches the board (the player pulls it down; a restored state, also after the screen changed
// size; the computer covering the seat and handing it back mid-gesture or part-cut, with and without the seat's
// hand-over hook), the roast on the board is both choppable (every guide left can be cut by a press or a slice on it)
// and returnable (a drag up onto the rail hangs it back on its hook). It also sits in the middle of the board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStation, countingRng, ctxOf } from '../helpers/stations.js';

const R = await loadStation('roast');
const ITEM = { char: '叉燒飯', pork: '燒肉飯', duck: '燒鴨飯', chick: '油雞飯' };
// the phone the station page assumes, and a 390x666 phone viewport (css px: scale 2.24, 174 x 250 logical px)
const VIEWS = [R.DEFAULT_VIEW, { LW: 174, LH: 250, S: 390 / 174 }];
const KNOBS = [0, 6];

function harness(s, rng) {
  const out = [];
  const c = (k, x, y) => out.push(...R.roastFed.command(s, { k, x, y, cx: x * s.view.S, cy: y * s.view.S }, ctxOf(s.t, rng)));
  const wait = secs => { for (let i = 0; i < Math.round(secs * 60); i++) out.push(...R.roastFed.step(s, 1 / 60, ctxOf(s.t, rng))); };
  const drag = (x0, y0, x1, y1, n = 10) => { c('down', x0, y0); for (let i = 1; i <= n; i++) { wait(0.02); c('move', x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); } c('up', x1, y1); wait(0.05); };
  return { c, wait, drag, L: () => R.LY(s) };
}
function fresh(k, tier, pcs, view) {
  const s = R.roastFed.init({ difficulty: 'pro', seed: 1, players: 1 }, 's1'), rng = countingRng(7);
  R.roastFed.command(s, { k: 'view', ...view }, ctxOf(0, rng));
  R.roastFed.onEvent(s, { kind: 'tier', tier }, ctxOf(0, rng));
  s.knob = { pcs, snap: 1 };
  R.roastFed.onEvent(s, { kind: 'order', gid: 1, i: 0, item: ITEM[k] }, ctxOf(0, rng));
  return { s, rng };
}
/** The player drags roast k from its hook onto the board. */
function pull(s, rng, k) {
  const h = harness(s, rng), L = h.L(), hk = L.hooks.find(q => q.k === k);
  h.drag(hk.x, L.rail.y + L.rail.h / 2, L.board.x + L.board.w / 2, L.board.y + L.board.h / 2);
  h.wait(0.3);
}

/** Every way a roast of kind k reaches the board, as [label, state, rng]. */
function arrivals(k, tier, pcs, view) {
  const out = [];
  { const { s, rng } = fresh(k, tier, pcs, view); pull(s, rng, k); out.push(['player', s, rng]); }
  // a restored state (a JSON hand-over / checkpoint), then the screen changes size under it
  {
    const { s, rng } = fresh(k, tier, pcs, view); pull(s, rng, k);
    const r = JSON.parse(JSON.stringify(s)); assert.ok(R.validate(r));
    out.push(['restored', r, countingRng(9)]);
    const r2 = JSON.parse(JSON.stringify(s)), other = VIEWS.find(v => v.LW !== view.LW) ?? R.DEFAULT_VIEW;
    R.roastFed.command(r2, { k: 'view', ...other }, ctxOf(r2.t, rng));
    out.push(['restored+resized', r2, countingRng(9)]);
  }
  // the computer covers the seat: it pulls the roast and starts cutting; the player takes over with its finger still down
  // (mid-tap or mid-slice) and with some cuts made. Once raw (the hand-over hook not run: a stuck finger from anywhere), once
  // through the seat's hand-over hook (core/coop/plugins/roast.ts toPlayer)
  for (const hook of [false, true]) for (const cutsWanted of [0, 1]) {
    const { s, rng } = fresh(k, tier, pcs, view);
    let guard = 0;
    for (;;) {
      if (++guard > 60 * 30) throw new Error(`${k}: the computer never reached the board`);
      const ctx = ctxOf(s.t, rng);
      R.roastFed.step(s, 1 / 60, ctx);
      const cmd = R.roastFed.bot.next(s, ctx); if (cmd) R.roastFed.command(s, cmd, ctx);
      const b = s.board;
      if (b && b.k === k && b.drop <= 0 && b.cuts.length >= cutsWanted && s.f.down) break;
    }
    if (hook) R.handOver(s);
    out.push([`cover${hook ? '+hook' : ''} cuts>=${cutsWanted}`, s, rng]);
  }
  return out;
}

/** Cuts every guide left by pressing (or, 叉燒, slicing) on it; returns how many it cut. */
function chopAll(s, rng) {
  const h = harness(s, rng), b = s.board, L = h.L(), top = L.meatCy - b.h / 2, bot = L.meatCy + b.h / 2;
  let n = 0;
  for (let left = R.uncut(s, b); left.length; left = R.uncut(s, b)) {
    const g = left[0], before = b.cuts.length;
    if (b.k === 'char') { h.c('down', g, top + 2); for (let y = top + 4; y <= bot + 2; y += 2) { h.wait(0.02); h.c('move', g, y); } h.c('up', g, bot + 2); }
    else { h.c('down', g, L.meatCy); h.wait(0.08); h.c('up', g, L.meatCy); }
    h.wait(0.05);
    assert.equal(b.cuts.length, before + 1, `a press on guide ${g.toFixed(1)} cuts it`);
    assert.ok(b.cuts.includes(g), 'the cut lands on the guide');
    if (++n > 20) throw new Error('never done');
  }
  return n;
}
/** Drags what is on the board up onto the rail: the roast (or its cut pieces and the rest) hangs back on its hook. */
function returnIt(s, rng) {
  const h = harness(s, rng), b = s.board, L = h.L(), k = b.k;
  // off every guide: the leftover end (剩) when nothing is cut, else the middle of the first piece; low on the roast
  const left = R.uncut(s, b), snap = R.snapPx(s, b), gl = R.guides(b).at(-1);
  const x = b.cuts.length ? b.x0 + b.w / 2 : (gl + snap + 0.5 + b.x1 - 3) / 2, y = L.meatCy + b.h * 0.3;
  for (const g of left) assert.ok(Math.abs(g - x) > snap, 'the grab point is off the guides');
  const cuts = b.cuts.length;
  h.drag(x, y, x, L.rail.y + L.rail.h / 2, 12);
  assert.equal(s.board, null, `${k}: the board is clear`);
  assert.equal(b.cuts.length, cuts, 'the drag cut nothing');
  assert.equal(s.restBack?.b.k, k, 'it flies back to its hook');
  h.wait(R.TUNE.restBack + 0.1);
  assert.equal(s.restBack, null);
  // and the counter carries on: the roast can be pulled down again
  pull(s, rng, k);
  assert.equal(s.board?.k, k, 'pulled down again');
}

test('every roast on the board, however it got there, can be chopped and can be hung back (no soft lock)', () => {
  let cases = 0;
  for (const k of R.RAIL) for (let tier = 0; tier < R.TIERS; tier++) for (const pcs of KNOBS) for (const view of VIEWS) {
    for (const [how, s, rng] of arrivals(k, tier, pcs, view)) {
      const tag = `${k} tier ${tier} +${pcs} ${view.LW}x${view.LH} ${how}`;
      assert.equal(s.board?.k, k, `${tag}: on the board`);
      const a = structuredClone(s), b = structuredClone(s);
      try {
        chopAll(a, countingRng(3)); assert.ok(R.boardDone(a, a.board), `${tag}: every guide cut`);
        returnIt(b, countingRng(4));
      } catch (e) { e.message = `${tag}: ${e.message}`; throw e; }
      cases++;
    }
  }
  assert.ok(cases >= 4 * 4 * 2 * 2 * 7);
});

test('the roast sits in the middle of the board, every kind and size', () => {
  for (const k of R.RAIL) for (let tier = 0; tier < R.TIERS; tier++) for (const pcs of [0, 3, 6]) for (const view of VIEWS) {
    const { s, rng } = fresh(k, tier, pcs, view); pull(s, rng, k);
    const b = s.board, L = R.LY(s), mid = (b.x0 + b.x1) / 2, bc = L.board.x + L.board.w / 2;
    assert.ok(Math.abs(mid - bc) <= 0.5, `${k} tier ${tier} +${pcs} ${view.LW}: roast centre ${mid} vs board centre ${bc}`);
    assert.ok(b.x0 >= L.board.x + 2 && b.x1 <= L.board.x + L.board.w - 2, 'fits the board');
  }
});
