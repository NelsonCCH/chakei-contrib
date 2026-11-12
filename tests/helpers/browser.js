// Browser harness for game tests. Always headless and muted: test runs never make a
// sound or show a window. Each page records console errors and uncaught exceptions; tests assert
// there are none.
import { chromium, webkit } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './server.js';

export const OUT = join(ROOT, 'tests', 'out');
mkdirSync(OUT, { recursive: true });

/** localStorage for a player past the unlock gates (熟手, all stations trained), so every menu is open. */
export const veteran = (nick = '老闆', extra = {}) => ({ 'ckf-shop': JSON.stringify({ shifts: 5, stars: 12, servedTotal: 120, tutDone: { waiter: 1, bar: 1, kitchen: 1, till: 1 }, nick, t: 1, ...extra }) });
/** Save fields for a player who has learned every new seat too (員工培訓): a learned seat stays open whatever the ladder
 *  (the role gates), so its seat and room toggle are offered with no level passed. Pass as veteran's `extra`. */
export const ROLES_LEARNED = { tutDone: { waiter: 1, bar: 1, kitchen: 1, till: 1, runner: true, roast: true, takeaway: true } };
/** Save fields for a player who passed the main ladder up to 打風前夕 (第 5 關) with a star each: every new role has
 *  reached them, so each lesson is offered (not yet learned). Pass as openSingle's `shop` or veteran's `extra`. */
export const ROLES_REACHED = { levels: { estate: 1, central: 1, mongkok: 1, airport: 1, typhoon: 1 } };

/** TEST_BROWSER=webkit runs the suites on WebKit, Safari's engine, as a stand-in for iPhone Safari. */
export const WEBKIT = process.env.TEST_BROWSER === 'webkit';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** opts.fakeMic: Chromium's fake microphone (a test tone) with the permission prompt answered "allow" (push-to-talk). */
export async function launch(opts = {}) {
  // WebKit has no --mute-audio: openGame mutes every AudioContext and media element from inside the page instead.
  if (WEBKIT) return webkit.launch({ headless: true });
  const mic = opts.fakeMic ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] : [];
  return chromium.launch({ headless: true, args: ['--mute-audio', '--autoplay-policy=user-gesture-required', ...mic] });
}

export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...(WEBKIT ? { userAgent: IPHONE_UA } : {}) };
export const DESKTOP = { viewport: { width: 1280, height: 900 } };

/**
 * Opens the game in a fresh context. opts:
 *   device   PHONE (default) / DESKTOP / any Playwright context options
 *   latency  { ms, jitter } one-way delay added to every co-op WebSocket message in both directions
 *   storage  { key: value } localStorage to seed before the game loads
 *   query    extra query string, e.g. '?localnet'
 *   init     a function run in the page before the game loads
 *   ready    a page function that says the game has loaded (default: the test surface's G and cloudReady exist, then
 *            cloudReady settles); the production build has no test surface (prod-smoke.test.js)
 */
