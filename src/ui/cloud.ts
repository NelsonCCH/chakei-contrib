// 雲端：Google 登入、雲端存檔、每日挑戰排行榜（Cloudflare Worker：/api/*，見 worker/index.js）
// 冇登入照玩（訪客，存喺部機）；唔係由自己個 Worker 開（例如直接開檔案、嵌入式預覽）就成個功能收埋
// TypeScript port of the original game's cloud.js, as an ES module: every
// top-level name is exported (the tests call syncDown, pushNow, finishLogin, ... and read cloudState, CLOUD,
// cloudSynced through src/test-surface.ts). Worker replies are taken as the JS took
// them (trustReply): they are not yet validated at the boundary.
import './tutorial';   // load order: src/entry.ts
import { HOOK } from './hooks';
import { TASTE } from './taste';
import { must } from '../core/util';
import { $ } from './prefs';
import { toast } from './ui';
import { SHOP, sanitizeShop, setSHOP, applyShopWhenIdle, evEl } from './decor';
import { CRATE_MS } from './market';
import { todayStr, seeded, dailyChallenge } from './career';
import { boardBySeat, dailySeat, isSeat } from '../core/career/seats';
import { stationName } from '../core/party/endcard';
import { measureTxt } from '../core/career/targets';
import { trackOnce } from './stats';
import { renderMe } from './outfit';
import { buildMenus } from './main';

/* ===================== 設定 ===================== */
// CLOUD.cfg 由 /api/config 攞：googleClientId（有先出 Google 登入掣）、devAuth（測試登入，淨係開發／staging 用）
export const CLOUD: CloudConn = { on:false, cfg:null, token:'' };
export let cloudUser: CloudUser | null = null, cloudState = 'off', cloudMsg = '';
// cloudSynced：今次登入已經成功同雲端對過數先准上傳（防止雲端連唔到時，用空嘅本機紀錄覆蓋咗雲端）
export let cloudSynced = false, syncBusy = false, syncLast = 0;
export function setCloudSynced(v: typeof cloudSynced): void { cloudSynced = v; }
export function setSyncBusy(v: typeof syncBusy): void { syncBusy = v; }
export function setSyncLast(v: typeof syncLast): void { syncLast = v; }
export const AUTH_KEY = 'ckf-auth';
/**
 * A Worker reply is trusted as the JS trusts it: the fields each caller reads are taken as written, so a malformed
 * reply fails where the JS failed. No runtime check here on purpose (the original behaviour is kept).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter exists only to carry the assertion
export function trustReply(_j: unknown): asserts _j is ApiReply { /* trusted, see above */ }
/** `j.error` of a reply body, read as the JS read it: a null body throws (TypeError), a non-object has none. */
export function replyError(j: unknown): unknown {
  if (j === null || j === undefined) throw new TypeError('chakei: reply body is ' + String(j));
  return typeof j === 'object' && 'error' in j ? j.error : undefined;
}
/** `e.status` / `e.code` of whatever a failed call threw: an api() error has both, a network TypeError neither. */
export const errStatus = (e: unknown): unknown => (typeof e === 'object' && e !== null && 'status' in e ? e.status : undefined);
export const errCode = (e: unknown): unknown => (typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined);
/** `${e.code || '?'}` as the JS printed it in its error messages. */
export const errText = (e: unknown): string => { const c: unknown = errCode(e) || '?'; return String(c); };
export async function api(path: string, opt: ApiOpt = {}): Promise<ApiReply> {
  const headers = { 'content-type':'application/json', ...(CLOUD.token ? { authorization:'Bearer ' + CLOUD.token } : {}) };
  const r = await fetch(path, { ...opt, headers:{ ...headers, ...(opt.headers || {}) } });
  const j: unknown = await r.json().catch(() => ({}));
  if (!r.ok){ const code: unknown = replyError(j) || String(r.status); throw Object.assign(new Error(String(code)), { code, status: r.status }); }
  trustReply(j);
  return j;
}
// 載入時問一次 Worker；測試可以 await cloudReady
export const cloudReady = (async (): Promise<void> => {
  if (!/^https?:$/.test(location.protocol)) return;
  if (TASTE) return;   // 試味模式：唔連雲端，唔郁真存檔、唔交分（taste.js）
  try { CLOUD.cfg = await api('/api/config'); } catch { return; }
  CLOUD.on = true; cloudState = 'guest';
  try { CLOUD.token = localStorage.getItem(AUTH_KEY) || ''; } catch { /* storage blocked: no stored sign-in */ }
  if (CLOUD.cfg.googleClientId) loadGoogle();
  if (CLOUD.token){
    try { const j = await api('/api/me'); setUser(j.user); }
    catch (e){ if (errStatus(e)===401) setToken(''); else { cloudState = 'err'; cloudMsg = '雲端連唔到，照存喺部機'; } }
  }
  renderAcct(); if (typeof buildMenus==='function' && !must($('startView'), 'startView').hidden) buildMenus();
})();
export function setToken(t: string): void { CLOUD.token = t; try { if (t) localStorage.setItem(AUTH_KEY, t); else localStorage.removeItem(AUTH_KEY); } catch { /* storage blocked */ } }
export function setUser(u: ApiUser | null): void {
  cloudUser = u ? { uid:u.uid, displayName:u.name, provider:u.provider } : null;
  if (u && typeof trackOnce==='function') trackOnce('login');
  cloudState = u ? 'sync' : 'guest'; cloudSynced = false; renderAcct(); if (u) void HOOK.syncDown();
}

