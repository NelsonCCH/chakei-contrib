// 關卡：固定嘅舖、餐牌、時段同難度，好似 Overcooked 咁按營業額攞一至三粒星；一個人玩或者組隊都用呢套
// TypeScript port of the original game's levels.js, as an ES module: every
// top-level name is exported, none renamed.
import './mastery';   // load order: src/entry.ts
import { must, ownKey } from '../core/util';
import { speedGoal, isSpeedStation, SPEED_WHAT, type SpeedGoal } from '../core/referee/speed';
import { STATIONS, DIFFS, SLOTS } from '../core/data/menus';
import { diff, slot, setDiff, setSlot, liveG, station, setStation } from '../core/state';
import { $ } from './prefs';
import { toast } from './ui';
import { SHOP, useFixedShop, saveShop } from './decor';
import { sfx } from './juice';
import { RECIPES } from './menu';
import { lvAll3, STAR_PRIZE, DAILY3, levelMult, pickLevel } from './market';
import { bossSay, GOALS, todayStr, roleOpenNow, ptAllRolesOn } from './career';
import { levelRoles } from '../core/work/roles';
import { dexCheck } from './dex';
import { catOpen, gateNeed, gateOk, CAT_GATE } from './gates';
import { track, trackOnce } from './stats';
import { NET } from '../net/net';
import { seg, ST_LIST, ST_ICO, saveSet, buildMenus, start } from './main';
import { SEAT_NAMES } from './seat';
import { isExtraKind } from '../core/referee/extras';
import { seatOptions, pickerCur, pickX, pickedX } from './xseat';
import { shiftMeasure, measureTxt, measureName } from '../core/career/targets';
import { levelSeats } from '../core/career/seats';

/** The level with this id. The JS indexed LEVELS with whatever it had (null/undefined become 'null'/'undefined' keys,
 *  exactly as String() makes them) and then dereferenced the result, so a missing level throws here as it threw there. */
export const lvGet = (id: string | null | undefined): Level => must(LEVELS[String(id)], 'level ' + String(id));
/** An element that carries `dataset` (HTML or SVG). The JS read `.dataset.x` straight off it, which throws for any other. */
export function dsEl(x: Element): HTMLElement | SVGElement {
  if (x instanceof HTMLElement || x instanceof SVGElement) return x;
  throw new TypeError('chakei: element without dataset');
}
/** `el.closest(sel)` on an event target, as the JS wrote `e.target.closest(sel)`: throws (like the JS) when the target is
 *  not an element. Every selector here matches the game's own buttons and boxes, which carry `dataset`. */
export function closestIn(t: EventTarget | null, sel: string): HTMLElement | SVGElement | null {
  if (!(t instanceof Element)) throw new TypeError('chakei: event target is not an element');
  const c = t.closest(sel);
  return c === null ? null : dsEl(c);
}
/** STATIONS[st] for a station id the game keeps as a plain string (G.station); the JS dereferenced it unchecked. */
export const stDef = (st: string): StationDef => must(ownKey(STATIONS, st) ? STATIONS[st] : undefined, 'station ' + st);
/** Any seat's name: the shop's four (STATIONS) or a new seat (傳菜, 燒味, 外賣). */
export const seatName = (st: string): string => isExtraKind(st) ? SEAT_NAMES[st] : st==='waiter' ? '樓面' : stDef(st).name;   // 伙記's seat is 樓面
/** A station id read from a button the game drew (data-st, data-train). The JS assigned it unchecked. */
export function stationOf(v: string | undefined): StationId {
  if (v !== undefined && ownKey(STATIONS, v)) return v;
  throw new TypeError('chakei: not a station: ' + String(v));
}

