// Party mode in memory: bot teams play whole nights through the night's state machine
// (src/core/party/), the way the referee will drive it (the seam: input / tick / roundResult).
//
// The rounds themselves are real party rounds: a room (tests/sim/coop.js runCoop) runs the shop's
// party round with the director, the team's four players at the shop's first four party seats (樓面's first place,
// 水吧, 廚房, 收銀, as playNight seats them) at a person's speed (human.js, floor-human.js), the computer at the rest
// (樓面's second place, 燒味). The round's money is the room's own (core/party/pay.ts via roomReport): each player's
// pay at their seat, 樓面 at its real share (floorShare x players, clearing and every floor task counted).
// A pool of such rounds is made once per test file (in worker threads) and whole nights draw their rounds from it, so a
// hundred nights cost no more than the pool.
//
// Player models: a person's speed profile (human.js PROFILES), the two in-between teams a halfway mix of their neighbours:
//   struggle  first-timer: a first night
//   x1        halfway between first-timer and mid: the "human x1" team
//   steady    mid: a team with a few nights behind it
//   fluent    halfway between mid and skilled: a practised group
//   sharp     skilled: a strong, well-drilled group
// Each shop of the ladder is calibrated for the team it is for (SHOP_TEAM): its card lines, rent and titles are
// set so that team, playing there, has a fair night. The same team one shop up has a harder one.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { runCoop } from './coop.js';
import { PROFILES } from './human.js';
import { mulberry32, freshCore } from './core.js';

const mix = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, typeof a[k] === 'number' ? (a[k] + b[k]) / 2 : a[k]]));
export const MODELS = { struggle: 'first', x1: mix(PROFILES.first, PROFILES.mid), steady: 'mid', fluent: mix(PROFILES.mid, PROFILES.skilled), sharp: 'skilled' };
/** The team each shop is set for (lowest rung first). */
export const SHOP_TEAM = { estate: 'struggle', central: 'x1', mongkok: 'steady', airport: 'fluent', hell: 'sharp' };
/** The calibration flows (lines.ts LineKind) and how each runs in the shop's rules, at the party's round lengths. */
const PAY = freshCore(), { ROUND_SEC } = PAY;
export const FLOWS = { breakfast: { slot: 'breakfast', sec: ROUND_SEC.breakfast }, lunch: { slot: 'lunch', sec: ROUND_SEC.lunch }, tea: { slot: 'breakfast', sec: ROUND_SEC.tea }, dinner: { slot: 'dinner', sec: ROUND_SEC.dinner } };
const SEAT_COUNT = { waiter: 'served', bar: 'cups', kitchen: 'dishes', till: 'paidCount' };
const FOUR = Object.keys(SEAT_COUNT);

/** One real party round in a shop by a team of four, reduced to what a round report needs. */
export function teamShift({ seed, flow, shop, model }) {
  const f = FLOWS[flow], all = PAY.partySeats(shop), seats = all.filter(k => k !== 'floor2').slice(0, 4);
  const extras = all.filter(s => !FOUR.includes(s) && !/^floor\d$/.test(s));
  const human = Object.fromEntries(seats.map((_, i) => [i, MODELS[model]]));
  const r = runCoop({ seed, seats, slot: f.slot, party: { shop, sec: f.sec, round: 0 }, extraSeats: extras, human, maxSec: f.sec + 20, shape: 'clean' });
  if (r.errs.length) throw new Error(`round ${seed} ${flow} ${shop} ${model}: ${r.errs.join('; ')}`);
  const G = r.room.C.G, t = r.room.C.roomReport().team;
  return {
    revenue: t.revenue, sales: t.sales, tips: t.tips, mistakes: t.mistakes, angry: t.angry, maxCombo: t.maxCombo, fevers: t.fevers, served: t.served,
    seats: { waiter: G.served | 0, bar: G.cups | 0, kitchen: G.dishes | 0, till: G.paidCount | 0 }, burnt: G.burnt | 0,
  };
}

/** A pool cell's key: this team playing in this shop. */
export const cellKey = (shop, model) => `${shop}@${model}`;
/** A pool of real rounds: pool[cellKey(shop, model)][flow] = samples, for each { shop, model } cell. Rounds run in up to
 *  `threads` worker threads (each round is a whole room, about a second); the result does not depend on the threads. */
