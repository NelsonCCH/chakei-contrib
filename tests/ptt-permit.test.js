// Mic and motion permission requests. Real headless, muted Chromium against the local room
// server, with getUserMedia, the Permissions API and DeviceOrientationEvent.requestPermission faked in the page so every
// answer can be played. The game makes the real request on every entry (the tap that creates or joins a room, a talk
// press while not granted, starting a 傳菜 shift); a "no" is never remembered; only a browser that has blocked the site
// for good gets the picture guide, drawn for the player's own browser.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, openGame, veteran, realErrors, shot, PHONE, OUT, ROLES_REACHED } from './helpers/browser.js';
import { join } from 'node:path';

let srv, browser;
const pages = [];
before(async () => { srv = await startServer(); browser = await launch({ fakeMic: true }); });
after(async () => { await browser?.close(); await srv?.stop(); });
afterEach(async () => { for (const p of pages.splice(0)) { try { await p.context().close(); } catch {} } });

const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/**
 * The page's mic, faked before the game loads. cfg.perm: what the Permissions API says at first ('prompt' / 'denied').
 * cfg.answers: how the player answers each prompt in turn ('allow', or 'dismiss': a "no" after 400 ms, which leaves the
 * permission at 'prompt'). A 'denied' permission refuses at once, without a prompt (blocked for good). The browser's
 * verdict lives in localStorage '__perm' (a real browser keeps it across reloads). Every getUserMedia call is logged in
 * window.__gum with whether a shift was running. A grant hands out Chromium's fake device.
 */
function fakeMic(cfg) {
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const get = () => localStorage.getItem('__perm') || cfg.perm;
  let status = null, n = 0;
  const set = s => { localStorage.setItem('__perm', s); if (status) { status.state = s; status.dispatchEvent(new Event('change')); } };
  window.__gum = [];
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async c => {
    window.__gum.push({ running: typeof G !== 'undefined' && !!G && !!G.running });
    if (get() === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
    const a = cfg.answers[Math.min(n++, cfg.answers.length - 1)];
    if (a === 'dismiss') { await new Promise(r => setTimeout(r, 400)); throw new DOMException('Permission dismissed', 'NotAllowedError'); }
    set('granted');
    return real(c);
  } } });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: {
    query: async ({ name }) => { if (name !== 'microphone') throw new TypeError('unknown'); status = Object.assign(new EventTarget(), { state: get() }); return status; },
  } });
}