/* ===================== 關卡 ===================== */
export const LUNCH_BASE = ['f:餐蛋麵','f:火腿通粉','f:西多士','f:菠蘿油','k:奶茶','k:檸茶'];
// 燒味 dishes (`r:` keys, the roast counter's own menu, core/referee/extras.ts roastDish) on the levels with the role
export const ROAST_NEWYEAR = ['r:叉燒飯','r:燒肉飯','r:燒鴨飯','r:油雞飯','r:叉燒燒肉雙拼飯','r:燒鴨叉燒雙拼飯'];
export const ROAST_ALL = [...ROAST_NEWYEAR, 'r:叉燒油雞雙拼飯','r:三寶飯','r:燒鴨瀨粉','r:叉燒瀨粉','r:油雞瀨粉','r:叉燒湯河','r:燒鴨湯米','r:油雞湯米'];
export const B4: LayTable[] = [['booth',1,.5],['booth',4.5,.5],['booth',1,3.5],['booth',4.5,3.5]];
export const LEVELS: Record<string, Level> = {
  estate: { n:1, name:'屋邨茶記', where:'公屋樓下', slot:'lunch', desc:'街坊幫襯，客人有耐性，啱熱身。',
    lay:{ size:0, tables:[...B4, ['small',1,6.5], ['small',4.5,6.5]], wall:'green', floor:'mosaic' },
    menu: LUNCH_BASE, gap:3.2, pat:1.8, stars:[290, 440, 590] },
  central: { n:2, roles:{ runner:1 }, name:'中環早餐', where:'寫字樓樓下', slot:'breakfast', desc:'返工族趕住打卡，個個都急。',
    lay:{ size:0, tables:[...B4, ['small',1,6.5], ['small',4.5,6.5], ['small',7,.5], ['small',7,3.5]], wall:'cream', floor:'check' },
    menu:['s:A餐','s:B餐','s:C餐','k:奶茶','k:檸茶','k:鴛鴦'], gap:2.6, pat:1.3, stars:[310, 480, 650] },
  mongkok: { n:3, roles:{ runner:2, takeaway:1 }, name:'旺角晚市', where:'彌敦道橫街', slot:'dinner', desc:'碟頭飯、炒底、走青，人又多。',
    lay:{ size:1, tables:[['booth',1,.5],['booth',4.5,.5],['booth',8,.5],['booth',1,3.5],['booth',4.5,3.5],['booth',8,3.5],['small',1,6.5],['small',4.5,6.5]], wall:'green', floor:'terra' },
    menu:['d:粟米肉粒飯','d:番茄牛肉飯','d:揚州炒飯','d:豉椒排骨飯','d:咖喱牛腩飯','k:奶茶','k:檸茶','k:檸水'], gap:3.3, pat:1.2, stars:[360, 560, 760] },
  airport: { n:4, roles:{ runner:3, takeaway:2 }, name:'機場茶記', where:'離境大堂', slot:'lunch', desc:'客人趕上機，耐性好短，但叫得貴。',
    lay:{ size:0, tables:[...B4, ['small',1,6.5], ['small',4.5,6.5], ['small',7,.5]], wall:'blue', floor:'check' },
    menu:[...LUNCH_BASE, 'f:沙嗲牛麵','f:常餐','f:乾炒牛河','f:焗豬扒飯','k:鴛鴦'], gap:3, pat:.9, stars:[400, 620, 840] },
  typhoon: { n:5, roles:{ runner:4, takeaway:3 }, name:'打風前夕', where:'八號波掛波前', slot:'lunch', desc:'聽講就嚟掛八號波，全街人湧入嚟醫肚。',
    lay:{ size:1, tables:[['booth',1,.5],['booth',4.5,.5],['booth',8,.5],['booth',1,3.5],['booth',4.5,3.5],['small',8,3.5],['small',1,6.5],['small',4.5,6.5]], wall:'cream', floor:'mosaic' },
    menu:[...LUNCH_BASE, 'f:沙嗲牛麵','f:常餐','k:鴛鴦','k:檸水'], gap:2.7, pat:1.1, stars:[370, 570, 770] },
  newyear: { n:6, roles:{ runner:5, takeaway:4, roast:1 }, name:'年廿八洗邋遢', where:'新年前最後一個晚市', slot:'dinner', desc:'得八張枱，全餐牌，人山人海，翻枱要快。',
    lay:{ size:1, tables:[['booth',1,.5],['booth',4.5,.5],['booth',8,.5],['booth',1,3.5],['booth',4.5,3.5],['booth',8,3.5],['small',1,6.5],['small',4.5,6.5]], wall:'blue', floor:'terra' },
    menu:[...RECIPES.dinner.items.map(x => x[0]), ...RECIPES.drinks.items.map(x => x[0]), ...ROAST_NEWYEAR], gap:2.2, pat:1, stars:[630, 970, 1310] },
  latenight: { n:7, roles:{ runner:6, takeaway:5, roast:2 }, name:'通宵夜更', where:'深水埗，通宵營業', slot:'dinner', clock:{ start:23*60, endTxt:'一點正 · 夜更完', label:'夜更' },
    desc:'凌晨先收工嘅夜貓：的士佬、夜歸人、通宵打機仔，一個人一個人入嚟。唔多話、點嘢快，但肚餓起上嚟冇乜耐性。',
    lay:{ size:0, tables:[['booth',1,.5],['booth',4.5,.5],['small',1,3.5],['small',4.5,3.5],['small',1,6.5],['small',4.5,6.5],['small',7,3.5]], wall:'blue', floor:'terra', place:'pl-jordan', signText:'通宵茶記', awning:'aw-none', fans:[[3,3.2],[3,6.2]] },
    menu:['d:粟米肉粒飯','d:番茄牛肉飯','d:揚州炒飯','d:豉椒排骨飯','d:咖喱牛腩飯','k:奶茶','k:檸茶','k:咖啡','r:叉燒飯','r:燒鴨飯','r:叉燒油雞雙拼飯','r:燒鴨瀨粉'], nightLabels:['夜更的士佬','夜歸OL','通宵打機仔','保安阿叔','夜貓學生'], sizes:[.5, .8, .92], gap:1.7, pat:.95, stars:[480, 740, 1000] },
  // ---- 年代關卡（era）：致敬唔同年代嘅茶記，唔使逐關解鎖 ----
  bingsutt: { n:101, era:'五十年代', name:'街角冰室', where:'五十年代舊區街角', slot:'lunch',
    desc:'細牌唔准明火：得多士爐、焗爐同凍櫃。街坊嚟飲冰、食蛋撻、傾偈。',
    lay:{ size:0, tables:[['booth',1,.5],['booth',4.5,.5],['small',1,3.5],['small',4.5,3.5],['small',1,6.5],['small',4.5,6.5],['small',7,3.5]], wall:'bingsutt', floor:'tiny', fold:true, fans:[[3.2,3],[3.2,6.4]] },
    kit:{ st:{ toaster:['多士'], oven:['蛋撻'] }, inst:['菠蘿包','方包','牛油','火腿'], instName:'凍櫃' },
    menu:['f:菠蘿油','f:蛋撻','f:牛油多士','f:火腿三文治','k:奶茶','k:紅豆冰','k:阿華田'], gap:2.4, pat:1.3, stars:[280, 430, 580] },
  village: { n:104, era:'舊區', name:'村口冰室最後一日', where:'茶果嶺村（清拆前）', slot:'lunch',
    desc:'村就嚟清拆，開咗幾十年嘅冰室最後一日營業。街坊同慕名而來嘅人排長龍，一半人都要食西多士。',
    // 窄長舖：左右兩邊淨係木卡位，中間一條通道，門口喺短邊正中（趟閘）
    lay:{ size:0, gx:11, gy:6, door:[2.3, 3.7], bing:true,
      tables:[['booth',1,.2],['booth',3.6,.2],['booth',6.2,.2],['booth',8.8,.2],['booth',1,3.8],['booth',3.6,3.8],['booth',6.2,3.8]],
      wall:'plaster', floor:'cement', place:'pl-village', signText:'村口冰室', fans:[[3,3],[7,3]] },
    menu:['f:西多士','f:菠蘿油','f:火腿通粉','f:餐蛋麵','k:奶茶','k:檸茶','k:鴛鴦'], favor:'西多士', gap:3.1, pat:1.4, stars:[360, 560, 760] },
  silver: { n:105, era:'舊區', name:'樓下冰室', where:'華富邨（已結業）', slot:'lunch',
    desc:'邨裏面開咗半世紀嘅冰室，街坊落樓飲杯絲襪奶茶、食個菠蘿油。一半客都叫奶茶，水吧要快。',
    // 跟相：一邊淺木卡位、一邊白色圓枱木櫈，中間通道；黃牆灰藍紙皮石腳，灰藍細地磚
    lay:{ size:0, gx:10, gy:7, silver:true,
      tables:[['booth',1,.2],['booth',3.6,.2],['booth',6.2,.2],['small',1.2,4.8],['small',3.4,4.8],['small',5.6,4.8],['small',7.8,4.8],['small',7.8,2.6]],
      wall:'yellowdado', floor:'greymo', place:'pl-estate', signText:'樓下冰室', awning:'aw-green', fans:[[3,3.5],[7,3.5]] },
    menu:['f:餐蛋麵','f:火腿通粉','f:西多士','f:菠蘿油','k:奶茶','k:檸茶','k:鴛鴦'], favorDrink:'奶茶', gap:2.2, pat:1.3, stars:[380, 580, 780] },
  kwc: { n:106, roles:{ roast:1 }, era:'舊區', name:'城寨冰室', where:'九龍城寨（八十年代）', slot:'lunch',
    desc:'城寨入面一間細細嘅冰室：低樓底、頭頂一堆電線水喉、魚缸、圓摺枱紅膠櫈。人多到逼爆，一半客都要城寨叉燒飯，好多人仲要「加頂帽」（加隻煎蛋）。',
    lay:{ size:0, gx:9, gy:8, walled:true, dim:true,
      tables:[['small',1,.4],['small',3.2,.4],['small',5.4,.4],['small',1,2.8],['small',3.2,2.8],['small',5.4,2.8],['small',1,5.4],['small',3.2,5.4],['booth',6.6,5]],
      wall:'grime', floor:'terra', place:'pl-walled', signText:'城寨冰室', fans:[[2.5,2],[5.5,4.5]] },
    kit:{ st:{ pot:['公仔麵'], pan:['煎蛋','西多士'] }, inst:['飯','叉燒','餐肉','菠蘿包','牛油'] },
    menu:['r:城寨叉燒飯','r:叉燒飯','f:餐蛋麵','f:西多士','f:菠蘿油','k:奶茶','k:鴛鴦','k:檸茶'], sizes:[.6, .92, .98], gap:1.9, pat:.95, stars:[400, 610, 820] },
  milktea: { n:107, roles:{ takeaway:1 }, era:'經典茶記', name:'布袋奶茶檔', where:'中環橫街（由街邊鐵皮檔起家）', slot:'lunch',
    desc:'致敬絲襪奶茶老檔：紅色舖面俾門口綠色鐵皮奶茶檔遮住大半，入面白瓷片、紅階磚、木圓枱圓凳。奶茶檔直接對街，外賣客喺檔口排隊，水吧沖好即刻收錢。豬扒包、蔥油雞扒撈丁，茶膽要撞夠六下。',
    lay:{ size:0, gx:9, gy:9, lanfong:true,
      tables:[['round',1,.4],['round',4.1,.4],['round',1,3.3],['round',4.1,3.3],['round',1,6.2],['round',4.1,6.2],['small',7,.5],['small',7,3.4]],
      wall:'whitetile', floor:'terra', place:'pl-central', signText:'布袋奶茶', awning:'aw-none', fans:[[3,2],[3,5.5]] },
    kit:{ st:{ pot:['公仔麵'], pan:['豬扒', '雞扒', '西多士'], toaster:['餐包'] }, inst:['蔥', '牛油', '菠蘿包'], n:{ toaster:2 } },
    menu:['f:豬扒包','f:蔥油雞扒撈丁','f:西多士','f:菠蘿油','k:奶茶','k:檸茶','k:鴛鴦'], favor:'豬扒包', favorDrink:'奶茶', pulls:6, gap:2.4, pat:1.1, stars:[630, 970, 1310] },
  fastmilk: { n:108, roles:{ runner:1 }, era:'經典茶記', name:'火速奶公司', where:'佐敦（坐低就要叫）', slot:'lunch',
    desc:'致敬以快同惡出名嘅奶公司：門口長期排長龍，入面白瓷片、綠水磨石地、一張張四人圓枱，幾乎冇卡位，四圍搭枱。炒蛋多士、燉奶、火腿通粉。一坐低就要叫，客人只講一次，唔會講第二次！',
    lay:{ size:0, gx:11, gy:9, dairy:true,
      tables:[['round',1,.4],['round',4.1,.4],['round',7.2,.4],['round',1,3.3],['round',4.1,3.3],['round',7.2,3.3],['round',1,6.2],['round',4.1,6.2],['small',7.2,6.6]],
      wall:'whitetile', floor:'greenterr', place:'pl-jordan', signText:'火速奶公司', awning:'aw-none', fans:[[3,2.5],[6.5,5]] },
    kit:{ st:{ pot:['通粉'], pan:['炒蛋', '煎蛋'], toaster:['多士'] }, inst:['火腿', '燉奶', '牛油'] },
    menu:['f:炒蛋多士','f:燉奶','f:火腿通粉','k:奶茶','k:檸茶','k:鴛鴦'], favor:'炒蛋多士', oneSay:5, sizes:[.3, .6, .72], gap:3.8, pat:.8, stars:[250, 380, 510] },
  hangwan: { n:109, roles:{ takeaway:2 }, era:'經典茶記', name:'行運茶餐廳', where:'旺角街舖（樓上有閣樓）', slot:'lunch',
    desc:'舊式冰廳餅店：門口餅櫃擺滿菠蘿包蛋撻，樓下橙色卡位淺藍枱，樓梯上閣樓仲有位。菠蘿油同蛋撻最好賣。',
    lay:{ size:0, gx:10, gy:8, hangwan:true, bakery:true, loft:[0, 0, 6, 2.6, 34], fold:'red',
      tables:[['booth',1,.3,34],['booth',3.6,.3,34],['booth',1,3.4],['booth',3.6,3.4],['booth',6.2,3.4],['small',1,6.2],['small',3.4,6.2],['small',5.8,6.2],['small',8,4.4]],
      wall:'cream', floor:'greymo', place:'pl-town', signText:'行運茶餐廳', awning:'aw-none', fans:[[4,5],[7.5,2]] },
    kit:{ st:{ pot:['通粉', '公仔麵'], pan:['煎蛋', '西多士'], oven:['蛋撻'] }, inst:['火腿', '餐肉', '菠蘿包', '牛油'] },
    menu:['f:菠蘿油','f:蛋撻','f:餐蛋麵','f:火腿通粉','f:西多士','k:奶茶','k:檸茶','k:鴛鴦'], favor:'菠蘿油', gap:2.5, pat:1.1, stars:[360, 550, 740] },
  sixties: { n:102, era:'六十年代', name:'新牌茶餐廳', where:'1960 年冰室換新牌', slot:'lunch',
    desc:'新牌照終於准開爐！火腿通粉、西多士、焗豬扒飯，豉油西餐登場；冰室嘅紅豆冰同蛋撻照賣。',
    lay:{ size:0, tables:[...B4, ['small',1,6.5], ['small',4.5,6.5], ['small',7,3.5]], wall:'sixties', floor:'check', fans:[[3.2,5.2]] },
    kit:{ st:{ pot:['通粉'], pan:['西多士'], oven:['蛋撻','焗豬扒飯'] }, inst:['火腿','菠蘿包','牛油'], n:{ oven:2 } },
    menu:['f:火腿通粉','f:西多士','f:焗豬扒飯','f:菠蘿油','f:蛋撻','k:奶茶','k:鴛鴦','k:紅豆冰'], gap:2.2, pat:1.1, stars:[390, 600, 810] },
  daipaidong: { n:103, era:'大牌檔', name:'街邊奶茶檔', where:'橫街綠色鐵皮檔', slot:'lunch',
    desc:'摺枱紅膠櫈，好多街坊淨係嚟飲杯奶茶。水吧最忙，撞茶要快！',
    lay:{ size:0, tables:[['small',1,.5],['small',4.5,.5],['small',1,3.5],['small',4.5,3.5],['small',1,6.5],['small',4.5,6.5],['small',7,.5],['small',7,3.5]], wall:'stall', floor:'street', fold:'red' },
    kit:{ st:{ pot:['公仔麵'], pan:['煎蛋'], toaster:['多士'] }, inst:['牛油','奶油','果占','餐肉','沙嗲牛'] },
    menu:['f:油占多','f:奶油多','f:餐蛋麵','f:沙嗲牛麵','k:奶茶','k:鴛鴦','k:檸茶'], foodP:.55, sizes:[.6, 1, 1], gap:1.6, pat:1, stars:[340, 520, 700] },
};
// ---- 節日限定：特定日子先開（fest = [開始月, 日, 完月, 日]） ----
LEVELS.halloween = { n:301, festTag:'萬聖限定', fest:[10, 25, 11, 2], name:'長洲萬聖夜', where:'長洲海邊，度假屋隔籬嘅宵夜檔', slot:'dinner',
  desc:'萬聖節晚黑，搭尾班船入長洲嘅人全部化咗裝：殭屍、貞子、吸血鬼。海邊靜到聽到浪聲……間中有客食完就唔見咗，枱面留低雙倍錢。',
  lay:{ size:0, gx:9, gy:8, dim:true, halloween:true, fold:'red',
    tables:[['round',1,.4],['round',4.1,.4],['round',1,3.3],['round',4.1,3.3],['small',7,.5],['small',7,3.3],['small',1,6.3],['small',4.1,6.3]],
    wall:'plaster', floor:'cement', place:'pl-island', signText:'長洲夜宵', awning:'aw-none', fans:[[3,3]] },
  menu:['d:粟米肉粒飯','d:番茄牛肉飯','d:揚州炒飯','d:咖喱牛腩飯','k:奶茶','k:檸茶','k:檸水','k:鴛鴦','k:齋啡'], costume:true, ghost:true, sizes:[.3, .65, .82], gap:2.3, pat:1.05, stars:[510, 790, 1070] };
