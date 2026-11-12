// 樓面 race harness: the room's referee (core/coop/room.ts, as the Durable Object runs it) and several
// phones sitting at the floor seats (floor1..3), each its own fresh core, joined by SimBus (src/core/bus/sim.ts) with the
// link shapes of tests/sim/coop.js. Each phone's player is a small floor brain: it picks an open bubble, claims it
// (taskWant: hidden at once), works it for a few seconds while the status keeps the claim alive, then sends the result
// that completes it (seat, order, carried, cleared, packed, or a 送外賣 run: ride, dropped, back).
// The harness watches every frame: one holder per task on the referee (a claim never passes from one holder to another
// without the task being open in between), no ghost bubble (a phone showing a task open that the referee has had taken
// or finished for longer than the link can explain), and returns the logs the tests assert on.
import { freshCore, simPort, mulberry32 } from './core.js';
import { installLevel, LEVELS } from './levels.js';
import { countCustomers, customerReport } from './shift.js';

const BUSLIB = freshCore();
const ROOM = 'FLR1';
const FRAME = 1 / 60, FRAME_MS = 1000 / 60;

/**
 * o: { seed, lv (a level with 傳菜 or 外賣), players (phones at floor1..), shape (SimBus SHAPES name, or one per phone),
 *      sec (shift length), races: [{ at (game s) }] (every phone claims the same open task in the same frame),
 *      forget: [{ at, phone }] (that phone drops its job without telling: its claim must time out),
 *      ride: [{ at, phone }] (that phone takes the next delivery and rides for `dur` s),
 *      pick: chance per frame a free phone picks a bubble, work: seconds a job takes,
 *      mid: each phone plays as the human model's mid player: the oldest open task of any kind
 *           (送外賣 too), held for the load table's mid seconds (core/work/floor.ts taskSecOf, the computer's pace),
 *      count: count the customers (tests/sim/shift.js customerReport, returned as `cust`) }
 */
