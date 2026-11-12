// Party mode under random event orders: phones joining, leaving, sitting, standing, voting and
// un-voting, readying and un-readying, starting, tapping in any order, the clock jumping by odd amounts, and the
// referee's reports arriving late, twice, for the wrong round or full of junk numbers. After every step the night must be
// sound (checkNight: the till balances to the dollar, seats and players agree, a host whenever anyone is here, a
// countdown only while everyone is ready, three proper cards before every round), the phase changes must follow the
// rules (a vote closes only on the clock, after everyone voted; a round starts only from the countdown; the end card
// never moves on with only time passing), and the same seed with the same events must give the same night.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore, mulberry32 } from './core.js';

const C = freshCore();
const RUNS = Number(process.env.PARTY_FUZZ || 160), STEPS = 400;

/** One random event (or tick, or report) for the night as it stands. */
function randomEvent(s, r) {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], id = ids[Math.floor(r() * ids.length)];
  const any = a => a[Math.floor(r() * a.length)], seat = any([...C.PARTY_SEATS, 'nope']);
  const x = r();
  if (x < .2) return { tick: any([.01, .5, 1, 1, 3, 4.9, 5, 7.5, 15, 20, 90, 200]) * (r() < .02 ? -1 : 1) };
  if (x < .28) {
    const round = r() < .85 ? s.round : any([s.round - 1, s.round + 1, 99]);
    const junk = () => (r() < .05 ? any([NaN, -3, Infinity, 1e9, 2.5]) : Math.floor(r() * 30));
    const team = { revenue: r() < .1 ? any([0, -50, NaN]) : Math.floor(r() * 3000), tips: junk(), mistakes: junk(), angry: junk(), maxCombo: junk(), fevers: Math.floor(r() * 4), served: junk() };
    const stations = C.PARTY_SEATS.map(st => ({ seat: st, kind: st, stars: Math.floor(r() * 5) - 1, measures: [{ key: 'n', label: 'n', value: junk() }], best: null,
      drivers: s.seats[st] ? [{ player: s.seats[st], sec: r() * 200 }] : r() < .1 ? [{ player: id, sec: junk() }] : [] }));
    const players = ids.filter(() => r() < .3).map(p => ({ player: p, done: junk(), avgSec: r() * 10, mistakes: junk(), burnt: junk(), exact: junk(), helps: junk(), hurries: junk(), streak: junk() }));
    return { report: { round, team, stations, players } };
  }
  // a present player most of the time, so the events land
  const here = s.players.filter(p => p.present), pid = here.length && r() < .8 ? any(here).id : id;
  // now and then the next player the screen waits for does their part, so whole nights get played (screens wait for people)
  if (x < .4) {
    const missing = s.phase === 'vote' && s.wager ? C.voters(s).filter(p => s.wager.votes[p.id] === undefined)
      : s.phase === 'ready' ? C.mustReady(s).filter(p => !s.taps.includes(p.id)) : s.phase === 'endcard' ? C.counted(s).filter(p => !s.taps.includes(p.id)) : [];
    const p = missing[0];
    if (p) return { ev: s.phase === 'vote' ? { k: 'vote', player: p.id, card: Math.floor(r() * 3) } : s.phase === 'ready' ? { k: 'ready', player: p.id, on: true } : { k: 'next', player: p.id } };
    if (s.phase === 'ready' && s.host) return { ev: { k: 'start', player: s.host } };
    if (s.phase === 'lobby' && s.host && here.length >= 2) return { ev: { k: 'start', player: s.host } };
  }
  const evs = [
    () => ({ k: 'join', player: id, name: r() < .2 ? '' : id.toUpperCase() }),
    () => ({ k: 'join', player: id, name: id }),
    () => ({ k: 'leave', player: pid }),
    () => ({ k: 'seat', player: pid, seat }),
    () => ({ k: 'seat', player: pid, seat }),
    () => ({ k: 'watch', player: pid }),
    () => ({ k: 'setup', player: r() < .7 ? s.host ?? id : id, cfg: { days: any([1, 2, 3]), shop: any([...C.SHOP_LADDER, 'x']), chooser: any(['vote', 'host']) } }),
    () => ({ k: 'start', player: r() < .8 ? s.host ?? id : id }),
    () => ({ k: 'start', player: r() < .8 ? s.host ?? id : id }),
    () => ({ k: 'next', player: pid }),
    () => ({ k: 'next', player: pid }),
    () => ({ k: 'vote', player: pid, card: any([0, 1, 2, 2, null, 3, -1, 1.5]) }),
    () => ({ k: 'vote', player: pid, card: any([0, 1, 2]) }),
    () => ({ k: 'token', player: pid, on: r() < .7 }),
    () => ({ k: 'ready', player: pid, on: r() < .75 }),
    () => ({ k: 'ready', player: pid, on: r() < .75 }),
    () => ({ k: 'again', player: r() < .7 ? s.host ?? id : id }),
    () => ({ k: 'bye', player: r() < .2 ? s.host ?? id : id }),
  ];
  return { ev: any(evs)() };
}