// ---- 地獄挑戰：一開始就玩得，過到就有得 show off ----
LEVELS.hell = { n:201, hell:true, roles:{ runner:8, takeaway:8, roast:8 }, name:'地獄午市', where:'打風前夕仲有明星駕到', slot:'lunch',
  desc:'八張枱翻到飛起、全午市餐牌、客人超急、煎爐燶得特別快。三星就係「茶記戰神」。',
  lay:{ size:1, tables:[['booth',1,.5],['booth',4.5,.5],['booth',8,.5],['booth',1,3.5],['booth',4.5,3.5],['booth',8,3.5],['small',1,6.5],['small',4.5,6.5]], wall:'cream', floor:'check' },
  menu:[...RECIPES.lunch.items.map(x => x[0]), ...RECIPES.drinks.items.map(x => x[0]), ...ROAST_ALL], gap:1.5, pat:.75, burn:.6, stars:[620, 960, 1300] };
// 每個位自己一條星線：[1★, 2★, 3★] 營業額，用「真人速度」模型量：
// 2★ = 中等真人（mid profile）中位數 × 0.9，1★ = 2★ × 0.65，3★ = 2★ × 1.35。組隊條線（每關 stars）= 組隊 mid 中位數，同一條公式。
// 客流 gap、耐性 pat 都係按真人量過：第一關新手做樓面都招呼得晒，愈後愈緊，地獄關熟手都頂唔順。
// 一個人玩先用呢條；組隊照用成隊嗰條 stars（營業額係成隊嘅）。
// runner / roast / takeaway: the same formula on the mid profile alone at that seat, the computer on the four
// shop stations (scripts/xseat-calibrate.mjs). 燒味's are measured in taps = pieces.
// All four are measured with their combos feeding tips; 燒味's and 外賣's lines are the money the seat's own work booked
// (G.seatRev), not the computer shop's. With one person their third star is the seat's speed (core/referee/speed.ts).
// Every line is derived on 32 seeds (a 16-seed median moved up to 27% between seed halves),
// after 中環 / 旺角 / 通宵's pace (core/work/spec.ts); 傳菜's lines are dishes put on their tables hot, not dollars.
export const STAR_LINES: Record<string, Record<StationId | ExtraKind, [number, number, number]>> = {
  estate: { waiter: [490,760,1030], bar: [400,620,840], kitchen: [380,590,800], till: [550,850,1150],
    runner: [10,16,22], roast: [170,260,350], takeaway: [270,410,550] },
  central: { waiter: [470,720,970], bar: [420,650,880], kitchen: [360,560,760], till: [530,820,1110],
    runner: [9,14,19], roast: [150,230,310], takeaway: [210,330,450] },
  mongkok: { waiter: [560,860,1160], bar: [490,760,1030], kitchen: [400,620,840], till: [730,1120,1510],
    runner: [7,10,14], roast: [150,230,310], takeaway: [160,250,340] },
  airport: { waiter: [760,1170,1580], bar: [620,950,1280], kitchen: [490,750,1010], till: [760,1170,1580],
    runner: [12,18,24], roast: [100,150,200], takeaway: [340,530,720] },
  typhoon: { waiter: [800,1230,1660], bar: [690,1060,1430], kitchen: [470,730,990], till: [870,1340,1810],
    runner: [12,19,26], roast: [100,160,220], takeaway: [300,460,620] },
  newyear: { waiter: [1310,2020,2730], bar: [1050,1620,2190], kitchen: [920,1420,1920], till: [1220,1870,2520],
    runner: [8,13,18], roast: [200,310,420], takeaway: [250,390,530] },
  latenight: { waiter: [1350,2070,2790], bar: [1030,1580,2130], kitchen: [940,1440,1940], till: [1160,1790,2420],
    runner: [9,14,19], roast: [230,360,490], takeaway: [280,430,580] },
  bingsutt: { waiter: [350,540,730], bar: [320,490,660], kitchen: [160,240,320], till: [400,620,840],
    runner: [8,13,18], roast: [140,220,300], takeaway: [200,310,420] },
  village: { waiter: [530,810,1090], bar: [400,610,820], kitchen: [360,550,740], till: [600,930,1260],
    runner: [12,18,24], roast: [150,230,310], takeaway: [250,390,530] },
  silver: { waiter: [520,800,1080], bar: [440,670,900], kitchen: [380,590,800], till: [630,970,1310],
    runner: [10,16,22], roast: [140,220,300], takeaway: [270,410,550] },
  kwc: { waiter: [640,990,1340], bar: [550,850,1150], kitchen: [550,840,1130], till: [730,1130,1530],
    runner: [10,15,20], roast: [110,170,230], takeaway: [250,390,530] },
  milktea: { waiter: [860,1320,1780], bar: [620,960,1300], kitchen: [380,580,780], till: [760,1170,1580],
    runner: [10,16,22], roast: [160,240,320], takeaway: [250,380,510] },
  fastmilk: { waiter: [440,670,900], bar: [300,460,620], kitchen: [210,330,450], till: [530,820,1110],
    runner: [10,16,22], roast: [140,220,300], takeaway: [230,350,470] },
  hangwan: { waiter: [700,1070,1440], bar: [550,840,1130], kitchen: [550,850,1150], till: [730,1130,1530],
    runner: [12,18,24], roast: [160,240,320], takeaway: [250,380,510] },
  sixties: { waiter: [610,940,1270], bar: [430,660,890], kitchen: [250,380,510], till: [770,1180,1590],
    runner: [13,20,27], roast: [140,220,300], takeaway: [300,460,620] },
  daipaidong: { waiter: [420,640,860], bar: [330,500,680], kitchen: [370,570,770], till: [460,700,950],
    runner: [10,15,20], roast: [140,210,280], takeaway: [250,390,530] },
  halloween: { waiter: [740,1140,1540], bar: [570,880,1190], kitchen: [440,670,900], till: [980,1510,2040],
    runner: [9,14,19], roast: [110,170,230], takeaway: [250,380,510] },
  hell: { waiter: [1400,2160,2920], bar: [1060,1630,2200], kitchen: [830,1270,1710], till: [1350,2070,2790],
    runner: [8,12,16], roast: [50,80,110], takeaway: [340,530,720] },
};
/** The star lines a shift on this level is judged by: the station's own line when one person plays it, the team line
 *  (`stars`) in co-op, where the revenue is the whole team's. */
