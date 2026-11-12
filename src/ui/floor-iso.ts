// 伙記樓面：立體（等角）像素畫同簡易版
// TypeScript port of the original game's floor-iso.js, as an ES module: every
// top-level name is exported. Colours picked from a palette by index are String()ed
// where they reach a canvas fillStyle: the setter turns undefined into the string 'undefined' anyway (an ignored
// colour).
import './floor-map';   // load order: src/entry.ts
import { drawMap, mapShop, mapBind, mapDown, mapNow, mapToScreen } from './floor-map';
import { HOOK } from './hooks';
import { must } from '../core/util';
import { $ } from './prefs';
import { G, bump, byId, atTable, liveG } from '../core/state';
import { seatProblem } from '../core/referee/customers';
import { HAT_OK, SLOTS, CFG, LUNCH_R } from '../core/data/menus';
import { INK, P, el } from './kitchen';
import { makeScene, PX, beginScene, lookOf, setPX } from './pixel';
import { decorMode, WALLS, decorLook, FLOORS, fixedShop, decorSel, decorCanAt, itemDepth, SHOP, drawItem, PLACES, AWNINGS, SIGNS, decorTap } from './decor';
import { setsDone, SETS_DECOR } from './sets';
import { menuOpen } from './menu';
import { LEVELS } from './levels';
import { fig } from './smoke';
import { dress, WAITER_STAND } from './outfit';
import { shopName } from './main';

/* ===================== 伙記：立體（等角）像素茶記（高像素版） ===================== */
export const FSC = makeScene('fscene');
// 樓面兩種睇法：立體（將來裝修用）同簡易（卡片，易撳）
export let floorView = 'iso';
try { const v = localStorage.getItem('ckf-view'); if (v==='iso' || v==='simple') floorView = v; } catch { /* storage blocked: keep the default */ }
export function applyView(): void {
  must($('floor'), 'floor').classList.toggle('sr-only', floorView==='iso');
  must($('fscene'), 'fscene').hidden = floorView!=='iso';
  must($('viewBtn'), 'viewBtn').textContent = floorView==='iso' ? '轉簡易版' : '轉立體版';
  syncMapQueue();
  if (G) bump();
}
/** On the shop map the waiting parties are tapped where they queue outside, so the door's list under the floor goes and
 *  the map takes its height; the simple view, themed shops and the own shop keep the list. */
