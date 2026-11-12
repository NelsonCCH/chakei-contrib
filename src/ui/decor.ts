// 裝修：搬枱、買枱、買擺設、換牆身地磚、擴舖；每更賺嘅錢入舖頭積蓄
// TypeScript port of the original game's decor.js, as an ES module: every
// top-level name is exported. It keeps the JS behaviour (must() only where the JS dereferenced, `?? NaN` where it
// did arithmetic on a maybe-undefined number, String() where it printed one). Owns the save SHOP (types/decor.d.ts).
import './floor-iso';   // load order: src/entry.ts
import { must, ownKey } from '../core/util';
import { setTABLES, G, TABLES, newGame, liveG } from '../core/state';
import { $ } from './prefs';
import { pickSure } from '../core/rng';
import { rebuildTblEls, toast } from './ui';
import { P, INK } from './kitchen';
import { hitAt } from './pixel';
import { iconImg } from './icons';
import { ISO, setTPOS, TPOS, poly, isoPt, setIsoFlip, isoBox, FSC, isoO, applyView } from './floor-iso';
import { pvURL, lookPreview, pvCanvas, PV_W, PV_H, SETS_DECOR, setOwned, itemLocked, itemPreview, tablePreview, SET_ITEMS, checkSets } from './sets';
import { ownsPlace, placePrice, MORT_N, payout } from './market';
import { todayStr, careerCheat, renderCareer } from './career';
import { LEVELS } from './levels';
import { cloudPush } from './cloud';
import { showBackdrop, buildMenus } from './main';
import { pressSettle } from './pressure';
import { cleanTarget } from '../core/career/targets';
import { cleanPress } from '../core/career/pressure';

/* ===================== 裝修：價錢同資料 ===================== */
export const WALLS: Record<string, WallDef> = {
  green: { name:'綠色紙皮石', p:0,    r:'#c6e0d3', l:'#b2d2c3', r1:'#dcefe5', r2:'#b9d7c9', l1:'#cbe6d8', l2:'#a9cbbd', chip:'#9fd0b8' },
  cream: { name:'米白瓷片',   p:800,  r:'#d9d2bd', l:'#c9c1aa', r1:'#f4efdf', r2:'#e8e0c8', l1:'#e9e2cd', l2:'#ddd4ba', chip:'#efe6cc', tile:true },
  blue:  { name:'粉藍紙皮石', p:1500, r:'#bcd3e6', l:'#a6c0d6', r1:'#dbe9f5', r2:'#9fbfdc', l1:'#c9dcec', l2:'#93b2cf', chip:'#a9c8e4' },
};
export const FLOORS: Record<string, FloorDef> = {
  mosaic: { name:'綠白紙皮石', p:0,    a:'#eaf1ec', b:'#d5e5dc', dot:true, chip:'#d5e5dc' },
  check:  { name:'黑白格仔',   p:1000, a:'#f4f1e8', b:'#3a3f44', chip:'#3a3f44' },
  terra:  { name:'紅階磚',     p:2000, a:'#c4604a', b:'#a84a36', dot:true, chip:'#b85440' },
};
// 年代關卡專用（唔擺上裝修店，所以 enumerable:false）
Object.defineProperty(WALLS, 'bingsutt', { enumerable:false, value: { name:'冰室薄荷綠', p:0, r:'#cfe3d4', l:'#bcd5c3', r1:'#e6f2e8', r2:'#c2dccb', l1:'#d8eadc', l2:'#b3cfbb', chip:'#bfe0c8', tile:true } satisfies WallDef });
Object.defineProperty(WALLS, 'plaster', { enumerable:false, value: { name:'白灰水牆', p:0, r:'#efece4', l:'#e2ddd2', r1:'#f6f4ee', r2:'#d9d2c4', l1:'#ebe6dc', l2:'#cfc7b8', chip:'#efece4', plain:true } satisfies WallDef });
Object.defineProperty(WALLS, 'yellowdado', { enumerable:false, value: { name:'黃牆紙皮石腳', p:0, r:'#f0d868', l:'#e2c858', r1:'#f6e488', r2:'#d8bc48', l1:'#ecd878', l2:'#ccb040', chip:'#f0d868', dado:true } satisfies WallDef });
Object.defineProperty(FLOORS, 'greymo', { enumerable:false, value: { name:'灰藍細紙皮石', p:0, a:'#a8b2ba', b:'#98a2ac', fine:true, chip:'#a8b2ba' } satisfies FloorDef });
Object.defineProperty(WALLS, 'grime', { enumerable:false, value: { name:'城寨舊牆', p:0, r:'#8a8270', l:'#7a7262', r1:'#958c7a', r2:'#6a6252', l1:'#857c6a', l2:'#5e5646', chip:'#8a8270', plain:true } satisfies WallDef });
Object.defineProperty(FLOORS, 'greenterr', { enumerable:false, value: { name:'綠色水磨石', p:0, a:'#8fae9c', b:'#82a290', dot:true, chip:'#8fae9c' } satisfies FloorDef });
Object.defineProperty(WALLS, 'whitetile', { enumerable:false, value: { name:'白瓷片', p:0, r:'#e4e6e2', l:'#d4d8d4', r1:'#f8f9f6', r2:'#eceee8', l1:'#f0f2ee', l2:'#e2e6e0', chip:'#f4f6f2', tile:true } satisfies WallDef });
Object.defineProperty(FLOORS, 'cement', { enumerable:false, value: { name:'石屎地', p:0, a:'#6e5e52', b:'#68584c', chip:'#6e5e52' } satisfies FloorDef });
Object.defineProperty(FLOORS, 'tiny', { enumerable:false, value: { name:'細階磚', p:0, a:'#efe7d4', b:'#7c4a3a', fine:true, chip:'#7c4a3a' } satisfies FloorDef });
Object.defineProperty(WALLS, 'sixties', { enumerable:false, value: { name:'六十年代奶黃瓷片', p:0, r:'#e8d9a8', l:'#d9c891', r1:'#f6ecc8', r2:'#e2d29c', l1:'#efe2b6', l2:'#d4c288', chip:'#efe2b6', tile:true } satisfies WallDef });
Object.defineProperty(WALLS, 'stall', { enumerable:false, value: { name:'大牌檔綠鐵皮', p:0, r:'#3f7a55', l:'#336a48', r1:'#4f8e66', r2:'#2e5e41', l1:'#447f5a', l2:'#2a573c', chip:'#3f7a55', stripe:true } satisfies WallDef });
Object.defineProperty(FLOORS, 'street', { enumerable:false, value: { name:'街邊石屎地', p:0, a:'#8e9390', b:'#858a87', dot:true, chip:'#8e9390' } satisfies FloorDef });
// 門面：招牌同簷篷（立體版街道上面見到）
export const SIGNS: Record<string, SignDef> = {
  'sg-red':   { name:'紅底金字', p:0,    bg:'#a5272f', fg:'#ffd25a', chip:'#a5272f' },
  'sg-green': { name:'綠底白字', p:600,  bg:'#1f6a4f', fg:'#ffffff', chip:'#1f6a4f' },
  'sg-white': { name:'白底紅字', p:600,  bg:'#fbf6e2', fg:'#c8323c', chip:'#fbf6e2' },
  'sg-neon':  { name:'霓虹燈',   p:2500, bg:'#1b1b2a', fg:'#ff5ab4', neon:true, chip:'#ff5ab4' },
};
export const AWNINGS: Record<string, AwningDef> = {
  'aw-none':  { name:'冇簷篷',   p:0,   chip:'#9aa6ad' },
  'aw-red':   { name:'紅白間條', p:500, a:'#c8323c', b:'#fbfaf4', chip:'#c8323c' },
  'aw-green': { name:'綠白間條', p:500, a:'#2a8b67', b:'#fbfaf4', chip:'#2a8b67' },
  'aw-blue':  { name:'藍色帆布', p:800, a:'#3d7fbf', b:'#2f6aa3', chip:'#3d7fbf' },
};
// 地點：間舖開喺邊（背景同街道唔同）。用地方名，唔用真實店名
export const PLACES: Record<string, PlaceDef> = {
  // fx：開喺呢度嘅加成（有好有唔好），只計「我的茶餐廳」
  'pl-town':    { name:'深水埗街舖', p:0, chip:'#4b555d', fx:'冇加成，亦冇缺點' },
  'pl-estate':  { name:'華富邨',   p:1500, chip:'#e8a0b4', road:'#4b555d', fx:'街坊熟客多：熟客出現機會大增，收工另外 +$100', reg:true, bonus:100 },
  'pl-rainbow': { name:'彩虹邨',   p:1800, chip:'#c9b4e0', road:'#4b555d', fx:'打卡熱點：連擊貼士 +10%，客流 +5%', tip:1.1, flow:1.05 },
  'pl-walled':  { name:'九龍城寨', p:2500, chip:'#8a7a6a', road:'#3a3f44', noLine:true, fx:'人流超密：客流 +15%，但客人耐性 −10%', flow:1.15, pat:.9 },
  'pl-village': { name:'茶果嶺村', p:2000, chip:'#7a5a3a', road:'#8a6a4a', noLine:true, fx:'街坊慢活：客人耐性 +15%，但客流 −5%', flow:.95, pat:1.15 },
  // unlock：要喺嗰個關卡攞三星先買得
  'pl-jordan':  { name:'佐敦',     p:2200, chip:'#c83a6a', road:'#3a3f44', fx:'霓虹夜市：客流 +10%，連擊貼士 +5%', flow:1.1, tip:1.05, unlock:'fastmilk' },
  // 信徒之選：長洲海邊度假屋（同萬聖關同一個背景）；大約三日有一日放上櫥窗，萬聖關三星之後長期放盤
  'pl-haunt':   { name:'長洲', p:900, chip:'#2a5a7a', road:'#1e3a4a', noLine:true, fx:'信徒之選：業主急放，客流 −10%，但偶然有神秘客食完留低雙倍錢', flow:.9, ghost:true },
  'pl-central': { name:'中環',     p:2800, chip:'#5a8ab8', road:'#4b555d', fx:'白領趕時間：客流 +20%，但客人耐性 −15%', flow:1.2, pat:.85, unlock:'milktea' },
};
export const lookLocked = (d: LookDef): string | boolean | undefined => d.unlock && ((must(SHOP.levels, 'SHOP.levels')[d.unlock] ?? 0)|0) < 3;
export const LOOKS = { wall:WALLS, floor:FLOORS, sign:SIGNS, awning:AWNINGS, place:PLACES };
// 舖面：細舖 → 中舖 → 大舖，要逐級擴
export const SIZES: SizeDef[] = [ { name:'細舖', gx:9, gy:9, p:0 }, { name:'中舖', gx:11, gy:10, p:3000 }, { name:'大舖', gx:13, gy:11, p:6000 } ];
export const TKINDS: Record<string, TableKindDef> = { booth: { name:'卡位', cap:4, w:2, p:1200, chip:'#a5372f' }, small: { name:'細枱', cap:2, w:1, p:500, chip:'#a77c4c' }, round: { name:'圓枱', cap:4, w:2, p:900, chip:'#d8c8a0' } };
export const MAXT = 12;
export const ITEMS: Record<string, ItemDef> = {
  plant:  { name:'盆栽',     p:300,  w:.5, d:.5, chip:'#4f9a4a' },
  shrine: { name:'地主神枱', p:800,  w:.5, d:.5, chip:'#c8323c' },
  fridge: { name:'汽水雪櫃', p:1200, w:1,  d:.5, chip:'#d9473f' },
  tank:   { name:'魚缸',     p:1800, w:1,  d:.5, chip:'#6fb7d9' },
};
export const CN = ['一','二','三','四','五','六','七','八','九','十','十一','十二'];
export const TDEF: TableDef[] = [ ['booth',1,.5], ['booth',4.5,.5], ['booth',1,3.5], ['booth',4.5,3.5], ['small',1,6.5], ['small',4.5,6.5] ];
export const BASE = TDEF.length; // 頭六張係本身有，唔賣得

