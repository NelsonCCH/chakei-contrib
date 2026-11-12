// Contact sheet: node tests/helpers/sheet.js <out-name> <png-name-prefix>...  -> tests/out/<out-name>.png
// Lays the matching screenshots from tests/out/ side by side so a person can look at them in one image.
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT } from './browser.js';

const [name, ...prefixes] = process.argv.slice(2);
const files = readdirSync(OUT).filter(f => f.endsWith('.png') && !f.startsWith('sheet-') && prefixes.some(p => f.startsWith(p))).sort();
// Inline as data URIs: a page made with setContent may not load file:// images.
const cells = files.map(f => `<figure><img src="data:image/png;base64,${readFileSync(join(OUT, f)).toString('base64')}"><figcaption>${f.replace('.png', '')}</figcaption></figure>`).join('');
const html = `<style>body{margin:0;background:#1d1d1d;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px}figure{margin:0}img{width:100%;display:block}figcaption{color:#ddd;font:13px sans-serif;padding:2px}</style>${cells}`;
const b = await chromium.launch({ args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.setContent(html);
await p.waitForLoadState('networkidle');
await p.screenshot({ path: join(OUT, `sheet-${name}.png`), fullPage: true });
await b.close();
console.log(`sheet-${name}.png: ${files.length} images`);
