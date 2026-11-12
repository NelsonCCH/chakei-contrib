// The four extra seats reached the way a player reaches them, in real (headless, muted) browsers
// against a local Worker: the host turns the seat on in the 組隊 lobby's 加位 row, a teammate picks it with 坐呢度 (or
// the host sits there with 我坐呢度, alone in the room), the shift starts with 全部人開工, and that phone lands on the
// station's own screen with the HUD saying which seat it holds. Then one real job is done there with real presses
// (the station's own bot only chooses where to press next, on a copy of the state, so it never touches the game) and
// the shop's state shows it: a table's food leaves the pass, a roast order is paid, a
// takeaway bag is handed over. It also covers a path seen in play: the host turns 傳菜 on without sitting there,
// lands on the floor, and the strip's 換做傳菜 takes them to the runner's screen (and 返做伙記 back).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, sleep } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, realErrors, shot, roomFastForward, roomDbg } from './helpers/browser.js';
import { stationScript } from './helpers/stations-sim.js';

let srv, browser;
const pages = [];
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });
async function closeAll() { for (const p of pages.splice(0)) { try { await p.context().close(); } catch {} } }

const NAME = { runner: '傳菜', roast: '燒味', takeaway: '外賣' };
async function player(nick) { const p = await openGame(browser, srv.url, { storage: veteran(nick, ROLES_LEARNED) }); pages.push(p); return p; }
const SHOP = { waiter: '伙記', till: '收銀' };
/** The host opens a room at shop station `st` on a level that has extra seat `kind` (the 加位 row is gone;
 *  燒味 belongs to the levels that have it, 年廿八 here). */
async function openRoom(kind, st = 'waiter') {
  const host = await player('老闆');
  await host.evaluate(s => { station = s; saveSet('ckf-station', s); buildMenus(); }, st);
  await host.click('#coopBtn'); await host.click('#hostBtn');
  await host.waitForFunction(() => NET.t && NET.t.up && NET.code);
  await host.evaluate(() => { NET.level = 'newyear'; pushMeta('lobby'); renderCoop(); });
  await host.waitForFunction(k => NET.meta.extra.includes(k), kind);
  // turning a seat on does not sit you there: the host still holds their station, and the lobby says so
  assert.match(await host.textContent('#youDo'), new RegExp(`你開工做：${SHOP[st]}`));
  assert.match(await host.textContent('#coop .seats li.mine'), new RegExp(`${SHOP[st]}.*（你）`));
  return host;
}
/**
 * A teammate joins and picks extra seat `kind` with its 坐呢度 button; the host starts the shift. The host sits at the
 * till, which the test leaves idle: the computer waiter then seats, orders and clears tables, so work reaches the seat.
 */
async function teammateAt(kind) {
  const host = await openRoom(kind, 'till'), code = await host.evaluate(() => NET.code), mate = await player('阿明');
  await mate.click('#coopBtn'); await mate.fill('#roomIn', code); await mate.click('#joinBtn');
  await mate.waitForSelector(`#coop [data-seat="${kind}"]`);
  await mate.click(`#coop [data-seat="${kind}"]`);
  await host.waitForFunction(k => Object.values(NET.seats).some(s => s.station === k), kind);
  assert.match(await mate.textContent('#coop .seats li.mine'), new RegExp(`${NAME[kind]}.*（你）`), 'the lobby lights the picked seat');
  await host.click('#hostGo');
  await mate.waitForFunction(k => G && G.running && G.roles[k] === 'me', kind, { timeout: 15000 });
  return { host, mate };
}
/** The phone shows extra seat `kind`'s own screen (not the shop's) and the HUD names it; returns the screen's frame. */
async function onSeatScreen(p, kind) {
  await p.waitForFunction(() => !document.getElementById('seatView').hidden);
  assert.equal(await p.isVisible('#seatView'), true, `${kind}: the seat view`);
  for (const el of ['#floorWrap', '#barView', '#kitView', '#till']) assert.equal(await p.isVisible(el), false, `${kind}: not ${el}`);
  await p.waitForFunction(n => document.getElementById('xStrip').textContent.includes(`你做${n}`), NAME[kind]);
  let f = null;
  for (let i = 0; i < 100 && !f; i++) { f = p.frames().find(x => new RegExp(`/stations/${kind}(\\.html)?\\?seat`).test(x.url())) || null; if (!f) await sleep(100); }
  assert.ok(f, `${kind}: the seat screen is loaded`);
  await f.waitForFunction(k => (k === 'roast' || k === 'takeaway' ? window.__station : window.__st) !== undefined && window.parent.__chakeiSeat.state(k) !== null, kind);
  // the screen covers the seat view, and draws the very state this phone's seat holds
  const fb = await p.locator('#seatFrame').boundingBox(), vb = await p.locator('#seatView').boundingBox();
  assert.ok(fb && vb && fb.height > 300 && Math.abs(fb.height - vb.height) < 2, `${kind}: the screen fills the seat view (${JSON.stringify(fb)})`);
  assert.equal(await f.evaluate(k => (k === 'roast' || k === 'takeaway' ? window.__station.s : window.__st.s) === window.parent.__chakeiSeat.state(k), kind), true);
  return f;
}

/* ---------- one real job at each station ---------- */