/* ===================== 存檔 ===================== */
// 雲端同部機邊份新啲就用邊份（SHOP.t = 最後改嘅時間）
export function normalizeShop(): void {
  SHOP.stars = (SHOP.stars ?? 0)|0; SHOP.regs = SHOP.regs || {}; SHOP.celebs = SHOP.celebs || {}; SHOP.eggs = SHOP.eggs || {};
  // `SHOP.items = SHOP.items || []` and `SHOP.own = SHOP.own || ['green','mosaic']` went: the starting shop has both and
  // sanitizeShop() drops a saved one that is not an array, so the checker proves the fallbacks unreachable.
  SHOP.daily = SHOP.daily || ''; SHOP.tutDone = SHOP.tutDone || {};
  SHOP.recipes = SHOP.recipes || []; SHOP.ing = SHOP.ing || {}; SHOP.rlv = SHOP.rlv || {}; SHOP.off = SHOP.off || []; SHOP.servedTotal = (SHOP.servedTotal ?? 0)|0; SHOP.mort = SHOP.mort || {}; SHOP.lv3day = SHOP.lv3day || {}; SHOP.lvst = SHOP.lvst || {}; SHOP.wardrobe = SHOP.wardrobe || []; SHOP.outfit = { hat:'paper', hair:'army', top:'shirt', pants:'black', ...(SHOP.outfit || {}) };
}
// 邊份紀錄贏：進度（星同服務過幾多位客）多嗰份贏；一樣先睇邊份新。唔再單睇時間——
// 否則新機／連唔到雲端期間玩過幾轉，本機「較新但空」就會蓋咗雲端嘅真紀錄
export const shopProg = (s: ShopSave): number => ((s.stars ?? 0)|0) * 1000 + ((s.servedTotal ?? 0)|0);
/* ===================== 兩部機合併存檔 ===================== */
// Two devices on one account no longer overwrite each other's progress. The Worker numbers
// every write of a save (`ver`) and refuses a write made from an older version (409 stale); this client then reads the
// cloud save again, merges it with its own field by field (mergeShop) and writes the result. cloudBase is the save as
// the cloud last held it to this device's knowledge (the common ancestor): with it, a field changed on one side only
// keeps that side's value, and money adds up both sides' changes. Without one (first sync on this device, or after a
// write whose outcome is unknown) those fields fall back to the side with more progress (the whole-save rule).
export let cloudVer = 0;
export let cloudBase: CloudBase | null = null;
export const CLOUD_BASE_KEY = 'ckf-cloud-base';
export const isSaveObj = (v: unknown): v is SaveObj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A plain JSON copy of a save (SHOP or a cloud save), what the merge compares and what is sent. */
export function saveCopy(s: ShopSave): SaveObj { const c: unknown = JSON.parse(JSON.stringify(s)); return isSaveObj(c) ? c : {}; }
/** Deep equality of two JSON values (key order does not matter). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (!isSaveObj(a) || !isSaveObj(b)) return false;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(k => sameJson(a[k], b[k]));
}
export function keepBase(shop: SaveObj): void {
  if (!cloudUser) return;
  cloudBase = { uid: cloudUser.uid, shop };
  try { localStorage.setItem(CLOUD_BASE_KEY, JSON.stringify(cloudBase)); } catch { /* storage full or blocked: the copy in memory still serves */ }
}
export function dropBase(): void { cloudBase = null; try { localStorage.removeItem(CLOUD_BASE_KEY); } catch { /* storage blocked */ } }
export function baseFor(uid: string): SaveObj | null {
  if (cloudBase) return cloudBase.uid === uid ? cloudBase.shop : null;
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CLOUD_BASE_KEY) || 'null');
    if (isSaveObj(v) && v.uid === uid && isSaveObj(v.shop)){ cloudBase = { uid, shop: v.shop }; return v.shop; }
  } catch { /* storage blocked or bad JSON: no base */ }
  return null;
}
// How each field merges when the two saves differ. Fields not listed are choices (looks, outfit, name, menu on/off,
// ...): changed on one side since the common save -> that side; changed on both, or no common save -> the side with
// more progress. Units are fields that only make sense together and merge as one value.
/** Progress, never lost: numbers take the larger, flags stay on, lists take the union, maps merge key by key. */
export const SAVE_GROW = ['stars', 'servedTotal', 'shifts', 'day', 'dayRev', 'regs', 'celebs', 'eggs', 'levels', 'lvst', 'mastery', 'rlv', 'mort', 'dex', 'tried', 'tutDone', 'gates', 'setsSeen', 'own', 'recipes', 'wardrobe', 'ingStart', 'hellToast', 'skipTut'];
/** Spendable: each side's change since the common save counts once (mergeSpend). */
export const SAVE_SPEND = ['bank', 'ing'];
/** Days ('YYYY-M-D', a map of them for lv3day): the later day wins; what was done that day stays done. */
export const SAVE_DAYS = ['daily', 'regToday', 'mortDay', 'lv3day'];
export const SAVE_UNITS = [['size', 'tables', 'items', 'lost', 'press'], ['pickDay', 'pick'], ['buyDay', 'buyN']];
export const growJson = (p: unknown, o: unknown): unknown => {
  if (p === undefined || p === null) return o;
  if (o === undefined || o === null) return p;
  if (typeof p === 'number' && typeof o === 'number') return Math.max(p, o);
  if (typeof p === 'boolean' && typeof o === 'boolean') return p || o;
  if (Array.isArray(p) && Array.isArray(o)){ const pa: unknown[] = p, oa: unknown[] = o; return [...pa, ...oa.filter(x => !pa.some(y => sameJson(x, y)))]; }
  if (isSaveObj(p) && isSaveObj(o)){ const r: SaveObj = { ...p }; for (const k of Object.keys(o)) r[k] = growJson(p[k], o[k]); return r; }
  return p;
};
/** 'YYYY-M-D' as a number that sorts by date (-1 for anything else). */
export const dayNum = (v: unknown): number => { const m = typeof v === 'string' ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v) : null; return m ? Number(m[1]) * 1e4 + Number(m[2]) * 100 + Number(m[3]) : -1; };
export const laterJson = (p: unknown, o: unknown): unknown => {
  if (isSaveObj(p) && isSaveObj(o)){ const r: SaveObj = { ...p }; for (const k of Object.keys(o)) r[k] = laterJson(p[k], o[k]); return r; }
  if (p === undefined) return o;
  return dayNum(o) > dayNum(p) ? o : p;
};
/** Saved times (ms), the clock-skew rule: the later one, but never past now (crate: never past one wait from now). */
export const mergeTime = (k: string, l: unknown, c: unknown): number => {
  const v = Math.max(Number(l) || 0, Number(c) || 0);
  return Math.min(v, Date.now() + (k === 'crateNext' ? CRATE_MS : 0));
};
/**
 * Money and ingredients when both devices changed them since the common save. A deliberate rule,
 * kept in this one function: each side's change is counted once, `local + cloud - base`, so earnings on both devices
 * add up and a purchase on either side is paid exactly once; the merge itself never counts a change twice. If both
 * devices spent the same money the result stops at 0. (A once-a-day reward claimed on both devices before they synced
 * is paid on both, since each device paid it out itself.) Without a common save this is not called: the side with more
 * progress keeps its amount (the whole-save rule), so a merge never sums two balances it cannot tell apart.
 */