export function runFloor(o) {
  const seed = o.seed ?? 1, errs = [], bus = BUSLIB.simBus(seed * 7 + 3), rnd = mulberry32(seed ^ 0x7F00);
  const lv = o.lv ?? 'typhoon', n = o.players ?? 2, sec = o.sec ?? 120;
  const shapeOf = i => BUSLIB.SHAPES[Array.isArray(o.shape) ? o.shape[i] : (o.shape ?? 'clean')];
  const seats = ['floor1', 'floor2', 'floor3'];
  let now = 0;

  // ---- the room ----
  const room = { id: 'room' };
  room.send = e => bus.send(room.id, JSON.stringify(e));
  room.C = freshCore(); room.C.CFG.gameSec = sec;
  const cnt = o.count ? countCustomers(room.C) : null;
  const seated = {};
  for (let i = 0; i < n; i++) seated[seats[i]] = { player: 'p' + i, name: 'p' + i };
  // floorOn: the co-op lobby's switched-on 樓面 places; absent: the level's own count, as before
  const start = { level: lv, lv: LEVELS[lv], slot: LEVELS[lv].slot, diff: 'pro', extra: [], port: { rank: 2, rlv: {}, names: {} }, ...(o.floorOn ? { floorOn: o.floorOn } : {}) };
  const sh = room.C.roomShiftOf(start, seated);
  if (!sh || !sh.floor) throw new Error('runFloor: the room did not seat the floor on ' + lv);
  room.C.roomStart({ room: ROOM, send: room.send, now: 0, round: 1, seed }, sh);
  room.C.CFG.gameSec = sec;   // the level installed its own length
  bus.add({ id: room.id, deliver: (j, t) => room.C.roomReceive(JSON.parse(j), t) }, BUSLIB.SHAPES.clean);
  bus.setRef(room.id);

  // ---- the phones ----
  const phones = [];
  for (let i = 0; i < n; i++) {
    const C = freshCore(), port = simPort(C), id = 'p' + i;
    C.setPort(port); C.setRng(C.mulberry32(seed * 31 + i)); C.setSlot(LEVELS[lv].slot ?? 'lunch'); C.setDiff('pro'); C.CFG.gameSec = sec;
    const set = installLevel(C, port, lv);
    C.setStation('waiter'); C.newGame(); C.resetClock(); set(); C.CFG.gameSec = sec;
    const ph = { i, id, C, seat: seats[i], job: null, lost: [], wins: [], rides: 0 };
    C.setWorking(() => ph.job ? [ph.job.id] : []);
    ph.send = e => bus.send(id, JSON.stringify(e));
    bus.add({ id, deliver: (j, t) => { const m = JSON.parse(j); if (o.onMsg) o.onMsg(id, m, C); C.phoneReceive(m, t); } }, shapeOf(i) ?? BUSLIB.SHAPES.clean);
    C.phoneJoin({ room: ROOM, me: id, name: id, send: ph.send, now: 0 });
    phones.push(ph);
  }

  const RG = () => room.C.G;
  const holder = {}, notOpenSince = {}, log = { races: [], forgets: [], rides: [], ghosts: [], handoffs: 0, maxGhostMs: 0, cpuOver: 0, awayCover: 0, awayFrames: 0, claimsSent: 0, stations: [] };
  const lat = Math.max(...phones.map(p => (shapeOf(p.i)?.lat ?? 0) + (shapeOf(p.i)?.jitter ?? 0)));
  // a tick every 250 ms, one-way delay, a lost tick or two (5% loss on the bad link), a frame
  const GHOST_MS = o.ghostMs ?? 3 * 250 + lat + 2 * FRAME_MS;
  // station races: every phone taps the same counted bubble (「傳」 / 「包」) in the same frame
  const events = [...(o.races ?? []).map(r => ({ ...r, k: 'race' })), ...(o.forget ?? []).map(r => ({ ...r, k: 'forget' })), ...(o.ride ?? []).map(r => ({ ...r, k: 'ride' })),
    ...(o.stations ?? []).map(r => ({ ...r, k: 'station' }))].sort((a, b) => a.at - b.at);

  const visible = ph => (ph.C.G.floor?.tasks ?? []).filter(x => x.by === null).map(x => x.id);
  const mySeatOk = ph => { const P = ph.C.phone(); const d = P?.seats[ph.seat]?.driver; return d && d.type === 'player' && d.player === ph.id; };

  function finish(ph) {
    if (ph.job.ids && ph.job.ids.length > 1) { const j0 = ph.job; for (const id of j0.ids) { ph.job = { ...j0, id, ids: null }; finish(ph); } ph.job = null; return; }
    const C = ph.C, G = C.G, j = ph.job, [k, raw] = j.id.split(':'), num = Number(raw), S = ph.seat;
    ph.job = null;
    if (G.floor?.tasks.find(x => x.id === j.id)?.by !== ph.id && k !== 'deliver') return;   // lost it meanwhile
    if (j.work) ph.busy = (ph.busy ?? 0) + j.work;
    if (k === 'seat') { const g = C.byId(num); const tb = g && !g.take && g.state === 'queue' ? C.bestTable(g) : null; if (tb) C.submit(S, { k: 'seat', gid: num, table: tb.id }); }
    else if (k === 'order') { const g = C.byId(num); if (g && !g.take && g.state === 'order') C.submit(S, { k: 'order', gid: num, keys: [...g.items], peeked: false }); }
    else if (k === 'carry') {
      const refs = [];
      for (const g of G.groups) if (!g.take && g.table === num - 1) for (const x of C.linesOf(g)) if (x.l.passT !== undefined) refs.push({ gid: g.id, dest: x.dest, i: x.i });
      if (refs.length) C.submit(S, { k: 'carried', refs, table: num });
    }
    else if (k === 'clear') C.submit(S, { k: 'cleared', table: num, secs: 3, resets: 0 });
    else if (k === 'bag') C.submit(S, { k: 'packed', gid: num, stars: 3, tip: 2 });
    else if (k === 'deliver') {
      if (j.phase === 'go') { C.submit(S, { k: 'ride', gids: [num] }); ph.job = { id: j.id, phase: 'out', until: G.t + (j.dur ?? 20), gid: num }; ph.rides++; return; }
      C.submit(S, { k: 'dropped', gid: num }); C.submit(S, { k: 'back' });
    }
    C.taskDrop(j.id);
  }
  function want(ph, id, dur) {
    // (the mid player's seconds of work are counted when a job is done: a claim lost to the other player is not work)
    log.claimsSent++;
    if (!ph.C.taskWant(id)) return false;
    ph.job = { id, until: ph.C.G.t + dur, phase: id.startsWith('deliver:') ? 'go' : null, dur: o.rideSec ?? (o.mid ? 30 : 20), work: o.mid ? (id.startsWith('deliver:') ? 30 : dur) : 0 };
    if (ph.job.phase === 'go') ph.job.until = ph.C.G.t + 1;
    return true;
  }
  // nothing to race for (or to forget) yet: try again a moment later, for up to 20 s
  const retry = ev => { if ((ev.tries = (ev.tries ?? 0) + 1) > 200) { (ev.k === 'race' ? log.races : log.forgets).push({ at: ev.at, id: null }); return; } events.unshift({ ...ev, at: RG().t + 0.1 }); };
  function fire(ev) {
    const S = RG();
    if (ev.k === 'race') {
      // a task open on the referee and on every racing phone; everyone drops what they hold and claims it in this frame
      const racers = phones.filter(p => mySeatOk(p) && p.job?.phase !== 'out' && !p.rideWant);   // not a rider on the road
      const open = (S.floor?.tasks ?? []).filter(x => x.by === null && racers.every(p => visible(p).includes(x.id)) && !x.id.startsWith('deliver'));
      const t = open[0]; if (!t) { retry(ev); return; }
      for (const p of racers) { if (p.job) { p.C.taskDrop(p.job.id); p.job = null; } }
      const sent = racers.filter(p => want(p, t.id, 3)).map(p => p.id);
      log.races.push({ at: ev.at, now, id: t.id, sent, first: null, nacked: [], holders: [] });
    } else if (ev.k === 'forget') {
      const p = phones[ev.phone ?? 0];
      // claims the oldest open bubble, then forgets it: no result, no release, the status stops touching it
      const id = visible(p).find(x => !x.startsWith('deliver') && holder[x] === null);   // open on the referee too
      if (!id) { retry(ev); return; }
      if (p.C.taskWant(id)) log.forgets.push({ at: ev.at, now, t: S.t, id, by: p.id, back: null, sawMine: false });
    } else if (ev.k === 'station') {
      // a station with at least `min` open items on the referee and on every racing phone; each phone takes what one tap takes
      const kind = ev.kind ?? 'carry';
      const racers = phones.filter(p => mySeatOk(p) && p.job?.phase !== 'out' && !p.rideWant && (ev.phone === undefined || p.i === ev.phone));
      const items = room.C.stationOpen(kind).map(x => x.id);
      if (!ev.follow && (items.length < (ev.min ?? 2) || !racers.every(p => items.every(id => visible(p).includes(id))))) { retry(ev); return; }
      if (ev.then) for (const [k2, f] of ev.then.entries()) { events.push({ k: 'station', kind, follow: true, phone: f.phone, race: ev.race ?? ev.at, at: RG().t + f.after + k2 * 0.001 }); events.sort((a, b) => a.at - b.at); }
      for (const p of racers) { if (p.job) { for (const id of p.job.ids ?? [p.job.id]) p.C.taskDrop(id); p.job = null; } }
      const before = Object.fromEntries(racers.map(p => [p.id, p.C.stationCount(kind)]));
      const sent = {};
      for (const p of racers) {
        const want = p.C.stationPick(kind), got = p.C.floorTakeMany(want);
        log.claimsSent += want.length;
        sent[p.id] = got;
        if (got.length) p.job = { id: got[0], ids: got, until: p.C.G.t + 2.5, phase: null };
      }
      const after = Object.fromEntries(racers.map(p => [p.id, p.C.stationCount(kind)]));
      log.stations.push({ at: ev.at, race: ev.race ?? ev.at, phone: ev.phone, now, kind, items, sent, before, after, first: {}, counts: null, checkAt: now + 2000 });
    } else if (ev.k === 'ride') {
      const p = phones[ev.phone ?? 0];
      p.rideWant = true;
    }
  }

  const maxFrames = (sec + 20) * 60;
  let frames = 0, healLeft = -1;
  for (; frames < maxFrames; frames++) {
    const S = RG(), t = S.t;
    while (events.length && t >= events[0].at) fire(events.shift());
    room.C.roomAdvance(now);
    room.C.drainFx();
    // ---- the referee's side: one holder at a time; when each task stopped being open ----
    const F = S.floor;
    if (F) {
      const ids = new Set(F.tasks.map(x => x.id));
      for (const x of F.tasks) {
        const was = holder[x.id];
        if (was && x.by && was !== x.by && was !== '#cpu:share') errs.push(`two holders: ${x.id} went ${was} -> ${x.by} at ${t.toFixed(2)}`);
        holder[x.id] = x.by;
        if (x.by === null) delete notOpenSince[x.id]; else notOpenSince[x.id] ??= now;
      }
      for (const id of Object.keys(holder)) if (!ids.has(id)) { delete holder[id]; notOpenSince[id] ??= now; }
      for (const id of Object.keys(notOpenSince)) if (ids.has(id) && F.tasks.find(x => x.id === id).by === null) delete notOpenSince[id];
      // races: the first holder the referee gave the task to
      for (const r of log.races) if (r.id) { const x = F.tasks.find(y => y.id === r.id), h = x ? x.by ?? 'open' : 'gone'; if (r.first === null && x && x.by) r.first = x.by; if (r.lastH !== h) { r.lastH = h; r.holders.push(h + '@' + t.toFixed(2)); if (h === 'gone') r.closed = true; } }
      // station races: each item's first holder on the referee; two seconds on, every phone's count against the referee's
      for (const r of log.stations) {
        if (now < r.checkAt) for (const id of r.items) if (r.first[id] === undefined) { const x = F.tasks.find(y => y.id === id); if (!x) r.first[id] = 'gone'; else if (x.by) r.first[id] = x.by; }
        if (!r.counts && now >= r.checkAt) r.counts = { ref: room.C.stationCount(r.kind), phones: phones.map(p => p.C.stationCount(r.kind)) };
      }
      // forgets: the claim times out (or the computer has it after it was open again)
      for (const f of log.forgets) if (f.back === null) {
        const x = F.tasks.find(y => y.id === f.id);
        if (x && x.by === f.by) f.sawMine = true;
        else if (f.sawMine && (!x || x.by !== f.by)) f.back = { t, now, gone: !x, by: x ? x.by : null };
      }
      // cover while away: the computer never runs more workers than it drives floor seats, and no seat of a rider is covered
      const R = room.C.referee(), cpuSeats = Object.values(R.seats).filter(s => s.kind === 'floor' && s.driver.type === 'computer').length;
      const bots = new Set(F.tasks.filter(x => x.by && x.by.startsWith('#cpu:') && x.by !== '#cpu:share' && !x.by.startsWith('#cpu:pool:')).map(x => x.by));
      if (bots.size > cpuSeats) log.cpuOver++;
      if (Object.keys(F.away).some(w => !w.startsWith('#cpu:'))) log.awayFrames++;
      for (const who of Object.keys(F.away)) if (!who.startsWith('#cpu:')) {
        const s = Object.values(R.seats).find(z => z.kind === 'floor' && (z.last === who || (z.driver.type === 'player' && z.driver.player === who)));
        if (s && s.driver.type !== 'player') log.awayCover++;
      }
    }
    // ---- the phones ----
    for (const ph of phones) {
      const C = ph.C, G = C.G;
      if (G.running && !G.paused) C.advance(FRAME, h => C.coopStep(h), () => C.G.running && !C.G.paused);
      C.coopFrame(now);
      C.drainFx();
      for (const id of C.takeLost()) { ph.lost.push(id); for (const r of log.races) if (r.id === id && !r.closed && !r.nacked.includes(ph.id)) r.nacked.push(ph.id); }   // a task id comes back (clear:<table>): a later refusal is not the race's
      if (!G.floor || !G.running || !C.phone()?.key) continue;
      // ghosts: an open bubble here that the referee has had taken or finished for longer than the link explains
      for (const id of visible(ph)) {
        if (holder[id] === ph.id) continue;   // its own claim, its release on the way (not a ghost: the referee follows)
        const since = notOpenSince[id];
        if (since !== undefined && now - since > GHOST_MS) { log.ghosts.push({ ph: ph.id, id, ms: now - since, t: G.t, rt: RG().t, ref: F?.tasks.find(x => x.id === id)?.by ?? "gone", at: G.floor.tasks.find(x => x.id === id)?.at, n: G.floor.tasks.length }); }
        if (since !== undefined) log.maxGhostMs = Math.max(log.maxGhostMs, now - since);
      }
      if (!mySeatOk(ph)) continue;
      if (ph.job) {
        if (G.t >= ph.job.until) finish(ph);
        else if (ph.job.phase !== 'out' && G.floor.tasks.find(x => x.id === ph.job.id)?.by !== ph.id && !C.phone().pend) ph.job = null;
        continue;
      }
      const open = visible(ph);
      if (ph.rideWant) { const d = open.find(x => x.startsWith('deliver:')); if (d && want(ph, d, 1)) { ph.rideWant = false; log.rides.push({ by: ph.id, id: d, at: G.t }); } continue; }
      if (o.mid) {
        const fits = x => { if (!x.startsWith('seat:')) return true; const g = C.byId(Number(x.split(':')[1])); return !!g && !g.take && !!C.bestTable(g); };
        // not what the other floor player just went for (two people at one floor see each other move)
        const theirs = new Set(phones.filter(q => q !== ph && q.job).map(q => q.job.id));
        const id = G.floor.tasks.filter(x => open.includes(x.id) && !theirs.has(x.id) && fits(x.id)).sort((a, b) => a.at - b.at)[0]?.id;
        if (id) want(ph, id, C.taskSecOf(id));
        continue;
      }
      if (rnd() < (o.pick ?? 0.05) && open.length) {
        const pool = open.filter(x => !x.startsWith('deliver:'));
        const id = pool[Math.floor(rnd() * pool.length)];
        if (id) want(ph, id, o.work ?? 2 + rnd() * 3);
      }
    }
    if (o.each) o.each({ now, phones, room });
    bus.advance(FRAME_MS); now += FRAME_MS;
    if (!RG().running && healLeft < 0) healLeft = 300;
    if (healLeft >= 0 && --healLeft === 0) break;
  }
  if (RG().running) errs.push('the shift never ended');
  return { errs, log, room, phones, F: RG().floor, S: RG(), GHOST_MS, cust: cnt ? customerReport(room.C, cnt, sec) : null };
}