const run = (s, e) => (e.tick !== undefined ? C.nightTick(s, e.tick) : e.report ? C.nightResult(s, e.report) : C.nightInput(s, e.ev));
const allVoted = s => { const v = C.voters(s); return v.length > 0 && v.every(p => s.wager.votes[p.id] !== undefined); };

/** Runs one random night; returns the final state and the log of events, checking every step (and counting what it saw). */
function fuzzNight(seed, seen = null) {
  const r = mulberry32(seed), log = [];
  let s = C.newNight(seed, { days: r() < .3 ? 2 : 1, shop: C.SHOP_LADDER[Math.floor(r() * 5)] });
  for (let i = 0; i < STEPS; i++) {
    const e = randomEvent(s, r);
    const before = i % 8 === 0 ? JSON.stringify(s) : null;
    const step = run(s, e);
    if (before !== null) assert.equal(JSON.stringify(s), before, 'the step changed the state it was given');
    if (step.out.some(o => o.k === 'reject')) assert.equal(step.s, s, 'a refused event must leave the night as it was');
    const p = s, n = step.s, where = () => `seed ${seed}, step ${i} (${JSON.stringify(e).slice(0, 160)})`;
    // phase changes by the rules
    if (p.phase === 'vote' && n.phase !== 'vote' && n.nights === p.nights) {
      assert.ok(e.tick !== undefined, `${where()}: a vote closed on an input`);
      assert.ok(allVoted(p) && p.wager.allAt !== null, `${where()}: a vote closed before everyone voted`);
    }
    if (n.phase === 'countdown' && p.phase !== 'countdown') assert.ok(e.ev?.k === 'start' && e.ev.player === p.host && p.phase === 'ready', `${where()}: a countdown not started by the boss`);
    if (n.phase === 'round' && p.phase !== 'round') assert.ok(p.phase === 'countdown' && e.tick !== undefined, `${where()}: a round not from the countdown`);
    if (p.phase === 'endcard' && n.phase !== 'endcard' && e.tick !== undefined) assert.fail(`${where()}: the end card moved on with only time passing`);
    if (seen) {
      if (p.phase === 'countdown' && n.phase === 'ready') seen.unready++;
      if (p.phase === 'vote' && p.wager.allAt !== null && n.phase === 'vote' && n.wager.allAt === null) seen.reopened++;
      if (p.phase === 'vote' && n.phase === 'vote' && p.wager.allAt !== null && e.ev?.k === 'vote' && !step.out.some(o => o.k === 'reject')) seen.changed++;
      if (p.phase === 'round' && e.ev?.k === 'seat' && step.out.some(o => o.k === 'drive')) seen.midSeat++;
      if (n.bank < 0 && n.phase === 'endcard') seen.debt++;
    }
    s = n;
    log.push(e);
    const errs = C.checkNight(s);
    if (errs.length) assert.fail(`${where()}: ${errs.join('; ')}`);
    for (const o of step.out) if (o.k === 'roundStart') { assert.equal(o.plan.round, s.round); assert.ok(o.plan.card, 'every round starts with a card'); }
  }
  return { s, log };
}

test(`random event orders never break the night (${RUNS} nights x ${STEPS} steps)`, () => {
  const seen = { phases: new Set(), tokens: 0, closes: 0, rounds: 0, unready: 0, reopened: 0, changed: 0, midSeat: 0, debt: 0 };
  for (let i = 0; i < RUNS; i++) {
    const { s } = fuzzNight(1000 + i, seen);
    seen.phases.add(s.phase);
    seen.tokens += s.history.filter(h => h.token).length;
    seen.rounds += s.history.length;
    if (s.phase === 'close' || s.phase === 'done') seen.closes++;
  }
  // the fuzz must actually reach the interesting places, or passing proves little
  console.log('party fuzz reached:', JSON.stringify({ ...seen, phases: [...seen.phases] }));
  assert.ok(seen.rounds > RUNS, 'rounds settled'); assert.ok(seen.tokens > 0, 'the token'); assert.ok(seen.closes > 0, '收舖');
  assert.ok(seen.unready > 0, 'un-ready during a countdown'); assert.ok(seen.reopened > 0, 'a vote window closed again');
  assert.ok(seen.changed > 0, 'a vote changed inside the window'); assert.ok(seen.midSeat > 0, 'a seat taken mid-round'); assert.ok(seen.debt > 0, 'the till below $0');
});