export function lvLine(id: string, st: string, coop: boolean): [number, number, number] {
  const L = lvGet(id), own = STAR_LINES[id];
  return !coop && own && ownKey(own, st) ? own[st] : L.stars;
}
/** The lines of the shift running now. */
export const curLine = (): [number, number, number] => { const S = liveG(); return lvLine(String(S.level), S.xseat ?? S.station, !!S.coop); };
/** The third star's skill measure of a one-person level shift, null in co-op (the team's revenue decides there). */
// every seat has one (the new seats too; before, their third star was the third line)
export const lvSpeed = (): SpeedGoal | null => { const S = liveG(), st = S.xseat ?? S.station; return !S.coop && isSpeedStation(st) ? speedGoal(st, true) : null; };
/** The stars of the level shift running now (the end card and the share card agree on them): one and two on the
 *  revenue lines; the third on the revenue line in co-op, on two stars plus the station's speed when one person plays. */
export const lvStarsNow = (): number => {
  const rev = shiftMeasure(liveG()), l = curLine(), sg = lvSpeed();
  if (!sg) return l.filter(s => rev >= s).length;
  const two = l.slice(0, 2).filter(s => rev >= s).length;
  return two === 2 && sg.ok ? 3 : two;
};
/** What the third star asks for, e.g. 「坐低到落單平均 4.2 秒內」. */
export const speedNeed = (sg: SpeedGoal): string => sg.kind === 'count' ? `出夠 ${sg.need} 碟` : `${SPEED_WHAT[sg.st]}平均 ${sg.need} 秒內`;
/** What the shift did on that measure, e.g. 「你平均 3.6 秒」. */
export const speedHave = (sg: SpeedGoal): string => sg.kind === 'count' ? `你出咗 ${sg.have ?? 0} 碟` : sg.have === null ? '你未做過' : `你平均 ${sg.have.toFixed(1)} 秒`;
export const LEVEL_IDS = Object.keys(LEVELS).filter(id => !lvGet(id).era && !lvGet(id).hell).sort((a, b) => lvGet(a).n - lvGet(b).n);
export const ERA_IDS = Object.keys(LEVELS).filter(id => lvGet(id).era), HELL_IDS = Object.keys(LEVELS).filter(id => lvGet(id).hell);
// 關卡分類：每類入面逐關解鎖（上一關一粒星），類同類之間唔鎖；修羅場要三類懷舊關各有一關三星
export const LV_CATS: LevelCat[] = [
  { k:'main',    name:'打工仔日常', sub:'由屋邨做到年廿八，茶記人嘅一年' },
  { k:'era',     name:'似水流年',   sub:'五六十年代冰室、街邊大牌檔' },
  { k:'old',     name:'老街舊舖',   sub:'舊區、城寨、已經執咗嘅老舖' },
  { k:'classic', name:'茶記傳奇',   sub:'排長龍嘅經典名店（原創名致敬）' },
  { k:'fest',    name:'節日限定',   sub:'特別日子先開，過咗要等明年' },
  { k:'hell',    name:'修羅場',     sub:'隱藏關卡：過到就 po 上網 show off' },
];
export const lvCat = (L: Level): string => L.fest ? 'fest' : L.hell ? 'hell' : !L.era ? 'main' : L.era==='舊區' ? 'old' : L.era==='經典茶記' ? 'classic' : 'era';
export const catIds = (k: string): string[] => Object.keys(LEVELS).filter(id => lvCat(lvGet(id))===k).sort((a, b) => lvGet(a).n - lvGet(b).n);
export const HELL_NEED = ['era', 'old', 'classic'];
export const hellReq = (): { k: string; ok: boolean }[] => HELL_NEED.map(k => ({ k, ok: catIds(k).some(id => ((must(SHOP.levels, 'SHOP.levels')[id] ?? 0)|0) >= 3) }));
export const hellOpen = (): boolean => hellReq().every(r => r.ok);
// 「第 3 關」或者「五十年代」
export const lvTag = (L: Level): string => L.era || L.festTag || (L.hell ? '修羅場' : `第 ${L.n} 關`);
SHOP.levels = SHOP.levels || {};
export const nextLevel = (id: string): string | undefined => { const c = catIds(lvCat(lvGet(id))); return c[c.indexOf(id) + 1]; };
// 每類第一關一開始就玩得；之後上一關攞到一粒星先開下一關
// 節日關：今日喺日子範圍入面先開（用部機本身嘅日期）
export const festOpen = (L: Level): boolean => { const d = new Date(), md = (d.getMonth() + 1) * 100 + d.getDate(), [m1, d1, m2, d2] = must(L.fest, 'fest dates'), a = m1 * 100 + d1, b = m2 * 100 + d2; return a <= b ? md >= a && md <= b : md >= a || md <= b; };
/** Opened by the player's own progress (or a festival's dates), ignoring the preview's all-open switch: the lobby's default pick. */
export const levelReached = (id: string): boolean => { const L = lvGet(id); if (L.hell) return hellOpen(); if (L.fest) return festOpen(L); if (typeof gateOk==='function' && !gateOk(CAT_GATE[lvCat(L)])) return false; const c = catIds(lvCat(L)), i = c.indexOf(id); return i===0 || ((must(SHOP.levels, 'SHOP.levels')[c[i - 1] ?? 'undefined'] ?? 0)|0) >= 1; };
/** On the preview (the 試玩 all-open switch) every level is open. */
export const levelOpen = (id: string): boolean => ptAllRolesOn() || levelReached(id);

