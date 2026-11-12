// 彩蛋：暫停「食緊煙」——伙記仔喺茶記唔同角落抖氣（原創場景，隨機出，收集入彩蛋簿）
// TypeScript port of the original game's smoke.js, as an ES module: every
// top-level name is exported. Owns the figure types (types/smoke.d.ts).
import './stats';   // load order: src/entry.ts
import { must } from '../core/util';
import { $ } from './prefs';
import { pickSure, pick } from '../core/rng';
import { toast } from './ui';
import { INK } from './kitchen';
import { SHOP, saveShop } from './decor';
import { bossEl } from './career';
import { dress } from './outfit';

/* ===================== 公仔 ===================== */
// 喺 14×36 格入面畫一個人（腳底喺 y=36）；先畫晒描邊再填色，flip = 面向左
export const SW = 120, SH = 72, GROUND = 64;
export const SK = '#f0c8a0', HAIR = '#2b2b2b', SHIRT = '#fbfaf4', PANTS = '#2b3036';
export const HAT = '#fbfaf5';   // 伙記仔頂帽嘅記認色（換裝時換走，見 outfit.js）
export function fig(c: CanvasRenderingContext2D, x: number, y: number, parts: readonly FigPart[], flip?: boolean): void {
  const W = 16;
  const at = (r: FigPart): [number, number, number, number] => [flip ? x + (W - r[0] - r[2]) : x + r[0], y - 36 + r[1], r[2], r[3]];
  c.fillStyle = INK;
  parts.forEach(r => { if (r[5]) return; const [a, b, w, h] = at(r); c.fillRect(a - 1, b - 1, w + 2, h + 2); });
  parts.forEach(r => { const [a, b, w, h] = at(r); c.fillStyle = r[4]; c.fillRect(a, b, w, h); });
}
// 第五格係 true = 細節，唔使描邊
// 後巷撞到嘅女仔：長頭髮、米色恤衫、深藍裙，手夾住支煙（原創角色）
export const HER_POSE: FigPart[] = [
  [5,26,2,10,SK],[8,26,2,10,SK],[4,35,3,1,'#111',1],[8,35,3,1,'#111',1],
  [3,20,8,7,'#3a4a6a'],[3,12,8,9,'#e8dcc0'],
  [3,4,7,8,SK],[2,2,9,3,HAIR],[2,3,2,13,HAIR],[9,3,2,9,HAIR],
  [7,6,1,1,INK,1],[8,9,2,1,'#c8323c',1],
  [9,13,2,6,'#e8dcc0'],[10,11,1,2,SK],[11,10,1,1,'#fbfaf4',1],[12,9,1,1,'#ff7a3a',1],
];
// 幾次食煙都撞到佢，每次多一章（曖昧，冇下文）
export const HER = [
  ['佢：「唔好意思，借個火得唔得？」', '（佢點著支煙，點個頭，返咗入隔籬寫字樓）'],
  ['佢：「又係你？」', '佢：「你哋茶記啲奶茶幾好飲喎，我日日叫外賣。」'],
  ['佢：「我通常呢個鐘數落嚟，避吓老細。」', '你：「咁……我都係。」'],
  ['佢：「我叫阿詠。你呢？」', '阿詠：「好，記住咗。」'],
  ['阿詠：「聽日你返唔返工？」', '阿詠：「冇，隨便問吓啫。」'],
  ['阿詠：「如果你戒煙，我都試吓戒。」', '（兩個都冇再講嘢，支煙燒到尾）'],
];
export const HER_AGAIN = ['阿詠：「又撞到喇。」', '阿詠：「今日唔使借火，我自己帶咗。」', '阿詠：「你頂帽戴歪咗。」', '阿詠：「喂，今日奶茶好似甜咗。」'];
export const POSES: Record<PoseId, FigPart[]> = {
  // 挨牆仰頭呼煙（伙記仔）
  leanUp: [
    [4,24,3,12,PANTS],[7,24,3,12,PANTS],[3,35,4,1,'#111',1],[7,35,4,1,'#111',1],
    [3,13,8,12,SHIRT],[3,19,8,1,'#c8323c',1],
    [3,4,7,8,SK],[3,3,7,3,HAIR],[3,3,2,7,HAIR],[3,1,6,2,HAT],
    [7,6,2,1,INK,1],[9,9,1,1,'#c07060',1],[9,7,1,1,'#e0a880',1],
    [4,14,3,10,SHIRT],[4,24,3,2,SK],
    [10,8,1,1,'#fbfaf4',1],[11,7,1,1,'#fbfaf4',1],[12,6,1,1,'#fbfaf4',1],[13,5,1,1,'#ff7a3a',1],
  ],
  // 坐膠櫈，頭低低，手夾煙放埋嘴邊
  sitBow: [
    [1,27,11,2,'#c8323c'],[2,29,1,7,'#a5272f'],[10,29,1,7,'#a5272f'],
    [4,23,9,4,PANTS],[11,26,3,9,PANTS],[11,35,4,1,'#111',1],
    [3,12,8,12,SHIRT],[3,18,8,1,'#c8323c',1],
    [5,4,7,8,SK],[5,3,7,3,HAIR],[5,3,2,6,HAIR],[5,1,6,2,HAT],
    [9,8,2,1,INK,1],
    [6,13,3,6,SHIRT],[8,9,3,5,SHIRT],[10,9,2,2,SK],
    [12,10,1,1,'#fbfaf4',1],[13,11,1,1,'#fbfaf4',1],[14,11,1,1,'#ff7a3a',1],
  ],
  // 師傅：企喺度，高帽、圍裙、鬚，手伸出嚟夾住煙（用嘅時候 flip 面向左）
  chef: [
    [4,24,3,12,PANTS],[7,24,3,12,PANTS],[3,35,4,1,'#111',1],[7,35,4,1,'#111',1],
    [3,13,8,12,'#fbfaf4'],[3,19,8,6,'#d9d2bd'],
    [4,5,7,8,SK],[4,4,7,2,HAIR],[4,4,2,5,HAIR],[4,0,7,4,'#ffffff'],
    [9,8,1,1,INK,1],[8,11,3,1,'#3a2a1a',1],
    [8,15,3,4,'#fbfaf4'],[10,15,2,2,'#fbfaf4'],[12,15,2,2,SK],
    [14,15,1,1,'#fbfaf4',1],[15,15,1,1,'#ff7a3a',1],
  ],
  // 踎低（伙記仔），手搭膝頭夾住煙
  squat: [
    [4,28,8,4,PANTS],[9,30,3,6,PANTS],[3,31,3,5,PANTS],[9,35,4,1,'#111',1],[2,35,4,1,'#111',1],
    [3,17,8,12,SHIRT],[3,23,8,1,'#c8323c',1],
    [4,9,7,8,SK],[4,8,7,3,HAIR],[4,8,2,6,HAIR],[4,6,6,2,HAT],
    [8,12,1,1,INK,1],[10,14,1,1,'#c07060',1],
    [7,19,3,5,SHIRT],[9,23,4,2,SHIRT],[13,23,2,2,SK],
    [15,22,1,1,'#fbfaf4',1],[15,21,1,1,'#ff7a3a',1],
  ],
};
/* ===================== 場景 ===================== */
export function mosaic(c: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, a: string, b: string): void {
  c.fillStyle = a; c.fillRect(x0, y0, w, h);
  for (let y = y0; y < y0 + h; y += 3) for (let x = x0 + ((y / 3) % 2 ? 1 : 0); x < x0 + w; x += 3){ c.fillStyle = (x * 7 + y * 3) % 11 ? b : a; c.fillRect(x, y, 2, 2); }
}
export const SMOKE_SCENES: SmokeScene[] = [
  { id:'kitchen', name:'廚房後面挨住牆', line:'頂唔順，抖陣先。', tip:[45, 33], chefX:50, smoke:'95,110,115', draw(c, _t, st){
      mosaic(c, 0, 0, SW, GROUND, '#8fb8a6', '#a9cbbd');
      c.fillStyle = '#fff7d0'; c.fillRect(54, 2, 3, 2); c.fillStyle = 'rgba(255,230,150,.18)'; c.fillRect(40, 4, 30, 60);
      // 雪櫃
      c.fillStyle = INK; c.fillRect(81, 13, 28, 52); c.fillStyle = '#b9c2c8'; c.fillRect(82, 14, 26, 50); c.fillStyle = '#d7dee2'; c.fillRect(82, 14, 26, 2);
      c.fillStyle = '#8a959c'; c.fillRect(82, 36, 26, 1); c.fillStyle = INK; c.fillRect(104, 20, 1, 10); c.fillRect(104, 42, 1, 12);
      if (st.fridge){ // 雪櫃門自己彈開：入面有樽嘢，門板喺左邊
        c.fillStyle = '#dff3ff'; c.fillRect(82, 14, 26, 22); c.fillStyle = '#9fc4d8'; c.fillRect(82, 25, 26, 1);
        ([[85,'#c8323c'],[90,'#e9b23a'],[95,'#2a8b67'],[100,'#c8323c']] as const).forEach(([x, col]) => { c.fillStyle = INK; c.fillRect(x, 17, 4, 8); c.fillStyle = col; c.fillRect(x + 1, 18, 2, 6); });
        c.fillStyle = INK; c.fillRect(75, 13, 7, 24); c.fillStyle = '#c9d0d4'; c.fillRect(76, 14, 5, 22); }
      // 地下、水桶、地拖
      c.fillStyle = '#56645d'; c.fillRect(0, GROUND, SW, SH - GROUND); c.fillStyle = '#4a5852'; for (let x = 0; x < SW; x += 8) c.fillRect(x, GROUND, 1, SH - GROUND);
      c.fillStyle = INK; c.fillRect(63, 55, 12, 10); c.fillStyle = '#e9b23a'; c.fillRect(64, 56, 10, 8); c.fillStyle = '#7a5a3a'; c.fillRect(70, 34, 1, 22);
      if (!st.gone) fig(c, 32, GROUND - (st.dy || 0), dress(POSES.leanUp));
    } },
  { id:'backdoor', name:'後門膠櫈', line:'仲有幾多張單……', tip:[44, 39], chefX:47, draw(c, t, st){
      c.fillStyle = '#2f4a40'; c.fillRect(0, 0, SW, GROUND);
      // 打開咗嘅後門，外面夜晚啲燈
      c.fillStyle = INK; c.fillRect(60, 6, 40, 59); c.fillStyle = '#121a24'; c.fillRect(62, 8, 36, 57);
      ([[66,20,'#ffd25a'],[74,14,'#ff8a3a'],[88,24,'#ffd25a'],[80,32,'#9fd3ff'],[70,38,'#ff5a5a'],[92,12,'#ffd25a'],[84,44,'#ff8a3a']] as const).forEach(([x, y, col], i) => {
        const on = Math.sin(t / 700 + i) > -.6; c.fillStyle = col; c.globalAlpha = on ? .55 : .3; c.fillRect(x - 1, y - 1, 4, 4); c.globalAlpha = on ? .9 : .5; c.fillRect(x, y, 2, 2); c.globalAlpha = 1; });
      c.fillStyle = '#5a3d24'; c.fillRect(98, 8, 6, 57);
      c.fillStyle = '#25332d'; c.fillRect(0, GROUND, SW, SH - GROUND);
      c.fillStyle = 'rgba(255,210,90,.12)'; c.fillRect(62, GROUND, 36, SH - GROUND);
      fig(c, 30, GROUND, st.gone ? POSES.sitBow.slice(0, 3) : dress(POSES.sitBow)); // 走咗都留低張膠櫈
    } },
  { id:'alley', name:'後巷垃圾桶隔籬', line:'隻貓都食飽過我。', tip:[57, 49], draw(c, t, st){
      c.fillStyle = '#1b2238'; c.fillRect(0, 0, SW, 20);
      // 唐樓窗口
      c.fillStyle = '#2b3348'; c.fillRect(0, 6, SW, 58);
      for (let x = 6; x < SW; x += 14) for (let y = 10; y < 44; y += 12){ c.fillStyle = (x + y) % 3 ? '#ffd98a' : '#3a4560'; c.fillRect(x, y, 6, 6); }
      // 冷氣機滴水
      c.fillStyle = INK; c.fillRect(85, 20, 16, 10); c.fillStyle = '#c9d0d4'; c.fillRect(86, 21, 14, 8); c.fillStyle = '#9fd3ff'; c.fillRect(93, 31 + Math.floor(t / 120) % 30, 1, 2);
      // 地下、垃圾桶、隻貓
      c.fillStyle = '#3c3f44'; c.fillRect(0, GROUND, SW, SH - GROUND);
      c.fillStyle = INK; c.fillRect(13, 45, 18, 20); c.fillStyle = '#2a8b67'; c.fillRect(14, 46, 16, 18); c.fillStyle = '#1f6a4f'; c.fillRect(14, 46, 16, 3);
      // 地下塊多士（隻貓想偷）
      if (st.toast){ c.fillStyle = INK; c.fillRect(65, 60, 7, 5); c.fillStyle = '#e9b86a'; c.fillRect(66, 61, 5, 3); c.fillStyle = '#c48a3a'; c.fillRect(66, 61, 5, 1); }
      // 隻貓（面向左；行緊就郁腳）
      const blink = Math.floor(t / 1500) % 4 === 0, cx = Math.round(st.catX ?? 85) - 85, step = st.walking ? Math.floor(t / 150) % 2 : 0;
      c.fillStyle = INK; c.fillRect(85 + cx, 57, 10, 7 - step); c.fillRect(86 + cx, 53, 5, 5); c.fillRect(86 + cx, 52, 1, 1); c.fillRect(90 + cx, 52, 1, 1); c.fillRect(95 + cx, 58 - Math.round(Math.sin(t / 400) * 2), 2, 5);
      c.fillStyle = '#e9a24a'; c.fillRect(86 + cx, 58, 8, 5 - step); c.fillRect(87 + cx, 54, 3, 3); if (!blink){ c.fillStyle = '#7be08f'; c.fillRect(87 + cx, 55, 1, 1); c.fillRect(89 + cx, 55, 1, 1); }
      if (st.carry){ c.fillStyle = INK; c.fillRect(82 + cx, 55, 5, 4); c.fillStyle = '#e9b86a'; c.fillRect(83 + cx, 56, 3, 2); }
      if (!st.gone) fig(c, 42, GROUND, dress(POSES.squat));
    } },
];
/* ===================== 煙 ===================== */
export let smokeCtx: CanvasRenderingContext2D | null = null, smokeScene: SmokeScene | null = null, smokeRaf = 0, puffs: SmokePuff[] = [], ash: SmokeAsh[] = [], smk: SmokeState = {};
// 隱藏結局：撳得多先撞到
export const SMOKE_ENDS: Record<SmokeEndId, { name: string; line: string }> = {
  boss: { name:'阿姐嚟喇', line:'阿姐：食完未呀！' },
  cat:  { name:'偷多士', line:'喂！我塊多士！' },
  fridge: { name:'雪櫃彈開', line:'嚇死我！邊個冇閂好雪櫃門？' },
  light: { name:'師傅借火', line:'師傅：喂，借個火！' },
  rain: { name:'落大雨', line:'落雨喇！走先！' },
};
export function smokeEnd(id: SmokeEndId): void {
  const got = must(SHOP.eggs, 'SHOP.eggs').smokeEnd || [];
  if (!got.includes(id)){ must(SHOP.eggs, 'SHOP.eggs').smokeEnd = [...got, id]; saveShop(); toast(`隱藏結局：${SMOKE_ENDS[id].name}`); }
}
// 阿姐喺左邊探個頭出嚟
export function drawAhJie(c: CanvasRenderingContext2D, k: number): void {
  const x = Math.round(-12 + k * 12), y = 26;
  c.fillStyle = INK; c.fillRect(x - 1, y - 1, 11, 14); c.fillRect(x + 8, y + 9, 6, 4);
  c.fillStyle = '#1e1e1e'; c.fillRect(x, y, 9, 12);
  c.fillStyle = SK; c.fillRect(x + 4, y + 3, 5, 7); c.fillRect(x + 9, y + 10, 4, 2);
  c.fillStyle = INK; c.fillRect(x + 7, y + 5, 1, 1); c.fillStyle = '#c8323c'; c.fillRect(x + 6, y + 8, 3, 2);
}
export function drawSmoke(now: number): void {
  const c = smokeCtx; if (!c || must($('pauseView'), 'pauseView').hidden){ smokeRaf = 0; return; }
  const el = now - (smk.t0 ?? NaN);
  if (smk.ev==='her'){
    const ch = (must(SHOP.eggs, 'SHOP.eggs').her ?? 0)|0, lines = ch < HER.length ? HER[ch] : [smk.again, '（佢笑咗一笑）'];
    if (el > 3200 && !smk.l1){ smk.l1 = true; must($('smokeLine'), 'smokeLine').textContent = String(must(lines, 'her lines')[0]); must(SHOP.eggs, 'SHOP.eggs').her = ch + 1; saveShop();
      toast(ch < HER.length ? `後巷嘅佢 · 第 ${ch + 1}／${HER.length} 次` : '又撞到佢'); smk.ch = ch; }
    if (el > 6200 && !smk.l2){ smk.l2 = true; const sch = smk.ch ?? NaN; must($('smokeLine'), 'smokeLine').textContent = String(must(sch < HER.length ? HER[sch] : lines, 'her lines')[1]); }
  }
  if (smk.ev==='cat'){
    if (el > 2500 && el < 5000){ smk.walking = true; smk.catX = 85 - (el - 2500) / 2500 * 13; }
    if (el >= 5000 && smk.toast){ smk.toast = false; smk.carry = true; must($('smokeLine'), 'smokeLine').textContent = `「${SMOKE_ENDS.cat.line}」`; smokeEnd('cat'); }
    if (el >= 5000){ smk.catX = 72 + (el - 5000) / 2500 * 60; }
  }
  if (smk.ev==='boss' && el > 4500 && !smk.called){ smk.called = true; must($('smokeLine'), 'smokeLine').textContent = `「${SMOKE_ENDS.boss.line}」`; }
  if (smk.ev==='boss' && el > 6200 && !smk.gone){ smk.gone = true; must($('smokeLine'), 'smokeLine').textContent = '（伙記仔掟低支煙，即刻衝返入去）'; smokeEnd('boss'); }
  if (smk.ev==='fridge' && el > 3000 && !smk.fridge){ smk.fridge = true; must($('smokeLine'), 'smokeLine').textContent = `「${SMOKE_ENDS.fridge.line}」`; smokeEnd('fridge'); }
  smk.dy = smk.ev==='fridge' && el > 3000 && el < 3350 ? 3 : 0;
  if (smk.ev==='light'){
    if (el > 2500) smk.chefX = Math.max(must(smokeScene, 'smokeScene').chefX ?? NaN, 122 - (el - 2500) / 2000 * (122 - (must(smokeScene, 'smokeScene').chefX ?? NaN)));
    if (el > 4300 && !smk.lit){ smk.lit = true; must($('smokeLine'), 'smokeLine').textContent = `「${SMOKE_ENDS.light.line}」`; }
    if (el > 6000 && !smk.both){ smk.both = true; must($('smokeLine'), 'smokeLine').textContent = '（兩個一齊抖陣）'; smokeEnd('light'); }
  }
  if (smk.ev==='rain'){
    if (el > 4500 && !smk.yell){ smk.yell = true; must($('smokeLine'), 'smokeLine').textContent = `「${SMOKE_ENDS.rain.line}」`; }
    if (el > 5800 && !smk.gone){ smk.gone = smk.wet = true; smk.toast = false; smk.catX = 200; must($('smokeLine'), 'smokeLine').textContent = '（伙記仔同隻貓都走去避雨）'; smokeEnd('rain'); }
  }
  must(smokeScene, 'smokeScene').draw(c, now, smk);
  if (smk.ev==='fridge' && smk.fridge && el < 7000) for (let k = 0; k < 10; k++){ const a = ((now / 900 + k * .1) % 1); c.fillStyle = `rgba(240,250,255,${(.6 * (1 - a)).toFixed(2)})`; c.fillRect(Math.round(80 - a * 14 + k % 3), Math.round(20 + k * 1.6 + a * 6), 2, 2); }
  if (smk.ev==='light' && el > 2500){
    fig(c, Math.round(smk.chefX ?? NaN), GROUND, POSES.chef, true);
    if (el > 4300 && el < 5200 && Math.floor(now / 90) % 2){ c.fillStyle = '#ffd25a'; c.fillRect((must(smokeScene, 'smokeScene').chefX ?? NaN) - 2, GROUND - 22, 2, 2); c.fillStyle = '#ff7a3a'; c.fillRect((must(smokeScene, 'smokeScene').chefX ?? NaN) - 1, GROUND - 23, 1, 1); }
    if (el > 5200 && Math.random() < .1) puffs.push({ x: must(smokeScene, 'smokeScene').chefX ?? NaN, y: GROUND - 21, born: now, dx: (Math.random() - .3) * .006 });
  }
  if (smk.ev==='rain' && el > 2500){
    const k = Math.min(1, (el - 2500) / 1500); c.fillStyle = 'rgba(159,211,255,.7)';
    for (let i = 0; i < 70 * k; i++){ const x = (i * 37 + Math.floor(now / 12) * 3) % (SW + 20) - 10, y = (i * 23 + Math.floor(now / 8) * 4) % SH; c.fillRect(x, y, 1, 3); c.fillRect(x - 1, y + 3, 1, 1); }
  }
  if (smk.ev==='boss' && el > 4000) drawAhJie(c, Math.min(1, (el - 4000) / 400));
  if (smk.ev==='her'){
    const stop = Math.min(SW - 22, must(smokeScene, 'smokeScene').tip[0] + 18), hx = Math.round(el < 1500 ? SW + 4 : el < 3000 ? SW + 4 - (SW + 4 - stop) * (el - 1500) / 1500 : stop);
    fig(c, hx, GROUND, HER_POSE, true);
    if (el > 3000 && Math.random() < .08) puffs.push({ x: hx + 3, y: GROUND - 27, born: now, dx: (Math.random() - .6) * .006 });
  }
  // 支煙：冇咗人就跌喺地下
  let [tx, ty] = must(smokeScene, 'smokeScene').tip;
  if (smk.gone){ tx = must(smokeScene, 'smokeScene').tip[0]; ty = GROUND - 1; c.fillStyle = '#fbfaf4'; c.fillRect(tx - 3, ty, 3, 1); c.fillStyle = '#ff7a3a'; c.fillRect(tx, ty, 1, 1); }
  // 彈煙灰
  if (!smk.gone && now - (smk.ashAt || 0) > 3200){ smk.ashAt = now; ash.push({ x: tx, y: ty, v: 0 }); }
  ash = ash.filter(a => a.y < GROUND); ash.forEach(a => { a.v += .02; a.y += a.v; c.fillStyle = '#8a8f94'; c.fillRect(Math.round(a.x), Math.round(a.y), 1, 1); });
  if (!smk.wet && Math.random() < (smk.gone ? .05 : .12)) puffs.push({ x: tx, y: ty, born: now, dx: (Math.random() - .3) * .006 });
  puffs = puffs.filter(p => now - p.born < 2600);
  puffs.forEach(p => {
    const a = (now - p.born) / 2600, x = Math.round(p.x + (now - p.born) * p.dx + Math.sin((now - p.born) / 300) * 1.5), y = Math.round(p.y - a * 26), s = 1 + Math.floor(a * 3);
    c.fillStyle = `rgba(${must(smokeScene, 'smokeScene').smoke || '230,236,240'},${(.6 * (1 - a)).toFixed(2)})`; c.fillRect(x, y, s, s);
  });
  smokeRaf = requestAnimationFrame(drawSmoke);
}
// 撳暫停：隨機揀一個（盡量揀未見過嘅）
export function smokeShow(): void {
  const cv = $('smokeCv'); if (!cv) return;
  if (typeof bossEl!=='undefined' && bossEl) bossEl.hidden = true;
  // The JS called cv.getContext() next, which threw on an element that is not a canvas.
  if (!(cv instanceof HTMLCanvasElement)) throw new TypeError('chakei: #smokeCv is not a canvas');
  smokeCtx = cv.getContext('2d'); must(smokeCtx, 'smoke canvas context').imageSmoothingEnabled = false;
  const seen = must(SHOP.eggs, 'SHOP.eggs').smoke || [], fresh = SMOKE_SCENES.filter(s => !seen.includes(s.id));
  // pick() of a non-empty list: pickSure only adds the throw the JS hit on the next line's smokeScene.id.
  smokeScene = pickSure(fresh.length && Math.random() < .7 ? fresh : SMOKE_SCENES);
  if (!seen.includes(smokeScene.id)){ must(SHOP.eggs, 'SHOP.eggs').smoke = [...seen, smokeScene.id]; saveShop(); }
  must($('smokeLine'), 'smokeLine').textContent = `「${smokeScene.line}」`;
  // 小劇情：每個場景有自己幾個隱藏結局（雪櫃彈開、師傅借火、阿姐捉人、貓偷多士、落大雨），有機會乜都冇
  const r = Math.random(), id = smokeScene.id;
  // 大約四至五次先有一次劇情；雪櫃、貓、落雨更罕有（二十次左右一次）
  const ev = id==='kitchen' ? (r < .05 ? 'fridge' : r < .13 ? 'light' : r < .22 ? 'boss' : null)
    : id==='backdoor' ? (r < .1 ? 'boss' : r < .2 ? 'light' : null)
    : (r < .05 ? 'cat' : r < .11 ? 'rain' : r < .2 ? 'boss' : null);
  // 後巷、後門有時會撞到佢（大約八次一次）
  const her = id!=='kitchen' && Math.random() < .12;
  smk = { t0: performance.now(), ev: her ? 'her' : ev, toast: smokeScene.id==='alley' && !her, catX: her ? 200 : 85, again: pick(HER_AGAIN) };
  puffs = []; ash = []; if (!smokeRaf) smokeRaf = requestAnimationFrame(drawSmoke);
}
