// The career features on the shop's rules, played by the sim bots: whole shifts in memory, no
// browser. Targets: a harder target is met less often, pays more when met and costs more when missed. Hard mode: it never
// troubles a fluent player over 20 shifts, while a struggling one gets warnings first, then loses the shop, and can win
// it back. Solo modes: 輪流做 and 一腳踢 keep the books straight (the ledger) and really move the player round the stations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runShift } from './shift.js';
import { freshCore } from './core.js';

const C = freshCore();
const score = r => ({ revenue: r.revenue, mistakes: r.mistakes, angry: r.angry, maxCombo: r.maxCombo });
/** Stars as ui/career.ts careerEnd gives them, with the chosen target as the goal. */
const stars = (r, met) => { const s1 = r.angry <= 3, s2 = s1 && met, s3 = s2 && r.mistakes <= 1 && r.angry <= 1; return s3 ? 3 : s2 ? 2 : s1 ? 1 : 0; };

test('targets: the three tiers in numbers: harder asks more, pays more when met, costs more when missed', () => {
  const pay = t => [C.targetPay(t, true), C.targetPay(t, false)];
  assert.deepEqual(pay('safe'), [100, 0]);
  assert.deepEqual(pay('bet'), [250, -100]);
  assert.deepEqual(pay('allin'), [1000, -200]);
  for (const seat of ['waiter', 'bar', 'kitchen', 'till', 'solo']) for (const diff of ['rookie', 'pro', 'ace']) {
    const n = t => C.targetN({ metric: 'rev', tier: t }, seat, 'lunch', diff);
    assert.ok(n('safe') < n('bet') && n('bet') < n('allin'), `rev line ${seat} ${diff}`);
    const k = t => C.targetN({ metric: 'combo', tier: t }, seat, 'lunch', diff);
    assert.ok(k('safe') < k('bet') && k('bet') < k('allin'), `combo ${seat} ${diff}`);
  }
  // caps: fewer mistakes / walk-outs allowed as the tier rises
  for (const m of ['clean', 'calm']) assert.ok(C.targetN({ metric: m, tier: 'safe' }, 'waiter', 'lunch', 'pro') > C.targetN({ metric: m, tier: 'allin' }, 'waiter', 'lunch', 'pro'));
  // an old or edited save: anything unknown falls back to 營業額 · 穩陣
  assert.deepEqual(C.cleanTarget(undefined), { metric: 'rev', tier: 'safe' });
  assert.deepEqual(C.cleanTarget({ metric: 'tips', tier: 'yolo' }), { metric: 'rev', tier: 'safe' });
  assert.deepEqual(C.cleanTarget({ metric: 'combo', tier: 'allin' }), { metric: 'combo', tier: 'allin' });
});

test('targets: played by a median bot, a harder target is met less often (revenue and combo, every one-station seat)', () => {
  const N = 12, rates = {};
  // REV_MEDIAN is the human "mid" profile's median, so the median player here is that profile (tests/sim/human.js).
  for (const station of ['waiter', 'bar', 'till']) for (const metric of ['rev', 'combo']) {
    const met = { safe: 0, bet: 0, allin: 0 };
    for (let i = 0; i < N; i++) {
      const r = runShift({ seed: 4001 + i * 31, station, slot: 'lunch', diff: 'pro', human: 'mid' });
      assert.deepEqual(r.errs, []);
      for (const t of ['safe', 'bet', 'allin']) if (C.targetMet(metric, C.targetN({ metric, tier: t }, station, 'lunch', 'pro'), score(r))) met[t]++;
    }
    rates[station + ' ' + metric] = met;
    assert.ok(met.safe >= met.bet && met.bet >= met.allin && met.safe > met.allin, `${station} ${metric}: ${JSON.stringify(met)}`);
  }
  // 穩陣 is meant to be met most of the time by a median player, 搏盡 rarely (aimed at ~80% / ~50% / ~25%)
  const sum = t => Object.values(rates).reduce((a, m) => a + m[t], 0), all = Object.keys(rates).length * N;
  assert.ok(sum('safe') / all >= .55, `safe met ${sum('safe')}/${all}`);
  assert.ok(sum('allin') / all <= .5, `allin met ${sum('allin')}/${all}`);
  console.log('E met rates (of ' + N + '):', JSON.stringify(rates));
});