/* ===================== 入關、出關 ===================== */
export let levelArmed: string | null = null, lvPrev: { diff: string; slot: Slot } | null = null;
// 關卡用固定難度（熟手嘅寫單減慢同貓紙），再乘關卡自己嘅客流同耐性
export function levelDiff(id: string): Difficulty {
  const L = lvGet(id);
  return { ...must(DIFFS.pro, 'difficulty pro'), name: L.name, pat: L.pat, gap: L.gap, ...(L.burn ? { burn: L.burn } : {}) };
}
// 換到關卡間舖（自己玩、做老闆、做隊友都用）
export function levelEnter(id: string): void {
  if (!lvPrev) lvPrev = { diff, slot };
  Object.defineProperty(DIFFS, 'lv', { value: levelDiff(id), enumerable:false, configurable:true, writable:true });
  setDiff('lv'); setSlot(lvGet(id).slot);
  useFixedShop(true, lvGet(id).lay);
}
export function levelLeave(): void {
  if (!lvPrev) return;
  setDiff(lvPrev.diff); setSlot(lvPrev.slot); lvPrev = null;
  useFixedShop(false);
}
export function armLevel(id: string): void { levelArmed = id; levelEnter(id); }
// careerStart 入面叫：記低呢更係邊關，唔出熟客同名人
export function levelBegin(): boolean {
  if (!levelArmed) return false;
  const L = lvGet(levelArmed);
  const S = liveG();
  S.level = levelArmed; levelArmed = null;
  S.regPlan = []; S.goal = 'level'; S.goalN = curLine()[0];
  if (L.kit && L.kit.n) for (const [st, n] of Object.entries(L.kit.n)) if (ownKey(S.kit, st)) S.kit[st] = new Array<KitJob | null>(n).fill(null);
  bossSay(`${lvTag(L)}：${L.name}（${L.where}）。${L.desc}`);
  return true;
}
// 唔放入隨機目標（enumerable:false）
Object.defineProperty(GOALS, 'level', { enumerable:false, value: { n: () => 0, txt: () => { const l = curLine(), sg = lvSpeed(), x = liveG().coop ? undefined : liveG().xseat, m = (v: number): string => measureTxt(x, v); return sg ? `${measureName(x)} ${m(l[0])} ★、${m(l[1])} ★★；★★★ 再要${speedNeed(sg)}` : `${measureName(x)} ${m(l[0])} ★、${m(l[1])} ★★、${m(l[2])} ★★★`; }, ok: () => shiftMeasure(liveG()) >= curLine()[0] } });
// 收工：按營業額計星（一個人玩用自己個位嘅星線），記最好成績
export function levelEnd(): number {
  const S = liveG(), L = lvGet(S.level), id = String(S.level), rev = shiftMeasure(S), line = curLine(), sg = lvSpeed(), mx = S.coop ? undefined : S.xseat;
  const lineTxt = sg ? `${line.slice(0, 2).map((s, i) => `${'★'.repeat(i + 1)} ${measureTxt(mx, s)}`).join(' · ')} · ★★★ 再要${speedNeed(sg)}，${speedHave(sg)} ${sg.ok ? '✓' : '✗'}` : line.map((s, i) => `${'★'.repeat(i + 1)} ${measureTxt(mx, s)}`).join(' · ');
  const stars = lvStarsNow(), best = (must(SHOP.levels, 'SHOP.levels')[id] ?? 0)|0;
  const gain = Math.max(0, stars - best);
  if (stars > best) must(SHOP.levels, 'SHOP.levels')[id] = stars;
  // 記低每個位喺呢關最好幾多星（嗰關每個位都三星 → 加盟分店；levelSeats）
  if (!S.coop || NET.role!=='client'){ const lvst = must(SHOP.lvst, 'SHOP.lvst'), r = (lvst[id] = lvst[id] || {}), had = lvAll3(id), ps = S.xseat ?? S.station; r[ps] = Math.max((r[ps] ?? 0)|0, stars);
    if (!had && lvAll3(id) && !L.hell) setTimeout(() => { toast(`每個位都三星！「${L.name}」交俾你做加盟分店`); sfx.fanfare(); }, 2200); }
  if (typeof dexCheck==='function') dexCheck(id);
  if (typeof track==='function'){ trackOnce('lv_done'); if (stars >= 1) track('lvp_' + id); if (stars===3) track('lv3_' + id); }
  const d3 = stars===3 && (SHOP.lv3day = SHOP.lv3day || {})[id]!==todayStr();
  if (d3) must(SHOP.lv3day, 'SHOP.lv3day')[id] = todayStr();
  SHOP.stars = (SHOP.stars ?? NaN) + gain; SHOP.bank += gain * STAR_PRIZE + (d3 ? DAILY3 : 0); saveShop();
  const nextId = nextLevel(id), unlocked = nextId && best < 1 && stars >= 1;
  must($('endSign'), 'endSign').textContent = stars ? ['', '過關', '好嘢', '完美'][stars] ?? null : '唔夠數';
  must($('result'), 'result').insertAdjacentHTML('afterbegin', `<div class="wide stars"><span>${lvTag(L)} · ${L.name}${S.coop ? ' · 組隊' : ''}</span>
    <b aria-label="${stars} 粒星">${'★'.repeat(stars)}<i>${'★'.repeat(3 - stars)}</i></b>
    <span>${measureName(mx)} ${measureTxt(mx, rev)}（${S.coop ? '' : (S.xseat ? SEAT_NAMES[S.xseat] : stDef(S.station).name) + '：'}${lineTxt}）${gain ? ` · 新紀錄！多 ${gain}★、獎 $${gain * STAR_PRIZE}` : best ? ` · 最好 ${'★'.repeat(best)}` : ''}${d3 ? ` · 今日三星獎 $${DAILY3}` : ''}${unlocked ? ` · 解鎖「${lvGet(nextId).name}」` : ''}</span></div>`);
  if (unlocked) toast(`解鎖新關卡：${lvGet(nextId).name}`);
  if (stars===3 && best < 3 && !L.hell && hellOpen() && !SHOP.hellToast){ SHOP.hellToast = true; saveShop(); setTimeout(() => { toast('隱藏關卡「修羅場」解鎖咗！'); }, 1500); }
  return stars;
}

