// 街市食材同茶記評級：每四個鐘街市送一箱貨、收工都有食材；學新菜要儲夠食材，學識咗可以再用食材升級（賣相靚啲、貼士多啲）
// TypeScript port of the original game's market.js, as an ES module: every
// top-level name is exported. SHOP fields other than the starting shop are optional in
// the save type (types/decor.d.ts), so reading one the JS assumed is there goes through must() / `?? NaN`.
import './menu';   // load order: src/entry.ts
import { must } from '../core/util';
import { pickSure } from '../core/rng';
import { $ } from './prefs';
import { G, liveG } from '../core/state';
import { toast } from './ui';
import { iconImg } from './icons';
import { SHOP, saveShop, evEl, fixedShop, LOOKS, ITEMS, TKINDS, SIZES, TDEF, PLACES } from './decor';
import { sfx } from './juice';
import { shopKnows, RECIPE_FEE, SPECIAL } from './menu';
import { todayStr, renderCareer } from './career';
import { LEVELS, levelOpen } from './levels';
import { gateOk } from './gates';
import { NET } from '../net/net';
import { shopName } from './main';
import { levelSeats } from '../core/career/seats';
import { isSig } from '../core/rules/order';
import { shiftCosts, type Costs } from '../core/career/pressure';

/* ===================== 食材 ===================== */
export const INGR = ['雞蛋','午餐肉','火腿','叉燒','牛肉','豬扒','雞肉','麵','麵包','白米','茶葉','咖啡豆','煉奶','檸檬','紅豆'];
SHOP.ing = SHOP.ing || {};
// 開舖禮包：新玩家一開始就夠學幾樣入門菜（沙嗲牛麵、檸水、咖啡、鴛鴦）
if (!SHOP.ingStart){ SHOP.ingStart = true; Object.entries({ 牛肉:3, 麵:2, 檸檬:2, 茶葉:2, 咖啡豆:4 }).forEach(([i, n]) => { must(SHOP.ing, 'SHOP.ing')[i] = ((must(SHOP.ing, 'SHOP.ing')[i] ?? 0)|0) + n; }); }
// 街市買餸：缺邊樣可以用錢買；冇每日上限，有錢就買得
export const BUY_P = 80;
export const boughtToday = (): number => SHOP.buyDay===todayStr() ? (SHOP.buyN ?? 0)|0 : 0;
export function buyIng(i: string): void {
  if (SHOP.bank < BUY_P){ toast(`唔夠錢，仲差 $${BUY_P - SHOP.bank}`); return; }
  SHOP.bank -= BUY_P; must(SHOP.ing, 'SHOP.ing')[i] = ((must(SHOP.ing, 'SHOP.ing')[i] ?? 0)|0) + 1; SHOP.buyN = boughtToday() + 1; SHOP.buyDay = todayStr(); saveShop();
  toast(`買咗一份${i}`); openPantry();
}
// 每樣菜要乜食材（學嘅時候要；升級要兩倍、三倍）
export const NEED: Record<string, Record<string, number>> = {
  's:A餐':{ 火腿:2, 麵包:1 }, 's:B餐':{ 午餐肉:2, 麵包:1 }, 's:C餐':{ 牛肉:2, 麵包:2 }, 's:常餐':{ 叉燒:2, 雞蛋:2, 麵包:1 },
  'f:餐蛋麵':{ 午餐肉:2, 雞蛋:2, 麵:1 }, 'f:火腿通粉':{ 火腿:2, 麵:2 }, 'f:西多士':{ 麵包:2, 雞蛋:2 }, 'f:菠蘿油':{ 麵包:3 },
  'f:沙嗲牛麵':{ 牛肉:3, 麵:2 }, 'f:常餐':{ 叉燒:2, 雞蛋:2, 麵包:2 }, 'f:乾炒牛河':{ 牛肉:3, 麵:3 }, 'f:焗豬扒飯':{ 豬扒:3, 白米:3 },
  'd:粟米肉粒飯':{ 豬扒:1, 白米:2 }, 'd:番茄牛肉飯':{ 牛肉:2, 白米:2 }, 'd:揚州炒飯':{ 叉燒:1, 雞蛋:1, 白米:2 }, 'd:豉椒排骨飯':{ 豬扒:2, 白米:2 },
  'd:咖喱牛腩飯':{ 牛肉:3, 白米:2 }, 'd:白汁雞皇飯':{ 雞肉:3, 白米:2 }, 'd:鹹魚雞粒炒飯':{ 雞肉:2, 雞蛋:1, 白米:3 }, 'd:焗豬扒飯':{ 豬扒:3, 白米:3 },
  'k:奶茶':{ 茶葉:2 }, 'k:檸茶':{ 茶葉:1, 檸檬:1 }, 'k:檸水':{ 檸檬:2 }, 'k:鴛鴦':{ 茶葉:2, 咖啡豆:2 }, 'k:咖啡':{ 咖啡豆:2 }, 'k:齋啡':{ 咖啡豆:3 },
  'k:茶走':{ 茶葉:2, 煉奶:2 }, 'k:啡走':{ 咖啡豆:2, 煉奶:2 },
  'f:城寨叉燒飯':{ 叉燒:4, 白米:3, 雞蛋:2 }, 'f:豬扒包':{ 豬扒:3, 麵包:3 }, 'f:蔥油雞扒撈丁':{ 雞肉:3, 麵:3 }, 'f:炒蛋多士':{ 雞蛋:4, 麵包:2 },
  'f:燉奶':{ 雞蛋:3, 煉奶:1 }, 'f:蛋撻':{ 雞蛋:3, 麵包:1 }, 'f:火腿三文治':{ 火腿:2, 麵包:2 }, 'f:牛油多士':{ 麵包:2 }, 'f:油占多':{ 麵包:2 },
  'f:奶油多':{ 麵包:2, 煉奶:1 }, 'k:紅豆冰':{ 紅豆:3, 煉奶:1 }, 'k:阿華田':{ 煉奶:2 },
  'f:吸血鬼多士':{ 麵包:2, 紅豆:1 },
};
// 升級：二星要兩倍食材加 $300，三星三倍加 $800；三星有招牌名
export const UP_COST: Record<number, { x: number; p: number }> = { 2: { x:2, p:300 }, 3: { x:3, p:800 } };
export const FANCY: Record<string, string> = { 城寨叉燒飯:'黯然銷魂飯', 奶茶:'絲襪奶茶', 菠蘿油:'冰火菠蘿油', 西多士:'流心西多士', 餐蛋麵:'金牌餐蛋麵', 乾炒牛河:'鑊氣乾炒牛河', 焗豬扒飯:'芝士焗豬扒飯',
  鴛鴦:'黃金鴛鴦', 檸茶:'手打檸茶', 豬扒包:'脆皮豬扒包', 蛋撻:'酥皮蛋撻', 茶走:'古法茶走', 揚州炒飯:'金牌揚州炒飯', 炒蛋多士:'滑蛋多士', 常餐:'豪華常餐' };
