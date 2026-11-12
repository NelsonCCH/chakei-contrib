// 樓面 in real (headless, muted) phones against a local Worker: a room on 打風前夕 (typhoon: 傳菜 and
// 外賣 on the floor, three floor seats) with the owner at 伙記 and a teammate at 傳菜. Both play the floor: the waiter's
// screens and the job bar. A group one phone picks at the door is the other's no more (the claim crosses the room on
// the next tick, and the other's tap is refused); the open work is on the shop map,
// one counted bubble per station: what one phone takes leaves the other's count, a teammate tapping the same
// bubble gets only the rest, and a let-go job comes back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, sleep } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, realErrors, shot, roomFastForward } from './helpers/browser.js';
import { mapTap } from './helpers/map.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const LEVELS = { estate: 3, central: 3, mongkok: 3, airport: 3, typhoon: 3 };
const player = nick => openGame(browser, srv.url, { storage: veteran(nick, { ...ROLES_LEARNED, stars: 40, levels: LEVELS }) });
/** The floor task `id` as phone `p` sees it: undefined (not on its floor), null (open) or its holder. */
const holderOn = (p, id) => p.evaluate(i => { const x = G.floor?.tasks.find(t => t.id === i); return x === undefined ? undefined : x.by; }, id);
/** A station's count on phone p (its map bubble's number; 0: no bubble). */
const count = (p, k) => p.evaluate(k => stationCount(k), k);
const SPOT = { carry: 'pass', bag: 'bag' };

test('two phones share 樓面: one claim per task, the other phone drops the bubble, a let-go bubble comes back', { timeout: 180000 }, async () => {
  const a = await player('老闆'), b = await player('阿明');
  await a.evaluate(() => { station = 'waiter'; saveSet('ckf-station', 'waiter'); buildMenus(); });
  await a.click('#coopBtn'); await a.click('#hostBtn');
  await a.waitForFunction(() => NET.t && NET.t.up && NET.code);
  await a.evaluate(() => { NET.level = 'typhoon'; pushMeta('lobby'); renderCoop(); });
  const code = await a.evaluate(() => NET.code);
  await b.click('#coopBtn'); await b.fill('#roomIn', code); await b.click('#joinBtn');
  await b.waitForFunction(() => NET.meta && NET.meta.level === 'typhoon');
  await b.click('#coop [data-seat="floor2"]');
  await a.waitForFunction(() => Object.values(NET.seats).some(x => x.station === 'floor2'));
  await a.click('#hostGo');
  for (const p of [a, b]) await p.waitForFunction(() => G && G.running && G.floor && G.roles.floor === 'me', null, { timeout: 20000 });
  // both play the floor: the waiter's screens, on their own floor seat; the third floor seat is the computer's
  for (const p of [a, b]) {
    assert.equal(await p.isVisible('#floorWrap'), true, 'the waiter\'s floor');
    assert.equal(await p.isVisible('#seatView'), false, 'no 傳菜 seat screen');
    assert.equal(await p.evaluate(() => NET.myStation), 'waiter');
  }
  const seats = await b.evaluate(() => Object.values(phone().seats).filter(s => s.kind === 'floor').map(s => s.driver.type === 'player' ? s.driver.player : 'cpu').sort());
  assert.equal(seats.length, 2, 'two floor seats: 樓面1 and 樓面2 (the switched-on places of the lobby)');
  assert.equal(seats.filter(x => x === 'cpu').length, 0, 'both players: no computer floor seat');

  // the door: phone A picks a group; phone B sees it taken on a tick, and B's tap on it is refused
  await a.waitForFunction(() => G.floor.tasks.some(t => t.k === 'seat' && t.by === null), null, { timeout: 30000 });
  const gid = await a.evaluate(() => Number(G.floor.tasks.find(t => t.k === 'seat' && t.by === null).id.split(':')[1]));
  await a.evaluate(g => tapGroup(g), gid);
  assert.equal(await a.evaluate(() => G.selected), gid, 'A picked the group');
  const me = await a.evaluate(() => NET.id);
  await b.waitForFunction(([i, m]) => G.floor.tasks.find(t => t.id === i)?.by === m, [`seat:${gid}`, me], { timeout: 3000 });
  await b.evaluate(g => tapGroup(g), gid);
  assert.notEqual(await b.evaluate(() => G.selected), gid, 'B cannot pick a group A has');
  // A seats it: the task leaves both floors
  await a.evaluate(g => { const tb = bestTable(byId(g)); if (tb) tapTable(tb.id); }, gid);
  for (const p of [a, b]) await p.waitForFunction(i => !G.floor.tasks.some(t => t.id === i), `seat:${gid}`, { timeout: 4000 });

  // the map's station bubbles: the shift moves on until a 傳 or 包 bubble has work on both phones
  let kind = null;
  for (let i = 0; i < 40 && !kind; i++) {
    await roomFastForward(a, 3); await sleep(700);
    for (const k of ['carry', 'bag']) if (!kind && await count(a, k) > 0 && await count(b, k) > 0) kind = k;
  }
  assert.ok(kind, 'a station bubble with work on both phones');
  await shot(a, 'coop-floor-bubbles');
  const tapA = await mapTap(a, { k: 'spot', spot: SPOT[kind] });
  assert.ok(tapA.ok, tapA.why);
  await a.waitForSelector('#floorGame iframe', { state: 'visible', timeout: 3000 });
  assert.equal(await a.isVisible('#floorWrap'), false);
  const ids = await a.evaluate(() => floorJob().ids);
  assert.ok(ids.length >= 1, 'A took the station\'s work');
  await a.waitForFunction(is => is.every(i => { const x = G.floor.tasks.find(t => t.id === i); return !x || x.by === NET.id; }), ids, { timeout: 3000 });
  // on B, A's items have left the station's bubble (its count is what is left)
  await b.waitForFunction(([is, k]) => !stationOpen(k).some(x => is.includes(x.id)), [ids, kind], { timeout: 3000 });
  assert.equal(await holderOn(b, ids[0]), me, 'B sees A on it');
  await shot(a, 'coop-floor-job');
  // B taps the same bubble: B gets only what is left (or the teammate notice), never one of A's
  if (await count(b, kind) > 0) {
    const tapB = await mapTap(b, { k: 'spot', spot: SPOT[kind] });
    assert.ok(tapB.ok, tapB.why);
    const got = await b.evaluate(() => floorJob()?.ids ?? []);
    assert.ok(!got.some(i => ids.includes(i)), `B took none of A's items (${got} vs ${ids})`);
    if (got.length) { await b.click('#floorBack'); await b.waitForSelector('#floorWrap', { state: 'visible', timeout: 3000 }); }
  }
  // a stale claim on one of A's items is refused: B stays on the floor
  await b.evaluate(i => floorJobStart(i), ids[0]);
  assert.equal(await b.evaluate(() => floorJob()), null, 'B has no job');
  // A lets it go: back in B's station count (unless the computer took it meanwhile, or it was done)
  await a.click('#floorBack');
  await a.waitForSelector('#floorWrap', { state: 'visible', timeout: 3000 });
  await b.waitForFunction(([i, k]) => { const x = G.floor.tasks.find(t => t.id === i); return !x || x.by !== null && x.by.startsWith('#cpu:') || stationOpen(k).some(y => y.id === i); }, [ids[0], kind], { timeout: 3000 });
  await shot(b, 'coop-floor-bubbles-b');
  for (const p of [a, b]) assert.deepEqual(realErrors(p), []);
  for (const p of [a, b]) await p.context().close();
});
