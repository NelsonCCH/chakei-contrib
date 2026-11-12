// The game's real levels (src/ui/levels.ts LEVELS and STAR_LINES) for the simulations. ui/levels.ts is a page
// module (it draws, saves, imports the DOM), so it cannot be bundled for Node. The two object literals are plain data
// though: this file cuts them out of the source text, strips the types with esbuild and evaluates them, with the one
// page value they read (ui/menu.ts RECIPES, cut out the same way). A level is then installed in a sim shift the way
// the page's levelEnter does it: the fixed shop's tables (ui/decor.ts useFixedShop, TKINDS caps), the level's difficulty
// on the 熟手 base (levelDiff), its menu (ui/menu.ts menuOpen) and G.level, so PORT.level() answers the kitchen and the
// level's own rules.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const ROOT = join(import.meta.dirname, '..', '..');
const src = f => readFileSync(join(ROOT, 'src', 'ui', f), 'utf8');
/** The text from `start` up to the first `end` after it (inclusive of `start`, exclusive of `end`). */
function cut(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`levels.js: cannot find ${start} .. ${end}`);
  return text.slice(a, b);
}
const js = ts => transformSync(ts.replace(/^export /gm, ''), { loader: 'ts' }).code;

const RECIPES_SRC = js(cut(src('menu.ts'), 'export const RECIPES', '\n// '));
const lv = src('levels.ts');
const LEVELS_SRC = js(cut(lv, 'export const LUNCH_BASE', '/** The star lines a shift'));
// eslint-disable-next-line no-new-func
const made = new Function(`${RECIPES_SRC}\n${LEVELS_SRC}\nreturn { LEVELS, STAR_LINES, RECIPES };`)();

/** Every level of the game, as ui/levels.ts defines it. */
export const LEVELS = made.LEVELS;
/** The per-station solo star lines. */
export const STAR_LINES = made.STAR_LINES;
/** The main ladder first (第 1 關 .. 第 7 關), then the era / old / classic levels, the festival and 修羅場, by number. */
export const LEVEL_ORDER = Object.keys(LEVELS).sort((a, b) => (LEVELS[a].era || LEVELS[a].fest || LEVELS[a].hell ? 1000 : 0) + LEVELS[a].n - ((LEVELS[b].era || LEVELS[b].fest || LEVELS[b].hell ? 1000 : 0) + LEVELS[b].n));

const TKINDS = { booth: 4, small: 2, round: 4 };
const CN = '一二三四五六七八九十'.split('');

/**
 * Installs level `id` in a fresh core before newGame (the tables and the difficulty must be in place when the shift is
 * made). `port` is the sim's ShopPort (core.js simPort): its level() and menuOpen() answer for the level from now on.
 * Returns a function that sets G.level after newGame.
 */
export function installLevel(C, port, id) {
  const L = LEVELS[id];
  if (!L) throw new Error('no level ' + id);
  C.setTABLES(L.lay.tables.map(([kind], i) => ({ name: (CN[i] ?? String(i + 1)) + (kind === 'booth' ? '號卡' : '號枱'), cap: TKINDS[kind], kind })));
  Object.defineProperty(C.DIFFS, 'lv', { value: { ...C.DIFFS.pro, name: L.name, pat: L.pat, gap: L.gap, ...(L.burn ? { burn: L.burn } : {}) }, enumerable: false, configurable: true, writable: true });
  C.setDiff('lv'); C.setSlot(L.slot);
  port.level = x => LEVELS[x];
  port.menuOpen = k => (C.G && C.G.level ? LEVELS[C.G.level].menu.includes(k) : true);
  port.inMyShop = () => false;
  return () => { C.G.level = id; };
}
