// The menus and the fixed numbers of the shop: from the original game's rules.ts, bar.ts,
// kitchen.ts, till.ts, career.ts, market.ts and juice.ts, moved as they were.

/* ===================== 規則同數值 ===================== */
export const CFG = {
  gameSec: 180,                 // 真實秒數，對應 12:00 至 2:00
  queuePat: 45, orderPat: 50,   // 門口同等落單嘅耐性（秒）
  laterGrace: 10,   // 落單紙「收埋」之後，客人仲肯等幾多秒先再開始冇耐性
  // cook：電腦廚房第一碟幾多秒出（之後每碟遲 1.5 秒）；由 5 改 8，即係大約 9 秒一碟，同一個熟手差唔多
  think: [1.5, 3] satisfies [number, number], cook: 8, eat: [9, 13] satisfies [number, number],
  queueMax: 6, tipPer: 5,
  // 旺場: once per shift, `sec` long,
  // whole inside [from, to] of the shift, its start drawn from the shift's stream (core/referee/fever.ts). Heat follows
  // `curve` ([second, heat] points, straight lines between): slow and casual, a climax, a short wind-down. At heat 1
  // customers come at `gap` times the usual gap and tips are `tip` times; in between, in proportion.
  fever: { sec: 40, from: .25, to: .75, curve: [[0, 0], [5, .25], [10, 1], [32, 1], [40, 0]] satisfies [number, number][], gap: .6, tip: 2 },
  // 手忙腳亂自動疏客（G.ease）最多疏到 easeMax 倍，之後每秒退返 easeBack 埋 1（大約 20 秒）
  easeMax: 1.2, easeBack: .01,
  coldExtra: 3, hongExtra: 2, dingExtra: 5,   // 凍飲、烘底、轉公仔麵要加錢
  cashPat: 40, tillGap: 1.4,    // 收銀：排隊耐性、客人嚟得疏啲
  aiErr: .12, aiPace: 1, aiBarErr: .05,
  plates: 2,   // 廚房同時可以整幾多隻碟（將來升級可以加）
  barGap: 1.25, drinkPat: 45, redoPat: 20, potCap: 16, boilSec: 4, steepSec: 3, pulls: 4,   // 水吧：等飲品嘅耐性、茶壺
  barOpenSec: 20,   // 開舖前冇人煲過茶膽：咁多秒之後師傅幫手煲咗頭一壺，照開門
  kitGap: 1.45, foodPat: 70, stirs: 5, aiKitErr: .04, holdN: 6,   // 廚房
};
export const FOODS: MenuItem[] = [
  { id:'常餐', p:52 }, { id:'餐蛋麵', p:42 }, { id:'沙嗲牛麵', p:46 }, { id:'火腿通粉', p:40 },
  { id:'乾炒牛河', p:66 }, { id:'焗豬扒飯', p:72 }, { id:'菠蘿油', p:30 }, { id:'西多士', p:34 },
  // 冰室（五十年代關卡）先有：冇明火都整到
  { id:'蛋撻', p:20 }, { id:'牛油多士', p:22 }, { id:'火腿三文治', p:28 },
  // 大牌檔
  { id:'油占多', p:20 }, { id:'奶油多', p:18 },
  // 城寨冰室
  { id:'城寨叉燒飯', p:42 },
  // 經典茶記致敬關
  { id:'豬扒包', p:32 }, { id:'蔥油雞扒撈丁', p:44 }, { id:'炒蛋多士', p:30 }, { id:'燉奶', p:26 },
  // 萬聖限定
  { id:'吸血鬼多士', p:24 },
];
// iced = 一定係凍（紅豆冰）
// hot = 一定係熱（而家冇飲品用）；sw = 本身已經甜（煉奶沖），唔落糖水、冇少甜走甜
export const DRINKS: DrinkDef[] = [ { id:'奶茶', p:18 }, { id:'檸茶', p:18 }, { id:'鴛鴦', p:18 }, { id:'檸水', p:16 }, { id:'紅豆冰', p:26, iced:true }, { id:'阿華田', p:20 },
  { id:'咖啡', p:18 }, { id:'齋啡', p:16 }, { id:'茶走', p:18, sw:true }, { id:'啡走', p:18, sw:true } ];
