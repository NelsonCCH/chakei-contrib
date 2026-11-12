// 裝修套裝：按類型（唔係真舖）分幾套擺設，買齊一套有獎勵。全部原創設計，唔用真實店名、招牌
// TypeScript port of the original game's sets.js, as an ES module: every
// top-level name is exported, none renamed.
import './decor';   // load order: src/entry.ts







import { must } from '../core/util';
import { CFG } from '../core/data/menus';
import { toast } from './ui';
import { P, INK, el } from './kitchen';
import { PX, setPX } from './pixel';
import { isoBox, isoPt, ceilingFan, ISO, line, isoO, setIsoO, poly, drawBackdrop } from './floor-iso';
import { ITEMS, SHOP, fixedShop, PLACES, saveShop, chip, decorMode, setDecorMode, drawItem, TKINDS, LOOKS } from './decor';
import { sfx } from './juice';
import { gradeFlow } from './market';


/* ===================== 套裝擺設 ===================== */
// draw(x, y, now) 喺 (x, y) 格畫，回傳頂部高度（俾裝修撳中用）
export const SET_ITEMS: Record<string, SetItem> = {
  cake:    { name:'玻璃蛋糕櫃', p:900,  w:1,  d:.5, chip:'#e6f4f8', draw(x, y){
    isoBox(x + .05, y + .05, .9, .4, 14, '#8a5a32', '#6a4424', '#7a4e2a');
    isoBox(x + .05, y + .05, .9, .4, 16, '#e6f4f8', '#bcd9e2', '#a9c8d4', 14, '#5d6870');
    for (let k = 0; k < 4; k++){ const p = isoPt(x + .2 + k * .2, y + .45, 18); P(p.x - 2, p.y - 3, 5, 3, String(['#ffd25a', '#f2a0a8', '#c48a5a', '#fbfaf4'][k])); P(p.x - 2, p.y - 4, 5, 1, '#c8323c'); }
    return 32; } },
  cans:    { name:'罐頭架',     p:600,  w:1,  d:.3, chip:'#d9473f', draw(x, y){
    isoBox(x + .05, y + .02, .9, .26, 40, '#a07040', '#7a5232', '#8a5a32');
    for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++){ const p = isoPt(x + .12 + k * .14, y + .28, 6 + r * 9); P(p.x - 1, p.y - 6, 4, 6, INK); P(p.x, p.y - 5, 2, 4, String(['#d9473f', '#e9a21a', '#c8323c', '#3d7fbf'][(k + r) % 4])); }
    return 42; } },
  fan:     { name:'吊扇',       p:700,  w:.5, d:.5, chip:'#6a4a2a', draw(x, y, now){
    ceilingFan(isoPt(x + .25, y + .25, ISO.WALL - 10), now); return ISO.WALL; } },
  crate:   { name:'玻璃樽汽水箱', p:500, w:.5, d:.5, chip:'#c8a070', draw(x, y){
    isoBox(x + .05, y + .05, .4, .4, 10, '#c8a070', '#a07848', '#b08858');
    for (let k = 0; k < 4; k++){ const p = isoPt(x + .15 + (k % 2) * .2, y + .15 + Math.floor(k / 2) * .2, 10); P(p.x - 1, p.y - 8, 3, 8, INK); P(p.x, p.y - 7, 1, 7, String(['#7a3e1a', '#2a8b67', '#c8323c', '#7a3e1a'][k])); }
    return 20; } },
  clock:   { name:'座地老爺鐘', p:1100, w:.4, d:.4, chip:'#5a3418', draw(x, y, now){
    isoBox(x + .02, y + .02, .36, .36, 44, '#6a4424', '#4a3020', '#5a3a20');
    const p = isoPt(x + .2, y + .38, 34); el(p.x, p.y, 4, 4, '#fbfaf4'); P(p.x, p.y - 3, 1, 3, INK);
    const sw = Math.round(Math.sin(now / 300) * 2), q = isoPt(x + .2, y + .38, 16); P(q.x + sw, q.y - 6, 1, 6, '#e9a21a'); el(q.x + sw, q.y, 2, 2, '#e9a21a', null);
    return 46; } },
  grille:  { name:'鐵窗花屏風', p:800,  w:1,  d:.2, chip:'#2a8b67', draw(x, y){
    const a = isoPt(x + .05, y + .1, 0), b = isoPt(x + .95, y + .1, 0);
    for (let k = 0; k <= 8; k++){ const t = k / 8, px = Math.round(a.x + (b.x - a.x) * t), py = Math.round(a.y + (b.y - a.y) * t); P(px, py - 36, 1, 36, '#1f6a4f'); }
    for (let r = 0; r <= 4; r++){ for (let k = 0; k < 16; k++){ const t = k / 16, px = Math.round(a.x + (b.x - a.x) * t), py = Math.round(a.y + (b.y - a.y) * t) - r * 9; P(px, py, 2, 1, '#1f6a4f'); } }
    for (let k = 0; k < 4; k++){ const t = (k + .5) / 4, px = Math.round(a.x + (b.x - a.x) * t), py = Math.round(a.y + (b.y - a.y) * t) - 18; el(px, py, 3, 3, '#2a8b67', '#1f6a4f'); }
    return 38; } },
  lamp:    { name:'鎢絲吊燈',   p:600,  w:.5, d:.5, chip:'#ffd25a', draw(x, y, now){
    const p = isoPt(x + .25, y + .25, ISO.WALL - 8); P(p.x, p.y - 20, 1, 20, INK);
    el(p.x, p.y + 2, 6, 3, '#2a8b67', INK); el(p.x, p.y + 5, 3, 2, Math.floor(now / 1500) % 9 ? '#ffe9a8' : '#ffd25a', null);
    for (let k = 0; k < 3; k++) P(p.x - 6 + k * 5, p.y + 9 + k % 2, 1, 2, 'rgba(255,233,168,.6)');
    return ISO.WALL; } },
  marble:  { name:'雲石花几',   p:700,  w:.5, d:.5, chip:'#e8e4dc', draw(x, y){
    isoBox(x + .12, y + .12, .26, .26, 18, '#e8e4dc', '#c9c2b0', '#d8d2c4');
    const p = isoPt(x + .25, y + .25, 18); P(p.x - 3, p.y - 7, 6, 7, '#3d7fbf'); P(p.x - 5, p.y - 13, 4, 6, '#c8323c'); P(p.x + 1, p.y - 14, 4, 7, '#ffd25a'); P(p.x - 1, p.y - 16, 3, 5, '#4f9a4a');
    return 34; } },
  register:{ name:'舊式收銀機', p:1000, w:.5, d:.5, chip:'#9aa6ad', draw(x, y){
    isoBox(x + .02, y + .02, .46, .46, 16, '#8a5a32', '#6a4424', '#7a4e2a');
    isoBox(x + .1, y + .1, .3, .3, 10, '#c9d1d6', '#9aa6ad', '#8d9aa2', 16);
    const p = isoPt(x + .25, y + .4, 24); P(p.x - 5, p.y - 2, 10, 3, INK); P(p.x - 4, p.y - 1, 8, 1, '#7be08f');
    return 30; } },
  hatstand:{ name:'衣帽架',     p:400,  w:.3, d:.3, chip:'#6a4424', draw(x, y){
    const p = isoPt(x + .15, y + .15, 0); P(p.x, p.y - 40, 2, 40, '#6a4424'); P(p.x - 5, p.y - 40, 12, 2, '#6a4424'); el(p.x - 4, p.y - 36, 4, 3, '#3a4a6a'); P(p.x - 3, p.y, 8, 2, '#4a3020');
    return 42; } },
  neonbox: { name:'霓虹燈箱',   p:1500, w:1,  d:.2, chip:'#ff5ab4', draw(x, y, now){
    isoBox(x + .05, y + .02, .9, .16, 22, '#1b1b2a', '#11111c', '#15151f', 18);
    const on = Math.floor(now / 700) % 6; const a = isoPt(x + .2, y + .18, 30), b = isoPt(x + .8, y + .18, 30);
    for (let k = 0; k < 10; k++){ const t = k / 9, px = Math.round(a.x + (b.x - a.x) * t), py = Math.round(a.y + (b.y - a.y) * t); P(px, py - 3, 2, 2, on ? (k % 2 ? '#ff5ab4' : '#5ad8ff') : '#3a2a3a'); }
    return 42; } },
  tray:    { name:'托盤架',     p:400,  w:.5, d:.5, chip:'#e07a1a', draw(x, y){
    isoBox(x + .08, y + .08, .34, .34, 24, '#9aa6ad', '#6f7b85', '#56616b');
    for (let k = 0; k < 4; k++) isoBox(x + .06, y + .06, .38, .38, 1, String(['#e07a1a', '#c8323c', '#ffd25a', '#2a8b67'][k]), '#0f1a16', '#0f1a16', 8 + k * 5, null);
    return 26; } },
  jukebox: { name:'點唱機',     p:1800, w:.5, d:.5, chip:'#c8323c', draw(x, y, now){
    isoBox(x + .04, y + .04, .42, .42, 30, '#c8323c', '#8e2027', '#a5272f');
    const p = isoPt(x + .25, y + .46, 18), f = Math.floor(now / 300) % 3;
    el(p.x, p.y - 6, 6, 4, '#ffd25a', INK); for (let k = 0; k < 3; k++) P(p.x - 5 + k * 4, p.y + 2, 2, 3, k===f ? '#7be08f' : '#2b3036');
    return 32; } },
  chairs:  { name:'橙色膠椅（一疊）', p:300, w:.5, d:.5, chip:'#f2a33a', draw(x, y){
    for (let k = 0; k < 4; k++) isoBox(x + .1, y + .1, .3, .3, 2, '#f2a33a', '#c8781a', '#d9892a', k * 4);
    const p = isoPt(x + .1, y + .1, 16); P(p.x - 1, p.y - 10, 2, 10, '#c8781a');
    return 28; } },
  tv:      { name:'電視架',     p:1200, w:.5, d:.5, chip:'#2b3036', draw(x, y, now){
    const p = isoPt(x + .25, y + .25, 0); P(p.x, p.y - 44, 2, 44, '#5d6870');
    isoBox(x + .05, y + .05, .4, .4, 14, '#2b3036', '#1b1f24', '#22272c', 44);
    const s = isoPt(x + .25, y + .45, 50); P(s.x - 5, s.y - 4, 10, 7, String(['#3d7fbf', '#2a8b67', '#c8323c'][Math.floor(now / 2000) % 3]));
    return 60; } },
  news:    { name:'報紙架',     p:400,  w:.5, d:.3, chip:'#e8dcc0', draw(x, y){
    isoBox(x + .05, y + .02, .4, .26, 26, '#7a5232', '#5e3e26', '#6a4424');
    for (let k = 0; k < 3; k++){ const p = isoPt(x + .12 + k * .12, y + .28, 10 + k * 6); P(p.x - 3, p.y - 6, 7, 7, '#e8dcc0'); P(p.x - 2, p.y - 5, 5, 1, '#c8323c'); P(p.x - 2, p.y - 3, 5, 1, '#5d6870'); }
    return 28; } },
  kerosene:{ name:'火水爐',     p:500,  w:.5, d:.5, chip:'#3d7fbf', draw(x, y, now){
    isoBox(x + .1, y + .1, .3, .3, 10, '#3d7fbf', '#2f6aa3', '#3570ae');
    const p = isoPt(x + .25, y + .25, 10); for (let k = -1; k <= 1; k++) P(p.x + k * 3, p.y - 3 - (Math.floor(now / 120) + k) % 2, 2, 3, '#ffb347');
    isoBox(x + .12, y + .12, .26, .26, 8, '#9aa6ad', '#6f7b85', '#56616b', 13);
    return 22; } },
  stools:  { name:'紅膠櫈（一疊）', p:300, w:.4, d:.4, chip:'#e0483c', draw(x, y){
    for (let k = 0; k < 5; k++) isoBox(x + .06, y + .06, .28, .28, 2, '#e0483c', '#a82c22', '#c23a2f', k * 4);
    return 22; } },
  urn:     { name:'大茶壺',     p:600,  w:.5, d:.5, chip:'#c9d1d6', draw(x, y, now){
    isoBox(x + .1, y + .1, .3, .3, 18, '#c9d1d6', '#9aa6ad', '#8d9aa2');
    const p = isoPt(x + .4, y + .25, 12); P(p.x, p.y - 2, 5, 2, '#9aa6ad');
    for (let k = 0; k < 2; k++){ const q = isoPt(x + .25, y + .25, 18); P(q.x - 2 + k * 4, q.y - 4 - (now / 200 + k * 3) % 6, 1, 2, '#fbfaf4'); }
    return 26; } },
};
Object.assign(ITEMS, SET_ITEMS);
// 套裝：每套幾件，買齊有自己嘅效果（只喺「我的茶餐廳」計，關卡唔計），門面仲會多一盞燈籠
// 萬聖限定擺設：喺「長洲萬聖夜」攞到幾多粒星解鎖，解鎖咗一直買得
Object.assign(SET_ITEMS, {
  pumpkin: { name:'南瓜燈',   p:300, w:.5, d:.5, chip:'#e8701a', star:1, draw(x: number, y: number, now: number): number {
    const p = isoPt(x + .25, y + .25, 0), g = Math.floor(now / 200) % 4 ? '#ffe04a' : '#ffb020';
    el(p.x, p.y - 5, 7, 5, '#e8701a', '#8a3a0a'); P(p.x - 1, p.y - 12, 2, 3, '#3a6a2a'); P(p.x - 4, p.y - 7, 2, 2, g); P(p.x + 2, p.y - 7, 2, 2, g); P(p.x - 3, p.y - 4, 6, 1, g); return 14; } },
  cobweb:  { name:'蜘蛛網',   p:200, w:.5, d:.5, chip:'#c9d1d6', star:1, draw(x: number, y: number): number {
    const p = isoPt(x + .25, y + .25, ISO.WALL - 10);
    for (let k = 0; k < 4; k++) line({ x:p.x, y:p.y - 10 }, { x:p.x - 10 + k * 7, y:p.y + 6 }, '#d8dee2');
    for (let r = 1; r < 4; r++){ for (let k = -3; k <= 3; k++) P(p.x + k * r * 1.2, p.y - 10 + r * 4, 1, 1, '#d8dee2'); }
    P(p.x + 2, p.y + 2, 3, 3, '#0f1a16'); return ISO.WALL; } },
  candles: { name:'白蠟燭台', p:400, w:.5, d:.5, chip:'#fbfaf4', star:2, draw(x: number, y: number, now: number): number {
    isoBox(x + .12, y + .12, .26, .26, 10, '#5a3a20', '#3a2414', '#4a3020');
    for (let k = 0; k < 3; k++){ const p = isoPt(x + .17 + k * .08, y + .3, 10); P(p.x, p.y - 8 - k, 2, 8 + k, '#fbfaf4'); P(p.x, p.y - 11 - k - (Math.floor(now / 150 + k) % 2), 2, 2, '#ffb020'); } return 24; } },
  skull:   { name:'骷髏頭擺設', p:500, w:.5, d:.5, chip:'#e8e4dc', star:2, draw(x: number, y: number): number {
    isoBox(x + .1, y + .1, .3, .3, 12, '#3a2a40', '#2a1e30', '#322438');
    const p = isoPt(x + .25, y + .25, 12); el(p.x, p.y - 5, 5, 5, '#e8e4dc', INK); P(p.x - 3, p.y - 6, 2, 2, INK); P(p.x + 1, p.y - 6, 2, 2, INK); P(p.x - 2, p.y - 1, 4, 2, '#e8e4dc'); return 24; } },
  coffin:  { name:'棺材汽水雪櫃', p:1200, w:1, d:.5, chip:'#3a2414', star:3, draw(x: number, y: number, now: number): number {
    isoBox(x + .05, y + .05, .9, .4, 30, '#5a3a20', '#3a2414', '#4a3020');
    const a = isoPt(x + .5, y + .45, 22); P(a.x - 6, a.y - 2, 12, 5, '#7be08f'); P(a.x - 5, a.y - 1, 10, 3, '#2a8b67'); ([[.25, 12], [.75, 12]] satisfies [number, number][]).forEach(([u, z]) => { const h = isoPt(x + u, y + .45, z); P(h.x - 2, h.y, 4, 2, '#e9b23a'); });   // 汽水窗同銅手柄（唔畫宗教符號）
    if (Math.floor(now / 2500) % 5===0){ const b = isoPt(x + .2, y + .45, 30); P(b.x, b.y - 4, 3, 3, '#7be08f'); } return 34; } },
} satisfies Record<string, SetItem>);
Object.assign(ITEMS, SET_ITEMS);
export const SETS_DECOR: Record<string, DecorSet> = {
  bing:   { name:'懷舊冰室',     items:['cake', 'cans', 'fan', 'crate', 'clock'], fx:'客人耐性 +10%（吊扇夠涼，等耐啲都唔嬲）', lantern:'#ffd25a' },
  corner: { name:'轉角雙層餐室', items:['grille', 'lamp', 'marble', 'register', 'hatstand'], fx:'連擊貼士 +15%（有格調，客人畀多啲）', lantern:'#7be08f' },
  fast:   { name:'七十年代快餐店', items:['neonbox', 'tray', 'jukebox', 'chairs'], fx:'客流 +10%（霓虹燈箱吸人入嚟）', lantern:'#ff5ab4' },
  estate: { name:'屋邨茶記',     items:['tv', 'news', 'plant', 'shrine', 'fridge'], fx:'每更收工街坊打賞 +$150', lantern:'#9fd3ff' },
  dpd:    { name:'大牌檔',       items:['kerosene', 'stools', 'urn', 'crate'], fx:'茶壺多裝 4 杯（大茶壺夠大）', lantern:'#ff8a3a' },
  spooky: { name:'萬聖限定',     items:['pumpkin', 'cobweb', 'candles', 'skull', 'coffin'], fx:'萬聖夜：自己間舖都會撞鬼，有客食完唔見咗、留低雙倍錢', lantern:'#e8701a', limited:'halloween' },
};
// 限定擺設：關卡攞夠星先買得
export const itemLocked = (k: string): boolean => { const it = must(ITEMS[k], 'item ' + k); if (!it.star) return false; return ((must(SHOP.levels, 'SHOP.levels').halloween ?? 0)|0) < it.star; };
// 某套有冇效（關卡用固定間舖，唔計）
export const setOn = (k: string): boolean => !(typeof fixedShop!=='undefined' && fixedShop) && setOwned(k).length===must(SETS_DECOR[k], 'set ' + k).items.length;
// 地點加成（只計我的茶餐廳）
export const placeFx = (): PlaceFx => (typeof fixedShop!=='undefined' && fixedShop) ? {} : (PLACES[SHOP.place] || {});
export const setPat = (): number => (setOn('bing') ? 1.1 : 1) * (placeFx().pat || 1);
export const setTip = (): number => (setOn('corner') ? 1.15 : 1) * (placeFx().tip || 1);
export const potCap = (): number => CFG.potCap + (setOn('dpd') ? 4 : 0);
export const SET_BONUS = 150;
export const setOwned = (k: string, items?: ShopItem[]): string[] => must(SETS_DECOR[k], 'set ' + k).items.filter(t => (items || SHOP.items).some(q => q.type===t));
export const setsDone = (): string[] => Object.keys(SETS_DECOR).filter(k => !must(SETS_DECOR[k], 'set ' + k).limited && setOwned(k).length===must(SETS_DECOR[k], 'set ' + k).items.length);
// 客流加成（rules.js spawnGap 用）：快餐店套裝客流 +10%
export const setBoost = (): number => (setOn('fast') ? 1 / 1.1 : 1) / (placeFx().flow || 1) / (typeof gradeFlow==='function' ? gradeFlow() : 1);
// 買完嘢檢查：新齊一套就恭喜
export function checkSets(): void {
  SHOP.setsSeen = SHOP.setsSeen || [];
  setsDone().forEach(k => { if (!must(SHOP.setsSeen, 'SHOP.setsSeen').includes(k)){ must(SHOP.setsSeen, 'SHOP.setsSeen').push(k); saveShop(); const s = must(SETS_DECOR[k], 'set ' + k); toast(`買齊「${s.name}」套裝！${s.fx}，門面多咗一盞燈籠`); if (typeof sfx!=='undefined' && typeof sfx.fanfare==='function') sfx.fanfare(); } });
}
export function setsTabHtml(): string {
  return Object.entries(SETS_DECOR).map(([k, s]) => {
    const own = setOwned(k), done = own.length===s.items.length;
    return `<p class="dh">${s.name}套裝 ${own.length}/${s.items.length}${done ? ' ✓ 已齊' : ''}</p>
      <div class="dchips">${s.items.map(t => { const it = must(ITEMS[t], 'item ' + t); return chip(`data-bi="${t}"`, it.chip, it.name, own.includes(t) ? '有 · 再買' : `$${it.p}`, own.includes(t) ? 'on' : ''); }).join('')}</div>`;
  }).join('') + '<p class="dhint">每齊一套，客人嚟得密少少（自己間舖先有）。全部原創設計，唔係抄邊間舖。</p>';
}

