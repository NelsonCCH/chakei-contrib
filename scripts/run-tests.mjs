// Runs every tests/*.test.js in parallel, using the machine's cores.
// Each test file starts its own wrangler dev (own port, own D1 / Durable Object store) and its own headless
// browser, so files are independent and can run side by side.
// Timing-sensitive files (latency / CPU measurements, real-time 4-browser rooms) run afterwards, one at a time:
// under CPU contention their numbers would measure the other tests, not the game. The ones with no browser
// (SERIAL_SOCKETS) run in a second lane of their own beside them.
// Parallelism is sized from free RAM (~1.5 GB per file, ~4 GB kept free), capped by cores / 3.
// Usage: node scripts/run-tests.mjs [--jobs N] [--webkit] [file filters...]
//   --webkit  run on WebKit (Safari's engine) instead of Chromium; same as TEST_BROWSER=webkit
// The in-memory shift sims (tests/sim/, no browser, ~15 s) run first, unless file filters leave them out ('sim' keeps them).
//
// Machine-wide lock: the browser files run only while this run holds
// os.tmpdir()/chakei-browser-suite.lock, so two worktrees never run browser suites on the PC at once. The sims and the
// no-browser files in LIGHT never need it. A waiter prints who holds the lock and sleeps between polls; a lock whose
// holder died (crash, kill) is taken over. CHAKEI_TEST_LOCK=off skips the lock (CI, or on purpose).
//
// Each file runs as its own `node --test` process, so its wall time is measured; the summary lists the slowest files
// and each group's wall time, and tests/out/timings-<browser>.json keeps the numbers. The parallel group starts the files
// that took longest last time first, so no slow file is left running alone at the end.
import { readdirSync, openSync, writeSync, closeSync, readFileSync, unlinkSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { freemem, availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';

const SERIAL = new Set(['coop-stress.test.js', 'coop.test.js', 'room.test.js', 'journey-coop.test.js', 'live.test.js', 'press.test.js', 'ptt-room.test.js', 'ptt-coop.test.js']);
// Serial files with no browser (raw sockets against their own wrangler dev, or the deployed Worker): they run one at a
// time in a second lane beside the browser ones. Measured: the serial group keeps the CPU ~20% busy, and each of
// these adds one Node process and one workerd.
const SERIAL_SOCKETS = new Set(['room.test.js', 'ptt-room.test.js', 'live.test.js']);
// No browser and no wrangler dev: plain Node, light enough to run without the lock.
const LIGHT = new Set(['ptt-unit.test.js', 'stations-roast-core.test.js', 'stations-runner.test.js', 'stations-takeaway-core.test.js', 'stations-clear.test.js', 'stations-deliver.test.js']);
const args = process.argv.slice(2);
const ji = args.indexOf('--jobs');
const forced = ji >= 0 ? Number(args.splice(ji, 2)[1]) : 0;
const wi = args.indexOf('--webkit');
if (wi >= 0) { args.splice(wi, 1); process.env.TEST_BROWSER = 'webkit'; }
const filters = args;
const engine = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';

const sims = !filters.length || filters.some(x => 'sim'.includes(x)) ? readdirSync('tests/sim').filter(f => f.endsWith('.test.js')).map(f => 'sim/' + f) : [];
const all = readdirSync('tests').filter(f => f.endsWith('.test.js')).filter(f => !filters.length || filters.some(x => f.includes(x)));
const par = all.filter(f => !SERIAL.has(f)), ser = all.filter(f => SERIAL.has(f));

// ---- the lock ----
const LOCK = join(tmpdir(), 'chakei-browser-suite.lock');
const BREAK = LOCK + '.break';
const me = { pid: process.pid, worktree: process.cwd(), start: new Date().toISOString(), engine, files: all.length };
let holding = false;

/** Is this pid a live node process? (Checking the image name guards against Windows reusing a dead holder's pid.) */
function alive(pid) {
  try { process.kill(pid, 0); } catch (e) { if (e.code !== 'EPERM') return false; }
  if (process.platform !== 'win32') return true;
  try { return /node\.exe/i.test(execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true })); } catch { return true; }
}
const readLock = () => { try { return JSON.parse(readFileSync(LOCK, 'utf8')); } catch { return null; } };

/** Takes the lock if it is free or its holder is dead; returns null on success, else what is known of the holder. */
function tryLock() {
  try {
    const fd = openSync(LOCK, 'wx');
    writeSync(fd, JSON.stringify(me)); closeSync(fd);
    holding = true;
    return null;
  } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const held = readLock();
  let age = 0; try { age = Date.now() - statSync(LOCK).mtimeMs; } catch { return tryLock(); }
  const stale = held ? !alive(held.pid) : age > 30000; // unreadable for 30 s: its writer died between create and write
  if (!stale) return held || { pid: '?', worktree: '(lock being written)', start: '' };
  // Only the process that creates BREAK may delete a stale lock, after checking it is still the same dead one: two
  // waiters can never delete each other's fresh lock.
  try { closeSync(openSync(BREAK, 'wx')); } catch { try { if (Date.now() - statSync(BREAK).mtimeMs > 30000) unlinkSync(BREAK); } catch {} return held || {}; }
  try {
    const again = readLock();
    if (JSON.stringify(again) === JSON.stringify(held)) { console.log(`[lock] holder pid ${held?.pid} (${held?.worktree}) is gone: taking the lock over`); unlinkSync(LOCK); }
  } finally { try { unlinkSync(BREAK); } catch {} }
  return tryLock();
}
function release() {
  if (!holding) return;
  holding = false;
  try { if (readLock()?.pid === process.pid) unlinkSync(LOCK); } catch {}
}
async function acquire() {
  if (/^(off|0|no)$/i.test(process.env.CHAKEI_TEST_LOCK || '')) { console.log('[lock] CHAKEI_TEST_LOCK=off: not taking the machine-wide lock'); return; }
  let said = 0;
  for (;;) {
    const held = tryLock();
    if (!held) { console.log(`[lock] holding ${LOCK}`); return; }
    if (Date.now() - said > 60000) {
      const mins = held.start ? ((Date.now() - Date.parse(held.start)) / 60000).toFixed(0) : '?';
      console.log(`[lock] another browser suite is running: pid ${held.pid}, ${held.worktree}, ${held.engine || ''} ${held.files || '?'} files, for ${mins} min. Waiting (CHAKEI_TEST_LOCK=off to skip).`);
      said = Date.now();
    }
    await new Promise(r => setTimeout(r, 10000));
  }
}