export async function buildPool({ cells, flows = Object.keys(FLOWS), n, seed0, threads = Math.max(1, Math.min(6, availableParallelism() - 1)) }) {
  const pool = {}, ladder = Object.keys(SHOP_TEAM), models = Object.keys(MODELS), jobs = [];
  for (const { shop, model } of cells) {
    const key = cellKey(shop, model), si = ladder.indexOf(shop) * models.length + models.indexOf(model);
    if (pool[key]) continue;
    pool[key] = {};
    for (const [fi, flow] of flows.entries()) {
      pool[key][flow] = new Array(n);
      for (let i = 0; i < n; i++) jobs.push({ key, flow, i, seed: seed0 + si * 100003 + fi * 10007 + i * 7, shop, model });
    }
  }
  const W = Math.max(1, Math.min(threads, jobs.length));
  await Promise.all(Array.from({ length: W }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(new URL('./party-pool-worker.js', import.meta.url), { workerData: jobs.filter((_, k) => k % W === w) });
    wk.on('message', m => { if (m.err) rej(new Error(m.err)); else pool[m.key][m.flow][m.i] = m.x; });
    wk.on('error', rej);
    wk.on('exit', res);
  })));
  return pool;
}

/** The value of a card's metric in a sample (as core/party/wager.ts metricValue reads a report). */
export const metricOf = (metric, x) => ({ rev: x.revenue, clean: x.mistakes, calm: x.angry, combo: x.maxCombo, tips: x.tips, fever: x.fevers })[metric];

/** How a voter picks a tier (safe, bet, allin), and how much it wants the 孤注一擲 token on 宵夜. */
export const VOTERS = {
  cautious: { tiers: [.6, .3, .1], token: .2 },
  balanced: { tiers: [.3, .45, .25], token: .4 },
  bold: { tiers: [.1, .4, .5], token: .8 },
};
const PERSONALITY = ['balanced', 'cautious', 'bold', 'balanced', 'cautious', 'bold', 'balanced', 'bold'];
const pickW = (w, x) => { let a = 0; for (let i = 0; i < w.length; i++) { a += w[i]; if (x < a) return i; } return w.length - 1; };

/**
 * How long people take on the screens between rounds (nothing there runs on a clock, so the night's length is
 * these pauses plus the rounds). Each is uniform in [lo, hi] seconds, per person, from the moment the screen opens:
 *   read      end card: read the result and the columns, then tap 下一步 (the slowest reader holds the table)
 *   vote      read three cards, talk, tap one
 *   change    the chance that, once everyone has voted, someone changes their vote inside the 5 s window
 *   ready     ready check: look at the till and the card, then tap 我準備好
 *   start     the boss taps 開工 once everyone is ready
 *   close     收舖: the till, the title and the awards read out before 散水 or 再開一日
 * then the 5 s countdown. With four players the slowest of four sets each wait: about 22 s read + 17 s vote + 5 s
 * window + 8 s ready + 2 s + 5 s countdown ≈ 60 s between rounds.
 */
export const PAUSE = { read: [10, 25], vote: [4, 20], change: .15, ready: [2, 10], start: [1, 3], close: [90, 150] };
const between = (rnd, [lo, hi]) => lo + rnd() * (hi - lo);

/**
 * A round report from a sample: the team numbers as they are, the stations' counts as their measures, each seat driven
 * by its player for the whole round. Stars and per-person mistakes are stand-ins (core has no per-station star lines or
 * mistake counters yet): a station's stars come from its count against the pool's median for that seat,
 * and the team's mistakes are split over the seated players at random.
 */
export function reportOf(C, round, x, seats, sec, medians, rnd) {
  // a 樓面 shop's night seats 樓面 where the sample counted the waiter
  const at = seat => (seat === 'waiter' && 'floor1' in seats ? 'floor1' : seat);
  const stations = C.PARTY_SEATS.map(seat => {
    const v = x.seats[seat], med = medians[seat] || 1, id = seats[at(seat)];
    const stars = v >= med * 1.15 ? 3 : v >= med ? 2 : v >= med * .7 ? 1 : 0;
    return { seat: at(seat), kind: at(seat) === seat ? seat : 'floor', stars, measures: [{ key: SEAT_COUNT[seat], label: SEAT_COUNT[seat], value: v }], best: null, drivers: id ? [{ player: id, sec }] : [] };
  });
  const ids = C.PARTY_SEATS.map(s => seats[at(s)]).filter(Boolean), miss = Object.fromEntries(ids.map(id => [id, 0]));
  for (let i = 0; i < x.mistakes && ids.length; i++) miss[ids[Math.floor(rnd() * ids.length)]]++;
  const players = C.PARTY_SEATS.filter(s => seats[at(s)]).map(seat => {
    const id = seats[at(seat)], done = x.seats[seat];
    return { player: id, done, avgSec: done ? sec / done : 0, mistakes: miss[id], burnt: seat === 'kitchen' ? x.burnt : 0, exact: 0, helps: 0, hurries: 0, streak: Math.max(0, done - miss[id] * 3) };
  });
  return { round, team: { revenue: x.revenue, tips: x.tips, mistakes: x.mistakes, angry: x.angry, maxCombo: x.maxCombo, fevers: x.fevers, served: x.served }, stations, players };
}

