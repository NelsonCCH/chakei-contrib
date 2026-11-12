// Smoke test of a deployed build (e.g. a preview Worker): headless and muted, read-only apart from one solo
// shift in a fresh browser. Usage: node scripts/smoke-remote.mjs https://<your-worker>.<your-subdomain>.workers.dev
// Checks the home page loads, a solo shift starts and its clock runs, and each new station page loads without errors.
// Screenshots go to tests/out/remote-*.png.
import { launch, openGame, veteran, realErrors, OUT } from '../tests/helpers/browser.js';
import { join } from 'node:path';

const url = process.argv[2];
if (!url || /\/\/chakei\./.test(url)) throw new Error('give the preview URL (never the live chakei)');
const browser = await launch();
const fails = [];
try {
  const page = await openGame(browser, url, {
    storage: veteran('測試員'),
    ready: () => { const v = document.getElementById('startView'); return !!v && !v.hidden && !!document.getElementById('startBtn'); },
  });
  const gate = page.locator('#gatePop');
  await page.addLocatorHandler(gate, async () => { await page.click('#gateLater'); });
  if (await page.locator('#shopBtn').isVisible()) await page.click('#shopBtn');
  await page.click('#stSeg [data-st="waiter"]');
  await page.click('#startBtn');
  await page.waitForFunction(() => !document.getElementById('startView').offsetParent);
  // The boss goal card before the clock starts, when the build has it.
  if (await page.locator('#introGo').isVisible().catch(() => false)) await page.click('#introGo');
  const c0 = await page.textContent('#clock');
  await page.waitForFunction(c => document.getElementById('clock').textContent !== c, c0, { timeout: 15000 });
  await page.screenshot({ path: join(OUT, 'remote-solo.png') });
  const e = realErrors(page);
  console.log(`solo shift: clock runs, ${e.length} errors`);
  if (e.length) fails.push(['solo', e]);
  await page.context().close();

  for (const kind of ['runner', 'roast', 'takeaway', 'party']) {
    const p = await openGame(browser, kind === 'party' ? `${url}/party` : `${url}/stations/${kind}`, { ready: () => document.readyState === 'complete' });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: join(OUT, `remote-${kind}.png`) });
    const err = realErrors(p);
    console.log(`station ${kind}: ${err.length} errors`);
    if (err.length) fails.push([kind, err]);
    await p.context().close();
  }
} finally {
  await browser.close();
}
if (fails.length) { console.error(JSON.stringify(fails, null, 1)); process.exit(1); }
console.log('remote smoke ok');
