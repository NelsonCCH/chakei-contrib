// The extra seats in real (headless, muted) browsers against a local Worker: a room whose host turns
// on 傳菜, 燒味 and 外賣 in the lobby and sits at 傳菜, with three teammates at the other three. Each phone shows its
// seat's own screen (the station page in the seat view's iframe), and the screen draws the state the phone's seat holds;
// real presses on those screens change that state. A seat dropped is covered by the computer and taken back: through
// the cover button after the phone went away, and by itself after a lost connection comes back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, sleep } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, realErrors, shot, roomFastForward, roomDbg } from './helpers/browser.js';

let srv, browser;
const pages = [];
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

async function player(nick) { const p = await openGame(browser, srv.url, { storage: veteran(nick, ROLES_LEARNED) }); pages.push(p); return p; }
async function joinAs(p, code, st, host) {
  await p.click('#coopBtn');
  await p.fill('#roomIn', code);
  await p.click('#joinBtn');
  await p.waitForFunction(k => NET.meta && (NET.meta.extra || []).includes(k), st);
  await p.click(`#coop [data-seat="${st}"]`);
  await host.waitForFunction(s => Object.values(NET.seats).some(x => x.station === s), st);
}
/** The seat screen's frame (site/stations/<kind>.html?seat) once its test handle is there. */
async function seatFrame(p, kind) {
  let f = null;
  for (let i = 0; i < 100 && !f; i++) { f = p.frames().find(x => new RegExp(`/stations/${kind}(\\.html)?\\?seat`).test(x.url())) || null; if (!f) await sleep(100); }
  assert.ok(f, `${kind}: the seat screen is loaded`);
  await f.waitForFunction(k => (k === 'roast' || k === 'takeaway' ? window.__station : window.__st) !== undefined, kind);
  return f;
}
/** Does the seat screen draw the very state object this phone's seat holds? */
const drawsSeat = (f, kind) => f.evaluate(k => {
  const s = k === 'roast' || k === 'takeaway' ? window.__station.s : window.__st.s;
  return s !== null && s === window.parent.__chakeiSeat.state(k);
}, kind);
const seatState = (p, kind) => p.evaluate(k => JSON.parse(JSON.stringify(window.__chakeiSeat.state(k))), kind);
/** A tap at logical point (x, y) of a seat screen's scene (roast, takeaway): the iframe's place plus the canvas's. */
async function tapScene(p, f, x, y) {
  const box = await p.locator('#seatFrame').boundingBox(), g = await f.evaluate(() => ({ c: window.__station.canvas(), S: window.__station.S }));
  await p.mouse.move(box.x + g.c.left + x * g.S, box.y + g.c.top + y * g.S); await p.mouse.down(); await sleep(60); await p.mouse.up(); await sleep(150);
}
const roles = p => p.evaluate(() => ({ ...G.roles }));
async function closeAll() { for (const p of pages.splice(0)) { try { await p.context().close(); } catch {} } }


// The room with the four extra seats on phones (the host at 傳菜) is gone: 傳菜 and 外賣 are 樓面's tasks, not seats, outside a party round (the
// lobby offers no such seat; tests/sim/coop-extras.test.js plays phones at them in a party round). The floor's co-op side
// is tests/coop-floor.test.js and tests/strip-roles.test.js.
test('the default room has no extra seats: 樓面1, 樓面2 and the shop\'s three, no seat view (屋邨 runs the floor)', { timeout: 60000 }, async () => {
  const host = await player('老闆'), bar = await player('阿明');
  await host.click('#coopBtn'); await host.click('#hostBtn');
  await host.waitForFunction(() => NET.t && NET.t.up && NET.code);
  const code = await host.evaluate(() => NET.code);
  await bar.click('#coopBtn'); await bar.fill('#roomIn', code); await bar.click('#joinBtn');
  await bar.waitForFunction(() => NET.meta);
  const seats = await bar.evaluate(() => [...document.querySelectorAll('#coop .seats li b')].map(b => b.textContent));
  assert.deepEqual(seats, ['樓面1', '樓面2', '廚房', '水吧', '收銀'], '樓面 has two places, each a seat');
  await bar.click('#coop [data-seat="bar"]');
  await host.waitForFunction(() => Object.values(NET.seats).some(x => x.station === 'bar'));
  await host.click('#hostGo');
  await bar.waitForFunction(() => G && G.running && G.roles.bar === 'me', null, { timeout: 15000 });
  assert.deepEqual(await host.evaluate(() => [G.extra ?? null, !!G.floor, G.roles.floor]), [null, true, 'me']);
  for (const p of [host, bar]) assert.equal(await p.isVisible('#seatView'), false);
  assert.equal(await bar.isVisible('#barView'), true);
  for (const p of [host, bar]) assert.deepEqual(realErrors(p), []);
  await closeAll();
});