export function mergeSpend(l: unknown, c: unknown, b: unknown): unknown {
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  if (isSaveObj(l) || isSaveObj(c) || isSaveObj(b)){
    const L = isSaveObj(l) ? l : {}, C = isSaveObj(c) ? c : {}, B = isSaveObj(b) ? b : {}, r: SaveObj = {};
    for (const k of new Set([...Object.keys(L), ...Object.keys(C)])) r[k] = Math.max(0, n(L[k]) + n(C[k]) - n(B[k]));
    return r;
  }
  return Math.max(0, n(l) + n(c) - n(b));
}
/** One field (or unit of fields) of the merge: l, c, b hold only those fields, from local, cloud and the common save. */
export function mergeUnit(ks: string[], l: SaveObj, c: SaveObj, b: SaveObj | null, cloudFirst: boolean): SaveObj {
  const k = ks[0] ?? '', p = cloudFirst ? c : l, o = cloudFirst ? l : c;
  if (sameJson(l, c)) return l;
  if (SAVE_GROW.includes(k)) return { [k]: growJson(p[k], o[k]) };
  if (SAVE_DAYS.includes(k)) return { [k]: laterJson(p[k], o[k]) };
  if (k === 't' || k === 'crateNext' || k === 'branchAt') return { [k]: mergeTime(k, l[k], c[k]) };
  if (k === 'streak'){   // days in a row: the later last day wins; the same day, the longer run
    const ps = p.streak, os = o.streak;
    if (!isSaveObj(ps)) return { streak: os };
    if (!isSaveObj(os)) return { streak: ps };
    const d = dayNum(os.last) - dayNum(ps.last);
    return { streak: d > 0 || (d === 0 && (Number(os.n) || 0) > (Number(ps.n) || 0)) ? os : ps };
  }
  if (k === 'buyDay'){   // market purchases today: the later day; the same day, the larger count (never an extra purchase)
    const d = dayNum(o.buyDay) - dayNum(p.buyDay);
    return d > 0 ? o : d < 0 ? p : { buyDay: p.buyDay, buyN: Math.max(Number(p.buyN) || 0, Number(o.buyN) || 0) };
  }
  if (b && sameJson(l, b)) return c;
  if (b && sameJson(c, b)) return l;
  if (b && SAVE_SPEND.includes(k)) return { [k]: mergeSpend(l[k], c[k], b[k]) };
  return Object.keys(p).length ? p : o;
}
/**
 * The save both devices continue from: `local` (this device), `cloud`, `base` (common ancestor or null). cloudFirst:
 * the cloud save has more progress (the whole-save rule), which picks the side for choices without a common save.
 */