export function syncMapQueue(): void {
  document.body.classList.toggle('mapq', !!G && !decorMode && floorView==='iso' && mapShop());
}
must($('viewBtn'), 'viewBtn').onclick = () => { floorView = floorView==='iso' ? 'simple' : 'iso'; try { localStorage.setItem('ckf-view', floorView); } catch { /* storage blocked */ } applyView(); };
applyView();
export const ISO: IsoGrid = { TW:32, TH:16, GX:9, GY:9, WALL:84 };
// 六張枱喺地磚上面嘅位置：枱面喺 gx [tx, tx+1)、gy [ty, ty+w)；兩邊櫈喺 gx 方向
export let TPOS: TablePos[] = [ { tx:1, ty:.5, w:2 }, { tx:4.5, ty:.5, w:2 }, { tx:1, ty:3.5, w:2 }, { tx:4.5, ty:3.5, w:2 }, { tx:1, ty:6.5, w:1 }, { tx:4.5, ty:6.5, w:1 } ];
export function setTPOS(v: typeof TPOS): void { TPOS = v; }
export let isoO: IsoPt = { x:0, y:0 }, isoAnchors: (IsoAnchor | undefined)[] = [];
export function setIsoO(v: typeof isoO): void { isoO = v; }
// isoFlip：畫轉咗方向嘅擺設時，將佢嘅本地座標沿對角線反轉（面向另一幅牆）
export let isoFlip: IsoPt | null = null;
export function setIsoFlip(v: typeof isoFlip): void { isoFlip = v; }
export const isoPt = (gx: number, gy: number, z = 0): IsoPt => {
  if (isoFlip){ const lx = gx - isoFlip.x, ly = gy - isoFlip.y; gx = isoFlip.x + ly; gy = isoFlip.y + lx; }
  return { x: isoO.x + (gx - gy) * ISO.TW / 2, y: isoO.y + (gx + gy) * ISO.TH / 2 - z };
};
// 凸多邊形用逐行填色，保持像素邊
export function poly(pts: readonly IsoPt[], col: string): void {
  must(PX, 'PX').fillStyle = col;
  const ys = pts.map(p => p.y), y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
  for (let y = y0; y < y1; y++){
    const yc = y + .5; let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pts.length; i++){
      const a = must(pts[i], 'point'), b = must(pts[(i + 1) % pts.length], 'point');
      if ((yc >= a.y && yc < b.y) || (yc >= b.y && yc < a.y)){ const x = a.x + (yc - a.y) * (b.x - a.x) / (b.y - a.y); lo = Math.min(lo, x); hi = Math.max(hi, x); }
    }
    if (lo < hi) must(PX, 'PX').fillRect(Math.round(lo), y, Math.round(hi) - Math.round(lo), 1);
  }
}
// 一粒粒像素畫直線（描邊用）
export function line(a: IsoPt, b: IsoPt, col: string): void {
  must(PX, 'PX').fillStyle = col;
  let x0 = Math.round(a.x), y0 = Math.round(a.y); const x1 = Math.round(b.x), y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
  for (let n = 0; n < 2000; n++){ must(PX, 'PX').fillRect(x0, y0, 1, 1); if (x0===x1 && y0===y1) break; const e2 = 2 * err; if (e2 >= dy){ err += dy; x0 += sx; } if (e2 <= dx){ err += dx; y0 += sy; } }
}
// 一舊立體方塊：佔 [gx,gx+w) × [gy,gy+d)，高 h，離地 z；有描邊同頂面高光
// edge = null: the JS passed it to fillStyle as is, which reads it as the (ignored) colour 'null', so String() it.
export function isoBox(gx: number, gy: number, w: number, d: number, h: number, top: string, left: string, right: string, z = 0, edge: string | null = INK): void {
  // 轉咗方向：先將個盒換返做世界座標，咁前後面先畫得啱
  if (isoFlip){ const f = isoFlip; isoFlip = null; try { isoBox(f.x + (gy - f.y), f.y + (gx - f.x), d, w, h, top, left, right, z, edge); } finally { isoFlip = f; } return; }
  const a = isoPt(gx, gy, z + h), b = isoPt(gx + w, gy, z + h), c = isoPt(gx + w, gy + d, z + h), e = isoPt(gx, gy + d, z + h);
  const c0 = isoPt(gx + w, gy + d, z), e0 = isoPt(gx, gy + d, z), b0 = isoPt(gx + w, gy, z);
  poly([e, c, c0, e0], left); poly([c, b, b0, c0], right); poly([a, b, c, e], top);
  line(a, b, String(edge)); line(b, c, 'rgba(255,255,255,.55)'); line(c, e, 'rgba(255,255,255,.35)'); line(e, a, String(edge));
  line(b, b0, String(edge)); line(b0, c0, String(edge)); line(c0, e0, String(edge)); line(e0, e, String(edge)); line(c, c0, 'rgba(0,0,0,.25)');
}
// 坐低嘅客（12×22 格），back = 背住我哋
export function seatedPerson(p: IsoPt, col: string, back: boolean, look?: Look): void {
  const x = Math.round(p.x) - 6, y = Math.round(p.y) - 24, lk = look || {}, hair = lk.hair || '#2b2b2b';
  // 身（學生：白恤衫，底部留返組別顏色方便認人）
  P(x, y + 11, 12, 12, INK); P(x + 1, y + 12, 10, 10, lk.uniform ? '#f4f1e8' : col);
  if (lk.uniform) P(x + 1, y + 20, 10, 2, col);
  P(x + 1, y + 12, 10, 2, 'rgba(255,255,255,.25)'); P(x + 8, y + 14, 3, 8, 'rgba(0,0,0,.18)');
  if (!back){ P(x + 5, y + 12, 2, 3, '#ffffff'); if (lk.uniform) P(x + 5, y + 13, 2, 8, '#2a3f7a'); }
  // 頭
  P(x + 2, y, 8, 12, INK);
  if (back){ P(x + 3, y + 1, 6, 10, hair); P(x + 4, y + 2, 2, 2, lk.hair ? '#ffffff' : '#4a4a4a'); if (lk.long) P(x + 3, y + 9, 6, 5, hair); }
  else {
    P(x + 3, y + 3, 6, 8, '#f0c8a0'); P(x + 3, y + 1, 6, 3, hair); P(x + 3, y + 3, 1, 3, hair);
    if (lk.long){ P(x + 3, y + 3, 1, 8, hair); P(x + 8, y + 3, 1, 8, hair); }
    if (lk.perm){ P(x + 2, y + 2, 1, 4, hair); P(x + 9, y + 2, 1, 4, hair); }
    P(x + 4, y + 6, 1, 2, INK); P(x + 7, y + 6, 1, 2, INK); P(x + 5, y + 9, 2, 1, '#c07060'); P(x + 8, y + 8, 1, 1, '#f3a0a0');
  }
  if (lk.hat){ P(x + 2, y, 8, 3, lk.hat); P(x + 1, y + 3, 10, 1, lk.hat); P(x + 3, y + 1, 2, 1, 'rgba(255,255,255,.5)'); }
}
export function drawFloorIso(now: number): void {
  syncMapQueue();
  if (!G || !(decorMode || (G.station==='waiter' && floorView==='iso'))) return;
  // the shop map: the main ladder's shops draw the hall-plus-rooms map; the rest keep this floor
  if (!decorMode && mapShop()){ drawMapFloor(now); return; }
  if (mapDrawn){ mapDrawn = false; FSC.tv.style.touchAction = ''; FSC.x?.setTransform(1, 0, 0, 1, 0, 0); FSC.key = ''; }
  // WT0 / FT0 are checked (must) right where the JS first read them; String(): a missing look indexes 'undefined'.
  const WT0 = WALLS[String(decorLook('wall'))], FT0 = FLOORS[String(decorLook('floor'))];
  const ST = STREET_W, sc = FSC, roomW = (ISO.GX + ST + ISO.GY) * ISO.TW / 2, roomH = (ISO.GX + ST + ISO.GY) * ISO.TH / 2 + ISO.WALL + 16;
  // 枱可以搬去任何位，所以成個舖面都要見到
  const S = Math.max(1, Math.min(4, Math.min(sc.W / (roomW + 8), sc.H / roomH)));
  beginScene(sc, S); const LW = sc.LW, LH = sc.LH, t = must(sc.t, 'floor text context');
  isoO = { x: Math.round(LW / 2 + (ISO.GY - ISO.GX - ST) * ISO.TW / 4), y: Math.round((LH - roomH) / 2 + ISO.WALL + 8) };
  P(0, 0, LW, LH, '#1b2a24');
  drawBackdrop(decorLook('place'), now, LW, isoO.y - ISO.WALL + 30);
  drawGround(decorLook('place'), now);
  // 兩面牆（茶記綠色紙皮石）
  const W = ISO.WALL, o = isoPt(0, 0), gxE = isoPt(ISO.GX, 0), gyE = isoPt(0, ISO.GY);
  const WT = must(WT0, 'wall look');
  poly([{ x:o.x, y:o.y - W }, { x:gxE.x, y:gxE.y - W }, gxE, o], WT.r);
  poly([{ x:gyE.x, y:gyE.y - W }, { x:o.x, y:o.y - W }, o, gyE], WT.l);
  if (WT.tile){
    // 大塊瓷片：每塊 1/4 格闊、9 格高，留灰線
    for (let k = 0; k < ISO.GX * 4; k++) for (let r = 4; r < W - 12; r += 9){ const p = isoPt(k / 4, 0); for (let i = 0; i < 7; i++) P(p.x + 1 + i, p.y - W + r + Math.floor(i / 2), 1, 7, (k + r) % 5 ? WT.r1 : WT.r2); }
    for (let k = 0; k < ISO.GY * 4; k++) for (let r = 4; r < W - 12; r += 9){ const p = isoPt(0, k / 4); for (let i = 0; i < 7; i++) P(p.x - 8 + i, p.y - W + r + 3 - Math.floor(i / 2), 1, 7, (k * 3 + r) % 5 ? WT.l1 : WT.l2); }
  } else if (WT.dado){
    // 上半黃牆，下半灰藍紙皮石（樓下冰室）
    const D = 30;   // (the JS also defined an unused, side-effect-free helper `mo` here; dropped as dead code)
    for (let k = 0; k < ISO.GX * 8; k++) for (let r = 0; r < D; r += 3){ const p = isoPt(k / 8, 0); P(p.x + 1, p.y - r - 3, 3, 2, (k + r) % 5 ? '#8a9aaa' : '#7a8a9a'); }
    for (let k = 0; k < ISO.GY * 8; k++) for (let r = 0; r < D; r += 3){ const p = isoPt(0, k / 8); P(p.x - 4, p.y - r - 3, 3, 2, (k * 3 + r) % 5 ? '#7e8e9e' : '#6e7e8e'); }
    const a0 = isoPt(0, 0), a1 = isoPt(ISO.GX, 0), b1 = isoPt(0, ISO.GY); line({ x:a0.x, y:a0.y - D }, { x:a1.x, y:a1.y - D }, '#5a6a7a'); line({ x:a0.x, y:a0.y - D }, { x:b1.x, y:b1.y - D }, '#5a6a7a');
  } else if (WT.plain){
    // 白灰水：淨色，有啲污漬同電線
    for (let k = 0; k < 18; k++){ const p = isoPt(hsh(k) * ISO.GX, 0), r = 10 + hsh(k + 40) * (W - 30); P(p.x, p.y - W + r, 3 + hsh(k + 3) * 6, 2, WT.r2); }
    for (let k = 0; k < 10; k++){ const p = isoPt(0, hsh(k + 70) * ISO.GY), r = 10 + hsh(k + 90) * (W - 30); P(p.x - 6, p.y - W + r, 3 + hsh(k + 7) * 5, 2, WT.l2); }
    const w1 = isoPt(0, 0), w2 = isoPt(ISO.GX, 0); line({ x:w1.x, y:w1.y - W + 8 }, { x:w2.x, y:w2.y - W + 8 }, '#9aa6ad');
  } else if (WT.stripe){
    // 鐵皮：一條條直坑
    for (let k = 0; k < ISO.GX * 6; k++){ const p = isoPt(k / 6, 0); for (let i = 0; i < 2; i++) P(p.x + 1 + i, p.y - W + 4 + Math.floor(i / 2), 1, W - 10, k % 2 ? WT.r1 : WT.r2); }
    for (let k = 0; k < ISO.GY * 6; k++){ const p = isoPt(0, k / 6); for (let i = 0; i < 2; i++) P(p.x - 3 + i, p.y - W + 4, 1, W - 10, k % 2 ? WT.l1 : WT.l2); }
  } else {
    for (let k = 0; k < ISO.GX * 8; k++) for (let r = 4; r < W - 10; r += 5){ const p = isoPt(k / 8, 0); P(p.x + 1, p.y - W + r + (k % 2), 3, 3, (k * 3 + r) % 7 ? WT.r1 : WT.r2); }
    for (let k = 0; k < ISO.GY * 8; k++) for (let r = 4; r < W - 10; r += 5){ const p = isoPt(0, k / 8); P(p.x - 4, p.y - W + r + (k % 2), 3, 3, (k * 5 + r) % 7 ? WT.l1 : WT.l2); }
  }
  line({ x:o.x, y:o.y - W }, o, INK); line({ x:o.x, y:o.y - W }, { x:gxE.x, y:gxE.y - W }, INK); line({ x:o.x, y:o.y - W }, { x:gyE.x, y:gyE.y - W }, INK);
  // 牆腳木條
  poly([{ x:o.x, y:o.y - 6 }, { x:gxE.x, y:gxE.y - 6 }, gxE, o], '#7a5a3a');
  poly([{ x:gyE.x, y:gyE.y - 6 }, { x:o.x, y:o.y - 6 }, o, gyE], '#6a4a2a');
  if (fixedShop && fixedShop.walled) drawWalledWalls(W, now);
  else if (fixedShop && fixedShop.bing) drawBingWalls(W);
  else if (fixedShop && fixedShop.dairy){ const ck = isoPt(0, 2.0); P(ck.x - 9, ck.y - 62, 13, 13, INK); P(ck.x - 8, ck.y - 61, 11, 11, '#fbfaf4'); P(ck.x - 3, ck.y - 59, 1, 5, INK); P(ck.x - 3, ck.y - 55, 4, 1, INK); }
  else {
  // 牆上：紅色餐牌、鐘、出餐窗口、招牌
  const m1 = isoPt(1.0, 0), m2 = isoPt(3.4, 0), w3 = isoPt(0, 4.2);
  poly([{ x:m1.x, y:m1.y - 60 }, { x:m1.x + 32, y:m1.y - 44 }, { x:m1.x + 32, y:m1.y - 22 }, { x:m1.x, y:m1.y - 38 }], INK);
  poly([{ x:m1.x + 1, y:m1.y - 58 }, { x:m1.x + 31, y:m1.y - 43 }, { x:m1.x + 31, y:m1.y - 24 }, { x:m1.x + 1, y:m1.y - 39 }], '#a5372f');
  for (let k = 0; k < 4; k++) line({ x:m1.x + 5, y:m1.y - 52 + k * 5 }, { x:m1.x + 25, y:m1.y - 42 + k * 5 }, '#fbf6e2');
  poly([{ x:m2.x, y:m2.y - 64 }, { x:m2.x + 40, y:m2.y - 44 }, { x:m2.x + 40, y:m2.y - 16 }, { x:m2.x, y:m2.y - 36 }], INK);
  poly([{ x:m2.x + 2, y:m2.y - 61 }, { x:m2.x + 38, y:m2.y - 43 }, { x:m2.x + 38, y:m2.y - 19 }, { x:m2.x + 2, y:m2.y - 37 }], '#ffe9a8');
  poly([{ x:m2.x + 2, y:m2.y - 37 }, { x:m2.x + 38, y:m2.y - 19 }, { x:m2.x + 38, y:m2.y - 15 }, { x:m2.x + 2, y:m2.y - 33 }], '#b7c1c8');
  const ck = isoPt(0, 2.0); P(ck.x - 9, ck.y - 62, 13, 13, INK); P(ck.x - 8, ck.y - 61, 11, 11, '#fbfaf4'); P(ck.x - 3, ck.y - 59, 1, 5, INK); P(ck.x - 3, ck.y - 55, 4, 1, INK);
  poly([{ x:w3.x - 42, y:w3.y - 34 }, { x:w3.x, y:w3.y - 55 }, { x:w3.x, y:w3.y - 35 }, { x:w3.x - 42, y:w3.y - 14 }], INK);
  poly([{ x:w3.x - 40, y:w3.y - 33 }, { x:w3.x - 2, y:w3.y - 52 }, { x:w3.x - 2, y:w3.y - 37 }, { x:w3.x - 40, y:w3.y - 17 }], '#7a1f1f');
  }
  dairySign = fixedShop && fixedShop.dairy ? drawDairyWall(W) : null;
  if (fixedShop && fixedShop.lanfong) drawLanfongWall(W);
  // 地磚：細細格嘅紙皮石
  const FT = must(FT0, 'floor look');
  for (let gx = 0; gx < ISO.GX; gx++) for (let gy = 0; gy < ISO.GY; gy++){
    const a = isoPt(gx, gy), b = isoPt(gx + 1, gy), c = isoPt(gx + 1, gy + 1), d = isoPt(gx, gy + 1);
    if (FT.fine){
      // 細細塊階磚：一格分四細格，啡白相間
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++){ const u = gx + i / 2, v = gy + j / 2;
        poly([isoPt(u, v), isoPt(u + .5, v), isoPt(u + .5, v + .5), isoPt(u, v + .5)], (i + j + gx + gy) % 2 ? FT.a : FT.b); }
    } else poly([a, b, c, d], (gx + gy) % 2 ? FT.a : FT.b);
    if (FT.dot){ const m = isoPt(gx + .5, gy + .5); P(m.x - 1, m.y, 2, 1, (gx + gy) % 2 ? FT.b : FT.a); }
    if (decorMode && decorSel && decorCanAt(gx + .5, gy + .5)) poly([a, b, c, d], 'rgba(123,224,143,.45)');
  }
  drawStreet();
  // 門口（前面右邊）
  const dr = doorRange(), d0 = isoPt(ISO.GX, dr[0]), d1 = isoPt(ISO.GX, dr[1]);
  // 門口地氈（兩格闊）
  poly([isoPt(ISO.GX - .5, dr[0] + .1), isoPt(ISO.GX, dr[0] + .1), isoPt(ISO.GX, dr[1] - .1), isoPt(ISO.GX - .5, dr[1] - .1)], '#a5272f');
  poly([d0, d1, { x:d1.x + 2, y:d1.y + 4 }, { x:d0.x + 2, y:d0.y + 4 }], '#8d9aa2');
  if (fixedShop && fixedShop.loft) drawLoft(fixedShop.loft);
  // 揀咗客：可以坐嘅枱地下著綠色
  const sel = G.selected && byId(G.selected);
  isoAnchors = [];
  // 枱同擺設按前後次序畫（後面嘅先畫）
  const depth = (id: string | number): number => { if (typeof id==='string') return itemDepth(+id.slice(1)); const tp = TPOS[id]; return tp ? tp.tx + .5 + tp.ty + tp.w / 2 : 0; };
  const order = [...G.tables.map(tb => tb.id), ...(fixedShop ? [] : SHOP.items.map((_, i) => 'i' + String(i)))].sort((a, b) => depth(a) - depth(b));
  for (const id of order){
    if (typeof id!=='string' && !TPOS[id]) continue;   // 關卡完咗、間舖已經換返
    if (typeof id==='string'){ drawItem(+id.slice(1), now, S); continue; }
    const tb = must(G.tables[id], 'table ' + String(id)), pos = must(TPOS[id], 'table pos ' + String(id)), gs = atTable(id), booth = tb.kind==='booth', w = pos.w;
    const isoKeep = isoO; if (pos.z) isoO = { x: isoO.x, y: isoO.y - pos.z };   // 閣樓枱：成張枱連客升高
    const mat = [isoPt(pos.tx - .75, pos.ty - .15), isoPt(pos.tx + 1.75, pos.ty - .15), isoPt(pos.tx + 1.75, pos.ty + w + .15), isoPt(pos.tx - .75, pos.ty + w + .15)];
    let ok = false;
    if (sel) ok = ['', 'dirty'].includes(seatProblem(sel, tb));
    const picked = decorMode && decorSel && decorSel.t==='table' && decorSel.i===id;
    poly(mat, picked ? (Math.floor(now / 300) % 2 ? '#ffd25a' : '#e9b23a') : ok ? (Math.floor(now / 300) % 2 ? '#7be08f' : '#5cc97a') : 'rgba(15,26,22,.16)');
    const hw = fixedShop && fixedShop.hangwan;   // 行運：橙色卡位、淺藍枱
    const fold = !booth && fixedShop && fixedShop.fold;   // 冰室摺櫈：綠色鐵；大牌檔：紅膠櫈
    const wood = booth && fixedShop && fixedShop.bing;   // 冰室木卡位
    const silver = fixedShop && fixedShop.silver, walled = fixedShop && fixedShop.walled, rnd = tb.kind==='round', lf = rnd && fixedShop && fixedShop.lanfong, round = rnd || ((silver || walled) && !booth);   // 樓下冰室：淺木卡位、白色圓枱
    const bc: [string, string, string] = hw && booth ? ['#f0882a', '#c8661a', '#dc7420'] : silver && booth ? ['#d8b888', '#a88858', '#c0a070'] : wood ? ['#7a5232', '#4a3020', '#5e3e26'] : booth ? ['#c84e44', '#8e2e27', '#a5372f'] : fold==='red' ? ['#e0483c', '#a82c22', '#c23a2f'] : fold ? ['#6f9a86', '#3f5e50', '#557a69'] : ['#a77c4c', '#6a4a2a', '#835f3c'], bh = booth ? 9 : 7;
    if (booth) isoBox(pos.tx - .6, pos.ty, .18, w, 20, ...bc);
    if (round){ const sp: [number, number][] = []; for (let k = 0; k < w; k++) sp.push([-.35, k + .5], [1.35, k + .5]);   // 圓枱四圍摺櫈
      sp.forEach(([dx, dy]) => { const p = isoPt(pos.tx + dx, pos.ty + dy, 0); P(p.x - 1, p.y - 7, 2, 7, lf ? '#7a4e2a' : rnd ? '#6f7b85' : '#8a6a4a'); el(p.x, p.y - 8, 4, 2, walled ? '#e0483c' : lf ? '#d8a868' : rnd ? '#c9d1d6' : '#d8b070', INK); }); }
    else isoBox(pos.tx - .6, pos.ty, .55, w, bh, ...bc);
    const seats: { gx: number; gy: number; back: boolean }[] = [];
    for (let k = 0; k < w; k++) seats.push({ gx: pos.tx - .32, gy: pos.ty + k + .5, back:false });
    for (let k = 0; k < w; k++) seats.push({ gx: pos.tx + 1.32, gy: pos.ty + k + .5, back:true });
    const fill: ({ kind: 'p'; g: Group } | { kind: 'dirty' })[] = [];
    gs.forEach(g => { for (let n = 0; n < g.size; n++) fill.push({ kind:'p', g }); });
    for (let n = 0; n < tb.dirty; n++) fill.push({ kind:'dirty' });
    const heads: Record<number, IsoHead> = {};
    seats.forEach((s, k) => { const f = fill[k]; if (f && f.kind==='p'){ const hp = isoPt(s.gx, s.gy, bh); if (!heads[f.g.id]) heads[f.g.id] = { x: hp.x, y: hp.y - 24, g: f.g }; if (!s.back) seatedPerson(hp, f.g.color, false, lookOf(f.g.label)); } });
    // 枱：膠板面加鐵腳
    if (round){
      // 圓枱：地下一個圓腳、一條鐵柱、厚身枱邊，枱面有反光，一睇就知係圓
      const c = isoPt(pos.tx + .5, pos.ty + w / 2, 0), top: [string, string, string] = walled || lf ? ['#6a3a1e', '#b0703a', '#d8985a'] : rnd ? ['#b8ad90', '#f4ecd4', '#ffffff'] : ['#9aa6ad', '#f6f4ee', '#ffffff'], R = w > 1 ? 1.45 : 1;
      el(c.x, c.y - 1, 6, 3, '#5d6870', INK); P(c.x - 1, c.y - 15, 3, 14, '#8d9aa2');
      el(c.x, c.y - 15, Math.round(15 * R), Math.round(8 * R), top[0], INK); el(c.x, c.y - 17, Math.round(15 * R), Math.round(8 * R), top[1], INK);
      for (let k = -9; k <= -2; k++) P(c.x + Math.round(k * R), c.y - 17 - Math.round(4 * R) + Math.round((k + 9) * .3), 2, 1, top[2]);
    }
    else isoBox(pos.tx + .1, pos.ty + .1, .8, w - .2, 12, '#9aa6ad', '#6f7b85', '#56616b');
    if (round){ /* round tables: no board on top */ }
    else if (wood) isoBox(pos.tx, pos.ty, 1, w, 3, '#b07a48', '#8a5a32', '#7a4e2a', 12);
    else if (hw) isoBox(pos.tx, pos.ty, 1, w, 3, '#9fd8e0', '#6fb0bc', '#7fc0cc', 12);
    else isoBox(pos.tx, pos.ty, 1, w, 3, '#f3e5b2', '#cdb877', '#bfa865', 12);
    // 枱面上嘅嘢：碟、杯、碗、紙巾筒
    const tp = isoPt(pos.tx + .5, pos.ty + .25, round ? 18 : 15); P(tp.x - 2, tp.y - 6, 5, 7, INK); P(tp.x - 1, tp.y - 5, 3, 5, '#fbfaf4');
    seats.forEach((s, k) => {
      const f = fill[k]; if (!f) return;
      const p = isoPt(s.back ? pos.tx + .7 : pos.tx + .3, s.gy, 15);
      if (f.kind==='dirty'){ P(p.x - 5, p.y - 3, 10, 5, INK); P(p.x - 4, p.y - 3, 8, 4, '#fbfaf4'); P(p.x - 3, p.y - 2, 6, 1, '#a0784a'); }
      else if (f.g.state==='eat'){ P(p.x - 6, p.y - 3, 12, 6, INK); P(p.x - 5, p.y - 2, 10, 4, '#fbfaf4'); P(p.x - 3, p.y - 2, 6, 2, '#e9a24a'); P(p.x + 6, p.y - 9, 4, 7, INK); P(p.x + 7, p.y - 8, 2, 5, '#c48a5a'); }
      else if (f.g.state==='wait'){ P(p.x + 1, p.y - 8, 4, 7, INK); P(p.x + 2, p.y - 7, 2, 5, '#c48a5a'); }
    });
    seats.forEach((s, k) => { const f = fill[k]; if (f && f.kind==='p' && s.back) seatedPerson(isoPt(s.gx, s.gy, bh), f.g.color, true, lookOf(f.g.label)); });
    if (!round) isoBox(pos.tx + 1.05, pos.ty, .55, w, bh, ...bc);   // 圓枱用櫈，唔使後面張長櫈
    if (booth) isoBox(pos.tx + 1.42, pos.ty, .18, w, 16, ...bc);
    // 記低位置：撳枱、彈字
    const lt = isoPt(pos.tx - 1, pos.ty), rt = isoPt(pos.tx + 2, pos.ty), lb = isoPt(pos.tx - 1, pos.ty + w), rb = isoPt(pos.tx + 2, pos.ty + w), top = isoPt(pos.tx + .5, pos.ty + w / 2, 40);
    const x0 = Math.min(lt.x, lb.x) - 2, x1 = Math.max(rt.x, rb.x) + 2, y0 = Math.min(lt.y, rt.y) - 30, y1 = Math.max(lb.y, rb.y) + 4;
    sc.hits.push({ tid:id, x: x0 * S, y: y0 * S, w: (x1 - x0) * S, h: (y1 - y0) * S });
    const nm = isoPt(pos.tx + .5, pos.ty + w / 2, 15);
    isoAnchors[id] = { x: top.x * S, y: top.y * S, gs, tb, heads: Object.values(heads), nx: nm.x * S, ny: nm.y * S };
    isoO = isoKeep;
  }
  if (!(fixedShop && fixedShop.bing)) drawShopfront(now);
  // 企喺側邊嘅伙記（裝飾）
  // 伙記企喺右邊冇枱嘅位
  let wy0 = 3; for (const y of [3, 4.5, 1.5, 6, .8]){ if (TPOS.every(q => q.tx + 1.75 < ISO.GX - .8 || y < q.ty - .4 || y > q.ty + q.w + 1.4)){ wy0 = y; break; } }
  const wp = isoPt(ISO.GX - .4, wy0);
  fig(must(PX, 'PX'), Math.round(wp.x) - 8, Math.round(wp.y), dress(WAITER_STAND)); // 著住玩家揀嘅衫
  if (fixedShop && fixedShop.bing) drawBingFront(now, S, t); else drawFront(now, S, t);
  // 城寨冰室：成間舖暗啲，霓虹字發紅光
  if (fixedShop && fixedShop.dim){ P(0, 0, LW, LH, 'rgba(25,12,0,.22)');
    if (walledNeon && walledNeon.on){ t.font = `900 ${Math.round(9 * S)}px "Noto Serif HK", serif`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.shadowColor = '#ff5a5a'; t.shadowBlur = 8 * S; t.fillStyle = '#ff8a8a'; t.fillText('冰室', (walledNeon.p.x + 14) * S, (walledNeon.p.y + 6) * S); t.shadowBlur = 0; } }
  // 奶公司：後牆黃底紅字大招牌
  if (dairySign){ t.font = `900 ${String(Math.round(8 * S))}px "Noto Serif HK", serif`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillStyle = '#c8202a'; dairySign.forEach(d => { t.fillText(d.ch, d.p.x * S, d.p.y * S); }); }
  // 吊扇（冰室）
  if (fixedShop && fixedShop.fans) fixedShop.fans.forEach(([fx, fy]) => { ceilingFan(isoPt(fx, fy, ISO.WALL - 6), now); });
  // 字：枱名，同每枱客頭頂一個泡泡（一個字講狀態）
  const fs = 12;
  isoAnchors.forEach((a) => {
    if (!a) return;
    const tb = a.tb;
    t.font = `900 ${fs}px "Noto Sans HK", sans-serif`; t.textAlign = 'center'; t.textBaseline = 'middle';
    t.lineWidth = 3; t.strokeStyle = '#7a5a2a'; t.strokeText(tb.name, a.nx, a.ny + 2); t.fillStyle = '#ffffff'; t.fillText(tb.name, a.nx, a.ny + 2);
    a.heads.forEach(h => {
      // `taken` is a seated-group field (ai.js sets it); a takeaway group never has it, as in the JS.
      const g = h.g, open = g.state==='order' && !(!g.take && g.taken);
      const ch = g.state==='think' ? '睇' : g.state==='order' ? (!g.take && g.taken ? '寫' : '落') : g.state==='wait' ? (g.meals && g.meals.some(m => !m.done) ? '等' : '飲') : '食';
      const bg = open ? (Math.floor(now / 350) % 2 ? '#ff5a5a' : '#c8323c') : g.state==='think' ? '#e6f1ec' : g.state==='eat' ? '#7be08f' : g.state==='wait' && ch==='飲' ? '#9fd3ff' : '#ffd25a';
      bubble(t, h.x * S, h.y * S - 4, ch, bg, open ? '#ffffff' : INK, 4);
      if (open){ const f = Math.max(0, Math.min(1, (g.until - liveG().t) / g.max)); t.fillStyle = INK; t.fillRect(h.x * S - 13, h.y * S - 32, 26, 4); t.fillStyle = f < .3 ? '#ff5a5a' : '#7be08f'; t.fillRect(h.x * S - 12, h.y * S - 31, 24 * f, 2); }
    });
    if (tb.dirty) bubble(t, a.x, a.y + 4, '執', '#fbfaf4', INK, 4);
  });
}
let mapDrawn = false;
/** Is the floor canvas showing the shop map now? floor-jobs.ts then leaves the station bubbles to the map. */
export const mapOn = (): boolean => mapDrawn;
/** The map's frame, with the level's wall and floor looks; the tables' anchors (fx, tutorial) from its layout. */
function drawMapFloor(now: number): void {
  const WT = must(WALLS[String(decorLook('wall'))], 'wall look'), FT = must(FLOORS[String(decorLook('floor'))], 'floor look');
  drawMap(FSC, now, { floorA: FT.a, floorB: FT.b, wallR: WT.r, wallL: WT.l });
  mapDrawn = true;
  const L = mapNow(); isoAnchors = [];
  if (!L || !G) return;
  for (const t of L.tables){
    const tb = G.tables[t.tid]; if (!tb) continue;
    const a = mapToScreen(t.u, t.v, 90), n = mapToScreen(t.u, t.v, 49);
    isoAnchors[t.tid] = { x: a.x, y: a.y, gs: atTable(t.tid), tb, heads: [], nx: n.x, ny: n.y };
  }
}
/* ---- 閣樓（行運茶餐廳）：後牆一個高台，前面橙色幾何圖案板、欄杆、樓梯 ---- */
export function drawLoft(L: number[]): void {
  // Missing entries default to NaN: the JS did arithmetic on them (undefined -> NaN).
  const [x0 = NaN, y0 = NaN, w = NaN, d = NaN, z = NaN] = L;
  // 閣樓底下嘅柱
  ([[x0 + w - .15, y0 + d - .15]] satisfies [number, number][]).forEach(([u, v]) => { isoBox(u, v, .15, .15, z, '#d8c8b0', '#c0b098', '#b0a088'); });
  isoBox(x0, y0, w, d, 6, '#c8a878', '#e8dcc8', '#d8ccb8', z - 6);           // 閣樓地台
  // 前面（向左下）米色板加橙色幾何圖案
  const a = isoPt(x0 + w * .15, y0 + d, z - 1), b = isoPt(x0 + w * .85, y0 + d, z - 1);
  poly([{ x:a.x, y:a.y - 1 }, { x:b.x, y:b.y - 1 }, { x:b.x, y:b.y + 4 }, { x:a.x, y:a.y + 4 }], '#f0ece4');
  for (let k = 0; k < 2; k++){ const c = isoPt(x0 + w * (.33 + k * .34), y0 + d, z - 3); poly([{ x:c.x - 7, y:c.y }, { x:c.x - 3, y:c.y - 3 }, { x:c.x + 3, y:c.y - 3 }, { x:c.x + 7, y:c.y }, { x:c.x + 3, y:c.y + 4 }, { x:c.x - 3, y:c.y + 4 }], '#f08a2a'); }
  // 欄杆
  const r0 = isoPt(x0, y0 + d, z + 10), r1 = isoPt(x0 + w, y0 + d, z + 10), r2 = isoPt(x0 + w, y0, z + 10);
  line(r0, r1, '#6a4a2a'); line(r1, r2, '#6a4a2a');
  for (let k = 0; k <= 8; k++){ const t = k / 8, p = isoPt(x0 + w * t, y0 + d, z); P(p.x, p.y - 10, 1, 10, '#6a4a2a'); }
  // 樓梯：由閣樓邊落地（有通花板）
  for (let k = 0; k < 6; k++) isoBox(x0 + w + k * .3, y0 + .2, .3, .9, Math.max(2, z - k * (z / 6)), '#d8b888', '#a88858', '#c0a070');
  const s0 = isoPt(x0 + w, y0 + 1.1, z + 6), s1 = isoPt(x0 + w + 1.8, y0 + 1.1, 6);
  line(s0, s1, '#6a4a2a');
  for (let k = 1; k < 5; k++){ const t = k / 5, p = { x: s0.x + (s1.x - s0.x) * t, y: s0.y + (s1.y - s0.y) * t }; el(p.x, p.y + 3, 1, 1, '#ffffff', null); }
}
/* ---- 門面：前面兩邊矮牆加玻璃窗（唔遮住入面），兩格闊大門 ---- */
export const doorRange = () => fixedShop && fixedShop.door || [ISO.GY - 3, ISO.GY - 1];
export function drawShopfront(now: number): void {
  const GX = ISO.GX, GY = ISO.GY, dr = doorRange(), LOW = 9, TOP = 34, lanf = fixedShop && fixedShop.lanfong;
  // 行運：門口一個不鏽鋼麵包餅櫃（菠蘿包、蛋撻）
  // 萬聖節：門口一排南瓜燈、角落蜘蛛網
  if (fixedShop && fixedShop.halloween){
    const flick = Math.floor(now / 180) % 4;
    ([[GX + .5, dr[0] - .6], [GX + .5, dr[1] + .5], [1, GY + .4], [3.5, GY + .4], [6, GY + .4]] satisfies [number, number][]).forEach(([u, v], i) => { const p = isoPt(u, v, 0);
      el(p.x, p.y - 4, 6, 4, '#e8701a', '#8a3a0a'); P(p.x - 1, p.y - 10, 2, 3, '#3a6a2a');
      const glow = (flick + i) % 4 ? '#ffe04a' : '#ffb020'; P(p.x - 4, p.y - 6, 2, 2, glow); P(p.x + 2, p.y - 6, 2, 2, glow); P(p.x - 3, p.y - 3, 6, 1, glow); });
  }
  if (fixedShop && fixedShop.bakery){ const u = GX - .9, v = dr[1] + .1;
    isoBox(u, v, .7, .9, 16, '#c9d1d6', '#9aa6ad', '#8d9aa2');
    isoBox(u, v, .7, .9, 14, '#e6f4f8', '#bcd9e2', '#a9c8d4', 16, '#5d6870');
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++){ const p = isoPt(u + .2 + k * .2, v + .9, 3 + r * 5); P(p.x - 2, p.y - 2, 4, 3, r===1 ? '#f2c64a' : '#e8a050'); }
  }
  const glassRun = (pts: (t: number) => IsoPt, n: number): void => {   // pts(t) 由 0 到 1 沿住牆，n 格
    for (let i = 0; i < n * 2; i++){
      const a = pts(i / (n * 2)), b = pts((i + 1) / (n * 2));
      poly([{ x:a.x, y:a.y - LOW }, { x:b.x, y:b.y - LOW }, b, a], lanf ? (i % 2 ? '#c8423a' : '#b8362e') : i % 2 ? '#7a5a3a' : '#6a4a2a');               // 矮牆
      poly([{ x:a.x, y:a.y - TOP }, { x:b.x, y:b.y - TOP }, { x:b.x, y:b.y - LOW }, { x:a.x, y:a.y - LOW }], 'rgba(200,232,244,.22)');   // 玻璃
      line({ x:a.x, y:a.y - TOP }, { x:a.x, y:a.y - LOW }, '#5d6870');
      if (hsh(i + n * 7) < .25){ const m = pts((i + .5) / (n * 2)); P(m.x - 2, m.y - 26, 5, 7, hsh(i + 3) < .5 ? '#fbf3c0' : '#f6c8c0'); P(m.x - 1, m.y - 24, 3, 1, '#c8323c'); }   // 手寫價錢牌
    }
    const s = pts(0), e = pts(1); line({ x:s.x, y:s.y - TOP }, { x:e.x, y:e.y - TOP }, '#5d6870'); line({ x:s.x, y:s.y - LOW }, { x:e.x, y:e.y - LOW }, '#3a2a1a');
  };
  // 左前（gy = GY）成條；右前（gx = GX）門口兩邊
  if (fixedShop && fixedShop.dairy){
    // 奶公司：左前一幅玻璃磚牆，中間嵌紅藍方格；右前餅窗擺滿一疊疊燉奶碗
    for (let i = 0; i < GX * 4; i++) for (let r = 0; r < 7; r++){ const p = isoPt(i / 4, GY, 4 + r * 4.4);
      const mid = r >= 2 && r <= 4 && i % 2===0 && i > 1 && i < GX * 4 - 2, col = mid ? ((i / 2 + r) % 3 ? '#c8323c' : '#2a5aa8') : (i + r) % 2 ? '#a8b8a0' : '#98a890';
      P(p.x, p.y - 4, 4, 4, col); if (mid) P(p.x + 1, p.y - 3, 2, 1, '#fbf6e2'); }
    const s0 = isoPt(0, GY), e0 = isoPt(GX, GY); line({ x:s0.x, y:s0.y - TOP }, { x:e0.x, y:e0.y - TOP }, '#c9d1d6'); line({ x:s0.x, y:s0.y - 1 }, { x:e0.x, y:e0.y - 1 }, '#c9d1d6');
    if (dr[0] > .05){ glassRun(t => isoPt(GX, t * dr[0]), dr[0]);
      for (let r = 0; r < 3; r++) for (let k = 0; k < dr[0] * 3 - 1; k++){ const p = isoPt(GX - .15, .3 + k / 3, 12 + r * 7);
        for (let h = 0; h < 3; h++) P(p.x - 3, p.y - h * 2, 6, 2, h % 2 ? '#e6e2d8' : '#fbfaf4'); P(p.x - 3, p.y + 1, 6, 1, '#c9d1d6'); } }
    drawDairyQueue(GX, dr, now);
  } else {
  glassRun(t => isoPt(t * GX, GY), GX);
  if (dr[0] > .05) glassRun(t => isoPt(GX, t * dr[0]), dr[0]);
  }
  if (GY - dr[1] > .05) glassRun(t => isoPt(GX, dr[1] + t * (GY - dr[1])), GY - dr[1]);
  if (lanf) drawTeaStall(GX, dr, now);
  // 門框：兩條柱加橫樑，兩邊收埋趟閘
  const a = isoPt(GX, dr[0]), b = isoPt(GX, dr[1]);
  [a, b].forEach(p => { P(p.x - 1, p.y - 40, 3, 40, INK); P(p.x, p.y - 39, 1, 38, '#c9d1d6'); });
  poly([{ x:a.x, y:a.y - 42 }, { x:b.x, y:b.y - 42 }, { x:b.x, y:b.y - 38 }, { x:a.x, y:a.y - 38 }], '#5d6870');
  ([[dr[0], .25], [dr[1] - .25, .25]] satisfies [number, number][]).forEach(([y0, w]) => { for (let k = 0; k < 3; k++){ const p = isoPt(GX, y0 + k * w / 3); P(p.x, p.y - 36, 1, 34, k % 2 ? '#c9d1d6' : '#9aa6ad'); } });
}
/* ---- 布袋奶茶檔：門口一個綠色鐵皮奶茶檔遮住大半個紅色門面，外賣客喺前面排隊 ---- */
export function drawTeaStall(GX: number, dr: [number, number], now: number): void {
  const u = GX + .15, v0 = .4, v1 = Math.max(v0 + 2, dr[0] - .3), d = v1 - v0;
  isoBox(u, v0, 1.1, d, 22, '#4a9a6a', '#2f7a4f', '#3a8a5c');                      // 檔身
  isoBox(u - .05, v0 - .05, 1.2, d + .1, 4, '#3a8a5c', '#256a42', '#2f7a4f', 40);   // 鐵皮頂
  for (let k = 0; k < 4; k++){ const p = isoPt(u + 1.1, v0 + .2 + k * d / 4, 22); P(p.x, p.y - 14, 1, 14, '#256a42'); }   // 窗框
  const w0 = isoPt(u + 1.1, v0 + .15, 36), w1 = isoPt(u + 1.1, v1 - .15, 36);
  poly([w0, w1, { x:w1.x, y:w1.y + 13 }, { x:w0.x, y:w0.y + 13 }], '#e8eef0');      // 窗口：入面白色
  for (let k = 0; k < 3; k++){ const p = isoPt(u + .6, v0 + .5 + k * (d - 1) / 2, 22); isoBox(u + .45, v0 + .35 + k * (d - 1) / 2, .3, .3, 9, '#c9d1d6', '#9aa6ad', '#8d9aa2', 22); P(p.x - 1, p.y - 16 - (Math.floor(now / 200 + k) % 3), 1, 3, '#e6ecef'); }   // 茶壺出煙
  isoBox(u + 1.1, v0, .25, d, 2, '#c9d1d6', '#9aa6ad', '#8d9aa2', 21);             // 不鏽鋼枱面
  for (let k = 0; k < 2; k++) isoBox(u + .2, v1 + .1 + k * .02, .5, .4, 5 + k * 5, '#d8b070', '#a88050', '#b89060', 0);   // 一箱箱雞蛋
  // 外賣客排隊：企喺檔口前面，愈嚟愈出
  const q = G ? G.groups.filter(g => g.take && !g.via) : [];   // the extra seats' walk-ins and pack orders do not queue here
  q.forEach((g, i) => { standPerson(isoPt(u + 1.7 + Math.floor(i / 3) * .6, v0 + .5 + (i % 3) * .7, 0), g.color); });
}
// 企喺街嘅人（排隊用）
export function standPerson(p: IsoPt, col: string, hair = '#2b2420'): void {
  P(p.x - 3, p.y - 14, 6, 10, col); P(p.x - 3, p.y - 4, 2, 4, '#2b3036'); P(p.x + 1, p.y - 4, 2, 4, '#2b3036');
  el(p.x, p.y - 17, 3, 3, '#f0c8a0', INK); P(p.x - 3, p.y - 20, 6, 2, hair);
}
// 奶公司門口長龍：真係排緊位嘅客，再加幾個長期喺度嘅街坊（每幾秒有人郁一郁）
export function drawDairyQueue(GX: number, dr: [number, number], now: number): void {
  const qs = G ? G.groups.filter(g => g.state==='queue') : [], extra = 3 + Math.floor(now / 4000) % 2;
  const cols = ['#5a6a7a', '#c8a0b0', '#2b3036', '#8a6a4a', '#e0e0d8'];
  const all = [...qs.map(g => g.color), ...Array.from({ length: extra }, (_, k) => String(cols[k % cols.length]))];
  all.forEach((c, i) => { const p = isoPt(GX + 1 + (i % 2) * .3, dr[0] - .2 - i * .5, 0); standPerson(p, c, i % 3===2 ? '#8a8a8a' : '#2b2420'); });
}
// 布袋奶茶檔：頭頂不鏽鋼抽油煙罩、光管，牆上貼滿剪報同手寫餐牌
export function drawLanfongWall(W: number): void {
  isoBox(.05, .6, .8, ISO.GY - 1.6, 8, '#d8dee2', '#a9b4bb', '#bcc6cc', W - 16);
  isoBox(.6, .05, ISO.GX - 2.2, .7, 8, '#d8dee2', '#a9b4bb', '#bcc6cc', W - 16);
  for (let k = 0; k < 3; k++){ const p = isoPt(.9, 1.5 + k * 2.3, W - 17); P(p.x - 8, p.y + 1, 9, 2, '#fbfaf4'); }
  const paper = ['#fbf6e2', '#f6e8a8', '#e8eef0', '#f8d8c8'];
  for (let k = 0; k < 9; k++){ const p = isoPt(0, 4.6 + (k % 3) * .9, 30 + Math.floor(k / 3) * 9); P(p.x - 6, p.y - 5, 6, 7, String(paper[k % 4])); P(p.x - 5, p.y - 3, 4, 1, '#8a8f94'); P(p.x - 5, p.y - 1, 3, 1, '#8a8f94'); }
  for (let k = 0; k < 6; k++){ const p = isoPt(5 + (k % 3) * .8, 0, 26 + Math.floor(k / 3) * 9); P(p.x, p.y - 5, 6, 7, String(paper[(k + 1) % 4])); P(p.x + 1, p.y - 3, 4, 1, '#c8323c'); P(p.x + 1, p.y - 1, 3, 1, '#8a8f94'); }
}
/* ---- 周圍：間舖四圍嘅行人路、馬路、斑馬線（唔再係一片黑） ---- */
export const GROUNDS: Grounds = {
  'pl-town':    { a:'#c9c2b0', b:'#bdb5a2', road:'#4b555d', line:'#ffd25a', zebra:true,
    slabs:[[-3, -7.2, 3.6, 1.8, 9, 'L', 'tong:#d9cdb4'], [.8, -7.2, 3.2, 1.8, 12, 'L', 'tong:#c9b8a0'], [4.2, -7.2, 3.6, 1.8, 8, 'L', 'tong:#e0d0c0'], [8, -7.2, 3.4, 1.8, 11, 'L', 'tong:#b8c0b0'],
           [-7.6, -2.8, 1.8, 3.4, 10, 'R', 'tong:#e0d0c0'], [-7.6, .8, 1.8, 3.6, 7, 'R', 'tong:#d9cdb4'], [-7.6, 4.6, 1.8, 3.4, 12, 'R', 'tong:#c9b8a0']] },
  'pl-estate':  { a:'#c9c4bc', b:'#bdb8b0', road:'#4b555d', line:'#ffd25a', zebra:true, brick:'#a85a4a',
    slabs:[[-3, -7.4, 16, 1.8, 18, 'L', 'wahfu:#e8a0b4'], [-8, -2, 1.8, 11, 14, 'R', 'wahfu:#a9c8e4']] },
  // slabs：[gx, gy, w, d, 層數, 面向]，face 'L' = 正面向左下（gy+d 嗰面），'R' = 向右下
  'pl-rainbow': { a:'#e8e4dc', b:'#dcd8d0', road:null, line:null, court:true, slabs:[[-3, -7, 17, 1.6, 20, 'L'], [-7.5, -2, 1.6, 12, 16, 'R']] },
  'pl-walled':  { a:'#5a5650', b:'#4e4a45', road:'#3a3f44', line:null },
  // 佐敦：夜晚，唐樓掛滿伸出嚟嘅霓虹招牌（冇字）
  'pl-jordan':  { a:'#7e7884', b:'#726c78', road:'#2e3236', line:'#ffd25a', zebra:true,
    slabs:[[-3, -7.4, 3.4, 2, 12, 'L', 'neon:#c9b8a0'], [.6, -7.4, 3.6, 2, 15, 'L', 'neon:#b8a898'], [4.4, -7.4, 3.2, 2, 11, 'L', 'neon:#d0c0a8'], [7.8, -7.4, 3.6, 2, 14, 'L', 'neon:#a89888'],
           [-7.8, -2.8, 2, 3.4, 13, 'R', 'neon:#b8a898'], [-7.8, .8, 2, 3.6, 10, 'R', 'neon:#c9b8a0'], [-7.8, 4.6, 2, 3.4, 15, 'R', 'neon:#a89888']] },
  // 長洲：海邊夜晚，前面係海同碼頭，後面一排矮矮嘅度假屋
  'pl-island':  { a:'#8a8070', b:'#7e7464', road:'#1e3a4a', line:null, sea:true,
    slabs:[[-3, -7.2, 3, 1.8, 3, 'L', 'house:#d8c8b8'], [.4, -7.2, 2.8, 1.8, 4, 'L', 'house:#b8c8c0'], [3.6, -7.2, 3, 1.8, 3, 'L', 'house:#e0c8c0'], [7, -7.2, 3, 1.8, 2, 'L', 'house:#c8c0a8'],
           [-7.6, -2.8, 1.8, 3.2, 3, 'R', 'house:#b8c8c0'], [-7.6, .8, 1.8, 3.4, 2, 'R', 'house:#d8c8b8'], [-7.6, 4.6, 1.8, 3.2, 3, 'R', 'house:#e0c8c0']] },
  // 信徒之選（長洲）：同萬聖關一樣，海邊夜景、度假屋
  get 'pl-haunt'(){ return this['pl-island']; },
  // 中環：後面玻璃幕牆商廈，前面斜路舊樓同街市綠色鐵皮檔
  'pl-central': { a:'#c8c4bc', b:'#bcb8b0', road:'#4b555d', line:'#ffd25a', zebra:true, stalls:true,
    slabs:[[-3, -9.6, 4, 2.2, 34, 'L', 'glass:#7f9fbf'], [1.6, -9.6, 4.4, 2.2, 42, 'L', 'glass:#6f8fae'], [6.6, -9.6, 4, 2.2, 30, 'L', 'glass:#8aa8c4'],
           [-3, -7.2, 3.6, 1.8, 9, 'L', 'tong:#e0d8c8'], [.8, -7.2, 3.2, 1.8, 11, 'L', 'tong:#d0c8b8'], [4.2, -7.2, 3.6, 1.8, 8, 'L', 'tong:#e8dcc8'], [8, -7.2, 3.4, 1.8, 10, 'L', 'tong:#c8c0b0'],
           [-10, -2.8, 2.2, 3.6, 36, 'R', 'glass:#7f9fbf'], [-7.6, -2.8, 1.8, 3.4, 10, 'R', 'tong:#e0d8c8'], [-7.6, .8, 1.8, 3.6, 7, 'R', 'tong:#d0c8b8'], [-7.6, 4.6, 1.8, 3.4, 12, 'R', 'tong:#c8c0b0']] },
  'pl-village': { a:'#b8b0a0', b:'#aaa292', road:null, line:null, props:true },
};
export function drawGround(place: string | undefined, now: number): void {
  const g = GROUNDS[String(place)] || GROUNDS["pl-town"], GX = ISO.GX, GY = ISO.GY, X0 = -3, Y0 = -3, X1 = GX + 14, Y1 = GY + 14;
  P(0, isoO.y - ISO.WALL + 30, must(PX, 'PX').canvas.width, must(PX, 'PX').canvas.height, g.b);   // 地平線以下先鋪滿，唔好留黑邊
  const cell = (u: number, v: number, du: number, dv: number, col: string): void => { poly([isoPt(u, v), isoPt(u + du, v), isoPt(u + du, v + dv), isoPt(u, v + dv)], col); };
  for (let u = X0; u < X1; u++) for (let v = Y0; v < Y1; v++) cell(u, v, 1, 1, (u + v) % 2 ? g.a : g.b);
  if (g.brick) for (let u = X0; u < X1; u += 3) { cell(u, Y0, .15, Y1 - Y0, g.brick); }   // 邨嘅紅磚間條地
  if (g.brick) for (let v = Y0; v < Y1; v += 3) cell(X0, v, X1 - X0, .15, g.brick);
  if (g.road){
    // 前面左邊一條馬路，後面兩邊各一條
    cell(X0, GY + 1.2, X1 - X0, 1.6, g.road); cell(X0, -2.8, X1 - X0, 1.6, g.road); cell(-2.8, Y0, 1.6, Y1 - Y0, g.road);
    if (g.line) for (let u = X0; u < X1; u += 1.4){ cell(u, GY + 1.95, .7, .1, g.line); cell(u, -2.05, .7, .1, g.line); }
    if (g.zebra) for (let k = 0; k < 5; k++) cell(GX + 1.3 + k * .3, GY + 1.25, .16, 1.5, '#fbfaf4');
    if (g.sea){   // 長洲：前面同右邊成片都係海，有白頭浪
      cell(X0, GY + 1.2, X1 - X0, 16, g.road); cell(GX + 1.1, Y0, 16, Y1 - Y0, g.road);
      for (let k = 0; k < 40; k++){ const u = X0 + hsh(k + 1200) * (X1 - X0), v = GY + 1.4 + hsh(k + 1210) * 10; const w = isoPt(u, v); P(w.x - 3, w.y, 6, 1, '#4a7a90'); }
      for (let k = 0; k < 20; k++){ const u = GX + 1.5 + hsh(k + 1220) * 10, v = Y0 + hsh(k + 1230) * (Y1 - Y0); const w = isoPt(u, v); P(w.x - 3, w.y, 6, 1, '#4a7a90'); }
    }
  }
  if (g.slabs) g.slabs.forEach(sl => { isoSlab(...sl); });
  if (place==='pl-village') villageHuts();
  if (place==='pl-walled') walledCity(now);
  if (g.stalls) for (let k = 0; k < 4; k++){   // 街市檔：綠色鐵皮加帆布篷，擺住生果
    const u = -1.6 + k * 2.6, v = -5.2;
    isoBox(u, v, 1.2, .7, 10, '#4a9a6a', '#2f7a4f', '#3a8a5c');
    isoBox(u - .1, v - .1, 1.4, .9, 2, k % 2 ? '#e8d870' : '#e07a5a', '#b8a850', '#c06048', 20);
    for (let j = 0; j < 4; j++){ const p = isoPt(u + .2 + j * .25, v + .7, 10); el(p.x, p.y - 1, 2, 2, String(['#f2a020', '#e04a3a', '#7ac04a', '#f2d040'][(j + k) % 4]), null); }
  }
  if (g.court){
    // 彩虹邨天台籃球場（跟相）：藍底、綠場、黃橙禁區、白線、藍色籃球架同長櫈
    cell(-2.6, GY + .6, GX + 2, 5, '#3d6fd0'); cell(-2, GY + 1, GX + .8, 4.2, '#2a9a6a');
    cell(1.5, GY + 1.4, 3, 3.4, '#f2c64a'); cell(2.2, GY + 1.4, 1.6, 1.6, '#e8703a');
    ([[-2, GY + 1, GX + .8, .06], [-2, GY + 5.14, GX + .8, .06], [-2, GY + 1, .06, 4.2], [GX - 1.26, GY + 1, .06, 4.2]] satisfies [number, number, number, number][]).forEach(([u, v, du, dv]) => { cell(u, v, du, dv, '#fbfaf4'); });
    const h = isoPt(3, GY + 5.4, 0); P(h.x - 1, h.y - 40, 3, 40, '#2a9aa8'); P(h.x - 8, h.y - 48, 16, 11, INK); P(h.x - 7, h.y - 47, 14, 9, '#fbfaf4'); P(h.x - 3, h.y - 41, 6, 1, '#e8703a');
    for (let k = 0; k < 2; k++) isoBox(GX + 2.6, 1 + k * 2.2, .3, 1.2, 4, '#3d9ad4', '#2f7ab0', '#3584c0');
  }
  if (g.props){
    // 茶果嶺村：花盆、晾衫架、街燈、紙皮（跟相）
    const pot = (u: number, v: number, c: string): void => { isoBox(u, v, .3, .3, 6, '#b06a4a', '#8a4a32', '#9a5a3a'); const p = isoPt(u + .15, v + .15, 6); el(p.x, p.y - 4, 5, 4, c, null); };
    pot(-1.4, GY - 2, '#4f9a4a'); pot(-1, GY - 1.4, '#3f8a3c'); pot(GX + 3.4, 1.2, '#4f9a4a');
    const rk = isoPt(-1.6, 2, 0); P(rk.x - 8, rk.y - 26, 1, 26, '#5d6870'); P(rk.x + 8, rk.y - 22, 1, 22, '#5d6870'); P(rk.x - 8, rk.y - 26, 17, 1, '#5d6870');
    P(rk.x - 6, rk.y - 25, 5, 8, '#e8d870'); P(rk.x + 1, rk.y - 24, 5, 9, '#2b3036');
    const lp = isoPt(GX + 3.2, GY - 1, 0); P(lp.x, lp.y - 52, 2, 52, '#8d9aa2'); P(lp.x - 6, lp.y - 52, 8, 2, '#8d9aa2'); P(lp.x - 7, lp.y - 51, 4, 2, '#e6ecef');
    isoBox(GX + 3, GY + 1.5, .8, .5, 4, '#c8a070', '#a07848', '#b08858');
  }
}
// 立體長形大廈（彩虹邨）：每層一段段粉紫、粉藍、米白、黃、橙，中間紅色通花樓梯
// 立體大廈：style = 'rainbow'（彩虹邨）、'wahfu:色'（華富邨，一條條粉色直間）、'tong:色'（唐樓，低層有招牌）
// base / col stay string | undefined as in the JS (accent is missing for 'rainbow'); String() where they reach a
// fillStyle, must() where shade() dereferences them.
export function isoSlab(gx: number, gy: number, w: number, d: number, floors: number, face: string, style = 'rainbow'): void {
  const [kind, accent] = style.split(':'), FH = kind==='tong' || kind==='neon' || kind==='house' ? 7 : 6, H = floors * FH + 4;
  const rbBand = (f: number): string => { const t = f / floors; return t < .2 ? '#f0a868' : t < .4 ? '#f2dc78' : t < .6 ? '#efe6d0' : t < .8 ? '#9fcbea' : '#c9b4e0'; };
  const tl = kind==='tong' || kind==='neon' || kind==='house', base = tl || kind==='glass' ? accent : kind==='wahfu' ? '#dcd4ca' : '#d8d0c0', roof = kind==='wahfu' ? '#8a3a2a' : tl ? '#9aa6ad' : kind==='glass' ? '#5a6a7a' : '#d8d0c0';
  isoBox(gx, gy, w, d, H, roof, String(base), String(base));
  const along = face==='L' ? w : d, mid = along * .45, seg = .5;
  for (let f = 0; f < floors; f++){ const z0 = 2 + f * FH, z1 = z0 + FH - 2;
    for (let u = 0, i = 0; u < along - .01; u += seg, i++){
      const pA: [number, number] = face==='L' ? [gx + u, gy + d] : [gx + w, gy + u], pB: [number, number] = face==='L' ? [gx + u + seg, gy + d] : [gx + w, gy + u + seg];
      let col: string | undefined;
      if (kind==='rainbow'){ const red = Math.abs(u - mid) < .5; col = red ? (f % 2 ? '#c8323c' : '#d84a4a') : (i % 2 ? rbBand(f) : '#f4efe4'); }
      else if (kind==='wahfu') col = i % 6 < 2 ? accent : i % 2 ? '#e8e2da' : '#d0c8be';
      else if (kind==='glass') col = f % 2 ? base : shade(must(base, 'slab colour'));
      else col = i % 2 ? base : shade(must(base, 'slab colour'));
      poly([isoPt(pA[0], pA[1], z1), isoPt(pB[0], pB[1], z1), isoPt(pB[0], pB[1], z0), isoPt(pA[0], pA[1], z0)], String(col));
      const m = isoPt((pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2, z0 + 2);
      if (kind==='glass'){ if (hsh(i * 13 + f * 5 + gx) < .2) P(m.x - 2, m.y - 2, 4, 2, '#d8ecfa'); }
      else if (i % 2===0) P(m.x - 1, m.y - 1, 3, 2, hsh(i * 31 + f * 7 + gx) < .15 || (kind==='neon' && hsh(i * 7 + f) < .4) ? '#ffd25a' : '#4a5a6a');
      if (kind==='neon' && f >= 1 && f <= 4 && i % 3===1){ const nc = ['#ff4a8a', '#4ae0ff', '#ff5a3a', '#ffe04a', '#a06aff'][(i + f + Math.round(gx)) % 5];
        P(m.x - 5, m.y - 10, 11, 10, INK); P(m.x - 4, m.y - 9, 9, 8, String(nc)); P(m.x - 2, m.y - 7, 5, 4, '#ffffff'); }
      // 唐樓低層：伸出嚟嘅招牌（冇字）
      if (kind==='tong' && f===1 && i % 4===1) P(m.x - 3, m.y - 8, 7, 9, String(['#c8323c', '#2a8b67', '#3d7fbf', '#e9a21a'][(i + Math.round(gx)) % 4]));
    } }
}
export const shade = (c: string): string => { const n = parseInt(c.slice(1), 16), f = (v: number): number => Math.max(0, Math.round(v * .86)); return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join(''); };
// 九龍城寨（跟航拍相）：一大片高矮唔同嘅樓擠埋一齊，灰白發黑，窗口有燈，天台天線雜物；啟德飛機低飛
export function walledCity(now: number): void {
  const out: { u: number; v: number; w: number; d: number; h: number; n: number }[] = [];
  for (let u = -10; u < ISO.GX + 7; u += 1.1) for (let v = -10; v < ISO.GY + 5; v += 1.1){
    if (u > -2.4 && v > -2.4) continue;   // 舖頭同前面留空
    const n = Math.round((u + 30) * 53 + (v + 30) * 97);
    out.push({ u, v, w: 1.1 + hsh(n + 1) * .25, d: 1.1 + hsh(n + 2) * .25, h: 50 + Math.round(hsh(n + 3) * 70) + (u < -5 || v < -5 ? 30 : 0), n });
  }
  out.sort((a, b) => (a.u + a.v) - (b.u + b.v)).forEach(b => {
    const c = must(['#a8a090', '#9a9282', '#b8b0a0', '#8a8478', '#c0b8a8'][b.n % 5], 'block colour');
    isoBox(b.u, b.v, b.w, b.d, b.h, shade(c), c, shade(c));
    // 窗：兩面都有一格格，間中着燈、晾衫
    for (let z = 6; z < b.h - 4; z += 6) for (let k = .15; k < b.w - .1; k += .3){
      const p = isoPt(b.u + k, b.v + b.d, z), q = isoPt(b.u + b.w, b.v + k, z), r = hsh(b.n * 7 + z * 13 + k * 100);
      P(p.x, p.y - 2, 2, 2, r < .12 ? '#ffd25a' : r < .2 ? '#e8e2d0' : '#3a3630');
      P(q.x - 1, q.y - 2, 2, 2, r > .9 ? '#ffd25a' : '#4a4640');
      if (r > .97) P(p.x - 1, p.y + 1, 4, 3, String(['#c8323c', '#3d7fbf', '#fbfaf4'][b.n % 3]));
    }
    const t = isoPt(b.u + b.w / 2, b.v + b.d / 2, b.h);
    if (hsh(b.n + 9) < .5) P(t.x, t.y - 10, 1, 10, '#5d6870');                         // 天線
    if (hsh(b.n + 11) < .3) P(t.x - 4, t.y - 3, 6, 3, '#6a6258');                       // 天台雜物／鐵皮屋
  });
  // 啟德飛機低飛過城寨頂
  const k = (now / 14000) % 1, a = isoPt(-6 + k * (ISO.GX + 16), -8 + k * 6, 210);
  P(a.x - 14, a.y, 30, 4, '#e6ecef'); P(a.x - 2, a.y - 6, 6, 16, '#c9d1d6'); P(a.x + 14, a.y - 5, 4, 6, '#c8323c'); P(a.x - 12, a.y + 1, 26, 1, '#3d7fbf');
}
// 茶果嶺村：一間間矮鐵皮屋同樹（只擺喺間舖後面同兩側，唔會遮住舖頭）
export function villageHuts(): void {
  const out: { u: number; v: number; w: number; d: number; h: number; n: number }[] = [];
  for (let u = -9; u < ISO.GX + 6; u += 1.6) for (let v = -9; v < ISO.GY + 4; v += 1.5){
    if (u > -2.2 && v > -2.2) continue;   // 舖頭同前面留空
    const n = Math.round((u + 20) * 37 + (v + 20) * 101); if (hsh(n) < .18) continue;
    out.push({ u: u + hsh(n + 1) * .3, v: v + hsh(n + 2) * .3, w: 1 + hsh(n + 3) * .5, d: 1 + hsh(n + 4) * .4, h: 8 + Math.round(hsh(n + 5) * 8), n });
  }
  out.sort((a, b) => (a.u + a.v) - (b.u + b.v)).forEach(h => {
    if (hsh(h.n + 9) < .2){ const p = isoPt(h.u + .5, h.v + .5, 0); P(p.x - 1, p.y - 14, 3, 14, '#5a3a20'); el(p.x, p.y - 20, 11, 8, '#3f8a3c', null); el(p.x - 3, p.y - 23, 6, 4, '#4f9a4a', null); return; }
    const r = hsh(h.n + 7), roof = r < .45 ? '#9a4a32' : r < .9 ? '#b8c0c6' : '#3d7fbf', wall = must(['#d9d2c4', '#c9c0b0', '#b8b0a2'][h.n % 3], 'hut colour');
    isoBox(h.u, h.v, h.w, h.d, h.h, roof, wall, shade(wall));
    for (let k = .2; k < h.w; k += .25) line(isoPt(h.u + k, h.v, h.h), isoPt(h.u + k, h.v + h.d, h.h), shade(roof));
    const wn = isoPt(h.u + h.w * .5, h.v + h.d, h.h * .5); P(wn.x - 2, wn.y - 2, 4, 3, '#3a4a5a');
  });
}
/* ---- 街道同門面：右前方係行人路同馬路，牆頂伸出直招牌 ---- */
export const STREET_W = 2.6;
export function drawStreet(): void {
  const G0 = ISO.GX, GY = ISO.GY, pk = decorLook('place'), PL: Partial<PlaceDef> = PLACES[String(pk)] || {}, GR: Partial<GroundDef> = GROUNDS[String(pk)] || {}, sea = GR.sea;
  for (let gy = 0; gy < GY; gy++){
    // 行人路：灰色階磚（長洲係木碼頭）
    for (let i = 0; i < 2; i++){ const u = G0 + i * .5; poly([isoPt(u, gy), isoPt(u + .5, gy), isoPt(u + .5, gy + 1), isoPt(u, gy + 1)], sea ? ((gy + i) % 2 ? '#8a6a4a' : '#7a5a3a') : (gy + i) % 2 ? '#c9c2b0' : '#bdb5a2'); }
    // 馬路（長洲就係海，有浪）
    poly([isoPt(G0 + 1.1, gy), isoPt(G0 + STREET_W, gy), isoPt(G0 + STREET_W, gy + 1), isoPt(G0 + 1.1, gy + 1)], sea ? '#1e3a4a' : PL.road || '#4b555d');
    if (sea){ const w = isoPt(G0 + 1.6 + (gy % 3) * .3, gy + .5); P(w.x - 3, w.y, 6, 1, '#4a7a90'); }
    else if (gy % 2===0 && !PL.noLine) poly([isoPt(G0 + 1.9, gy + .2), isoPt(G0 + 2, gy + .2), isoPt(G0 + 2, gy + .8), isoPt(G0 + 1.9, gy + .8)], '#ffd25a');
  }
  // 石壆
  poly([isoPt(G0 + 1, 0), isoPt(G0 + 1.1, 0), isoPt(G0 + 1.1, GY), isoPt(G0 + 1, GY)], '#8d9aa2');
}
/* ---- 村口冰室：白牆、罐頭架、相片牆、紅字橫額、門口趟閘同玻璃櫃（原創，唔用真實店名） ---- */
// 城寨冰室：牆上一堆電線水喉、魚缸、紅色霓虹「冰室」、舊月曆
export function drawWalledWalls(W: number, now: number): void {
  for (let k = 0; k < 4; k++){ const a = isoPt(0, 0, W - 6 - k * 4), b = isoPt(ISO.GX, 0, W - 8 - k * 3); line(a, b, String(['#2b2b2b', '#5d6870', '#3a3a3a', '#7a5a3a'][k])); }
  for (let k = 0; k < 3; k++){ const a = isoPt(0, 0, W - 8 - k * 5), b = isoPt(0, ISO.GY, W - 6 - k * 4); line(a, b, String(['#2b2b2b', '#5d6870', '#3a3a3a'][k])); }
  const pp = isoPt(0, 2, 0); P(pp.x - 2, pp.y - W, 3, W, '#8d9aa2');   // 水喉直落
  const ng = isoPt(2.4, 0, W - 22), on = Math.floor(now / 1300) % 9;
  P(ng.x - 1, ng.y - 1, 30, 14, '#1b1b2a'); if (on) { P(ng.x + 2, ng.y + 2, 24, 8, 'rgba(255,90,90,.25)'); }
  walledNeon = { p: ng, on };
  const tk = isoPt(6.4, 0, 26); P(tk.x - 1, tk.y - 1, 22, 16, INK); P(tk.x, tk.y, 20, 14, '#4a8ab8');   // 魚缸
  for (let k = 0; k < 2; k++){ const fx = Math.round((now / 40 + k * 70) % 18); P(tk.x + fx, tk.y + 4 + k * 5, 3, 2, k ? '#ffd25a' : '#f27a2a'); }
  const cal = isoPt(0, 5, 52); P(cal.x - 8, cal.y, 9, 12, '#fbfaf4'); P(cal.x - 7, cal.y + 1, 7, 3, '#c8323c');
}
export let walledNeon: { p: IsoPt; on: number } | null = null;
export let bingBanner: IsoChar[] = [];
// 奶公司後牆：黃底大招牌（字喺高解像嗰層寫）、左牆一排光管
export let dairySign: IsoChar[] | null = null;
export function drawDairyWall(W: number): IsoChar[] {
  const x0 = 1.2, x1 = ISO.GX - 1.2, a = isoPt(x0, 0, W - 12), b = isoPt(x1, 0, W - 12);
  poly([{ x:a.x, y:a.y - 2 }, { x:b.x, y:b.y - 2 }, { x:b.x, y:b.y + 16 }, { x:a.x, y:a.y + 16 }], '#7a5a1a');
  poly([a, b, { x:b.x, y:b.y + 14 }, { x:a.x, y:a.y + 14 }], '#ffe23a');
  line({ x:a.x, y:a.y + 13 }, { x:b.x, y:b.y + 13 }, '#e0b820');
  for (let k = 0; k < 3; k++){ const p = isoPt(0, 1.2 + k * 2.6, W - 30); P(p.x - 9, p.y, 9, 2, '#fbfaf4'); }
  const txt = Array.from(must(fixedShop, 'fixedShop').signText || '奶公司');   // Array.from(string) = [...string]: code points
  return txt.map((ch, i) => ({ ch, p: isoPt(x0 + .5 + i * (x1 - x0 - 1) / Math.max(1, txt.length - 1), 0, W - 19) }));
}
export function drawBingWalls(W: number): void {
  // 後牆（短）：紅字橫額
  const a = isoPt(0, .4, W - 10), b = isoPt(0, ISO.GY - .4, W - 10);
  poly([a, b, { x:b.x, y:b.y + 18 }, { x:a.x, y:a.y + 18 }], '#f6f4ee'); line(a, b, '#cfc7b8');
  bingBanner = Array.from(must(fixedShop, 'fixedShop').signText || '村口冰室').map((ch, i, arr) => ({ ch, p: isoPt(0, ISO.GY - .9 - i * (ISO.GY - 1.8) / Math.max(1, arr.length - 1), W - 19) }));
  // 長牆：一排罐頭、相片牆、鐘
  for (let r = 0; r < 3; r++) for (let k = 0; k < 9; k++){ const p = isoPt(.6 + k * .32, 0, 54 - r * 7); P(p.x, p.y, 5, 6, INK); P(p.x + 1, p.y + 1, 3, 4, String(['#d9473f', '#e9a21a', '#c8323c'][(k + r) % 3])); P(p.x + 1, p.y + 2, 3, 1, '#f6dcae'); }
  const sh = isoPt(.5, 0, 34); line(sh, isoPt(3.6, 0, 34), '#8a5a2b');
  for (let k = 0; k < 12; k++){ const p = isoPt(4.6 + (k % 4) * .55, 0, 62 - Math.floor(k / 4) * 9); P(p.x, p.y, 7, 7, '#5a4a3a'); P(p.x + 1, p.y + 1, 5, 5, String(['#c9b89a', '#9fb0c0', '#d8b8a0', '#a8b890'][k % 4])); }
  const ck = isoPt(8.6, 0, 66); el(ck.x, ck.y, 5, 5, '#fbfaf4'); P(ck.x, ck.y - 3, 1, 3, INK); P(ck.x, ck.y, 3, 1, INK);
  // 招財貓同神枱（長牆近門口）
  const sh2 = isoPt(9.6, 0, 40); P(sh2.x - 6, sh2.y, 14, 3, '#c8323c'); P(sh2.x - 2, sh2.y - 6, 5, 6, '#fbfaf4'); P(sh2.x - 1, sh2.y - 4, 1, 1, INK);
}
// (The JS also read an unused GY = ISO.GY here; dropped as dead code.)
export function drawBingFront(_now: number, S: number, t: CanvasRenderingContext2D): void {
  const G0 = ISO.GX, dr: [number, number] = must(fixedShop, 'fixedShop').door || [2, 4];
  // 門口兩邊趟閘：銀色一摺摺，有花紋窿
  ([[dr[0] - .75, dr[0]], [dr[1], dr[1] + .75]] satisfies [number, number][]).forEach(([y0, y1]) => {
    for (let y = y0; y < y1 - .01; y += .25){ const q = [isoPt(G0, y, 0), isoPt(G0, y + .25, 0), isoPt(G0, y + .25, 46), isoPt(G0, y, 46)];
      poly(q, (y * 4) % 2 < 1 ? '#c9d1d6' : '#a9b4ba'); const m = isoPt(G0, y + .12, 32); P(m.x - 1, m.y, 2, 2, '#5d6870'); P(m.x - 1, m.y + 8, 2, 2, '#5d6870'); }
  });
  // 鐵皮簷篷
  for (let y = dr[0] - 1; y < dr[1] + 1; y += .3) poly([isoPt(G0 + .1, y, 64), isoPt(G0 + .1, y + .3, 64), isoPt(G0 + 1.1, y + .3, 56), isoPt(G0 + 1.1, y, 56)], Math.round(y / .3) % 2 ? '#b9c3c9' : '#8d9aa2');
  // 橫招牌：銀灰色板，紅字（寫「村口冰室」）
  const s0 = isoPt(G0 + .02, dr[1] + .3, 62), s1 = isoPt(G0 + .02, dr[0] - .3, 62);
  poly([s0, s1, { x:s1.x, y:s1.y + 14 }, { x:s0.x, y:s0.y + 14 }], INK);
  poly([{ x:s0.x + 1, y:s0.y + 1 }, { x:s1.x - 1, y:s1.y + 1 }, { x:s1.x - 1, y:s1.y + 13 }, { x:s0.x + 1, y:s0.y + 13 }], '#c9cfd2');
  const txt = Array.from(must(fixedShop, 'fixedShop').signText || '村口冰室');
  t.font = `900 ${Math.round(12 * S)}px "Noto Serif HK", serif`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillStyle = '#8a2a20';
  bingBanner.forEach(({ ch, p }) => { t.fillText(ch, p.x * S, p.y * S); });
  t.font = `900 ${Math.round(10 * S)}px "Noto Serif HK", serif`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillStyle = '#d0302a';
  txt.forEach((ch, i) => { const p = isoPt(G0 + .02, dr[1] + .2 - (i + .5) * (dr[1] - dr[0] + .4) / txt.length, 55); t.fillText(ch, p.x * S, p.y * S); });
  // 門口玻璃櫃（入面有茶壺同杯）
  isoBox(G0 - .9, dr[1] + .1, .7, 1, 20, '#e6f4f8', '#bcd9e2', '#a9c8d4');
  const gp = isoPt(G0 - .55, dr[1] + .6, 10); P(gp.x - 3, gp.y - 3, 6, 5, '#fbfaf4'); P(gp.x - 2, gp.y - 2, 4, 1, '#3d7fbf');
}
// 背景：舊香港唔同地方（全部原創剪影，唔畫真實招牌）
export const hsh = (n: number): number => { n = Math.imul(n ^ 0x9e3779b9, 2654435761); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
export function drawBackdrop(place: string | undefined, _now: number, LW: number, hy: number): void {
  if (!place || hy < 10) return;
  if (place==='pl-town'){
    // 普通街：黃昏天，一排唐樓，有啲招牌（全部冇字）
    P(0, 0, LW, hy, '#f2c48a'); P(0, 0, LW, hy * .45, '#e9a86a');
    for (let x = -4, i = 0; x < LW; i++){ const w = 16 + Math.floor(hsh(i + 300) * 14), h = hy * (.45 + hsh(i + 320) * .35), col = String(['#d9cdb4', '#c9b8a0', '#e0d0c0', '#b8c0b0'][i % 4]);
      P(x, hy - h, w, h, col); for (let wy = hy - h + 4; wy < hy - 6; wy += 6) for (let wx = x + 2; wx < x + w - 3; wx += 5) P(wx, wy, 3, 3, hsh(i * 31 + wx + wy) < .25 ? '#ffd25a' : '#6a7a7a');
      if (hsh(i + 340) < .6){ const sw = 6 + Math.floor(hsh(i + 360) * 6); P(x + w - 2, hy - h * .6, sw, 14, String(['#c8323c', '#2a8b67', '#3d7fbf', '#e9a21a'][i % 4])); }
      x += w - 1; }
    return;
  }
  if (place==='pl-island' || place==='pl-haunt'){
    // 長洲萬聖夜：紫黑夜空、大月光、遠山、海上漁火、蝙蝠
    for (let y = 0; y < hy; y += 2){ const t = y / hy; P(0, y, LW, 2, t < .4 ? '#1a1430' : t < .7 ? '#2a1e44' : '#3a2850'); }
    el(LW * .25, hy * .28, 13, 13, '#fff0c0', null); el(LW * .25, hy * .28, 10, 10, '#ffe090', null);
    for (let k = 0; k < 5; k++){ const x = hsh(k + 1100) * LW, y = hy * (.12 + hsh(k + 1110) * .35); P(x - 3, y, 3, 1, '#0a0812'); P(x + 1, y, 3, 1, '#0a0812'); P(x, y + 1, 1, 1, '#0a0812'); }
    const sea = Math.round(hy * .72); for (let x = 0; x < LW; x += 2){ const m = Math.sin(x / 26) * 5 + Math.sin(x / 9) * 2; P(x, sea - 8 - m, 2, 8 + m, '#221a34'); }
    P(0, sea, LW, hy - sea, '#16283a'); for (let y = sea + 2; y < hy; y += 3) P(0, y, LW, 1, '#1e3448');
    for (let k = 0; k < 6; k++){ const x = hsh(k + 1120) * LW, y = sea + 3 + hsh(k + 1130) * (hy - sea - 5); P(x, y, 2, 1, '#ffd25a'); P(x, y + 2, 2, 1, '#806020'); }
    return;
  }
  if (place==='pl-jordan'){
    // 佐敦夜晚：紫藍天，遠處唐樓燈火同霓虹光暈
    for (let y = 0; y < hy; y += 2){ const t = y / hy; P(0, y, LW, 2, t < .4 ? '#1e1a3a' : t < .7 ? '#3a2a5a' : '#6a3a6a'); }
    for (let x = -4, i = 0; x < LW; i++){ const w = 14 + Math.floor(hsh(i + 800) * 14), h = hy * (.4 + hsh(i + 820) * .4);
      P(x, hy - h, w, h, String(['#2e2a40', '#3a3450', '#28243a'][i % 3])); for (let wy = hy - h + 4; wy < hy - 4; wy += 6) for (let wx = x + 2; wx < x + w - 3; wx += 5) if (hsh(i * 17 + wx + wy) < .35) P(wx, wy, 2, 2, '#ffd27a');
      if (hsh(i + 840) < .7) P(x + 2, hy - h * .5, 5, 10, String(['#ff4a8a', '#4ae0ff', '#ff5a3a', '#ffe04a'][i % 4]));
      x += w - 1; }
    return;
  }
  if (place==='pl-central'){
    // 中環日頭：藍天，一排高高嘅玻璃幕牆商廈
    P(0, 0, LW, hy, '#9cc8ec'); P(0, 0, LW, hy * .4, '#7ab0e0');
    for (let x = -6, i = 0; x < LW; i++){ const w = 18 + Math.floor(hsh(i + 900) * 16), h = hy * (.55 + hsh(i + 920) * .45), col = String(['#6f8fae', '#5a7a9a', '#8aa8c4', '#7a90a0'][i % 4]);
      P(x, hy - h, w, h, col); for (let wy = hy - h + 3; wy < hy; wy += 4) P(x + 1, wy, w - 2, 1, '#a8c4dc');
      if (i % 3===0){ P(x + w / 2 - 1, hy - h - 8, 2, 8, '#5d6870'); }
      x += w + Math.floor(hsh(i + 940) * 6); }
    return;
  }
  if (place==='pl-walled'){
    // 九龍城寨：夜色（樓宇喺 walledCity 立體畫）
    for (let y = 0; y < hy; y += 2) P(0, y, LW, 2, y < hy * .5 ? '#1e2230' : '#2b2f3a');
    for (let k = 0; k < 20; k++) P(hsh(k + 700) * LW, hsh(k + 720) * hy * .5, 1, 1, '#e6ecef');
  } else if (place==='pl-rainbow'){
    // 彩虹邨（跟相）：藍天白雲，兩座長形大廈，每層粉紫、粉藍、米白、黃、橙一段段，中間紅色通花樓梯
    P(0, 0, LW, hy, '#8fc4ee');
    for (let k = 0; k < 6; k++){ const cx = hsh(k + 500) * LW, cy = hsh(k + 520) * hy * .3; el(cx, cy, 14 + hsh(k) * 10, 3, '#e6f2fb', null); }
    // 大廈而家係立體（drawGround 入面嘅 isoSlab），背景淨係天
  } else if (place==='pl-estate'){
    // 華富邨日落（跟相）：橙紅天、太陽落海、遠山小島，前面一排排長形公屋（灰白牆、粉色彩帶、紅色天台）
    for (let y = 0; y < hy; y += 2){ const t = y / hy; P(0, y, LW, 2, t < .25 ? '#6a6a9a' : t < .45 ? '#c88a8a' : t < .6 ? '#f2a060' : '#f6c070'); }
    for (let k = 0; k < 5; k++){ const cx = hsh(k + 600) * LW, cy = hy * (.12 + hsh(k + 620) * .25); el(cx, cy, 22 + hsh(k) * 18, 3, k % 2 ? '#e88a6a' : '#5a4a6a', null); }
    const sea = Math.round(hy * .58); P(0, sea, LW, hy - sea, '#d88a5a'); for (let y = sea + 2; y < hy; y += 3) P(0, y, LW, 1, '#e8a070');
    el(LW * .3, sea, 7, 7, '#ffd25a', null); P(LW * .3 - 14, sea + 2, 28, 1, '#fff0a0'); P(LW * .22, sea + 5, 10, 2, '#3a2a3a');   // 太陽
    for (let x = 0; x < LW; x += 2){ const m = Math.sin(x / 30) * 4 + Math.sin(x / 11) * 2; P(x, sea - 6 - m, 2, 6 + m, '#7a5a7a'); }   // 遠山
    const slab = (x0: number, w: number, top: number, col: string, band: string): void => { P(x0, top, w, hy - top, col); P(x0, top - 2, w, 2, '#8a3a2a');
      for (let y = top + 3; y < hy - 2; y += 4){ P(x0 + 1, y, w - 2, 1, '#6a6a72'); for (let x = x0 + 2; x < x0 + w - 2; x += 4) P(x, y + 1, 2, 2, hsh(x * 7 + y) < .2 ? '#ffd25a' : '#4a4a5a'); }
      if (band) for (let y = top + 6; y < hy - 4; y += 12) P(x0 + Math.round(w * .2), y, Math.round(w * .3), 6, band); };
    // 左邊留海景同太陽，樓集中喺右邊同前面
    slab(0, Math.round(LW * .16), Math.round(hy * .66), '#d8d0c8', '#e8a0b4');
    slab(Math.round(LW * .5), Math.round(LW * .22), Math.round(hy * .5), '#e0d8cc', '#a9c8e4');
    slab(Math.round(LW * .76), Math.round(LW * .24), Math.round(hy * .3), '#e8d8a0', '#f0b080');
    slab(Math.round(LW * .38), Math.round(LW * .3), Math.round(hy * .78), '#d0c8c0', '#c9b4e0');
  } else if (place==='pl-village'){
    // 茶果嶺村（跟相）：藍天、遠處高樓同海、左邊綠油油山、前面一大片紅鏽同灰色鐵皮屋頂
    P(0, 0, LW, hy, '#a9cdee'); P(0, 0, LW, hy * .3, '#8fbde8');
    for (let i = 0; i < 9; i++){ const x = Math.round(LW * .35 + i * LW * .055), h = Math.round(hy * (.25 + hsh(i + 200) * .3)); P(x, hy * .62 - h, 8, h, String(['#b8c4cc', '#9aa8b2', '#c9d1d6'][i % 3])); for (let wy = hy * .62 - h + 2; wy < hy * .62; wy += 3) P(x + 2, wy, 4, 1, '#7a8a96'); }
    P(LW * .55, hy * .6, LW * .45, hy * .1, '#6a9ec4');                       // 海
    for (let k = 0; k < 3; k++){ const x = Math.round(LW * (.62 + k * .1)); P(x, hy * .38, 1, hy * .24, '#3a8a9a'); P(x - 6, hy * .38, 8, 1, '#3a8a9a'); }   // 吊臂
    for (let x = 0; x < LW * .6; x += 2){ const top = hy * (.2 + x / LW * .7) + Math.sin(x / 9) * 3; P(x, top, 2, hy, (x / 2) % 3 ? '#3f8a3c' : '#4f9a4a'); }   // 山
    // 密密麻麻嘅鐵皮屋頂（後排細、前排大），紅鏽、灰白、間中藍色帆布
    for (let row = 0; row < 8; row++){ const sc = .55 + row * .09, y0 = Math.round(hy * (.5 + row * .065));
      for (let i = 0, x = -8 - (row % 2) * 9; x < LW + 8; i++){
        const n = row * 40 + i, w = Math.round((16 + hsh(n) * 14) * sc), rh = Math.round((6 + hsh(n + 3) * 4) * sc), y = y0 + Math.round(hsh(n + 7) * 4);
        if (row < 3 && hsh(n + 11) < .25){ el(x + w / 2, y, w / 2, 5, '#3f8a3c', null); x += w; continue; }
        const r = hsh(n + 17), roof: [string, string, string] = r < .45 ? ['#9a4a32', '#b0583a', '#7a3a28'] : r < .9 ? ['#c9d1d6', '#aab4ba', '#8d9aa2'] : ['#3d7fbf', '#5a9ad4', '#2f6aa3'];
        P(x, y + rh, w, Math.round(5 * sc), String(['#d9d2c4', '#c9c0b0', '#a8a090'][n % 3]));           // 牆
        for (let k = 0; k < rh; k++) P(x + k * .5, y + k, w, 1, String(roof[k % 2]));                       // 斜屋頂
        for (let k = 2; k < w; k += 3) P(x + k, y + 1, 1, rh - 1, roof[2]);                          // 坑紋
        if (hsh(n + 23) < .35) P(x + 2, y + rh + 1, 2, 2, '#3a4a5a');
        x += w - 2;
      } }
  }
}
export function drawFront(now: number, S: number, t: CanvasRenderingContext2D): void {
  const G0 = ISO.GX, GY = ISO.GY, aw = AWNINGS[String(decorLook('awning'))], sg = SIGNS[String(decorLook('sign'))] || SIGNS['sg-red'];
  // 簷篷：喺門口上面，伸出行人路
  if (aw && aw.a) for (let k = 0; k < 8; k++){
    const y0 = GY - 3.2 + k * .35, y1 = y0 + .35;
    poly([isoPt(G0 + .05, y0, 16), isoPt(G0 + .05, y1, 16), isoPt(G0 + 1, y1, 10), isoPt(G0 + 1, y0, 10)], String(k % 2 ? aw.a : aw.b));
    poly([isoPt(G0 + 1, y0, 10), isoPt(G0 + 1, y1, 10), isoPt(G0 + 1, y1, 6), isoPt(G0 + 1, y0, 6)], String(k % 2 ? aw.b : aw.a));   // 垂邊
  }
  // 直招牌：由牆頂伸出嚟，寫住舖名
  const name = fixedShop && fixedShop.signText ? fixedShop.signText : fixedShop && G && G.level && LEVELS[G.level] ? must(LEVELS[G.level], 'level').name : (typeof shopName==='function' ? shopName() : '我的茶餐廳');
  const chars = Array.from(name).slice(0, 6), gy = 1.4, zt = ISO.WALL - 4, h = 12 * chars.length + 8, zb = zt - h;
  line(isoPt(G0, gy, zt - 4), isoPt(G0 + .2, gy, zt - 4), INK);
  const pts: [IsoPt, IsoPt, IsoPt, IsoPt] = [isoPt(G0 + .2, gy, zt), isoPt(G0 + 1.05, gy, zt), isoPt(G0 + 1.05, gy, zb), isoPt(G0 + .2, gy, zb)];
  poly(pts.map(p => ({ x: p.x - 1, y: p.y - 1 })), INK); poly(pts, must(sg, 'sign look').bg);
  const flick = must(sg, 'sign look').neon && Math.floor(now / 900) % 7===0;
  // 齊咗嘅套裝：門口掛燈籠；五套齊晒招牌發金光
  const done = fixedShop ? [] : setsDone(), gold = done.length===Object.keys(SETS_DECOR).filter(k => !must(SETS_DECOR[k], 'set ' + k).limited).length;
  done.forEach((k, i) => { const p = isoPt(G0 + .9, GY - 3.4 + i * .65, 24), sw = Math.round(Math.sin(now / 500 + i) * 1);
    P(p.x, p.y - 6, 1, 6, INK); el(p.x + sw, p.y + 3, 4, 5, must(SETS_DECOR[k], 'set ' + k).lantern, INK); P(p.x + sw - 2, p.y + 1, 4, 1, 'rgba(255,255,255,.5)'); P(p.x + sw, p.y + 8, 1, 3, '#ffd25a'); });
  if (gold) for (let k = 0; k < 6; k++){ const a = (now / 700 + k / 6) % 1; P(pts[0].x + (k * 7) % 14, pts[0].y + a * (pts[3].y - pts[0].y), 1, 1, '#fff6a8'); }
  const c = isoPt(G0 + .62, gy, zt - 9);
  t.font = `900 ${Math.round(11 * S)}px "Noto Serif HK", serif`; t.textAlign = 'center'; t.textBaseline = 'middle';
  if (gold){ t.shadowColor = '#ffd25a'; t.shadowBlur = 10 * S; }
  else if (done.length){ t.shadowColor = '#ffe9a8'; t.shadowBlur = 3 * S * done.length; }
  if (must(sg, 'sign look').neon && !flick){ t.shadowColor = must(sg, 'sign look').fg; t.shadowBlur = 8 * S; }
  t.fillStyle = flick ? '#5a3a4a' : must(sg, 'sign look').fg;
  chars.forEach((ch, i) => { t.fillText(ch, c.x * S, (c.y + i * 12) * S); });
  t.shadowBlur = 0;
}
// 吊扇：一條棍吊住，四塊葉慢慢轉（iso 壓扁咗）
export function ceilingFan(c: IsoPt, now: number): void {
  const x = Math.round(c.x), y = Math.round(c.y), a = now / 380;
  P(x - 1, y - 14, 2, 14, '#3c454d');
  for (let k = 0; k < 4; k++){
    const th = a + k * Math.PI / 2, dx = Math.cos(th), dy = Math.sin(th) * .5;
    for (let r = 3; r < 15; r++) P(Math.round(x + dx * r) - 1, Math.round(y + dy * r) - 1, 3, 2, r > 12 ? '#3f2a1a' : '#6a4a2a');
  }
  el(x, y, 4, 2, '#c9d1d6', INK);
}
// 頭頂泡泡：方形加個尾
export function bubble(t: CanvasRenderingContext2D, x: number, y: number, ch: string, bg: string, fg: string, S: number): void {
  const s = S >= 4 ? 22 : 18;
  t.fillStyle = INK; t.fillRect(x - s / 2 - 2, y - s - 2, s + 4, s + 4); t.fillRect(x - 3, y, 6, 4);
  t.fillStyle = bg; t.fillRect(x - s / 2, y - s, s, s); t.fillRect(x - 1, y, 2, 2);
  t.font = `900 ${s - 6}px "Noto Sans HK", sans-serif`; t.fillStyle = fg; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillText(ch, x, y - s / 2 + 1);
}
FSC.tv.addEventListener('pointerdown', e => {
  if (decorMode){ decorTap(e); return; }
  if (!G || G.station!=='waiter') return;
  if (mapDrawn){ mapDown(e); return; }
  // 枱同枱喺等角畫面互相疊住，舊嘅長方形撳位會搶嚟搶去（玩家：入客好難撳啱枱）。
  // 改為：撳落去嘅位置離邊張枱面中心最近就揀邊張（橫向放寬啲，因為枱係扁嘅），太遠就當撳空。
  const r = FSC.tv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  let best = -1, bd = 1e9;
  isoAnchors.forEach((a, id) => { if (!a) return; const d = Math.hypot((px - a.nx) * .8, py - a.ny); if (d < bd){ bd = d; best = id; } });
  if (best >= 0 && bd <= 46 * (FSC.S || 1)){ HOOK.tapTable(best); return; }
  HOOK.deselect();
});
mapBind(FSC, () => { if (G && mapDrawn) drawFloorIso(performance.now()); });
/* ===================== 伙記：每張枱嘅俯視像素畫（舊，留作後備） ===================== */
// (The JS also set an unused x0 = 0 here; dropped as dead code.)
export function drawTableSprite(cv: HTMLCanvasElement, tb: TableState, gs: Group[]): void {
  const cap = tb.cap, W = cap===4 ? 34 : 22, H = 18;
  cv.width = W; cv.height = H; setPX(cv.getContext('2d')); must(PX, 'PX').imageSmoothingEnabled = false;
  must(PX, 'PX').clearRect(0, 0, W, H);
  // 卡位：上下兩條長櫈；細枱：上下各一張櫈
  const benchCol = tb.kind==='booth' ? '#a5372f' : '#7a5a3a';
  P(1, 0, W - 2, 4, INK); P(2, 0, W - 4, 3, benchCol);
  P(1, H - 4, W - 2, 4, INK); P(2, H - 3, W - 4, 3, benchCol);
  P(2, 5, W - 4, 8, INK); P(3, 6, W - 6, 6, '#f3e5b2'); P(3, 6, W - 6, 1, '#fff6cf');
  // 座位：上排先，下排後
  const per = cap / 2, slotW = (W - 4) / per, seats: { x: number; top: boolean }[] = [];
  for (let r = 0; r < 2; r++) for (let k = 0; k < per; k++) seats.push({ x: Math.round(2 + k * slotW + slotW / 2 - 3), top: r===0 });
  let si = 0;
  gs.forEach(g => { for (let n = 0; n < g.size && si < seats.length; n++, si++){
    const s = must(seats[si], 'seat'), y = s.top ? 0 : H - 6;
    P(s.x, y, 6, 6, INK); P(s.x + 1, y + 1, 4, 4, g.color); P(s.x + 1, s.top ? y + 1 : y + 3, 4, 2, '#2b2b2b');
    const ty = s.top ? 7 : 9;
    if (g.state==='eat'){ P(s.x + 1, ty, 4, 3, '#fbfaf4'); P(s.x + 2, ty + 1, 2, 1, '#e9a24a'); }
    if (g.state==='order' && !(!g.take && g.taken)){ P(s.x + 2, s.top ? 6 : H - 9, 2, 2, '#c8323c'); }
  } });
  for (let n = 0; n < tb.dirty && si < seats.length; n++, si++){ const s = must(seats[si], 'seat'), ty = s.top ? 7 : 9; P(s.x, ty, 5, 3, '#fbfaf4'); P(s.x, ty, 5, 1, '#8a9a92'); P(s.x + 1, ty + 1, 1, 1, '#a0784a'); }
}
export function openKitRecipe(): void {
  if (!G || !G.running) return;
  G.board = true;
  const rows: [string, string][] = G.slot==='breakfast'
    ? [['A餐 / B餐 / C餐 / 常餐', '火腿 / 餐肉 / 沙嗲牛 / 叉燒'], ['粉麵、蛋', '跟張飛寫嘅落煲、落鑊煎'], ['包', '多士要放多士爐烘；餐包直接放，叫咗烘底先放多士爐'], ['搽', '牛油；奶油多士搽奶油'], ['飛邊', '有寫先放']]
    : G.slot==='lunch' ? [...Object.entries(LUNCH_R).filter(([d]) => menuOpen('f:' + d)).map(([d, r]): [string, string] => [d, r.join(' ＋ ')]), ...(HAT_OK.some(f => menuOpen('f:' + f)) ? [['加頂帽', '多放一隻煎蛋'] satisfies [string, string]] : [])]
    : [['有汁嘅飯', '落鑊炒好上碟，再放飯'], ['炒底', '飯落鑊一齊炒，唔使另外放飯'], ['揚州、鹹魚雞粒炒飯', '飯一定要落鑊'], ['加底', '兩份飯（落鑊就落兩下）'], ['咖喱牛腩', '煲 ＋ 飯'], ['焗豬扒飯', '焗爐，唔使落蔥'], ['蔥', '每碟都落，走青就唔落']];
  must($('board'), 'board').innerHTML = `<div class="sh-head"><b>做法</b><span>廚房 · ${SLOTS[G.slot].name}</span></div>
    <table class="board">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
    <p class="hint">煲同煎「得」咗之後幾秒就會燶，燶咗要倒咗重新整。鑊要撳「炒」${CFG.stirs} 下。</p>
    <button type="button" class="big" id="boardClose">返回</button>`;
  must($('boardWrap'), 'boardWrap').hidden = false; must($('boardClose'), 'boardClose').focus();
}
