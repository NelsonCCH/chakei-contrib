// Builds the TypeScript sources into the static site.
// The game: every src/<name>.ts is an ES module; esbuild bundles them into one classic script, site/js/app.js, which
// index.html loads (bump its ?v= cache version with each release). Two flavours of the same bundle:
//   test (default; npm test builds it first): src/entry-test.ts = the game + src/test-surface.ts, which puts the old
//        page globals back for the Playwright tests; not minified, with a source map (site/js/app.js.map).
//   prod (--prod; npm run build:prod, which npm run deploy runs): src/entry.ts = the game only; minified, no source map,
//        no test surface, so nothing the game defines is reachable from the page's global scope.
// Generated files are git-ignored. Every build also checks the load order (src/entry.ts).
// Usage: node scripts/build.mjs [--prod] [--out <site dir>]
//   --out writes the page's files (js/app.js, sw.js) into a copy of site/ and skips the Worker, which every test server
//   shares (tests/helpers/server.js builds prod into its own copy this way). Default: site/ and the Worker.
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, posix, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { buildSync, transformSync } from 'esbuild';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
// Syntax floor: iOS 15 Safari; the type checker's lib setting guards the built-in APIs.
const TARGET = ['safari15', 'chrome100', 'firefox100'];
const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const oi = args.indexOf('--out');
const SITE = oi >= 0 ? args[oi + 1] : join(ROOT, 'site');
const OUT = join(SITE, 'js');

