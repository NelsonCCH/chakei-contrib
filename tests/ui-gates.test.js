// Unlock cards (gates): the yellow "新嘢解鎖" card that pops up on the home screen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { world, open, done, text, sleep } from './helpers/ui.js';
import { WEBKIT } from './helpers/browser.js';

let w;
before(async () => { w = await world(); });
after(async () => { await w.stop(); });

test('unlock card: a press that began before the card appeared does not press 去睇吓 / 遲啲 under the finger (L5)', async () => {
  // Several unlocks are due, so the first card (自己間舖) pops up ~400 ms after the home screen draws.
  const seed = { shifts: 5, stars: 12, servedTotal: 120, tutDone: { waiter: 1, bar: 1, kitchen: 1, till: 1 }, nick: 'x', t: 1, levels: { estate: 3, central: 3 }, gates: [] };
  const p = await open(w, { 'ckf-shop': JSON.stringify(seed) });
  await p.waitForSelector('#gatePop');
  const title = await text(p, '#gatePop h2');
  const step = () => p.evaluate(() => document.querySelector('.home').dataset.step);
  const step0 = await step();
  const cdp = WEBKIT ? null : await p.context().newCDPSession(p);
  if (cdp) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const id of ['gateGo', 'gateLater']) {
    const pt = await p.evaluate(i => { const r = document.getElementById(i).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id);
    // Take the card down (and forget it was shown) so it can come up again under a finger that is already down. The home
    // screen may still have a gatePop timer pending (it re-renders after load), which would put the card back before
    // the finger goes down: take it down again until nothing comes back for longer than that 400 ms delay.
    for (let i = 0; ; i++) {
      await p.evaluate(() => { const g = document.getElementById('gatePop'); if (g) { g.remove(); SHOP.gates.pop(); } });
      await sleep(700);
      if (!(await p.locator('#gatePop').count())) break;
      assert.ok(i < 5, 'the unlock card keeps coming back by itself');
    }
    const popUp = async () => { await p.evaluate(() => gatePop()); await p.waitForSelector('#gatePop'); };
    if (cdp) {
      // Real touch input through the DevTools protocol: finger down on the home screen, the card appears, finger up.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
      await popUp();
      await sleep(600);   // the press itself lasts 600 ms: that is the scenario, not a wait for the game
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      // WebKit has no touch injection here: replay what a touch does - pointerdown on what is under the finger, then
      // (600 ms later) pointerup and click on whatever is under the finger by then.
      await p.evaluate(([x, y]) => document.elementFromPoint(x, y).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true })), [pt.x, pt.y]);
      await popUp();
      await sleep(600);
      await p.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true })); el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 })); }, [pt.x, pt.y]);
    }
    // Two frames so a wrongly accepted click would have shown.
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.equal(await p.locator('#gatePop').count(), 1, `#${id}: the card stays up for a choice`);
    assert.equal(await text(p, '#gatePop h2'), title, `#${id}: the same card`);
    assert.equal(await step(), step0, `#${id}: the home screen did not move`);
  }
  // A tap that starts on the card still works.
  await p.click('#gateGo');
  await sleep(100);
  assert.equal(await step(), 'shop', '去睇吓 leads to the shop');
  await done(p);
});
