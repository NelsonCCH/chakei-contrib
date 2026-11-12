// 有新版就話俾人知：舊網頁（iPhone 留住嘅分頁、快取）同新版夾唔埋，例如組隊大廳仲係舊樣
// Stale build hardening (a phone kept an old page open and showed a lobby the code no longer draws). The
// build (scripts/build.mjs) puts its id in the page (__BUILD_ID__) and in site/version.json. When the window comes back
// (focus, visible again, restored from the back-forward cache) and when a room lobby opens, the page fetches
// version.json past every cache; an id that differs from its own shows a one-tap 「有新版，撳一下更新」 banner that
// reloads. No top-level code touches the page: the entry calls staleBoot().

declare const __BUILD_ID__: string;
/** This page's build id ('dev' when the bundle was built without one). */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
/** The served build id file, relative to the page. */
export const VERSION_URL = 'version.json';
/** At most one check this often (ms) unless asked for (a room lobby opening). */
const MIN_GAP_MS = 2000;
let lastAt = -1e9, busy = false;

/** Reads the served build id past the HTTP cache and the service worker's, or null (offline, no file, not JSON). */
async function servedId(): Promise<string | null> {
  try {
    const r = await fetch(new URL(VERSION_URL, document.baseURI).href, { cache: 'no-store' });
    if (!r.ok) return null;
    const j: unknown = await r.json();
    const b: unknown = typeof j === 'object' && j !== null ? Reflect.get(j, 'build') : null;
    return typeof b === 'string' && b ? b : null;
  } catch { return null; }
}
/** Checks the served build against this page's; a different one shows the banner. Resolves true when it is shown. */
export async function checkStale(force = false): Promise<boolean> {
  const now = performance.now();
  if (busy || (!force && now - lastAt < MIN_GAP_MS)) return !!document.getElementById('staleBar');
  busy = true; lastAt = now;
  try {
    const id = await servedId();
    if (id && id !== BUILD_ID) showBanner();
    return !!document.getElementById('staleBar');
  } finally { busy = false; }
}
const CSS = '#staleBar{position:fixed;z-index:9999;left:50%;top:calc(env(safe-area-inset-top,0px) + 8px);transform:translateX(-50%);max-width:calc(100vw - 24px)}'
  + '#staleBar button{display:block;width:100%;font:inherit;font-weight:900;font-size:16px;padding:10px 16px;color:#0f1a16;background:#ffd25a;border:3px solid #0f1a16;box-shadow:0 4px 0 #0f1a16;cursor:pointer;white-space:nowrap}';
/** The one-tap banner (once): a tap reloads the page. */
function showBanner(): void {
  if (document.getElementById('staleBar')) return;
  if (!document.getElementById('staleCss')){ const s = document.createElement('style'); s.id = 'staleCss'; s.textContent = CSS; document.head.append(s); }
  const bar = document.createElement('div'); bar.id = 'staleBar'; bar.setAttribute('role', 'alert');
  const b = document.createElement('button'); b.type = 'button'; b.textContent = '有新版，撳一下更新';
  b.onclick = (): void => { location.reload(); };
  bar.append(b); document.body.append(bar);
}
let booted = false;
/** Watches for a newer build whenever the window comes back (the entry calls it once). */
export function staleBoot(): void {
  if (booted) return; booted = true;
  addEventListener('focus', () => { void checkStale(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkStale(); });
  addEventListener('pageshow', e => { if (e.persisted) void checkStale(true); });
}