// 新舖頭有 $3000 開舖錢
export let SHOP: Shop = { bank:3000, wall:'green', floor:'mosaic', sign:'sg-red', awning:'aw-none', place:'pl-town', own:['green','mosaic','sg-red','aw-none','pl-town'], size:0, day:1, dayRev:0, tables: TDEF.map(([kind, tx, ty]) => ({ kind, tx, ty })), items:[] };
export function setSHOP(v: typeof SHOP): void { SHOP = v; }
/**
 * The save is trusted as the JS trusts it: sanitizeShop() checked the types of the fields it lists, the rest is taken as
 * written. No runtime check here on purpose (the original behaviour is kept); the whole save, like the cloud
 * save, is not yet validated at the boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter exists only to carry the assertion
export function trustSave(_s: unknown): asserts _s is ShopSave { /* trusted, see above */ }
// 已經唔再有嘅食譜
export const GONE_RECIPES = ['k:和尚跳海', 'k:血紅檸茶'];
// 存檔有時殘缺（壞咗、舊版、雲端傳返嚟）：型別唔啱嘅欄位當冇，等預設值補返
export function sanitizeShop(s: unknown): ShopSave | null {
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v==='object' && !Array.isArray(v), num = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 1e9;
  if (!obj(s)) return null;
  ['bank','stars','servedTotal','shifts','day','dayRev','size'].forEach(k => { if (k in s){ const n = Number(s[k]); if (typeof s[k]!=='boolean' && s[k]!==null && s[k]!=='' && num(n)) s[k] = Math.floor(n); else Reflect.deleteProperty(s, k); } });
  if (typeof s.size==='number' && s.size > 2) delete s.size;
  ['own','items','tables','recipes','wardrobe','off','gates'].forEach(k => { if (k in s && !Array.isArray(s[k])) Reflect.deleteProperty(s, k); });
  ['levels','lvst','regs','celebs','eggs','ing','rlv','mort','tutDone','lv3day','dex','streak','outfit'].forEach(k => { if (k in s && !obj(s[k])) Reflect.deleteProperty(s, k); });
  // 和尚跳海、血紅檸茶已經除咗，舊存檔學咗、收埋咗或者升咗級都清走
  ['recipes','off'].forEach(k => { const l = s[k]; if (Array.isArray(l)) s[k] = l.filter((x: unknown) => typeof x!=='string' || !GONE_RECIPES.includes(x)); });
  const rlv = s.rlv; if (obj(rlv)) GONE_RECIPES.forEach(k => { Reflect.deleteProperty(rlv, k); });
  // 洗碗 is gone; an old save's lesson, per-level bests, tries, mastery and 洗碗 card are dropped
  for (const k of ['tutDone', 'tried', 'mastery']){ const o = s[k]; if (obj(o)) Reflect.deleteProperty(o, 'wash'); }
  const lvst = s.lvst; if (obj(lvst)) for (const r of Object.values(lvst)) if (obj(r)) Reflect.deleteProperty(r, 'wash');
  if (Array.isArray(s.gates)) s.gates = s.gates.filter((g: unknown) => g !== 'x_wash');
  (['wall','floor','sign','awning','place'] as const).forEach(k => { if (k in s && !LOOKS[k][String(s[k])]) Reflect.deleteProperty(s, k); });
  ['name','nick'].forEach(k => { if (k in s && typeof s[k]!=='string') Reflect.deleteProperty(s, k); });
  // career features (target, 硬核模式, solo modes): wrong types dropped; target and press are cleaned again where they are read
  if ('target' in s) s.target = obj(s.target) ? cleanTarget(s.target) : undefined;
  if ('solo' in s && typeof s.solo!=='string') Reflect.deleteProperty(s, 'solo');
  if ('hard' in s && typeof s.hard!=='boolean') Reflect.deleteProperty(s, 'hard');
  if ('press' in s) s.press = obj(s.press) ? cleanPress(s.press) : undefined;
  if ('lost' in s){ const L = s.lost; s.lost = obj(L) && Array.isArray(L.tables) && Array.isArray(L.items) && SIZES[Number(L.size)] && L.tables.length >= BASE
    ? { size: Number(L.size), tables: L.tables.filter(t => obj(t) && TKINDS[String(t.kind)] && Number.isFinite(t.tx) && Number.isFinite(t.ty)), items: L.items.filter(q => obj(q) && ITEMS[String(q.type)] && Number.isFinite(q.tx) && Number.isFinite(q.ty)), ...(typeof L.place==='string' && LOOKS.place[L.place] ? { place: L.place } : {}) }
    : null; }
  if (Array.isArray(s.own)) s.own = s.own.filter(k => typeof k==='string');
  if (Array.isArray(s.items)) s.items = s.items.filter(q => obj(q) && ITEMS[String(q.type)] && Number.isFinite(q.tx) && Number.isFinite(q.ty));
  if (Array.isArray(s.tables)){ s.tables = s.tables.filter(t => obj(t) && TKINDS[String(t.kind)] && Number.isFinite(t.tx) && Number.isFinite(t.ty)); if (Array.isArray(s.tables) && s.tables.length < BASE) delete s.tables; }
  trustSave(s);
  return s;
}
try {
  const s = sanitizeShop(JSON.parse(String(localStorage.getItem('ckf-shop'))));
  if (s){
    if (s.pos && !s.tables) s.tables = s.pos.map((p, i) => ({ kind: must(TDEF[i], 'starting table ' + String(i))[0], tx:p.tx, ty:p.ty })); // 舊版存法
    delete s.pos; SHOP = { ...SHOP, ...s };
    ['sg-red', 'aw-none', 'pl-town'].forEach(k => { if (!SHOP.own.includes(k)) SHOP.own.push(k); });
  }
} catch { /* no save, or storage blocked: keep the new shop */ }
export function saveShop(): void { SHOP.t = Date.now(); try { localStorage.setItem('ckf-shop', JSON.stringify(SHOP)); } catch { /* storage full or blocked */ } if (typeof cloudPush==='function') cloudPush(); }
// 由 SHOP 整返張枱表、位置同舖面大細
export function applyShop(): void {
  shopStale = false;
  const sz = must(SIZES[SHOP.size], 'shop size ' + String(SHOP.size)); ISO.GX = sz.gx; ISO.GY = sz.gy;
  setTABLES(SHOP.tables.map((t, i) => ({ name: String(CN[i]) + (t.kind==='booth' ? '號卡' : '號枱'), cap: must(TKINDS[t.kind], 'table kind ' + t.kind).cap, kind: t.kind })));
  setTPOS(SHOP.tables.map(t => ({ tx:t.tx, ty:t.ty, w: must(TKINDS[t.kind], 'table kind ' + t.kind).w })));
  rebuildTblEls();
}
// The restaurant may only change between shifts. A save that arrives (cloud sync) while a shift runs, a level's
// fixed shop is up or the player is decorating is applied at the next safe point: the home screen, the next shift's
// start, or leaving the level (useFixedShop(false) calls applyShop).
export let shopStale = false;
export function applyShopWhenIdle(): void {
  if ((typeof G!=='undefined' && G && G.running) || fixedShop || decorMode){ shopStale = true; return; }
  applyShop();
}
applyShop();