SHOP.rlv = SHOP.rlv || {};
export const rLv = (k: string): number => must(SHOP.rlv, 'SHOP.rlv')[k] || 1;
/** undefined for a key with no ':' (as in the JS). */
export const fancyName = (k: string): string | undefined => { const id = k.split(':')[1]; return rLv(k) >= 3 ? (FANCY[String(id)] || '招牌' + String(id)) : id; };
export const needOf = (k: string, x = 1): Record<string, number> => Object.fromEntries(Object.entries(NEED[k] || {}).map(([i, n]) => [i, n * x]));
export const haveAll = (need: Record<string, number>): boolean => Object.entries(need).every(([i, n]) => ((must(SHOP.ing, 'SHOP.ing')[i] ?? 0)|0) >= n);
export function spendIng(need: Record<string, number>): void { Object.entries(need).forEach(([i, n]) => { must(SHOP.ing, 'SHOP.ing')[i] = ((must(SHOP.ing, 'SHOP.ing')[i] ?? 0)|0) - n; }); }
export function gainIng(list: string[]): void { list.forEach(i => { must(SHOP.ing, 'SHOP.ing')[i] = ((must(SHOP.ing, 'SHOP.ing')[i] ?? 0)|0) + 1; }); }
export const randIng = (): string => pickSure(INGR);
export const needHtml = (need: Record<string, number>): string => Object.entries(need).map(([i, n]) => `<span class="ingn${((must(SHOP.ing, 'SHOP.ing')[i] ?? 0)|0) >= n ? '' : ' short'}">${iconImg('ingr', i)}${i} ${(must(SHOP.ing, 'SHOP.ing')[i] ?? 0)|0}/${n}</span>`).join('');

