// Co-op shifts in memory: the room's referee and
// several phones, each its own fresh copy of the shop's rules (src/core/), joined by SimBus (src/core/bus/sim.ts, playing
// the network). The referee is the room: core/coop/room.ts, the code the room's Durable Object runs (roomStart,
// roomReceive, roomAdvance on the room's clock, roomSave every 5 s). Every phone sits at its lobby seat from the start,
// plays with the sim bots (tests/sim/bots.js) and talks to the room. The run checks the invariants every frame and at
// the end, and returns what it saw. Faults: link shapes, room restarts (the Durable Object evicted mid-shift, carrying on
// from its last save), link flaps, frozen phones, page reloads and random hand-overs at given times.
import { freshCore, simPort, mulberry32 } from './core.js';
import { makeBots } from './bots.js';
import { installLevel, LEVELS } from './levels.js';
import { makeHuman, makeHumanTake, profileOf, AIM_SKILL } from './human.js';
import { makeFloorHuman } from './floor-human.js';
import { TK } from './xseat.js';
import { countCustomers, customerReport } from './shift.js';

const BUSLIB = freshCore();
const ROOM = 'SIM1';
const FRAME = 1 / 60, FRAME_MS = 1000 / 60;
/** The room's save interval (worker/index.ts SHIFT_SAVE_MS): a restarted room carries on from its last save. */
const SAVE_MS = 5000;
/** The owner's recipe levels the start message carries (the same as core.js simPort's, so phones and room agree). */
const SIM_RLV = { 'k:奶茶': 3, 'f:西多士': 3, 'd:焗豬扒飯': 3, 's:A餐': 2, 'k:檸茶': 2 };
const XPRESS = { roast: 'roastBotPress', runner: 'runnerBotPress', takeaway: 'takeawayBotPress' };

/** Plain JSON: only null, booleans, finite numbers, strings, arrays and plain objects. */
export function plainJson(v, path = 'G', out = []) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return out;
  if (typeof v === 'number') { if (!Number.isFinite(v)) out.push(`${path} = ${v}`); return out; }
  if (v === undefined) return out;
  if (Array.isArray(v)) { v.forEach((x, i) => plainJson(x, `${path}[${i}]`, out)); return out; }
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) { for (const [k, x] of Object.entries(v)) plainJson(x, `${path}.${k}`, out); return out; }
  out.push(`${path} is a ${typeof v}`);
  return out;
}
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(q => [q, x[q]])) : x);

/**
 * o: { seed, seats: ['waiter', 'bar', ...] (the seat each phone sits at in the lobby; null = none), viewers, shape
 *      (SimBus SHAPES name or a shape per phone), slot, diff, dset, extraSeats, events: [{ at (game s), kind, ... }],
 *      lazy: {phone: [from, to]}, lv: one of the game's levels (levels.js), human: { [phone]: profile } (human.js:
 *      that phone's player plays at a person's speed instead of the bot's),
 *      party: a party round's shift ({ shop, sec, round, twist }; the phones install it from the keyframe;
 *      the room's report is roomReport()) }
 * Events: restart (the room's Durable Object restarts from its last save), down, freeze, burst, reload, away, release,
 *         pause (the room pauses for `dur` real seconds).
 * Returns { ..., room } where room.C is the room's core (also as `ref`, the referee).
 */