export let decorMode = false, decorSel: DecorSel | null = null, decorPrev: Record<LookKind, string | null> = { wall:null, floor:null, sign:null, awning:null, place:null }, decorTab = 'move', decorSub = '';
export function setDecorMode(v: typeof decorMode): void { decorMode = v; }
// 教學關用一間固定嘅舖：細舖、本身六張枱、綠色牆、綠白地磚（唔理你裝修成點）
// 關卡亦用固定嘅舖：lay = { size, tables:[[種類, tx, ty]…], wall, floor }（唔俾就用教學嗰間）
export let fixedShop: FixedShop | null = null;
export const LOOK_DEF: Partial<Record<LookKind, string>> = { sign:'sg-red', awning:'aw-none', place:'pl-town' };
export const decorLook = (k: LookKind): string | undefined => (fixedShop ? fixedShop[k] : decorMode && decorPrev[k] ? decorPrev[k] : SHOP[k]) || LOOK_DEF[k];
export function useFixedShop(on: boolean, lay?: Partial<FixedShop>): void {
  if (!on){ fixedShop = null; applyShop(); return; }
  fixedShop = { size:0, tables:TDEF, wall:'green', floor:'mosaic', ...(lay || {}) };
  const sz = SIZES[fixedShop.size]; ISO.GX = fixedShop.gx || must(sz, 'shop size').gx; ISO.GY = fixedShop.gy || must(sz, 'shop size').gy;   // 關卡可以自訂窄長舖
  setTABLES(fixedShop.tables.map(([kind], i) => ({ name: String(CN[i]) + (kind==='booth' ? '號卡' : '號枱'), cap: must(TKINDS[kind], 'table kind ' + kind).cap, kind })));
  setTPOS(fixedShop.tables.map(([kind, tx, ty, z]) => ({ tx, ty, w: must(TKINDS[kind], 'table kind ' + kind).w, z: z || 0 })));   // z：閣樓上面嘅枱
  rebuildTblEls();
}

