// 離線用：全部檔案都先上網攞最新，攞唔到（冇網）先用返快取
// 舊版（v1）JS／CSS 用快取先，更新後第一次開會「新網頁＋舊 CSS／JS」夾錯，所以改晒做網絡優先
// TypeScript port of the original game's sw.js. A classic service-worker script, built to
// site/sw.js by scripts/build.mjs and type-checked with tsconfig.sw.json (lib webworker; moduleDetection "force" lets
// the line below give `self` its service-worker type without emitting any import or export).
declare const self: ServiceWorkerGlobalScope;

const CACHE = 'chakei-v3';
self.addEventListener('install', () => { void self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;   // 後端 API、字型等交返俾瀏覽器（存檔唔可以用快取）
  if (url.pathname.endsWith('/version.json')) return;   // the served build id, never from a cache (src/ver/stale.ts)
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => {
    if (r.ok){ const cp = r.clone(); void caches.open(CACHE).then(c => c.put(req, cp)); }
    return r;
  }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('./') : undefined))
    // Nothing cached: the JS resolved respondWith with undefined, which the browser turns into a network error;
    // Response.error() is that same network error, typed.
    .then(r => r || Response.error())));
});
