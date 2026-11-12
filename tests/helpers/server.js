// Starts a throwaway local Worker (wrangler dev) with its own D1 + Durable Object storage, so every
// test file runs against a clean backend. Also creates a test RSA key and tells the Worker to trust
// it as "Google", so the real Google ID-token verification path is exercised end to end.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateKeyPairSync, createSign, randomBytes } from 'node:crypto';
import net from 'node:net';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const KID = 'test-kid-1';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

const b64u = b => Buffer.from(b).toString('base64url');
/** A Google-shaped ID token signed with the test key. Override any claim to make it bad. */
export function googleToken(claims = {}, { kid = KID, key = privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: 'https://accounts.google.com', aud: GOOGLE_CLIENT_ID, sub: '1234567890', email: 'p@example.com', name: '陳大文', given_name: '大文', iat: now, exp: now + 3600, ...claims }));
  const s = createSign('RSA-SHA256'); s.update(header + '.' + body);
  return header + '.' + body + '.' + b64u(s.sign(key));
}
export const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

/**
 * opts.vars overrides Worker vars (e.g. { DEV_AUTH: '0' }). opts.prod serves the production build of the game (minified,
 * no test surface: npm run build:prod) instead of the test build. Returns { url, stop }.
 */
// Files run in parallel (scripts/run-tests.mjs): a port picked by freePort() can be taken by another file before
// wrangler binds it, so a failed start is retried on fresh ports.
export async function startServer(opts = {}) {
  for (let i = 1; ; i++) { try { return await startOnce(opts); } catch (e) { if (i >= 3) throw e; } }
}
async function startOnce(opts) {
  const dir = mkdtempSync(join(tmpdir(), 'chakei-test-'));
  const port = await freePort(), inspector = await freePort();
  const wrangler = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  execFileSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'chakei', '--local', '--persist-to', dir], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } });
  // ROOM_DEBUG: the room's referee answers the tests' dbg requests (worker/index.ts, core/coop/room.ts roomDebug)
  const vars = { GOOGLE_CLIENT_ID, DEV_AUTH: '1', STATS: '1', ROOM_DEBUG: '1', GOOGLE_JWKS_OVERRIDE: JSON.stringify({ keys: [jwk] }), SESSION_SECRET: randomBytes(16).toString('hex'), ...(opts.vars || {}) };
  // Serve a copy of site/ taken now, through a copy of the config that points at it. wrangler dev reloads the Worker on
  // any change under its assets directory, and a reload resets every Durable Object: co-op rooms lost sight of their
  // still-open sockets mid-test whenever someone edited a file (other work in the repo does).
  const fwd = p => p.replace(/\\/g, '/');
  const site = join(dir, 'site');
  cpSync(join(ROOT, 'site'), site, { recursive: true });
  // The production bundle goes into this copy only (the files next to it stay the test build's).
  if (opts.prod) execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--prod', '--out', site], { cwd: ROOT, stdio: 'pipe' });
  const cfg = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')
    .replace('"main": "worker/index.js"', `"main": "${fwd(join(ROOT, 'worker', 'index.js'))}"`)
    .replace('"directory": "./site"', `"directory": "${fwd(site)}"`)
    .replace('"migrations_dir": "migrations"', `"migrations_dir": "${fwd(join(ROOT, 'migrations'))}"`);
  if (!cfg.includes(fwd(site)) || !cfg.includes(fwd(join(ROOT, 'worker')))) throw new Error('wrangler.jsonc changed shape: update tests/helpers/server.js');
  writeFileSync(join(dir, 'wrangler.jsonc'), cfg);
  const args = [wrangler, 'dev', '--config', join(dir, 'wrangler.jsonc'), '--port', String(port), '--ip', '127.0.0.1', '--inspector-port', String(inspector), '--persist-to', dir, '--log-level', 'warn'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const proc = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url + '/api/config'); if (r.ok) break; } catch {}
    if (proc.exitCode !== null || Date.now() - t0 > 60000) { try { proc.kill(); } catch {} throw new Error('wrangler dev did not start:\n' + log.slice(-3000)); }
    await new Promise(r => setTimeout(r, 300));
  }
  return {
    url,
    /** The local D1 / Durable Object storage of this Worker (wrangler d1 execute --local --persist-to dir). */
    dir,
    log: () => log,
    async stop() {
      proc.kill();
      await new Promise(r => setTimeout(r, 500));
      try { if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

/** Small fetch wrapper for API tests. */
export function client(url, token = '') {
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const r = await fetch(url + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  };
}

/** A raw co-op socket for protocol tests: collects messages, lets you wait for one. */
export function roomSocket(url, code, id, role) {
  const ws = new WebSocket(url.replace('http', 'ws') + `/api/room/${code}?id=${id}&role=${role}`);
  ws.binaryType = 'arraybuffer';
  // bins: binary messages (push-to-talk audio frames), kept apart from the JSON ones
  const msgs = [], waiters = [], bins = [];
  ws.addEventListener('message', e => {
    if (e.data === 'pong') return;
    if (typeof e.data !== 'string') { bins.push(new Uint8Array(e.data)); return; }
    const m = JSON.parse(e.data); msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const opened = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  // Like the game (net.js), ping every 2 s: the room treats a socket that stays silent as gone.
  const pingT = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 2000); pingT.unref?.();
  const closed = new Promise(res => ws.addEventListener('close', e => { clearInterval(pingT); res(e.code); }));
  return {
    ws, msgs, bins, opened, closed,
    /** Stop pinging and sending, socket left open: a phone that went silent without closing (half-open). */
    goSilent: () => clearInterval(pingT),
    send: m => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    wait(pred, ms = 5000) {
      const hit = msgs.find(pred); if (hit) return Promise.resolve(hit);
      return new Promise((res, rej) => { const w = { pred, res }; waiters.push(w); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout waiting; got: ' + JSON.stringify(msgs.slice(-5)))); } }, ms); });
    },
    close: () => ws.close(),
  };
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