/** Per-seat medians of a pool cell, for the stand-in stars. */
export function seatMedians(samples) {
  const med = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] || 0; };
  return Object.fromEntries(['waiter', 'bar', 'kitchen', 'till'].map(seat => [seat, med(samples.map(x => x.seats[seat]))]));
}

/**
 * One whole night, start to 散水, through the seam. `players` bots join (the first four sit, the rest watch), vote by
 * personality, tap 下一步, 我準備好 and (the boss) 開工 after human pauses (PAUSE), and the host closes the night at 收舖.
 * `pool` gives each round's real shift (pool[shop][flow]); `churn` makes players drop and come back between and during
 * rounds; `moves` has a seated player move to a free seat now and then while waiting (tap a seat).
 * Returns the final state, every settled round, every round start's plan (its seats), every refusal, the invariant errors seen, the night's length (game
 * seconds from 開工 to 收舖) and the lowest the till went after a round.
 */
export function playNight(C, { seed, pool, cfg = {}, team = null, players = 4, churn = 0, moves = 0, check = false, flowOf = k => (k === 'late' ? 'dinner' : k) }) {
  const rnd = mulberry32(seed ^ 0x51ED), seam = C.partySeam(seed, cfg), model = team ?? SHOP_TEAM[seam.night().cfg.shop];
  const errs = [], rejects = [], seen = [];
  const watch = out => {
    for (const o of out) { if (o.k === 'reject') rejects.push(o.why); if (o.k === 'settled') seen.push(o.record); }
    if (check) for (const e of C.checkNight(seam.night())) errs.push(e);
    return out;
  };
  const ids = Array.from({ length: players }, (_, i) => 'p' + i);
  for (const id of ids) watch(seam.input({ k: 'join', player: id, name: id }));
  // one player a position: 樓面's first place on a 樓面 shop
  for (const [i, seat] of C.partySeats(seam.night().cfg.shop).filter(k => k !== 'floor2').slice(0, 4).entries()) if (ids[i]) watch(seam.input({ k: 'seat', player: ids[i], seat }));
  const starts = [], plans = [];
  const pend = out => { for (const o of watch(out)) if (o.k === 'roundStart') { starts.push(o.plan); plans.push(o.plan); } };
  pend(seam.input({ k: 'start', player: seam.night().host }));
  // Human moves due at night time t: one per (screen, player, what), planned when first needed.
  let due = [], planned = new Set(), screen = '', lowest = Infinity, closeAt = 0;
  const plan = (key, after, ev) => { if (planned.has(key)) return; planned.add(key); due.push({ at: seam.night().t + after, ev }); };
  for (let guard = 0; guard < 20000; guard++) {
    const s = seam.night();
    if (s.phase === 'done') break;
    const here = `${String(s.nights)}:${String(s.round)}:${s.phase === 'countdown' ? 'ready' : s.phase}`;
    if (here !== screen) { screen = here; due = []; planned = new Set(); }
    if (s.phase === 'round') {
      const p0 = starts.shift();
      if (!p0) { errs.push('a round without a plan'); break; }
      // churn: someone drops mid-round and the computer takes over; they come back later
      if (churn && rnd() < churn) { const p = s.players.find(q => q.present && q.seat); if (p) pend(seam.input({ k: 'leave', player: p.id })); }
      pend(seam.tick(p0.sec));
      const cell = pool[cellKey(p0.shop, model)]?.[flowOf(p0.kind)];
      if (!cell) { errs.push(`no pool for ${model} in ${p0.shop}`); break; }
      const x = cell[Math.floor(rnd() * cell.length)];
      pend(seam.roundResult(reportOf(C, p0.round, x, seam.night().seats, p0.sec, seatMedians(cell), rnd)));
      lowest = Math.min(lowest, seam.night().bank);
      continue;
    }
    if (s.phase === 'close') {
      if (!planned.has('close')) { planned.add('close'); closeAt = s.t; pend(seam.tick(between(rnd, PAUSE.close))); continue; }
      const host = s.host;
      if (host) pend(seam.input({ k: 'bye', player: host }));
      else pend(seam.input({ k: 'join', player: 'p0', name: 'p0' }));
      continue;
    }
    const present = s.players.filter(p => p.present);
    if (s.phase === 'endcard') for (const p of present) if (!s.taps.includes(p.id)) plan(`next:${p.id}`, between(rnd, PAUSE.read), { k: 'next', player: p.id });
    if (s.phase === 'vote' && s.wager) {
      const late = C.currentSlot(s)?.kind === 'late';
      for (const [i, p] of s.players.entries()) {
        if (!p.present || s.wager.votes[p.id] !== undefined) continue;
        if (s.cfg.chooser === 'host' && p.id !== s.host) continue;
        const v = VOTERS[PERSONALITY[i % PERSONALITY.length]];
        plan(`vote:${p.id}`, between(rnd, PAUSE.vote), { k: 'vote', player: p.id, card: pickW(v.tiers, rnd()) });
        if (p.seat && late) plan(`token:${p.id}`, between(rnd, PAUSE.vote), { k: 'token', player: p.id, on: rnd() < v.token });
      }
      // inside the change window, now and then someone switches to another card
      if (s.wager.allAt !== null && !planned.has('change')) {
        planned.add('change');
        const p = present[Math.floor(rnd() * present.length)];
        if (p && rnd() < PAUSE.change && (s.cfg.chooser === 'vote' || p.id === s.host)) due.push({ at: s.t + rnd() * 4, ev: { k: 'vote', player: p.id, card: Math.floor(rnd() * 3) } });
      }
    }
    if (s.phase === 'countdown') planned.delete('start');   // back in the ready check, the boss starts again
    if (s.phase === 'ready') {
      for (const p of C.mustReady(s)) if (!s.taps.includes(p.id)) plan(`ready:${p.id}`, between(rnd, PAUSE.ready), { k: 'ready', player: p.id, on: true });
      if (C.allReady(s) && s.host) plan('start', between(rnd, PAUSE.start), { k: 'start', player: s.host });
      // a room of onlookers has no host until someone sits: one of them taps a free seat, as people would
      if (!s.host) {
        const p = s.players.find(q => q.present && !q.seat), free = Object.keys(s.seats).find(k => s.seats[k] === null);
        if (p && free) plan(`sit:${p.id}`, between(rnd, PAUSE.ready), { k: 'seat', player: p.id, seat: free });
      }
      if (moves && !planned.has('move')) {
        planned.add('move');
        const p = s.players.find(q => q.present && q.seat), free = Object.keys(s.seats).find(k => s.seats[k] === null);
        if (p && free && rnd() < moves) { pend(seam.input({ k: 'seat', player: p.id, seat: free })); planned.delete(`ready:${p.id}`); }
      }
    }
    if (churn && rnd() < churn / 20) {
      const away = s.players.find(p => !p.present);
      if (away) { pend(seam.input({ k: 'join', player: away.id, name: away.name })); planned.delete(`ready:${away.id}`); planned.delete(`sit:${away.id}`); }
      else if (present.length > 1 && rnd() < .5) pend(seam.input({ k: 'leave', player: present[present.length - 1].id }));
    }
    // a start refused (someone un-readied or sat down since) is planned again
    // fire what is due, else let a second pass
    const now = seam.night().t, fire = due.filter(d => d.at <= now);
    due = due.filter(d => d.at > now);
    for (const d of fire) {
      const out = seam.input(d.ev);
      if (d.ev.k === 'start' && out.some(o => o.k === 'reject')) planned.delete('start');
      if (d.ev.k === 'next' || d.ev.k === 'ready' || d.ev.k === 'vote') { if (out.some(o => o.k === 'reject')) planned.delete(`${d.ev.k}:${d.ev.player}`); }
      // a seat taken (or refused) starts that player's ready check again (sitting clears an earlier tap)
      if (d.ev.k === 'seat') { planned.delete(`ready:${d.ev.player}`); planned.delete(`sit:${d.ev.player}`); }
      pend(out);
    }
    if (!fire.length) pend(seam.tick(1));
  }
  const s = seam.night();
  if (s.phase !== 'done') errs.push(`the night never ended (phase ${s.phase}, round ${String(s.round)})`);
  return { s, rounds: seen, plans, errs, rejects, sec: s.t, lowest, closeSec: s.t - closeAt };
}