test('races at the edges: sit/stand storms and vote/ready flips around the 5 s windows keep the night sound', () => {
  for (let k = 0; k < 60; k++) {
    const r = mulberry32(5000 + k), ids = ['a', 'b', 'c', 'd', 'e'];
    let s = C.newNight(5000 + k, {});
    const step = ev => { const o = C.nightInput(s, ev); s = o.s; const errs = C.checkNight(s); if (errs.length) assert.fail(`${k}: ${JSON.stringify(ev)}: ${errs.join('; ')}`); return o; };
    const tick = dt => { s = C.nightTick(s, dt).s; const errs = C.checkNight(s); if (errs.length) assert.fail(`${k}: tick ${dt}: ${errs.join('; ')}`); };
    for (const id of ids) step({ k: 'join', player: id, name: id });
    for (let i = 0; i < 40; i++) step({ k: 'seat', player: ids[Math.floor(r() * 5)], seat: C.PARTY_SEATS[Math.floor(r() * 4)] });
    const owners = Object.values(s.seats).filter(Boolean);
    assert.equal(new Set(owners).size, owners.length, 'one seat per player');
    step({ k: 'start', player: s.host });
    for (let round = 0; round < 3 && s.phase !== 'close'; round++) {
      // everyone votes, then someone flips around the window's edge
      for (const p of C.voters(s)) step({ k: 'vote', player: p.id, card: Math.floor(r() * 3) });
      for (let i = 0; i < 6 && s.phase === 'vote'; i++) {
        tick(4.9 + r() * .2);
        if (s.phase === 'vote') step({ k: 'vote', player: ids[Math.floor(r() * 5)], card: r() < .3 ? null : Math.floor(r() * 3) });
        for (const p of C.voters(s)) if (s.phase === 'vote' && s.wager.votes[p.id] === undefined) step({ k: 'vote', player: p.id, card: 0 });
      }
      if (s.phase === 'vote') tick(5.1);
      assert.equal(s.phase, 'ready', `${k}: the vote closed`);
      // ready flips and seat taps during the countdown
      for (let i = 0; i < 8 && s.phase !== 'round'; i++) {
        for (const p of C.mustReady(s)) if (!s.taps.includes(p.id)) step({ k: 'ready', player: p.id, on: true });
        step({ k: 'start', player: s.host });
        assert.equal(s.phase, 'countdown');
        tick(r() * 4.8);
        const first = C.mustReady(s)[0];
        if (first && r() < .6) { step({ k: 'ready', player: first.id, on: false }); assert.equal(s.phase, 'ready', 'un-ready stops the countdown'); }
        if (r() < .3) step({ k: 'seat', player: ids[Math.floor(r() * 5)], seat: C.PARTY_SEATS[Math.floor(r() * 4)] });
        if (s.phase === 'countdown') tick(5.1);
      }
      if (s.phase !== 'round') { for (const p of C.mustReady(s)) if (!s.taps.includes(p.id)) step({ k: 'ready', player: p.id, on: true }); step({ k: 'start', player: s.host }); tick(5.1); }
      assert.equal(s.phase, 'round');
      s = C.nightResult(s, { round: s.round, team: { revenue: 800, tips: 100, mistakes: 3, angry: 2, maxCombo: 9, fevers: 1, served: 10 }, stations: [], players: [] }).s;
      for (const p of C.counted(s)) step({ k: 'next', player: p.id });
    }
  }
});

test('same seed, same events: the same night, to the byte', () => {
  for (const seed of [11, 12, 13]) {
    const a = fuzzNight(seed), b = fuzzNight(seed);
    assert.equal(JSON.stringify(a.s), JSON.stringify(b.s));
  }
  const x = fuzzNight(21).s, y = fuzzNight(22).s;
  assert.notEqual(JSON.stringify(x), JSON.stringify(y));
});

test('a night survives being handed to a new referee mid-way (host change, option 2): JSON out, JSON in, same result', () => {
  const r = mulberry32(77);
  let s = C.newNight(77, {});
  const events = [];
  for (let i = 0; i < 300; i++) { events.push(randomEvent(s, r)); s = run(s, events.at(-1)).s; }
  let a = C.newNight(77, {}), b;
  for (const [i, e] of events.entries()) {
    a = run(a, e).s;
    if (i === 150) b = JSON.parse(JSON.stringify(a));
    else if (b) b = run(b, e).s;
  }
  assert.equal(JSON.stringify(b), JSON.stringify(a));
  assert.equal(JSON.stringify(a), JSON.stringify(s));
});
