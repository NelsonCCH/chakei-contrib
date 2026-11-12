// A fix from play: when 旺場 started, the whole game squeezed left on a 390x666 phone viewport with a
// wide green band on the right and 暫停 pushed out of frame, back to normal when the fever ended; the takings read
// $377.0999999999997. A solo 外賣 level on a phone, the fever forced on, the takings set to that float: the page must not
// overflow sideways, the app must fill the viewport width, 暫停 must sit inside the frame, and no money on screen may
// show more than two decimals. Also at half-width desktop (~640x900).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startServer } from './helpers/server.js';
import { launch, openGame, veteran, OUT, ROLES_REACHED } from './helpers/browser.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const SAVE = { tutDone: { waiter: 1, bar: 1, kitchen: 1, till: 1, takeaway: true }, ...ROLES_REACHED };
const PHONE_666 = { viewport: { width: 390, height: 666 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const HALF = { viewport: { width: 640, height: 900 } };

/** Every money string on screen (main page and the seat's frame): `$` then a number. */
const moneyOnScreen = page => page.evaluate(() => {
  const txt = [document.body.innerText];
  const f = document.getElementById('seatFrame');
  try { if (f && f.contentDocument) txt.push(f.contentDocument.body.innerText); } catch { /* cross-origin: none here */ }
  return txt.join('\n').match(/\$\s?-?[\d,]+(\.\d+)?/g) ?? [];
});

/** Layout facts: page width vs viewport, the app's and the HUD's right edges, 暫停's box. */
const layout = page => page.evaluate(() => {
  const r = el => { const b = document.getElementById(el)?.getBoundingClientRect(); return b ? { l: b.left, r: b.right, w: b.width } : null; };
  const hud = document.querySelector('.hud').getBoundingClientRect();
  return { vw: window.innerWidth, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, app: r('app'), hudR: hud.right, hudSW: document.querySelector('.hud').scrollWidth, hudW: hud.width, pause: r('pauseBtn'), heat: !document.getElementById('heat').hidden, rev: document.getElementById('rev').textContent };
});

for (const [name, device] of [['phone 390x666', PHONE_666], ['half-width 640x900', HALF]]) {
  test(`旺場 on a solo 外賣 level (${name}): no sideways overflow, 暫停 in frame, takings in whole dollars`, async () => {
    const page = await openGame(browser, srv.url, { device, storage: { ...veteran('測試員', SAVE), 'ckf-view': 'simple' } });
    await page.click('#levelBtn');
    await page.click('#lvSt [data-st="takeaway"]');
    await page.click('#book [data-lv="airport"]');
    await page.waitForFunction(() => G && G.running && G.xseat === 'takeaway');
    await page.frameLocator('#seatFrame').locator('canvas').first().waitFor();
    const before = await layout(page);
    // the fever now, and takings with float noise, as the phone showed them
    await page.evaluate(() => { G.feverAt = G.t + .5; G.revenue = 377.0999999999997; G.tips = 16.1; });
    await page.evaluate(() => { for (let i = 0; i < 40; i++) shiftStep(.05); });
    await page.waitForFunction(() => !document.getElementById('heat').hidden);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const during = await layout(page);
    const tag = name.startsWith('phone') ? 'phone' : 'half';
    await page.screenshot({ path: join(OUT, `fever-layout-${tag}.png`) });
    assert.equal(during.heat, true, 'the fever is on');
    assert.ok(during.sw <= during.vw, `no sideways overflow during the fever: page ${during.sw}px wide in a ${during.vw}px viewport`);
    assert.ok(during.hudSW <= Math.ceil(during.hudW), `the HUD's content fits it: ${during.hudSW} > ${during.hudW}`);
    assert.equal(during.vw, device.viewport.width, 'the browser did not widen the page (a phone zooms out to fit an overflow)');
    assert.ok(Math.abs(during.app.l - (during.vw - during.app.r)) < 1, `the app fills the viewport width (even gutters): ${JSON.stringify(during.app)} in ${during.vw}`);
    assert.ok(Math.abs(during.app.w - before.app.w) < 1, 'the app keeps its width when the fever starts');
    assert.ok(during.pause.l >= 0 && during.pause.r <= during.app.r, `暫停 inside the frame: ${JSON.stringify(during.pause)} in ${during.vw}`);
    assert.equal(during.rev, '$377', 'the takings in whole dollars');
    for (const m of await moneyOnScreen(page)) assert.doesNotMatch(m, /\.\d{3,}/, `money with more than two decimals on screen: ${m}`);
    // a big honest number in the fever still leaves 暫停 in the frame (the heat bar gives way, then the stats clip)
    await page.evaluate(() => { G.revenue = 98765; paintHud(); });
    const big = await layout(page);
    await page.screenshot({ path: join(OUT, `fever-layout-${tag}-big.png`) });
    assert.ok(big.vw === device.viewport.width && big.sw <= big.vw, `no overflow with $98765: ${JSON.stringify(big)}`);
    assert.ok(big.pause.l >= 0 && big.pause.r <= big.app.r, `暫停 still in frame with $98765: ${JSON.stringify(big.pause)}`);
    // the end card and the money booked from it (level pay, savings) read whole dollars too
    await page.evaluate(() => { G.revenue = 377.0999999999997; CFG.gameSec = G.t + .2; for (let i = 0; i < 400 && G.running; i++) shiftStep(.05); });
    await page.waitForFunction(() => !document.getElementById('endView').hidden);
    const end = await moneyOnScreen(page);
    assert.ok(end.length > 0, 'the end card shows money');
    for (const m of end) assert.doesNotMatch(m, /\.\d{3,}/, `money with more than two decimals on the end card: ${m}`);
    assert.equal(await page.evaluate(() => Number.isInteger(SHOP.bank)), true, 'the shop banks whole dollars');
    await page.context().close();
  });
}
