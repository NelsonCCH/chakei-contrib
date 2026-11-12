// 掣上面嘅像素 icon：用廚房畫碟上嘢嗰套（tok）同水吧材料小圖，畫一次就記住
// TypeScript port of the original game's icons.js, as an ES module: every
// top-level name is exported.
import './till-art';   // load order: src/entry.ts
import { must } from '../core/util';
import { bx, P, el, INK, DISH_COL, tok } from './kitchen';
import { PX, setPX } from './pixel';

/* ===================== 像素 icon ===================== */
export const ICON_W = 26, ICON_H = 20, iconCache: Record<string, string> = {};
// 水吧材料：每樣一個細圖（以 13,10 做中心）
export function ingIcon(i: string): void {
  if (i==='淡奶'){ bx(7, 2, 12, 17, '#f2f2ee', '#ffffff'); P(8, 7, 10, 6, '#2a5aa8'); P(10, 9, 6, 2, '#f2f2ee'); P(8, 3, 10, 1, '#c9d1d6'); }
  else if (i==='茶'){ bx(5, 7, 15, 11, '#c9d1d6', '#eef2f4', '#9aa6ad'); P(6, 11, 13, 6, '#9a4a1a'); bx(19, 9, 5, 3, '#c9d1d6'); el(12, 6, 5, 2, '#9aa6ad'); P(11, 3, 3, 2, INK); }
  else if (i==='咖啡'){ ([[8, 7], [16, 6], [11, 14], [18, 13]] as const).forEach(([x, y]) => { el(x, y, 4, 3, '#5a3418', '#2a1608'); P(x - 2, y, 4, 1, '#2a1608'); }); }
  else if (i==='水'){ for (let r = 0; r < 6; r++) P(13 - Math.floor(r / 2), 2 + r, 1 + Math.floor(r / 2) * 2, 1, '#7cc8f0'); el(13, 12, 6, 6, '#7cc8f0', '#2a6a98'); P(10, 10, 2, 3, '#e6f6ff'); }
  else if (i==='檸檬'){ el(13, 10, 10, 7, '#ffe14a', '#c8a020'); el(13, 10, 7, 4, '#fff6a8', null); for (let k = -1; k <= 1; k++) P(13 + k * 3, 7, 1, 7, '#e9c83a'); }
  else if (i==='冰'){ bx(4, 6, 10, 10, '#bfe3ff', '#ffffff', '#8cc6ef'); bx(12, 3, 10, 10, '#bfe3ff', '#ffffff', '#8cc6ef'); }
  else if (i==='糖水'){ bx(10, 1, 6, 5, '#e8dcc0'); bx(7, 5, 12, 14, '#f6f2e6', '#ffffff'); P(8, 11, 10, 7, '#f0d890'); }
  else if (i==='紅豆'){ for (let k = 0; k < 9; k++){ const x = 5 + (k * 7) % 16, y = 4 + (k * 5) % 12; el(x, y, 3, 2, k % 3 ? '#a8383a' : '#7a2a2a', '#4a1414'); P(x - 1, y - 1, 1, 1, '#e88a8a'); } }
  else if (i==='煉奶'){ bx(7, 4, 12, 14, '#e8e8e0', '#ffffff'); P(8, 8, 10, 6, '#c8323c'); P(10, 10, 6, 2, '#fbf6e2'); el(13, 4, 6, 2, '#c9d1d6'); }
  else if (i==='阿華田'){ bx(6, 2, 14, 17, '#e07a1a', '#f4a24a', '#b85a10'); P(7, 8, 12, 5, '#f6dcae'); P(9, 10, 8, 1, '#7a3e1a'); }
}
// 主畫面：四個位嘅細圖
export function uiIcon(n: string): void {
  if (n==='waiter'){ bx(6, 1, 14, 18, '#fbfaf4', '#ffffff'); P(7, 2, 12, 2, '#c8323c'); for (let k = 0; k < 4; k++) P(8, 6 + k * 3, 9, 1, '#9aa6ad'); bx(19, 6, 3, 12, '#e9a21a'); P(20, 18, 1, 1, INK); }
  else if (n==='kitchen'){ el(12, 12, 10, 4, '#2b3036'); el(12, 11, 8, 2, '#f2d27a', null); P(21, 11, 5, 2, '#4b555d'); for (let k = -2; k <= 2; k++) P(12 + k * 4, 17, 2, 3, k % 2 ? '#ffb347' : '#5fa0ff'); }
  else if (n==='bar'){ P(9, 0, 1, 3, '#e6f1ec'); P(13, 0, 1, 3, '#e6f1ec'); bx(5, 5, 14, 13, '#fbfaf4', '#ffffff'); P(6, 6, 12, 2, '#c8323c'); P(6, 8, 12, 4, '#c48a5a'); bx(18, 8, 5, 7, '#fbfaf4'); P(3, 17, 18, 2, INK); }
  else if (n==='till'){ bx(2, 5, 20, 11, '#7be08f', '#a8f0b8', '#4aa86a'); el(12, 10, 3, 3, '#4aa86a', null); el(20, 16, 4, 2, '#ffd25a', '#c8941a'); el(17, 18, 4, 2, '#ffd25a', '#c8941a'); }
  // the new seats: a tray with a cup and a glass, a sink with a plate, a hanging 叉燒, a takeaway bag
  else if (n==='runner'){ el(13, 15, 11, 3, '#c9d1d6', '#6a747b'); bx(5, 5, 7, 9, '#fbfaf4', '#ffffff'); P(6, 7, 5, 3, '#c48a5a'); bx(14, 3, 7, 11, '#bfe3ff', '#ffffff'); P(15, 7, 5, 4, '#9fd3ff'); }
  else if (n==='roast'){ P(12, 0, 2, 4, '#5d6870'); bx(6, 4, 14, 11, '#b8322a', '#d8583a', '#7a1a14'); P(7, 6, 12, 2, '#e88a4a'); P(7, 11, 12, 1, '#7a1a14'); bx(3, 16, 20, 4, '#e8d8b8', '#fbf6e2'); }
  else if (n==='takeaway'){ P(9, 1, 1, 5, '#8a6a3a'); P(16, 1, 1, 5, '#8a6a3a'); P(9, 1, 8, 1, '#8a6a3a'); bx(5, 5, 16, 15, '#d8b27a', '#ecd0a0', '#b08a52'); P(8, 10, 10, 4, '#c8323c'); P(10, 11, 6, 2, '#fbfaf4'); }
  // the 樓面 tasks' own lessons: a stack of plates, a bowl and a cup on a tray; a bicycle with a bag on the back
  else if (n==='clear'){ P(2, 17, 22, 2, '#a77c4c'); el(8, 15, 6, 2, '#fbfaf4', '#9aa6ad'); el(8, 13, 6, 2, '#fbfaf4', '#9aa6ad'); el(8, 11, 6, 2, '#fbfaf4', '#9aa6ad'); el(18, 14, 4, 2, '#fbfaf4', '#8d9aa2'); P(15, 12, 7, 2, '#e3dccb'); bx(17, 5, 5, 6, '#fbfaf4', '#ffffff'); P(18, 6, 3, 2, '#c48a5a'); }
  else if (n==='deliver'){ el(6, 17, 4, 4, INK, null); el(6, 17, 2, 2, '#c9d1d6', null); el(20, 17, 4, 4, INK, null); el(20, 17, 2, 2, '#c9d1d6', null); P(6, 13, 14, 2, '#c8323c'); P(12, 9, 2, 5, '#c8323c'); P(18, 6, 2, 8, '#5d6870'); P(16, 5, 5, 1, '#5d6870'); bx(3, 6, 8, 7, '#d8b27a', '#ecd0a0', '#b08a52'); P(5, 8, 4, 2, '#c8323c'); }
}
// 食譜頁：每樣菜式、飲品一個圖（k = 's:A餐'、'f:餐蛋麵'、'd:揚州炒飯'、'k:奶茶'）
export const DRINK_COL: Record<string, string> = { 奶茶:'#c48a5a', 檸茶:'#b8642a', 鴛鴦:'#8a5a38', 檸水:'#f2eaa0', 紅豆冰:'#e8d8c8', 阿華田:'#7a4a2a', 咖啡:'#a8703e', 齋啡:'#3a2010', 茶走:'#d8a878', 啡走:'#b08058' };
export function menuIcon(full: string): void {
  const [key, lvS] = full.split('#'), lv = Number(lvS) || 1;
  menuBase(must(key, 'menu key'));
  // 升級賣相：二星加啲蔥花同熱氣，三星金邊同閃光
  if (lv >= 2){ P(9, 9, 2, 1, '#3fa34d'); P(15, 10, 2, 1, '#3fa34d'); P(12, 8, 1, 1, '#9be08f'); }
  if (lv >= 3){ P(2, 19, 22, 1, '#e9b23a'); ([[2, 2], [23, 3], [21, 15], [3, 14]] as const).forEach(([x, y]) => { P(x, y - 1, 1, 3, '#ffd25a'); P(x - 1, y, 3, 1, '#ffd25a'); P(x, y, 1, 1, '#ffffff'); }); }
}
export function menuBase(key: string): void {
  const [ns, id] = key.split(':');
  const bowl = (col: string): void => { el(13, 13, 12, 6, '#fbfaf4', '#8d9aa2'); el(13, 11, 10, 3, col, null); for (let k = 0; k < 4; k++) P(6 + k * 4, 10 + (k % 2), 3, 1, '#c99a3a'); };
  const plate = (): void => { el(13, 14, 12, 5, '#fbfaf4', '#9aa6ad'); };
  const egg = (x: number, y: number): void => { el(x, y, 4, 3, '#fffdf5', '#c9c2b0'); P(x, y - 1, 2, 2, '#f4a72a'); };
  const rice = (x: number, y: number, w: number): void => { el(x, y, w, 3, '#fbfaf4', '#cfc8b4'); for (let k = 0; k < 4; k++) P(x - w + 3 + k * 3, y - 1 + (k % 2), 2, 1, '#e3dccb'); };
  if (ns==='k'){
    const c = DRINK_COL[String(id)] || '#c48a5a', iced = id==='紅豆冰';
    if (iced){ bx(8, 2, 10, 17, '#d8eef8', '#ffffff'); P(9, 10, 8, 8, c); for (let k = 0; k < 5; k++) P(9 + (k * 3) % 8, 14 + (k % 2) * 2, 2, 2, '#a8383a'); P(10, 4, 3, 3, '#ffffff'); return; }
    bx(6, 6, 13, 12, '#fbfaf4', '#ffffff'); P(7, 7, 11, 4, c); bx(18, 9, 4, 6, '#fbfaf4'); P(4, 18, 17, 2, '#c9d1d6');
    if (id==='檸茶' || id==='檸水'){ el(9, 6, 3, 3, '#ffe14a', '#c8a020'); }
    if (id==='茶走' || id==='啡走'){ P(20, 2, 4, 5, '#c8323c'); P(20, 3, 4, 1, '#fbf6e2'); }
    if (id==='鴛鴦'){ P(7, 7, 5, 4, '#c48a5a'); }
    for (let k = 0; k < 2; k++) P(9 + k * 5, 2 - k, 1, 3, '#e6ecef');
    return;
  }
  if (ns==='s'){ bowl('#f2d27a'); bx(17, 2, 8, 7, '#b97a3a', '#d9a660'); egg(7, 7); return; }
  if (ns==='d'){ plate(); rice(9, 13, 6); const di = must(id, 'dish id'); el(17, 12, 6, 3, DISH_COL[di.replace(/飯$/, '')] || DISH_COL[di] || '#c08a5a', INK);
    if (di.includes('炒飯')){ el(13, 12, 10, 4, DISH_COL[di] || '#e8c55a', INK); for (let k = 0; k < 6; k++) P(6 + k * 3, 11 + (k % 2), 1, 1, k % 2 ? '#3fa34d' : '#d6452f'); }
    if (di==='焗豬扒飯'){ el(13, 12, 11, 5, '#c8402e', INK); for (let k = 0; k < 4; k++) P(7 + k * 4, 10 + (k % 2), 3, 2, '#f2d27a'); }
    return; }
  // 午市／冰室嘢食
  if (id==='餐蛋麵'){ bowl('#e3a845'); P(5, 7, 7, 3, '#e88a8a'); egg(18, 8); }
  else if (id==='火腿通粉'){ bowl('#f2d27a'); el(17, 9, 4, 2, '#f2a0a8', '#c86a72'); }
  else if (id==='沙嗲牛麵'){ bowl('#e3a845'); for (let k = 0; k < 4; k++) el(8 + k * 3, 9 + (k % 2), 2, 1, '#7a3e1a', null); }
  else if (id==='常餐'){ bowl('#f2d27a'); egg(8, 8); P(15, 8, 6, 2, '#b8322c'); bx(19, 1, 6, 6, '#b97a3a', '#d9a660'); }
  else if (id==='乾炒牛河'){ plate(); for (let k = 0; k < 6; k++) P(5 + k * 3, 10 + (k % 3), 4, 2, '#8a5a2b'); P(9, 9, 2, 1, '#3fa34d'); P(16, 11, 2, 1, '#3fa34d'); }
  else if (id==='焗豬扒飯'){ el(13, 13, 12, 6, '#c9d1d6', '#6f7b85'); el(13, 11, 10, 4, '#c8402e', null); for (let k = 0; k < 4; k++) P(7 + k * 4, 10 + (k % 2), 3, 2, '#f2d27a'); }
  else if (id==='菠蘿油'){ tok('菠蘿包', 13, 10); bx(9, 9, 8, 3, '#f7e27a', '#fff3b0'); }
  else if (id==='城寨叉燒飯'){ plate(); rice(10, 13, 7); for (let k = 0; k < 3; k++){ P(12 + k * 3, 9, 3, 5, '#b8322c'); P(13 + k * 3, 10, 1, 3, '#e9a07f'); } egg(20, 10); }
  else if (id==='豬扒包'){ el(13, 12, 10, 5, '#e9c48a', '#8a5a2b'); P(4, 9, 18, 3, '#a8642a'); el(13, 7, 9, 3, '#e9c48a', '#8a5a2b'); }
  else if (id==='蔥油雞扒撈丁'){ bowl('#e3a845'); el(13, 9, 6, 3, '#c8843a', '#6a3a1a'); for (let k = 0; k < 4; k++) P(7 + k * 4, 11, 2, 1, '#3fa34d'); }
  else if (id==='炒蛋多士'){ tok('多士', 13, 10); for (let k = 0; k < 4; k++) el(9 + k * 3, 9 + (k % 2), 2, 2, '#f2c23a', '#c8941a'); }
  else if (id==='牛油多士'){ tok('多士', 13, 10); bx(10, 8, 6, 3, '#f7e27a', '#fff3b0'); }
  else if (id==='油占多'){ tok('多士', 13, 10); el(13, 10, 5, 3, '#c8323c', null); }
  else if (id==='奶油多'){ tok('多士', 13, 10); for (let i = -5; i <= 5; i++) P(13 + i, 10 + Math.round(Math.sin(i / 2) * 2), 1, 2, '#f6f0e0'); }
  else if (id==='吸血鬼多士'){ tok('多士', 13, 10); el(13, 8, 5, 3, '#a8181a', null); for (let k = 0; k < 4; k++) P(9 + k * 3, 10, 1, 2 + (k % 2) * 2, '#a8181a'); P(10, 4, 1, 2, '#fbfaf4'); P(15, 4, 1, 2, '#fbfaf4'); }
  else if (id==='火腿三文治'){ for (let k = 0; k < 2; k++){ P(4 + k * 10, 6, 8, 11, '#e9d0a0'); P(5 + k * 10, 7, 6, 9, '#fbf3e0'); P(5 + k * 10, 11, 6, 2, '#f2a0a8'); } }
  else tok(must(id, 'menu item id'), 13, 10);
}
// 街市食材
export function ingrIcon(i: string): void {
  if (i==='雞蛋'){ el(9, 11, 5, 7, '#f6ead0', '#c8b088'); el(17, 12, 5, 6, '#e8c8a0', '#b89068'); }
  else if (i==='午餐肉') tok('餐肉', 13, 10);
  else if (i==='火腿') tok('火腿', 13, 10);
  else if (i==='叉燒') tok('叉燒', 13, 10);
  else if (i==='豬扒') tok('豬扒', 13, 10);
  else if (i==='雞肉') tok('雞扒', 13, 10);
  else if (i==='牛肉'){ for (let k = 0; k < 3; k++){ el(8 + k * 5, 10 + (k % 2) * 2, 5, 3, '#b8322c', '#7a1f1f'); P(7 + k * 5, 9 + (k % 2) * 2, 4, 1, '#f0a0a0'); } }
  else if (i==='麵'){ bx(5, 5, 16, 11, '#e3a845', '#f2d27a', '#c8862e'); for (let k = 0; k < 4; k++) P(7, 7 + k * 2, 12, 1, '#c8862e'); }
  else if (i==='麵包') tok('方包', 13, 10);
  else if (i==='白米'){ bx(6, 4, 14, 15, '#e8dcc0', '#f6f0e0'); P(8, 9, 10, 4, '#c8323c'); P(10, 3, 6, 2, '#c8b088'); }
  else if (i==='茶葉'){ bx(7, 3, 12, 16, '#2a8b67', '#3fa07a'); P(8, 8, 10, 5, '#e9b23a'); P(11, 10, 4, 1, '#7a1f1f'); }
  else if (i==='咖啡豆') ingIcon('咖啡');
  else if (i==='煉奶') ingIcon('煉奶');
  else if (i==='檸檬') ingIcon('檸檬');
  else if (i==='紅豆') ingIcon('紅豆');
}
// 說明頁嘅小圖：每項一個像素圖
export function howIcon(n: string): void {
  const person = (x: number, y: number, c: string): void => { el(x, y - 6, 2, 2, '#f0c8a0', INK); P(x - 2, y - 4, 5, 6, c); };
  const slip = (): void => { bx(7, 1, 12, 18, '#fbfaf4', '#ffffff'); P(8, 2, 10, 2, '#c8323c'); for (let k = 0; k < 4; k++) P(9, 6 + k * 3, 8, 1, '#9aa6ad'); };
  const plate = (x: number, y: number): void => { el(x, y, 9, 4, '#fbfaf4', '#9aa6ad'); };
  const coin = (x: number, y: number): void => { el(x, y, 4, 2, '#ffd25a', '#c8941a'); };
  if (n==='seat'){ person(4, 13, '#c8323c'); person(9, 13, '#3d7fbf'); P(12, 9, 4, 1, INK); P(15, 8, 1, 3, INK); bx(17, 8, 8, 4, '#f3e5b2', '#fff6d8'); P(18, 12, 1, 6, '#6f7b85'); P(23, 12, 1, 6, '#6f7b85'); }
  else if (n==='iso'){ for (let r = 0; r < 8; r++){ const w = r < 4 ? r * 3 + 2 : (7 - r) * 3 + 2; P(13 - w, 6 + r, w * 2, 1, (r % 2) ? '#7be08f' : '#5cc97a'); } bx(10, 4, 6, 5, '#f3e5b2'); }
  else if (n==='bubble'){ bx(5, 2, 16, 12, '#c8323c', '#e04a4a'); P(9, 14, 4, 2, '#c8323c'); P(10, 16, 2, 2, '#c8323c'); P(10, 5, 6, 2, '#fff'); P(12, 7, 2, 5, '#fff'); }
  else if (n==='dirty'){ plate(13, 12); P(9, 10, 3, 2, '#a0784a'); P(14, 12, 2, 1, '#a0784a'); P(16, 9, 2, 2, '#e9a24a'); P(5, 4, 2, 6, '#c9d1d6'); }
  else if (n==='reg'){ person(10, 16, '#2a8b67'); P(18, 3, 1, 7, '#ffd25a'); P(15, 6, 7, 1, '#ffd25a'); P(16, 4, 5, 5, '#ffd25a'); }
  else if (n==='slip') slip();
  else if (n==='redo'){ bx(6, 5, 11, 13, '#fbfaf4', '#ffffff'); P(7, 7, 9, 5, '#c48a5a'); for (let k = 0; k < 7; k++){ P(14 + k, 3 + k, 2, 2, '#c8323c'); P(20 - k, 3 + k, 2, 2, '#c8323c'); } }
  else if (n==='hold'){ el(12, 11, 9, 6, '#c9d1d6', '#6f7b85'); for (let k = -6; k <= 6; k += 3) P(12 + k, 7, 1, 9, '#8d9aa2'); P(20, 9, 6, 2, '#6f7b85'); }
  else if (n==='mode'){ bx(2, 4, 10, 13, '#f3e5b2'); for (let k = 0; k < 4; k++) bx(15 + (k % 2) * 5, 4 + Math.floor(k / 2) * 7, 4, 6, '#2a8b67', '#3fa07a'); }
  else if (n==='wok'){ el(12, 12, 10, 5, '#2b3036'); el(12, 11, 8, 3, '#e9a24a', null); P(21, 10, 5, 2, '#8a5a32'); for (let k = 0; k < 3; k++) P(8 + k * 4, 3 + (k % 2), 1, 4, '#ff8a3a'); }
  else if (n==='two'){ plate(7, 10); plate(19, 12); P(16, 6, 7, 1, '#ffd25a'); P(16, 17, 7, 1, '#ffd25a'); }
  else if (n==='serve'){ el(13, 14, 10, 3, '#c9d1d6', '#6f7b85'); el(13, 10, 7, 5, '#e6ecef', '#8d9aa2'); P(12, 4, 2, 2, '#8d9aa2'); }
  else if (n==='coins'){ coin(8, 15); coin(14, 13); coin(10, 10); bx(16, 3, 9, 6, '#7be08f', '#a8f0b8'); }
  else if (n==='octo'){ bx(4, 4, 18, 12, '#e98a2a', '#f4a24a'); P(5, 10, 16, 2, '#3d7fbf'); el(9, 7, 2, 2, '#fff', null); }
  else if (n==='strike'){ slip(); P(6, 9, 14, 2, '#c8323c'); }
  else if (n==='set'){ bx(2, 6, 10, 9, '#fbfaf4'); P(4, 9, 6, 3, '#e9a24a'); P(13, 10, 3, 1, INK); P(14, 9, 1, 3, INK); bx(18, 5, 6, 11, '#fbfaf4'); P(19, 8, 4, 6, '#c48a5a'); }
  else if (n==='star'){ for (let k = 0; k < 3; k++){ const x = 5 + k * 8; P(x, 6, 1, 9, '#ffd25a'); P(x - 3, 9, 7, 2, '#ffd25a'); P(x - 2, 8, 5, 5, '#ffd25a'); } }
  else if (n==='rank'){ person(13, 17, '#fbfaf4'); P(10, 4, 7, 3, '#2b3036'); P(9, 7, 9, 1, '#2b3036'); P(19, 4, 4, 2, '#ffd25a'); }
  else if (n==='combo'){ for (let k = 0; k < 5; k++) P(4 + k * 4, 16 - k * 3, 3, 3 + k * 3, k > 2 ? '#ff5a3a' : '#ffd25a'); }
  else if (n==='decor'){ bx(4, 3, 16, 6, '#e07a5a', '#f09a7a'); P(11, 9, 2, 3, '#6f7b85'); P(10, 12, 4, 7, '#8a5a32'); }
  else if (n==='prep'){ ingIcon('茶'); }
  else if (n==='agent'){ el(13, 5, 4, 4, '#f0c8a0', INK); P(9, 1, 8, 3, '#2b2420'); P(7, 9, 12, 10, '#2b3a5a'); P(12, 9, 2, 6, '#c8323c'); P(11, 9, 4, 2, '#fbfaf4'); bx(18, 10, 7, 9, '#fbf6e2', '#ffffff'); P(19, 12, 5, 1, '#c8323c'); P(19, 14, 5, 1, '#9aa6ad'); }
  else if (n==='crate'){ bx(3, 6, 20, 12, '#c8a070', '#e0c090', '#a07848'); P(3, 11, 20, 1, '#8a6a4a'); P(6, 3, 4, 4, '#3fa34d'); P(12, 2, 4, 5, '#e04a3a'); P(17, 3, 4, 4, '#f2d040'); }
  else if (n==='bowl' || n==='bowl0'){ const on = n==='bowl'; el(13, 11, 10, 3, on ? '#c8323c' : '#4b555d', INK); P(4, 11, 19, 1, on ? '#c8323c' : '#4b555d'); el(13, 14, 7, 4, on ? '#fbfaf4' : '#5d6870', INK); if (on){ P(8, 15, 10, 1, '#5fa0ff'); P(10, 4, 1, 4, '#e6ecef'); P(15, 3, 1, 4, '#e6ecef'); } P(10, 18, 7, 2, on ? '#e9b23a' : '#4b555d'); }
}
// kind = 'tok'（廚房碟上嘅嘢）或者 'ing'（水吧材料）
export function iconURL(kind: string, name: string): string {
  const key = kind + ':' + name;
  const hit = iconCache[key]; if (hit) return hit;
  const cv = document.createElement('canvas'); cv.width = ICON_W; cv.height = ICON_H;
  const ctx = cv.getContext('2d'), keep = PX;
  setPX(ctx);
  try { if (kind==='ing') ingIcon(name); else if (kind==='ui') uiIcon(name); else if (kind==='how') howIcon(name); else if (kind==='menu') menuIcon(name); else if (kind==='ingr') ingrIcon(name); else tok(name, 13, 10); } finally { setPX(keep); }
  return iconCache[key] = cv.toDataURL();
}
export const iconImg = (kind: string, name: string): string => `<img class="ico" src="${iconURL(kind, name)}" alt="" width="${ICON_W}" height="${ICON_H}">`;