/* ===================== 裝修預覽細圖 ===================== */
// 每樣嘢畫一張細圖（56×64），代替以前嘅色塊；畫一次就記住
export const PV_W = 56, PV_H = 64, pvCache: Record<string, string> = {};
export function pvCanvas(fn: (ctx: CanvasRenderingContext2D) => void): string {
  const cv = document.createElement('canvas'); cv.width = PV_W; cv.height = PV_H;
  const ctx = cv.getContext('2d'), keepPX = PX, keepO = isoO, keepWall = ISO.WALL;
  setPX(ctx); const c2 = must(ctx, 'canvas 2d context'); c2.imageSmoothingEnabled = false;
  try { fn(c2); } finally { setPX(keepPX); setIsoO(keepO); ISO.WALL = keepWall; }
  return cv.toDataURL();
}
export function itemPreview(type: string): string {
  const it = ITEMS[type];
  return pvCanvas(() => {
    const t = must(it, 'item ' + type);
    P(0, 0, PV_W, PV_H, '#e6ecef');
    ISO.WALL = 46;   // 吊扇、吊燈畫低啲先擺得落
    setIsoO({ x: Math.round(PV_W / 2 - (t.w - t.d) * 8), y: Math.round(PV_H - 12 - (t.w + t.d) * 4) });
    poly([isoPt(-.1, -.1), isoPt(t.w + .1, -.1), isoPt(t.w + .1, t.d + .1), isoPt(-.1, t.d + .1)], '#c9d1d6');
    const keepItems = SHOP.items, keepMode = decorMode;
    SHOP.items = [{ type, tx:0, ty:0 }]; setDecorMode(false);
    try { drawItem(0, 0, 1); } finally { SHOP.items = keepItems; setDecorMode(keepMode); }
  });
}
export function tablePreview(kind: string): string {
  return pvCanvas(() => {
    P(0, 0, PV_W, PV_H, '#e6ecef'); const w = must(TKINDS[kind], 'table kind ' + kind).w, booth = kind==='booth';
    setIsoO({ x: PV_W / 2 + (w - 1) * 8, y: PV_H - 16 - (1 + w) * 4 });
    const bc: [string, string, string] = booth ? ['#c84e44', '#8e2e27', '#a5372f'] : ['#a77c4c', '#6a4a2a', '#835f3c'];
    if (kind==='round'){ const c = isoPt(.5, 1, 0); ([[-.35, .5], [-.35, 1.5], [1.35, .5], [1.35, 1.5]] satisfies [number, number][]).forEach(([dx, dy]) => { const p = isoPt(dx, dy, 0); P(p.x - 1, p.y - 7, 2, 7, '#6f7b85'); el(p.x, p.y - 8, 4, 2, '#c9d1d6', INK); });
      el(c.x, c.y - 1, 6, 3, '#5d6870', INK); P(c.x - 1, c.y - 15, 3, 14, '#8d9aa2'); el(c.x, c.y - 15, 22, 12, '#b8ad90', INK); el(c.x, c.y - 17, 22, 12, '#f4ecd4', INK); return; }
    if (booth) isoBox(-.6, 0, .18, w, 20, ...bc);
    isoBox(-.6, 0, .55, w, booth ? 9 : 7, ...bc);
    isoBox(.1, .1, .8, w - .2, 12, '#9aa6ad', '#6f7b85', '#56616b');
    isoBox(0, 0, 1, w, 3, '#f3e5b2', '#cdb877', '#bfa865', 12);
    if (booth) isoBox(1.05, 0, .55, w, 9, ...bc);
  });
}
export function lookPreview(kind: string, k: string): string {
  // The JS read LOOKS[kind][k] here, which throws only for an unknown kind; each branch reads its own table below.
  if (!(kind in LOOKS)) throw new TypeError('chakei: unknown look kind ' + kind);
  return pvCanvas(ctx => {
    if (kind==='wall'){ const d = must(LOOKS.wall[k], 'wall ' + k); P(0, 0, PV_W, PV_H, d.r);
      if (d.tile) for (let y = 2; y < PV_H; y += 9) for (let x = 1; x < PV_W; x += 8) P(x, y, 7, 8, (x + y) % 5 ? d.r1 : d.r2);
      else if (d.stripe) for (let x = 0; x < PV_W; x += 3) P(x, 0, 2, PV_H, (x / 3) % 2 ? d.r1 : d.r2);
      else if (d.plain){ P(0, 0, PV_W, PV_H, d.r1); P(10, 20, 8, 2, d.r2); P(34, 40, 6, 2, d.r2); }
      else for (let y = 1; y < PV_H; y += 4) for (let x = (y % 8 ? 0 : 2); x < PV_W; x += 4) P(x, y, 3, 3, (x * 3 + y) % 7 ? d.r1 : d.r2);
      P(0, PV_H - 6, PV_W, 6, '#7a5a3a');
    } else if (kind==='floor'){ const d = must(LOOKS.floor[k], 'floor ' + k);
      const s = d.fine ? 4 : 8; for (let y = 0; y < PV_H; y += s) for (let x = 0; x < PV_W; x += s) P(x, y, s, s, ((x + y) / s) % 2 ? d.a : d.b);
      if (d.dot) for (let y = s / 2; y < PV_H; y += s) for (let x = s / 2; x < PV_W; x += s) P(x, y, 1, 1, d.a);
    } else if (kind==='sign'){ const d = must(LOOKS.sign[k], 'sign ' + k);
      P(0, 0, PV_W, PV_H, '#2b3a33'); P(17, 4, 22, 56, INK); P(18, 5, 20, 54, d.bg);
      ctx.font = '900 16px "Noto Serif HK", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (d.neon){ ctx.shadowColor = d.fg; ctx.shadowBlur = 6; }
      ctx.fillStyle = d.fg; ctx.fillText('茶', 28, 20); ctx.fillText('記', 28, 42); ctx.shadowBlur = 0;
    } else if (kind==='awning'){ const d = must(LOOKS.awning[k], 'awning ' + k);
      P(0, 0, PV_W, PV_H, '#efece4'); P(0, 44, PV_W, 20, '#c9c2b0');
      if (!d.a){ P(8, 18, 40, 2, '#9aa6ad'); return; }
      // String(): fillStyle stringifies what it is given, so this is the colour the JS set (every striped awning has b).
      for (let x = 0; x < PV_W; x += 8){ P(x, 10, 8, 18, (x / 8) % 2 ? d.a : String(d.b)); P(x, 28, 8, 5, (x / 8) % 2 ? String(d.b) : d.a); }
    } else if (kind==='place'){
      if (k==='pl-town'){ P(0, 0, PV_W, PV_H, '#9fd3ff'); P(0, 30, PV_W, 34, '#c9c2b0'); P(0, 46, PV_W, 18, '#4b555d'); for (let x = 2; x < PV_W; x += 12) P(x, 54, 6, 2, '#ffd25a'); return; }
      drawBackdrop(k, 0, PV_W, PV_H);
    }
  });
}
export const pvURL = (key: string, fn: () => string): string => pvCache[key] || (pvCache[key] = fn());
