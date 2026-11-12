// Small helpers for the party unit tests: a night with seated players, a hand-made round report, and a driver that
// walks the night to a given phase. Every step is checked with checkNight (the invariants of src/core/party/night.ts).
import assert from 'node:assert/strict';

/** A seam whose every step is checked. `outs` collects everything the night asked of the referee. */
export function checked(C, seed = 1, cfg = {}, prevBank = null) {
  const seam = C.partySeam(seed, cfg, prevBank), outs = [];
  const guard = out => { assert.deepEqual(C.checkNight(seam.night()), [], 'invariants after a step'); outs.push(...out); return out; };
  return {
    seam, outs,
    get s() { return seam.night(); },
    input: ev => guard(seam.input(ev)),
    tick: dt => guard(seam.tick(dt)),
    result: r => guard(seam.roundResult(r)),
    voters: () => C.voters(seam.night()),
    counted: () => C.counted(seam.night()),
    mustReady: () => C.mustReady(seam.night()),
  };
}

/** Players p0..p(n-1) join; the first four take 樓面's first place, bar, kitchen, till; the rest watch. */
export function seated(C, n, cfg = {}, seed = 1) {
  const N = checked(C, seed, cfg);
  for (let i = 0; i < n; i++) N.input({ k: 'join', player: 'p' + i, name: '阿' + i });
  const four = C.partySeats(N.s.cfg.shop).filter(k => k !== 'floor2').slice(0, 4);
  for (let i = 0; i < Math.min(n, 4); i++) N.input({ k: 'seat', player: 'p' + i, seat: four[i] });
  return N;
}

/** A round report: team numbers (defaults: a middling round), every seat driven the whole round by whoever sits there. */
export function report(N, team = {}, o = {}) {
  const s = N.s, sec = C_SEC(s);
  const seats = o.seats ?? s.seats;
  return {
    round: o.round ?? s.round,
    team: { revenue: 1500, tips: 400, mistakes: 6, angry: 3, maxCombo: 15, fevers: 2, served: 20, ...team },
    stations: Object.keys(s.seats).map(seat => ({
      seat, kind: /^floor\d$/.test(seat) ? 'floor' : seat, stars: o.stars?.[seat] ?? 2, measures: [{ key: 'n', label: '件數', value: 10 }], best: null,
      drivers: seats[seat] ? [{ player: seats[seat], sec }] : [],
    })),
    players: o.players ?? Object.values(seats).filter(Boolean).map(id => ({ player: id, done: 10, avgSec: 6, mistakes: 1, burnt: 0, exact: 0, helps: 0, hurries: 0, streak: 5 })),
  };
}
const C_SEC = s => s.schedule[s.round]?.sec ?? 180;

/** Ticks one second at a time until the night is in `phase` (or fails after `max` seconds). */
export function until(N, phase, max = 200) {
  for (let i = 0; i < max && N.s.phase !== phase; i++) N.tick(1);
  assert.equal(N.s.phase, phase, `reached ${phase}`);
}

/** Everyone who must vote votes `card` (default 0) unless they already did; then the 5 s change window runs out. */
export function voteAll(N, card = 0) {
  for (const p of N.voters()) if (N.s.wager.votes[p.id] === undefined) N.input({ k: 'vote', player: p.id, card });
  N.tick(5);
}
/** The ready check: every seated player taps 我準備好, the host starts, the 5 s countdown runs. */
export function readyGo(N) {
  for (const p of N.mustReady()) if (!N.s.taps.includes(p.id)) N.input({ k: 'ready', player: p.id, on: true });
  N.input({ k: 'start', player: N.s.host });
  N.tick(5);
}
/** Every counted player taps 下一步 on the end card. */
export function nextAll(N) {
  for (const p of N.counted()) if (!N.s.taps.includes(p.id)) N.input({ k: 'next', player: p.id });
}

/** Plays the current round to its result with this team line (from the vote: everyone votes `card`; from the ready check: on). */
export function playRound(N, team = {}, o = {}) {
  if (N.s.phase === 'endcard') nextAll(N);
  if (N.s.phase === 'vote') voteAll(N, o.card ?? 0);
  if (N.s.phase === 'ready' || N.s.phase === 'countdown') readyGo(N);
  assert.equal(N.s.phase, 'round', 'reached the round');
  return N.result(report(N, team, o));
}