export function mergeShop(local: SaveObj, cloud: SaveObj, base: SaveObj | null, cloudFirst: boolean): SaveObj {
  const units = SAVE_UNITS.map(u => [...u]), inUnit = new Set(SAVE_UNITS.flat()), out: SaveObj = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(cloud)])) if (!inUnit.has(k)) units.push([k]);
  for (const ks of units){
    const part = (s: SaveObj): SaveObj => Object.fromEntries(ks.filter(k => k in s).map(k => [k, s[k]]));
    Object.assign(out, mergeUnit(ks, part(local), part(cloud), base ? part(base) : null, cloudFirst));
  }
  return out;
}
/**
 * PUT the save as a compare-and-set on cloudVer. True: stored, and it becomes the common save. False: the cloud
 * moved on since this device read it (409 stale), nothing was written. Any other failure throws, and forgets the
 * common save first: whether that write landed is unknown, so a later merge must not count on it.
 */
export async function putShop(): Promise<boolean> {
  const sent = saveCopy(SHOP);
  try {
    const j = await api('/api/save', { method:'PUT', body: JSON.stringify({ shop: sent, ver: cloudVer }) });
    if (typeof j.ver === 'number') cloudVer = j.ver;   // an old Worker sends none (and ignores ours)
    keepBase(sent); return true;
  } catch (e) {
    if (errStatus(e)===409) return false;
    dropBase(); throw e;
  }
}
export async function syncDown(): Promise<void> {
  if (syncBusy || !cloudUser) return; syncBusy = true; syncLast = Date.now();
  const uid = cloudUser.uid;
  try {
    // Read, merge, write; if another device wrote in between (stale), read again. Three tries, then report an error.
    for (let tries = 1; ; tries++){
      const j = await api('/api/save');
      const cloud = sanitizeShop(j.shop);
      cloudVer = typeof j.ver === 'number' ? j.ver : 0;   // no save yet, or an old Worker: 0
      const cp = cloud ? shopProg(cloud) : -1, lp = shopProg(SHOP);
      // The cloud save has more progress (the whole-save rule): it picks the message, and the side for
      // choices when there is no common save.
      const fromCloud = !!cloud && (cp > lp || (cp === lp && (Number(cloud.t) || 0) > (Number(SHOP.t) || 0)));
      const cc = cloud ? saveCopy(cloud) : null;
      if (cc){
        const local = saveCopy(SHOP), m = sanitizeShop(mergeShop(local, cc, baseFor(uid), fromCloud));
        if (m && !sameJson(saveCopy(m), local)){
          setSHOP({ ...SHOP, ...m }); normalizeShop();
          try { localStorage.setItem('ckf-shop', JSON.stringify(SHOP)); } catch { /* storage full or blocked */ }
          applyShopWhenIdle();   // never under a running shift
        }
        // SHOP now contains this cloud save, so it is the common save from here on (a retry after another stale write
        // must not count the changes merged now a second time).
        keepBase(cc);
      }
      cloudSynced = true;
      const send = !cc || !sameJson(saveCopy(SHOP), cc);   // the cloud lacks something this device has
      if (send && !(await putShop())){
        if (tries < 3) continue;
        throw Object.assign(new Error('stale'), { code:'stale', status:409 });
      }
      cloudMsg = fromCloud ? '已經攞返雲端紀錄' : '已經存上雲端';
      break;
    }
    if (!SHOP.nick) SHOP.nick = defaultNick();
    cloudState = 'on';
  } catch (e) {
    if (errStatus(e)===401){ signOut(); toast('登入過咗期，請再登入'); }
    else { cloudState = 'err'; cloudMsg = `雲端連唔到（${errText(e)}），照存喺部機`; }
  }
  syncBusy = false;
  renderAcct(); if (!must($('startView'), 'startView').hidden) buildMenus(); else renderMe();
}
export let pushT = 0;
export function setPushT(v: typeof pushT): void { pushT = v; }
// saveShop 每次都叫；等三秒冇再改先上傳，慳讀寫
export function cloudPush(): void {
  if (!cloudUser) return;
  // 未對過數唔上傳，過一分鐘再試. A clock set back makes `ago` negative; count that as due, not as "wait until then".
  if (!cloudSynced){ const ago = Date.now() - syncLast; if (!syncBusy && (ago > 60000 || ago < 0)) void HOOK.syncDown(); return; }
  clearTimeout(pushT); pushT = setTimeout(() => { void pushNow(); }, 3000);
}
export async function pushNow(): Promise<void> {
  if (!cloudUser || !cloudSynced) return;
  try {
    if (!(await putShop())){ await HOOK.syncDown(); return; }   // another device wrote first: read, merge, write again
    if (cloudState==='err'){ cloudState = 'on'; cloudMsg = '已經存上雲端'; renderAcct(); }
  } catch (e) { cloudState = 'err'; cloudMsg = `雲端連唔到（${errText(e)}），照存喺部機`; renderAcct(); }
}
// 閂頁前有未上傳嘅改動：即刻送（keepalive 等個請求喺閂頁之後都送得出）
addEventListener('pagehide', () => {
  if (!pushT || !cloudUser || !cloudSynced) return;
  clearTimeout(pushT); pushT = 0;
  // compare-and-set like every write (a stale one is refused; the next visit merges the local save). Its outcome is
  // never read, so the common save is forgotten: the page may come back from the back-forward cache.
  dropBase();
  try { void fetch('/api/save', { method:'PUT', keepalive:true, headers:{ 'content-type':'application/json', authorization:'Bearer ' + CLOUD.token }, body: JSON.stringify({ shop: SHOP, ver: cloudVer }) }); } catch { /* page is closing: nothing to do */ }
});
export const defaultNick = (): string => ((cloudUser && cloudUser.displayName || '').split(/\s+/)[0] || '伙記').slice(0, 10);