/* ===================== 揀關畫面 ===================== */
export let lvTab: string | undefined = 'main';
export function setLvTab(v: typeof lvTab): void { lvTab = v; }
document.addEventListener('click', e => {
  const t = closestIn(e.target, '[data-lvt]'); if (!t) return;
  const w = must(closestIn(t, '.lvwrap'), '.lvwrap'); lvTab = t.dataset.lvt; w.outerHTML = levelList(w.dataset.pick || undefined);
});
export function levelList(pick?: string): string {
  const li = (id: string): string => {
    const L = lvGet(id), open = levelOpen(id), best = (must(SHOP.levels, 'SHOP.levels')[id] ?? 0)|0;
    // a new seat is listed once the ladder reached it; solo with a new seat picked that this level has no
    // station for, the level says which station the player works instead
    const px = NET.role ? '' : pickedX(), noX = px && !levelRoles(L).includes(px) ? `<i class="lk">呢關冇${SEAT_NAMES[px]}：你做${stDef(station).name}</i><br>` : '';
    return `<li class="${open ? '' : 'locked'}${pick===id ? ' on' : ''}${L.era ? ' era' : ''}"><button type="button" data-lv="${id}" ${open ? '' : 'disabled'}>
      <small>${lvTag(L)} · ${(L.clock && L.clock.label) || SLOTS[L.slot].name} · 人工 ×${levelMult(id)}${id===pickLevel() ? ' · <i class="pick">今日推介</i>' : ''}${(SHOP.lv3day || {})[id]===todayStr() ? ' · 今日三星 ✓' : ''}</small><b>${L.name}</b>${open && !L.hell ? `<i class="lvst">${levelSeats(L).filter(s => !isExtraKind(s) || roleOpenNow(s)).map(s => `${seatName(s)}${((must(SHOP.lvst, 'SHOP.lvst')[id]?.[s] ?? 0)|0) >= 3 ? '✓' : '·'}`).join(' ')}${lvAll3(id) ? ' · 加盟分店' : ''}</i>` : ''}
      <span>${open ? noX + L.desc : L.hell ? '？？？' : L.fest ? `${L.where}<br><i class="lk">🔒 ${L.fest[0]} 月 ${L.fest[1]} 日至 ${L.fest[2]} 月 ${L.fest[3]} 日先開</i>` : `${L.where}<br><i class="lk">🔒 上一關攞一粒星解鎖</i>`}</span><em>${'★'.repeat(best)}<i>${'★'.repeat(3 - best)}</i></em></button></li>`;
  };
  const catName = (k: string): string => must(LV_CATS.find(c => c.k===k), 'category ' + k).name;
  if (pick && LEVELS[pick]) lvTab = lvCat(lvGet(pick));
  const c = must(LV_CATS.find(x => x.k===lvTab) || LV_CATS[0], 'level category'), ids = catIds(c.k);
  // 五個分頁：每類一頁，標住攞咗幾多星；修羅場未開就係鎖
  const tabs = `<div class="lvtabs" role="tablist">${LV_CATS.map(x => { const n = catIds(x.k), g = n.reduce((a, id) => a + ((must(SHOP.levels, 'SHOP.levels')[id] ?? 0)|0), 0);
    return `<button type="button" role="tab" data-lvt="${x.k}" aria-selected="${String(x.k===c.k)}">${x.name}<span>${(x.k==='hell' && !hellOpen() && !ptAllRolesOn()) || (typeof catOpen==='function' && !catOpen(x.k)) ? '🔒' : `${g}/${n.length * 3}★`}</span></button>`; }).join('')}</div>`;
  const head = `<p class="lv-sub">${c.sub}</p>`;
  const body = typeof catOpen==='function' && !catOpen(c.k) ? `<p class="lv-lock">「${c.name}」${gateNeed(CAT_GATE[c.k])}。<br>先玩「打工仔日常」或者自己間舖儲星升職。</p>` : c.k==='hell' && !hellOpen() && !ptAllRolesOn() ? `<p class="lv-lock">要喺「${HELL_NEED.map(catName).join('」「')}」每類各攞一關三星先開：<br>${hellReq().map(r => `${catName(r.k)} ${r.ok ? '✓' : '✗'}`).join(' · ')}</p>`
    : `<ul class="levels">${ids.map(li).join('')}</ul>`;
  return `<div class="lvwrap" data-pick="${pick || ''}">${tabs}${head}${body}</div>`;
}
export function openLevels(): void {
  must($('book'), 'book').innerHTML = `<div class="sh-head"><b>關卡</b><span>固定間舖同餐牌，按營業額攞星</span></div>
    <p class="diffh">你做邊個位？其他位電腦補（新位要先培訓）</p><div class="diff compact four" id="lvSt" role="group" aria-label="崗位"></div>
    ${levelList()}<button type="button" class="big" id="bookClose">返回</button>`;
  seg('lvSt', seatOptions(ST_LIST()), pickerCur(station), 'st', ST_ICO);
  must($('bookView'), 'bookView').hidden = false;
}
must($('book'), 'book').addEventListener('click', e => {
  const s = closestIn(e.target, '#lvSt button[data-st]');
  if (s){ const v = s.dataset.st; if (isExtraKind(v)) pickX(v); else { setStation(stationOf(v)); pickX(''); } saveSet('ckf-station', station); buildMenus(); seg('lvSt', seatOptions(ST_LIST()), pickerCur(station), 'st', ST_ICO); return; }
  const b = closestIn(e.target, 'button[data-lv]'); if (!b || NET.role) return;
  must($('bookView'), 'bookView').hidden = true; armLevel(must(b.dataset.lv, 'data-lv')); start();
});
must($('levelBtn'), 'levelBtn').onclick = openLevels;
