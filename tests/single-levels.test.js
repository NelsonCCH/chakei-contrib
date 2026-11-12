// Single player, every level (關卡): each fixed shop is played through once per station by the bot. Checks the layout,
// that the shift runs and ends, that stars follow the revenue lines, and that the money (人工 multiplier, star prizes,
// bonuses) is booked exactly as the rules say.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, realErrors } from './helpers/browser.js';
import { openSingle, runToEnd, state, endCard, cell, assertClean } from './helpers/single.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const STATIONS = ['waiter', 'kitchen', 'bar', 'till'];
// The third star of a one-person level shift: average seconds
const LV_NEED = { waiter: 14, bar: 25.5, kitchen: 29, till: 9 };
const LV_SPEED = { waiter: '坐低到落單平均 14 秒內', bar: '落單到出飲品平均 25.5 秒內', kitchen: '落單到出碟平均 29 秒內', till: '每張單收錢平均 9 秒內' };

for (const station of STATIONS) {
  test(`every level as ${station}: runs to the end, stars and money are booked by the rules`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
    const ids = await page.evaluate(() => Object.keys(LEVELS));
    assert.ok(ids.length >= 16, 'levels: ' + ids.length);
    const seen = [];
    for (const id of ids) {
      await page.evaluate(([id, st]) => {
        Bot.reset(); CFG.aiErr = 0; CFG.aiBarErr = 0; CFG.aiKitErr = 0;
        document.getElementById('startView').hidden = true;
        station = st; armLevel(id); start(); G.regPlan = [];
      }, [id, station]);
      const info = await page.evaluate(() => ({ level: G.level, slot: G.slot, tables: TABLES.length, want: LEVELS[G.level].lay.tables.length, diff, station: G.station, stars: curLine(), own: STAR_LINES[G.level][G.station], goalTxt: goalText(), bank: SHOP.bank, total: SHOP.stars, had: SHOP.levels[G.level] | 0, lvst: (SHOP.lvst[G.level] || {})[G.station] | 0, mult: LEVELS[G.level].hell ? 2.5 : LEVELS[G.level].fest ? 2 : G.level === pickLevel() ? 2 : 1.5, d3: (SHOP.lv3day || {})[G.level] === todayStr(), hell: !!LEVELS[G.level].hell }));
      assert.equal(info.level, id);
      assert.equal(info.tables, info.want, `${id}: the level's own tables`);
      assert.equal(info.station, station);
      // a solo shift is judged by this station's own line, and the goal shown says so
      assert.deepEqual(info.stars, info.own, `${id}: the ${station} line`);
      // one and two stars on revenue, the third on the station's speed (the level lines)
      assert.equal(info.goalTxt, `營業額 $${info.own[0]} ★、$${info.own[1]} ★★；★★★ 再要${LV_SPEED[station]}`, `${id}: goal text`);
      if (station === 'kitchen') {
        // every dish the level's menu can order has all its parts on this level's stoves and bins (otherwise the order can never be cooked)
        const stuck = await page.evaluate(() => {
          const lay = kitLayout(), keys = [], out = [];
          for (const s of SETS.filter(x => menuOpen('s:' + x.id))) for (const noodle of NOODLES) for (const egg of EGGS) for (const bread of BREADS) for (const [h, f] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
            const roll = bread === '餐包'; if ((h && !roll) || (f && roll && !h)) continue;
            keys.push('s' + [s.id, noodle, egg, bread + (h ? '烘底' : '') + (f ? '飛邊' : '')].join(' '));
          }
          for (const d of DISHES.filter(x => menuOpen('d:' + x.id))) for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) { if (a && !d.sauce) continue; keys.push('d' + d.id + (a ? '炒底' : '') + (b ? '加底' : '') + (c ? '走青' : '')); }
          for (const f of FOODS.filter(x => menuOpen('f:' + x.id))) { keys.push('f' + f.id); if (HAT_OK.includes(f.id)) keys.push('f' + f.id + HAT_TXT); }
          const can = t => lay.inst.includes(t) || Object.values(lay.st).some(l => l.includes(t)) || (t.includes('·飯×') && (lay.st.wok || []).includes(t.split('·')[0])) || (t.endsWith('烘底') && (lay.st.toaster || []).includes(t.slice(0, -2)));
          for (const k of keys) { const miss = Oracle.tokens(k).filter(t => !can(t)); if (miss.length) out.push([k, miss]); }
          return out.slice(0, 5);
        });
        assert.deepEqual(stuck, [], id + ': dishes on the menu that this kitchen cannot make');
      }
      await runToEnd(page);
      const st = await state(page), card = await endCard(page);
      assert.equal(st.running, false, id + ' ended');
      assert.equal(await page.evaluate(() => G.t), 180);
      // the shift's speed from the state the end card reads, checked against the line by hand
      const sp = await page.evaluate(st => { const a = (G.spd || {})[st]; return { n: a ? a[0] : 0, avg: a && a[0] ? a[1] / a[0] : null }; }, station);
      const two = info.stars.slice(0, 2).filter(l => st.revenue >= l).length, fast = sp.avg !== null && sp.avg <= LV_NEED[station];
      const stars = two === 2 && fast ? 3 : two;
      const after = await page.evaluate(() => ({ bank: SHOP.bank, total: SHOP.stars, best: SHOP.levels[G.level] | 0, lvst: (SHOP.lvst[G.level] || {})[G.station] | 0, tables: TABLES.length, diff, fixed: fixedShop, aria: (document.querySelector('#result .stars b') || {}).getAttribute && document.querySelector('#result .stars b').getAttribute('aria-label') }));
      assert.equal(after.best, Math.max(info.had, stars), `${id}: best stars`);
      assert.equal(after.total - info.total, Math.max(0, stars - info.had), `${id}: only new stars count`);
      assert.equal(after.lvst, Math.max(info.lvst, stars), `${id}: per-station record`);
      assert.equal(after.aria, `${stars} 粒星`, id + ' card stars');
      const lineTxt = await page.evaluate(() => document.querySelector('#result .stars span:last-child').textContent);
      const stName = { waiter: '伙記', kitchen: '廚房', bar: '水吧', till: '收銀' }[station];
      const have = sp.avg === null ? '你未做過' : `你平均 ${sp.avg.toFixed(1)} 秒`;
      assert.ok(lineTxt.includes(`營業額 $${st.revenue}（${stName}：★ $${info.own[0]} · ★★ $${info.own[1]} · ★★★ 再要${LV_SPEED[station]}，${have} ${fast ? '✓' : '✗'}）`), `${id}: the card shows the station's line and speed: ${lineTxt}`);
      assert.equal(card.sign, stars ? ['', '過關', '好嘢', '完美'][stars] : '唔夠數', id + ' sign');
      // money: revenue x multiplier, 300 per new star, 300 for the day's first three-star, the streak and first-time bonuses shown on the card
      const gain = Math.max(0, stars - info.had), d3 = stars === 3 && !info.d3;
      const extra = await page.evaluate(() => [...document.querySelectorAll('#result .wide')].filter(w => /返工第|第一次做/.test(w.innerText)).reduce((a, w) => a + (+(w.querySelector('b').textContent.match(/\+\$(\d+)/) || [0, 0])[1]), 0));
      assert.equal(after.bank - info.bank, Math.round(st.revenue * info.mult) + gain * 300 + (d3 ? 300 : 0) + extra, `${id}: bank, revenue ${st.revenue} x ${info.mult}`);
      // back to the normal shop
      assert.equal(after.fixed, null, id + ': the fixed shop is left');
      assert.equal(after.tables, 6, id + ': own shop tables back');
      assert.equal(after.diff, 'pro', id + ': own difficulty back');
      seen.push([id, st.revenue, stars, sp.avg]);
    }
    console.log(`${station} (fast perfect bot): ` + seen.map(([id, rev, s, avg]) => `${id} $${rev} ${s}★ ${avg === null ? '-' : avg.toFixed(1) + 's'}`).join(', '));
    const dead = seen.filter(([, rev]) => rev <= 0);
    assert.deepEqual(dead, [], 'a level where the bot earned nothing: ' + JSON.stringify(dead));
    await assertClean(assert, page, station + ' levels');
    await page.context().close();
  });
}

