// The order slip fits the phone: a player had to scroll the 落單 sheet to reach the drinks and the
// 落單 button at 390x666 (iPhone Chrome with its bars). The original game did the same (measured on the live JS build:
// 90-190 px past the sheet at 390x666), so this is a layout fix, not a regression. With every recipe open (the longest
// menu) and a full table of four saying long orders, at each size and each 市: the sheet does not scroll, the slip, every
// item button and 落單 are on screen, and the buttons stay big enough to press.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, openGame, veteran, realErrors, shot } from './helpers/browser.js';
import { startShift, ALL_RECIPES } from './helpers/single.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

// 390x666 is the primary phone size, 390x844 secondary, 640x900 a wide phone or half a desktop
const SIZES = [[390, 666], [390, 844], [640, 900]];
for (const [w, h] of SIZES) {
  test(`order slip at ${w}x${h}: no scrolling, the slip, every item and 落單 on screen`, { timeout: 120000 }, async () => {
    const p = await openGame(browser, srv.url, { device: { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 600, hasTouch: true },
      storage: veteran('測試員', { stars: 60, recipes: ALL_RECIPES }) });
    for (const slot of ['breakfast', 'lunch', 'dinner']) {
      await startShift(p, { station: 'waiter', slot, diff: 'rookie' });
      await p.evaluate(() => {
        G.paused = true;
        const g = makeGroup(); g.table = 0; g.state = 'order'; g.until = G.t + 100; g.max = 100; G.groups.push(g); bump(); openSheet(g);
        g.lines = Array(4).fill('我要常餐，公仔麵，奶油多士，凍鴛鴦少甜走冰。'); g.size = 4; renderSheet();
      });
      for (let i = 0; i < 5; i++) await p.locator('#sheet [data-add]').nth(i).click();
      const m = await p.evaluate(() => {
        const s = document.getElementById('sheet'), box = el => el.getBoundingClientRect();
        const adds = [...s.querySelectorAll('[data-add]')].map(box), send = box(s.querySelector('.send')), slip = box(s.querySelector('.slip'));
        return { over: s.scrollHeight - s.clientHeight, vh: innerHeight, sendBottom: send.bottom, slipTop: slip.top, slipH: slip.height,
          addBottom: Math.max(...adds.map(r => r.bottom)), addMinH: Math.min(...adds.map(r => r.height)), addMinW: Math.min(...adds.map(r => r.width)) };
      });
      await shot(p, `ui-slip-${slot}-${w}x${h}`);
      const at = `${slot} ${w}x${h} ${JSON.stringify(m)}`;
      assert.ok(m.over <= 1, `the sheet does not scroll: ${at}`);
      assert.ok(m.sendBottom <= m.vh && m.addBottom <= m.vh, `落單 and every item are on screen: ${at}`);
      assert.ok(m.slipTop >= 0 && m.slipH >= 78, `the slip is on screen, two lines at least: ${at}`);
      assert.ok(m.addMinH >= 36 && m.addMinW >= 56, `item buttons stay pressable: ${at}`);
      await p.keyboard.press('Escape');
      await p.click('#pauseBtn'); await p.click('#quitBtn');
      await p.waitForFunction(() => !G || !G.running);
    }
    assert.deepEqual(realErrors(p), []);
    await p.context().close();
  });
}