/* ===================== 街市送貨 ===================== */
export const CRATE_MS = 4 * 3600 * 1000, CRATE_N = 3;
// crateNext may come from a phone whose clock is ahead (cloud save), or this clock was set back: a next crate more
// than one wait away is pulled back to one wait from now, so nobody waits longer than CRATE_MS.
export const crateReady = (): boolean => {
  if ((SHOP.crateNext || 0) > Date.now() + CRATE_MS){ SHOP.crateNext = Date.now() + CRATE_MS; saveShop(); }
  return Date.now() >= (SHOP.crateNext || 0);
};
export function crateLeft(): string { const ms = Math.max(0, (SHOP.crateNext || 0) - Date.now()), h = Math.floor(ms / 3600000), m = Math.ceil(ms % 3600000 / 60000); return h ? `${h} 個鐘 ${m} 分鐘` : `${m} 分鐘`; }
export function claimCrate(): void {
  if (!crateReady()){ toast(`下一車貨 ${crateLeft()} 後先到`); return; }
  const got = Array.from({ length: CRATE_N }, randIng);
  gainIng(got); SHOP.crateNext = Date.now() + CRATE_MS; saveShop(); sfx.fanfare();
  toast(`街市送貨到！收到 ${got.join('、')}`); renderCareer();
}
export function crateHtml(): string {
  return crateReady()
    ? `<div class="crate ready"><span>${iconImg('how', 'crate')}<b>街市送貨到！</b>一箱 ${CRATE_N} 樣食材</span><button type="button" id="crateBtn">收貨</button></div>`
    : `<div class="crate"><span>${iconImg('how', 'crate')}下一車貨 <b>${crateLeft()}</b> 後到</span><button type="button" id="pantryBtn" class="alt">雪櫃</button></div>`;
}
document.addEventListener('click', e => {
  const bi = evEl(e.target).closest('button[data-buying]'); if (bi instanceof HTMLElement){ buyIng(String(bi.dataset.buying)); return; }
  if (evEl(e.target).closest('#crateBtn')) claimCrate();
  else if (evEl(e.target).closest('#pantryBtn')) openPantry();
});
setInterval(() => { const v = $('startView'); if (v && !v.hidden && $('career')) { const c = document.querySelector('#career .crate'); if (c) c.outerHTML = crateHtml(); } }, 30000);
// 收工：自己間舖同關卡都有食材（每日挑戰多兩份）
export function shiftIngr(stars: number, daily?: boolean): string {
  if (!G || G.tut || (G.coop && NET.role==='client')) return '';
  const lv = G.level && LV_INGR[G.level], n = 2 + (stars >= 3 ? 1 : 0) + (daily ? 2 : 0) + (G.level && G.level===pickLevel() ? 2 : 0);
  // An LV_INGR list is never empty, so lv[i % lv.length] is always there.
  const got = Array.from({ length: n }, (_, i) => lv && i < 2 + (stars >= 3 ? 1 : 0) ? must(lv[i % lv.length], 'level ingredient') : randIng());
  gainIng(got); saveShop();
  return `<div class="wide ingw"><span>街市食材</span><b>${got.map(i => iconImg('ingr', i)).join('')}</b><span>${got.join('、')}</span></div>`;
}
export function openPantry(): void {
  must($('book'), 'book').innerHTML = `<div class="sh-head"><b>雪櫃</b><span>學菜、升級用</span></div>
    <p class="hint">街市買餸：每樣 $${BUY_P}，有錢就買，冇上限 · 積蓄 $${SHOP.bank}</p>
    <ul class="pantry">${INGR.map(i => `<li>${iconImg('ingr', i)}<b>${i}</b><span>× ${(must(SHOP.ing, 'SHOP.ing')[i] ?? 0)|0}</span><button type="button" data-buying="${i}">買 $${BUY_P}</button></li>`).join('')}</ul>
    <p class="hint">每 4 個鐘街市送一箱貨（${CRATE_N} 樣），收工又會有兩三樣。去「食譜」學新菜、升級招牌菜。</p>
    <button type="button" class="big" id="bookClose">返回</button>`;
  must($('bookView'), 'bookView').hidden = false;
}
export const inMyShop = (): boolean | null => G && !G.level && !G.tut && !(typeof fixedShop!=='undefined' && fixedShop);
export const sigMark = (k: string): string => isSig(k) ? '<i class="sigm">招牌</i>' : '';

