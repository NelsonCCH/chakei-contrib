// One whole shift in memory: the shop's rules (src/core/) with the page's loop replaced by a fake clock.
// Frames arrive with seeded, uneven timings (mostly 60 fps, some slow frames, the odd long stall); each frame goes through
// the fixed-step clock (core/referee/clock.ts) exactly as ui/main.ts loop does it (the host's step: update at the
// open-sheet / open-board slowdown, then careerTick; juiceTick once per frame), a bot plays the player's station (or all
// four: 'all'), the computer fills in the rest, and the ledger (ledger.js) checks the books after every step and action.
import { freshCore, simPort, mulberry32 } from './core.js';
import { makeBots } from './bots.js';
import { makeLedger } from './ledger.js';
import { makeHuman, profileOf } from './human.js';
import { installLevel } from './levels.js';

/**
 * Counts every customer the shop saw, whoever's station let them down (G.angry counts only walk-outs at a
 * person's station): groups that came in, groups turned away at a full door, groups that left unserved (queue, order,
 * food or drink, takeaway), bills that went to the till. Wraps the hook table of `C` (the referee's core in co-op).
 */
export function countCustomers(C) {
  const H = C.CORE_HOOK, n = { came: 0, turned: 0, left: 0, toPay: 0, take: 0, persons: 0, why: {} };
  const { enqueue, leave, toPay, takeDone } = H;
  H.enqueue = g => {
    const S = C.G, full = S.groups.filter(x => x.state === 'queue').length >= C.CFG.queueMax + (S.qBonus || 0);
    n.came++; n.persons += g.size || 1; if (full) n.turned++;
    return enqueue(g);
  };
  H.leave = (g, ...r) => { if (C.G.groups.includes(g)) { n.left++; const k = g.take ? 'take' : g.state; n.why[k] = (n.why[k] || 0) + 1; } return leave(g, ...r); };
  H.toPay = (...a) => { n.toPay++; return toPay(...a); };
  H.takeDone = (...a) => { n.take++; return takeDone(...a); };
  return n;
}
/** The served share and walk-outs of a finished shift, from countCustomers and the shop's books. A walk-out left without
 *  their food and drinks (turned away, or left from the queue, the order, the wait); a bill that ran from the till (走數)
 *  was served and is counted on its own (`ranTill`; bills still at the till at the bell are not runs). */
export function customerReport(C, n, sec) {
  const G = C.G, atTill = G.payQ.length + (G.at && G.at.cur ? 1 : 0) + (G.cur ? 1 : 0);
  const ran = Math.max(0, n.toPay - (G.paidCount - n.take) - atTill);
  const out = n.turned + n.left, served = G.served | 0;
  return { came: n.came, persons: n.persons, perMin: n.came / (sec / 60), gap: sec / Math.max(1, n.came), served, walkouts: out, turned: n.turned, ranTill: ran, why: n.why,
    servedPct: served + out ? 100 * served / (served + out) : 100 };
}

/**
 * @param {{ seed: number, station: 'waiter'|'bar'|'kitchen'|'till'|'all', slot: string, level?: string|null,
 *           daily?: boolean, diff?: string, bot?: boolean, lazy?: boolean, pace?: number, err?: number,
 *           frames?: (rnd: () => number) => number }} o
 *   lazy: the player acts on 1% of frames instead of 40% (customers run out of patience everywhere, walk out at the till).
 *   pace: the share of frames the player acts on (overrides lazy); err: the bots' mistake rate (default 6%).
 *   solo: 'rotate' | 'all' (`station` is where the shift starts); look: 一腳踢's seconds between looks.
 *   gameSec: the shift's length in game seconds (default CFG.gameSec, 180).
 *   before: called with the core every frame before the bots act (a test steering the shift onto a rare path).
 *   cfg: numbers to put into CFG for this shift (a tuning sweep, e.g. { feverSec: 20 }).
 *   shop: a party shop (core/party/config.ts PARTY_SHOPS): its pace on the 熟手 base, installed the way the game's
 *         levelEnter installs a level's (ui/levels.ts levelDiff); overrides diff.
 *   roles: true runs a level's (with lv) or a party shop's (with shop) extra stations (its `roles`, the computer at each, on a referee of one, as
 *          ui/main.ts start does with soloShopStart). Off by default, so the four's sims keep their meaning; with it on
 *          the ledger's books are not checked (it knows the four's money paths, not the extras'; tests/sim/coop.js
 *          checks those).
 */