test('star lines: every level has its own rising line per station; co-op keeps the team line', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
  const r = await page.evaluate(() => Object.keys(LEVELS).map(id => ({ id, team: LEVELS[id].stars, own: STAR_LINES[id],
    solo: Object.fromEntries(['waiter', 'kitchen', 'bar', 'till'].map(s => [s, lvLine(id, s, false)])),
    coop: ['waiter', 'kitchen', 'bar', 'till'].map(s => lvLine(id, s, true)), odd: lvLine(id, 'decor', false) })));
  for (const L of r) {
    assert.ok(L.own, `${L.id}: no per-station lines`);
    for (const s of ['waiter', 'kitchen', 'bar', 'till']) {
      const [a, b, c] = L.own[s];
      assert.ok(a > 0 && a < b && b < c, `${L.id} ${s}: ${L.own[s]}`);
      assert.deepEqual(L.solo[s], L.own[s], `${L.id} ${s}: a solo shift uses its own line`);
    }
    for (const c of L.coop) assert.deepEqual(c, L.team, `${L.id}: co-op is judged on the team line`);
    assert.deepEqual(L.odd, L.team, `${L.id}: anything but a station falls back to the team line`);
    // the kitchen is the slowest station, so its line is never above the waiter's
    assert.ok(L.own.kitchen[1] <= L.own.waiter[1], `${L.id}: kitchen 2★ ${L.own.kitchen[1]} vs waiter ${L.own.waiter[1]}`);
  }
  await page.context().close();
});
