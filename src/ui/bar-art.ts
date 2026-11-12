// 水吧像素畫
// TypeScript port of the original game's bar-art.js, as an ES module: every
// top-level name is exported.
import './pixel';   // load order: src/entry.ts
import { HOOK } from './hooks';
import { G } from '../core/state';
import { must } from '../core/util';
import { ingShown, pullsNeed } from '../core/rules/recipes';
import { ING } from '../core/data/menus';
import { P, kitMode, INK, bx, el } from './kitchen';
import { makeScene, beginScene, PX, chipT, hitAt } from './pixel';
import { ingIcon } from './icons';
import { potCap } from './sets';

/* ===================== 水吧像素畫（高像素） ===================== */
export const BSC = makeScene('bscene');
export function cupColor(ing: Record<string, number>): string | null {
  if (ing.阿華田) return ing.淡奶 ? '#b8875a' : '#8a5a2e';
  if (ing.茶 && ing.咖啡) return '#8a5a3a';
  if (ing.茶 && ing.淡奶) return '#c48a5a';
  if (ing.茶) return '#9a4a1a';
  if (ing.咖啡) return '#3a2a1a';
  if (ing.淡奶) return '#f6efe0';
  if (ing.水) return '#dff1f6';
  return null;
}
export function wallHi(LW: number, LH: number): void {
  P(0, 0, LW, LH, '#b2d2c3');
  for (let y = 0; y < LH; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < LW; x += 6) P(x, y, 5, 5, (x * 7 + y * 3) % 11 ? '#d6ebe1' : '#c3e0d2');
}
export function drawBar(now: number): void {
  if (!G || G.station!=='bar') return;
  const counter = kitMode==='counter', sc = BSC, S = Math.max(1.3, Math.min(3.2, Math.min(sc.W / 170, sc.H / (counter ? 200 : 120))));
  beginScene(sc, S); const LW = sc.LW, LH = sc.LH, t = must(sc.t, 'bar text context'), b = G.bench, p = G.pot;
  wallHi(LW, LH);
  const cy = LH - 22;
  // 吊牌
  const sgW = Math.min(LW - 16, 128), sgx = Math.round((LW - sgW) / 2), shy = cy - 104, sgy = counter ? 6 : Math.max(6, Math.round((shy - 26) / 2));
  P(sgx + 12, 0, 2, sgy, INK); P(sgx + sgW - 14, 0, 2, sgy, INK);
  bx(sgx, sgy, sgW, 26, '#7a1f1f', '#a5372f', '#5a1414'); P(sgx + 3, sgy + 3, sgW - 6, 1, '#c84e44');
  // 枱面版：層架上嘅材料同枱面上嘅杯，直接撳
  if (counter){
    const its = ingShown(), per = its.length > 4 ? Math.ceil(its.length / 2) : its.length   /* 固定每行幾多，唔好隨畫面高度變而重排 */, iw = (LW - 4) / Math.min(per, its.length), y1 = sgy + 32;
    its.forEach((name, k) => {
      const r = Math.floor(k / per), x = Math.round(2 + (k % per) * iw), y = y1 + r * 32;
      if (k % per===0) bx(-1, y + 22, LW + 2, 5, '#8a5a2b', '#b07a44', null);
      must(PX, 'PX').save(); must(PX, 'PX').translate(Math.round(x + iw / 2 - 13), y + 2); ingIcon(name); must(PX, 'PX').restore();
      sc.hits.push({ kind:'ing', k:name, x: x * S, y: (y - 2) * S, w: iw * S, h: 32 * S, lx: (x + iw / 2) * S, ly: (y + 31) * S, name });
    });
    // 杯：熱杯一疊、凍杯一疊
    const cx0 = LW - 46, cy0 = cy - 26;
    for (let k = 0; k < 3; k++){ bx(cx0, cy0 + 4 + k * 7, 18, 8, '#fbfaf4', '#ffffff', '#dfe7ea'); P(cx0 + 1, cy0 + 5 + k * 7, 16, 1, '#c8323c'); }
    for (let k = 0; k < 3; k++) bx(cx0 + 24, cy0 + k * 8, 16, 12, '#e6f4f8', '#ffffff', '#bcd9e2');
    sc.hits.push({ kind:'cup', k:'hot', x: (cx0 - 2) * S, y: (cy0 - 2) * S, w: 22 * S, h: 30 * S, lx: (cx0 + 9) * S, ly: (cy0 - 6) * S, name:'熱杯' });
    sc.hits.push({ kind:'cup', k:'cold', x: (cx0 + 22) * S, y: (cy0 - 2) * S, w: 22 * S, h: 30 * S, lx: (cx0 + 32) * S, ly: (cy0 - 6) * S, name:'凍杯' });
  } else {
  // 層架同材料
  bx(-1, shy + 22, LW + 2, 5, '#8a5a2b', '#b07a44', null);
  const sx = Math.max(78, LW - 108);
  bx(sx, shy + 4, 12, 18, '#f6efe0', '#ffffff'); P(sx + 1, shy + 9, 10, 5, '#c8323c'); P(sx + 3, shy + 10, 6, 1, '#ffffff');
  bx(sx + 18, shy, 14, 22, '#3a2a1a', '#5a4030'); bx(sx + 31, shy + 6, 5, 7, '#2b2b2b'); P(sx + 20, shy - 2, 10, 3, INK);
  el(sx + 50, shy + 17, 12, 5, '#c9d1d6'); ([[-6, 12], [0, 10], [6, 12], [-2, 14]] as const).forEach(([a, c]) => { el(sx + 50 + a, shy + c, 4, 3, '#ffe14a', '#c8a020'); });
  bx(sx + 68, shy + 2, 12, 20, '#eef6f8', '#ffffff'); P(sx + 69, shy + 12, 10, 9, '#ffffff'); P(sx + 70, shy, 8, 3, INK);
  if (sx + 108 <= LW){ bx(sx + 86, shy + 8, 20, 14, '#b7c1c8', '#e6ecef', '#8d99a1'); ([[2, 4], [8, 2], [14, 4]] as const).forEach(([a, c]) => { bx(sx + 86 + a, shy + c, 5, 5, '#bfe3ff', '#ffffff'); }); }
  }
  // 水吧枱
  bx(-1, cy, LW + 2, LH - cy + 1, '#4b555d', '#9aa6ad', null); P(0, cy + 4, LW, 1, '#2b3036');
  // 茶膽
  const px = 12, top = cy - 62, lvl = p.st==='ready' ? p.level / potCap() : 0;
  if (p.st==='boil' || p.st==='steep'){ for (let k = 0; k < 6; k++){ const h = 4 + ((Math.floor(now / 110) + k) % 3); P(px + 8 + k * 9, cy - h, 3, h, '#5fa0ff'); P(px + 9 + k * 9, cy - h - 2, 1, 3, '#ffb347'); } }
  bx(px - 4, top - 4, 64, 7, '#6f7b85', '#a4afb7'); bx(px + 24, top - 10, 8, 7, '#3c454d');
  bx(px, top, 56, 58, '#8d99a1', '#c9d1d6', '#6f7b85'); P(px + 4, top + 3, 6, 52, '#b7c1c8'); P(px + 6, top + 3, 1, 52, '#e6ecef');
  bx(px + 16, top + 10, 24, 38, '#2b3036');
  const fh = Math.round(36 * lvl); if (fh){ P(px + 17, top + 47 - fh, 22, fh, '#9a4a1a'); P(px + 17, top + 47 - fh, 22, 1, '#c87a3a'); }
  bx(px + 56, top + 30, 12, 6, '#6f7b85');
  if (p.st==='pull'){ const ph = Math.floor(now / 140) % 2; bx(px + 60, top - 22, 18, 14, '#f6efe0', '#ffffff'); P(px + 62, top - 18, 14, 3, '#c8323c'); for (let k = 0; k < 14; k++) P(px + 68 + (k % 2), top - 8 + k * 3 + ph, 2, 3, '#9a4a1a'); }
  if (p.st==='boil' || p.st==='steep') for (let k = 0; k < 3; k++) for (let i = 0; i < 8; i++){ const ph = (now / 90 + k * 13) % 16; P(px + 16 + k * 12 + Math.round(Math.sin((i + now / 150 + k) / 2) * 2), top - 14 - i * 2 - ph * .5, 1, 2, `rgba(255,255,255,${(.8 - i * .09).toFixed(2)})`); }
  sc.hits.push({ kind:'pot', x: (px - 6) * S, y: (top - 26) * S, w: 90 * S, h: 92 * S });
  // 杯
  const cx = Math.round(LW * .6), ing = b.ing, col = cupColor(ing), liq = ((ing.淡奶 ?? NaN)|0) + ((ing.茶 ?? NaN)|0) + ((ing.咖啡 ?? NaN)|0) + ((ing.水 ?? NaN)|0) + ((ing.阿華田 ?? NaN)|0);
  if (b.cup==='hot'){
    const y = cy - 28;
    el(cx, cy - 3, 30, 5, '#fbfaf4', '#9aa6ad');
    bx(cx - 18, y, 36, 26, '#fbfaf4', '#ffffff', '#dfe7ea'); bx(cx + 17, y + 6, 10, 12, '#fbfaf4'); P(cx + 19, y + 9, 5, 6, '#b2d2c3');
    if (col){ const h = Math.min(18, 6 + liq * 4); P(cx - 16, y + 24 - h, 32, h, col); P(cx - 16, y + 24 - h, 32, 1, 'rgba(255,255,255,.35)'); }
    if (ing.檸檬){ el(cx - 6, y + 6, 6, 3, '#ffe14a', '#c8a020'); P(cx - 8, y + 5, 4, 1, '#fff6a8'); }
    P(cx - 16, y + 2, 32, 2, '#c8323c');
  } else if (b.cup==='cold'){
    const y = cy - 62;
    bx(cx - 18, y, 36, 62, '#e6f4f8', '#ffffff');
    if (col){ const h = Math.min(56, 14 + liq * 13); P(cx - 17, y + 61 - h, 34, h, col); P(cx - 17, y + 61 - h, 34, 1, 'rgba(255,255,255,.4)'); }
    if (ing.糖水) P(cx - 17, y + 54, 34, 7, 'rgba(255,255,255,.55)');
    if (ing.紅豆){ P(cx - 17, y + 45, 34, 16, '#7a2a2a'); for (let k = 0; k < 14; k++) P(cx - 15 + (k * 7) % 30, y + 47 + (k * 5) % 12, 3, 2, k % 3 ? '#a8383a' : '#5a1a1a'); }
    if (ing.冰) ([[-12, 12], [2, 18], [-6, 30], [6, 8], [-10, 40]] as const).forEach(([a, c]) => { bx(cx + a, y + c, 10, 10, '#bfe3ff', '#ffffff', '#8cc6ef'); });
    if (ing.檸檬){ el(cx - 7, y + 40, 7, 7, '#ffe14a', '#c8a020'); el(cx - 7, y + 40, 4, 4, '#fff6a8', null); el(cx + 7, y + 24, 7, 7, '#ffe14a', '#c8a020'); el(cx + 7, y + 24, 4, 4, '#fff6a8', null); }
    P(cx - 15, y + 2, 2, 56, 'rgba(255,255,255,.7)');
  } else {
    for (let k = 0; k < 36; k += 3){ P(cx - 18 + k, cy - 50, 2, 1, '#5d6870'); P(cx - 18 + k, cy - 2, 2, 1, '#5d6870'); }
    for (let k = 0; k < 48; k += 3){ P(cx - 18, cy - 50 + k, 1, 2, '#5d6870'); P(cx + 17, cy - 50 + k, 1, 2, '#5d6870'); }
  }
  // 字
  t.font = `900 15px "Noto Serif HK", serif`; t.fillStyle = '#ffe9a8'; t.textAlign = 'center'; t.textBaseline = 'middle';
  t.fillText('水吧 · 港式奶茶', (sgx + sgW / 2) * S, (sgy + 13) * S);
  const potTxt = p.st==='boil' ? `煲緊 ${Math.max(0, Math.ceil(p.until - G.rt))}` : p.st==='steep' ? `焗緊 ${Math.max(0, Math.ceil(p.until - G.rt))}` : p.st==='pull' ? `撳我撞茶 ${p.pulls}/${pullsNeed()}` : p.st==='empty' || p.level <= 0 ? '撳我煲茶' : `茶 ${p.level} 杯`;
  const potBg = p.st==='pull' ? (Math.floor(now / 200) % 2 ? '#ff5a5a' : '#ffd25a') : p.st==='ready' && p.level > 0 ? '#7be08f' : '#ffd25a';
  chipT(t, (px + 28) * S, (cy + 12) * S, potTxt, potBg, INK, 12);
  chipT(t, cx * S, (cy + 12) * S, b.cup==='hot' ? '熱杯' : b.cup==='cold' ? '凍杯' : '未揀杯', '#e6f1ec', INK, 12);
  sc.hits.filter((h): h is SceneHit & { name: string } => !!h.name).forEach(h => { t.font = '700 11px "Noto Sans HK", sans-serif'; t.textAlign = 'center'; t.textBaseline = 'alphabetic'; t.lineWidth = 3; t.strokeStyle = '#e6f1ec'; t.strokeText(h.name, h.lx ?? NaN, h.ly ?? NaN); t.fillStyle = INK; t.fillText(h.name, h.lx ?? NaN, h.ly ?? NaN); });
  const chips = ING.filter(i => b.ing[i]).map(i => i + ((b.ing[i] ?? NaN) > 1 ? '×' + String(b.ing[i]) : '')).join(' ');
  if (chips){ t.font = '700 11px "Noto Sans HK", sans-serif'; t.textAlign = 'left'; t.textBaseline = 'alphabetic'; t.lineWidth = 3; t.strokeStyle = '#e6f1ec'; const X = (counter ? cx - 18 : cx + 26) * S, Y = (cy - (counter ? 68 : 40)) * S; t.strokeText(chips, X, Y); t.fillStyle = INK; t.fillText(chips, X, Y); }
}
BSC.tv.addEventListener('pointerdown', e => { if (!G || G.station!=='bar') return; const h = hitAt(BSC, e); if (!h) return; if (h.kind==='pot') HOOK.barKey('pot'); else if (h.kind==='ing' || h.kind==='cup') HOOK.barKey(h.k); });