/* ===================== 裝修：位置 ===================== */
// 佔幾多地方：枱連兩邊櫈；擺設就係本身
export const tRect = (w: number, p: TilePos): Rect => ({ x0: p.tx - .75, x1: p.tx + 1.75, y0: p.ty - .15, y1: p.ty + w + .15 });
// 擺設佔地（轉咗方向就對調闊同深）
export const itemWD = (q: ShopItem): { w: number; d: number } => { const it = must(ITEMS[q.type], 'item ' + q.type); return q.rot ? { w: it.d, d: it.w } : { w: it.w, d: it.d }; };
export const iRect = (it: { w: number; d: number }, p: TilePos): Rect => ({ x0: p.tx, x1: p.tx + it.w, y0: p.ty, y1: p.ty + it.d });
export const rectOf = (sel: DecorSel, p: TilePos): Rect => sel.t==='table' ? tRect(must(TPOS[sel.i], 'table ' + String(sel.i)).w, p) : iRect(itemWD(must(SHOP.items[sel.i], 'item ' + String(sel.i))), p);
export const posOf = (sel: DecorSel): TilePos | undefined => sel.t==='table' ? TPOS[sel.i] : SHOP.items[sel.i];
export const hitR = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
// 門口唔擺得嘢
export const doorRect = (): Rect => ({ x0: ISO.GX - .6, x1: ISO.GX, y0: ISO.GY - 2.4, y1: ISO.GY - .6 });
export function fits(sel: DecorSel, p: TilePos): boolean {
  const r = rectOf(sel, p);
  if (r.x0 < 0 || r.y0 < 0 || r.x1 > ISO.GX || r.y1 > ISO.GY || hitR(r, doorRect())) return false;
  return TPOS.every((q, j) => (sel.t==='table' && j===sel.i) || !hitR(r, tRect(q.w, q)))
      && SHOP.items.every((q, j) => (sel.t==='item' && j===sel.i) || !hitR(r, iRect(itemWD(q), q)));
}
// 撳嗰點 → 放喺邊（對齊半格）
export function snap(sel: DecorSel, gx: number, gy: number): TilePos {
  if (sel.t==='table') return { tx: Math.round((gx - .5) * 2) / 2, ty: Math.round((gy - must(TPOS[sel.i], 'table ' + String(sel.i)).w / 2) * 2) / 2 };
  const it = itemWD(must(SHOP.items[sel.i], 'item ' + String(sel.i)));
  return { tx: Math.round((gx - it.w / 2) * 2) / 2, ty: Math.round((gy - it.d / 2) * 2) / 2 };
}
export const decorCanAt = (gx: number, gy: number): boolean => { const s = must(decorSel, 'decorSel'); return fits(s, snap(s, gx, gy)); };
// 搵個空位（由前面門口嗰邊搵起）
export function freeSpot(sel: DecorSel): TilePos | null {
  for (let ty = ISO.GY; ty >= 0; ty -= .5) for (let tx = ISO.GX; tx >= 0; tx -= .5){ const p = { tx, ty }; if (fits(sel, p)) return p; }
  return null;
}
export function setPos(sel: DecorSel, p: TilePos): void {
  const o = must(posOf(sel), sel.t + ' ' + String(sel.i)); o.tx = p.tx; o.ty = p.ty;
  if (sel.t==='table'){ must(SHOP.tables[sel.i], 'table ' + String(sel.i)).tx = p.tx; must(SHOP.tables[sel.i], 'table ' + String(sel.i)).ty = p.ty; }
  saveShop();
}

/* ===================== 裝修：擺設像素畫 ===================== */
export const itemDepth = (i: number): number => { const q = must(SHOP.items[i], 'item ' + String(i)), it = itemWD(q); return q.tx + it.w / 2 + q.ty + it.d / 2; };
export function drawItem(i: number, now: number, S: number): void {
  // `it` is checked where it is read: itemWD() on the same line already threw for an unknown item type in the JS.
  const q = must(SHOP.items[i], 'item ' + String(i)), it = must(ITEMS[q.type], 'item ' + q.type), fp = itemWD(q), x = q.tx, y = q.ty, picked = decorMode && decorSel && decorSel.t==='item' && decorSel.i===i;
  if (picked){ const c = Math.floor(now / 300) % 2 ? '#ffd25a' : '#e9b23a'; poly([isoPt(x - .1, y - .1), isoPt(x + fp.w + .1, y - .1), isoPt(x + fp.w + .1, y + fp.d + .1), isoPt(x - .1, y + fp.d + .1)], c); }
  let top = 0;
  if (q.rot) setIsoFlip({ x, y });
  try {
  if (q.type==='plant'){
    isoBox(x + .08, y + .08, .34, .34, 9, '#d07a4a', '#a8552e', '#8e4424');
    const p = isoPt(x + .25, y + .25, 9);
    const leaves: [number, number, number, number, string][] = [[-6,-10,7,8,'#3f8a3c'],[0,-17,7,9,'#4f9a4a'],[3,-9,8,7,'#3f8a3c'],[-3,-22,6,7,'#64b25a'],[-9,-16,6,6,'#4f9a4a']];
    leaves.forEach(([dx, dy, w, h]) => { P(p.x + dx - 1, p.y + dy - 1, w + 2, h + 2, INK); });
    leaves.forEach(([dx, dy, w, h, c]) => { P(p.x + dx, p.y + dy, w, h, c); P(p.x + dx + 1, p.y + dy, w - 3, 1, '#8fd27e'); });
    top = 32;
  } else if (q.type==='shrine'){
    // 地主神枱：紅色細櫃，兩粒紅燈，插住香
    isoBox(x + .02, y + .02, .46, .46, 14, '#c8323c', '#8e2027', '#a5272f');
    const p = isoPt(x + .25, y + .48, 5), f = Math.floor(now / 400) % 2;
    P(p.x - 6, p.y - 8, 12, 6, INK); P(p.x - 5, p.y - 7, 10, 4, '#ffd25a');
    P(p.x - 5, p.y - 1, 3, 3, f ? '#ff5a3a' : '#ff8a3a'); P(p.x + 2, p.y - 1, 3, 3, f ? '#ff8a3a' : '#ff5a3a');
    const tp = isoPt(x + .25, y + .25, 14); P(tp.x - 1, tp.y - 8, 1, 8, '#7a5a3a'); P(tp.x + 1, tp.y - 7, 1, 7, '#7a5a3a'); P(tp.x - 1, tp.y - 9, 1, 1, '#ff5a3a'); P(tp.x + 1, tp.y - 8, 1, 1, '#ff5a3a');
    top = 24;
  } else if (q.type==='fridge'){
    isoBox(x + .05, y + .05, .9, .4, 46, '#d9473f', '#a8302a', '#8e2622');
    // 前面玻璃門同一排排汽水
    const a = isoPt(x + .15, y + .45, 6), b = isoPt(x + .85, y + .45, 6);
    poly([{ x:a.x, y:a.y - 36 }, { x:b.x, y:b.y - 36 }, b, a], '#cfe8f2');
    for (let r = 0; r < 4; r++) for (let k = 0; k < 5; k++){ const t = (k + .5) / 5, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t - 8 - r * 8; P(Math.round(px) - 1, Math.round(py) - 5, 2, 5, String(['#c8323c','#3d7fbf','#f2a33a','#2a8b67'][(r + k) % 4])); }
    const lg = isoPt(x + .5, y + .45, 44); P(lg.x - 8, lg.y - 1, 16, 4, '#fbfaf4');
    top = 54;
  } else if (it.draw){ top = it.draw(x, y, now);
  } else if (q.type==='tank'){
    isoBox(x + .05, y + .05, .9, .4, 14, '#6a4a2a', '#4e351d', '#5c3f22');
    isoBox(x + .05, y + .05, .9, .4, 18, '#bfe4f2', '#8ccbe6', '#74b8d8', 14, '#2b4a5a');
    const a = isoPt(x + .1, y + .45, 16), b = isoPt(x + .9, y + .45, 16);
    for (let k = 0; k < 3; k++){ const t = (now / 2600 + k * .33) % 1, px = Math.round(a.x + (b.x - a.x) * t), py = Math.round(a.y + (b.y - a.y) * t - 5 - k * 4); P(px, py, 4, 2, k===1 ? '#ffd25a' : '#f27a2a'); P(px - 1, py, 1, 2, '#f27a2a'); }
    P(a.x + 4, a.y - 3, 2, 3, '#3f8a3c'); P(b.x - 6, b.y - 4, 2, 4, '#3f8a3c');
    top = 36;
  }
  } finally { setIsoFlip(null); }
  if (decorMode){
    const l = isoPt(x, y + fp.d), r = isoPt(x + fp.w, y), f = isoPt(x + fp.w, y + fp.d), bk = isoPt(x, y, top);
    FSC.hits.push({ iid:i, x: (l.x - 3) * S, y: (bk.y - 4) * S, w: (r.x - l.x + 6) * S, h: (f.y - bk.y + 6) * S });
  }
}