export const isIced = (id: string): boolean => !!DRINKS.find(d => d.id===id)?.iced;
export const isHot = (id: string): boolean => !!DRINKS.find(d => d.id===id)?.hot, isSw = (id: string): boolean => !!DRINKS.find(d => d.id===id)?.sw;
export const COLORS = ['#cf861a','#3d7fbf','#8a5cc2','#2a8b67','#b4562e','#3c9aa3','#7d8a22','#c0507a'];
// 早餐：揀餐，再揀粉麵、蛋、包。客人冇講就跟 DEF
export const SETS: SetDef[] = [ { id:'A餐', top:'火腿', p:38 }, { id:'B餐', top:'餐肉', p:38 }, { id:'C餐', top:'沙嗲牛肉', p:42 }, { id:'常餐', top:'叉燒', p:46 } ];
export const NOODLES = ['通粉','意粉','米粉','公仔麵'];
export const EGGS = ['煎蛋','炒蛋','太陽蛋'];
export const BREADS = ['牛油多士','奶油多士','餐包'];
export const DEF = { noodle:'通粉', egg:'煎蛋', bread:'牛油多士', hongdai:false, feibin:false };
export const SLOTS: Record<Slot, SlotDef> = {
  breakfast: { name:'早市', desc:'常餐 A B C，要揀粉麵、蛋同包', start:7*60+30, endTxt:'九點半 · 早市完' },
  lunch:     { name:'午市', desc:'粉麵同常見菜式，客多又要搭枱',   start:12*60,     endTxt:'二點正 · 午市完' },
  dinner:    { name:'晚市', desc:'碟頭飯，走青、加底、炒底',       start:18*60+30,  endTxt:'八點半 · 晚市完', gap:1.3 },
};
// 晚市碟頭飯：sauce = 有汁，先炒得底
export const DISHES: DishDef[] = [
  { id:'粟米肉粒飯', p:46, sauce:true }, { id:'番茄牛肉飯', p:50, sauce:true }, { id:'豉椒排骨飯', p:52, sauce:true }, { id:'咖喱牛腩飯', p:56, sauce:false },
  { id:'揚州炒飯', p:54, sauce:false }, { id:'鹹魚雞粒炒飯', p:58, sauce:false }, { id:'焗豬扒飯', p:62, sauce:false }, { id:'白汁雞皇飯', p:56, sauce:true },
];
export const DFLAGS: DishFlag[] = ['炒底','加底','走青'];
export const GADAI = 6;
export const REG: Record<string, Regular> = {
  chan:   { label:'陳生', persons:{
    lunch:     [{ food:'餐蛋麵', drink:{ d:'檸茶', cold:true, sweet:2, noice:false } }],
    breakfast: [{ set:{ id:'常餐', noodle:'意粉', egg:'炒蛋', bread:'牛油多士', hongdai:false, feibin:false }, drink:{ d:'檸茶', cold:true, sweet:2, noice:false } }],
    dinner:    [{ dish:{ id:'豉椒排骨飯', 炒底:true, 加底:false, 走青:false }, drink:{ d:'檸茶', cold:true, sweet:2, noice:false } }] } },
  cheung: { label:'張太', persons:{
    lunch:     [{ food:'西多士', drink:{ d:'奶茶', cold:false, sweet:0, noice:false } }],
    breakfast: [{ set:{ id:'B餐', noodle:'公仔麵', egg:'太陽蛋', bread:'奶油多士', hongdai:false, feibin:true }, drink:{ d:'奶茶', cold:false, sweet:0, noice:false } }],
    dinner:    [{ dish:{ id:'番茄牛肉飯', 炒底:false, 加底:false, 走青:true }, drink:{ d:'奶茶', cold:false, sweet:0, noice:false } }] } },
};
export const SWEET = ['','少甜','走甜'];
// 難度：slow = 寫單時成間舖嘅速度（0 停晒，1 照行），pat = 客人耐性倍數，gap = 客人嚟嘅間隔倍數
// 水吧、廚房、收銀另外再寬鬆啲：sgap = 客人再疏啲，spat = 等飲等食等埋單再耐啲，burn = 煲同煎遲幾倍先燶，seat = 座位多最多快幾多
// levels.js adds a hidden 'lv' entry while a level is armed, so the keys are not a fixed set.
// 唔考記性，每個難度都有價錢、標籤同貓紙；難唔難淨係睇時間、耐性、客嚟得幾密、幾快燶
// 睇單減慢淨係新人有（四分一速）；熟手起時間照行，喺壓力下睇單就係伙記嘅挑戰
// Gap set from the sims' human player model (tests/sim/human.js): a mid player serves about 87% on 熟手, a first-timer
// is comfortable on 新人, 阿姐 is harder. Was rookie 1.25, pro 1, ace .85 (set with bots that never read or think).
export const DIFFS: Record<string, Difficulty> = {
  rookie: { name:'新人', desc:'睇單時成間舖慢到四分一，客人好有耐性', slow:.25, pat:1.4, gap:2.5, sgap:1.4, spat:1.5, burn:2.5, seat:.9 },
  pro:    { name:'熟手', desc:'時間照行，客人冇咁好耐性', slow:1,   pat:1,   gap:2.2, sgap:1.1, spat:1.15, burn:1.4, seat:.8 },
  ace:    { name:'阿姐', desc:'時間照行，客人又急又多，爐頭易燶', slow:1,   pat:.8,  gap:1.7, sgap:1, spat:1, burn:1, seat:.7 },
};
export const STATIONS: Record<StationId, StationDef> = { waiter:{ name:'伙記', desc:'帶位、落單、執枱' }, kitchen:{ name:'廚房', desc:'煲麵、煎蛋、炒鑊' }, bar:{ name:'水吧', desc:'煲茶膽、沖飲品' }, till:{ name:'收銀', desc:'計數、找錢' } };
// 加頂帽 = 加隻煎蛋（城寨叉燒飯先有），另加 $5
export const HAT_TXT = ' 加頂帽', HAT_P = 5, HAT_OK = ['城寨叉燒飯'];
// 萬聖節關：啲客全部化咗裝
export const COSTUME: Record<number, string[]> = { 1:['扮殭屍嘅','扮貞子嘅','扮吸血鬼嘅','扮南瓜嘅','扮骷髏嘅'], 2:['兩隻殭屍','一對吸血鬼','兩個貞子'], 3:['三個扮鬼學生','三隻喪屍'], 4:['一家四口扮殭屍','四個扮鬼同事'] };
/* ===================== 水吧位 ===================== */
// 每杯嘢飲要乜：熱飲用熱杯唔落糖；凍飲用凍杯，落冰（走冰唔落），糖水兩下（少甜一下、走甜唔落）
export const ING = ['淡奶','茶','咖啡','水','檸檬','冰','糖水','紅豆','阿華田','煉奶'];
export const RECIPE: Record<string, Record<string, number>> = { 奶茶:{ 淡奶:1, 茶:1 }, 鴛鴦:{ 淡奶:1, 茶:1, 咖啡:1 }, 檸茶:{ 茶:1, 檸檬:1 }, 檸水:{ 水:1, 檸檬:1 }, 紅豆冰:{ 紅豆:1, 淡奶:1 }, 阿華田:{ 阿華田:1, 淡奶:1, 水:1 },
  咖啡:{ 淡奶:1, 咖啡:1 }, 齋啡:{ 咖啡:1, 水:1 }, 茶走:{ 煉奶:1, 茶:1 }, 啡走:{ 煉奶:1, 咖啡:1 } };