async function player(nick, cfg, device = PHONE) {
  const p = await openGame(browser, srv.url, { device, storage: veteran(nick), init: `(${fakeMic})(${JSON.stringify(cfg)});` });
  p.nick = nick;
  pages.push(p);
  return p;
}
async function create(p) {
  await p.evaluate(() => { station = 'waiter'; saveSet('ckf-station', 'waiter'); buildMenus(); });
  await p.click('#coopBtn');
  await p.click('#hostBtn');
  await p.waitForFunction(() => NET.t && NET.t.up && NET.code);
  return p.evaluate(() => NET.code);
}
async function startShift(host) {
  await host.evaluate(() => { CFG.gameSec = 1e6; });
  await host.click('#hostGo');
  await host.waitForFunction(() => G.coop && G.running);
  await host.waitForSelector('#pttBtn', { state: 'visible' });
  await host.mouse.click(5, 300);
}
const gum = p => p.evaluate(() => window.__gum.length);
const mode = p => p.evaluate(() => { const c = document.getElementById('micCard'); return !c || !c.isConnected ? 'absent' : c.hidden ? 'hidden' : c.dataset.mode; });
const guide = p => p.evaluate(() => { const g = document.getElementById('permitGuide'); return g && !g.hidden ? `${g.dataset.kind}/${g.dataset.browser}` : ''; });
const center = async p => { const b = await p.locator('#pttBtn').boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
async function talk(p) {
  const [x, y] = await center(p);
  await p.mouse.move(x, y); await p.mouse.down();
  await p.waitForFunction(() => PTT.turn > 0, null, { timeout: 8000 });
  await p.mouse.up();
  await p.waitForFunction(() => PTT.turn === 0);
}
const noErrors = list => { for (const p of list) assert.deepEqual(realErrors(p), [], p.nick); };

test('every entry asks: creating and joining make the real request, a yes lets the player talk', async () => {
  const host = await player('老闆', { perm: 'prompt', answers: ['allow'] });
  const a = await player('阿明', { perm: 'prompt', answers: ['allow'] });
  const code = await create(host);
  assert.equal(await gum(host), 1, 'the create tap asked');
  await a.click('#coopBtn');
  await a.fill('#roomIn', code);
  await a.click('#joinBtn');
  assert.equal(await gum(a), 1, 'the join tap asked, inside the tap');
  await a.waitForFunction(() => document.getElementById('micCard').dataset.mode === 'ok');
  await shot(a, 'ptt-permit-ok');
  assert.equal(await guide(a), '', 'no guide for a player who said yes');
  await startShift(host);
  await talk(host);
  noErrors([host, a]);
});

test('a "no" is not remembered: the talk press asks again, the next visit asks again, no guide', async () => {
  const host = await player('老闆', { perm: 'prompt', answers: ['dismiss', 'allow'] });
  await create(host);
  await host.waitForFunction(() => document.getElementById('micCard').dataset.mode === 'denied');
  assert.equal(await guide(host), '', 'a no to the prompt is not a block');
  await startShift(host);
  await talk(host);   // the press asks (the player's own action) and the yes lets them talk
  assert.equal(await gum(host), 2, 'the lobby (a no), then the press (a yes, which opens the mic)');
  assert.equal(await guide(host), '');
  // the next visit (a reload) asks again on the next room
  const h2 = await player('老闆', { perm: 'prompt', answers: ['dismiss'] });
  await create(h2);
  assert.equal(await gum(h2), 1);
  noErrors([host, h2]);
});

test('blocked for good: the picture guide for the player\'s browser, on creating and on a press, and no request on the press', async () => {
  const host = await player('老闆', { perm: 'denied', answers: ['allow'] }, { ...PHONE, userAgent: ANDROID_CHROME });
  await create(host);
  await host.waitForSelector('#permitGuide', { state: 'visible' });
  assert.equal(await guide(host), 'mic/android-chrome');
  assert.match(await host.locator('#permitGuide').innerText(), /Site controls/);
  await host.click('#pguideOk');
  assert.equal(await mode(host), 'blocked');
  const before = await gum(host);
  await startShift(host);
  assert.equal(await host.evaluate(() => PTT.blocked), true);
  assert.match(await host.locator('#pttBtn').innerText(), /瀏覽器封咗個咪/);
  const [x, y] = await center(host);
  await host.mouse.move(x, y); await host.mouse.down(); await host.waitForTimeout(150); await host.mouse.up();
  await host.waitForSelector('#permitGuide', { state: 'visible' });
  assert.equal(await gum(host), before, 'no request once blocked: it would fail without a prompt');
  assert.equal(await host.evaluate(() => PTT.turn), 0);
  noErrors([host]);
});

test('picture guides: each browser, mic and motion, two or three drawn steps (phone screenshots)', async () => {
  const p = await player('老闆', { perm: 'prompt', answers: ['allow'] });
  for (const kind of ['mic', 'motion']) for (const b of ['ios-safari', 'ios-chrome', 'android-chrome', 'other']) {
    await p.evaluate(([k, b]) => showPermitGuide(k, b), [kind, b]);
    const steps = await p.locator('#permitGuide li').count();
    assert.ok(steps >= 2 && steps <= 3, `${kind}/${b}: ${steps} steps`);
    assert.equal(await p.locator('#permitGuide li svg').count(), steps, 'a picture per step');
    await p.screenshot({ path: join(OUT, `permit-guide-${kind}-${b}.png`), fullPage: false });
  }
  assert.equal(await p.evaluate(() => browserKind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1', 5)), 'ios-chrome');
  assert.equal(await p.evaluate(() => browserKind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 5)), 'ios-safari');
  assert.equal(await p.evaluate(ua => browserKind(ua, 5), ANDROID_CHROME), 'android-chrome');
  noErrors([p]);
});

/** iOS's motion request, faked: `answer` 'granted', 'denied' (after a prompt, 400 ms) or 'blocked' (at once). */
function fakeMotion(answer) {
  window.__motion = 0;
  if (!window.DeviceOrientationEvent) window.DeviceOrientationEvent = class extends Event {};
  DeviceOrientationEvent.requestPermission = () => {
    window.__motion++;
    if (answer === 'blocked') return Promise.resolve('denied');
    return new Promise(r => setTimeout(() => r(answer), answer === 'denied' ? 400 : 50));
  };
}
for (const answer of ['granted', 'blocked']) {
  test(`motion (傳菜 tilt): starting the solo 傳菜 lesson asks inside the tap; ${answer === 'granted' ? 'a yes is kept for the tab' : 'a block is kept as denied, and no guide covers the station (the finger plays)'}`, async () => {
    // the 傳菜 lesson shows once the ladder reaches 傳菜's level: a save that got there
    const p = await openGame(browser, srv.url, { device: { ...PHONE, userAgent: IPHONE_SAFARI }, storage: veteran('測試員', ROLES_REACHED), init: `(${fakeMotion})(${JSON.stringify(answer)});` });
    pages.push(p);
    assert.equal(await p.evaluate(() => motionPermit()), 'prompt');
    await p.click('#tutBtn');
    await p.click('#book [data-train="runner"]');
    await p.waitForFunction(() => G && G.running && G.xseat === 'runner');
    assert.equal(await p.evaluate(() => window.__motion), 1, 'asked once, from the tap that started it');
    if (answer === 'granted') {
      await p.waitForFunction(() => motionPermit() === 'granted');
      assert.equal(await p.evaluate(() => sessionStorage.getItem('ckf-motion')), 'granted', 'kept for this tab (the runner page reads it)');
      assert.equal(await guide(p), '');
    } else {
      await p.waitForFunction(() => motionPermit() === 'denied');
      await p.waitForTimeout(200);
      assert.equal(await guide(p), '', 'no guide over the station');
      // the co-op lobby (no station on screen yet) shows it: motionRequest(true)
      await p.evaluate(() => motionRequest(true));
      assert.match(await guide(p), /^motion\//);
    }
    assert.deepEqual(realErrors(p), []);
  });
}

test('motion on a desktop or headless browser (no request function, not Android): unavailable, never a guide', async () => {
  const p = await openGame(browser, srv.url, { device: PHONE, storage: veteran('測試員') });
  pages.push(p);
  assert.equal(await p.evaluate(() => motionPermit()), 'unavailable');
  assert.equal(await p.evaluate(() => motionRequest(true)), 'unavailable');
  assert.equal(await guide(p), '');
  assert.deepEqual(realErrors(p), []);
});
