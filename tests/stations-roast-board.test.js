// The 燒味 board on a 390x666 phone viewport on the standalone page in a real headless
// browser: the roast sits in the middle of the board (叉燒 and 燒肉, screenshots), an uncut roast dragged up from the end
// that goes back (剩) hangs back on the rail, and a 燒肉 slab left with a stale finger down (the computer mid-chop when the
// player took the seat back: before, every press was ignored) is chopped by taps on its guides and then dragged back up.
// Silent: headless, --mute-audio, the page's sound stays off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, OUT, PHONE } from './helpers/browser.js';
import { startStatic, openStation } from './helpers/static.js';
import { join } from 'node:path';

let srv, browser;
before(async () => { srv = await startStatic(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const P666 = { ...PHONE, viewport: { width: 390, height: 666 } };
const st = page => page.evaluate(() => JSON.parse(JSON.stringify({ s: window.__station.s, L: window.__station.layout, S: window.__station.S, c: window.__station.canvas() })));
const guides = b => Array.from({ length: b.n }, (_, i) => b.x0 + (i + 1) * b.w);

test('燒味 board at 390x666: roasts centred; taps chop a 燒肉 slab even with a stale finger; drag up hangs it back', async () => {
  const page = await openStation(browser, srv.url, { path: '/stations/roast.html', device: P666 });
  await page.click('#segDiff button[data-v="rookie"]');
  await page.click('#bGo');
  await page.waitForFunction(() => window.__station.s && window.__station.s.q.length > 0);
  let g = await st(page);
  const L = g.L, at = (x, y) => [g.c.left + x * g.S, g.c.top + y * g.S];
  const tap = async (x, y) => { await page.mouse.move(...at(x, y)); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); await page.waitForTimeout(120); };
  const drag = async (x0, y0, x1, y1, steps = 12) => { await page.mouse.move(...at(x0, y0)); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(...at(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)); await page.waitForTimeout(16); } await page.mouse.up(); await page.waitForTimeout(150); };
  const pull = async k => { await drag(L.hooks.find(h => h.k === k).x, L.rail.y + L.rail.h / 2, L.board.x + L.board.w / 2, L.board.y + L.board.h / 2); await page.waitForFunction(() => window.__station.s.board && window.__station.s.board.drop <= 0); return (await st(page)).s.board; };
  const centred = (b, what) => { const mid = (b.x0 + b.x1) / 2, bc = L.board.x + L.board.w / 2; assert.ok(Math.abs(mid - bc) <= 0.5, `${what}: roast centre ${mid} vs board centre ${bc}`); };
  // the grab point for the return: on the leftover end (剩), clear of every guide, low on the roast
  const restX = b => (guides(b).at(-1) + b.x1) / 2 + 2, lowY = b => L.meatCy + b.h * 0.3, railY = L.rail.y + L.rail.h / 2;
  assert.ok(g.c.width >= 380 && g.c.height <= 666, `the scene fills the phone: ${g.c.width}x${g.c.height}`);

  // 叉燒 (the first order is always a 叉燒飯): centred on the board
  const bc = await pull('char');
  centred(bc, '叉燒');
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, 'stations-roast-board-char-390x666.png') });
  // dragged up from 剩 onto the rail, it hangs back
  await drag(restX(bc), lowY(bc), restX(bc), railY);
  g = await st(page);
  assert.equal(g.s.board, null, '叉燒 hung back'); assert.equal(g.s.cuts, 0, 'nothing cut');

  // the front customer now wants 燒肉飯 (as in a 晚市 shift seen in play)
  await page.evaluate(() => { const c = window.__station.s.q[0]; c.ord = { ...c.ord, name: '燒肉飯', item: '燒肉飯', meats: ['pork'], pcs: [6], ginger: false }; });
  let b = await pull('pork');
  assert.equal(b.k, 'pork'); assert.equal(b.n, 6);
  centred(b, '燒肉');
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, 'stations-roast-board-pork-390x666.png') });
  // uncut, it goes back up the same way, and comes down again
  await drag(restX(b), lowY(b), restX(b), railY);
  assert.equal((await st(page)).s.board, null, '燒肉 hung back');
  b = await pull('pork');

  // the soft lock: a finger left down on the state (the computer was mid-chop when the seat came back to the player)
  await page.evaluate(() => { const F = window.__station.s.f; F.down = true; F.mode = 'done'; });
  for (const [i, x] of guides(b).entries()) {
    await tap(x, L.meatCy);
    g = await st(page);
    assert.equal(g.s.board.cuts.length, i + 1, `tap ${i + 1} on the 燒肉 chops it (cuts ${g.s.board.cuts})`);
  }
  assert.deepEqual(g.s.board.cuts, guides(b), 'every cut on its guide');
  await page.screenshot({ path: join(OUT, 'stations-roast-board-pork-cut-390x666.png') });
  // cut, the pieces dragged up onto the rail take the whole roast back too
  await drag(b.x0 + b.w / 2, lowY(b), b.x0 + b.w / 2, railY);
  g = await st(page);
  assert.equal(g.s.board, null, 'the cut 燒肉 hung back');
  assert.equal(g.s.restBack?.b.k, 'pork');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
