// Catalogue of every screen / overlay / station view, each with how to reach it from a fresh page.
// Used by ui-visuals.test.js (screenshots + layout audit) at phone, desktop and portrait-monitor sizes.
import { veteran, fastForward } from './browser.js';
import { startShift, endShift, vet, sleep, settle } from './ui.js';

const ALL_GATES = ['shop', 'rookie', 'dex', 'pro'];
const V = (extra = {}) => vet('老闆', { gates: ALL_GATES, bank: 3500, ing: { 雞蛋: 4, 牛肉: 3, 麵: 2, 檸檬: 2, 茶葉: 2, 咖啡豆: 2 }, ingStart: true, ...extra });
const click = (sel) => async p => { await p.click(sel); };
const book = (open, ...more) => async p => { await p.click(open); for (const m of more) await p.click(m); };
const shop = async p => { await p.click('#shopBtn'); };
const decor = (tab, sub) => async p => { await shop(p); await p.click('#decorBtn'); if (tab) await p.click(`#decorBar [data-tab="${tab}"]`); if (sub) await p.click(`#decorBar [data-sub="${sub}"]`); await sleep(300); };
const live = (station, secs, slot = 'lunch') => async p => { await startShift(p, { station, slot }); await fastForward(p, secs); await sleep(200); };

