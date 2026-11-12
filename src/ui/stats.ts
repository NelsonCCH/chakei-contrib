// 匿名使用統計：淨係記「做咗乜嘢嘅次數」，冇登入、冇裝置編號、冇個人資料
// 寫入 Worker /api/stats（D1 stats 表，每日每個 key 一行），用 wrangler d1 execute 睇
// 只喺正式 https 網址記；本機、嵌入式預覽（例如 AI 對話預覽）、?dev 都唔記
// TypeScript port of the original game's stats.js, as an ES module: every
// top-level name is exported.
import './cloud';   // load order: src/entry.ts
import { TASTE } from './taste';
import { G } from '../core/state';
import { evEl } from './decor';
import { rankIx } from './career';
import { CLOUD } from './cloud';

export const STAT_ON = (): boolean | null | undefined => CLOUD.on && CLOUD.cfg && CLOUD.cfg.stats && location.protocol==='https:' && !/^localhost|^127\./.test(location.hostname) && !/[?&]dev\b/.test(location.search) && !TASTE;
export let statQ: Record<string, number> = {}, statT = 0, statDead = false;   // statDead：寫入失敗（例如今日額度用晒）就唔再試，免得浪費
// 來源：連結加 ?from=<標籤>（細楷英文數字，最多 12 個字）；記喺部機，之後幾個漏斗步驟分開計
export const FROM = ((): string => { let f = ''; try {
  const m = location.search.match(/[?&]from=([a-z0-9]{1,12})/);
  if (m){ f = m[1] ?? ''; localStorage.setItem('ckf-from', f); } else f = localStorage.getItem('ckf-from') || '';   // group 1 always matches
} catch { /* storage blocked: keep what the link said */ } return f; })();
export const statDay = (): string => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);   // 香港日期
// 每次都記
export function track(k: string, n?: number): void {
  if (statDead || !STAT_ON() || !/^[a-z0-9_]{1,30}$/.test(k)) return;
  statQ[k] = (statQ[k] || 0) + (n || 1); if (!statT) statT = setTimeout(statFlush, 60000);   // 最多一分鐘寫一次（Firestore 寫入有每日額度，單一 doc 亦唔啱高頻寫）
}
/** The stored once-per-device list is trusted as the JS trusts it (no runtime check: the original behaviour is kept). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter exists only to carry the assertion
export function trustSeen(_v: unknown): asserts _v is Record<string, number> { /* trusted, see above */ }
// 每部機只記一次（跟住漏斗睇：幾多部機行到呢一步）
export function trackOnce(k: string): void {
  let seen: Record<string, number> = {}; try { const v: unknown = JSON.parse(localStorage.getItem('ckf-ev') || '{}') || {}; trustSeen(v); seen = v; } catch { /* storage blocked or bad JSON: start empty */ }
  if (seen[k]) return; seen[k] = 1; try { localStorage.setItem('ckf-ev', JSON.stringify(seen)); } catch { /* storage full or blocked */ }
  track('u_' + k);
  if (FROM && ['lv_start', 'shift3', 'shop_start'].includes(k)) track('fs_' + FROM + '_' + k.replace('_', ''));
}
export function statFlush(): void {
  clearTimeout(statT); statT = 0;
  const q = statQ; statQ = {}; if (statDead || !Object.keys(q).length || !STAT_ON()) return;
  try { fetch('/api/stats', { method:'POST', keepalive:true, headers:{ 'content-type':'application/json' }, body: JSON.stringify({ day: statDay(), e: q }) }).then(r => { if (!r.ok) statDead = true; }).catch(() => { statDead = true; }); } catch { statDead = true; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState==='hidden') statFlush(); });
// 中途離開（未收工）：記邊關、喺第幾分鐘走（qt0 = 頭一分鐘，qt1、qt2）。how = pause（撳「唔做喇」）／close（閂頁）
export function trackLeave(how: string): void {
  if (!G || !G.running || G.scored || G.tut) return;
  track('quit_' + how); track('q_' + (G.level || 'shop')); track('qt' + String(Math.min(2, Math.max(0, (G.t / 60) | 0))));
}
addEventListener('pagehide', () => { trackLeave('close'); statFlush(); });
// 由其他遊戲過嚟：每次到達、每部機第一次
if (FROM && /[?&]from=/.test(location.search)){ track('from_' + FROM); trackOnce('from_' + FROM); }
// 開咗：新機 / 今日第一次
(function(){
  let last = ''; try { last = localStorage.getItem('ckf-visit') || ''; localStorage.setItem('ckf-visit', statDay()); } catch { /* storage blocked */ }
  if (last !== statDay()) track(last ? 'visit_back' : 'visit_new');
})();
// 排名第一次升到：新人 / 熟手 / 阿姐 / 老闆
export function trackRank(): void { const r = rankIx(); for (let i = 1; i <= r; i++) trackOnce('rank' + String(i)); }
// 主頁第一下撳咩（每部機一次）：睇新玩家係跟教學、直接開工、定去咗其他位
document.addEventListener('click', e => {
  if (!STAT_ON()) return;
  const b = evEl(e.target).closest('#startView button'); if (!b) return;
  let done = ''; try { done = localStorage.getItem('ckf-tap1') || ''; } catch { /* storage blocked */ }
  if (done) return; try { localStorage.setItem('ckf-tap1', '1'); } catch { /* storage full or blocked */ }
  const ok = ['newbieGo', 'newbieSkip', 'firstGo', 'firstSkip', 'startBtn', 'shopBtn', 'levelBtn', 'coopBtn', 'tutBtn'];
  track('tap_' + (ok.includes(b.id) ? b.id.toLowerCase() : 'other'));
}, true);
