// The preview's playtest timing log: with the PLAYTEST flag a shift's taps and a seat's gestures are recorded,
// a forced flush lands them in D1 (POST /api/ptlog) and scripts/playtest-log.mjs reads them back; without the flag (the
// live config) nothing is recorded and the Worker refuses the endpoint. Headless and muted (helpers/browser.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { startServer, ROOT } from './helpers/server.js';
import { launch, openGame, veteran, PHONE, realErrors } from './helpers/browser.js';
import { startShift } from './helpers/single.js';

let on, off, browser;
before(async () => { [on, off] = await Promise.all([startServer({ vars: { PLAYTEST: '1' } }), startServer()]); browser = await launch(); });
after(async () => { await browser?.close(); await on?.stop(); await off?.stop(); });

const open = url => openGame(browser, url, { device: PHONE, storage: { ...veteran('測試員'), 'ckf-view': 'simple' } });
const wrangler = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const d1 = (dir, sql) => {
  const out = execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'chakei', '--local', '--persist-to', dir, '--json', '--command', sql], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });
  return JSON.parse(out.slice(out.indexOf('['))).flatMap(r => r.results ?? []);
};
const pause = (page, ms) => page.evaluate(t => new Promise(r => setTimeout(r, t)), ms);

test('with the flag: taps at the bar and at the 傳菜 lesson seat are recorded, flushed to D1 and summarised by the script', async () => {
  // a shop station: taps go through HOOK (as the bar's buttons do)
  const page = await open(on.url);
  await page.locator('#ptBtn').waitFor();
  await startShift(page, { station: 'bar', diff: 'pro' });
  await page.evaluate(() => { barKey('hot'); });
  await pause(page, 120);
  await page.evaluate(() => { barKey('cold'); barKey('pot'); });
  assert.ok(await page.evaluate(() => ptPending()) >= 4, 'the shift row and three taps wait in the buffer');
  assert.ok(await page.evaluate(() => localStorage.getItem('ckf_pt_dev')), 'a random device id');
  assert.ok(await page.evaluate(() => ptFlush()) >= 4, 'all of it sent');
  assert.equal(await page.evaluate(() => ptPending()), 0);
  assert.deepEqual(realErrors(page), []);
  await page.context().close();

  // an extra seat (the 傳菜 lesson; it was the 洗碗 lesson's strokes before that seat was retired): its iframe's commands pass the seat host
  const p2 = await open(on.url);
  await p2.locator('#ptBtn').waitFor();
  await p2.click('#tutBtn');
  await p2.click('#book [data-train="runner"]');
  await p2.waitForFunction(() => G && G.running && G.xseat === 'runner' && runnerState());
  await p2.evaluate(() => { window.__chakeiSeat.send('runner', { t: 'pick', n: 1 }); });
  assert.ok(await p2.evaluate(() => ptFlush()) >= 2);
  assert.deepEqual(realErrors(p2), []);
  await p2.context().close();

  // read the rows back
  const rows = d1(on.dir, 'SELECT dev, b, ver, n, body FROM playtest_log ORDER BY id');
  assert.equal(new Set(rows.map(r => r.dev)).size, 2, 'two devices (two fresh browsers)');
  const ev = rows.flatMap(r => JSON.parse(r.body));
  const head = ev.find(e => e.e === 'shift' && e.x.seat === 'bar');
  assert.ok(head, 'the bar shift has its context row');
  assert.equal(head.x.diff, 'pro');
  assert.equal(head.x.p_bar, 5);
  for (const k of ['ua', 'dpr', 'vw', 'vh', 'dev', 'ver']) assert.ok(k in head.x, `context has ${k}`);
  assert.ok(head.x.ver, 'build version from app.js?v=');
  const bar = ev.filter(e => e.e === 'g' && e.s === 'bar');
  assert.deepEqual(bar.map(e => e.g), ['barKey:hot', 'barKey:cold', 'barKey:pot']);
  assert.ok(bar[1].gap >= 100, `the gap before the second tap is timed: ${bar[1].gap} ms`);
  const run = ev.filter(e => e.e === 'g' && e.s === 'runner');
  assert.equal(run[0]?.g, 'pick', JSON.stringify(run));
  assert.equal(run[0].x.n, 1);
  assert.ok(ev.some(e => e.e === 'shift' && e.x.mode.startsWith('tutorial') && e.x.extra === 'runner'), 'the lesson shift row');
  // nothing personal in any row: no player name, account or email
  const text = JSON.stringify(rows);
  for (const bad of ['測試員', '@', 'token']) assert.ok(!text.includes(bad), `no ${bad} in the log`);
  // the script reads the same rows and prints the summary against the model
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'playtest-log.mjs'), '--local', on.dir], { cwd: ROOT, encoding: 'utf8' });
  console.log(out);
  assert.match(out, /bar\s+barKey:hot\s+1/);
  assert.match(out, /runner\s+pick\s+1/);
  assert.match(out, /2 batches? from 2 device/);
});

test('without the flag (the live config): nothing is recorded and the Worker refuses the endpoint', async () => {
  const page = await open(off.url);
  await startShift(page, { station: 'bar', diff: 'pro' });
  await page.evaluate(() => { barKey('hot'); barKey('pot'); });
  assert.equal(await page.locator('#ptBtn').count(), 0);
  assert.equal(await page.evaluate(() => ptPending()), 0, 'the log never started');
  assert.equal(await page.evaluate(() => localStorage.getItem('ckf_pt_dev')), null);
  assert.equal(await page.evaluate(() => ptFlush()), 0);
  const r = await page.evaluate(async () => (await fetch('/api/ptlog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, dev: '0123456789abcdef', b: 1, ver: 'x', ev: [{ i: 'a', t: 0, s: 'bar', e: 'g' }] }) })).status);
  assert.equal(r, 404);
  assert.equal(d1(off.dir, 'SELECT COUNT(*) AS n FROM playtest_log')[0].n, 0);
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
