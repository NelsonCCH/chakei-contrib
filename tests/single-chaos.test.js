// Single player, monkey test: a seeded random player taps whatever is on screen (buttons, the pixel canvases, keys,
// pause / resume) for every station and time slot. Nothing may throw, and the invariants must hold the whole time.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, realErrors, shot } from './helpers/browser.js';
import { openSingle, startShift, run, runToEnd, state, assertClean, ALL_RECIPES } from './helpers/single.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

// The four stations run side by side, each on its own page (one after the other they made this the slowest file).
// The play is lock-step (Bot.run), so how busy the CPU is changes nothing in what the monkeys do or what is checked.
describe('monkey', { concurrency: 4 }, () => {
for (const station of ['waiter', 'kitchen', 'bar', 'till']) {
  test(`monkey at the ${station} station: every time slot and difficulty, random taps, no error, invariants hold`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60, recipes: ALL_RECIPES } });
    let taps = 0;
    for (const [slot, seed] of [['breakfast', 1], ['lunch', 2], ['dinner', 3], ['lunch', 4]]) {
      {
        await page.evaluate(() => Bot.reset());
        await startShift(page, { station, slot, diff: seed === 3 ? 'ace' : seed === 4 ? 'rookie' : 'pro', visitors: true });
        await page.evaluate(s => { CFG.aiErr = .12; CFG.aiBarErr = .05; CFG.aiKitErr = .04; Bot.hook = Bot.monkey(s * 7919 + 13); window.__act = Bot.hook; }, seed);
        // the bar needs its tea before the shop opens: let the bot do that part only
        if (station === 'bar') for (let i = 0; i < 8 && await page.evaluate(() => G.phase !== 'open'); i++) await page.evaluate(() => { const h = Bot.hook; Bot.hook = null; Bot.run(2); Bot.hook = h; });
        for (let i = 0; i < 12; i++) {
          await run(page, 15, { bot: false, every: 1 });
          if (await page.evaluate(() => G.paused)) await page.evaluate(() => document.getElementById('resumeBtn').click());
          if (await page.evaluate(() => !G.running)) break;
        }
        const seen = await page.evaluate(() => window.__act.seen);
        taps += seen.button + seen.canvas + seen.key;
        const v = await page.evaluate(() => { const c = Bot.check(); return c.concat(Bot.violations); });
        assert.deepEqual(v, [], `${station} ${slot} seed ${seed}: invariants`);
        assert.deepEqual(realErrors(page), [], `${station} ${slot} seed ${seed}: page errors`);
        await page.evaluate(() => { Bot.hook = null; });
        if (await page.evaluate(() => G.running)) { await page.evaluate(() => { G.paused = false; document.getElementById('pauseView').hidden = true; closeBoard(); closeSheet(); });   // (on rookie the clock stands still while the price board or a slip is open)
           await runToEnd(page, { bot: false }); }
        await page.click('#homeBtn');
      }
    }
    assert.ok(taps > 3000, 'the monkey really tapped: ' + taps);
    await page.context().close();
  });
}
});