// ---- running files ----
const kids = new Set();
function killKids() {
  for (const k of kids) { try { if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(k.pid), '/T', '/F'], { stdio: 'ignore' }); else k.kill('SIGKILL'); } catch {} }
}
process.on('exit', () => { release(); });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => { killKids(); release(); process.exit(130); });

const TIMINGS = `tests/out/timings-${engine}.json`;
/** file -> wall seconds, from earlier runs on this engine (kept across filtered runs). */
const prev = (() => { try { return JSON.parse(readFileSync(TIMINGS, 'utf8')).last || {}; } catch { return {}; } })();
const results = [];
/**
 * One file in its own `node --test`. Files running side by side print their output in one piece when they end; a file
 * running alone (`live`) prints as it goes, so a slow or stuck one shows where it is.
 */
function runFile(file, group, live) {
  return new Promise(res => {
    const t0 = Date.now();
    const k = spawn(process.execPath, ['--test', '--test-reporter=spec', 'tests/' + file], { stdio: ['ignore', 'pipe', 'pipe'] });
    kids.add(k);
    let out = '';
    if (live) process.stdout.write(`\n----- ${file} (${group}) started -----\n`);
    const take = d => { if (live) process.stdout.write(d); else out += d; };
    k.stdout.on('data', take);
    k.stderr.on('data', take);
    k.on('close', code => {
      kids.delete(k);
      const sec = (Date.now() - t0) / 1000;
      const ok = code === 0;
      results.push({ file, group, sec, ok });
      process.stdout.write(`\n===== ${file} (${group}) ${ok ? 'PASS' : 'FAIL'} in ${sec.toFixed(1)} s =====\n${out}`);
      res(ok);
    });
  });
}
const groupTime = {};
/** `live`: print a file's output as it goes (default: when the group runs one file at a time). */
async function runGroup(name, files, n, live = n === 1) {
  if (!files.length) return true;
  const t0 = Date.now();
  console.log(`\n[${name}] ${files.length} files, ${n} at a time: ${files.join(', ')}`);
  // Longest first (by the last measured time on this engine; a file never timed counts as long): a slow file started
  // last would otherwise run on alone after the others finish.
  const queue = [...files].sort((x, y) => (prev[y] ?? Infinity) - (prev[x] ?? Infinity));
  let ok = true;
  await Promise.all(Array.from({ length: Math.min(n, files.length) }, async () => {
    for (let f; (f = queue.shift());) if (!(await runFile(f, name, live))) ok = false;
  }));
  groupTime[name] = (Date.now() - t0) / 1000;
  return ok;
}

const T0 = Date.now();
const needLock = all.some(f => !LIGHT.has(f));
// The sims start at once and run beside the lock wait and the parallel group (no timing in either depends on a quiet
// CPU); the serial group starts only when both are done.
const simsDone = runGroup('sims', sims, 2);
if (needLock) await acquire();
const lockWait = (Date.now() - T0) / 1000;
const byRam = Math.floor((freemem() / 2 ** 30 - 4) / 1.5);
const jobs = forced || Math.max(1, Math.min(byRam, Math.floor(availableParallelism() / 3), par.length));
console.log(`\n${engine}: parallel ${par.length} files, ${jobs} at a time (free RAM ${(freemem() / 2 ** 30).toFixed(1)} GB); serial: ${ser.join(', ') || 'none'}`);
const a = await runGroup('parallel', par, jobs);
const s = await simsDone;
const serBrowser = ser.filter(f => !SERIAL_SOCKETS.has(f)), serSockets = ser.filter(f => SERIAL_SOCKETS.has(f));
const [b, c] = await Promise.all([runGroup('serial', serBrowser, 1), runGroup('serial-sockets', serSockets, 1, !serBrowser.length)]);
release();

const total = (Date.now() - T0) / 1000;
const fmt = x => x >= 60 ? `${(x / 60).toFixed(1)} min` : `${x.toFixed(1)} s`;
console.log(`\n===== timings (${engine}) =====`);
for (const r of [...results].sort((x, y) => y.sec - x.sec).slice(0, 10)) console.log(`${fmt(r.sec).padStart(10)}  ${r.ok ? 'pass' : 'FAIL'}  ${r.file}  (${r.group})`);
console.log(Object.entries(groupTime).map(([g, t]) => `${g} ${fmt(t)}`).join(', ') + `; total ${fmt(total)}` + (lockWait >= 1 ? ` (of which ${fmt(lockWait)} waiting for the lock)` : ''));
const failed = results.filter(r => !r.ok).map(r => r.file);
if (failed.length) console.log('FAILED: ' + failed.join(', '));
try {
  mkdirSync('tests/out', { recursive: true });
  const last = { ...prev }; for (const r of results) last[r.file] = r.sec;
  writeFileSync(TIMINGS, JSON.stringify({ engine, at: new Date().toISOString(), jobs, total, lockWait, groups: groupTime, files: results, last }, null, 1));
} catch {}
process.exit(s && a && b && c ? 0 : 1);
