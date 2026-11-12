// Checks the preview records playtest timings: a headless, muted solo shift at the bar on the preview, a few
// real taps, then waits past one batch interval so the logger posts. Read the rows afterwards with
// `node scripts/playtest-log.mjs`. Usage: node scripts/smoke-remote-ptlog.mjs https://<your-worker>.<your-subdomain>.workers.dev
import { launch, openGame, veteran } from '../tests/helpers/browser.js';

const url = process.argv[2];
if (!url || /\/\/chakei\./.test(url)) throw new Error('give the preview URL (never the live chakei)');
const browser = await launch();
try {
  const page = await openGame(browser, url, {
    storage: veteran('測試員'),
    ready: () => { const v = document.getElementById('startView'); return !!v && !v.hidden && !!document.getElementById('startBtn'); },
  });
  const gate = page.locator('#gatePop');
  await page.addLocatorHandler(gate, async () => { await page.click('#gateLater'); });
  await page.locator('#ptBtn').waitFor({ timeout: 15000 });
  if (await page.locator('#shopBtn').isVisible()) await page.click('#shopBtn');
  await page.click('#stSeg [data-st="bar"]');
  await page.click('#startBtn');
  await page.waitForFunction(() => !document.getElementById('startView').offsetParent);
  if (await page.locator('#introGo').isVisible().catch(() => false)) await page.click('#introGo');
  // tap whatever bar keys are on screen for a while
  const t0 = Date.now();
  let taps = 0;
  while (Date.now() - t0 < 30000) {
    const keys = page.locator('#app button:visible');
    const n = await keys.count();
    if (n) { await keys.nth(taps % n).click({ timeout: 2000 }).catch(() => {}); taps++; }
    await page.waitForTimeout(400);
  }
  console.log(`tapped ${taps} times over 30 s on the preview; the logger batches every ~20 s`);
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(3000);
  await page.context().close();
} finally {
  await browser.close();
}
