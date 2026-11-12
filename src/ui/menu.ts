// 食譜：開舖淨係識整幾樣，用積蓄學新菜式（客人先會叫）；早期易啲，後期貴價菜賺多啲
// TypeScript port of the original game's menu.js, as an ES module: every
// top-level name is exported, none renamed.
import './juice';   // load order: src/entry.ts
import { must } from '../core/util';
import { G, liveG } from '../core/state';
import { SETS, FOODS, DISHES, DRINKS, SLOT_KIT, LUNCH_R, UP_TIP } from '../core/data/menus';
import { $ } from './prefs';
import { toast } from './ui';
import { kCanvas, P, el, bx, INK } from './kitchen';
import { PX, setPX } from './pixel';
import { iconImg } from './icons';
import { SHOP, saveShop } from './decor';
import { sfx } from './juice';
import { shopSells, rLv, needOf, UP_COST, needHtml, fancyName, toggleSell, haveAll, spendIng } from './market';
import { lvGet, LEVELS, closestIn } from './levels';

/* ===================== 邊啲菜式要學 ===================== */
// k = 種類:名（s 早餐、f 午市、d 晚市、k 飲品）；p = 學費（0 = 一開舖就識）
export const RECIPES: RecipeBook = {
  breakfast: { name:'早市', items:[ ['s:A餐',0], ['s:B餐',0], ['s:C餐',500], ['s:常餐',900] ] },
  lunch:     { name:'午市', items:[ ['f:餐蛋麵',0], ['f:火腿通粉',0], ['f:西多士',0], ['f:菠蘿油',0], ['f:沙嗲牛麵',400], ['f:常餐',700], ['f:乾炒牛河',1000], ['f:焗豬扒飯',1300] ] },
  dinner:    { name:'晚市', items:[ ['d:粟米肉粒飯',0], ['d:番茄牛肉飯',0], ['d:揚州炒飯',0], ['d:豉椒排骨飯',500], ['d:咖喱牛腩飯',700], ['d:白汁雞皇飯',800], ['d:鹹魚雞粒炒飯',1000], ['d:焗豬扒飯',1300] ] },
  drinks:    { name:'飲品', items:[ ['k:奶茶',0], ['k:檸茶',0], ['k:檸水',300], ['k:鴛鴦',400], ['k:咖啡',300], ['k:齋啡',300], ['k:茶走',500], ['k:啡走',500] ] },
};
// 秘傳食譜：喺嗰個關卡攞兩粒星先報讀得，學識之後自己間舖午市都有得賣（廚房自動加埋要用嘅料）
export const SPECIAL: Record<string, SpecialRecipe> = {
  'f:城寨叉燒飯':   { lv:'kwc',        p:1200 },
  'f:豬扒包':       { lv:'milktea',    p:1000 },
  'f:蔥油雞扒撈丁': { lv:'milktea',    p:1100 },
  'f:炒蛋多士':     { lv:'fastmilk',   p:800 },
  'f:燉奶':         { lv:'fastmilk',   p:700 },
  'f:蛋撻':         { lv:'bingsutt',   p:900 },
  'f:火腿三文治':   { lv:'bingsutt',   p:600 },
  'f:牛油多士':     { lv:'bingsutt',   p:400 },
  'f:油占多':       { lv:'daipaidong', p:500 },
  'f:奶油多':       { lv:'daipaidong', p:500 },
  'k:紅豆冰':       { lv:'bingsutt',   p:800 },
  'k:阿華田':       { lv:'bingsutt',   p:600 },
  // 萬聖限定：萬聖節攞兩粒星先報讀得，學識咗一直留低
  'f:吸血鬼多士':   { lv:'halloween',  p:700, kit:{ st:{ toaster:['多士'] }, inst:['果占'] } },
};
export const SPECIAL_STARS = 2;
export const specialOpen = (k: string): boolean => ((must(SHOP.levels, 'SHOP.levels')[must(SPECIAL[k], 'special ' + k).lv] ?? 0)|0) >= SPECIAL_STARS;
export const RECIPE_FEE: Record<string, number> = Object.fromEntries(Object.values(RECIPES).flatMap(g => g.items));
SHOP.recipes = SHOP.recipes || [];
// 識唔識整（教學關一律用開舖就識嗰幾樣，唔受影響）
// 冰室嘢只喺年代關卡出（平時間舖冇得學）
export const ERA_ONLY = new Set(['f:蛋撻','f:牛油多士','f:火腿三文治','k:紅豆冰','k:阿華田','f:油占多','f:奶油多','f:城寨叉燒飯','f:豬扒包','f:蔥油雞扒撈丁','f:炒蛋多士','f:燉奶','f:吸血鬼多士']);
export const shopKnows = (key: string): boolean => SPECIAL[key] ? must(SHOP.recipes, 'SHOP.recipes').includes(key) : !ERA_ONLY.has(key) && (!RECIPE_FEE[key] || must(SHOP.recipes, 'SHOP.recipes').includes(key));
// 自己間舖午市廚房：學咗秘傳食譜，就由嗰關嘅廚房搬埋要用嘅爐具料同即放料過嚟
export let shopKitKey = '', shopKitVal: LevelKit | null = null;
export function shopLunchKit(): LevelKit {
  const learnt = must(SHOP.recipes, 'SHOP.recipes').filter(k => SPECIAL[k] && k[0]==='f'), key = learnt.join('|');
  if (key===shopKitKey && shopKitVal) return shopKitVal;
  const base = SLOT_KIT.lunch, out: LevelKit = { st: Object.fromEntries(Object.entries(base.st).map(([s, l]) => [s, [...l]])), inst:[...base.inst] };
  learnt.forEach(k => {
    const sp = must(SPECIAL[k], 'special ' + k), kit = sp.kit || lvGet(sp.lv).kit; if (!kit) return;
    must(LUNCH_R[k.slice(2)], 'lunch recipe ' + k).forEach(t => {
      for (const [st, items] of Object.entries(kit.st)) for (const it of items) if (t.startsWith(it)){ const have = (out.st[st] = out.st[st] || []); if (!have.includes(it)) have.push(it); }
      if (kit.inst.includes(t) && !out.inst.includes(t)) out.inst.push(t);
    });
  });
  shopKitKey = key; shopKitVal = out; return out;
}
// 關卡有自己嘅餐牌（唔理自己學咗乜）
export const menuOpen = (key: string): boolean => {
  const L = G && G.level ? LEVELS[G.level] : undefined;
  return L ? L.menu.includes(key) : (typeof shopSells==='function' ? shopSells(key) : shopKnows(key));
};
// 廚房掣：同菜式同名嘅爐具掣，未學就收埋
export function kitItemOpen(x: string): boolean {
  const S = liveG();
  if (S.slot==='dinner') return x==='咖喱牛腩' ? menuOpen('d:咖喱牛腩飯') : RECIPE_FEE['d:' + x] === undefined || menuOpen('d:' + x);
  if (S.slot==='lunch') return RECIPE_FEE['f:' + x] === undefined || menuOpen('f:' + x);
  return true;
}
// 售價（俾玩家睇學咗值唔值）
export function sellPrice(key: string): number | undefined {
  const [ns, id] = key.split(':');
  const lists: Record<string, MenuItem[]> = { s:SETS, f:FOODS, d:DISHES, k:DRINKS };
  return must(lists[String(ns)], 'menu ' + String(ns)).find(x => x.id===id)?.p;
}
/* ===================== 食譜頁 ===================== */
export const ACADEMY = '中國廚藝訓練學院';
export let recTab: string | undefined = 'lunch';
export function recipeRow(k: string, fee: number, special?: SpecialRecipe): string {
  const ok = shopKnows(k), lock = special && !specialOpen(k), lv = rLv(k), need = needOf(k);   // the JS also computed an unused `free = !fee && !special` (no side effects)
  let act;
  if (ok){
    const up = UP_COST[lv + 1], upNeed = up && needOf(k, up.x);
    act = `<span class="rstars">${'★'.repeat(lv)}<i>${'★'.repeat(3 - lv)}</i></span>
      ${up && upNeed ? `<span class="rneed">${needHtml(upNeed)}</span><button type="button" class="up" data-up="${k}">升${'★'.repeat(lv + 1)} $${up.p}</button>` : '<em>招牌菜 · 每碟貼士 +$' + String(UP_TIP[3]) + '</em>'}
      <button type="button" class="sell${must(SHOP.off, 'SHOP.off').includes(k) ? ' off' : ''}" data-sell="${k}">${must(SHOP.off, 'SHOP.off').includes(k) ? '冇擺上餐牌' : '✓ 上咗餐牌'}</button>`;
  }
  else if (lock) act = `<i class="rlock">🔒「${lvGet(special.lv).name}」${SPECIAL_STARS}★</i>`;
  else act = `<span class="rneed">${needHtml(need)}</span><button type="button" data-learn="${k}">報讀 $${fee}</button>`;
  return `<li class="${ok ? 'ok' : ''}${lock ? ' lock' : ''}${lv >= 3 ? ' sig' : ''}">${iconImg('menu', k + '#' + String(ok ? lv : 1))}<b>${String(fancyName(k))}</b><span>賣 $${String(sellPrice(k))}${special ? ` · ${lvGet(special.lv).name}` : ''}${lv >= 3 ? ` · 原名${String(k.split(':')[1])}` : ''}</span>${act}</li>`;
}
export function openRecipes(): void {
  const all = [...Object.keys(RECIPE_FEE), ...Object.keys(SPECIAL)], have = all.filter(shopKnows).length;
  const tabs = [...Object.entries(RECIPES).map(([k, g]) => [k, g.name]), ['special', '秘傳']];
  const body = recTab==='special'
    ? `<p class="hint">各大名店嘅招牌菜。喺嗰個關卡攞 ${SPECIAL_STARS} 粒星，先可以報讀；學識咗自己間舖午市都賣得。</p><ul class="recipes">${Object.entries(SPECIAL).map(([k, s]) => recipeRow(k, s.p, s)).join('')}</ul>`
    : `<ul class="recipes">${must(Object.fromEntries(Object.entries(RECIPES))[String(recTab)], 'recipe tab ' + String(recTab)).items.map(([k, fee]) => recipeRow(k, fee)).join('')}</ul>`;
  must($('book'), 'book').innerHTML = `<div class="academy"><canvas id="acadCv" width="180" height="78" aria-hidden="true"></canvas><b class="acad-name">${ACADEMY}</b></div>
    <div class="sh-head"><b>${ACADEMY}</b><span>識整 ${have}/${all.length} · 積蓄 $${SHOP.bank}</span></div>
    <p class="hint">交學費、儲夠食材學新菜，學成歸來客人先會叫。學識咗可以用食材升級：二星每碟貼士 +$${String(UP_TIP[2])}，三星變招牌菜（+$${String(UP_TIP[3])}、賣相靚晒、多人叫）。撳「上咗餐牌」可以自己揀賣邊啲。</p>
    <div class="drow"><button type="button" class="dbtn alt" id="pantryBtn">雪櫃：睇食材</button></div>
    <div class="lvtabs rtabs">${tabs.map(([k, n]) => `<button type="button" data-rt="${String(k)}" aria-selected="${String(k===recTab)}">${String(n)}</button>`).join('')}</div>
    ${body}
    <button type="button" class="big" id="bookClose">返回</button>`;
  drawAcademy(kCanvas('acadCv'));
  must($('bookView'), 'bookView').hidden = false;
}
// 學院門口：紅柱黃牆、牌匾，一班和尚拎住鑊同鑊鏟扎馬練功（原創像素圖）
export function drawAcademy(cv: HTMLCanvasElement): void {
  const c = cv.getContext('2d'), keep = PX; setPX(c);
  try {
    P(0, 0, 180, 78, '#9cc8ec'); P(0, 0, 180, 14, '#7ab0e0');
    P(0, 18, 180, 4, '#7a1f1f'); for (let x = 0; x < 180; x += 6) P(x, 16, 4, 3, '#a5372f');   // 兩邊瓦簷
    P(0, 22, 180, 34, '#e9b23a'); P(0, 22, 180, 2, '#c8901a');
    ([[22, '#c8323c'], [72, '#c8323c']] as const).forEach(([cx]) => { el(cx, 38, 12, 11, '#f2d27a', '#a5372f'); el(cx, 38, 8, 7, '#e9b23a', '#c8901a'); el(cx + 1, 39, 5, 2, '#2b3036'); P(cx + 5, 38, 5, 1, '#8a5a32'); });   // 圓形鑊圖案
    el(130, 38, 12, 11, '#f2d27a', '#a5372f'); el(130, 38, 8, 7, '#e9b23a', '#c8901a'); el(131, 39, 5, 2, '#2b3036'); P(135, 38, 5, 1, '#8a5a32');
    for (const x of [44, 52, 104, 112]) bx(x, 16, 6, 42, '#c8323c', '#e04a4a', '#a5372f');   // 紅柱
    bx(56, 4, 48, 8, '#7a1f1f', '#a5372f'); P(50, 12, 60, 3, '#5a1414'); for (let x = 50; x < 110; x += 5) P(x, 10, 3, 2, '#e9b23a');   // 門樓瓦頂
    bx(58, 18, 44, 10, '#2b2420', '#3a2a20'); P(60, 20, 40, 6, '#e9b23a'); P(61, 21, 38, 4, '#2b2420');   // 牌匾（字喺 HTML）
    P(58, 30, 44, 26, '#a5372f'); P(70, 34, 20, 22, '#5a1414');   // 門口
    P(0, 56, 180, 22, '#c9b8a0'); for (let x = 0; x < 180; x += 12) for (let y = 58; y < 78; y += 6) P(x + ((y / 6) % 2) * 6, y, 11, 1, '#b8a890');
    // 和尚：光頭、灰袍，拎鑊或者鑊鏟
    const monk = (x: number, y: number, pose: string, sz = 1): void => {
      const robe = '#d8d2c4', sash = '#e98a2a', skin = '#f0c8a0';
      el(x, y - 18 * sz, 3 * sz, 3 * sz, skin, INK);                      // 光頭
      P(x - 3 * sz, y - 15 * sz, 7 * sz, 8 * sz, robe); P(x - 3 * sz, y - 10 * sz, 7 * sz, 1, sash);
      if (pose==='horse'){ P(x - 7 * sz, y - 7 * sz, 5 * sz, 3 * sz, robe); P(x + 3 * sz, y - 7 * sz, 5 * sz, 3 * sz, robe); P(x - 8 * sz, y - 4 * sz, 2 * sz, 4 * sz, robe); P(x + 7 * sz, y - 4 * sz, 2 * sz, 4 * sz, robe);
        P(x + 4, y - 14 * sz, 6, 2, robe); el(x + 12, y - 14 * sz, 4, 2, '#2b3036'); }                 // 扎馬托鑊
      else if (pose==='ladle'){ P(x - 2, y - 7 * sz, 2, 7 * sz, robe); P(x + 2, y - 7 * sz, 2, 7 * sz, robe); P(x + 4, y - 20 * sz, 2, 6, robe); P(x + 5, y - 26 * sz, 1, 7, '#8d9aa2'); P(x + 3, y - 27 * sz, 5, 2, '#8d9aa2'); }   // 舉鑊鏟
      else if (pose==='kick'){ P(x - 2, y - 7 * sz, 2, 7 * sz, robe); P(x + 3, y - 11 * sz, 9, 2, robe); P(x - 8, y - 14 * sz, 6, 2, robe); }   // 踢腿
      else { P(x - 4 * sz, y - 7 * sz, 9 * sz, 3 * sz, robe); P(x - 1, y - 14 * sz, 2, 4, skin); }   // 細路和尚合十
    };
    monk(22, 74, 'horse'); monk(46, 72, 'ladle'); monk(88, 77, 'pray', 1); monk(120, 72, 'kick'); monk(150, 74, 'horse'); monk(166, 70, 'ladle');
  } finally { setPX(keep); }
}
must($('book'), 'book').addEventListener('click', e => {
  const t = closestIn(e.target, 'button[data-rt]'); if (t){ recTab = t.dataset.rt; openRecipes(); return; }
  const sl = closestIn(e.target, 'button[data-sell]'); if (sl){ if (toggleSell(must(sl.dataset.sell, 'data-sell'))) openRecipes(); return; }
  const u = closestIn(e.target, 'button[data-up]');
  if (u){ const k = must(u.dataset.up, 'data-up'), nx = rLv(k) + 1, c = must(UP_COST[nx], 'upgrade ' + String(nx)), need = needOf(k, c.x);
    if (!haveAll(need)){ toast('食材唔夠升級'); return; }
    if (SHOP.bank < c.p){ toast(`唔夠錢，仲差 $${c.p - SHOP.bank}`); return; }
    SHOP.bank -= c.p; spendIng(need); must(SHOP.rlv, 'SHOP.rlv')[k] = nx; saveShop(); sfx.fanfare();
    toast(nx >= 3 ? `${String(k.split(':')[1])}升做招牌菜：「${String(fancyName(k))}」！` : `${String(k.split(':')[1])}升到 ${'★'.repeat(nx)}`);
    openRecipes(); return; }
  const b = closestIn(e.target, 'button[data-learn]'); if (!b) return;
  const k = must(b.dataset.learn, 'data-learn'), sp = SPECIAL[k], fee = (sp ? sp.p : RECIPE_FEE[k]) ?? NaN;
  if (sp && !specialOpen(k)){ toast(`喺「${lvGet(sp.lv).name}」攞 ${SPECIAL_STARS} 粒星先報讀得`); return; }
  if (SHOP.bank < fee){ toast(`唔夠錢，仲差 $${fee - SHOP.bank}`); return; }
  if (!haveAll(needOf(k))){ toast('食材唔夠，等街市送貨或者開多幾更'); return; }
  SHOP.bank -= fee; spendIng(needOf(k)); must(SHOP.recipes, 'SHOP.recipes').push(k); saveShop(); sfx.fanfare(); toast(`${ACADEMY}畢業！學識咗${String(k.split(':')[1])}`);
  openRecipes();
});
must($('recipeBtn'), 'recipeBtn').onclick = openRecipes;