/* ===================== 登入、登出 ===================== */
// Google：用 Google Identity Services 個官方掣，攞到 ID token 交俾 Worker 驗，換返我哋自己嘅登入票
export function loadGoogle(): void {
  if (window.google && window.google.accounts){ initGoogle(); return; }
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = initGoogle;
  document.head.appendChild(s);
}
export let googleReady = false;
/** google.accounts.id once the GIS script is in (the JS dereferenced it unchecked, inside a try). */
export const gsi = (): GsiId => must(must(google, 'google').accounts, 'google.accounts').id;
export function initGoogle(): void {
  try {
    gsi().initialize({ client_id: must(CLOUD.cfg, 'CLOUD.cfg').googleClientId, callback: r => { void finishLogin('/api/auth/google', { credential: r.credential }); }, ux_mode:'popup', auto_select:false });
    googleReady = true; renderAcct();
  } catch { /* GIS not usable: no Google button */ }
}
export async function finishLogin(path: string, body: Record<string, string>): Promise<void> {
  try { const j = await api(path, { method:'POST', body: JSON.stringify(body) }); setToken(j.token); setUser(j.user); }
  catch (e){ toast(errCode(e)==='bad_token' ? '登入唔到：Google 登入驗證唔過' : '登入唔到，遲啲再試'); }
}
// 測試登入：冇 Google 設定嘅開發／staging 版先有。同一個名 = 同一個帳戶（方便試「換機」）
export function devSignIn(): void {
  const n = prompt('測試登入（開發用）：輸入名。同一個名就係同一個帳戶。', SHOP.nick || '');
  if (n && n.trim()) void finishLogin('/api/auth/dev', { name: n.trim() });
}
export function signOut(): void {
  setToken(''); cloudUser = null; cloudSynced = false; cloudMsg = ''; cloudState = 'guest';
  try { if (googleReady) gsi().disableAutoSelect(); } catch { /* GIS gone: nothing to undo */ }
  renderAcct();
}
export function renderAcct(): void {
  const el = $('acct'); if (!el) return;
  if (cloudState==='off'){ el.hidden = true; return; }
  el.hidden = false;
  if (!cloudUser){
    const dev = CLOUD.cfg && CLOUD.cfg.devAuth;
    el.innerHTML = `${googleReady ? '<span id="gBtn"></span>' : dev ? '' : '<button type="button" id="signInBtn" disabled>用 Google 登入</button>'}${dev ? '<button type="button" id="devSignInBtn">測試登入</button>' : ''}<span>登入就存上雲端，換機都喺度；唔登入照玩。<a href="privacy.html" target="_blank" rel="noopener">私隱</a></span>`;
    if (googleReady) try { gsi().renderButton($('gBtn'), { theme:'outline', size:'medium', text:'signin_with', shape:'pill', locale:'zh-HK' }); } catch { /* GIS failed: the box stays without a button */ }
    return;
  }
  el.innerHTML = `<span class="who">☁ ${esc(cloudUser.displayName || '已登入')}${cloudUser.provider==='dev' ? '（測試）' : ''}</span>
    <span>${cloudState==='sync' ? '同步緊……' : cloudState==='err' ? cloudMsg : cloudMsg || '已存雲端'}</span><button type="button" id="signOutBtn">登出</button>`;
}
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, c => { const m: Record<string, string> = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }; return String(m[c]); });
document.addEventListener('click', e => {
  const b = evEl(e.target).closest('#acct button'); if (!b) return;
  if (b.id==='devSignInBtn') devSignIn();
  if (b.id==='signOutBtn') signOut();
});

