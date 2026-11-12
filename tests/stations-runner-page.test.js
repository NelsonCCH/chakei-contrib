// 傳菜 runner: the standalone page (site/stations/runner.html) in a headless, muted browser, plus the 1:1 check
// against the original prototype page (/lab/tilt.html): the same floor plans for the same seeds, and the same physics
// trajectory (points, knocks, ball position) under the same scripted tilt. Real presses and synthetic tilt events
// drive the page; what the screen shows is checked against the core's state.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, PHONE, WEBKIT, OUT } from './helpers/browser.js';
import { stationScript, staticServer } from './helpers/stations-sim.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

let srv, browser;
before(async () => { srv = await staticServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

async function open(path, init) {
  const ctx = await browser.newContext({ ...PHONE, locale: 'zh-HK', serviceWorkers: 'block' });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  await page.goto(srv.url + path);
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(OUT, `stations-runner-${name}${WEBKIT ? '-webkit' : ''}.png`) });

// The prototype page is not part of this repo: the check runs only when site/lab/tilt.html is present.
const NO_PROTO = !existsSync(join(import.meta.dirname, '..', 'site', 'lab', 'tilt.html')) && 'needs the original prototype page site/lab/tilt.html';
test('the core makes the prototype\'s floor plans and physics, number for number', { skip: NO_PROTO }, async () => {
  // both run in the same page (engines differ in the last bits of Math.sin / Math.hypot, so node vs WebKit would not)
  const page = await open('/lab/tilt.html');
  await page.addScriptTag({ content: stationScript('runner', "export * from './core'; export { gen } from './maze';", '__core') });
  const out = await page.evaluate(() => {
    const pick = L => ({
      start: L.start, attempts: L.attempts, walls: L.walls.map(w => [w.x0, w.y0, w.x1, w.y1, w.kind, w.hor, w.run]),
      targets: L.targets.map(t => [t.tab, t.hole, t.no, t.len, t.to, t.wind, t.cell.i, t.cell.j]),
      stools: L.stools.map(s => [s.x, s.y, s.r, s.sit, s.col, s.fx, s.fy]), puddles: L.puddles.map(p => [p.x, p.y, p.r, p.seed]),
      walkers: L.walkers.map(w => [w.a, w.b, w.len, w.u, w.dir, w.sp, w.col, w.ph]), rooms: L.rooms,
    });
    const C = window.__core, LAB = window.__lab, plans = [];
    for (const dk of ['rookie', 'pro', 'ace']) for (let k = 0; k < 6; k++) {
      const seed = 1000 + k * 7919 + (dk === 'ace' ? 3 : 0);
      plans.push({ name: `${dk} ${seed}`, mine: JSON.stringify(pick(C.gen(seed, dk))), lab: JSON.stringify(pick(LAB.gen(seed, dk))) });
    }
    // physics: the lab's own fast-forward with a scripted wobbly tilt (it hits walls, customers, knocks out, times out)
    const bot = o => ({ x: 0.85 * Math.sin(o.t * 0.9 + o.seed % 7), y: 0.85 * Math.cos(o.t * 0.55) });
    const snap = (st, r, o) => JSON.stringify({ st, points: r.points, done: r.done, failed: r.failed, crashes: r.crashes, bumps: r.bumps, guest: r.guest, trip: r.trip, ball: o.ball, hp: o.hp, t: o.t });
    const runs = [];
    for (const [dk, seed0, sec] of [['rookie', 11, 70], ['pro', 222, 90], ['ace', 3333, 90]]) {
      LAB.setDiff(dk); LAB.newRun(seed0); LAB.sim(sec, o => bot({ t: o.t, seed: o.lay.seed }), rem => Math.min(2, rem));
      const lab = snap(LAB.G.st, LAB.G.run, LAB.G.o);
      const m = C.runner, s = m.init({ difficulty: dk, seed: seed0, players: 1 }, 's1'), ctx = { t: 0, rng: { next: () => 0.5 }, seat: 's1', byPlayer: false, shared: { t: 0, paused: false } };
      for (let k = 0, n = Math.round(sec / C.DT); k < n && s.st !== 'end'; k++) {
        if (s.st === 'pick') m.command(s, { t: 'pick', n: Math.min(2, C.remaining(s)) }, ctx);
        if (k % 4 === 0) { const c = bot({ t: s.trip.t, seed: s.trip.seed }); m.command(s, { t: 'tilt', x: c.x, y: c.y }, ctx); }
        m.step(s, C.DT, ctx);
      }
      runs.push({ name: `${dk} ${seed0}`, mine: snap(s.st, s.run, s.trip), lab, bumps: s.run.bumps });
    }
    LAB.G.st = 'start';   // stop the prototype's own loop from playing on
    return { plans, runs };
  });
  for (const p of out.plans) assert.equal(p.mine, p.lab, `floor plan ${p.name}`);
  for (const r of out.runs) assert.equal(r.mine, r.lab, `trajectory ${r.name}`);
  assert.ok(out.runs.reduce((a, r) => a + r.bumps, 0) >= 3, 'the scripted tilt really hits things');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('one control: no motion readings, the shift starts on the finger; the first reading switches to tilt', async () => {
  const page = await open('/stations/runner.html');
  await page.click('#bGo');
  await page.waitForFunction(() => window.__st.screen.mode === 'thumb' && window.__st.s);
  assert.equal(await page.isVisible('#ovStart'), false, 'the shift starts at once, nothing waits on a prompt');
  assert.equal(await page.isVisible('#bCal'), false);
  await page.evaluate(() => { const e = new Event('deviceorientation'); Object.defineProperties(e, { alpha: { value: 0 }, beta: { value: 20 }, gamma: { value: 0 } }); window.dispatchEvent(e); });
  await page.waitForFunction(() => window.__st.screen.mode === 'tilt');
  assert.equal(await page.isVisible('#bCal'), true, 'tilt on: 校正 shows');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('ckf-runner-ctl')), 'tilt');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('tilt: synthetic orientation events steer the waiter, a real tap picks, the screen matches the state', async () => {
  // the sensor permission granted (as iOS asks, and as some Chrome builds now ask too)
  const page = await open('/stations/runner.html', () => { if ('DeviceOrientationEvent' in window) DeviceOrientationEvent.requestPermission = async () => 'granted'; });
  // a phone held at 30 degrees: the page calibrates on it, then the bot's wanted tilt is sent as beta / gamma
  await page.evaluate(() => {
    const D2R = Math.PI / 180, base = { b: 30, g: 0 }, k = Math.sin(16 * D2R);
    const cal = { x: Math.sin(base.g * D2R) * Math.cos(base.b * D2R), y: Math.sin(base.b * D2R) };
    const send = (b, g) => { const e = new Event('deviceorientation'); Object.defineProperties(e, { alpha: { value: 0 }, beta: { value: b }, gamma: { value: g } }); window.dispatchEvent(e); };
    window.__drive = setInterval(() => {
      let t = { x: 0, y: 0 };
      const s = window.__st.s;
      if (s && s.st === 'play' && !window.__hold) { const c = window.__st.screen.bot(); if (c && c.t === 'tilt') t = c; }
      const dy = cal.y + t.y * k, b = Math.asin(dy), g = Math.asin((cal.x + t.x * k) / Math.cos(b));
      send(b / D2R, g / D2R);
    }, 16);
  });
  await page.click('#bGo');
  if (!(await page.evaluate(() => 'DeviceOrientationEvent' in window))) {
    // no sensor API (a desktop engine): the finger plays
    await page.waitForFunction(() => window.__st.screen.mode === 'thumb');
    await page.context().close();
    return;
  }
  await page.waitForFunction(() => window.__st.screen.mode === 'tilt' && window.__st.s && window.__st.s.st === 'pick', null, { timeout: 10000 });
  assert.equal(await page.isVisible('#bCal'), true, 'the 校正 button shows in tilt mode');
  // the picker labels are the state's tables
  const nos = await page.evaluate(() => window.__st.s.trip.nos);
  for (let n = 1; n <= 3; n++) assert.equal(await page.textContent(`#pk${n}`), nos.slice(0, n).join('+') + '號');
  await shot(page, 'pick');
  await page.click('#pick button[data-n="1"]');
  await page.waitForFunction(() => window.__st.s.st === 'play', null, { timeout: 10000 });
  // the waiter is drawn where the state says: dark hair at the centre, white jacket on the far side from the trays
  await page.waitForFunction(() => Math.hypot(window.__st.s.tilt.x, window.__st.s.tilt.y) > 0.15, null, { timeout: 10000 });
  const px = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => {
    const s = window.__st.s, b = s.trip.ball, cv = document.querySelector('#board .txl'), r = cv.getBoundingClientRect(), dpr = cv.width / r.width;
    const q = window.__st.screen.screenOf(b.x, b.y), tm = Math.hypot(s.tilt.x, s.tilt.y), ux = s.tilt.x / tm, uy = s.tilt.y / tm;
    const L = window.__st.layout(), cellPx = (r.width / (L.GW + 0.3)) * 0.3;   // about the ball radius in css px
    const at = (x, y) => [...cv.getContext('2d').getImageData(Math.round((x - r.left) * dpr), Math.round((y - r.top) * dpr), 1, 1).data];
    res({ centre: at(q.x, q.y), back: at(q.x - ux * cellPx * 0.75, q.y - uy * cellPx * 0.75) });
  })));
  assert.ok(px.centre.slice(0, 3).every(c => c < 90), `hair at the ball's centre: ${px.centre}`);
  assert.ok(px.back.slice(0, 3).every(c => c > 200), `white jacket behind: ${px.back}`);
  await shot(page, 'play');
  // deliver: the toast shows the state's trip points, the HUD the state's count
  await page.waitForFunction(() => window.__st.s.st === 'toast', null, { timeout: 60000 });
  const res = await page.evaluate(() => ({ r: window.__st.s.trip.result, done: window.__st.s.run.done, pts: window.__st.s.run.points }));
  assert.equal(res.r.del, 1, 'the bot delivered by tilt');
  await page.waitForFunction(() => !document.getElementById('toast').hidden);
  assert.match(await page.textContent('#toast'), new RegExp(`\\+${res.r.pts}`));
  assert.match(await page.textContent('#hs'), new RegExp(`送咗 ${res.done}/6 張 .* ${res.pts}分`));
  await shot(page, 'toast');
  // the rest of the shift fast-forwarded in the page: the end card shows the state's total and stars
  await page.evaluate(() => {
    const { mod } = window.__st, s = window.__st.s;
    for (let i = 0; i < 60 * 900 && s.st !== 'end'; i++) { const ctx = window.__st.screen.ctx(); const c = mod.bot.next(s, ctx); if (c) mod.command(s, c, ctx); mod.step(s, 1 / 60, ctx); }
  });
  await page.waitForFunction(() => !document.getElementById('ovCard').hidden);
  const end = await page.evaluate(() => window.__st.s.run);
  assert.match(await page.textContent('#cardBody'), new RegExp(`總分 ${end.points}`));
  assert.equal(await page.locator('#cardBody .stars').evaluate(e => e.childNodes[0].textContent.length), end.stars);
  await shot(page, 'end');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('finger: a real drag tilts toward the finger, keys 1-3 pick, arrows steer, the menu pauses', async () => {
  const page = await open('/stations/runner.html');
  await page.click('#segDiff button[data-v="rookie"]');
  await page.click('#bGo');
  await page.waitForFunction(() => window.__st.s && window.__st.s.st === 'pick');
  assert.equal(await page.evaluate(() => window.__st.screen.mode), 'thumb', 'no readings: the finger');
  assert.equal(await page.evaluate(() => window.__st.s.dk), 'rookie', 'the difficulty picker sets the shift');
  assert.equal(await page.isVisible('#bCal'), false);
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => window.__st.s.st === 'play', null, { timeout: 5000 });
  const box = await page.locator('#board').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 80, cy, { steps: 6 });
  await page.waitForFunction(() => window.__st.s.in.x > 0.95 && window.__st.s.tilt.x > 0.9);
  await shot(page, 'drag');
  await page.mouse.up();
  await page.waitForFunction(() => Math.abs(window.__st.s.in.x) < 1e-9);
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__st.s.in.y < -0.5);
  await page.keyboard.up('ArrowUp');
  await page.click('#bMenu');
  const c0 = await page.evaluate(() => window.__st.s.clock);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__st.s.clock), c0, 'paused: the shift clock stops');
  await page.click('#bGo');   // same difficulty: the shift continues
  await page.waitForFunction(c => window.__st.s.clock > c, c0);
  assert.equal(await page.evaluate(() => window.__st.s.run.carried.length), 1, 'resumed, not restarted');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