// The load order the modules declare: each module's first import is the bare import of the module before it.
// Modules are named by their path under src/ without .ts ('ui/main', 'net/net').
function chainOrder() {
  const order = [];
  for (let m = 'ui/main'; m; ) {
    if (order.includes(m)) throw new Error(`load-order chain loops at src/${m}.ts`);
    order.unshift(m);
    const first = readFileSync(join(SRC, `${m}.ts`), 'utf8').match(/^import\b[^;]*;/m);
    const bare = first && first[0].match(/^import '(\.\.?\/[\w/-]+)';$/);
    // No bare first import: the head of the chain (taste). A module cut off by a wrong first import fails the check below.
    m = bare ? posix.join(posix.dirname(m), bare[1]) : null;
  }
  return order;
}
const ORDER = chainOrder();
// Outside the chain: the entry points, the hook table, src/stations-next/ (own page bundles, below), and src/core/ (the shop's rules, which have no top-level
// code that depends on load order; they only define constants and functions, so they may run whenever first imported),
// src/ptt/ (push-to-talk: self-contained, touches the page only when net.ts calls pttBind) and src/permit/ (the mic and motion
// permission requests and picture guides: no top-level code that touches the page) and src/playtest/ (the preview's
// 試玩 pace panel: touches the page only when the entry calls playtestBoot).
const OUTSIDE_CHAIN = new Set(['entry', 'entry-test', 'test-surface', 'ui/hooks']);
const walk = d => readdirSync(join(SRC, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(posix.join(d, e.name)) : [posix.join(d, e.name)]);
for (const f of walk('')) {
  const m = f.replace(/\.ts$/, '');
  // src/ui/party/: the party screens, self-contained like ptt/ (mountParty draws only when called); its page has its own bundle (below).
  // src/ver/: the build id and the new-version banner: no top-level code that touches the page (staleBoot does).
  if (!f.endsWith('.ts') || f.endsWith('.d.ts') || f.startsWith('core/') || f.startsWith('sw/') || f.startsWith('ver/') || f.startsWith('stations-next/') || f.startsWith('ptt/') || f.startsWith('permit/') || f.startsWith('playtest/') || f.startsWith('ui/party/') || OUTSIDE_CHAIN.has(m)) continue;
  if (!ORDER.includes(m)) throw new Error(`src/${f} is not in the load-order chain (src/entry.ts)`);
}

// The build id (stale build hardening): the git commit and the build time. The page carries it (__BUILD_ID__,
// src/ver/stale.ts) and site/version.json serves it, so a page from an older build sees a newer one is up and offers a
// reload; the 試玩 panel shows it.
const BUILD_ID = (() => {
  let hash = 'nogit';
  try { hash = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || hash; } catch { /* not a git checkout */ }
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${hash}-${p(d.getMonth() + 1)}${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
})();
const OPTS = { entryPoints: [join(SRC, PROD ? 'entry.ts' : 'entry-test.ts')], bundle: true, format: 'iife', target: TARGET, charset: 'utf8', legalComments: 'none', write: false, logLevel: 'warning', define: { __BUILD_ID__: JSON.stringify(BUILD_ID) } };
// The modules must run in chain order: checked on an unminified copy of this same bundle, which keeps esbuild's
// `// src/x.ts` marker above each module's code (a marker above `var x_exports = {};` is a namespace object the test
// surface imports, emitted up front, not the module's code; `x_exports2` when core/ has a module of the same name).
{
  const code = buildSync({ ...OPTS, outfile: 'check.js' }).outputFiles[0].text;
  const seen = [...code.matchAll(/^ *\/\/ src\/([\w/-]+)\.ts\n(?! *var [\w$]+_exports\d* = \{\};)/gm)].map(m => m[1]).filter(m => ORDER.includes(m));
  if (seen.join() !== ORDER.join()) throw new Error(`modules run out of order:\n  bundle ${seen.join(' ')}\n  chain  ${ORDER.join(' ')}`);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const res = buildSync({ ...OPTS, outfile: join(OUT, 'app.js'), minify: PROD, sourcemap: PROD ? false : 'linked', metafile: true });
for (const f of res.outputFiles) writeFileSync(f.path, f.contents);
const inputs = Object.keys(res.metafile.inputs).map(p => p.replace(/^src\//, '').replace(/\.ts$/, ''));
for (const m of ORDER) if (!inputs.includes(m)) throw new Error(`src/${m}.ts is missing from the bundle`);
if (PROD === inputs.includes('test-surface')) throw new Error('the test surface belongs in the test build only');
// The outputs are generated, so git must not track them: list them in a .gitignore the build owns (it ignores itself).
writeFileSync(join(OUT, '.gitignore'), ['# Written by scripts/build.mjs: built from src/*.ts.', '/.gitignore', '/app.js', '/app.js.map', ''].join('\n'));
console.log(`built site/js/app.js (${PROD ? 'prod: minified, no test surface' : 'test: with test surface and source map'}): ${ORDER.length} modules in load order, build ${BUILD_ID}`);

// The standalone station pages (playtest before the referee wires them into the shop): each
// src/stations-next/<kind>/page.ts -> site/stations/<kind>.js, loaded by the committed site/stations/<kind>.html.
// STATION_TEST is true in the test build only (a window.__st handle for the Playwright tests).
{
  const SN = join(SRC, 'stations-next'), STO = join(SITE, 'stations'), kinds = [];
  mkdirSync(STO, { recursive: true });
  for (const k of readdirSync(SN, { withFileTypes: true })) {
    if (!k.isDirectory() || !existsSync(join(SN, k.name, 'page.ts'))) continue;
    const r = buildSync({ entryPoints: [join(SN, k.name, 'page.ts')], bundle: true, format: 'iife', target: TARGET, charset: 'utf8', legalComments: 'none', logLevel: 'warning',
      outfile: join(STO, `${k.name}.js`), minify: PROD, sourcemap: PROD ? false : 'linked', define: { STATION_TEST: PROD ? 'false' : 'true' }, write: false });
    rmSync(join(STO, `${k.name}.js.map`), { force: true });
    for (const f of r.outputFiles) writeFileSync(f.path, f.contents);
    kinds.push(k.name);
  }
  writeFileSync(join(STO, '.gitignore'), ['# Written by scripts/build.mjs: built from src/stations-next/<kind>/page.ts.', '/.gitignore', '/*.js', '/*.js.map', ''].join('\n'));
  console.log(`built site/stations/{${kinds.join(',')}}.js`);
}

// The party night playtest page: src/ui/party/page.ts -> site/party.js, loaded by the committed site/party.html.
// STATION_TEST as for the station pages: a window.__party handle in the test build only. git-ignored by site/.gitignore below.
{
  const r = buildSync({ entryPoints: [join(SRC, 'ui', 'party', 'page.ts')], bundle: true, format: 'iife', target: TARGET, charset: 'utf8', legalComments: 'none', logLevel: 'warning',
    outfile: join(SITE, 'party.js'), minify: PROD, sourcemap: PROD ? false : 'linked', define: { STATION_TEST: PROD ? 'false' : 'true' }, write: false });
  rmSync(join(SITE, 'party.js.map'), { force: true });
  for (const f of r.outputFiles) writeFileSync(f.path, f.contents);
  console.log('built site/party.js');
}

// The service worker: src/sw/sw.ts -> site/sw.js, still a classic script (the page registers ./sw.js).
{
  const src = readFileSync(join(SRC, 'sw', 'sw.ts'), 'utf8');
  const out = transformSync(src, { loader: 'ts', target: TARGET, sourcefile: 'src/sw/sw.ts', legalComments: 'none', charset: 'utf8' });
  for (const w of out.warnings) console.warn(`src/sw/sw.ts: ${w.text}`);
  writeFileSync(join(SITE, 'sw.js'), '// GENERATED from src/sw/sw.ts by scripts/build.mjs. Do not edit: change the .ts and run npm run build.\n' + out.code);
  // the build id the page compares its own with (src/ver/stale.ts)
  writeFileSync(join(SITE, 'version.json'), JSON.stringify({ build: BUILD_ID }) + '\n');
  writeFileSync(join(SITE, '.gitignore'), ['# Written by scripts/build.mjs: built from src/sw/sw.ts and src/ui/party/page.ts, and the build id.', '/.gitignore', '/sw.js', '/party.js', '/party.js.map', '/version.json', ''].join('\n'));
}

// The room's referee: src/core/coop/room.ts and everything it imports, bundled into
// worker/room-core.js as one factory, freshCore(), that returns a new copy of every core module on each call. Core keeps
// its state in module variables (G, the referee, the random stream, the clock), and one Worker isolate can host many
// rooms' Durable Objects, so each room calls freshCore() once and keeps its own copy. Plain code, no eval (workerd
// forbids it). worker/room-core.d.ts types what the Worker uses of it.
if (oi < 0) {
  const r = buildSync({ entryPoints: [join(SRC, 'core', 'coop', 'room-worker.ts')], bundle: true, format: 'cjs', platform: 'neutral', target: 'es2022', charset: 'utf8', legalComments: 'none', write: false, logLevel: 'warning' });
  const body = r.outputFiles[0].text;
  if (/\b(?:document|window|localStorage|sessionStorage|requestAnimationFrame)\./.test(body)) throw new Error('the room\'s core touches the page (document / window / storage): src/core must stay DOM-free');
  writeFileSync(join(ROOT, 'worker', 'room-core.js'), '// GENERATED from src/core/coop/room-worker.ts by scripts/build.mjs. Do not edit.\n'
    + 'export function freshCore() {\n  const module = { exports: {} }, exports = module.exports;\n' + body + '\n  return module.exports;\n}\n');
}

// The Worker: worker/index.ts -> worker/index.js, the file wrangler.jsonc (and tests/helpers/server.js) name as main.
// Types stripped only, kept an ES module; wrangler does the bundling (the `cloudflare:workers` import stays external).
if (oi < 0) {
  const src = readFileSync(join(ROOT, 'worker', 'index.ts'), 'utf8');
  const out = transformSync(src, { loader: 'ts', format: 'esm', target: 'es2022', sourcefile: 'worker/index.ts', legalComments: 'none', charset: 'utf8' });
  for (const w of out.warnings) console.warn(`worker/index.ts: ${w.text}`);
  writeFileSync(join(ROOT, 'worker', 'index.js'), '// GENERATED from worker/index.ts by scripts/build.mjs. Do not edit: change the .ts and run npm run build.\n' + out.code);
  writeFileSync(join(ROOT, 'worker', '.gitignore'), ['# Written by scripts/build.mjs: built from worker/index.ts and src/core/coop/room.ts.', '/.gitignore', '/index.js', '/room-core.js', ''].join('\n'));
}
console.log(`built src/sw/sw.ts -> site/sw.js${oi < 0 ? ', worker/index.ts -> worker/index.js' : ''}`);