/** One career shift in hard mode, as the page books it: takings − fixed costs + star prize + the 穩陣 stake. */
function careerShift(shop, o) {
  const r = runShift({ slot: 'lunch', diff: 'pro', ...o });
  assert.deepEqual(r.errs, []);
  const n = C.targetN({ metric: 'rev', tier: 'safe' }, o.station, 'lunch', 'pro'), met = C.targetMet('rev', n, score(r));
  const c = C.shiftCosts({ size: shop.size, placePrice: shop.price, owned: false, tables: shop.tables, helpers: 3, allStations: false });
  const net = r.revenue - c.total + stars(r, met) * 100 + C.targetPay('safe', met);
  const s = C.settleShift(shop.bank + net, net, shop.press, !!shop.lost);
  shop.bank = s.bank; shop.press = s.press;
  return { r, net, costs: c.total, stage: s.stage, fail: s.fail };
}

test('hard mode: a fluent player in hard mode never gets near failing over 20 shifts (small, mid and big shops)', () => {
  const shops = [{ size: 0, price: 12000, tables: 6 }, { size: 1, price: 24000, tables: 10 }, { size: 2, price: 36000, tables: 14 }];
  const log = [];
  for (const [i, station] of ['waiter', 'bar', 'till'].entries()) {
    const shop = { ...shops[i], bank: 500, press: { ...C.PRESS0 } };
    let worst = 0, losing = 0;
    for (let k = 0; k < 20; k++) {
      const x = careerShift(shop, { seed: 7001 + k * 13 + i, station, pace: .06, err: .03 });
      worst = Math.max(worst, x.stage); if (x.net < 0) losing++;
      assert.equal(x.fail, false, `${station} lost the shop on shift ${k + 1}`);
    }
    log.push(`${station} size ${shop.size}: bank ${shop.bank}, losing shifts ${losing}, worst stage ${worst}`);
    assert.ok(worst <= 1, `${station}: a fluent player got the landlord's letter (${log.at(-1)})`);
    assert.equal(shop.press.debt, 0);
  }
  console.log('F fluent:', log.join(' | '));
});

test('hard mode: a struggling player gets warnings first, then loses the shop (recoverable), and can win it back', () => {
  const shop = { size: 1, price: 12000, tables: 10, bank: 300, press: { ...C.PRESS0 }, lost: null };
  const stages = [];
  let failedAt = -1;
  for (let k = 0; k < 20 && failedAt < 0; k++) {
    const x = careerShift(shop, { seed: 9001 + k * 17, station: 'bar', pace: .008, err: .2 });
    stages.push(x.stage);
    if (x.fail) failedAt = k;
  }
  assert.ok(failedAt >= 0, `the struggling bot never lost the shop: stages ${stages}`);
  // the warnings came before the failure: a losing-shift warning, then the landlord's letter
  const before = stages.slice(0, failedAt);
  assert.ok(before.includes(1) && before.includes(2), `no warning before the failure: ${stages}`);
  assert.ok(before.indexOf(1) < before.indexOf(2), `letter before the first warning: ${stages}`);
  // recoverable: the restart money, the owing written off, the streak cleared; a smaller shop waits to be won back
  assert.equal(shop.bank, C.PRESS.restart);
  assert.deepEqual(shop.press, { red: 0, debt: 0, fails: 1, back: 0 });
  Object.assign(shop, { size: 0, tables: 6, lost: { size: 1 } });
  // the player gets better: PRESS.comeback profitable shifts and the old shop is offered back
  let k = 0;
  while (shop.press.back < C.PRESS.comeback && k < 15) careerShift(shop, { seed: 9501 + k++ * 7, station: 'waiter', pace: .03 });
  assert.ok(shop.press.back >= C.PRESS.comeback, `never won back: ${JSON.stringify(shop.press)} after ${k} shifts`);
  console.log(`F struggling: stages ${stages.join(',')} (lost on shift ${failedAt + 1}), won back after ${k} shifts`);
});

test('solo modes: 輪流做 and 一腳踢 — the books stay straight and the player really moves round the stations', () => {
  for (const solo of ['rotate', 'all']) for (const slot of ['breakfast', 'lunch', 'dinner']) for (let i = 0; i < 3; i++) {
    const r = runShift({ seed: 3001 + i * 101, station: 'waiter', slot, diff: 'pro', pace: .03, solo });
    assert.deepEqual(r.errs, [], `${solo} ${slot}`);
    assert.ok(r.served > 5, `${solo} ${slot}: served ${r.served}`);
    // a 3-minute shift: 輪流做 changes every 45 s (3 moves), 一腳踢 goes where the work is
    if (solo === 'rotate') assert.ok(r.switches >= 3, `rotate switches ${r.switches}`);
    else assert.ok(r.switches >= 5, `一腳踢 switches ${r.switches}`);
  }
});