/* ===================== 每日挑戰排行榜 ===================== */
// 每人每日留最高營業額（Worker 度比較，差過舊紀錄就唔蓋）
export async function cloudScore(rec: { revenue: number; stars: number; station: string; slot: Slot }): Promise<void> {
  if (!cloudUser) return;
  try { await api('/api/daily/' + todayStr(), { method:'POST', body: JSON.stringify({ name: (SHOP.nick || defaultNick()).slice(0, 10), revenue: rec.revenue|0, stars: rec.stars|0, station: rec.station, slot: rec.slot }) }); }
  catch { /* the score is best effort */ }
}
export async function openLeaderboard(): Promise<void> {
  must($('book'), 'book').innerHTML = `<div class="sh-head"><b>今日挑戰排行榜</b><span>${todayStr()}</span></div><p class="hint" id="lbMsg">攞緊……</p><div id="lbList"></div><button type="button" class="big" id="bookClose">返回</button>`;
  must($('bookView'), 'bookView').hidden = false;
  if (!CLOUD.on){ must($('lbMsg'), 'lbMsg').textContent = '排行榜要喺正式網址先睇到。'; return; }
  try {
    const rows = (await api('/api/daily/' + todayStr())).rows;
    must($('lbMsg'), 'lbMsg').textContent = rows.length ? (cloudUser ? '做到挑戰目標就會入榜（每個位分開排，記最好嗰次）。' : '登入咗先可以入榜。') : '今日未有人入榜，你做第一個！';
    // one list per seat: a row from before seats were stored counts as the day's seat for the four
    const four = dailySeat(seeded('ckf' + todayStr())(), () => false), mine = dailyChallenge().station;
    const groups = boardBySeat(rows, four, isSeat(mine) ? mine : four);
    must($('lbList'), 'lbList').innerHTML = groups.map(g => `<div class="lb-seat"><h4>${esc(stationName(g.seat))}</h4><ol class="lb">${g.rows.map(r =>
      `<li class="${r.me ? 'me' : ''}"><b>${esc(r.name)}</b><span>${'★'.repeat(r.stars)}</span><em>${measureTxt(g.seat, r.revenue)}</em></li>`).join('')}</ol></div>`).join('');
  } catch { must($('lbMsg'), 'lbMsg').textContent = '連唔到排行榜，遲啲再試。'; }
}