// 紅豆、阿華田、煉奶淨係有得賣先擺出嚟
export const ING_X = ['紅豆','阿華田','煉奶'];
/* ===================== 廚房位 ===================== */
// 每碟嘢要乜：計時嘅（煲、煎、多士爐、焗爐、鑊）同即刻放嘅（配料、牛油、飯、蔥）
export const SET_TOP: Record<string, string> = { A餐:'火腿', B餐:'餐肉', C餐:'沙嗲牛', 常餐:'叉燒' };
export const LUNCH_R: Record<string, string[]> = { 常餐:['通粉','煎蛋','多士','牛油','叉燒'], 餐蛋麵:['公仔麵','煎蛋','餐肉'], 沙嗲牛麵:['公仔麵','沙嗲牛'], 火腿通粉:['通粉','火腿'],
                  乾炒牛河:['乾炒牛河'], 焗豬扒飯:['焗豬扒飯'], 菠蘿油:['菠蘿包','牛油'], 西多士:['西多士','牛油'],
                  蛋撻:['蛋撻'], 牛油多士:['多士','牛油'], 火腿三文治:['方包','火腿'],
                  油占多:['多士','牛油','果占'], 奶油多:['多士','奶油'],
                  城寨叉燒飯:['飯','叉燒'],
                  豬扒包:['豬扒','餐包烘底'], 蔥油雞扒撈丁:['公仔麵','雞扒','蔥'], 炒蛋多士:['炒蛋','多士'], 燉奶:['燉奶'], 吸血鬼多士:['多士','果占'] };
   // 加頂帽再加煎蛋
