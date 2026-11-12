// 茶餐廳圖鑑：每關一張卡，介紹嗰關致敬嘅原型（只講類型同年代，唔寫真實店名、地址、招牌字）
// 未玩過：黑影；玩過一次：開卡（類型、年代）；三星：完整介紹；每個位都三星（加盟分店）：金卡
// TypeScript port of the original game's dex.js, as an ES module: every
// top-level name is exported, none renamed.
import './levels';   // load order: src/entry.ts





import { must } from '../core/util';
import { $ } from './prefs';
import { toast } from './ui';
import { iconImg } from './icons';
import { SHOP, saveShop } from './decor';
import { lvAll3 } from './market';
import { LEVELS, lvGet, levelOpen, LV_CATS, lvCat, closestIn } from './levels';


export const DEX: Record<string, DexEntry> = {
  estate:    { type:'屋邨茶記', age:'公屋落成至今', sig:'f:餐蛋麵',
    look:['綠色牆身、紙皮石地', '四張卡位加兩張細枱', '街坊客人有耐性'],
    fact:'茶餐廳一坐低就有杯免費清茶，好多街坊攞嚟洗餐具，所以叫「茶」餐廳。' },
  central:   { type:'寫字樓樓下茶餐廳', age:'今日', sig:'s:A餐',
    look:['米色牆、格仔地磚', '多幾張細枱，翻枱要快', '個個客趕返工打卡'],
    fact:'常餐、快餐、特餐係成日有嘅套餐，跟飲品；凍飲同烘底通常要加兩三蚊。烘底係將軟餐包烘脆，多士本身已經烘過，唔叫烘底。' },
  mongkok:   { type:'街舖茶餐廳晚市', age:'今日', sig:'d:豉椒排骨飯',
    look:['大啲嘅舖，六張卡位', '赤陶色地磚', '碟頭飯、炒底、走青'],
    fact:'加底即係飯麵加量；炒底即係飯同餸一齊炒；走青即係唔要蔥。' },
  airport:   { type:'機場茶記', age:'今日', sig:'k:奶茶',
    look:['藍色牆、格仔地', '客人拖住喼趕上機', '餐牌長啲、叫得貴'],
    fact:'2017 年「港式奶茶製作技藝」入咗香港首份非物質文化遺產代表作名錄。' },
  typhoon:   { type:'打風前嘅街坊茶記', age:'今日', sig:'f:沙嗲牛麵',
    look:['全街人湧入嚟醫肚', '卡位細枱坐滿晒', '出餐要快'],
    fact:'一枱客平均坐十至二十分鐘，嘢食大約五分鐘就到，伙記要眼明手快。' },
  newyear:   { type:'大型茶餐廳', age:'年廿八', sig:'d:揚州炒飯',
    look:['得八張枱翻枱要快', '全餐牌', '人山人海要搭枱'],
    fact:'搭枱係茶記文化：繁忙時間同陌生人坐埋一張枱，慳位又翻枱快。' },
  bingsutt:  { type:'冰室', age:'五十年代', sig:'k:紅豆冰',
    look:['吊扇、細細塊地磚、摺椅', '只有多士爐、焗爐同凍櫃', '街坊飲冰傾偈'],
    fact:'冰室拎細牌，唔准明火煮嘢，所以早期只有多士、蛋撻、三文治呢類輕食。' },
  sixties:   { type:'新牌照茶餐廳', age:'六十年代', sig:'f:焗豬扒飯',
    look:['冰室換新牌，終於開到爐', '火腿通粉、西多士登場', '紅豆冰、蛋撻照賣'],
    fact:'「豉油西餐」用本地材料（好多係罐頭）改良西餐，整出火腿通粉、焗豬扒飯、港式西多士。' },
  daipaidong:{ type:'大牌檔奶茶檔', age:'街邊檔年代', sig:'f:油占多',
    look:['綠色鐵皮檔', '摺枱紅膠櫈', '好多人淨係嚟飲杯奶茶'],
    fact:'大牌檔個「大」係指塊牌照大過其他小販牌，唔係間舖大。' },
  village:   { type:'村落冰室', age:'清拆前最後一日', sig:'f:西多士',
    look:['窄長舖，兩邊木卡位', '門口趟閘、批盪牆、水泥地', '慕名而來嘅人排長龍'],
    fact:'茶果嶺村有三百幾年歷史，2026 年清拆，村裏面開咗幾十年嘅冰室亦跟住結業。' },
  silver:    { type:'屋邨冰室', age:'開咗半世紀', sig:'k:奶茶',
    look:['黃色牆、灰藍紙皮石牆腳', '一邊淺木卡位、一邊白色圓枱', '街坊落樓飲杯奶茶'],
    fact:'絲襪奶茶個「絲襪」係隔茶嘅白布袋，用耐咗染到茶色，好似絲襪。' },
  kwc:       { type:'城寨冰室', age:'八十年代', sig:'f:城寨叉燒飯',
    look:['低樓底，頭頂電線水喉', '魚缸、圓摺枱、紅膠櫈', '細細間逼到爆'],
    fact:'九龍城寨九十年代初清拆，原址變咗公園。「加頂帽」即係加隻煎蛋。' },
  milktea:   { type:'布袋奶茶老檔', age:'由街邊鐵皮檔起家', sig:'f:豬扒包',
    look:['紅色舖面俾門口綠色鐵皮檔遮住', '白瓷片、紅階磚、木圓枱圓凳', '奶茶檔直接對街賣外賣'],
    fact:'撞茶唔係玩：拎高水煲倒返落布袋，至少三次，啲茶先夠滑。' },
  fastmilk:  { type:'奶公司', age:'經典老舖', sig:'f:燉奶',
    look:['白瓷片、綠色水磨石地', '一張張四人圓枱，幾乎冇卡位', '門口長期排長龍'],
    fact:'奶公司以燉奶同炒蛋多士出名，出名快：一坐低就要叫，食完就走。' },
  hangwan:   { type:'冰廳餅店', age:'經典老舖', sig:'f:蛋撻',
    look:['門口餅櫃擺滿菠蘿包蛋撻', '橙色卡位、淺藍枱', '樓梯上閣樓仲有位'],
    fact:'菠蘿包入面冇菠蘿，係個面甜脆皮似菠蘿；港式蛋撻受英式奶黃撻影響，同葡撻唔同。' },
  halloween: { type:'離島海邊宵夜檔', age:'萬聖節晚黑', sig:'k:齋啡',
    look:['海邊細檔，紅膠櫈', '客人全部化咗裝', '燈光暗暗，聽到浪聲'],
    fact:'離島晚黑靠船，尾班船一開，島上就靜晒，宵夜檔變咗最後一盞燈。等船嘅人最鍾意叫杯齋啡提神。' },
  hell:      { type:'每個茶記人嘅惡夢', age:'任何一日', sig:'f:常餐',
    look:['八張枱翻到飛起', '全午市餐牌', '煎爐燶得特別快'],
    fact:'伙記傳統：左手落單、右手上菜，快就係王道。' },
};
export const dexState = (): Record<string, number> => SHOP.dex || (SHOP.dex = {});
// 0 未玩、1 開卡、2 三星完整、3 金卡
export function dexTier(id: string): number {
  if (!LEVELS[id]) return 0;
  if (typeof lvAll3==='function' && lvAll3(id) && !lvGet(id).hell) return 3;
  if (((must(SHOP.levels, 'SHOP.levels')[id] ?? 0)|0) >= 3) return 2;
  return ((must(SHOP.levels, 'SHOP.levels')[id] ?? 0)|0) > 0 || SHOP.lvst?.[id] ? 1 : 0;
}
export const DEX_IDS = (): string[] => Object.keys(DEX).filter(id => LEVELS[id]);
export const dexCount = (): { n: number; gold: number; full: number; all: number } => { const ids = DEX_IDS(); return { n: ids.filter(id => dexTier(id) > 0).length, gold: ids.filter(id => dexTier(id)===3).length, full: ids.filter(id => dexTier(id) >= 2).length, all: ids.length }; };
// 收工後叫：卡有冇升級，有就彈一句、個掣變黃
export function dexCheck(id: string): void {
  if (!DEX[id]) return;
  const S = dexState(), was = (S[id] ?? 0)|0, now = dexTier(id);
  if (now <= was) return;
  S[id] = now; SHOP.dexNew = true; saveShop();
  const msg = ['', '開咗新卡', '解鎖完整介紹', '升咗金卡'][now];
  setTimeout(() => { toast(`茶餐廳圖鑑：「${lvGet(id).name}」${String(msg)}`); }, 3600);
}
export function dexBtn(): void {
  const b = $('dexBtn'); if (!b) return;
  const c = dexCount(); b.innerHTML = `茶餐廳圖鑑 <span>${c.n}/${c.all}</span>`; b.classList.toggle('new', !!SHOP.dexNew);
}
export function dexCard(id: string): string {
  const L = lvGet(id), D = must(DEX[id], 'dex card ' + id), t = dexTier(id), open = typeof levelOpen==='function' && levelOpen(id);
  if (!t){
    const hint = L.hell ? '隱藏：三類懷舊關各攞一關三星先開' : L.fest && !open ? '節日限定：特別日子先開' : open ? L.fest ? `限定期間玩一次「${L.name}」開卡，錯過要等明年` : `玩一次「${L.name}」開卡` : '解鎖咗關卡先玩到';
    return `<li class="dex lock"><span class="dpic">${iconImg('menu', D.sig + '#1')}</span><div><b>${open || L.fest ? L.name : '？？？'}</b><small>${hint}</small></div></li>`;
  }
  const gold = t===3, full = t >= 2;
  return `<li class="dex${gold ? ' gold' : ''}${full ? '' : ' part'}"><span class="dpic">${iconImg('menu', D.sig + '#' + String(full ? 3 : 1))}</span><div>
    <b>${L.name}${gold ? '<i class="dstamp">加盟分店</i>' : ''}</b><small>原型：${D.type} · ${D.age}</small>
    ${full ? `<ul class="dlook">${D.look.map(x => `<li>${x}</li>`).join('')}</ul><p class="dfact"><em>小知識</em>${D.fact}</p>`
      : `<small class="dmore">攞三星睇完整介紹（設計參考、招牌、小知識）</small>`}
  </div></li>`;
}
export function openDex(): void {
  SHOP.dexNew = false; saveShop(); dexBtn();
  const c = dexCount();
  const groups = LV_CATS.map(cat => { const ids = DEX_IDS().filter(id => lvCat(lvGet(id))===cat.k).sort((a, b) => lvGet(a).n - lvGet(b).n);
    return ids.length ? `<h3>${cat.name}</h3><ul class="dexlist">${ids.map(dexCard).join('')}</ul>` : ''; }).join('');
  must($('book'), 'book').innerHTML = `<div class="sh-head"><b>茶餐廳圖鑑</b><span>收集 ${c.n}/${c.all} · 完整 ${c.full} · 金卡 ${c.gold}</span></div>
    <p class="hint">每關致敬一種茶記原型。玩一次開卡，三星睇完整介紹，每個位都三星變金卡。只講類型同年代，唔代表任何真實店舖。</p>
    ${groups}<button type="button" class="big" id="bookClose">返回</button>`;
  must($('bookView'), 'bookView').hidden = false; must($('bookClose'), 'bookClose').focus();
}
document.addEventListener('click', e => { if (closestIn(e.target, '#dexBtn')) openDex(); });
// 舊玩家第一次載入：照而家進度開卡，唔彈一大堆通知；有卡就亮個掣話佢知有新嘢
if (!SHOP.dex){ SHOP.dex = {}; DEX_IDS().forEach(id => { must(SHOP.dex, 'SHOP.dex')[id] = dexTier(id); }); SHOP.dexNew = true; }
