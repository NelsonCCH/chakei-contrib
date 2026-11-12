// A tiny static file server over site/ for the standalone station pages (they need no Worker, D1 or Durable Object),
// plus a page opener that is silent and offline like openGame(): headless, muted, every other host blocked.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { ROOT } from './server.js';
import { PHONE, WEBKIT } from './browser.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.map': 'application/json', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

export async function startStatic() {
  const site = join(ROOT, 'site');
  const srv = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(site, path);
    if (!file.startsWith(site)) { res.writeHead(403).end(); return; }
    try { const body = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, stop: () => new Promise(r => srv.close(r)) };
}

/** Opens a station page with the test hook on (window.__TEST__), sound muted inside the page on WebKit, errors recorded. */
export async function openStation(browser, url, opts = {}) {
  const ctx = await browser.newContext({ ...(opts.device || PHONE), locale: 'zh-HK', timezoneId: 'Asia/Hong_Kong', serviceWorkers: 'block' });
  await ctx.route(u => !u.href.startsWith(url), route => route.abort());
  await ctx.addInitScript(({ muteInPage }) => {
    window.__TEST__ = true;
    if (muteInPage) {
      for (const name of ['AudioContext', 'webkitAudioContext']) {
        const RealCtx = window[name];
        if (!RealCtx) continue;
        window[name] = class extends RealCtx {
          constructor(...a) { super(...a); const g = super.createGain(); g.gain.value = 0; g.connect(super.destination); Object.defineProperty(this, 'destination', { get: () => g }); }
        };
      }
    }
  }, { muteInPage: WEBKIT });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(url + opts.path);
  return page;
}
