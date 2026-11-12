// The goal card before a shift: 開工 / 再做一次 / 做埋下一更 / 接受挑戰 show it first, and the clock only starts
// when the player taps 開工！. Tutorial, levels and co-op go straight in. go() clicks the button, then the card if it came up.

/** Clicks `sel` and gets past the goal card if one shows, so the shift is running when it returns. An unlock pop-up
 *  that comes up meanwhile (at a time that depends on the engine's speed) is answered 遲啲, as a player would. */
export async function go(page, sel) {
  const gate = page.locator('#gatePop');
  await page.addLocatorHandler(gate, async () => { await page.click('#gateLater'); });
  try {
    await page.click(sel);
    await page.waitForFunction(() => { const v = document.getElementById('introView'); return (v && !v.hidden) || (typeof G !== 'undefined' && G && G.running); });
    if (await page.evaluate(() => { const v = document.getElementById('introView'); return !!v && !v.hidden; })) await page.click('#introGo');
  } finally {
    await page.removeLocatorHandler(gate);
  }
}
