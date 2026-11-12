// 試味模式（?taste）：好似試一間餐廳嘅試味菜單，每樣嘢食一啖，順住次序試晒全部玩法、畫面、升級同解鎖
// 遊戲速度正常；跳過嘅只係「儲」嘅時間：每道菜先換一份預設存檔，再直接開去嗰個玩法
// 完全獨立：存檔、登入、統計都唔郁真嘢（ckf-* 改去 ckf-taste-*；唔連雲端；唔記統計；每日挑戰唔交分）
// 呢個檔案要喺所有遊戲 JS 之前載入（index.html），先可以喺遊戲讀存檔之前換走個 key
// 只限開發者：第一次要用 ?taste=<開發者密碼>，部機記低之後 ?taste 就得；密碼本身唔喺代碼入面，只有佢嘅雜湊
// TypeScript port of the original game's taste.js, as an ES module: every
// top-level name is exported, none renamed. This module runs first
// (src/entry.ts), so the game names it uses (must, $, G, ...) are only touched from functions that run after the page
// has loaded.
import { HOOK } from './hooks';
import { must, ownKey } from '../core/util';
import { $ } from './prefs';
import { setStation, setSlot, setDiff, liveG, G } from '../core/state';
import { CFG, SLOTS } from '../core/data/menus';
import { toast } from './ui';
import { openDecor } from './decor';
import { openRecipes } from './menu';
import { INGR, openPantry, openGrade, openBranches } from './market';
import { dayStr, dailyChallenge, setDailyArmed, openBook } from './career';
import { LEVELS, armLevel, closestIn } from './levels';
import { shopSeat } from '../core/career/seats';
import { openDex } from './dex';
import { armTut } from './tutorial';
import { openWardrobe } from './outfit';
import { hostRoom } from '../net/net';
import { homeStep, buildMenus, start } from './main';

