// 像素畫共用工具
// TypeScript port of the original game's pixel.js, as an ES module: every
// top-level name is exported. Owns the scene types (types/pixel.d.ts).
import './kitchen';   // load order: src/entry.ts
import { must } from '../core/util';
import { $ } from './prefs';
import { P, INK } from './kitchen';

/* ===================== 像素畫：共用工具 ===================== */
export let PX: CanvasRenderingContext2D | null = null;
export function setPX(v: typeof PX): void { PX = v; }
// 一個像素場景：下層低解像度畫，上層清楚嘅字
export function makeScene(wrapId: string): Scene {
  const wrap = must($(wrapId), wrapId), cv = wrap.querySelector('.pxl'), tv = wrap.querySelector('.txl');
  // The JS called getContext on both right here, so a missing or non-canvas element threw here.
  if (!(cv instanceof HTMLCanvasElement)) throw new TypeError(`chakei: missing canvas .pxl in ${wrapId}`);
  if (!(tv instanceof HTMLCanvasElement)) throw new TypeError(`chakei: missing canvas .txl in ${wrapId}`);
  const sc: Scene = { wrap, cv, tv, x: cv.getContext('2d'), t: tv.getContext('2d'), W:300, H:160, S:3, LW:100, LH:53, dpr:1, key:'', hits:[] };
  new ResizeObserver(() => { const r = wrap.getBoundingClientRect(); sc.W = Math.max(120, Math.floor(r.width)); sc.H = Math.max(60, Math.floor(r.height)); sc.key = ''; }).observe(wrap);
  return sc;
}
export function beginScene(sc: Scene, S: number): void {
  const key = [sc.W, sc.H, S].join('x');
  if (key!==sc.key){
    sc.key = key; sc.S = S; sc.LW = Math.floor(sc.W / S); sc.LH = Math.floor(sc.H / S);
    sc.cv.width = sc.LW; sc.cv.height = sc.LH; sc.cv.style.width = String(Math.round(sc.LW * S)) + 'px'; sc.cv.style.height = String(Math.round(sc.LH * S)) + 'px';
    sc.dpr = Math.min(2, window.devicePixelRatio || 1);   // 3x 螢幕畫晒會好食 CPU／電
    sc.tv.width = Math.round(sc.LW * S * sc.dpr); sc.tv.height = Math.round(sc.LH * S * sc.dpr); sc.tv.style.width = String(Math.round(sc.LW * S)) + 'px'; sc.tv.style.height = String(Math.round(sc.LH * S)) + 'px';
  }
  PX = sc.x; must(PX, 'scene canvas context').imageSmoothingEnabled = false;
  const t = must(sc.t, 'scene text context'); t.setTransform(sc.dpr, 0, 0, sc.dpr, 0, 0); t.clearRect(0, 0, sc.LW * S, sc.LH * S);
  sc.hits = [];
}
export function tiles(LW: number, LH: number): void {
  P(0, 0, LW, LH, '#a9cbbd');
  for (let y = 0; y < LH; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < LW; x += 4) P(x, y, 3, 3, (x * 7 + y) % 5 ? '#cfe6dc' : '#bfdccf');
}
export function chipT(t: CanvasRenderingContext2D, px: number, py: number, text: string, bg: string, fg: string, size = 12): void {
  t.font = `900 ${size}px "Noto Sans HK", sans-serif`;
  const w = t.measureText(text).width + 10, h = size + 4;
  t.fillStyle = INK; t.fillRect(px - w / 2 - 2, py - h / 2 - 2, w + 4, h + 5);
  t.fillStyle = bg; t.fillRect(px - w / 2, py - h / 2, w, h);
  t.fillStyle = fg; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillText(text, px, py + 1);
}
export function hitAt(sc: Scene, e: MouseEvent): SceneHit | undefined {
  const r = sc.tv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  // Last (topmost) hit wins. A plain loop, not findLast: iOS before 15.4 does not have it.
  for (let i = sc.hits.length - 1; i >= 0; i--){ const h = must(sc.hits[i], 'hit'); if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h; }
  return undefined;
}
// 客人造型：由標籤（學生哥／阿婆／地盤佬…）推出，淨係靠標籤，唔使存落 G（組隊都一致）
export const LOOK_CACHE: Record<string, Look> = {};
export function lookOf(label: string | undefined): Look {
  label = label || '';
  const hit = LOOK_CACHE[label]; if (hit) return hit;
  const L: Look = {};
  if (/學生/.test(label)) L.uniform = true;                       // 白恤衫＋深藍領帶（通用校服，唔係邊間學校）
  if (/阿伯|阿婆|獨居|晨運/.test(label)) L.hair = '#e6e6e2';      // 白頭髮
  if (/阿婆/.test(label)) L.perm = true;                          // 阿婆：電髮，左右鬢多啲
  if (/地盤/.test(label)) L.hat = '#f2c230';                      // 安全帽
  if (/OL|阿姐/.test(label)) L.long = true;                       // 長頭髮
  return LOOK_CACHE[label] = L;
}
// 一個公仔（企位，側面）：頭髮、面、衫
export function person(x: number, y: number, col: string, hair = '#2b2b2b', face = '#f0c8a0'): void {
  P(x + 1, y, 6, 2, hair); P(x, y + 1, 8, 2, hair);
  P(x + 1, y + 3, 6, 4, face); P(x + 2, y + 4, 1, 1, INK); P(x + 5, y + 4, 1, 1, INK);
  P(x, y + 7, 8, 7, col); P(x - 1, y + 8, 1, 4, col); P(x + 8, y + 8, 1, 4, col);
  P(x + 1, y + 14, 2, 3, '#2b3036'); P(x + 5, y + 14, 2, 3, '#2b3036');
}