/**
 * A party round's own stations, as the room's referee runs them (core/coop/room.ts roomPartyShift): the shop's
 * `roles` in G.party (the stations read their tier there) and a referee of one with those extra seats, the computer at
 * each. Returns whether the shop has any (屋邨茶記 has none: the plain four as before).
 */
function partyShopStart(C, shop) {
  const roles = C.PARTY_SHOPS[shop].roles, extras = C.levelRoles(C.PARTY_SHOPS[shop]);
  C.G.party = { shop, sec: C.CFG.gameSec, round: 0, twist: null, ...(roles ? { roles: { ...roles } } : {}) };
  if (!extras.length) return false;
  C.refStart({ room: 'solo', me: C.SOLO_ME, name: 'sim', send: () => {}, seed: 1, round: 1, now: 0, extraSeats: extras });
  return true;
}
export function runShift(o) {
  const C = freshCore();
  if (o.setup) o.setup(C);   // before anything runs (a workload spec to try, scripts/workload-calibrate.mjs)
  if (o.gameSec) C.CFG.gameSec = o.gameSec;   // party rounds: 下午茶 is 120 s
  if (o.cfg) Object.assign(C.CFG, o.cfg);      // a tuning sweep (the fever length)
  C.setRng(C.mulberry32(o.seed));
  const port = simPort(C); C.setPort(port);
  const rnd = mulberry32(o.seed ^ 0x9E3779B9);
  C.setStation(o.station === 'all' ? 'waiter' : o.station); C.setSlot(o.slot);
  if (o.shop) Object.defineProperty(C.DIFFS, 'party', { value: C.shopDifficulty(C.DIFFS.pro, o.shop), enumerable: false, configurable: true, writable: true });
  C.setDiff(o.shop ? 'party' : o.diff || ['rookie', 'pro', 'ace'][o.seed % 3]);
  if (o.dset && o.diff) Object.assign(C.DIFFS[o.diff], o.dset);   // a free-play tuning sweep
  // lv: one of the game's own levels (ui/levels.ts), installed as levelEnter does (tables, pace, menu, slot)
  const lvSet = o.lv ? installLevel(C, port, o.lv) : null;
  const count = countCustomers(C);
  // regulars and celebrities on some shifts (career.ts planVisitors decides this in the game)
  if (o.seed % 3 === 0) C.REG_PLAN.push({ key: 'chan', at: 20, date: true }, { key: 'cheung', at: 30 }, { celeb: 'chef', at: 40 });
  if (o.seed % 3 === 1) C.REG_PLAN.push({ celeb: 'diva', at: 15 }, { key: 'chan', at: 50 });
  C.newGame();
  C.REG_PLAN.length = 0;
  const G = C.G;
  if (o.level) G.level = o.level;
  if (lvSet) lvSet();
  if (o.daily) G.drng = { a: (o.seed * 7919) >>> 0 };
  if (o.station === 'all') G.roles = { waiter: 'me', bar: 'me', kitchen: 'me', till: 'me' };
  C.tillWarmup();
  C.resetClock();
  const shop = o.lv && o.roles ? C.soloShopStart(0) : o.shop && o.roles ? partyShopStart(C, o.shop) : false;

  const ledger = makeLedger(C), bots = makeBots(C, rnd, o.human ? profileOf(o.human).err : o.err ?? .06);
  const play = o.bot === false ? [] : o.station === 'all' ? ['waiter', 'bar', 'kitchen', 'till'] : [o.station];
  // human: a person's speed (human.js) instead of the pace bot, one person per station played
  const humans = o.human ? {} : null, hum = st => (humans[st] ??= makeHuman(C, mulberry32(o.seed * 131 + Object.keys(humans).length), o.human, bots[st], { tag: o.tag ? x => o.tag(C, st, x) : null }));
  let clock = 0;
  // solo modes: 'rotate' moves the player round the stations every ROTATE_SEC; 'all' (一腳踢) lets the bot go
  // to the busiest station (a red ring first) every `o.look` s of game time; the computer covers the rest.
  let nextLook = 0, switches = 0;
  if (o.solo) G.solo = o.solo;
  const soloTurn = () => {
    if (!o.solo || !G.running) return;
    let to = null;
    if (o.solo === 'rotate') to = C.rotateDue(o.station, G.t);
    else if (G.t >= nextLook) {
      nextLook = G.t + (o.look ?? 3);
      // go to the busiest other station, red rings first; stay only while this one has a red ring and no other has
      const loads = C.SOLO_ORDER.filter(st => st !== G.station).map(st => [st, C.stationLoad(st)]), here = C.stationLoad(G.station);
      const hot = loads.filter(([, l]) => l.hot), pool = (hot.length ? hot : loads).sort((a, z) => z[1].n - a[1].n);
      to = pool[0][1].n > 0 && !(here.hot && !hot.length) ? pool[0][0] : null;
    }
    if (to && to !== G.station && C.switchStation(to)) { switches++; ledger.check(); }
    play[0] = G.station;
  };
  const step = h => {
    const S = C.G;
    const k = S.sheet || S.board ? (S.coop ? Math.max(.5, C.D().slow) : C.D().slow) : 1;
    if (shop) C.coopStep(h * k); else C.CORE_HOOK.update(h * k);
    C.careerTick();
    ledger.check();
  };
  const goes = () => C.G.running && !C.G.paused;
  const frame = o.frames || (r => { const x = r(); return x < .85 ? 1 / 60 + (r() - .5) * .004 : x < .97 ? 1 / 30 : x < .995 ? .1 + r() * .1 : .5; });
  let frames = 0, steps = 0, ends = 0;
  const fx = {};
  for (; G.running && frames < 200000; frames++) {
    const dt = frame(rnd);
    steps += C.advance(dt, step, goes);
    clock += dt;
    if (shop) C.coopFrame(clock * 1000);
    if (!G.running) break;
    C.juiceTick();
    soloTurn();
    if (o.before) { o.before(C); ledger.check(); }
    if (humans) for (const who of play) { hum(who).tick(clock, G.running && !G.paused); ledger.check(); if (!G.running) break; }
    else if (rnd() < (o.pace ?? (o.lazy ? .01 : .4))) for (const who of play) { bots[who](); ledger.check(); if (!G.running) break; }
    for (const e of C.drainFx()) { fx[e.k] = (fx[e.k] || 0) + 1; if (e.k === 'end') ends++; }
  }
  for (const e of C.drainFx()) { fx[e.k] = (fx[e.k] || 0) + 1; if (e.k === 'end') ends++; }
  const sum = ledger.finish();
  // the books are off with a referee's stations, and in a party shop (the director makes walk-in bills, takeaway
  // drinks and meals and dishes on the pass that the ledger does not model)
  if (shop || o.shop) sum.errs = sum.errs.filter(e => / the shift |'end' emitted|NaN/.test(e));
  if (G.running) sum.errs.push(`the shift never ended (t=${G.t.toFixed(1)} after ${frames} frames)`);
  else if (G.t !== C.CFG.gameSec) sum.errs.push(`the shift ended at t=${G.t}, not ${C.CFG.gameSec}`);
  if (ends !== 1) sum.errs.push(`'end' emitted ${ends} times`);
  const cust = customerReport(C, count, C.CFG.gameSec);
  const human = humans ? Object.fromEntries(Object.entries(humans).map(([k, h]) => [k, { ...h.stats, clock }])) : null;
  return { ...sum, frames, steps, fx, served: G.served, cups: G.cups, dishes: G.dishes, regPaidTips: port.tipsPaid, switches, cust, human, C };
}