export async function openGame(browser, url, opts = {}) {
  // Service workers are blocked unless a test asks for them (opts.serviceWorkers: 'allow'): on WebKit, requests from a
  // worker-controlled page skip ctx.route(), so the backend-down stubs would not apply.
  const ctx = await browser.newContext({ ...(opts.device || PHONE), locale: 'zh-HK', timezoneId: 'Asia/Hong_Kong', serviceWorkers: opts.serviceWorkers || 'block' });
  // Keep tests offline and deterministic: block every host except the local Worker.
  await ctx.route(u => !u.href.startsWith(url), route => route.abort());
  await ctx.addInitScript(({ storage, latency, muteInPage }) => {
    window.__TEST__ = true;
    if (muteInPage) {
      // Silent on engines without a mute flag: every AudioContext plays into a zero-gain node, media stays muted.
      for (const name of ['AudioContext', 'webkitAudioContext']) {
        const RealCtx = window[name];
        if (!RealCtx) continue;
        window[name] = class extends RealCtx {
          constructor(...a) { super(...a); const g = super.createGain(); g.gain.value = 0; g.connect(super.destination); Object.defineProperty(this, 'destination', { get: () => g }); }
        };
      }
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { this.muted = true; this.volume = 0; return play.call(this); };
    }
    try {
      // Belt and braces on top of --mute-audio: the game's own sound and music switches off.
      localStorage.setItem('ckf-sound', 'off'); localStorage.setItem('ckf-music', 'off');
      for (const [k, v] of Object.entries(storage || {})) localStorage.setItem(k, v);
    } catch (e) {}
    // Co-op network shaping: delay + a kill switch to simulate a dropped connection.
    const Real = window.WebSocket;
    window.__net = { ms: latency ? latency.ms : 0, jitter: latency ? latency.jitter || 0 : 0, down: false, socks: [], sent: 0, recv: 0 };
    const delay = () => window.__net.ms + Math.random() * window.__net.jitter;
    // A delayed FIFO lane: items come out in the order they went in (like TCP), each no earlier than its own
    // due time. One timer drains the head, so timer rounding can never let a later item overtake.
    function lane() {
      const q = []; let timer = 0;
      const pump = () => { timer = 0; const now = performance.now(); while (q.length && q[0].at <= now + 0.5) q.shift().fn(); if (q.length) timer = setTimeout(pump, Math.max(0, q[0].at - performance.now())); };
      return {
        push(fn) {
          if (!window.__net.ms && !window.__net.jitter && !q.length) return fn();
          q.push({ at: Math.max(performance.now() + delay(), q.length ? q[q.length - 1].at : 0), fn });
          if (!timer) timer = setTimeout(pump, Math.max(0, q[0].at - performance.now()));
        },
      };
    }
    class Shaped {
      constructor(u, p) {
        this.url = u; this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
        if (window.__net.down) { this.dead = true; setTimeout(() => this.onclose && this.onclose({ code: 1006 }), 50); return; }
        // Silent network: a new connection neither opens nor fails (a phone in a lift), it just hangs.
        if (window.__net.silent) { this.hung = true; return; }
        const ws = this.real = new Real(u, p);
        this.inLane = lane(); this.outLane = lane();
        window.__net.socks.push(this);
        ws.onopen = e => this.inLane.push(() => { this.opened = true; this.onopen && this.onopen(e); });
        ws.onmessage = e => { if (this.cut) return; window.__net.recv++; const d = e.data; this.inLane.push(() => { if (!this.killed && !this.cut) this.onmessage && this.onmessage({ data: d }); }); };
        ws.onclose = e => { if (this.cut) return; const c = e.code; if (this.killed) return this.onclose && this.onclose({ code: c }); this.inLane.push(() => this.onclose && this.onclose({ code: c })); };
        ws.onerror = e => this.onerror && this.onerror(e);
      }
      // binaryType reaches the real socket (push-to-talk audio frames arrive as ArrayBuffers, as without the shim)
      get binaryType() { return this.real ? this.real.binaryType : this._bt || 'blob'; }
      set binaryType(v) { this._bt = v; if (this.real) this.real.binaryType = v; }
      // Like a real socket, it reads OPEN only from the moment the (delayed) open event is delivered.
      get readyState() { return this.hung ? 0 : this.killed || this.dead ? 3 : this.real.readyState === 1 && !this.opened ? 0 : this.real.readyState; }
      send(d) { if (this.hung || this.cut) return; window.__net.sent++; const ws = this.real; this.outLane.push(() => { if (ws.readyState === 1 && !this.killed && !this.cut) ws.send(d); }); }
      // A close goes down the same lane, after the sends queued before it (a real socket flushes them first).
      // A cut socket's close never reaches the server: the server keeps a half-open socket, as with a dead network.
      close(c, r) { if (this.dead || this.hung || this.cut) return; this.outLane.push(() => { try { this.real.close(c, r); } catch (e) {} }); }
      kill() { this.killed = true; try { this.real.close(4003, 'test-kill'); } catch (e) {} }
    }
    Shaped.CONNECTING = 0; Shaped.OPEN = 1; Shaped.CLOSING = 2; Shaped.CLOSED = 3;
    window.WebSocket = Shaped;
    // Drop the connection now; while down, reconnect attempts fail.
    window.__netDrop = () => { window.__net.down = true; window.__net.socks.forEach(s => s.kill()); };
    // Go silent without closing anything (lift, tunnel, iOS suspending Safari): open sockets become half-open (nothing in
    // or out, no close event on either side, ever) and new connections hang. __netRestore lets new connections through.
    window.__netSilence = () => { window.__net.silent = true; window.__net.socks.forEach(s => { s.cut = true; }); };
    window.__netRestore = () => { window.__net.down = false; window.__net.silent = false; };
  }, { storage: opts.storage || {}, latency: opts.latency || null, muteInPage: WEBKIT });
  // opts.init: an extra script run before the game loads (e.g. remove APIs an older phone does not have).
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept(opts.promptAnswer || '測試員'));
  await page.goto(url + '/' + (opts.query || ''));
  if (opts.ready) { await page.waitForFunction(opts.ready); return page; }
  await page.waitForFunction(() => typeof G !== 'undefined' && typeof cloudReady !== 'undefined');
  await page.evaluate(() => cloudReady);
  return page;
}

/** Errors other than the ones a blocked network makes on purpose. */
export const realErrors = page => page.errors.filter(e => !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(e));

export async function shot(page, name) {
  const p = join(OUT, name + '.png');
  await page.screenshot({ path: p });
  return p;
}

/** Runs a solo shift forward by `sec` game seconds in 50 ms steps (no real waiting). A room's shift: roomFastForward. */
export const fastForward = (page, sec) => page.evaluate(s => { for (let i = 0; i < s * 20 && G.running; i++) { if (!G.paused) update(0.05); } }, sec);

export const visible = (page, sel) => page.locator(sel).isVisible();

/** Asks the room's referee (the Durable Object) a test operation through this page's socket (ROOM_DEBUG). */
export const roomDbg = (page, d) => page.evaluate(x => NET.t.dbg(x), d);
/** Runs the room's shift forward by `sec` game seconds on the room's referee; the phones follow its next keyframe. */
export const roomFastForward = (page, sec) => roomDbg(page, { op: 'ff', sec });