/* ===================== 自訂餐牌 ===================== */
SHOP.off = SHOP.off || [];
export const shopSells = (k: string): boolean => shopKnows(k) && !must(SHOP.off, 'SHOP.off').includes(k);
export function toggleSell(k: string): boolean {
  if (must(SHOP.off, 'SHOP.off').includes(k)){ SHOP.off = must(SHOP.off, 'SHOP.off').filter(x => x!==k); saveShop(); return true; }
  const ns = k[0], same = [...Object.keys(RECIPE_FEE), ...Object.keys(SPECIAL)].filter(x => x[0]===ns && x!==k && shopSells(x));
  if (!same.length){ toast('每類最少要賣一樣'); return false; }
  must(SHOP.off, 'SHOP.off').push(k); saveShop(); return true;
}

/* ===================== 茶記評級 ===================== */
// 裝修、食譜、人流、地段四樣加埋計分；一至五碗
export const GRADES: [number, string][] = [ [0, '街坊小店'], [12, '區內人氣'], [28, '排隊名店'], [48, '全港推介'], [70, '茶記殿堂'] ];
export const PLACE_PTS: Record<string, number> = { 'pl-town':0, 'pl-village':3, 'pl-estate':4, 'pl-rainbow':5, 'pl-walled':6, 'pl-jordan':7, 'pl-haunt':4, 'pl-central':9 };
SHOP.servedTotal = (SHOP.servedTotal ?? 0)|0;
export function teaScore(): TeaScore {
  const looks = SHOP.own.reduce((a, k) => a + ((LOOKS.wall[k] || LOOKS.floor[k] || LOOKS.sign[k] || LOOKS.awning[k])?.p || 0), 0);
  const deco = looks + SHOP.items.reduce((a, q) => { const it = ITEMS[q.type]; return a + (it ? it.p : 0); }, 0) + SHOP.tables.reduce((a, t) => a + must(TKINDS[t.kind], 'table kind ' + t.kind).p, 0) + SIZES.slice(0, SHOP.size + 1).reduce((a, z) => a + z.p, 0);
  const keys = [...Object.keys(RECIPE_FEE), ...Object.keys(SPECIAL)].filter(k => shopKnows(k));
  const parts = {
    deco: Math.min(30, Math.max(0, Math.round((deco - TDEF.reduce((a, [k]) => a + must(TKINDS[k], 'table kind ' + k).p, 0)) / 600))),   // 開舖本身嗰六張枱唔計
    menu: Math.min(30, keys.filter(k => SPECIAL[k] || RECIPE_FEE[k]).length + keys.reduce((a, k) => a + (rLv(k) - 1) * 2, 0)),
    flow: Math.min(20, Math.round((SHOP.servedTotal ?? NaN) / 40)),
    place: (PLACE_PTS[SHOP.place] || 0) + (SHOP.own.filter(k => PLACES[k]).length - 1),
  };
  return { parts, total: Object.values(parts).reduce((a, b) => a + b, 0) };
}
export function teaGrade(): TeaGrade {
  const s = teaScore(); let g = 0; GRADES.forEach(([n], i) => { if (s.total >= n) g = i; });
  return { g: g + 1, name: must(GRADES[g], 'grade')[1], next: GRADES[g + 1], ...s };
}
export const gradeFlow = (): number => inMyShop() ? 1 + .04 * (teaGrade().g - 1) : 1;
export const bowls = (n: number): string => `<span class="bowls">${Array.from({ length: 5 }, (_, i) => iconImg('how', i < n ? 'bowl' : 'bowl0')).join('')}</span>`;
export function gradeHtml(): string {
  const t = teaGrade();
  return `<button type="button" class="grade" id="gradeBtn"><span><small>茶記評級</small><b>${t.name}</b></span>${bowls(t.g)}</button>`;
}
export function openGrade(): void {
  const t = teaGrade(), P_ = t.parts;
  const row = (n: string, v: number, max: number, tip: string): string => `<li><b>${n}</b><span class="gbar"><i style="width:${Math.round(v / max * 100)}%"></i></span><em>${v}/${max}</em><small>${tip}</small></li>`;
  must($('book'), 'book').innerHTML = `<div class="sh-head"><b>茶記評級</b><span>${shopName()}</span></div>
    <div class="gradebig">${bowls(t.g)}<b>${t.name}</b><span>總分 ${t.total}${t.next ? ` · 再 ${t.next[0] - t.total} 分升「${t.next[1]}」` : ' · 最高級'}</span></div>
    <ul class="gparts">${row('裝修', P_.deco, 30, '牆地、招牌、擺設、枱、擴舖')}${row('食譜', P_.menu, 30, '識整幾多樣、升咗幾多星')}${row('人流', P_.flow, 20, `自己間舖招呼過 ${String(SHOP.servedTotal)} 枱客`)}${row('地段', P_.place, 15, `${must(PLACES[SHOP.place], 'place ' + SHOP.place).name}，搬去好地段加分`)}</ul>
    <p class="hint">評級愈高，客人嚟得愈密（每級客流 +4%）。</p>
    <button type="button" class="big" id="bookClose">返回</button>`;
  must($('bookView'), 'bookView').hidden = false;
}
document.addEventListener('click', e => { if (evEl(e.target).closest('#gradeBtn')) openGrade(); });
// 收工記低人流；升級就恭喜
export function gradeTick(): void {
  if (!G || G.level || G.tut || G.coop) return;
  const before = teaGrade().g; SHOP.servedTotal = (SHOP.servedTotal ?? NaN) + (G.served | 0);
  const after = teaGrade().g; saveShop();
  if (after > before) setTimeout(() => { toast(`茶記評級升級：「${teaGrade().name}」！`); sfx.fanfare(); }, 1200);
}

