// Node-side helpers for the journey auditor (tests/helpers/journey.browser.js).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './server.js';

export const JOURNEY = readFileSync(join(ROOT, 'tests', 'helpers', 'journey.browser.js'), 'utf8');

export const injectJourney = page => page.addScriptTag({ content: JOURNEY });

/** The end card's numbers must be the shop's numbers. */
export async function endCardMatches(page) {
  return page.evaluate(() => {
    const cells = Object.fromEntries([...document.querySelectorAll('#result > div')].map(d => [d.querySelector('span') && d.querySelector('span').textContent, d.querySelector('b') && d.querySelector('b').textContent]));
    const out = [];
    if (cells['營業額'] !== undefined && cells['營業額'] !== '$' + G.revenue) out.push(`end card 營業額 ${cells['營業額']} but the shop took $${G.revenue}`);
    if (cells['嬲走'] !== undefined && cells['嬲走'] !== String(G.angry)) out.push(`end card 嬲走 ${cells['嬲走']} but ${G.angry} left angry`);
    if (cells['蝕咗'] !== undefined && cells['蝕咗'] !== '$' + G.loss) out.push(`end card 蝕咗 ${cells['蝕咗']} but the loss is $${G.loss}`);
    if (cells['埋咗單'] !== undefined && cells['埋咗單'] !== G.paidCount + ' 枱') out.push(`end card 埋咗單 ${cells['埋咗單']} but ${G.paidCount} paid`);
    if (!Object.keys(cells).length) out.push('no end card');
    return out;
  });
}