/* ===================== 裝修：操作 ===================== */
/** The element an event happened on. The JS called Element methods on e.target straight away, so a missing one threw. */
export const evEl = (t: EventTarget | null): Element => must(t instanceof Element ? t : null, 'event target');
export function decorTap(e: MouseEvent): void {
  const h = hitAt(FSC, e), hs: DecorSel | null = h ? (h.iid !== undefined ? { t:'item', i:h.iid } : h.tid !== undefined ? { t:'table', i:h.tid } : null) : null;
  const same = (a: DecorSel | null, b: DecorSel | null): boolean | null => a && b && a.t===b.t && a.i===b.i;
  if (decorSel && !same(hs, decorSel)){
    const r = FSC.tv.getBoundingClientRect(), lx = (e.clientX - r.left) / FSC.S - isoO.x, ly = (e.clientY - r.top) / FSC.S - isoO.y;
    const gx = (lx / (ISO.TW / 2) + ly / (ISO.TH / 2)) / 2, gy = (ly / (ISO.TH / 2) - lx / (ISO.TW / 2)) / 2;
    const p = snap(decorSel, gx, gy);
    if (fits(decorSel, p)){ setPos(decorSel, p); decorSel = null; decorUI(); return; }
    // 撳同款枱：對調
    if (hs && hs.t==='table' && decorSel.t==='table' && must(TPOS[hs.i], 'table ' + String(hs.i)).w===must(TPOS[decorSel.i], 'table ' + String(decorSel.i)).w){
      const a = { tx:must(TPOS[decorSel.i], 'table').tx, ty:must(TPOS[decorSel.i], 'table').ty }, b = { tx:must(TPOS[hs.i], 'table').tx, ty:must(TPOS[hs.i], 'table').ty };
      setPos(decorSel, b); setPos(hs, a);
      toast(`${must(TABLES[decorSel.i], 'table').name}同${must(TABLES[hs.i], 'table').name}對調咗`); decorSel = null; decorUI(); return;
    }
    if (!hs){ toast('擺唔到喺度，綠色嘅地方先得'); return; }
  }
  decorSel = hs && !same(hs, decorSel) ? hs : null;
  if (decorSel) decorTab = 'move';
  decorUI();
}
export function selName(s: DecorSel): string { return s.t==='table' ? must(TABLES[s.i], 'table ' + String(s.i)).name : must(ITEMS[must(SHOP.items[s.i], 'item ' + String(s.i)).type], 'item').name; }
// color 可以係色碼，或者預覽圖（data: 網址）
export function chip(attrs: string, color: string, name: string, tag: string, cls = ''): string {
  const pic = color.startsWith('data:') ? `<img class="pv" src="${color}" alt="">` : `<i style="background:${color}"></i>`;
  return `<button type="button" class="dchip ${cls}" ${attrs}>${pic}<b>${name}</b><span>${tag}</span></button>`;
}
export function lookChips(kind: LookKind, list: Record<string, LookDef>): string {
  const cur = decorLook(kind);
  return Object.entries(list).map(([k, d]) => {
    const own = SHOP.own.includes(k), on = k===cur;
    const tag = own ? (k===SHOP[kind] ? '用緊' : '有') : lookLocked(d) ? `${must(LEVELS[String(d.unlock)], 'level ' + String(d.unlock)).name}三星解鎖` : on ? `買 $${d.p}` : `$${d.p}`;
    return chip(`data-k="${kind}" data-v="${k}"`, pvURL('L' + kind + k, () => lookPreview(kind, k)), d.name, tag, (on ? 'on' : '') + (!own && on ? ' buy' : ''));
  }).join('');
}
/* ---- 舖位：包裝成一間地產舖，櫥窗貼滿樓盤紙 ---- */
export const AGENT_SAY = ['老細，呢間係筍盤嚟㗎！', '旺舖難求，遲手冇㗎喇！', '業主肯減價，今日簽就得！', '人流旺過旺角，包你發達！', '睇樓免費，鍾意先簽約！'];
export const SIZE_FT = [420, 650, 880];
// 地產文學：樓盤紙上面嘅經紀口號（照字面信你就輸）
export const ESTATE_LIT: Record<string, string[]> = {
  'pl-town':    ['地道街坊旺舖，去鴨寮街一分鐘（跑步計）', '鄰近電腦商場，客人買完零件餓到暈', '樓底高、充滿歷史感（即係舊）'],
  'pl-estate':  ['無敵海景日落，靚過馬爾代夫，屋邨價錢', '鄰近瀑布灣，飯後散步一流', '街坊忠心，幫襯三代都係你'],
  'pl-rainbow': ['網紅打卡聖地，客人影完相仲肯坐低', '色彩繽紛，唔使裝修都靚', '天台有籃球場，客人打完波一定餓'],
  'pl-walled':  ['鄰里關係極度緊密，四通八達（天台都通）', '冇人管……即係自由度極高', '飛機喺頭頂飛，交通方便（睇得到）'],
  'pl-village': ['旺中帶靜，離塵不離城', '坐擁山景，綠化率極高', '交通方便，行出大路搭車只係十五分鐘'],
  'pl-jordan':  ['廿四小時人氣旺地，夜晚光到唔使開燈', '夜市就喺隔籬，宵夜客源源不絕', '鬧中帶鬧，永不寂寞'],
  'pl-central': ['國際金融核心，客人個個趕住去賺錢', '鄰近扶手電梯，上山落山都經過', '白領雲集，快食快走翻枱快'],
  'pl-haunt':   ['信徒之選，夜晚特別旺', '業主誠意急放，價錢唔使問點解', '冬暖夏涼，夏天都唔使開冷氣', '無敵海景，尾班船後特別清靜'],
};
// 每次入地產舖，每個樓盤抽一句口號（同一次睇樓唔會變）
export let litNow: Record<string, string | undefined> = {};
export const litOf = (k: string): string | undefined => { const l = ESTATE_LIT[k]; if (!l) return ''; return litNow[k] || (litNow[k] = l[Math.floor(Math.random() * l.length)]); };
// 信徒之選：隱藏特價盤，大約三日有一日放上櫥窗（簽咗就一直喺度）
export const hauntToday = (): boolean => { const d = typeof todayStr==='function' ? todayStr() : ''; let h = 0; for (const c of d) h = (h * 31 + c.charCodeAt(0)) % 997; return h % 3===0; };   // 舖大細換做呎數
export let agentLine = AGENT_SAY[0];
export interface Listing { attrs: string; cls?: string; tag: string; pic: string; fit?: boolean; name: string; sub: string; blurb?: string; pts: string[]; price: string; act: string }
export function estateHtml(): string {
  const card = (o: Listing): string => `<button type="button" class="listing${o.cls ? ' ' + o.cls : ''}" ${o.attrs}>
      <span class="ls-tag">${o.tag}</span><img class="pv${o.fit ? ' fit' : ''}" src="${o.pic}" alt="">
      <b class="ls-name">${o.name}</b><span class="ls-sub">${o.sub}</span>
      ${o.blurb ? `<span class="ls-blurb">「${o.blurb}」</span>` : ''}<span class="ls-pts">${o.pts.map(t => `<i>${t}</i>`).join('')}</span>
      <span class="ls-price">${o.price}</span><span class="ls-act">${o.act}</span></button>`;
  let list;
  if (decorSub==='place'){
    list = Object.entries(PLACES).filter(([k]) => k!=='pl-haunt' || hauntToday() || SHOP.own.includes(k) || ((must(SHOP.levels, 'SHOP.levels')['halloween'] ?? 0)|0) >= 3).map(([k, d]) => {
      const own = SHOP.own.includes(k), cur = k===SHOP.place, prev = decorLook('place')===k && !own, lock = lookLocked(d);
      const [tag, eff] = d.fx.includes('：') ? d.fx.split('：') : ['街坊舖', d.fx];
      return card({ attrs:`data-k="place" data-v="${k}"`, cls: cur ? 'cur' : prev ? 'prev' : lock ? 'lock' : '',
        tag: cur ? '現租' : own ? '已簽約' : lock ? '未開放' : d.ghost ? '特價盤' : d.p >= 2500 ? '旺舖' : '筍盤',
        pic: pvURL('Lplace' + k, () => lookPreview('place', k)), name: d.name, sub: String(tag), blurb: litOf(k),
        pts: must(eff, 'place effect').split(/，|、/).map(t => t.trim()).filter(Boolean),
        price: (own || !d.p ? '免頂手費' : `頂手費 $${d.p}`) + (typeof ownsPlace==='function' ? (ownsPlace(k) ? ' · 🏠 業主' : ` · 樓價 $${placePrice(k)}（供咗 ${(must(SHOP.mort, 'SHOP.mort')[k] ?? 0)|0}/${MORT_N}）`) : ''),
        act: cur ? '而家喺度' : own ? '撳一下搬返去' : lock ? `「${must(LEVELS[String(d.unlock)], 'level ' + String(d.unlock)).name}」三星先開放睇樓` : prev ? '再撳一下簽約' : '撳一下睇樓' });
    }).join('');
  } else {
    list = SIZES.map((z, i) => {
      const cur = i===SHOP.size, own = i < SHOP.size, next = i===SHOP.size + 1;
      return card({ attrs:`data-sz="${i}"`, cls: cur ? 'cur' : next ? '' : own ? 'own' : 'lock',
        fit:true, tag: cur ? '現租' : own ? '住過' : next ? '可擴' : '未開放', pic: pvURL('S' + String(i), () => sizePreview(i)),
        name: z.name, sub: `約 ${String(SIZE_FT[i])} 呎 · ${z.gx}×${z.gy} 格`, pts: [String(['夠擺六至八張枱', '夠擺十張枱', '十二張枱都擺得落'][i]), String(['街坊細舖，夠晒溫馨', '多啲位擺擺設', '大到可以搞套裝'][i])],
        price: own || cur ? '已經擴咗' : `擴舖費 $${z.p}`, act: cur ? '而家喺度' : next ? '撳一下擴舖' : own ? '' : '要逐級擴' });
    }).join('');
  }
  return `<div class="estate"><div class="es-head">${iconImg('how', 'agent')}<span><b>發達地產</b><small>舖位專家 · 睇樓免費</small></span></div>
    <p class="es-say">「${String(agentLine)}」</p>
    <div class="es-window">${list}</div></div>`;
}
export function sizePreview(i: number): string {
  return pvCanvas(() => {
    const z = must(SIZES[i], 'size ' + String(i)), c = Math.floor(Math.min((PV_W - 8) / must(SIZES[2], 'size 2').gx, (PV_H - 8) / must(SIZES[2], 'size 2').gy)); P(0, 0, PV_W, PV_H, '#e6ecef');
    const ox = Math.round((PV_W - z.gx * c) / 2), oy = Math.round((PV_H - z.gy * c) / 2);
    P(ox - 2, oy - 2, z.gx * c + 4, z.gy * c + 4, '#2b3036');
    for (let x = 0; x < z.gx; x++) for (let y = 0; y < z.gy; y++) P(ox + x * c, oy + y * c, c, c, (x + y) % 2 ? '#eaf1ec' : '#d5e5dc');
    for (let k = 0; k < 4 + i * 2; k++) P(ox + c + (k % 3) * c * 4, oy + c + Math.floor(k / 3) * c * 3, c * 2, c * 2, '#a5372f');
    P(ox + z.gx * c, oy + z.gy * c - c * 3, 2, c * 2, '#c9d1d6');
  });
}
export function decorUI(): void {
  const tabs: [string, string][] = [['move','擺位'], ['look','外觀'], ['buy','買嘢'], ['grow','舖位']];
  // 外觀、買嘢再分細類，一次淨係睇一類，唔使碌好長
  const SUBS: Record<string, [string, string][]> = { look: [['wall','牆身'], ['floor','地磚'], ['sign','招牌'], ['awning','簷篷']], grow: [['size','舖大細'], ['place','地段']],
    buy: [['tables','枱'], ['items','擺設'], ...Object.entries(SETS_DECOR).map(([k, s]): [string, string] => [k, s.name])] };
  const subs = SUBS[decorTab];
  if (subs && !subs.some(([k]) => k===decorSub)) decorSub = must(subs[0], 'first sub-tab')[0];
  const subRow = subs ? `<div class="dsubs">${subs.map(([k, n]) => `<button type="button" data-sub="${k}" aria-pressed="${String(k===decorSub)}">${n}${SETS_DECOR[k] ? ` ${setOwned(k).length}/${SETS_DECOR[k].items.length}` : ''}</button>`).join('')}</div>` : '';
  let body: string;
  if (decorTab==='move'){
    const sellable = decorSel && (decorSel.t==='item' || decorSel.i >= BASE);
    body = `<p class="dhint">${decorSel ? `搬緊<b>${selName(decorSel)}</b>：撳綠色地下放低` : '撳張枱或者擺設，再撳地下搬過去；撳同款枱就對調'}</p>
      <div class="drow">${decorSel && decorSel.t==='item' ? '<button type="button" class="dbtn alt" id="decorRot">轉方向</button>' : ''}${sellable ? `<button type="button" class="dbtn alt" id="decorSell">賣走（退一半錢）</button>` : ''}<button type="button" class="dbtn alt" id="decorReset">本身六張枱擺返原位</button></div>`;
  } else if (decorTab==='look'){
    const pl = must(PLACES[String(decorLook('place'))], 'place'), hints: Record<string, string | undefined> = { wall:'撳一下試睇，再撳一下買', floor:'撳一下試睇，再撳一下買', sign:'招牌寫住你間舖個名', awning:'喺門口上面',
      place:`間舖開喺舊香港邊度？每個地方有唔同加成。<br><b>${pl.name}</b>：${pl.fx}` }, hint = hints[decorSub];
    const kind = must(ownKey(LOOKS, decorSub) ? decorSub : null, 'look kind ' + decorSub);
    body = `${subRow}<p class="dh">${String(hint)}</p><div class="dchips grid">${lookChips(kind, LOOKS[kind])}</div>`;
  } else if (decorTab==='buy'){
    const full = SHOP.tables.length >= MAXT, itemCard = (k: string): string => { const d = must(ITEMS[k], 'item ' + k), own = SHOP.items.some(q => q.type===k), lk = typeof itemLocked==='function' && itemLocked(k);
      return chip(`data-bi="${k}"`, pvURL('I' + k, () => itemPreview(k)), d.name, lk ? `🔒「長洲萬聖夜」${String(d.star)}★` : own ? `有 · 再買 $${d.p}` : `$${d.p}`, own ? 'on' : lk ? 'lockc' : ''); };
    if (decorSub==='tables') body = `${subRow}<p class="dh">而家 ${SHOP.tables.length} 張枱、${TABLES.reduce((a, t) => a + t.cap, 0)} 個位；位多啲，客會嚟密啲</p>
      <div class="dchips grid">${Object.entries(TKINDS).map(([k, d]) => chip(`data-bt="${k}"`, pvURL('T' + k, () => tablePreview(k)), `${d.name} · ${d.cap}位`, full ? '最多 12 張' : `$${d.p}`)).join('')}</div>`;
    else if (decorSub==='items') body = `${subRow}<p class="dh">單件擺設</p><div class="dchips grid">${Object.keys(ITEMS).filter(k => !SET_ITEMS[k]).map(itemCard).join('')}</div>`;
    else { const st = must(SETS_DECOR[decorSub], 'set ' + decorSub), n = setOwned(decorSub).length;
      body = `${subRow}<p class="dh">${st.name}套裝 ${n}/${st.items.length}${n===st.items.length ? ' ✓ 已齊，效果生效緊' : ''}</p>
        <p class="setfx${n===st.items.length ? ' on' : ''}"><b>齊套效果</b>${st.fx}<br>門面多一盞<i style="background:${st.lantern}"></i>燈籠，齊晒五套招牌會發金光</p>
        <div class="dchips grid">${st.items.map(itemCard).join('')}</div>`; }
  } else body = `${subRow}${estateHtml()}`;
  must($('decorBar'), 'decorBar').innerHTML = `
    <div class="drow"><div class="dtabs">${tabs.map(([k, n]) => `<button type="button" data-tab="${k}" aria-pressed="${String(k===decorTab)}">${n}</button>`).join('')}</div><span class="dbank">積蓄 <b>$${SHOP.bank}</b></span></div>
    <div class="dbody">${body}</div>
    <button type="button" class="dbtn" id="decorDone">搞掂</button>`;
}
export function pay(p: number, what: string): boolean {
  if (SHOP.bank < p){ toast(`唔夠錢，仲差 $${p - SHOP.bank}`); return false; }
  SHOP.bank -= p; toast(`買咗${what}`); return true;
}
export function rebuildDecorGame(): void { newGame(); liveG().running = false; liveG().station = 'decor'; liveG().groups = []; liveG().payQ = []; }
must($('decorBar'), 'decorBar').addEventListener('click', e => {
  const b = evEl(e.target).closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.tab){ if (d.tab==='grow'){ agentLine = pickSure(AGENT_SAY); litNow = {}; } decorTab = d.tab; if (decorTab!=='move') decorSel = null; decorUI(); return; }
  if (d.sub){ decorSub = d.sub; decorUI(); return; }
  if (b.id==='decorDone'){ closeDecor(); return; }
  if (b.id==='decorReset'){
    TDEF.forEach(([, tx, ty], i) => { if (SHOP.tables[i]) setPos({ t:'table', i }, { tx, ty }); });
    // 其他嘢如果撞到，搵過個空位
    SHOP.tables.forEach((_, i) => { const s: DecorSel = { t:'table', i }; if (i >= BASE && !fits(s, must(TPOS[i], 'table ' + String(i)))){ const p = freeSpot(s); if (p) setPos(s, p); } });
    SHOP.items.forEach((_, i) => { const s: DecorSel = { t:'item', i }; if (!fits(s, must(SHOP.items[i], 'item ' + String(i)))){ const p = freeSpot(s); if (p) setPos(s, p); } });
    decorSel = null; decorUI(); return;
  }
  if (b.id==='decorRot' && decorSel && decorSel.t==='item'){
    const sel = decorSel, q = must(SHOP.items[sel.i], 'item ' + String(sel.i)); q.rot = !q.rot;
    if (!fits(sel, { tx:q.tx, ty:q.ty })){
      // 原位轉唔到：喺附近（一格半內）搵個位
      let best: TilePos | null = null;
      for (let r = .5; r <= 1.5 && !best; r += .5) for (const dx of [0, -r, r]) for (const dy of [0, -r, r]){ const p = { tx:q.tx + dx, ty:q.ty + dy }; if (!best && p.tx >= 0 && p.ty >= 0 && fits(sel, p)) best = p; }
      if (!best){ q.rot = !q.rot; toast('轉唔到，隔籬冇位，搬開少少先'); return; }
      q.tx = best.tx; q.ty = best.ty;
    }
    saveShop(); decorUI(); return;
  }
  if (b.id==='decorSell' && decorSel){
    const s = decorSel;
    if (s.t==='item'){ SHOP.bank += Math.floor(must(ITEMS[must(SHOP.items[s.i], 'item ' + String(s.i)).type], 'item').p / 2); SHOP.items.splice(s.i, 1); }
    else { SHOP.bank += Math.floor(must(TKINDS[must(SHOP.tables[s.i], 'table ' + String(s.i)).kind], 'table kind').p / 2); SHOP.tables.splice(s.i, 1); applyShop(); rebuildDecorGame(); }
    saveShop(); decorSel = null; decorUI(); return;
  }
  if (d.k){
    const kind = must(ownKey(LOOKS, d.k) ? d.k : null, 'look kind ' + d.k), v = String(d.v), item = LOOKS[kind][v];
    if (SHOP.own.includes(v)){ SHOP[kind] = v; decorPrev[kind] = null; saveShop(); }
    else if (decorPrev[kind]===v){
      const it = must(item, 'look ' + v);
      if (lookLocked(it)){ toast(`喺關卡「${must(LEVELS[String(it.unlock)], 'level ' + String(it.unlock)).name}」攞三星先買得`); return; }
      if (!pay(it.p, it.name)) return; SHOP.own.push(v); SHOP[kind] = v; decorPrev[kind] = null; saveShop();
    }
    else decorPrev[kind] = v;
    decorUI(); return;
  }
  if (d.bt){
    if (SHOP.tables.length >= MAXT){ toast('最多 12 張枱'); return; }
    const k = must(TKINDS[d.bt], 'table kind ' + d.bt);
    // 試擺：先加入去搵位，搵唔到就退返
    SHOP.tables.push({ kind:d.bt, tx:0, ty:0 }); TPOS.push({ tx:0, ty:0, w:k.w });
    const s: DecorSel = { t:'table', i: SHOP.tables.length - 1 }, p = freeSpot(s);
    if (!p || !pay(k.p, k.name)){ SHOP.tables.pop(); TPOS.pop(); if (!p) toast('冇位擺，擴舖先'); return; }
    must(SHOP.tables[s.i], 'new table').tx = p.tx; must(SHOP.tables[s.i], 'new table').ty = p.ty; saveShop(); applyShop(); rebuildDecorGame();
    decorSel = s; decorTab = 'move'; decorUI(); return;
  }
  if (d.bi){
    // `it` is checked where it is declared: an unknown item already threw in itemLocked() (sets.js) in the JS.
    const it = must(ITEMS[d.bi], 'item ' + d.bi);
    if (typeof itemLocked==='function' && itemLocked(d.bi)){ toast(`喺「長洲萬聖夜」攞 ${String(it.star)} 粒星先買得（萬聖節限定，解鎖咗一直留低）`); return; }
    SHOP.items.push({ type:d.bi, tx:0, ty:0 });
    const s: DecorSel = { t:'item', i: SHOP.items.length - 1 }, p = freeSpot(s);
    if (!p || !pay(it.p, it.name)){ SHOP.items.pop(); if (!p) toast('冇位擺，擴舖先'); return; }
    must(SHOP.items[s.i], 'new item').tx = p.tx; must(SHOP.items[s.i], 'new item').ty = p.ty; saveShop(); checkSets();
    decorSel = s; decorTab = 'move'; decorUI(); return;
  }
  if (d.sz !== undefined){
    const i = +d.sz;
    if (i <= SHOP.size) return;
    if (i > SHOP.size + 1){ toast(`要擴做${must(SIZES[SHOP.size + 1], 'next size').name}先`); return; }
    if (!pay(must(SIZES[i], 'size').p, `擴做${must(SIZES[i], 'size').name}`)) return;
    SHOP.size = i; saveShop(); applyShop(); decorUI(); return;
  }
});
export function openDecor(tab?: unknown): void {
  decorMode = true; decorSel = null; decorPrev = { wall:null, floor:null, sign:null, awning:null, place:null }; decorTab = typeof tab==='string' ? tab : 'move';
  if (decorTab==='grow'){ decorSub = 'place'; agentLine = pickSure(AGENT_SAY); litNow = {}; }
  rebuildDecorGame();
  ['startView','endView','pauseView'].forEach(id => { must($(id), id).hidden = true; });
  must($('floorWrap'), 'floorWrap').hidden = false; must($('doorWrap'), 'doorWrap').hidden = true;
  must($('till'), 'till').hidden = must($('pad'), 'pad').hidden = must($('barView'), 'barView').hidden = must($('barPad'), 'barPad').hidden = must($('kitView'), 'kitView').hidden = must($('kitPad'), 'kitPad').hidden = true;
  must($('floor'), 'floor').classList.add('sr-only'); must($('fscene'), 'fscene').hidden = false; must($('viewBtn'), 'viewBtn').hidden = true; must($('pauseBtn'), 'pauseBtn').hidden = true;
  { const st = document.querySelector('.hud .stats'); must(st instanceof HTMLElement ? st : null, '.hud .stats').hidden = true; } must($('clockLbl'), 'clockLbl').textContent = '裝修';
  must($('decorBar'), 'decorBar').hidden = false; decorUI();
}
export function closeDecor(): void {
  decorMode = false; decorSel = null;
  must($('decorBar'), 'decorBar').hidden = true; must($('viewBtn'), 'viewBtn').hidden = false; must($('pauseBtn'), 'pauseBtn').hidden = false;
  { const st = document.querySelector('.hud .stats'); must(st instanceof HTMLElement ? st : null, '.hud .stats').hidden = false; }
  showBackdrop(); applyView(); buildMenus(); must($('startView'), 'startView').hidden = false;
}
// 彩蛋：開工畫面撳招牌五下，老闆打賞 $300（一個帳號得一次）
// 開發用：網址加 ?dev 先係舊版密技（$5000 + 5★，無限次）
export let titleTaps = 0, titleT = 0;
export const DEV = /[?&]dev\b/.test(location.search);
must(document.querySelector('#startView .brand'), '#startView .brand').addEventListener('click', () => {
  const now = Date.now(); titleTaps = now - titleT < 800 ? titleTaps + 1 : 1; titleT = now;
  if (titleTaps < 5) return; titleTaps = 0;
  if (DEV){ SHOP.bank += 5000; saveShop(); careerCheat(); toast('（開發模式）老闆借咗 $5000 畀你，再送 5★'); return; }
  if (SHOP.eggs && SHOP.eggs.boss){ toast('老闆：「你又嚟？返工啦！」'); return; }
  SHOP.eggs = SHOP.eggs || {}; SHOP.eggs.boss = true; SHOP.bank += 300; saveShop(); if (typeof renderCareer==='function') renderCareer();
  toast('老闆見你咁有誠意，打賞 $300（得一次㗎咋）');
});
// 收工：今更營業額入積蓄
export function bankRevenue(): void {
  if (!G || G.banked) return;
  const po = typeof payout==='function' ? payout() : { get: G.revenue, lines: [] };
  G.banked = true; SHOP.bank += po.get; if (!G.tut && !G.level) SHOP.dayRev = (SHOP.dayRev|0) + Math.round(G.revenue); saveShop();
  const press = pressSettle();   // 硬核模式: rent owing, warnings, the shop lost or won back
  must($('result'), 'result').insertAdjacentHTML('beforeend', po.lines.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('') + press + `<div><span>舖頭積蓄</span><b>$${SHOP.bank}</b></div>`);
}