/* ===================== 獎勵結構：點解要刷關、點解要日日開舖 ===================== */
// 關卡人工倍數：主線 ×1.5、今日推介 ×2、節日 ×2、修羅場 ×2.5；自己間舖 ×1 但要交租（做咗業主就唔使）
export const PICK_X = 2, LV_X = 1.5, FEST_X = 2, HELL_X = 2.5, RENT = .08, OWNER_BONUS = .05;
export const STAR_PRIZE = 300, DAILY3 = 300;
// 今日推介關：用日期揀一關（玩得嘅、唔計修羅場），人人一樣
export function pickLevel(): string | null | undefined {
  // 每日第一次計就記住（之後解鎖新關都唔會變）
  if (SHOP.pickDay===todayStr() && LEVELS[String(SHOP.pick)]) return SHOP.pick;
  const p = pickLevelRaw(); SHOP.pickDay = todayStr(); SHOP.pick = p; return p;
}
/** null when no level is open (as in the JS). */
export function pickLevelRaw(): string | null {
  const ids = Object.keys(LEVELS).filter(id => !must(LEVELS[id], 'level ' + id).hell && levelOpen(id)).sort();
  if (!ids.length) return null;
  let h = 7; for (const c of todayStr()) h = (h * 31 + c.charCodeAt(0)) % 100003;
  return must(ids[h % ids.length], 'picked level');
}
export function levelMult(id: string): number { const L = must(LEVELS[id], 'level ' + id); return L.hell ? HELL_X : L.fest ? FEST_X : id===pickLevel() ? PICK_X : LV_X; }
// 每關收工送嗰間舖招牌菜用得着嘅料（想學秘傳食譜就返去刷）
export const LV_INGR: Record<string, string[]> = { estate:['雞蛋','午餐肉'], central:['火腿','麵包'], mongkok:['白米','牛肉'], airport:['豬扒','牛肉'], typhoon:['麵','午餐肉'], newyear:['白米','雞肉'],
  bingsutt:['麵包','紅豆'], sixties:['麵包','煉奶'], daipaidong:['茶葉','煉奶'], village:['麵包','雞蛋'], silver:['茶葉','麵包'], kwc:['叉燒','白米'],
  milktea:['豬扒','雞肉'], fastmilk:['雞蛋','煉奶'], hangwan:['麵包','雞蛋'], halloween:['紅豆','檸檬'] };