export const FRIED_RICE = ['揚州炒飯','鹹魚雞粒炒飯'];
export const WOK_DISHES = ['粟米肉粒飯','番茄牛肉飯','豉椒排骨飯','白汁雞皇飯','揚州炒飯','鹹魚雞粒炒飯','乾炒牛河'];
export const KIT: Record<KitSt, KitDef> = {
  pot:     { name:'煲',     n:2, time:{ 通粉:7, 意粉:6, 米粉:4, 公仔麵:3, 咖喱牛腩:5 }, burn:null },   // 煲熟自動撈起，唔會燶
  pan:     { name:'煎',     n:2, time:{ 煎蛋:4, 炒蛋:3, 太陽蛋:3, 西多士:5, 豬扒:5, 雞扒:5 }, burn:4 },
  toaster: { name:'多士爐', n:1, time:{ 多士:3, 餐包:3 }, burn:null },
  oven:    { name:'焗爐',   n:1, time:{ 焗豬扒飯:8, 蛋撻:5 }, burn:6 },
  wok:     { name:'鑊',     n:1, time:Object.fromEntries(WOK_DISHES.map(d => [d, 0])), burn:null },
};
export const SLOT_KIT: Record<Slot, LevelKit> = {
  breakfast: { st:{ pot:['通粉','意粉','米粉','公仔麵'], pan:['煎蛋','炒蛋','太陽蛋'], toaster:['多士','餐包'] }, inst:['火腿','餐肉','沙嗲牛','叉燒','餐包','牛油','奶油','飛邊'] },
  lunch:     { st:{ pot:['通粉','公仔麵'], pan:['煎蛋','西多士'], toaster:['多士'], oven:['焗豬扒飯'], wok:['乾炒牛河'] }, inst:['火腿','餐肉','沙嗲牛','叉燒','牛油','菠蘿包'] },
  dinner:    { st:{ wok:['粟米肉粒飯','番茄牛肉飯','豉椒排骨飯','白汁雞皇飯','揚州炒飯','鹹魚雞粒炒飯'], pot:['咖喱牛腩'], oven:['焗豬扒飯'] }, inst:['飯','蔥'] },
};
// 唔會燶嘅（煮麵、多士）用一個極大嘅有限數；唔好用 Infinity —— JSON 會變 null，組隊朋友部機會當成「已經燶」
export const NO_BURN = 1e9;
/* ===================== 收銀位：操作同畫面 ===================== */
export const NOTES = [100, 50, 20, 10, 5, 2, 1];
/* ===================== 名人（戴黑超嚟，埋單先知係邊個） ===================== */
export const CELEBS: Record<string, Celeb> = {
  tvstar: { name:'電視台當紅小生', line:'唔好影相呀唔該……好啦，一張。' },
  diva:   { name:'樂壇天后', line:'熱檸水，我聽晚開騷要護喉。' },
  horse:  { name:'賽馬評述員', line:'呢碟飯，一馬當先，大熱勝出！' },
  foodie: { name:'飲食節目主持', line:'呢杯奶茶夠滑，下集介紹你哋！' },
  kungfu: { name:'功夫片武師', line:'食飽先有力拍打戲！' },
  chef:   { name:'星級大廚', line:'你哋個西多士，我都整唔到咁好。' },
};
export const CELEB_TIP = 50;
export const UP_TIP: Record<number, number> = { 1:0, 2:3, 3:8 };
export const SIG_SAY = [(n: string | undefined) => `「${String(n)}」名不虛傳！`, (n: string | undefined) => `${String(n)}，好食到喊呀！`, (n: string | undefined) => `朋友介紹嚟食${String(n)}，冇介紹錯！`, (n: string | undefined) => `下次仲要嚟食${String(n)}！`];
export const SIG_ASK = [(n: string | undefined) => `聽講你哋個${String(n)}好出名，試吓先。`, (n: string | undefined) => `我專登過海嚟食${String(n)}㗎！`, (n: string | undefined) => `網上個個都話你哋${String(n)}正。`];