export const SCREENS = [
  // ---- home ----
  { id: 'home-new-player', root: '#startView', storage: {}, setup: async () => {} },
  { id: 'home-trained-locked', root: '#startView', storage: { 'ckf-shop': JSON.stringify({ skipTut: true, nick: 'x', gates: [] }) }, setup: async () => {} },
  { id: 'home-rookie', root: '#startView', storage: vet('新人', { stars: 3, shifts: 3, gates: ALL_GATES, tutDone: { waiter: 1 } }), setup: async () => {} },
  { id: 'home-veteran', root: '#startView', storage: V(), setup: async () => {} },
  { id: 'home-shop-step', root: '#startView', storage: V(), setup: shop },
  { id: 'home-shop-rename', root: '#startView', storage: V(), setup: async p => { await shop(p); await p.click('#shopRename'); } },
  { id: 'home-nick-edit', root: '#startView', storage: V(), setup: click('#nickBtn') },
  { id: 'home-signed-in', root: '#startView', storage: V(), cloud: true, setup: async p => { await p.click('#devSignInBtn'); await p.waitForSelector('#signOutBtn'); await p.waitForFunction(() => cloudState === 'on'); } },
  { id: 'gate-popup', root: '#gatePop', storage: V({ gates: [] }), setup: async p => { await p.waitForSelector('#gatePop'); } },
  // ---- overlays ----
  ...[0, 1, 2, 3, 4].map(i => ({ id: 'help-tab' + i, root: '#helpView', storage: V(), setup: async p => { await p.click('#helpBtn'); const n = await p.locator('#helpTabs button').count(); await p.locator('#helpTabs button').nth(Math.min(i, n - 1)).click(); } })),
  { id: 'coop-lobby', root: '#coopView', storage: V(), setup: click('#coopBtn') },
  { id: 'coop-hosted', root: '#coopView', storage: V(), setup: async p => { await p.click('#coopBtn'); await p.click('#hostBtn'); await p.waitForSelector('#coop .roomcode', { timeout: 8000 }); } },
  ...['main', 'era', 'old', 'classic', 'hell'].map(t => ({ id: 'levels-' + t, root: '#bookView', storage: V(), setup: async p => { await p.click('#levelBtn'); await p.click(`#book [data-lvt="${t}"]`); } })),
  { id: 'training', root: '#bookView', storage: V(), setup: click('#tutBtn') },
  { id: 'wardrobe', root: '#bookView', storage: V(), setup: click('#wardBtn') },
  { id: 'wardrobe-tryon', root: '#bookView', storage: V(), setup: async p => { await p.click('#wardBtn'); await p.click('#book [data-wk="cap"]'); await p.click('#book [data-wk="hawaii"]'); } },
  { id: 'tea-grade', root: '#bookView', storage: V(), setup: click('#gradeBtn') },
  { id: 'regulars-book', root: '#bookView', storage: V({ regs: { 李伯: 3 }, celebs: {}, eggs: {} }), setup: async p => { await shop(p); await p.click('#bookBtn'); } },
  { id: 'dex', root: '#bookView', storage: V(), setup: async p => { await shop(p); await p.click('#dexBtn'); } },
  ...['breakfast', 'lunch', 'dinner', 'drinks', 'special'].map(t => ({ id: 'recipes-' + t, root: '#bookView', storage: V(), setup: async p => { await shop(p); await p.click('#recipeBtn'); await p.click(`#book [data-rt="${t}"]`); } })),
  { id: 'pantry', root: '#bookView', storage: V(), setup: async p => { await shop(p); await p.click('#recipeBtn'); await p.click('#pantryBtn'); } },
  { id: 'branches', root: '#bookView', storage: V(), setup: async p => { await p.evaluate(() => openBranches()); } },
  { id: 'leaderboard-guest', root: '#bookView', storage: V(), setup: async p => { await p.click('#lbBtn'); await p.waitForSelector('#lbMsg'); await sleep(300); } },
  // ---- decor ----
  { id: 'decor-move', root: '#app', storage: V(), setup: decor() },
  { id: 'decor-look-wall', root: '#app', storage: V(), setup: decor('look', 'wall') },
  { id: 'decor-look-floor', root: '#app', storage: V(), setup: decor('look', 'floor') },
  { id: 'decor-look-sign', root: '#app', storage: V(), setup: decor('look', 'sign') },
  { id: 'decor-look-awning', root: '#app', storage: V(), setup: decor('look', 'awning') },
  { id: 'decor-buy-tables', root: '#app', storage: V(), setup: decor('buy', 'tables') },
  { id: 'decor-buy-items', root: '#app', storage: V(), setup: decor('buy', 'items') },
  { id: 'decor-buy-set', root: '#app', storage: V(), setup: async p => { await decor('buy')(p); const s = await p.$$eval('#decorBar .dsubs button', b => b.map(x => x.dataset.sub)); await p.click(`#decorBar [data-sub="${s[2]}"]`); } },
  { id: 'decor-estate-place', root: '#app', storage: V(), setup: decor('grow', 'place') },
  { id: 'decor-estate-size', root: '#app', storage: V(), setup: decor('grow', 'size') },
  { id: 'decor-furnished', root: '#app', storage: V({ items: [{ type: 'plant', tx: 6, ty: 1 }, { type: 'tank', tx: 7, ty: 5 }], size: 1 }), setup: decor() },
  // ---- stations mid-shift ----
  { id: 'shift-waiter-3d', root: '#app', storage: V(), setup: async p => { await live('waiter', 40)(p); } },
  { id: 'shift-waiter-simple', root: '#app', storage: V({}), seed: { 'ckf-view': 'simple' }, setup: async p => { await live('waiter', 40)(p); } },
  { id: 'shift-waiter-order-sheet', root: '#sheetWrap', storage: V(), setup: async p => { await live('waiter', 5)(p); await p.evaluate(() => { const g = makeGroup(); g.table = 0; g.state = 'order'; g.until = G.t + 100; g.max = 100; G.groups.push(g); bump(); openSheet(g); renderSheet(); }); await sleep(200); } },
  { id: 'shift-kitchen', root: '#app', storage: V(), setup: live('kitchen', 40) },
  { id: 'shift-kitchen-dinner', root: '#app', storage: V(), setup: live('kitchen', 40, 'dinner') },
  { id: 'shift-bar', root: '#app', storage: V(), setup: live('bar', 40) },
  { id: 'shift-till', root: '#app', storage: V(), setup: live('till', 25) },
  { id: 'shift-till-board', root: '#boardWrap', storage: V(), setup: async p => { await live('till', 10)(p); await p.click('#boardBtn'); } },
  { id: 'shift-level-estate', root: '#app', storage: V(), setup: async p => { await p.click('#levelBtn'); await p.click('#book [data-lv="estate"]'); await p.waitForFunction(() => G.running); await fastForward(p, 40); await sleep(200); } },
  { id: 'shift-tutorial-waiter', root: '#app', storage: {}, setup: async p => { await p.click('#firstGo'); await p.waitForFunction(() => G.running && G.tut); await fastForward(p, 8); await sleep(400); } },
  { id: 'shift-fever', root: '#app', storage: V(), setup: async p => { await live('waiter', 30)(p); await p.evaluate(() => { G.feverAt = G.t - 15; document.body.classList.add('fever'); }); await sleep(300); } },
  { id: 'shift-pause', root: '#pauseView', storage: V(), setup: async p => { await live('waiter', 10)(p); await p.click('#pauseBtn'); await sleep(300); } },
  // ---- end of shift ----
  ...['waiter', 'kitchen', 'bar', 'till'].map(st => ({ id: 'end-' + st, root: '#endView', storage: V(), setup: async p => { await startShift(p, { station: st }); await endShift(p, { revenue: 640, angry: 1, mistakes: 2, loss: 20 }); } })),
  { id: 'end-with-errors', root: '#endView', storage: V(), setup: async p => { await startShift(p, { station: 'waiter' }); await endShift(p, { revenue: 640, angry: 1, mistakes: 2, errLog: [{ tb: '一號卡', said: '凍奶茶走甜加底', wrote: ['奶茶'], want: ['凍奶茶走甜'] }, { tb: '三號卡', said: '照舊', wrote: [], want: ['常餐', '熱檸茶'] }] }); } },
  { id: 'end-level-3-stars', root: '#endView', storage: V(), setup: async p => { await p.click('#levelBtn'); await p.click('#book [data-lv="estate"]'); await p.waitForFunction(() => G.running); await endShift(p, { revenue: 99999 }); } },
  { id: 'end-tutorial', root: '#endView', storage: {}, setup: async p => { await p.click('#firstGo'); await p.waitForFunction(() => G.running && G.tut); await p.evaluate(() => endGame()); } },
  { id: 'share-card', root: '#bookView', storage: V(), setup: async p => { await startShift(p, { station: 'waiter' }); await endShift(p, { revenue: 640, angry: 0, mistakes: 0 }); await p.click('#shareBtn'); } },
];
export const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 } },
  portrait: { viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 },
};