/* ===================== 供舖做業主 ===================== */
/// 自己間舖本身係租嘅：每更交 8% 租（硬核模式就係定額租、人工、雜費）。有錢就可以供舖，一日供幾多期都得；供滿 12 期，嗰個地段就係你嘅，唔使交租，仲多 5% 收入
export const MORT_N = 12;
export const PLACE_PRICE: Record<string, number> = { 'pl-town':12000, 'pl-village':15000, 'pl-estate':18000, 'pl-rainbow':18000, 'pl-walled':21000, 'pl-jordan':24000, 'pl-central':36000, 'pl-haunt':6000 };
SHOP.mort = SHOP.mort || {}; SHOP.mortDay = SHOP.mortDay || '';
export const placePrice = (k: string): number => PLACE_PRICE[k] || 15000, mortPer = (k: string): number => Math.round(placePrice(k) / MORT_N / 10) * 10;
export const ownsPlace = (k: string): boolean => ((must(SHOP.mort, 'SHOP.mort')[k] ?? 0)|0) >= MORT_N;
export function mortHtml(): string {
  const k = SHOP.place, n = (must(SHOP.mort, 'SHOP.mort')[k] ?? 0)|0, per = mortPer(k);
  if (ownsPlace(k)) return `<div class="mort own"><b>🏠 業主</b><span>${must(PLACES[k], 'place ' + k).name}係你嘅：唔使交租${SHOP.hard ? '' : `，收入 +${OWNER_BONUS * 100}%`}</span></div>`;
  // limited by money, not by day: as many instalments as the savings allow, whenever the player likes
  return `<div class="mort"><b>供舖 ${n}/${MORT_N} 期</b><span class="mbar"><i style="width:${n / MORT_N * 100}%"></i></span>
    <span>${must(PLACES[k], 'place ' + k).name} 樓價 $${placePrice(k)} · 每期 $${per} · 有錢就供，一日供幾多期都得<br>${SHOP.hard ? '未做業主每更要交租' : `未做業主每更要交 ${RENT * 100}% 租`}</span>
    <button type="button" id="mortPay"${SHOP.bank < per ? ' disabled' : ''}>${SHOP.bank < per ? `供一期要 $${per}` : `供一期 $${per}`}</button></div>`;
}
/** One instalment now, if the savings cover it (the 供一期 button). */
export function mortPay(): boolean {
  const k = SHOP.place; if (ownsPlace(k)) return false;
  const per = mortPer(k);
  if (SHOP.bank < per){ toast(`唔夠錢，仲差 $${per - SHOP.bank}`); return false; }
  SHOP.bank -= per; must(SHOP.mort, 'SHOP.mort')[k] = ((must(SHOP.mort, 'SHOP.mort')[k] ?? 0)|0) + 1; saveShop();
  if (ownsPlace(k)){ toast(`恭喜！${must(PLACES[k], 'place ' + k).name}間舖係你嘅喇，以後唔使交租！`); sfx.fanfare(); }
  else toast(`供咗一期 $${per}（${String(must(SHOP.mort, 'SHOP.mort')[k])}/${MORT_N}）`);
  return true;
}
document.addEventListener('click', e => { if (evEl(e.target).closest('#mortPay')){ mortPay(); renderCareer(); } });
// 硬核模式：呢更要交嘅定額開支。電腦幫手：一個位嗰陣三個人；輪流做／一腳踢佢哋候命，人工減半
export function shiftCostsNow(solo: boolean = !!(G && G.solo)): Costs {
  return shiftCosts({ size: SHOP.size, placePrice: placePrice(SHOP.place), owned: ownsPlace(SHOP.place), tables: SHOP.tables.length, helpers: 3, allStations: solo });
}
/** Hard mode applies to this shift: the player's own shop, solo (party mode stays free of pressure). */
export const hardShift = (): boolean => { const S = liveG(); return !!SHOP.hard && !S.tut && !S.level && !S.coop; };
// 收工入數（取代舊 bankRevenue 入面嘅計法）
export function payout(): Payout {
  const S = liveG();
  // the shop banks whole dollars (the takeaway tips book 10 cents, so the takings can carry cents and float noise)
  const rev = Math.round(S.revenue), lines: [string, string][] = [];
  let get = rev;
  if (S.tut){ /* training: the takings as they are */ }
  else if (S.level){ const x = levelMult(S.level), L = must(LEVELS[S.level], 'level ' + S.level);
    get = Math.round(rev * x); lines.push([`${L.fest ? '節日關' : L.hell ? '修羅場' : S.level===pickLevel() ? '今日推介關' : '關卡'}人工 ×${x}`, `+$${get - rev}`]); }
  else if (hardShift()){
    const k = SHOP.place, c = shiftCostsNow();
    get -= c.total;
    lines.push([ownsPlace(k) ? `租（${must(PLACES[k], 'place ' + k).name}，業主唔使交）` : `交租（${must(PLACES[k], 'place ' + k).name}）`, `−$${c.rent}`]);
    lines.push([`人工（電腦幫手${S.solo ? '候命，半薪' : ' 3 個'}）`, `−$${c.wages}`]);
    lines.push([`雜費（${SHOP.tables.length} 張枱）`, `−$${c.upkeep}`]);
  }
  else if (!(S.coop && NET.role==='client')){
    const k = SHOP.place;
    if (ownsPlace(k)){ const b = Math.round(rev * OWNER_BONUS); get += b; lines.push(['業主收入 +5%', `+$${b}`]); }
    else { const r = Math.round(rev * RENT); get -= r; lines.push([`交租（${must(PLACES[k], 'place ' + k).name}）`, `−$${r}`]); }
  }
  return { get, lines };
}
// 收工：講返供舖去到邊、仲差幾多（供款喺「我的茶餐廳」撳「供一期」，有錢就供得）
export function mortTick(): string {
  if (!G || G.tut || G.level || G.coop || (typeof gateOk==='function' && !gateOk('pro'))) return '';
  const k = SHOP.place; if (ownsPlace(k)) return '';
  const per = mortPer(k), n0 = (must(SHOP.mort, 'SHOP.mort')[k] ?? 0)|0;
  return `<div class="wide mortw"><span>供舖</span><b>${n0}/${MORT_N} 期</b><span>每期 $${per}，有錢就喺「我的茶餐廳」撳「供一期」</span></div>`;
}

