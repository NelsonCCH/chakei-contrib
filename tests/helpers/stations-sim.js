// Helpers for the new-station tests (src/stations-next/<kind>/): bundle a station's TypeScript core into an ES module
// node can import (esbuild, in memory, written under tests/out), a counting seeded Rng, a tiny static file server for
// the standalone station pages (no backend needed), and a shift runner that drives a core with its bot.
import { buildSync } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './server.js';

const OUT = join(ROOT, 'tests', 'out', 'stations');
mkdirSync(OUT, { recursive: true });

/** Imports src/stations-next/<kind>/<file>.ts (default core.ts) as an ES module. */
export async function loadStation(kind, file = 'core') {
  const res = buildSync({ entryPoints: [join(ROOT, 'src', 'stations-next', kind, file + '.ts')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false, logLevel: 'warning' });
  const p = join(OUT, `${kind}-${file}-${process.pid}.mjs`);
  writeFileSync(p, res.outputFiles[0].text);
  return import(pathToFileURL(p).href);
}

/**
 * A station's modules as one classic script that sets window[globalName] (for page.addScriptTag), so a check can run
 * the core in the same browser engine as a reference page: engines differ in the last bits of Math.sin / Math.hypot.
 * `exports` is the entry's source, e.g. "export * from './core'; export { gen } from './maze';".
 */
export function stationScript(kind, exports, globalName) {
  const res = buildSync({ stdin: { contents: exports, resolveDir: join(ROOT, 'src', 'stations-next', kind), loader: 'ts' }, bundle: true, format: 'iife', globalName, target: 'es2020', write: false, logLevel: 'warning' });
  return res.outputFiles[0].text;
}

/** contract.ts seededRng with a draw counter, so a hand-over test can rebuild an Rng at the same position. */
export function countingRng(seed, skip = 0) {
  let a = seed >>> 0;
  const r = {
    n: 0,
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      r.n++;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
  for (let i = 0; i < skip; i++) r.next();
  return r;
}

export const ctxFor = (t, rng, byPlayer = false) => ({ t, rng, seat: 's1', byPlayer, shared: { t, paused: false } });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.map': 'application/json', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
/** Serves site/ on a free localhost port. Returns { url, stop }. */
export function staticServer(dir = join(ROOT, 'site')) {
  const srv = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([\\/])+/, '');
    const file = join(dir, path);
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}`, stop: () => new Promise(q => srv.close(q)) })));
}