export const TASTE = ((): boolean => {
  const m = location.search.match(/[?&]taste(?:=([^&]*))?(?:&|$)/);
  if (!m) return false;
  const fnv = (s: string): number => { let h = 0x811c9dc5; for (const c of s){ h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
  try {
    if (m[1] && fnv(decodeURIComponent(m[1])) === 4036772288) localStorage.setItem('chakei-dev', '1');
    return localStorage.getItem('chakei-dev') === '1';
  } catch { return false; }
})();
if (TASTE) ((): void => {
  // ---- 1. 存檔隔離：聲音、畫面設定照用自己嗰份，其他 ckf-* 全部改用試味專用 key ----
  const KEEP = new Set(['ckf-sound', 'ckf-music', 'ckf-view', 'ckf-kmode']);
  // Storage methods may be called with anything; only string keys that start with ckf- are mapped (as in the JS).
  const mapKey = (k: unknown): string => typeof k==='string' && k.startsWith('ckf-') && !k.startsWith('ckf-taste-') && !KEEP.has(k) ? 'ckf-taste-' + k.slice(4) : String(k);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- the originals are kept unbound on purpose (as in the JS) and always run as get.call(this, ...)
  const P = Storage.prototype, get = P.getItem, set = P.setItem, del = P.removeItem;
  // leaving：揀咗下一道菜、等緊 reload；呢段時間舊畫面嘅存檔（例如收工、計時器）唔准蓋過新嗰份
  let leaving = false;
  P.getItem = function (this: Storage, k: string): string | null { return get.call(this, mapKey(k)); };
  P.setItem = function (this: Storage, k: string, v: string): void { if (leaving && mapKey(k)!==k) return; set.call(this, mapKey(k), v); };
  P.removeItem = function (this: Storage, k: string): void { if (leaving && mapKey(k)!==k) return; del.call(this, mapKey(k)); };
  const DONE_KEY = 'chakei-taste-done', FULL_KEY = 'chakei-taste-full', GO_KEY = 'chakei-taste-go';
  const store = { get: (k: string): string | null => { try { return get.call(localStorage, k); } catch { return null; } }, set: (k: string, v: string): void => { try { set.call(localStorage, k, v); } catch { /* storage blocked: the tick is lost */ } } };
  const BITE = 75;   // 每道菜試幾多秒（真實時間）；「完整一更」就用返正常 180 秒

  // ---- 2. 預設存檔：由新手到老闆四級，每道菜喺上面再加少少 ----
  const ALL4 = (): Record<StationId, number> => ({ waiter:3, bar:3, kitchen:3, till:3 });
  const ingAll = (n: number): Record<string, number> => Object.fromEntries(INGR.map(i => [i, n]));
  const BASE: Record<TasteBase, () => TasteSave> = {
    fresh: () => ({ nick:'試味員' }),
    trained: () => ({ nick:'試味員', tutDone:{ waiter:1, bar:1, kitchen:1, till:1 }, skipTut:true, shifts:5, stars:4, servedTotal:60, bank:3000,
      gates:['shop', 'rookie'], levels:{ estate:1 }, ingStart:true, ing:{ 雞蛋:3, 牛肉:3, 麵:2, 檸檬:2, 茶葉:2, 咖啡豆:2 } }),
    pro: () => ({ ...BASE.trained(), stars:12, shifts:25, servedTotal:400, bank:20000, gates:['shop', 'rookie', 'dex', 'pro'],
      levels:{ estate:3, central:3, mongkok:2, bingsutt:2 }, regs:{ chan:2, leebak:1, ming:1 }, ing: ingAll(6) }),
    boss: () => {
      const lv = Object.fromEntries(Object.keys(LEVELS).map(id => [id, 3]));
      return { ...BASE.pro(), stars:60, shifts:120, servedTotal:3000, bank:200000, gates:['shop', 'rookie', 'dex', 'pro', 'branch'], levels: lv,
        lvst:{ estate: ALL4(), central: ALL4() }, own:['green', 'mosaic', 'sg-red', 'aw-none', 'pl-town', 'pl-estate'], place:'pl-estate',
        regs:{ chan:3, leebak:3, ming:2, cheung:2, wong:2, fat:1, lung:1 }, celebs:{ diva:1, chef:1 }, ing: ingAll(20),
        mort:{ 'pl-estate':5 }, mortDay:'', crateNext:0, branchAt: Date.now() - 9 * 3600e3, streak:{ n:3, last: dayStr(-1) } };
    },
  };

  // ---- 3. 開一道菜用嘅小工具（喺 reload 之後、遊戲全部載入完先行） ----
  const home = (step?: string): void => { must($('startView'), 'startView').hidden = false; homeStep(step || 'mode'); buildMenus(); };
  const shift = (st: StationId, sl: Slot, d: string, after?: () => void) => (): void => { setStation(st); setSlot(sl); setDiff(d); buildMenus(); start(); if (after) after(); };
  const level = (id: string, st: StationId) => (): void => { setStation(st); setDiff('pro'); armLevel(id); start(); };
  const screen = (fn: () => void) => (): void => { home('shop'); fn(); };
  const soon = (sec: number): number => liveG().t + sec;
  // 名人一定俾人認出（正常六成機會），等試味嗰位一定見到粉絲潮
  // HOOK.careerArrive: every caller goes through the hook table (src/hooks.ts), as every caller of the JS global did.
  const forceFans = (): void => { const orig = HOOK.careerArrive; HOOK.careerArrive = g => { orig(g); const S = liveG(); if (g.celeb && !S.rush) S.rush = { at: S.t + 5, gid: g.id, celeb: g.celeb, left: 5, next: 0 }; }; };

  // ---- 4. 試味菜單：順住玩家真實會遇到嘅次序 ----
  const COURSES: TasteGroup[] = [
    { g:'一、開門', items:[
      { id:'first', name:'第一次打開', note:'新玩家見到嘅主頁：新手卡、未解鎖嘅掣', base:'fresh', go: () => { home(); } },
      { id:'tut', name:'伙記培訓', note:'三枱固定客，冇時限，有箭咀同提示', base:'fresh', go: () => { setStation('waiter'); armTut(); start(); } },
    ] },
    { g:'二、四個崗位（各試一啖）', items:[
      { id:'waiter', name:'伙記：帶位、落單', note:'撳客 → 撳枱 → 聽佢講咩，寫落張單', base:'trained', go: shift('waiter', 'lunch', 'rookie') },
      { id:'bar', name:'水吧：煲茶、沖飲品', note:'先撳左邊茶膽煲茶，開舖之後跟單沖', base:'trained', go: shift('bar', 'lunch', 'rookie') },
      { id:'kitchen', name:'廚房：煮麵、煎蛋', note:'跟單落料，睇住火候唔好燶', base:'trained', go: shift('kitchen', 'lunch', 'rookie') },
      { id:'till', name:'收銀：計數、找錢', note:'加埋張單，收錢找錢；剔走伙記寫錯嘅嘢', base:'trained', go: shift('till', 'lunch', 'rookie') },
    ] },
    { g:'三、一日三更', items:[
      { id:'breakfast', name:'早市：常餐、ABC 餐', note:'早餐嘅講法同午市唔同（轉公仔麵、烘底）', base:'trained', go: shift('waiter', 'breakfast', 'rookie') },
      { id:'dinner', name:'晚市：碟頭飯、炒底走青', note:'收工會計全日營業額，下一更就係第二日', base:'trained', shop: s => ({ ...s, dayRev: 2400 }), go: shift('kitchen', 'dinner', 'rookie') },
    ] },
    { g:'四、特別事件', items:[
      { id:'fever', name:'旺場', note:'開門三秒就入旺場：每更一次，慢慢旺到高峰，再靜返', base:'pro', go: shift('waiter', 'lunch', 'pro', () => { liveG().feverAt = soon(3); }) },
      { id:'regulars', name:'熟客講故事、陳生帶女伴', note:'龍哥入門講故事；陳生今次帶咗女伴嚟（張太都喺度）', base:'pro', shop: s => ({ ...s, stars:30, regs:{ ...s.regs, lung:1, cheung:1 } }),
        go: shift('waiter', 'lunch', 'pro', () => { liveG().regPlan = [{ key:'lung', at: soon(4) }, { key:'cheung', at: soon(14) }, { key:'chan', at: soon(22), date:true }]; }) },
      { id:'celeb', name:'名人同粉絲潮', note:'戴黑超嘅客一入嚟就俾人認出，門口排長龍；埋單先知係邊個', base:'pro',
        go: shift('waiter', 'lunch', 'pro', () => { forceFans(); liveG().regPlan = [{ celeb:'kungfu', at: soon(4) }]; }) },
      { id:'tillfix', name:'收銀：伙記寫錯單、八達通唔夠錢', note:'電腦伙記今次成日寫錯，收銀要剔走多出嚟嗰行', base:'pro', go: shift('till', 'lunch', 'pro', () => { CFG.aiErr = .6; }) },
      { id:'takeaway', name:'外賣奶茶（布袋奶茶檔）', note:'街邊有人買外賣，水吧要兼顧', base:'boss', go: level('milktea', 'bar') },
      { id:'ghost', name:'鬼客（長洲舖）', note:'有啲客食完就唔見咗，留低雙倍錢', base:'boss', shop: s => ({ ...s, own:[...must(s.own, 'own'), 'pl-haunt'], place:'pl-haunt' }), go: shift('waiter', 'dinner', 'pro') },
      { id:'smoke', name:'暫停：伙記仔去食煙', note:'暫停畫面有小劇場；每次撳暫停都可能唔同', base:'pro', go: shift('waiter', 'lunch', 'pro', () => setTimeout(() => { HOOK.setPause(true); }, 1500)) },
      { id:'kitchen2', name:'熟手廚房：兩個爐', note:'升到熟手，廚房有兩個碟位，要同時煮兩份', base:'pro', go: shift('kitchen', 'lunch', 'pro') },
    ] },
    { g:'五、收工、升職、每日', items:[
      { id:'rankup', name:'返工第七日 + 升職', note:'做完呢更：第七日大獎 $700 同 1★，升到熟手，返主頁會彈解鎖卡', base:'trained',
        shop: s => ({ ...s, stars:9, streak:{ n:6, last: dayStr(-1) }, levels:{ estate:3, central:2 } }), go: shift('waiter', 'lunch', 'rookie') },
      { id:'daily', name:'每日挑戰', note:'全港同一批客；試味模式唔會交分上排行榜', base:'pro', go: () => { const dc = dailyChallenge(); setStation(shopSeat(dc.station) ? dc.station : 'waiter'); setSlot(must(ownKey(SLOTS, dc.slot) ? dc.slot : null, 'slot ' + dc.slot)); setDailyArmed(true); buildMenus(); start(); } },
    ] },
    { g:'六、經營自己間舖', items:[
      { id:'decor', name:'裝修、擺設、套裝', note:'買牆、地板、招牌、枱；湊齊套裝有效果', base:'boss', go: screen(() => { openDecor(); }) },
      { id:'grow', name:'擴舖、搬舖', note:'舖面大細同地點（每個地點有唔同效果）', base:'boss', go: screen(() => { openDecor('grow'); }) },
      { id:'recipes', name:'學新菜、升級招牌菜', note:'用錢同食材學新菜；三星變招牌菜', base:'boss', go: screen(() => { openRecipes(); }) },
      { id:'pantry', name:'貨倉、街市、貨箱', note:'今次貨箱已經到咗，撳開佢', base:'boss', go: screen(() => { openPantry(); }) },
      { id:'grade', name:'茶記評級', note:'一至五碗；評級高熟客嚟得密啲', base:'boss', go: screen(() => { openGrade(); }) },
      { id:'branch', name:'分店收租', note:'分店已經儲滿 8 個鐘，收得', base:'boss', go: screen(() => { openBranches(); }) },
      { id:'mortgage', name:'按揭供樓', note:'主頁「自己間舖」入面嘅供樓框（要三星收工先供到）', base:'boss', go: () => { home('shop'); } },
      { id:'book', name:'熟客簿', note:'熟客故事、名人、彩蛋', base:'boss', go: screen(() => { openBook(); }) },
      { id:'dex', name:'茶餐廳圖鑑', note:'玩過、三星、每個位全三星，三級', base:'boss', go: screen(() => { openDex(); }) },
      { id:'wardrobe', name:'衣櫃', note:'換帽、髮型、衫褲', base:'boss', go: screen(() => { openWardrobe(); }) },
      { id:'share', name:'分享卡', note:'收工之後可以出張卡分享', base:'boss', go: shift('waiter', 'lunch', 'pro', () => setTimeout(() => { const S = liveG(); if (S.running) { S.t = CFG.gameSec; } }, 12000)) },
    ] },
    { g:'七、關卡（每類一關）', items:[
      { id:'lv-estate', name:'主線：屋邨茶記', note:'關卡用固定舖面同餐牌，按營業額計星', base:'boss', go: level('estate', 'waiter') },
      { id:'lv-latenight', name:'主線：通宵夜更', note:'夜更時鐘由十一點開始', base:'boss', go: level('latenight', 'kitchen') },
      { id:'lv-bingsutt', name:'年代：街角冰室', note:'五十年代冰室', base:'boss', go: level('bingsutt', 'bar') },
      { id:'lv-village', name:'舊區：村口冰室最後一日', note:'清拆前最後一日', base:'boss', go: level('village', 'waiter') },
      { id:'lv-fastmilk', name:'經典：火速奶公司', note:'客人講一次就唔再講', base:'boss', go: level('fastmilk', 'waiter') },
      { id:'lv-halloween', name:'節日：長洲萬聖夜', note:'平時只係十月尾開；試味模式直接開', base:'boss', go: level('halloween', 'waiter') },
      { id:'lv-hell', name:'地獄午市', note:'全餐牌、客人超急', base:'boss', go: level('hell', 'kitchen') },
    ] },
    { g:'八、組隊', items:[
      { id:'coop', name:'開房（本機試）', note:'試味模式唔連雲端：只試開房畫面，一個人開工由電腦補位。真組隊請用正常網址同朋友試', base:'boss', go: () => { home(); must($('coopView'), 'coopView').hidden = false; hostRoom(); } },
    ] },
  ];
  const FLAT: TasteCourse[] = COURSES.flatMap(c => c.items.map(it => ({ ...it, group: c.g })));
  const byId = (id: string): TasteCourse | undefined => FLAT.find(c => c.id===id);
  // A stored list that is not an array makes the JS fail where it uses it; here it fails when read (outside the try).
  const done = (): unknown[] => { let v: unknown; try { v = JSON.parse(store.get(DONE_KEY) || '[]'); } catch { return []; } if (Array.isArray(v)) return v; throw new TypeError('chakei: the taste done list is not a list'); };
  const full = (): boolean => store.get(FULL_KEY)==='1';

  // 揀一道菜：換存檔，reload，reload 完先開（咁所有遊戲初始化都由呢份存檔做起）
  function order(id: string): void {
    const c = byId(id); if (!c) return;
    let s = BASE[c.base](); if (c.shop) s = c.shop(s);
    try {
      ['shop', 'station', 'slot', 'diff', 'auth'].forEach(k => { del.call(localStorage, mapKey('ckf-' + k)); });
      set.call(localStorage, mapKey('ckf-shop'), JSON.stringify(s));
      set.call(sessionStorage, GO_KEY, id);
    } catch { /* storage blocked: reload with what is there */ }
    leaving = true;
    if (G) G.running = false;
    location.replace(location.pathname + '?taste');
  }
  function serve(id: string): void {
    const c = byId(id); if (!c) return;
    const d = done(); if (!d.includes(id)) { d.push(id); store.set(DONE_KEY, JSON.stringify(d)); }
    CFG.gameSec = full() ? 180 : BITE;
    CUR = c; renderBar();
    c.go();
    toast(`試味：${c.name} · ${c.note}`);
  }
  let CUR: TasteCourse | null = null;

  // ---- 5. 畫面：右下角一粒「試味」掣 + 菜單 ----
  const css = `
  #tasteBar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(6px + env(safe-area-inset-bottom,0px));z-index:60;display:flex;gap:6px;align-items:center;
    background:#0f1a16e6;color:#f4efd9;border:2px solid #e9a21a;border-radius:999px;padding:4px 6px 4px 12px;font:600 12px/1.2 var(--body);max-width:calc(100vw - 32px);box-shadow:0 3px 10px #0006}
  #tasteBar span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}
  #tasteBar button{background:#e9a21a;color:#0f1a16;border:none;border-radius:999px;padding:6px 10px;font:700 12px var(--body);min-height:40px;cursor:pointer;white-space:nowrap;flex:none}
  #startView{padding-bottom:84px}
  #tasteBar button.ghost,.tasteRow button.ghost{background:transparent;color:#f4efd9;border:1px solid #f4efd966}
  .tasteRow{display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:#0f1a16e6;color:#f4efd9;border:2px solid #e9a21a;border-radius:14px;padding:6px 6px 6px 12px;font:600 12px/1.3 var(--body);margin-bottom:8px}
  .tasteRow span{flex:1 1 100%}
  .tasteRow button{background:#e9a21a;color:#0f1a16;border:none;border-radius:999px;padding:8px 14px;font:700 13px var(--body);min-height:40px;cursor:pointer}
  #tasteView{position:fixed;inset:0;z-index:70;background:#0f1a16f2;color:#f4efd9;overflow:auto;padding:16px max(16px,env(safe-area-inset-right,0px)) 40px max(16px,env(safe-area-inset-left,0px));font-family:var(--body)}
  #tasteView .tv{max-width:560px;margin:0 auto}
  #tasteView h2{font-family:var(--display);font-size:26px;margin:4px 0}
  #tasteView p{font-size:13px;line-height:1.5;color:#c9d6cf;margin:6px 0}
  #tasteView h3{font-size:14px;color:#e9a21a;margin:18px 0 6px;letter-spacing:.05em}
  #tasteView ol{list-style:none;margin:0;padding:0;display:grid;gap:6px}
  #tasteView li button{width:100%;text-align:left;background:#1e2f28;color:#f4efd9;border:1px solid #2f6b5a;border-radius:10px;padding:10px 12px;cursor:pointer;display:grid;gap:2px;min-height:44px}
  #tasteView li button b{font-size:15px}
  #tasteView li button small{font-size:12px;color:#9fb3a9}
  #tasteView li button.done b::after{content:' ✓';color:#7fd1a8}
  #tasteView .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  #tasteView .row button,#tasteView .row a{background:transparent;color:#f4efd9;border:1px solid #f4efd966;border-radius:999px;padding:8px 14px;font:600 13px var(--body);min-height:40px;text-decoration:none;display:inline-flex;align-items:center;cursor:pointer}
  #tasteView .row button[aria-pressed="true"]{background:#e9a21a;color:#0f1a16;border-color:#e9a21a}`;
  // 試味掣放三個地方，開工時一粒都唔會遮住遊戲：主頁底部一條、暫停畫面同收工畫面頂部各一行
  // （開工中想轉菜：撳「暫停」）
  const onBar = (e: Event): void => { const t = closestIn(e.target, 'button[data-t]'); if (!t) return; if (t.dataset.t==='menu') openMenu(); if (t.dataset.t==='next') nextCourse(); };
  function renderBar(): void {
    const cur = CUR, i = cur ? FLAT.findIndex(c => c.id===cur.id) : -1;
    const html = `<span>試味${cur ? ` ${i + 1}/${FLAT.length} · ${cur.name}` : '模式'}</span><button type="button" class="ghost" data-t="menu">試味菜單</button>${cur && i < FLAT.length - 1 ? '<button type="button" data-t="next">下一道 ▶</button>' : ''}`;
    let b = $('tasteBar');
    if (!b){ b = document.createElement('div'); b.id = 'tasteBar'; document.body.appendChild(b); b.addEventListener('click', onBar); }
    b.innerHTML = html;
    ['pauseView', 'endView'].forEach(id => {
      const card = document.querySelector(`#${id} .card`) || $(id); if (!card) return;
      let r = card.querySelector('.tasteRow');
      // 收工畫面好長、焦點喺「下一更」掣：放喺嗰粒掣上面；暫停畫面就放頂
      if (!r){ r = document.createElement('div'); r.className = 'tasteRow'; if (id==='endView') must($('nextBtn'), 'nextBtn').before(r); else card.prepend(r); r.addEventListener('click', onBar); }
      r.innerHTML = html;
    });
  }
  // 主頁先出底部嗰條；開工、暫停、收工、菜單打開時收埋
  const syncBar = (): void => { const b = $('tasteBar'); if (b){ const tv = $('tasteView'); b.hidden = !(!must($('startView'), 'startView').hidden && must($('pauseView'), 'pauseView').hidden && must($('endView'), 'endView').hidden && (!tv || tv.hidden)); } };
  function nextCourse(): void { const cur = CUR, i = cur ? FLAT.findIndex(c => c.id===cur.id) : -1, n = FLAT[i + 1]; if (n) order(n.id); }
  function openMenu(): void {
    if (G && G.running && !G.paused) HOOK.setPause(true);
    let v = $('tasteView'); if (!v){ v = document.createElement('div'); v.id = 'tasteView'; document.body.appendChild(v); v.addEventListener('click', menuClick); }
    const d = done();
    v.innerHTML = `<div class="tv"><h2>試味菜單</h2>
      <p>每道菜試一啖：先幫你換一份啱嘅存檔，再直接開去嗰個玩法。遊戲速度正常，只係跳過「儲」嘅時間。試味模式有自己一份存檔，唔會郁到你真正嘅進度、雲端存檔同排行榜。</p>
      <div class="row"><button type="button" data-a="bite" aria-pressed="${String(!full())}">每道 ${BITE} 秒</button><button type="button" data-a="full" aria-pressed="${String(full())}">完整一更（3 分鐘）</button></div>
      ${COURSES.map(c => `<h3>${c.g}</h3><ol>${c.items.map(it => `<li><button type="button" data-c="${it.id}" class="${d.includes(it.id) ? 'done' : ''}"><b>${FLAT.indexOf(must(byId(it.id), 'course ' + it.id)) + 1}. ${it.name}</b><small>${it.note}</small></button></li>`).join('')}</ol>`).join('')}
      <div class="row"><button type="button" data-a="close">返回</button><button type="button" data-a="reset">清除打剔</button><a href="${location.pathname}">離開試味模式</a></div></div>`;
    v.hidden = false; v.scrollTop = 0;
  }
  function menuClick(e: Event): void {
    const b = closestIn(e.target, 'button'); if (!b) return;
    if (b.dataset.c){ order(b.dataset.c); return; }
    const a = b.dataset.a;
    if (a==='bite' || a==='full'){ store.set(FULL_KEY, a==='full' ? '1' : '0'); if (G && !G.tut) CFG.gameSec = full() ? 180 : BITE; openMenu(); }
    if (a==='reset'){ store.set(DONE_KEY, '[]'); openMenu(); }
    if (a==='close'){ must($('tasteView'), 'tasteView').hidden = true; }
  }

  // ---- 6. 遊戲載入完：開返啱啱揀嗰道菜，或者打開菜單 ----
  document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    document.title = '試味 · ' + document.title;
    let go: string | null = null; try { go = sessionStorage.getItem(GO_KEY); sessionStorage.removeItem(GO_KEY); } catch { /* storage blocked: open the menu */ }
    CFG.gameSec = full() ? 180 : BITE;
    renderBar();
    if (go && byId(go)) serve(go); else openMenu();
    syncBar(); setInterval(syncBar, 300);
  });
  window.TASTE_API = { COURSES, FLAT, order, openMenu };   // 測試用
})();