/* ===================== 分店：被動收入 ===================== */
// 兩種分店：① 做咗業主、但而家冇喺度開舖嘅地段；② 關卡舖每個位（四個位加埋嗰關有嘅新位）都攞過三星，老闆將間舖交俾你做加盟分店
// 每個鐘自動賺錢，跟總星數同茶記評級加成；最多儲 8 個鐘，要返嚟收數
export const BR_CAP_H = 8;
SHOP.lvst = SHOP.lvst || {};
// every seat the level has (core/career/seats.ts levelSeats: the shop's four plus the level's new seats) at three stars
export const lvAll3 = (id: string): boolean => levelSeats(LEVELS[id]).every(s => ((must(SHOP.lvst, 'SHOP.lvst')[id]?.[s] ?? 0)|0) >= 3);
export function branches(): Branch[] {
  const out: Branch[] = [];
  Object.keys(PLACES).forEach(k => { if (ownsPlace(k) && k!==SHOP.place) out.push({ k, name: must(PLACES[k], 'place ' + k).name + '分店', base: Math.round(placePrice(k) / 200) }); });
  Object.keys(LEVELS).forEach(id => { if (!must(LEVELS[id], 'level ' + id).hell && lvAll3(id)) out.push({ k: 'lv:' + id, name: must(LEVELS[id], 'level ' + id).name + '（加盟）', base: 80 }); });
  return out;
}
export const branchMult = (): number => (1 + (SHOP.stars ?? NaN) / 100) * (1 + .2 * (teaGrade().g - 1));
export const branchRate = (): number => Math.round(branches().reduce((a, b) => a + b.base, 0) * branchMult());
export function branchDue(): number {
  const bs = branches(); if (!bs.length) return 0;
  // branchAt may come from a phone whose clock is ahead (cloud save), or this clock was set back: time since a moment
  // in the future is not negative income - start counting from now.
  if (!SHOP.branchAt || SHOP.branchAt > Date.now()){ SHOP.branchAt = Date.now(); saveShop(); return 0; }
  const h = Math.min(BR_CAP_H, Math.max(0, (Date.now() - SHOP.branchAt) / 3600000));
  return Math.floor(branchRate() * h);
}
export function collectBranches(): void {
  const due = branchDue(); if (!due){ toast('分店仲未有錢收，遲啲再嚟'); return; }
  SHOP.bank += due; SHOP.branchAt = Date.now(); saveShop(); sfx.fanfare();
  toast(`分店收數 $${due}！`); renderCareer();
}
export function branchHtml(): string {
  const bs = branches();
  if (!bs.length) return '';
  const due = branchDue(), full = SHOP.branchAt && Date.now() - SHOP.branchAt >= BR_CAP_H * 3600000;
  return `<div class="crate branch${due ? ' ready' : ''}"><span>${iconImg('how', 'agent')}<b>${bs.length} 間分店</b> 每個鐘 $${branchRate()}${full ? ' · 儲滿咗！' : ''}</span><button type="button" id="branchBtn">${due ? `收數 $${due}` : '睇分店'}</button></div>`;
}
export function openBranches(): void {
  const bs = branches();
  must($('book'), 'book').innerHTML = `<div class="sh-head"><b>分店</b><span>被動收入 · 最多儲 ${BR_CAP_H} 個鐘</span></div>
    ${bs.length ? `<ul class="branches">${bs.map(b => `<li><b>${b.name}</b><span>每個鐘 $${Math.round(b.base * branchMult())}</span></li>`).join('')}</ul>` : '<p class="hint">仲未有分店。</p>'}
    <p class="hint">加成：總星數 ${String(SHOP.stars)}★（×${(1 + (SHOP.stars ?? NaN) / 100).toFixed(2)}）· 茶記評級「${teaGrade().name}」（×${(1 + .2 * (teaGrade().g - 1)).toFixed(1)}）</p>
    <p class="hint">點樣開分店：<br>① 供滿一個地段做業主，之後搬去第二度開舖，舊舖就變分店。<br>② 關卡舖每個位（伙記、廚房、水吧、收銀，加埋嗰關有嘅新位）都攞過三星，老闆會將間舖交俾你做加盟分店。</p>
    ${branchDue() ? `<button type="button" class="big" id="branchCollect">收數 $${branchDue()}</button>` : ''}
    <button type="button" class="big alt" id="bookClose">返回</button>`;
  must($('bookView'), 'bookView').hidden = false;
}
document.addEventListener('click', e => {
  if (evEl(e.target).closest('#branchBtn')){ if (branchDue()) collectBranches(); else openBranches(); }
  else if (evEl(e.target).closest('#branchCollect')){ collectBranches(); openBranches(); }
});
