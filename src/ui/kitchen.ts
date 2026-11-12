// 廚房位：做法、碟、爐具、像素畫
// TypeScript port of the original game's kitchen.js, as an ES module: every
// top-level name is exported, none renamed.
import './bar';   // load order: src/entry.ts
import { HOOK } from './hooks';
import { must } from '../core/util';
import { liveG, G, bump, activePlate, byId, me } from '../core/state';
import { tName } from '../core/referee/customers';
import { CFG, FRIED_RICE, KIT } from '../core/data/menus';
import { $ } from './prefs';
import { label } from '../core/rules/price';
import { toast, morph } from './ui';
import { syncRail } from './bar';
import { PX, setPX } from './pixel';
import { iconImg } from './icons';
import { openKitRecipe } from './floor-iso';
import { kitItemOpen } from './menu';
import { sigMark } from './market';
import { dsEl, closestIn } from './levels';
import { kitLayout, selOk, holdFresh, kitDefOf, slotState, kNeed, kitSlotsOf } from '../core/stations/kitchen';
import { kitRecipe } from '../core/rules/recipes';

// 新人貓紙：列出要乜，放咗嘅打剔
// 炒底、炒飯嘅寫法：豉椒排骨飯（炒底）、揚州炒飯（加底）
export function tokText(t: string): string {
  if (!t.includes('·飯×')) return t;
  const [d, n] = [must(t.split('·')[0], 'dish'), Number(t.split('×')[1])];
  return FRIED_RICE.includes(d) ? d + (n > 1 ? '（加底）' : '') : `${d}（炒底${n > 1 ? '加底' : ''}）`;
}
export function cheatHtml(need: string[], have: string[]): string {
  const pool = [...have];
  return `<div class="cheat"><b>貓紙</b>${need.map(n => { const i = pool.indexOf(n), ok = i >= 0; if (ok) pool.splice(i, 1);
    return `<span class="ck ${ok ? 'ok' : ''}">${ok ? '✓ ' : ''}${tokText(n)}</span>`; }).join('')}</div>`;
}
// 枱面版（撳枱面上嘅料同爐具，啱手機）定掣版（下面一排掣，啱電腦）
// 手機（窄過 600px）一定用枱面版：掣版喺細 mon 會塞爆，爐頭又會擠埋一齊
export const kNarrow = (): boolean => innerWidth < 600;
export let kitMode = ((): string => { if (kNarrow()) return 'counter'; try { const v = localStorage.getItem('ckf-kmode'); if (v==='counter' || v==='pad') return v; } catch { /* storage blocked: decide below */ }
  return typeof window.matchMedia === 'function' && matchMedia('(pointer:coarse)').matches ? 'counter' : 'pad'; })();