export function runCoop(o) {
  const seed = o.seed ?? 1, errs = [], bus = BUSLIB.simBus(seed * 7 + 3), rnd = mulberry32(seed ^ 0x51ED);
  const shapeOf = i => BUSLIB.SHAPES[Array.isArray(o.shape) ? o.shape[i] : (o.shape ?? 'clean')];
  const sentRes = new Set(), sentTask = new Set(), taskNacks = new Set(), endsBy = {};
  let atEnd = null;   // the room's books when its shift closed: what the end card shows (the books must not move after the bell)
  const books = G => ({ revenue: G.revenue, paidCount: G.paidCount, loss: G.loss, angry: G.angry, mistakes: G.mistakes });
  const phones = [];
  let now = 0, restarts = 0;

  function mkPhone(i, role = 'player') {
    const C = freshCore(), port = simPort(C);
    C.setPort(port); C.setRng(C.mulberry32(seed * 31 + i)); C.setSlot(o.slot ?? 'lunch'); C.setDiff(o.diff || 'pro');
    if (o.dset) Object.assign(C.DIFFS[o.diff || 'pro'], o.dset);   // a free-play tuning sweep
    const lvSet = o.lv ? installLevel(C, port, o.lv) : null;
    const seat = role === 'player' ? o.seats[i] ?? null : null;
    C.setStation('waiter');
    C.newGame(); C.resetClock();
    if (lvSet) lvSet();
    const id = role === 'viewer' ? 'tv' + i : 'p' + i;
    const ph = { i, id, role, seat, C, bots: makeBots(C, mulberry32(seed * 97 + i)), alive: true, claimed: true, frozenUntil: 0 };
    ph.drivesRoast = () => { const P = C.phone(), d = P && P.seats.roast && P.seats.roast.driver; return !!d && d.type === 'player' && d.player === id; };
    // 樓面's task claims are refused when a teammate got there first: those refusals are not results
    ph.send = e => { const j = JSON.stringify(e); if (e.b && e.b.k === 'res') sentRes.add(`${id}:${e.round}:${e.seq}`); if (e.b && e.b.k === 'task') sentTask.add(`${id}:${e.seq}`); bus.send(id, j); };
    ph.deliver = (json, t) => C.phoneReceive(JSON.parse(json), t);
    return ph;
  }

  // ---- the room: the referee as the Durable Object runs it (worker/index.ts) ----
  const room = { id: 'room', i: -1, C: null, savedAt: 0, save: null, unpauseAt: 0 };
  room.send = e => {
    const b = e?.b ?? e;
    if (b && b.k === 'nack' && sentTask.has(`${b.player}:${b.seq}`)) taskNacks.add(`${b.player}:${b.seq}`);
    bus.send(room.id, JSON.stringify(e));
  };
  const roomCore = () => { const C = freshCore(); if (o.dset) Object.assign(C.DIFFS[o.diff || 'pro'], o.dset); return C; };
  const seated = {};
  o.seats.forEach((st, i) => { if (st) seated[st] = { player: 'p' + i, name: 'p' + i }; });
  const start = { level: o.lv ?? '', lv: o.lv ? LEVELS[o.lv] : null, slot: o.slot ?? 'lunch', diff: o.diff || 'pro', extra: o.extraSeats ?? [], port: { rank: 2, rlv: SIM_RLV, names: {} }, ...(o.party ? { party: o.party } : {}) };
  room.C = roomCore();
  const sh = room.C.roomShiftOf(start, seated);
  if (!sh) throw new Error('runCoop: the room refused the start message');
  room.C.roomStart({ room: ROOM, send: room.send, now: 0, round: 1, seed }, sh);
  room.save = JSON.stringify(room.C.roomSave());
  bus.add({ id: room.id, deliver: (j, t) => room.C.roomReceive(JSON.parse(j), t) }, BUSLIB.SHAPES.clean);
  bus.setRef(room.id);
  const count = o.lv || o.human ? countCustomers(room.C) : null;

  const n = o.seats.length;
  for (let i = 0; i < n; i++) phones.push(mkPhone(i));
  for (let v = 0; v < (o.viewers ?? 0); v++) phones.push(mkPhone(n + v, 'viewer'));
  for (const ph of phones) bus.add({ id: ph.id, deliver: (j, t) => ph.deliver(j, t) }, shapeOf(ph.i) ?? BUSLIB.SHAPES.clean);
  for (const ph of phones) ph.C.phoneJoin({ room: ROOM, me: ph.id, name: ph.id, send: ph.send, now: 0, role: ph.role });

  const RG = () => room.C.G;
  const ackSeen = {}, epochSeen = {}, driverLog = [];
  let lastRefEpoch = 0;
  const events = [...(o.events ?? [])].sort((a, b) => a.at - b.at);

  /** The Durable Object is evicted and comes back: a fresh core carries on from the last save (the constructor's restore). */
  function roomRestart() {
    const s = JSON.parse(room.save), C = roomCore();
    C.roomRestore({ room: ROOM, send: room.send, now, round: s.round, seed: s.seed }, C.roomShiftOf(s.sh, s.sh.seated), s.key, s.drove, s.tally);
    room.C = C; restarts++;
  }
  function reload(ph) {
    const fresh = mkPhone(ph.i, ph.role);
    phones[ph.i] = fresh;
    bus.remove(ph.id); bus.add({ id: fresh.id, deliver: (j, t) => fresh.deliver(j, t) }, shapeOf(ph.i) ?? BUSLIB.SHAPES.clean);
    fresh.C.phoneJoin({ room: ROOM, me: fresh.id, name: fresh.id, send: fresh.send, now, role: fresh.role });
    return fresh;
  }
  function fire(ev) {
    const ph = phones[ev.phone ?? 1];
    if (ev.kind === 'restart') roomRestart();
    else if (ev.kind === 'down') { bus.down(ph.id, true); ph.downUntil = ev.at + ev.dur; }
    else if (ev.kind === 'freeze') { bus.freeze(ph.id, true); ph.frozenUntil = ev.at + ev.dur; }
    else if (ev.kind === 'burst') bus.burst(ph.id, now + ev.dur * 1000);
    else if (ev.kind === 'reload') reload(ph);
    else if (ev.kind === 'away') { ph.C.away('pagehide'); ph.awayUntil = ev.at + ev.dur; }
    else if (ev.kind === 'release') { ph.C.release(ph.seat); ph.claimed = false; ph.reclaimAt = ev.at + (ev.dur ?? 0); }
    else if (ev.kind === 'pause') { room.unpauseAt = now + ev.dur * 1000; room.C.setPaused(true); }
  }

  let frames = 0;
  const maxFrames = (o.maxSec ?? 200) * 60 + 600;
  let healLeft = -1;
  for (; frames < maxFrames; frames++) {
    const t = RG().t;
    while (events.length && t >= events[0].at) fire(events.shift());
    if (o.each) o.each({ t, now, frames, phones, ref: room, room, bus, reload });
    // the room: the Durable Object's timer, and its save every SAVE_MS
    if (room.unpauseAt && now >= room.unpauseAt) { room.unpauseAt = 0; room.C.setPaused(false); }
    room.C.roomAdvance(now);
    if (now - room.savedAt >= SAVE_MS) { room.savedAt = now; room.save = JSON.stringify(room.C.roomSave()); }
    const st = room.C.roomStatus();
    if (st && st.closed && !atEnd) atEnd = books(RG());
    for (const e of room.C.drainFx()) if (o.onFx) o.onFx(room, e);
    checkFrame(room);
    for (const ph of phones) {
      if (!ph.alive) continue;
      if (ph.downUntil && t >= ph.downUntil) { ph.downUntil = 0; bus.down(ph.id, false); ph.C.phoneJoin({ room: ROOM, me: ph.id, name: ph.id, send: ph.send, now, role: ph.role }); }
      if (ph.frozenUntil && t >= ph.frozenUntil) { ph.frozenUntil = 0; bus.freeze(ph.id, false); }
      if (ph.awayUntil && t >= ph.awayUntil) { ph.awayUntil = 0; ph.C.back('pagehide'); }
      if (ph.frozenUntil) continue;
      const C = ph.C, G = C.G;
      // a party round: the phone installs its pace (length, fever) from the keyframe's `party`, as net.ts partyPace does
      if (G.party && ph.party !== JSON.stringify(G.party)) { ph.party = JSON.stringify(G.party); C.installParty(C.partyOf(G.party)); }
      if (G.running && !G.paused) C.advance(FRAME, h => C.coopStep(h), () => C.G.running && !C.G.paused);
      C.coopFrame(now);
      const P = C.phone();
      if (P && ph.seat && !ph.claimed && P.key && (ph.reclaimAt === undefined || t >= ph.reclaimAt)) { C.claim(ph.seat); ph.claimed = true; }
      const lazy = o.lazy && o.lazy[ph.i];
      const idle = (lazy && t >= lazy[0] && t < lazy[1]) || !!ph.awayUntil;
      // a covered player who is back takes the seat again (the 換返我 tap)
      if (P && ph.seat && ph.claimed && !idle && G.running && G.roles[ph.seat] === 'ai' && now - (ph.lastClaim ?? 0) > 2000) { C.claim(ph.seat); ph.lastClaim = now; }
      // the extra seats press through their station module's own bot, as a player would
      const isFloor = !!ph.seat && /^floor\d$/.test(ph.seat);
      const hp = (o.human && o.human[ph.i]) || (isFloor ? 'skilled' : null);   // 樓面 has no bot of its own: a person plays it
      if (isFloor) {
        if (!ph.human || ph.human.C !== C) { ph.human = makeFloorHuman(C, mulberry32(seed * 131 + ph.i), hp, ph.seat); ph.human.C = C; }
        ph.human.tick(now / 1000, G.running && !G.paused && !idle && G.roles[ph.seat] === 'me');
      } else if (hp && ph.seat) {
        if (!ph.human || ph.human.C !== C) {
          const x = XPRESS[ph.seat], hb = makeBots(C, mulberry32(seed * 197 + ph.i), profileOf(hp).err);
          // 燒味: the person's aim at a guide
          if (ph.seat === 'roast') C.roastBotSkill(AIM_SKILL[typeof hp === 'string' ? hp : 'mid'] ?? AIM_SKILL.mid);
          // 外賣 has its own hand (as xseat.js): the coarse streamed model traced the knot at 5-7x par
          ph.human = ph.seat === 'takeaway' ? makeHumanTake(mulberry32(seed * 131 + ph.i), hp, TK)
            : makeHuman(C, mulberry32(seed * 131 + ph.i), hp, x ? () => C[x]() : hb[ph.seat], { extra: !!x, before: () => C.noteInput(ph.seat) });
          ph.human.C = C;
        }
        const on = G.running && !G.paused && !idle && G.roles[ph.seat] === 'me';
        if (ph.human.next) { const s = on ? C.takeawayState() : null, c = s ? ph.human.next(s) : null; if (c) { C.noteInput(ph.seat); C.takeawayCommand(c); } }
        else ph.human.tick(now / 1000, on);
      } else if (ph.seat && G.running && !G.paused && !idle && rnd() < .4 && G.roles[ph.seat] === 'me') { C.noteInput(ph.seat); (XPRESS[ph.seat] ? C[XPRESS[ph.seat]] : ph.bots[ph.seat])(); }
      for (const e of C.drainFx()) { if (e.k === 'end') endsBy[ph.id] = (endsBy[ph.id] || 0) + 1; if (o.onFx) o.onFx(ph, e); }
      checkFrame(ph);
    }
    bus.advance(FRAME_MS); now += FRAME_MS;
    // after the bell: the books close (at most CLOSE_GRACE_MS), then the closed keyframe (a lost one comes again in 2 s)
    if (!RG().running && healLeft < 0) healLeft = 480;
    if (healLeft >= 0 && --healLeft === 0) break;
  }

  function checkFrame(ph) {
    const C = ph.C;
    const R = C.referee();
    if (R) {
      if (R.refEpoch !== lastRefEpoch) { lastRefEpoch = R.refEpoch; for (const k in epochSeen) delete epochSeen[k]; }
      for (const [p, a] of Object.entries(R.acks)) { const k = 'r' + R.refEpoch + p; if (a < (ackSeen[k] ?? 0)) errs.push(`I-6: referee ack for ${p} went back ${ackSeen[k]} -> ${a}`); ackSeen[k] = a; }
      for (const s of Object.values(R.seats)) {
        if (s.epoch < (epochSeen[s.id] ?? 0)) errs.push(`I-8: seat ${s.id} epoch went back`);
        if (s.epoch !== epochSeen[s.id]) driverLog.push({ t: C.G.t, now, seat: s.id, driver: s.driver.type === 'player' ? s.driver.player : s.driver.type, why: s.coverReason });
        epochSeen[s.id] = s.epoch;
      }
    }
    const P = C.phone();
    if (P && C.G.running && P.key && C.G.t > P.tickT + C.CLOCK_AHEAD_S + 1e-6) errs.push(`I-7: ${ph.id} clock ${C.G.t.toFixed(3)} ahead of tick ${P.tickT.toFixed(3)}`);
  }

  // ---- end checks ----
  const S = room.C.G;
  if (S.running) errs.push(`the shift never ended (t=${S.t.toFixed(1)})`);
  else if (atEnd && JSON.stringify(atEnd) !== JSON.stringify(books(S))) errs.push(`the books moved after the bell: ${JSON.stringify(atEnd)} -> ${JSON.stringify(books(S))}`);
  const sharedRef = canon(room.C.sharedOf(S));
  const badRoom = plainJson(S);
  if (badRoom.length) errs.push(`I-12 room: ${badRoom.slice(0, 3).join(', ')}`);
  for (const ph of phones) {
    if (!ph.alive) continue;
    const bad = plainJson(ph.C.G);
    if (bad.length) errs.push(`I-12 ${ph.id}: ${bad.slice(0, 3).join(', ')}`);
    if (ph.C.unacked() !== 0) errs.push(`I-4: ${ph.id} still has ${ph.C.unacked()} unacknowledged results`);
    const mine = canon(ph.C.sharedOf(ph.C.G));
    if (mine !== sharedRef) { let c = 0; while (c < mine.length && mine[c] === sharedRef[c]) c++; errs.push(`I-5: ${ph.id} replica differs at ${c}: ...${mine.slice(Math.max(0, c - 80), c + 60)} vs ...${sharedRef.slice(Math.max(0, c - 80), c + 60)}`); }
    if (ph.role === 'player' && (endsBy[ph.id] ?? 0) !== 1) errs.push(`${ph.id} saw the end ${endsBy[ph.id] ?? 0} times`);
  }
  if (bus.stats.maxKeyBytes > 64 * 1024) errs.push(`I-11: keyframe of ${bus.stats.maxKeyBytes} bytes`);
  if (bus.stats.maxPhoneBytes > 16 * 1024) errs.push(`I-11: phone message of ${bus.stats.maxPhoneBytes} bytes`);
  const R = room.C.referee();
  const cust = count ? customerReport(room.C, count, room.C.CFG.gameSec) : null;
  const human = o.human ? Object.fromEntries(phones.filter(p => p.human).map(p => [p.seat, { ...p.human.stats, clock: now / 1000 }])) : null;
  return { errs, S, R, bus, phones, ref: room, room, restarts, frames, sentRes: sentRes.size + taskNacks.size, taskNacks: taskNacks.size, endsBy, driverLog, atEnd, cust, human };
}
