// The preview's 試玩 button must never cover the co-op room's header (房號 / 派對夜) or any of its buttons:
// the room's screens at phone size (390 x 844) and at half a desktop (640 x 900), the plain
// room and a party night's lobby. Headless and muted; screenshots go to tests/out/playtest-badge/ (look at them).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './helpers/server.js';
import { launch, openGame, veteran, PHONE, OUT, realErrors } from './helpers/browser.js';

const SHOTS = join(OUT, 'playtest-badge');
mkdirSync(SHOTS, { recursive: true });
let srv, browser;
before(async () => { srv = await startServer({ vars: { PLAYTEST: '1' } }); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const HALF = { viewport: { width: 640, height: 900 } };
/** Every visible box in the room view the badge must stay off: the header and each button. */
const overlaps = page => page.evaluate(() => {
  const b = document.getElementById('ptBtn').getBoundingClientRect(), out = [];
  const hit = r => r.width > 0 && r.height > 0 && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
  for (const el of document.querySelectorAll('#coopView .sh-head, #coopView button, #netBadge')) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (s.visibility !== 'hidden' && s.display !== 'none' && hit(r)) out.push(`${el.id || el.className || el.tagName}: ${el.textContent.trim().slice(0, 20)}`);
  }
  // in the gutter left of the room's content, so scrolling the room never brings a row or a button under it
  const c = document.getElementById('coop').getBoundingClientRect();
  if (b.right > c.left) out.push(`not in the gutter: badge right ${b.right}, content left ${c.left}`);
  return out;
});

for (const [name, device] of [['phone', PHONE], ['half', HALF]]) {
  test(`the 試玩 button is off the room's header and buttons (${name})`, async () => {
    const page = await openGame(browser, srv.url, { device, storage: veteran('測試員') });
    await page.locator('#ptBtn').waitFor();
    await page.click('#coopBtn'); await page.click('#hostBtn');
    await page.locator('#coopView .sh-head').waitFor();
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    await page.screenshot({ path: join(SHOTS, `room-${name}.png`) });
    assert.deepEqual(await overlaps(page), [], 'plain room');
    await page.click('#partyOpen');
    await page.locator('#coop .pty').waitFor();
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    await page.screenshot({ path: join(SHOTS, `party-${name}.png`) });
    assert.deepEqual(await overlaps(page), [], 'party night lobby');
    assert.deepEqual(realErrors(page), []);
    await page.context().close();
  });
}