addEventListener('resize', () => { if (kNarrow() && kitMode!=='counter'){ kitMode = 'counter'; kFitKey = ''; if (G) bump(); } });
export const kModeBtn = (cls: string): string => kNarrow() ? '' : `<button type="button" data-km class="${cls}">${kitMode==='counter' ? '掣版' : '枱面版'}</button>`;
export function setKitMode(m: string): void { if (kNarrow()) m = 'counter'; kitMode = m; try { localStorage.setItem('ckf-kmode', m); } catch { /* storage blocked */ } kFitKey = ''; if (G) bump(); }
// 枱面版嘅料盤：要煮嘅（撳就落爐）同即放嘅（撳就落碟）
export function kitTrays(): KitTray[] {
  const sk = kitLayout(), out: KitTray[] = [];
  Object.entries(sk.st).forEach(([st, all]) => { all.filter(kitItemOpen).forEach(x => out.push({ k:`s:${st}:${x}`, st, tk:x, txt: st==='toaster' && x==='餐包' ? '烘餐包' : FRIED_RICE.includes(x) ? x.replace('炒飯', '') : x.replace(/飯$/, ''), cook:true })); });
  sk.inst.forEach(x => out.push({ k:`i:${x}`, tk:x, txt:x }));
  if (sk.st.wok) out.push({ k:'rice2wok', st:'wok', tk:'飯', txt:'飯落鑊', cook:true });
  return out;
}
export function renderKitchen(): void {
  const S = liveG();
  const sk = kitLayout(), P = activePlate();
  // 下一碟整乜由自己揀（唔再自動揀最趕嗰碟）；揀咗嗰碟已經做完或者客走咗就放低
  if (me('kitchen') && S.ksel && !selOk()) S.ksel = null;
  must($('kitPad'), 'kitPad').hidden = kitMode==='counter';
  const tks = S.groups.filter(g => g.state==='wait' && g.meals && g.meals.length).sort((a, z) => (a.mealUntil ?? NaN) - (z.mealUntil ?? NaN));
  // 飛變做細 chip：一碟一粒，寫枱號同菜名（詳細做法睇隻碟同貓紙）
  const chips: RailItem[] = [];
  tks.forEach(g => { must(g.meals, 'meals').forEach((m, i) => { if (m.done) return; const on = S.ksel && S.ksel.gid===g.id && S.ksel.i===i;
    chips.push({ key: `${g.id}-${i}`, color: g.color, cls: 'kchipt' + (on ? ' on' : ''), h: `
      <button type="button" class="tk-l" data-mk="${g.id}:${i}"><small>${tName(g).replace(/號.*/, '號')}</small><b>${m.redo ? '整過 ' : ''}${String(label(m.k).split(' ')[0])}</b>${typeof sigMark==='function' ? sigMark(m.k) : ''}</button>
      <span class="mini"><i data-mbar="${g.id}"></i></span>` }); }); });
  syncRail(must($('krail'), 'krail'), chips, '暫時冇飛');
  const tg = selOk(), two = S.plates.length > 1, pn = two ? `碟${S.pi + 1}` : '隻碟';
  const tgK = (): string => must(must(must(tg, 'ticket').meals, 'meals')[must(S.ksel, 'G.ksel').i], 'meal line').k;
  morph(must($('kplate'), 'kplate'), `<div class="target">${tg ? `做緊 <b>${label(tgK())}</b> · ${tName(tg)}${two ? ` · 用碟${S.pi + 1}出` : ''}` : chips.length ? '撳張飛揀做邊碟' : '暫時冇飛'}</div>
    ${tg ? cheatHtml(kitRecipe(tgK()), must(P, 'active plate').tokens) : ''}
    ${kitMode==='pad' && S.hold.length ? `<div class="hold"><b>保溫</b>${S.hold.map((h, i) => `<button type="button" data-k="h:${i}" class="${holdFresh() ? '' : 'stale'}">${iconImg('tok', h.tk)}<span>${tokText(h.tk)}</span></button>`).join('')}</div>` : ''}
    <div class="pbtns"><button type="button" data-k="recipe" class="pbtn recipe">做法</button>${kModeBtn('pbtn mode')}<button type="button" data-k="dump" class="pbtn">倒咗${pn}</button><button type="button" data-k="serve" class="pbtn go">出餐</button></div>`);
  morph(must($('kitPad'), 'kitPad'), Object.entries(sk.st).map(([st, all]): [string, string[]] => [st, all.filter(kitItemOpen)]).filter(([, items]) => items.length).map(([st, items]) => `<div class="krow"><span>${kitDefOf(st).name}</span><div class="kbtns">${items.map(x => `<button type="button" class="icon" data-k="s:${st}:${x}">${iconImg('tok', x)}<span>${FRIED_RICE.includes(x) ? x : x.replace(/飯$/,'')}</span></button>`).join('')}${st==='wok' ? '<button type="button" data-k="stir" class="hot">炒</button><button type="button" data-k="rice2wok">飯落鑊</button>' : ''}</div></div>`).join('')
    + `<div class="krow"><span>${sk.instName || '放'}</span><div class="kbtns">${sk.inst.map(x => `<button type="button" data-k="i:${x}" class="inst icon">${iconImg('tok', x)}<span>${x}</span></button>`).join('')}</div></div>`);
  paintKitchen();
}
export function paintKitchen(): void {
  drawKitchen(performance.now());
  const S = liveG();
  document.querySelectorAll('[data-mbar]').forEach(e => {
    const el = dsEl(e);
    const g = byId(Number(el.dataset.mbar)); if (!g) return;
    const f = Math.max(0, Math.min(1, ((g.mealUntil ?? NaN) - S.t) / (g.mealMax ?? NaN)));
    el.style.transform = `scaleX(${f})`; el.classList.toggle('low', f < .3);
  });
}
// 撳飛嘅白色位：收埋／打開嗰張飛
export const kFold = new Set<number>();
must($('kitView'), 'kitView').addEventListener('click', e => {
  const b = closestIn(e.target, 'button');
  if (!b){ const tk = closestIn(e.target, '#krail .ticket'); if (tk){ const id = Number(tk.dataset.key); if (kFold.has(id)) kFold.delete(id); else kFold.add(id); if (G) bump(); } return; }
  if (b.dataset.mk){ const [gid, i] = b.dataset.mk.split(':').map(Number); const g = byId(gid ?? NaN); if (g && !must(must(g.meals, 'meals')[i ?? NaN], 'meal line').done) HOOK.assignMeal(gid ?? NaN, i ?? NaN); return; }
  if (b.dataset.k==='recipe'){ openKitRecipe(); return; }
  if ('km' in b.dataset){ setKitMode(kitMode==='counter' ? 'pad' : 'counter'); return; }
  if (b.dataset.k) HOOK.kitKey(b.dataset.k);
});
must($('kitPad'), 'kitPad').addEventListener('click', e => {
  const b = closestIn(e.target, 'button'); if (!b) return;
  if (b.dataset.k==='recipe'){ openKitRecipe(); return; }
  HOOK.kitKey(b.dataset.k);
});
/* ---- 廚房畫面：高像素風（細格仔、黑色描邊）。下層像素畫，上層清楚嘅字 ---- */
/** The kitchen's canvases (index.html has them). The JS dereferenced each straight away. */
export const kCanvas = (id: string): HTMLCanvasElement => { const c = $(id); return must(c instanceof HTMLCanvasElement ? c : null, id); };
// getContext('2d') returns null only when the canvas already has another kind of context, which these never do.
export const kcv = kCanvas('kcv'), kx = must(kcv.getContext('2d'), 'kcv 2d context'), ktv = kCanvas('ktv'), tx = must(ktv.getContext('2d'), 'ktv 2d context');
export let kW = 300, kH = 220, kS = 2, LW = 150, LH = 110, kDpr = 1, kHits: SceneHit[] = [];
export const INK = '#0f1a16';
export function fitKitchen(): void {
  const el = must($('kscene'), 'kscene');   // clientWidth 唔計個框，畫布先唔會俾框遮咗右邊
  kW = Math.max(200, el.clientWidth); kH = Math.max(160, el.clientHeight); kFitKey = '';
}
export let kFitKey = '';
// 揀格仔大細：爐具愈少，每格愈大（可以唔係整數）
export function ensureKitScale(cols: number, rows: number, plan: ((lw: number) => { extra: number }) | null): void {
  let want = Math.max(1.4, Math.min(3.2, Math.min(kW / (cols * 66), kH / (rows * 74 + 62))));
  // 枱面版：仲要擺保溫盤同料盤，按高度縮細
  if (plan) for (let k = 0; k < 4; k++){ const need = rows * 64 + 50 + 18 + plan(kW / want).extra; want = Math.max(1.2, Math.min(want, kH / need)); }
  const key = [kW, kH, want.toFixed(3)].join('x');
  if (key===kFitKey) return;
  kFitKey = key; kS = want; LW = Math.floor(kW / kS); LH = Math.floor(kH / kS);
  kcv.width = LW; kcv.height = LH; kcv.style.width = `${Math.round(LW * kS)}px`; kcv.style.height = `${Math.round(LH * kS)}px`;
  kDpr = Math.min(2, window.devicePixelRatio || 1);
  ktv.width = Math.round(LW * kS * kDpr); ktv.height = Math.round(LH * kS * kDpr); ktv.style.width = `${Math.round(LW * kS)}px`; ktv.style.height = `${Math.round(LH * kS)}px`;
}
new ResizeObserver(fitKitchen).observe(must($('kscene'), 'kscene'));
export const P = (x: number, y: number, w: number, h: number, c: string): void => { const px = must(PX, 'PX'); px.fillStyle = c; px.fillRect(Math.round(x), Math.round(y), w, h); };
// 描邊方塊：hi = 頂面高光，lo = 右邊陰影
export function bx(x: number, y: number, w: number, h: number, fill: string, hi?: string | null, lo?: string | null): void { P(x, y, w, h, INK); P(x + 1, y + 1, w - 2, h - 2, fill); if (hi) P(x + 1, y + 1, w - 2, 1, hi); if (lo) P(x + w - 2, y + 1, 1, h - 2, lo); }
// 逐行畫嘅橢圓；edge = null 就冇描邊
export function el(cx: number, cy: number, rx: number, ry: number, fill: string, edge: string | null = INK): void {
  cx = Math.round(cx); cy = Math.round(cy);
  const row = (r1: number, r2: number, col: string): void => { for (let dy = -r2; dy <= r2; dy++){ const span = Math.round(r1 * Math.sqrt(Math.max(0, 1 - (dy * dy) / (r2 * r2 || 1)))); P(cx - span, cy + dy, span * 2 + 1, 1, col); } };
  if (edge){ row(rx, ry, edge); if (rx > 1 && ry > 1) row(rx - 1, ry - 1, fill); }
  else row(rx, ry, fill);
}
export const NOODLE_COL: Record<string, string> = { 通粉:'#f2d27a', 意粉:'#e9c25a', 米粉:'#f6f2e6', 公仔麵:'#e3a845' };
export const DISH_COL: Record<string, string> = { 蛋撻:'#f7c93a', 粟米肉粒飯:'#f2c94c', 番茄牛肉飯:'#d6452f', 豉椒排骨飯:'#6b4430', 白汁雞皇飯:'#f3ead2', 揚州炒飯:'#e8c55a', 鹹魚雞粒炒飯:'#d9c49a', 乾炒牛河:'#8a5a2b', 焗豬扒飯:'#c8402e', 咖喱牛腩:'#c9702a' };
// 麵條：幾條彎彎嘅線
export function noodles(cx: number, cy: number, w: number, h: number, col: string, kind: string): void {
  if (kind==='通粉'){ for (let k = 0; k < 9; k++){ const x = cx - w / 2 + (k * 7) % w, y = cy - h / 2 + ((k * 5) % h); P(x, y, 4, 2, '#c99a3a'); P(x, y, 3, 1, col); } return; }
  const rows = kind==='米粉' ? 6 : 4;
  for (let r = 0; r < rows; r++) for (let i = 0; i < w; i++){
    const y = cy - h / 2 + r * (h / rows) + Math.round(Math.sin((i + r * 3) / (kind==='公仔麵' ? 1.6 : 2.6)) * (kind==='公仔麵' ? 1.6 : 1));
    P(cx - w / 2 + i, y, 1, 1, r % 2 ? col : kind==='米粉' ? '#e3dccb' : '#c99a3a');
  }
}
// 碟上面每樣嘢（大約 22×16 格）
export function tok(tk: string, cx: number, cy: number): void {
  const b = must(tk.split('·')[0], 'token');
  const nc = NOODLE_COL[b];
  if (nc){ el(cx, cy, 10, 6, nc, '#b8862e'); noodles(cx, cy, 16, 8, nc, b); }
  else if (b==='煎蛋' || b==='太陽蛋'){ el(cx, cy, 10, 6, '#fffdf5', '#c9c2b0'); el(cx + 1, cy - 1, b==='太陽蛋' ? 4 : 3, 3, b==='太陽蛋' ? '#ffb515' : '#f4a72a', '#c8781a'); P(cx, cy - 2, 1, 1, '#fff6c8'); }
  else if (b==='炒蛋'){ ([[-6, -2], [0, -3], [6, -1], [-3, 3], [3, 2], [-8, 2], [8, 3]] as const).forEach(([a, c]) => { el(cx + a, cy + c, 3, 2, '#f2c23a', '#c8941a'); P(cx + a - 1, cy + c - 1, 2, 1, '#ffe37a'); }); }
  else if (b.startsWith('多士') || b==='西多士'){ const c = b.includes('烘底') ? '#a8642a' : b==='西多士' ? '#d9902a' : '#d9a660'; bx(cx - 9, cy - 8, 18, 16, '#b97a3a'); P(cx - 7, cy - 6, 14, 12, c); P(cx - 7, cy - 6, 14, 1, '#f0c98a'); if (b==='西多士'){ P(cx - 4, cy - 2, 8, 3, '#f7e27a'); } }
  else if (b.startsWith('餐包') || b==='菠蘿包'){ const c = b.includes('烘底') ? '#b8762e' : b==='菠蘿包' ? '#e9b44c' : '#e9c48a'; el(cx, cy, 10, 7, c, '#8a5a2b'); P(cx - 5, cy - 4, 6, 1, '#f6dcae'); if (b==='菠蘿包'){ for (let k = -1; k <= 1; k++){ P(cx - 6, cy + k * 3, 12, 1, '#b98a2d'); } } }
  else if (b==='蛋撻'){ el(cx, cy, 9, 6, '#c98a3a', '#8a5a2b'); el(cx, cy - 1, 6, 4, '#f7c93a', '#d9a020'); P(cx - 3, cy - 3, 3, 1, '#fff0a0'); }
  else if (b==='方包'){ bx(cx - 9, cy - 8, 18, 16, '#d9b07a'); P(cx - 7, cy - 6, 14, 12, '#fbf3e0'); P(cx - 7, cy - 6, 14, 1, '#ffffff'); }
  else if (b==='豬扒' || b==='雞扒'){ const c = b==='豬扒' ? ['#a8642a', '#c8843a'] as const : ['#c8843a', '#e0a050'] as const; el(cx, cy, 10, 6, c[0], '#6a3a1a'); el(cx - 1, cy - 1, 7, 4, c[1], null); for (let k = -6; k <= 4; k += 5) P(cx + k, cy - 2, 3, 1, '#6a3a1a'); }
  else if (b==='燉奶'){ el(cx, cy + 2, 9, 5, '#fbfaf4', '#9aa6ad'); el(cx, cy, 7, 3, '#f6efd8', null); P(cx - 3, cy - 1, 3, 1, '#ffffff'); }
  else if (b==='果占'){ el(cx, cy, 8, 5, '#c8323c', '#7a1f1f'); P(cx - 4, cy - 3, 4, 1, '#f08080'); }
  else if (b==='牛油'){ bx(cx - 6, cy - 3, 12, 7, '#f7e27a', '#fff3b0'); }
  else if (b==='奶油'){ for (let i = -9; i <= 9; i++) P(cx + i, cy + Math.round(Math.sin(i / 2) * 3), 1, 2, '#e8dcc0'); }
  else if (b==='飛邊'){ for (let i = -9; i <= 9; i += 3){ P(cx + i, cy - 7, 2, 1, '#5b6d65'); P(cx + i, cy + 7, 2, 1, '#5b6d65'); } for (let i = -7; i <= 7; i += 3){ P(cx - 9, cy + i, 1, 2, '#5b6d65'); P(cx + 9, cy + i, 1, 2, '#5b6d65'); } }
  else if (b==='火腿'){ el(cx, cy, 9, 6, '#f2a0a8', '#c86a72'); el(cx, cy, 6, 4, '#f7c0c5', null); }
  else if (b==='餐肉'){ bx(cx - 10, cy - 4, 20, 9, '#e88a8a', '#f4b0b0'); P(cx - 9, cy + 2, 18, 2, '#c86a6a'); }
  else if (b==='沙嗲牛'){ ([[-6, -2], [2, -3], [7, 1], [-2, 3], [-8, 3]] as const).forEach(([a, c]) => { el(cx + a, cy + c, 4, 2, '#7a3e1a', '#4a2410'); }); P(cx - 3, cy - 1, 2, 1, '#c87a3a'); }
  else if (b==='叉燒'){ for (let k = 0; k < 3; k++){ bx(cx - 10 + k * 7, cy - 6, 7, 13, '#b8322c'); P(cx - 8 + k * 7, cy - 4, 3, 9, '#e9a07f'); } }
  else if (b==='飯'){ el(cx, cy, 10, 6, '#fbfaf4', '#cfc8b4'); for (let k = 0; k < 7; k++) P(cx - 6 + (k * 5) % 12, cy - 3 + (k * 3) % 6, 2, 1, '#e3dccb'); }
  else if (b==='蔥'){ for (let k = 0; k < 9; k++){ const x = cx - 8 + (k * 7) % 16, y = cy - 4 + (k * 5) % 8; P(x, y, 3, 2, '#3fa34d'); P(x, y, 1, 1, '#9be08f'); } }
  else {
    const c = DISH_COL[b] || '#c08a5a';
    el(cx, cy, 11, 7, c, INK); P(cx - 6, cy - 4, 6, 1, 'rgba(255,255,255,.4)');
    if (tk.includes('·飯') || FRIED_RICE.includes(b)) for (let k = 0; k < 9; k++) P(cx - 7 + (k * 5) % 14, cy - 3 + (k * 3) % 6, 2, 1, '#fffaf0');
  }
}
export function cellsFor(): KitCell[] {
  const order = (['pot','pan','toaster','oven','wok'] as const).filter(st => kitLayout().st[st]);
  return order.flatMap(st => liveG().kit[st].map((j, i) => ({ st, i, j })));
}
export function flames(cx: number, y: number, now: number): void {
  for (let k = -3; k <= 3; k++){
    const h = 3 + ((Math.floor(now / 110) + k * 3) % 3);
    P(cx + k * 7 - 1, y - h, 3, h, '#5fa0ff'); P(cx + k * 7, y - h - 2, 1, 3, k % 2 ? '#ffb347' : '#ffd25a');
  }
}
export function drawSt(c: KitCell, x: number, y: number, w: number, h: number, now: number): { cx: number; base: number; s: { cls: string; txt: string; f: number }; j: KitJob | null } {
  const st = c.st, j = c.j, s = slotState(st, j), cx = Math.round(x + w / 2), base = Math.round(y + h - 16);
  const burnt = s.cls==='burnt', ready = s.cls.startsWith('ready'), cooking = s.cls==='cook';
  if (st!=='toaster' && st!=='oven'){ bx(cx - 27, base, 54, 5, '#2b3036', '#4b555d'); if (j && !burnt) flames(cx, base, now); }
  if (st==='pot'){
    const top = base - 30;
    bx(cx - 30, top + 5, 8, 5, '#3c454d'); bx(cx + 22, top + 5, 8, 5, '#3c454d');
    bx(cx - 23, top, 46, 30, '#6f7b85'); P(cx - 19, top + 2, 5, 26, '#a4afb7'); P(cx - 17, top + 2, 1, 26, '#d6dde1'); P(cx + 12, top + 2, 9, 26, '#56616b');
    el(cx, top, 24, 5, '#3c454d'); el(cx, top, 21, 3, '#bfe3ec', null);
    if (j){
      if (burnt){ el(cx, top, 20, 3, '#2a2420', null); for (let k = 0; k < 4; k++){ const ph = (Math.floor(now / 160) + k * 3) % 10; P(cx - 9 + k * 6, top - 6 - ph * 2, 3, 3, '#6d6d6d'); } }
      else {
        if (j.item==='咖喱牛腩'){ el(cx, top, 20, 3, '#c9702a', null); P(cx - 8, top - 1, 3, 2, '#7a3e1a'); P(cx + 4, top, 3, 2, '#7a3e1a'); }
        // A pot item with no noodle colour paints with fillStyle = undefined, which the canvas reads as the string 'undefined'.
        else noodles(cx, top, 34, 4, String(NOODLE_COL[j.item]), j.item);
        for (let k = 0; k < 4; k++){ if ((Math.floor(now / 200) + k) % 3) P(cx - 14 + k * 9, top - 1 + (k % 2), 2, 2, '#ffffff'); }
        for (let k = 0; k < 3; k++) for (let i = 0; i < 9; i++){ const ph = (now / 90 + k * 13) % 18; P(cx - 10 + k * 10 + Math.round(Math.sin((i + now / 150 + k) / 2) * 2), top - 6 - i * 2 - ph * .4, 1, 2, `rgba(255,255,255,${(.8 - i * .08).toFixed(2)})`); }
      }
    }
  } else if (st==='pan' || st==='wok'){
    const wok = st==='wok', rx = wok ? 30 : 24, ry = wok ? 9 : 7, cy = base - (wok ? 8 : 6);
    bx(cx + rx - 4, cy - 3, wok ? 16 : 20, 5, '#2b3036', '#4b555d');
    if (wok) bx(cx - rx - 8, cy - 3, 10, 5, '#2b3036', '#4b555d');
    el(cx, cy, rx, ry, '#2b3036'); el(cx, cy - 2, rx - 3, ry - 3, '#3b4249', null); P(cx - rx + 6, cy - ry + 3, rx - 6, 1, '#5d6870');
    if (j){
      const toss = wok ? Math.round(Math.max(0, 1 - (liveG().t * 1000 - (j.lastStir == null ? -1e9 : j.lastStir)) / 260) * 10) : 0, iy = cy - 3 - toss;
      if (burnt) el(cx, iy, 12, 4, '#2a2420', null);
      else if (wok){ const col = DISH_COL[j.item] || '#c08a5a'; el(cx, iy, 19, 5, col, INK); P(cx - 10, iy - 3, 9, 1, 'rgba(255,255,255,.4)'); for (let k = 0; k < (j.rice ?? NaN) * 7; k++) P(cx - 14 + (k * 7) % 28, iy - 2 + (k * 3) % 4, 2, 1, '#fffaf0'); }
      else {
        const it = j.item, pale = cooking && s.f < .6;
        if (it==='煎蛋' || it==='太陽蛋'){ el(cx - 1, iy, 13, 5, pale ? '#e9e4d6' : '#fffdf5', '#c9c2b0'); el(cx + 1, iy - 1, it==='太陽蛋' ? 5 : 4, 3, it==='太陽蛋' ? '#ffb515' : '#f4a72a', '#c8781a'); P(cx, iy - 2, 1, 1, '#fff6c8'); }
        else if (it==='炒蛋'){ for (let k = 0; k < 6; k++) el(cx - 12 + k * 5, iy - (k % 2), 3, 2, pale ? '#f6e08a' : '#f2c23a', '#c8941a'); }
        else { bx(cx - 11, iy - 5, 22, 9, pale ? '#e8c48a' : '#d9902a', '#f0c98a'); }
      }
    }
  } else if (st==='toaster'){
    const top = base - 28;
    if (j){
      const up = ready ? 12 : 2, col = j.item==='餐包' ? '#e2b06a' : (j.crisp && ready) ? '#a8642a' : '#d9a660';
      [-11, 11].forEach(dx => { if (j.item==='餐包'){ el(cx + dx, top - up + 3, 6, 5, col, '#8a5a2b'); } else { bx(cx + dx - 6, top - up, 12, up + 4, col, '#f0c98a'); P(cx + dx - 5, top - up + 1, 10, 1, '#b97a3a'); } });
    }
    bx(cx - 24, top, 48, 28, '#c9d1d6', '#eef2f4', '#9aa6ad'); P(cx - 20, top + 3, 3, 22, '#eef2f4');
    P(cx - 18, top, 14, 3, INK); P(cx + 4, top, 14, 3, INK);
    bx(cx + 23, top + 9, 5, 9, '#4b555d'); P(cx - 16, top + 22, 32, 2, '#9aa6ad');
    if (cooking){ P(cx - 17, top + 3, 12, 1, '#ff5a28'); P(cx + 5, top + 3, 12, 1, '#ff5a28'); }
  } else {
    const top = base - 38;
    bx(cx - 28, top, 56, 40, '#4b555d', '#6f7b85', '#3c454d');
    const glow = j && !burnt;
    bx(cx - 21, top + 7, 42, 22, glow ? '#ff9a3c' : '#2b3036');
    if (glow) for (let r = 0; r < 4; r++) P(cx - 19, top + 9 + r * 5, 38, 2, (Math.floor(now / 250) + r) % 2 ? '#ffb347' : '#ff8a2a');
    if (j) el(cx, top + 21, 12, 4, burnt ? '#2a2420' : DISH_COL[j.item] || '#c8402e');
    P(cx - 18, top + 32, 36, 2, '#9aa6ad'); P(cx + 16, top + 2, 3, 3, '#c9d1d6'); P(cx + 21, top + 2, 3, 3, '#c9d1d6');
  }
  // 計時條
  const bw = Math.min(w - 10, 52), bx0 = cx - Math.round(bw / 2), by = base + 8;
  bx(bx0, by, bw, 5, '#2b3a33');
  if (j){ const col = burnt ? '#6d6d6d' : ready ? (s.cls.includes('warn') && Math.floor(now / 150) % 2 ? '#ff5a5a' : '#7be08f') : '#ffd25a'; P(bx0 + 1, by + 1, Math.max(1, Math.round((bw - 2) * Math.min(1, s.f))), 3, col); }
  return { cx, base, s, j };
}
export function kchip(px: number, py: number, text: string, bg: string, fg: string): void {
  tx.font = `900 12px "Noto Sans HK", sans-serif`;
  const w = tx.measureText(text).width + 10, h = 16;
  tx.fillStyle = INK; tx.fillRect(px - w / 2 - 2, py - h / 2 - 2, w + 4, h + 5);
  tx.fillStyle = bg; tx.fillRect(px - w / 2, py - h / 2, w, h);
  tx.fillStyle = fg; tx.textAlign = 'center'; tx.textBaseline = 'middle'; tx.fillText(text, px, py + 1);
}
export function drawKitchen(now: number): void {
  if (!G || G.station!=='kitchen') return;
  const S = G;
  const cells = cellsFor(), n = cells.length;
  const cols = kW < 460 ? (n <= 2 ? n : n===4 ? 2 : n >= 7 ? 4 : 3) : Math.min(n, 5), rows = Math.ceil(n / cols);
  const counter = kitMode==='counter';
  ensureKitScale(cols, rows, counter ? lw => counterPlan(cells, cols, lw) : null);
  const plan = counter ? counterPlan(cells, cols, LW) : null;
  setPX(kx); kx.imageSmoothingEnabled = false;
  // 牆：茶記綠色紙皮石（細格）
  P(0, 0, LW, LH, '#b2d2c3');
  for (let y = 0; y < LH; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < LW; x += 6) P(x, y, 5, 5, (x * 7 + y * 3) % 11 ? '#d6ebe1' : '#c3e0d2');
  bx(-1, -1, LW + 2, 11, '#9aa6ad', '#d6dde1', null); P(0, 9, LW, 1, '#5d6870');
  const plateH = Math.max(44, Math.min(70, Math.round(LH * .28))), top = 12;
  const sh = Math.floor((LH - plateH - top - 6 - (plan ? plan.extra : 0)) / rows), cw = LW / cols;
  // 每行爐頭；枱面版下面跟住嗰行爐具用嘅料
  const rowTop: number[] = []; { let y = top; for (let r = 0; r <= rows; r++){ rowTop.push(y); y += sh + (plan && r < rows ? (plan.stripH[r] ?? NaN) + STRIP_PAD : 0); } }
  for (let r = 0; r < rows; r++){ const y = (rowTop[r] ?? NaN) + sh - 11; bx(-1, y, LW + 2, 11, '#39424a', '#6f7b85', null); P(0, y + 9, LW, 1, '#2b3036');
    const strip = plan && plan.stripH[r]; if (strip){ bx(-1, y + 11, LW + 2, strip + STRIP_PAD, '#c9d1d6', '#eef2f4', null); } }
  tx.setTransform(kDpr, 0, 0, kDpr, 0, 0); tx.clearRect(0, 0, LW * kS, LH * kS);
  kHits = [];
  const marks: { c: KitCell; cx: number; base: number; s: { cls: string; txt: string; f: number }; j: KitJob | null; y: number }[] = [];
  cells.forEach((c, i) => {
    const x = (i % cols) * cw, y = rowTop[Math.floor(i / cols)] ?? NaN;
    const m = drawSt(c, x, y, cw, sh, now);

    marks.push({ c, ...m, y });
    kHits.push({ x: x * kS, y: y * kS, w: cw * kS, h: sh * kS, st:c.st, i:c.i });
  });
  if (plan){
    plan.groups.forEach(gp => { const gx = gp.c0 * cw, gw = gp.n * cw, iw = Math.min(34, gw / gp.per), y = (rowTop[gp.row] ?? NaN) + sh + 4;
      gp.items.forEach((t, j) => { drawBin(t, gx + (gw - Math.min(gp.items.length, gp.per) * iw) / 2 + (j % gp.per) * iw, y + Math.floor(j / gp.per) * ITEM_H, iw); }); });
    drawFridge(plan, rowTop[rows] ?? NaN, now);
  }
  // 枱面同碟
  const py = LH - plateH;
  bx(-1, py, LW + 2, plateH + 1, '#e8d8a0', '#f6ead0', null);
  for (let x = 5; x < LW; x += 17) P(x, py + 10 + (x % 5), 4, 1, '#d9c78e');
  const N = S.plates.length, colW = LW / N, plateMarks: { k: number; pcx: number; pcy: number; toks: string[]; step: number; on: boolean; pry: number }[] = [];
  S.plates.forEach((pl, k) => {
    const toks = pl.tokens, step = Math.min(24, Math.floor((colW - 20) / Math.max(1, toks.length)));
    const prx = Math.round(Math.min(colW / 2 - 4, Math.max(26, toks.length * step / 2 + 10))), pry = Math.round(Math.min(plateH / 2 - 5, 15)), pcx = Math.round(colW * k + colW / 2), pcy = py + Math.round(plateH / 2) + 1, on = k===S.pi;
    el(pcx + 2, pcy + 3, prx, pry, 'rgba(0,0,0,.15)', null);
    if (on) el(pcx, pcy, prx + 4, pry + 3, '#ffd25a', INK);
    el(pcx, pcy, prx, pry, '#fbfaf4'); el(pcx, pcy, prx - 6, pry - 4, '#fbfaf4', '#dfe7ea');
    toks.forEach((t, n2) => { tok(t, pcx - (toks.length - 1) * step / 2 + n2 * step, pcy - 1); });
    // 做法擺上碟：仲欠嘅料畫淡淡哋喺碟邊（B）
    if (on){ const need = kNeed(); if (need.length){ const px = must(PX, 'PX'); px.globalAlpha = .35; const gs2 = Math.min(18, Math.floor((colW - 8) / need.length)); need.forEach((t, n2) => { tok(t, pcx - (need.length - 1) * gs2 / 2 + n2 * gs2, pcy - pry - 10); }); px.globalAlpha = 1; } }
    plateMarks.push({ k, pcx, pcy, toks, step, on, pry });
    kHits.push({ plate:k, x: (colW * k) * kS, y: py * kS, w: colW * kS, h: plateH * kS });
  });
  // 字：爐具名同狀態
  marks.forEach(({ c, cx, base, s, j }) => {
    const X = cx * kS, name = `${KIT[c.st].name}${S.kit[c.st].length > 1 ? c.i + 1 : ''}`;
    tx.font = `700 11px "Noto Sans HK", sans-serif`; tx.textAlign = 'center'; tx.textBaseline = 'alphabetic';
    const lbl = j ? `${FRIED_RICE.includes(j.item) ? j.item : j.item.replace(/飯$/, '')}${j.crisp ? '烘底' : ''}${c.st==='wok' && j.rice ? ' 飯×' + String(j.rice) : ''}` : name;
    const ly = kitMode==='counter' ? base * kS - 2 : (base + 13) * kS + 17;   // 枱面版：名寫喺爐頭度，唔好遮住下面啲料
    tx.lineWidth = 3; tx.strokeStyle = '#e6f1ec'; tx.strokeText(lbl, X, ly); tx.fillStyle = INK; tx.fillText(lbl, X, ly);
    if (j){
      const topY = (base + 10) * kS;
      if (s.cls==='burnt') kchip(X, topY, '燶咗', '#5d5d5d', '#ffffff');
      else if (s.cls.startsWith('ready')) kchip(X, topY, c.st==='wok' ? '炒好' : '得！', s.cls.includes('warn') && Math.floor(now / 150) % 2 ? '#ff5a5a' : '#7be08f', INK);
      else kchip(X, topY, s.txt, '#ffd25a', INK);
    }
  });
  plateMarks.forEach(({ k, pcx, pcy, toks, step, on, pry }) => {
    if (S.plates.length > 1) kchip(pcx * kS, (pcy - pry - 3) * kS, `碟${k + 1}`, on ? '#ffd25a' : '#e6f1ec', INK);
    tx.textAlign = 'center'; tx.textBaseline = 'alphabetic';
    if (!toks.length){ tx.font = '700 12px "Noto Sans HK", sans-serif'; tx.fillStyle = '#8d9ca8'; tx.fillText('空碟', pcx * kS, pcy * kS + 4); return; }
    if (!on) return;
    tx.font = `700 ${toks.length > 3 ? 9 : 10}px "Noto Sans HK", sans-serif`;
    toks.forEach((t, n2) => { const X = (pcx - (toks.length - 1) * step / 2 + n2 * step) * kS, Y = (pcy + pry) * kS + 10;
      tx.lineWidth = 3; tx.strokeStyle = '#e8d8a0'; tx.strokeText(tokText(t), X, Y); tx.fillStyle = INK; tx.fillText(tokText(t), X, Y); });
  });
}
/* ---- 枱面版：料擺喺用佢嘅爐具下面，底下一排凍櫃同撈籬 ---- */
export const KPOP: boolean = true;   // 撳爐頭彈選單：料盤太多時，爐頭唔會擠到好細
export const ITEM_H = 27, STRIP_PAD = 6, HOLD_ROW = 24;
export function counterPlan(cells: KitCell[], cols: number, lw: number): CounterPlan {
  // 同一款爐具嘅料擺埋一齊（四隻粉一齊、啲蛋一齊），橫跨嗰幾個爐頭；撳就落第一個空嘅
  const trays = kitTrays(), cw = lw / cols, rows = Math.ceil(cells.length / cols), stripH: number[] = Array<number>(rows).fill(0), groups: CounterGroup[] = [];
  // 新版（A）：爐頭唔再擺料盤，撳爐頭彈選單揀煮乜；淨係凍櫃一排（即放料＋飯落鑊）
  if (KPOP){ const inst = trays.filter(t => !t.st || t.k==='rice2wok'), fc = Math.max(5, Math.floor(lw / 30)), fridgeH = 4 + HOLD_ROW + Math.ceil(inst.length / fc) * ITEM_H + 4;
    return { groups, stripH, inst, fc, fridgeH, extra: fridgeH }; }
  [...new Set(cells.map(c => c.st))].forEach(st => {
    const idx = cells.map((c, i) => c.st===st ? i : -1).filter(i => i >= 0), i0 = must(idx[0], 'first cell'), row = Math.floor(i0 / cols);
    const n = idx.filter(i => Math.floor(i / cols)===row).length, items = trays.filter(t => t.st===st);
    const per = Math.max(1, Math.floor(n * cw / 27)), lines = Math.ceil(items.length / per);
    groups.push({ row, c0: i0 % cols, n, per, items });
    stripH[row] = Math.max(stripH[row] ?? NaN, lines * ITEM_H);
  });
  const inst = trays.filter(t => !t.st), fc = Math.max(4, Math.floor(lw / 30)), fridgeH = 4 + HOLD_ROW + Math.ceil(inst.length / fc) * ITEM_H + 4;
  return { groups, stripH, inst, fc, fridgeH, extra: stripH.reduce((a, z) => a + z + STRIP_PAD, 0) + fridgeH };
}
// 一盒料：黃色＝落爐煮，粉紅＝直接落碟
export function drawBin(t: KitTray, x: number, y: number, w: number): void {
  x = Math.round(x); w = Math.round(w);
  bx(x + 1, y, w - 2, ITEM_H - 2, t.cook ? '#e8c55a' : '#f2a0a8', t.cook ? '#f6dc8a' : '#f8c4c9', t.cook ? '#c9a23a' : '#d9808a');
  tok(t.tk, x + w / 2, y + 10);
  tx.font = `700 ${t.txt.length > 3 ? 8 : 9}px "Noto Sans HK", sans-serif`; tx.textAlign = 'center'; tx.textBaseline = 'alphabetic';
  const X = (x + w / 2) * kS, Y = (y + ITEM_H - 4) * kS;
  tx.lineWidth = 3; tx.strokeStyle = t.cook ? '#e8c55a' : '#f2a0a8'; tx.strokeText(t.txt, X, Y); tx.fillStyle = INK; tx.fillText(t.txt, X, Y);
  kHits.push({ tray:t.k, x: x * kS, y: y * kS, w: w * kS, h: ITEM_H * kS });
}
export function drawFridge(plan: CounterPlan, y0: number, now: number): void {
  bx(-1, y0, LW + 2, plan.fridgeH, '#b9c3c9', '#e6ecef', null);
  // 撈籬：煲定嘅麵
  const groups: Record<string, number[]> = {}; liveG().hold.forEach((h, i) => { (groups[h.tk] = groups[h.tk] || []).push(i); });
  bx(2, y0 + 3, 30, HOLD_ROW - 4, '#6f7b85');
  tx.font = '900 10px "Noto Sans HK", sans-serif'; tx.textAlign = 'center'; tx.textBaseline = 'middle'; tx.fillStyle = '#ffffff';
  tx.fillText('撈籬', 17 * kS, (y0 + 1 + HOLD_ROW / 2) * kS);
  const ks = Object.keys(groups);
  if (!ks.length){ tx.font = '700 10px "Noto Sans HK", sans-serif'; tx.textAlign = 'left'; tx.fillStyle = '#5d6870'; tx.fillText('煲熟嘅麵會自動撈起擺喺度', 36 * kS, (y0 + 1 + HOLD_ROW / 2) * kS); }
  ks.forEach((tk, n) => { const x = 36 + n * 40, y = y0 + 3, at = must(groups[tk], 'hold group');
    el(x + 18, y + 11, 18, 9, '#8d9aa2', INK); el(x + 18, y + 10, 15, 7, '#c9d1d6', null);
    for (let k = 0; k < 3; k++) P(x + 9 + k * 7, y + 6 + ((now / 300 + k) % 3), 1, 2, 'rgba(255,255,255,.8)');
    tok(tk, x + 18, y + 10);
    kchip((x + 33) * kS, (y + 3) * kS, `×${at.length}`, '#7be08f', INK);
    kHits.push({ hold: at[0], x: x * kS, y: y * kS, w: 38 * kS, h: HOLD_ROW * kS });
  });
  // 凍櫃：直接落碟
  const tw = LW / plan.fc, fy = y0 + 4 + HOLD_ROW;
  plan.inst.forEach((t, k) => { drawBin(t, (k % plan.fc) * tw, fy + Math.floor(k / plan.fc) * ITEM_H, tw); });
}
ktv.addEventListener('pointerdown', e => {
  if (!G || !G.running || G.paused) return;
  const S = G;
  const r = ktv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const h = kHits.find(h => x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h); if (!h) return;
  if (h.plate !== undefined){ HOOK.pickPlate(h.plate); return; }
  if (h.tray){ HOOK.kitKey(h.tray); return; }
  if (h.hold !== undefined){ HOOK.kitKey(`h:${h.hold}`); return; }
  const j = kitSlotsOf(h.st ?? null)[h.i ?? NaN];
  if (h.st==='wok' && j && (j.stirs ?? NaN) < CFG.stirs){ HOOK.kitKey('stir'); return; }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- KPOP is a design switch (false = the old tray layout), kept as the JS has it
  if (KPOP && kitMode==='counter'){
    const opts = kitTrays().filter(t => t.st===h.st && t.k!=='rice2wok');
    const toastOk = h.st==='toaster' && j && j.item==='多士' && !j.crisp && S.t >= (j.ready ?? NaN);
    if (toastOk){ HOOK.kitKey(`t:${h.st}:${String(h.i)}`); return; }   // 多士烘一轉就得，唔叫烘底
    if (!j){
      if (!opts.length){ toast(`${kitDefOf(String(h.st)).name}今日冇嘢要煮`); return; }
      if (opts.length===1){ HOOK.kitKey(`${must(opts[0], 'tray').k}:${String(h.i)}`); return; }
      openPop(h, opts.map(t => ({ ...t, k:`${t.k}:${String(h.i)}` }))); return;
    }
  }
  HOOK.kitKey(`t:${String(h.st)}:${String(h.i)}`);
});
export function openPop(h: SceneHit, opts: KitTray[]): void {
  const pop = must($('kpop'), 'kpop'), need = kNeed();
  morph(pop, opts.map(o => `<button type="button" data-pop="${o.k}" class="${need.some(n => n.startsWith(o.tk)) ? 'want' : ''}">${iconImg('tok', o.tk)}<span>${o.txt}</span></button>`).join('') + '<button type="button" class="x" data-popx>✕</button>');
  pop.hidden = false; kPopDown = false;
  const sw = must($('kscene'), 'kscene').clientWidth, pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = `${Math.max(4, Math.min(sw - pw - 4, h.x + h.w / 2 - pw / 2))}px`;
  pop.style.top = `${Math.max(4, h.y + h.h * .55 - ph / 2)}px`;
}
export function closePop(): void { must($('kpop'), 'kpop').hidden = true; }
export let kPopDown = false;
must($('kpop'), 'kpop').addEventListener('pointerdown', e => { e.stopPropagation(); kPopDown = true; });
// 撳爐頭嗰下嘅 click 會跌落啱啱彈出嚟嘅選單度
// The pop-up opens on finger down, under the finger, so the click at finger up of that same press lands on one of
// its buttons however long the press was. Accept a click only if its press began on the pop-up (no time window);
// a keyboard click (detail 0) has no press and is accepted.
must($('kpop'), 'kpop').addEventListener('click', e => { e.stopPropagation(); const b = closestIn(e.target, 'button'), pressed = kPopDown || e.detail===0; kPopDown = false; if (!b || !pressed) return; if ('popx' in b.dataset){ closePop(); return; } closePop(); HOOK.kitKey(b.dataset.pop); });
document.addEventListener('pointerdown', e => { if (!must($('kpop'), 'kpop').hidden && !closestIn(e.target, '#kpop')) closePop(); }, true);
