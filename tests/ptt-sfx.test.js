// Push-to-talk radio sounds, one headless muted Chromium page with its fake microphone: our own press gets the
// key-up chirp, our release the roger beep + squelch; another talker's turn starting / ending plays the same two; with
// the game's sound switched off nothing plays (each sound is still asked for). The room is faked: the test is the link.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, openGame, veteran, realErrors } from './helpers/browser.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch({ fakeMic: true }); });
after(async () => { await browser?.close(); await srv?.stop(); });

test('chirp on a turn starting, roger + squelch on it ending, own and remote; silent with the game sound off', async () => {
  const p = await openGame(browser, srv.url, { storage: veteran('阿明') });
  await p.evaluate(() => {
    setSound(true);   // the harness starts with the game's sound off; --mute-audio keeps the run silent anyway
    window.__sent = [];
    const host = document.createElement('div');   // the strip on screen, wherever the menu page ends
    host.style.cssText = 'position:fixed;left:0;right:0;top:200px;z-index:99999';
    document.body.appendChild(host);
    pttBind({ id: 'me', up: () => true, send: m => { if (!(m instanceof ArrayBuffer)) window.__sent.push(m); } },
      { name: () => '阿明', shown: () => true, mount: () => host });
  });
  const st = () => p.evaluate(() => ({ sfx: PTT.stats.sfx, ...PTT.stats.asked }));
  const floor = m => p.evaluate(x => { pttIn({ t: 'floor', name: '', turn: 0, left: 12000, ...x }); }, m);

  // our own press: the room grants it, the chirp plays
  const b = await p.locator('#pttBtn').boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.down();
  await p.waitForFunction(() => window.__sent.some(m => m.t === 'floorReq') && PTT.mic === 'on');
  let s0 = await st();
  await floor({ holder: 'me', name: '阿明', turn: 1 });
  let s = await st();
  assert.equal(await p.evaluate(() => PTT.turn), 1);
  assert.equal(s.key - s0.key, 1, 'own chirp asked');
  assert.equal(s.sfx - s0.sfx, 1, 'own chirp played');
  // our release: roger + squelch
  s0 = s;
  await p.mouse.up();
  await p.waitForFunction(() => window.__sent.some(m => m.t === 'floorRelease'));
  s = await st();
  assert.equal(s.roger - s0.roger, 1, 'own roger asked');
  assert.equal(s.sfx - s0.sfx, 1, 'own roger played');
  await floor({ holder: null, turn: 1, left: 0, why: 'release' });

  // another talker: chirp as the turn starts (once, a repeat of the same turn is quiet), roger as it ends
  s0 = await st();
  await floor({ holder: 'x', name: '阿強', turn: 2 });
  await floor({ holder: 'x', name: '阿強', turn: 2, left: 11000 });
  await floor({ holder: null, turn: 2, left: 0, why: 'release' });
  s = await st();
  assert.equal(s.key - s0.key, 1, 'remote chirp asked once');
  assert.equal(s.roger - s0.roger, 1, 'remote roger asked');
  assert.equal(s.sfx - s0.sfx, 2, 'both played');

  // the game's sound off: asked for, never played
  await p.evaluate(() => { setSound(false); });
  s0 = await st();
  await floor({ holder: 'x', name: '阿強', turn: 3 });
  await floor({ holder: null, turn: 3, left: 0, why: 'release' });
  s = await st();
  assert.equal(s.key - s0.key, 1);
  assert.equal(s.roger - s0.roger, 1);
  assert.equal(s.sfx - s0.sfx, 0, 'nothing plays with the game sound off');

  await p.evaluate(() => { pttUnbind(); });
  assert.deepEqual(realErrors(p), []);
  await p.context().close();
});