/** 傳菜: a real tap on 1張, then the thumb held on the board and steered (the bot says which way) until the table has it. */
async function runOneTable(p, f) {
  await f.waitForSelector('#pick:not([hidden]) button[data-n="1"]:not([disabled])', { timeout: 60000 });
  const done0 = await f.evaluate(() => window.__st.s.run.done);
  await f.click('#pick button[data-n="1"]');
  await f.waitForFunction(() => window.__st.s.st === 'play');
  const b = await f.locator('#board').boundingBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await p.mouse.move(cx, cy); await p.mouse.down();
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const c = await f.evaluate(() => { const s = window.__st.s; if (!s || s.st !== 'play') return { end: true }; return window.__st.screen.bot(); });
    if (c && c.end) break;
    if (c && c.t === 'tilt') await p.mouse.move(cx + c.x * 60, cy + c.y * 60);   // TUNE.dragR: 60 css px is a full tilt
  }
  await p.mouse.up();
  await f.waitForFunction(d => window.__st.s.run.done > d, done0, { timeout: 10000 });
}
/** 燒味 / 外賣: the station bot's next gesture, planned on a copy of the state, pressed with the real mouse. */
async function gesture(p, f, kind) {
  const box = await p.locator('#seatFrame').boundingBox();
  const g = await f.evaluate(k => {
    const st = window.__station; if (!st.s) return null;
    const s = structuredClone(st.s), c = st.canvas();
    return { steps: window.__plan.plan(s, window.__plan.seededRng((Math.random() * 2 ** 31) | 0)), c, S: st.S, tie: k === 'takeaway' && s.phase === 'tie' && s.t > s.tie.readyAt ? st.layout.pts : null };
  }, kind);
  if (!g) return false;
  const at = (x, y) => [box.x + g.c.left + x * g.S, box.y + g.c.top + y * g.S];
  if (g.tie) {   // 外賣's tie: trace the dashed path (css px), as the page test does
    const pts = g.tie, px = q => [box.x + g.c.left + q[0], box.y + g.c.top + q[1]];
    await p.mouse.move(...px(pts[0])); await p.mouse.down();
    for (let i = 4; i < pts.length; i += 4) await p.mouse.move(...px(pts[i]));
    await p.mouse.move(...px(pts[pts.length - 1])); await p.mouse.up();
    return true;
  }
  if (!g.steps.length) return false;
  for (const { cmd, wait } of g.steps) {
    if (cmd.k === 'down') { await p.mouse.move(...at(cmd.x, cmd.y)); await p.mouse.down(); }
    else if (cmd.k === 'move') await p.mouse.move(...at(cmd.x, cmd.y));
    else if (cmd.k === 'up') { await p.mouse.move(...at(cmd.x, cmd.y)); await p.mouse.up(); }
    if (wait > 0.03) await sleep(wait * 1000);
  }
  return true;
}
async function playUntil(p, f, kind, done, ms) {
  await f.addScriptTag({ content: stationScript(kind, "export { plan } from './bot'; export { seededRng } from '../contract';", '__plan') });
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await f.evaluate(done)) return;
    if (!(await gesture(p, f, kind))) await sleep(200);
  }
  assert.fail(`${kind}: the job was not done in ${ms / 1000} s`);
}

/* ---------- the journeys ---------- */




// The 傳菜 runs (a teammate, the host alone, 加位 then 換做傳菜) and the 外賣 teammate run are gone: 傳菜 and 外賣 are 樓面's tasks, not seats, outside a party round (the
// lobby offers no such seat; tests/sim/coop-extras.test.js plays phones at them in a party round). The floor's co-op side
// is tests/coop-floor.test.js and tests/strip-roles.test.js.
// The 洗碗 teammate run went with the seat.
test('燒味, a teammate: lands on the roast counter, makes an order with real gestures, and the shop takes its money', { timeout: 240000 }, async () => {
  const { host, mate } = await teammateAt('roast');
  const f = await onSeatScreen(mate, 'roast');
  await mate.waitForFunction(() => window.__chakeiSeat.state('roast').q.length > 0, null, { timeout: 60000 });
  // the front order's line on the host (the shop): its money comes in when the station hands the plate over
  const { gid, i } = await mate.evaluate(() => { const c = window.__chakeiSeat.state('roast').q[0]; return { gid: c.gid, i: c.i }; });
  // the host's G is a copy of the room's referee that each keyframe replaces: follow the line by id
  await host.evaluate(([gid, i]) => {
    const rev0 = G.revenue; window.__line = { last: null, gone: false, rev0 };
    const iv = setInterval(() => {
      const g = G.groups.find(x => x.id === gid);
      if (g) window.__line.last = { ...g.roast[i] }; else { window.__line.gone = true; clearInterval(iv); }
    }, 2);
  }, [gid, i]);
  await playUntil(mate, f, 'roast', () => window.__station.s.served >= 1, 120000);
  const clean = await f.evaluate(() => window.__station.s.cleanCuts);
  assert.ok(clean >= 1, `cut on the guides through the seat link: ${clean}`);
  // made right and paid for (the group may leave in the same keyframe that marks the line, so its going counts too)
  await host.waitForFunction(() => { const L = window.__line; return (L.gone || (L.last && L.last.done && L.last.ok)) && G.revenue > L.rev0; }, null, { timeout: 15000 });
  assert.equal(await mate.evaluate(() => phone().stats.nacked), 0, 'the referee took every roast result');
  await shot(mate, 'journey-extras-roast');
  for (const p of [host, mate]) assert.deepEqual(realErrors(p), []);
  await closeAll();
});

