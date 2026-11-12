// Party mode, unit by unit: the night's state machine through every
// phase, including the unhappy paths (tied and empty votes, a player leaving mid-vote, late joiners, the host leaving,
// the shared till going broke), seats any time, the votes' change window, the ready check, the shop ladder, the end card
// and 收舖 with one and with eight players.
// Every step goes through checkNight (party-kit.js), so each test also proves the invariants held all the way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshCore } from './core.js';
import { checked, seated, report, until, playRound, voteAll, readyGo, nextAll } from './party-kit.js';

const C = freshCore();
const kinds = s => s.schedule.map(r => r.kind).join(' ');
const ALL_MET = { revenue: 20000, mistakes: 0, angry: 0, maxCombo: 99, tips: 9999, fevers: 9 };
const NONE_MET = { revenue: 1000, mistakes: 99, angry: 99, maxCombo: 0, tips: 0, fevers: 0 };

// ---------------------------------------------------------------- the shop ladder

test('shop ladder: five of the game\'s own levels, lowest first, each pace exactly the level\'s (ui/levels.ts)', () => {
  assert.deepEqual([...C.SHOP_LADDER], ['estate', 'central', 'mongkok', 'airport', 'hell']);   // the solo ladder's order
  const src = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'ui', 'levels.ts'), 'utf8');
  for (const id of C.SHOP_LADDER) {
    const at = src.search(new RegExp(`(^\\s*${id}:\\s*\\{|LEVELS\\.${id}\\s*=\\s*\\{)`, 'm'));
    assert.ok(at >= 0, `level ${id} in ui/levels.ts`);
    const line = src.slice(at, src.indexOf('stars:', at));   // the level's entry up to its stars (gap, pat, burn come before)
    const num = k => { const m = line.match(new RegExp(`\\b${k}:\\s*([0-9.]+)`)); return m ? Number(m[1]) : null; };
    const p = C.PARTY_SHOPS[id].pace;
    assert.equal(p.gap, num('gap'), `${id} gap`); assert.equal(p.pat, num('pat'), `${id} pat`); assert.equal(p.burn, num('burn'), `${id} burn`);
  }
  assert.equal(C.shopUp('estate'), 'central'); assert.equal(C.shopUp('hell'), 'hell', 'the top stays');
  // the shop sets the pace on the 熟手 base, as the game's levelDiff does
  const d = C.shopDifficulty(C.DIFFS.pro, 'hell');
  assert.equal(d.gap, 1.5); assert.equal(d.pat, .75); assert.equal(d.burn, .6); assert.equal(d.slow, C.DIFFS.pro.slow);
  assert.equal('burn' in C.shopDifficulty(C.DIFFS.pro, 'estate'), 'burn' in C.DIFFS.pro);
});

test('schedule: one day is five shifts in one shop, no 試更; two days are the same five twice, in the same shop', () => {
  const one = C.partySchedule({ shop: 'estate', days: 1, chooser: 'vote' });
  assert.equal(one.map(r => r.kind).join(' '), 'breakfast lunch tea dinner late');
  assert.deepEqual(one.map(r => r.sec), [240, 240, 150, 240, 240]);
  assert.deepEqual([...new Set(one.map(r => r.shop))], ['estate']);
  const two = C.partySchedule({ shop: 'mongkok', days: 2, chooser: 'vote' });
  assert.equal(two.length, 10);
  assert.deepEqual(two.map(r => `${r.day}:${r.shop}`), [...Array(5).fill('1:mongkok'), ...Array(5).fill('2:mongkok')]);
});

test('the round plan carries the shop and its pace to the referee', () => {
  const N = seated(C, 2, { shop: 'airport' });
  N.input({ k: 'start', player: 'p0' });
  voteAll(N); readyGo(N);
  const plan = N.outs.find(o => o.k === 'roundStart').plan;
  assert.equal(plan.shop, 'airport'); assert.deepEqual(plan.pace, C.PARTY_SHOPS.airport.pace); assert.equal(plan.kind, 'breakfast');
  assert.equal(plan.sec, 240); assert.ok(plan.card);
});

test('lobby: the first phone is the host; only the host sets up and opens; a bad setup falls back to the defaults', () => {
  const N = seated(C, 3);
  assert.equal(N.s.host, 'p0');
  assert.deepEqual(N.s.cfg, C.DEFAULT_NIGHT);
  assert.equal(N.input({ k: 'setup', player: 'p1', cfg: { days: 2 } })[0].k, 'reject');
  assert.equal(N.input({ k: 'start', player: 'p1' })[0].k, 'reject');
  N.input({ k: 'setup', player: 'p0', cfg: { days: 2, shop: 'nowhere', chooser: 'mob', warmup: true } });
  assert.deepEqual(N.s.cfg, { shop: 'estate', days: 2, chooser: 'vote' });
  N.input({ k: 'setup', player: 'p0', cfg: { shop: 'central' } });
  assert.equal(N.s.cfg.shop, 'central');
  assert.equal(kinds(N.s).split(' ').length, 10);
  assert.equal(N.s.bank, C.startTill('central', 'breakfast'), 'the till opens with the shop\'s float');
  assert.equal(N.input({ k: 'vote', player: 'p0', card: 0 })[0].k, 'reject', 'no vote in the lobby');
  N.input({ k: 'start', player: 'p0' });
  assert.equal(N.s.phase, 'vote', '開工 goes straight to the first vote: no 試更, no countdown first');
  assert.equal(N.input({ k: 'setup', player: 'p0', cfg: { days: 1 } })[0].k, 'reject', 'no setup after 開工');
});

// ---------------------------------------------------------------- seats

test('seats: tap a free seat to sit, tap your own to stand up, a taken seat is refused; in any phase but 收舖', () => {
  const N = checked(C);
  for (const id of ['a', 'b', 'c']) N.input({ k: 'join', player: id, name: id });
  assert.deepEqual(N.s.seats, { floor1: null, floor2: null, bar: null, kitchen: null, till: null }, 'nobody is seated on joining');
  N.input({ k: 'seat', player: 'a', seat: 'bar' });
  assert.equal(N.s.seats.bar, 'a');
  N.input({ k: 'seat', player: 'a', seat: 'till' });
  assert.equal(N.s.seats.bar, null); assert.equal(N.s.seats.till, 'a', 'a free seat: moves, leaving the old one');
  assert.equal(N.input({ k: 'seat', player: 'b', seat: 'till' })[0].why, 'that seat is taken');
  N.input({ k: 'seat', player: 'a', seat: 'till' });
  assert.equal(N.s.seats.till, null); assert.equal(N.s.players.find(p => p.id === 'a').seat, null, 'own seat again: stands up');
  assert.equal(N.input({ k: 'seat', player: 'a', seat: 'roof' })[0].why, 'no such seat');
  // in every phase of a round
  N.input({ k: 'seat', player: 'a', seat: 'floor1' }); N.input({ k: 'seat', player: 'b', seat: 'bar' });
  N.input({ k: 'start', player: 'a' });
  N.input({ k: 'seat', player: 'c', seat: 'kitchen' });
  assert.equal(N.s.seats.kitchen, 'c', 'in the vote');
  voteAll(N);
  N.input({ k: 'seat', player: 'c', seat: 'kitchen' });
  assert.equal(N.s.seats.kitchen, null, 'in the ready check');
  readyGo(N);
  assert.equal(N.s.phase, 'round');
  const n0 = N.outs.length;
  N.input({ k: 'seat', player: 'b', seat: 'till' });
  assert.deepEqual(N.outs.slice(n0).filter(o => o.k === 'drive').map(o => [o.seat, o.player]), [['bar', null], ['till', 'b']], 'mid-round the referee hands the leases over');
  N.result(report(N));
  N.input({ k: 'seat', player: 'c', seat: 'bar' });
  assert.equal(N.s.seats.bar, 'c', 'on the end card');
});

test('seat races: two taps on one free seat, the first wins and the second is told; a stand and a sit in one step', () => {
  const N = checked(C);
  for (const id of ['a', 'b']) N.input({ k: 'join', player: id, name: id });
  N.input({ k: 'seat', player: 'a', seat: 'bar' });
  assert.equal(N.input({ k: 'seat', player: 'b', seat: 'bar' })[0].why, 'that seat is taken');
  N.input({ k: 'seat', player: 'a', seat: 'bar' });   // a stands up
  N.input({ k: 'seat', player: 'b', seat: 'bar' });   // b sits straight after
  assert.equal(N.s.seats.bar, 'b');
  assert.equal(N.input({ k: 'seat', player: 'zz', seat: 'bar' })[0].why, 'not here');
});

// ---------------------------------------------------------------- votes

test('vote rules: most votes win; a tie goes to the host\'s card; a tie the host is not in goes to the safer card; none is 穩陣', () => {
  assert.equal(C.resolveVote([2, 2, 1], 1, 3), 2);
  assert.equal(C.resolveVote([2, 1], 1, 3), 1, 'tie, host voted 1');
  assert.equal(C.resolveVote([2, 1, 0, 0, 1, 2], null, 3), 0, 'three-way tie, no host vote: safest');
  assert.equal(C.resolveVote([2, 1], 0, 3), 1, 'tie between 1 and 2, host voted 0: the safer of the tied');
  assert.equal(C.resolveVote([], null, 3), 0);
  assert.equal(C.resolveVote([7, -1, 1.5], null, 3), 0, 'junk votes count for nothing');
  assert.equal(C.crowdVote([2, 2, 1]), 2);
  assert.equal(C.crowdVote([2, 1]), null);
});

test('vote on the night: no clock until everyone has voted; then 5 s in which anyone may change; changes do not restart it', () => {
  const N = seated(C, 4);
  N.input({ k: 'start', player: 'p0' });
  for (const p of ['p0', 'p1', 'p2']) N.input({ k: 'vote', player: p, card: 2 });
  N.tick(3600);
  assert.equal(N.s.phase, 'vote', 'an hour later it still waits for p3: no time pressure');
  assert.equal(N.s.wager.allAt, null);
  N.input({ k: 'vote', player: 'p3', card: 1 });
  assert.equal(N.s.wager.allAt, N.s.phaseT, 'all voted: the window opens');
  N.tick(3);
  N.input({ k: 'vote', player: 'p0', card: 1 }); N.input({ k: 'vote', player: 'p1', card: 1 });   // change inside the window
  N.tick(1.9);
  assert.equal(N.s.phase, 'vote');
  N.tick(.2);
  assert.equal(N.s.phase, 'ready');
  assert.equal(N.s.wager.chosen, 1, 'the changed votes count: 3 for card 1');
});

test('vote: un-voting inside the window closes it again; voting back reopens a fresh 5 s', () => {
  const N = seated(C, 2);
  N.input({ k: 'start', player: 'p0' });
  N.input({ k: 'vote', player: 'p0', card: 0 }); N.input({ k: 'vote', player: 'p1', card: 2 });
  N.tick(4);
  N.input({ k: 'vote', player: 'p1', card: null });
  assert.equal(N.s.wager.allAt, null);
  N.tick(100);
  assert.equal(N.s.phase, 'vote');
  N.input({ k: 'vote', player: 'p1', card: 2 });
  N.tick(4.9); assert.equal(N.s.phase, 'vote');
  N.tick(.2); assert.equal(N.s.phase, 'ready');
  assert.equal(N.s.wager.chosen, 0, '1-1: the host\'s card');
});

test('vote: a new sitter must vote too (the window closes until they do); onlookers never hold the vote', () => {
  const N = seated(C, 3);
  N.input({ k: 'watch', player: 'p2' });
  N.input({ k: 'start', player: 'p0' });
  N.input({ k: 'vote', player: 'p0', card: 1 }); N.input({ k: 'vote', player: 'p1', card: 1 });
  assert.notEqual(N.s.wager.allAt, null, 'the onlooker p2 is not waited for');
  N.input({ k: 'seat', player: 'p2', seat: 'till' });
  assert.equal(N.s.wager.allAt, null, 'p2 sat down: now they count');
  N.input({ k: 'vote', player: 'p2', card: 2 });
  N.tick(5.1);
  assert.equal(N.s.wager.chosen, 1);
});

test('vote tie on the night: two against two, the host breaks it', () => {
  const N = seated(C, 4);
  N.input({ k: 'start', player: 'p0' });
  N.input({ k: 'vote', player: 'p0', card: 1 }); N.input({ k: 'vote', player: 'p1', card: 1 });
  N.input({ k: 'vote', player: 'p2', card: 2 }); N.input({ k: 'vote', player: 'p3', card: 2 });
  N.tick(5.1);
  assert.equal(N.s.wager.chosen, 1);
});

test('leavers mid-vote: their vote goes and they no longer count; if they were the last one missing the window opens', () => {
  const N = seated(C, 3);
  N.input({ k: 'start', player: 'p0' });
  N.input({ k: 'vote', player: 'p1', card: 2 }); N.input({ k: 'vote', player: 'p2', card: 2 });
  N.input({ k: 'vote', player: 'p0', card: 1 });
  N.tick(1);
  N.input({ k: 'leave', player: 'p2' });
  assert.equal(N.s.wager.votes.p2, undefined);
  assert.equal(N.s.seats.bar, 'p1'); assert.equal(N.s.seats.kitchen, null, 'the computer takes the seat');
  N.tick(5.1);
  assert.equal(N.s.phase, 'ready');
  assert.equal(N.s.wager.chosen, 1, '1 vs 1 now: the host (p0) breaks the tie');
  // the one nobody was waiting on leaves: the rest have all voted, the window opens
  const M = seated(C, 3);
  M.input({ k: 'start', player: 'p0' });
  M.input({ k: 'vote', player: 'p0', card: 2 }); M.input({ k: 'vote', player: 'p1', card: 2 });
  assert.equal(M.s.wager.allAt, null);
  M.input({ k: 'leave', player: 'p2' });
  assert.notEqual(M.s.wager.allAt, null);
  M.tick(5.1);
  assert.equal(M.s.wager.chosen, 2);
});

test('the host leaving mid-vote: host duty passes to the earliest phone still here, who now breaks ties', () => {
  const N = seated(C, 3);
  N.input({ k: 'start', player: 'p0' });
  N.input({ k: 'leave', player: 'p0' });
  assert.equal(N.s.host, 'p1');
  assert.ok(N.outs.some(o => o.k === 'host' && o.player === 'p1'));
  N.input({ k: 'vote', player: 'p1', card: 0 }); N.input({ k: 'vote', player: 'p2', card: 2 });
  N.tick(5.1);
  assert.equal(N.s.wager.chosen, 0);
});

// Host duty is never handed to someone without a seat (an onlooker or a TV); with nobody seated the night waits
// with no host, and the first to sit becomes it.
test('host hand-over goes to a seated player only; with nobody seated there is no host until someone sits', () => {
  const N = checked(C);
  N.input({ k: 'join', player: 'p0', name: '開房' });
  assert.equal(N.s.host, 'p0', 'the opener hosts before anyone sits');
  N.input({ k: 'join', player: 'w1', name: '睇戲' });      // joined second, never sits
  N.input({ k: 'join', player: 'p2', name: '坐低' });
  N.input({ k: 'seat', player: 'p2', seat: 'bar' });
  N.input({ k: 'leave', player: 'p0' });
  assert.equal(N.s.host, 'p2', 'the seated player, not the earlier onlooker');
  N.input({ k: 'leave', player: 'p2' });
  assert.equal(N.s.host, null, 'only an onlooker is left: no host');
  assert.equal(N.input({ k: 'start', player: 'w1' })[0].why, 'only the host opens the shop');
  N.input({ k: 'seat', player: 'w1', seat: 'till' });
  assert.equal(N.s.host, 'w1', 'the first to sit hosts');
  assert.ok(N.outs.some(o => o.k === 'host' && o.player === 'w1'));
});

test('老闆話事: only the host votes, with the same 5 s to change; the host has all the time they need', () => {
  const N = seated(C, 3, { chooser: 'host' });
  N.input({ k: 'start', player: 'p0' });
  assert.equal(N.input({ k: 'vote', player: 'p1', card: 2 })[0].why, 'the host decides tonight');
  N.tick(600);
  assert.equal(N.s.phase, 'vote', 'no timer picks for the boss');
  N.input({ k: 'vote', player: 'p0', card: 2 });
  N.tick(5.1);
  assert.equal(N.s.wager.chosen, 2);
});

test('onlookers vote as one crowd: four onlookers cannot outvote two seated players', () => {
  const N = seated(C, 6);
  N.input({ k: 'watch', player: 'p2' }); N.input({ k: 'watch', player: 'p3' });   // 2 seated, 4 onlookers
  N.input({ k: 'start', player: 'p0' });
  N.input({ k: 'vote', player: 'p0', card: 1 }); N.input({ k: 'vote', player: 'p1', card: 1 });
  for (const p of ['p2', 'p3', 'p4', 'p5']) N.input({ k: 'vote', player: p, card: 2 });
  N.tick(5.1);
  assert.equal(N.s.wager.chosen, 1);
});

test('nobody seated: everyone in the room votes and must tap 下一步; the ready check has no one to wait for', () => {
  const N = checked(C);
  for (const id of ['a', 'b']) N.input({ k: 'join', player: id, name: id });
  N.input({ k: 'start', player: 'a' });
  assert.deepEqual(N.voters().map(p => p.id), ['a', 'b']);
  N.input({ k: 'vote', player: 'a', card: 1 });
  N.tick(30); assert.equal(N.s.phase, 'vote');
  N.input({ k: 'vote', player: 'b', card: 1 });
  N.tick(5.1);
  assert.equal(N.s.phase, 'ready');
  assert.equal(C.allReady(N.s), true, 'all four seats are the computer\'s: all ready');
  N.input({ k: 'start', player: 'a' });
  assert.equal(N.s.phase, 'countdown');
});

// ---------------------------------------------------------------- the ready check

test('ready check: the boss cannot start while anyone seated is not ready; computer seats count as ready', () => {
  const N = seated(C, 3);   // till is the computer's
  N.input({ k: 'start', player: 'p0' });
  voteAll(N);
  assert.equal(N.s.phase, 'ready');
  N.tick(3600);
  assert.equal(N.s.phase, 'ready', 'no clock: rest as long as you like');
  assert.equal(N.input({ k: 'start', player: 'p0' })[0].why, 'not everyone is ready');
  N.input({ k: 'ready', player: 'p0', on: true }); N.input({ k: 'ready', player: 'p1', on: true });
  assert.equal(C.allReady(N.s), false);
  N.input({ k: 'ready', player: 'p2', on: true });
  assert.equal(C.allReady(N.s), true, 'three seated ready; the computer\'s till needs no tap');
  assert.equal(N.input({ k: 'start', player: 'p1' })[0].why, 'only the host starts the round');
  N.input({ k: 'start', player: 'p0' });
  assert.equal(N.s.phase, 'countdown');
  N.tick(4.9); assert.equal(N.s.phase, 'countdown');
  N.tick(.2); assert.equal(N.s.phase, 'round');
});

test('ready check: un-ready during the countdown sends it back to waiting; the others stay ready', () => {
  const N = seated(C, 3);
  N.input({ k: 'start', player: 'p0' });
  voteAll(N);
  for (const p of ['p0', 'p1', 'p2']) N.input({ k: 'ready', player: p, on: true });
  N.input({ k: 'start', player: 'p0' });
  N.tick(3);
  N.input({ k: 'ready', player: 'p1', on: false });
  assert.equal(N.s.phase, 'ready');
  assert.deepEqual([...N.s.taps].sort(), ['p0', 'p2']);
  N.tick(60); assert.equal(N.s.phase, 'ready');
  N.input({ k: 'ready', player: 'p1', on: true });
  assert.equal(N.s.phase, 'ready', 'ready again does not restart on its own: the boss starts');
  N.input({ k: 'start', player: 'p0' });
  N.tick(5.1);
  assert.equal(N.s.phase, 'round');
});

test('ready check: someone sitting down during the countdown stops it; someone standing up does not', () => {
  const N = seated(C, 4);
  N.input({ k: 'watch', player: 'p3' });
  N.input({ k: 'start', player: 'p0' });
  voteAll(N);
  for (const p of ['p0', 'p1', 'p2']) N.input({ k: 'ready', player: p, on: true });
  N.input({ k: 'start', player: 'p0' });
  N.input({ k: 'seat', player: 'p2', seat: 'kitchen' });   // p2 stands up: the computer takes kitchen, still all ready
  assert.equal(N.s.phase, 'countdown');
  N.input({ k: 'seat', player: 'p3', seat: 'till' });
  assert.equal(N.s.phase, 'ready', 'p3 sat down and is not ready');
  N.input({ k: 'ready', player: 'p3', on: true });
  N.input({ k: 'start', player: 'p0' });
  N.tick(5.1);
  assert.equal(N.s.phase, 'round');
});

test('ready check: a player leaving makes the rest ready; a joiner watches and does not block; a returner gets their seat back and must tap', () => {
  const N = seated(C, 3);
  N.input({ k: 'start', player: 'p0' });
  voteAll(N);
  N.input({ k: 'ready', player: 'p0', on: true }); N.input({ k: 'ready', player: 'p1', on: true });
  N.input({ k: 'leave', player: 'p2' });
  assert.equal(C.allReady(N.s), true, 'p2 left: their seat is the computer\'s, which counts as ready');
  N.input({ k: 'join', player: 'p9', name: '新嚟' });
  assert.equal(C.allReady(N.s), true, 'a newcomer watches until they tap a seat');
  N.input({ k: 'join', player: 'p2', name: '' });
  assert.equal(N.s.seats.kitchen, 'p2', 'back while the computer still runs it: the seat is theirs again');
  assert.equal(C.allReady(N.s), false);
  assert.equal(N.input({ k: 'start', player: 'p0' })[0].why, 'not everyone is ready');
  N.input({ k: 'ready', player: 'p2', on: true });
  N.input({ k: 'start', player: 'p0' });
  // the host leaves during the countdown: it still runs (everyone left is ready), and host duty moves on
  N.input({ k: 'leave', player: 'p0' });
  assert.equal(N.s.phase, 'countdown'); assert.equal(N.s.host, 'p1');
  N.tick(5.1);
  assert.equal(N.s.phase, 'round');
});

test('ready check: taps outside it are refused; onlookers may tap but are never waited for', () => {
  const N = seated(C, 5);
  N.input({ k: 'start', player: 'p0' });
  assert.equal(N.input({ k: 'ready', player: 'p0', on: true })[0].why, 'no ready check');
  voteAll(N);
  N.input({ k: 'ready', player: 'p4', on: true });
  assert.deepEqual(C.mustReady(N.s).map(p => p.id), ['p0', 'p1', 'p2', 'p3']);
  readyGo(N);
  assert.equal(N.s.phase, 'round');
});

// ---------------------------------------------------------------- the shared till

test('rent: per shop and round flow, a round number, more in busier shops\' busy rounds; the till opens with one rent (two at the first shop)', () => {
  for (const shop of C.SHOP_LADDER) for (const kind of C.DAY_KINDS) {
    const r = C.rentFor(shop, kind);
    assert.ok(r >= C.RENT_STEP && r % C.RENT_STEP === 0, `${shop} ${kind}: ${r}`);
    const q = C.quantilesOf(shop, kind, 'rev');
    assert.ok(Math.abs(1 - C.uAtLeast(q, r) - (1 - C.RENT_Q)) < .12, `${shop} ${kind}: the shop's own team takes the rent in about ${(1 - C.RENT_Q) * 100}% of its rounds`);
  }
  assert.equal(C.startTill('mongkok', 'breakfast'), C.rentFor('mongkok', 'breakfast'));
  assert.equal(C.startTill('estate', 'breakfast'), 2 * C.rentFor('estate', 'breakfast'), 'the first shop opens with two rents');
});

test('the till: takings + card − rent each round; the token doubles the card once a night; 宵夜 doubles nothing', () => {
  const N = seated(C, 4, { shop: 'mongkok' });
  const start = N.s.bank;
  N.input({ k: 'start', player: 'p0' });
  playRound(N, NONE_MET, { card: 2 });
  let r = N.s.history.at(-1);
  assert.equal(r.met, false); assert.equal(r.cardDelta, -800); assert.equal(r.rent, C.rentFor('mongkok', 'breakfast'));
  assert.equal(N.s.bank, start + 1000 - 800 - r.rent); assert.equal(r.bankBefore, start); assert.equal(r.bankAfter, N.s.bank);
  nextAll(N);
  // the token: needs more than half the seated players
  N.input({ k: 'token', player: 'p0', on: true }); N.input({ k: 'token', player: 'p1', on: true });
  playRound(N, ALL_MET, { card: 1 });
  r = N.s.history.at(-1);
  assert.equal(r.token, false, '2 of 4 is not more than half'); assert.equal(r.cardDelta, 800);
  nextAll(N);
  for (const p of ['p0', 'p1', 'p2']) N.input({ k: 'token', player: p, on: true });
  playRound(N, ALL_MET, { card: 0 });
  r = N.s.history.at(-1);
  assert.equal(r.token, true); assert.equal(r.cardDelta, 600); assert.equal(N.s.tokenUsed, true);
  nextAll(N);
  assert.equal(N.input({ k: 'token', player: 'p0', on: true })[0].why, 'the token is spent');
  playRound(N, { revenue: 500 }, { card: 0 });
  nextAll(N);
  assert.equal(C.currentSlot(N.s).kind, 'late');
  playRound(N, ALL_MET, { card: 2 });
  r = N.s.history.at(-1);
  assert.equal(r.cardDelta, 3600, '宵夜 pays as any round');
  assert.equal(N.s.bank, N.s.book.start + N.s.book.takings + N.s.book.cards - N.s.book.rent);
  assert.equal(N.s.history.reduce((a, x) => a + x.rent, 0), N.s.book.rent);
});

test('the till may go below $0 mid-night (欠租) and recover; the next lines get easier after a bad round', () => {
  const N = seated(C, 2, { shop: 'mongkok' });
  N.input({ k: 'start', player: 'p0' });
  playRound(N, { ...NONE_MET, revenue: 0 }, { card: 2 });
  assert.ok(N.s.bank < 0, `in debt: ${N.s.bank}`);
  assert.equal(N.s.phase, 'endcard', 'the night goes on');
  nextAll(N);
  for (const c of N.s.wager.cards) assert.ok(c.aim >= C.TIER_AIM[c.tier], `${c.tier} ${c.metric} aim ${c.aim}`);
  assert.ok(N.s.wager.cards.some(c => c.aim > C.TIER_AIM[c.tier]));
  playRound(N, { ...ALL_MET, revenue: 5000 }, { card: 2 });
  assert.ok(N.s.bank > 0, 'recovered');
  assert.ok(!Object.is(N.s.history[0].cardDelta, -0));
});

test('收舖 below $0: the shop folds (執笠), no title, no climb; awards still go out', () => {
  const N = wholeNight(2, { ...NONE_MET, revenue: 0 }, { shop: 'central' });
  const close = C.closeCard(N.s);
  assert.ok(N.s.bank < 0);
  assert.equal(close.folded, true); assert.equal(close.title, C.FOLD_TITLE); assert.equal(close.titleIx, -1);
  assert.equal(close.nextShop, null); assert.equal(C.climbTo(N.s), 'central');
  assert.ok(close.people.every(p => p.awards.length >= 1));
  N.input({ k: 'again', player: 'p0' });
  assert.equal(N.s.cfg.shop, 'central', 'folded: the same shop again'); assert.equal(N.s.climbed, null);
});

test('climb: 排隊名店 or better moves 再開一日 one shop up, noted in the lobby; the top stays at the top', () => {
  const N = wholeNight(2, { ...ALL_MET, revenue: 99999 }, { shop: 'estate' });
  const close = C.closeCard(N.s);
  assert.ok(close.titleIx >= C.CLIMB_TITLE);
  assert.equal(close.nextShop, C.PARTY_SHOPS.central.name);   // the solo ladder's order
  N.input({ k: 'again', player: 'p0' });
  assert.equal(N.s.cfg.shop, 'central'); assert.equal(N.s.climbed, 'estate');
  assert.equal(N.s.bank, C.startTill('central', 'breakfast'));
  assert.deepEqual(Object.keys(N.s.seats), C.partySeats('central'), 'one shop up: its 傳菜 joins the seats');
  N.input({ k: 'setup', player: 'p0', cfg: { shop: 'estate' } });
  assert.equal(N.s.climbed, null, 'the boss can still pick any shop');
  const T = wholeNight(1, { ...ALL_MET, revenue: 99999 }, { shop: 'hell' });
  assert.equal(C.closeCard(T.s).nextShop, null); assert.equal(C.climbTo(T.s), 'hell');
  // a middling night stays put
  const M = wholeNight(2, { revenue: 0 }, { shop: 'estate' });
  if (C.closeCard(M.s).titleIx < C.CLIMB_TITLE) assert.equal(C.climbTo(M.s), 'estate');
});

test('follow the team: a strong round makes the next lines harder, capped; a median round barely moves them', () => {
  const last = { kind: 'breakfast', shop: 'mongkok', team: { revenue: 99999, tips: 9999, mistakes: 0, angry: 0, maxCombo: 99, fevers: 9, served: 50 } };
  for (const m of C.PARTY_METRICS) for (const t of ['safe', 'bet', 'allin']) {
    const a = C.aimFor(t, m, last);
    // with fewer customers a round with no angry customer is common, so it moves 'calm' less than the cap
    // (on 樓面 shops at mid nobody storms out, so calm may not move at all; dealCards then skips calm there, dealable)
    if (m === 'calm') assert.ok(a <= C.TIER_AIM[t] && a >= C.TIER_AIM[t] - C.FOLLOW_CAP - 1e-9, `${m} ${t}: ${a}`);
    else assert.ok(Math.abs(a - (C.TIER_AIM[t] - C.FOLLOW_CAP)) < 1e-9, `${m} ${t}: ${a}`);
  }
  const mid = C.aimFor('bet', 'rev', { ...last, team: { ...last.team, revenue: C.qAt(C.quantilesOf('mongkok', 'breakfast', 'rev'), .5) } });
  assert.ok(Math.abs(mid - .5) < .03, `a median round barely moves the line: ${mid}`);
});

test('the deal: three cards, one per tier, three different metrics, harder tiers asking more (every shop, round and metric)', () => {
  for (const shop of C.SHOP_LADDER) for (const kind of C.DAY_KINDS) {
    let rs = 7;
    for (let i = 0; i < 20; i++) {
      const d = C.dealCards(rs, kind, shop, null); rs = d.rs;
      assert.deepEqual(d.cards.map(c => c.tier), ['safe', 'bet', 'allin']);
      assert.equal(new Set(d.cards.map(c => c.metric)).size, 3);
      assert.deepEqual(d.cards.map(c => [c.win, c.lose]), [[300, 0], [800, 300], [3600, 800]]);
    }
    for (const m of C.PARTY_METRICS) {
      const n = t => C.makeCard(t, m, kind, shop, null).n, cap = m === 'clean' || m === 'calm';
      const [a, b, c] = ['safe', 'bet', 'allin'].map(n);
      assert.ok(cap ? a >= b && b >= c : a <= b && b <= c, `${shop} ${kind} ${m}: ${a} ${b} ${c}`);
    }
  }
});

// ---------------------------------------------------------------- joiners, leavers, the referee

test('late joiners watch until they tap a seat, mid-round too (the referee is told); returners get a computer-run seat back', () => {
  const N = seated(C, 3);
  N.input({ k: 'start', player: 'p0' });
  voteAll(N); readyGo(N);
  N.input({ k: 'join', player: 'p3', name: '遲到' });
  assert.equal(N.s.players.find(p => p.id === 'p3').seat, null);
  const n0 = N.outs.length;
  N.input({ k: 'seat', player: 'p3', seat: 'till' });
  assert.deepEqual(N.outs.slice(n0).filter(o => o.k === 'drive'), [{ k: 'drive', seat: 'till', player: 'p3' }]);
  N.input({ k: 'leave', player: 'p1' });
  assert.equal(N.s.seats.bar, null);
  N.input({ k: 'join', player: 'p1', name: '' });
  assert.equal(N.s.seats.bar, 'p1');
  N.input({ k: 'leave', player: 'p2' });
  N.input({ k: 'join', player: 'p9', name: 'x' });
  N.input({ k: 'seat', player: 'p9', seat: 'kitchen' });
  N.input({ k: 'join', player: 'p2', name: '' });
  assert.equal(N.s.players.find(p => p.id === 'p2').seat, null, 'their seat was taken: they watch');
  assert.equal(N.s.players.find(p => p.id === 'p2').name, '阿2', 'an empty name keeps the old one');
  N.result(report(N));
  assert.deepEqual(N.s.players.find(p => p.id === 'p3').rounds, [0], 'the late joiner played this round');
});

test('everybody leaves between rounds: the screens wait, the till survives, the first one back is the host', () => {
  const N = seated(C, 2);
  N.input({ k: 'start', player: 'p0' });
  playRound(N, { revenue: 1234 }, { card: 0 });
  const bank = N.s.bank;
  N.input({ k: 'leave', player: 'p0' }); N.input({ k: 'leave', player: 'p1' });
  assert.equal(N.s.host, null);
  const t = N.s.t;
  N.tick(600);
  assert.equal(N.s.phase, 'endcard'); assert.equal(N.s.t, t, 'no time passes with nobody here');
  N.input({ k: 'join', player: 'p1', name: '' });
  assert.equal(N.s.host, 'p1'); assert.equal(N.s.bank, bank); assert.equal(N.s.seats.bar, 'p1');
  N.input({ k: 'next', player: 'p1' });
  assert.equal(N.s.phase, 'vote');
});

test('the end card waits for every counted player\'s 下一步 (no clock); a leaver no longer counts', () => {
  const N = seated(C, 3);
  N.input({ k: 'start', player: 'p0' });
  playRound(N, { revenue: 1800, maxCombo: 21, fevers: 3 }, { card: 1, stars: { floor1: 3, bar: 1, kitchen: 0, till: 2 } });
  const card = C.endCard(N.s);
  assert.equal(card.name, '早市'); assert.equal(card.last, false);
  assert.equal(card.team.takings, 1800); assert.equal(card.team.rent, C.rentFor('estate', 'breakfast'));
  assert.equal(card.team.bank, N.s.bank); assert.equal(card.team.card.tierName, '搏一搏');
  assert.deepEqual(card.columns.map(c => [c.title, c.names.join(), c.stars]), [['樓面', '阿0', 3], ['樓面', '電腦', 2], ['水吧', '阿1', 1], ['廚房', '阿2', 0], ['收銀', '電腦', 2]]);
  assert.equal(C.myColumn(card, N.s, 'p1').seat, 'bar');
  assert.equal(C.myColumn(card, N.s, 'p9'), null);
  N.input({ k: 'next', player: 'p0' }); N.input({ k: 'next', player: 'p1' });
  N.tick(3600);
  assert.equal(N.s.phase, 'endcard');
  N.input({ k: 'leave', player: 'p2' });
  assert.equal(N.s.phase, 'vote');
  assert.equal(N.input({ k: 'next', player: 'p0' })[0].why, 'no end card');
});

test('the referee\'s report: a stale or repeated round is refused; junk numbers are cleaned', () => {
  const N = seated(C, 2);
  N.input({ k: 'start', player: 'p0' });
  assert.equal(N.result(report(N))[0].k, 'reject', 'not during the vote');
  voteAll(N); readyGo(N);
  assert.equal(N.result(report(N, {}, { round: 3 }))[0].k, 'reject');
  N.result(report(N, { revenue: NaN, tips: -5, mistakes: 2.6, angry: Infinity }));
  const r = N.s.history.at(-1);
  assert.deepEqual([r.report.team.revenue, r.report.team.tips, r.report.team.mistakes, r.report.team.angry], [0, 0, 3, 0]);
  assert.equal(N.result(report(N, {}, { round: 0 }))[0].k, 'reject', 'the same round twice');
  assert.equal(N.s.history.length, 1);
});

// ---------------------------------------------------------------- 收舖

/** Plays a whole night with `n` players, the first four seated, every round with this team line. */
function wholeNight(n, team, cfg = {}) {
  const N = seated(C, n, cfg);
  N.input({ k: 'start', player: 'p0' });
  while (N.s.phase !== 'close') { playRound(N, team, { card: 1 }); nextAll(N); }
  return N;
}

test('收舖 with one player: a title, the till, and at least one award', () => {
  const N = wholeNight(1, { revenue: 2500 });
  const close = C.closeCard(N.s);
  assert.equal(close.people.length, 1);
  assert.ok(close.people[0].awards.length >= 1);
  assert.equal(close.bank, N.s.bank); assert.equal(close.rounds, 5);
  assert.ok(C.TITLES.includes(close.title) || close.title === C.FOLD_TITLE);
  assert.equal(close.cardsWon + close.cardsLost, 5);
});

test('收舖 with eight players: everyone who played gets an award; onlookers who never played are not listed', () => {
  const N = seated(C, 8);
  N.input({ k: 'start', player: 'p0' });
  // p4, p5 take over seats between rounds, p6 mid-round; p7 only ever watches
  const rot = [['p4', 'p0'], ['p5', 'p1']];
  while (N.s.phase !== 'close') {
    if (N.s.phase === 'endcard') nextAll(N);
    if (N.s.phase === 'vote') { if (N.s.round === 2 || N.s.round === 4) { const [inn, out] = rot.shift(); const seat = N.s.players.find(p => p.id === out).seat; N.input({ k: 'seat', player: out, seat }); N.input({ k: 'seat', player: inn, seat }); } voteAll(N, 1); }
    if (N.s.phase === 'ready') readyGo(N);
    if (N.s.phase === 'round') {
      if (N.s.round === 3) { N.input({ k: 'watch', player: 'p2' }); N.input({ k: 'seat', player: 'p6', seat: 'kitchen' }); }
      N.result(report(N, { revenue: 1500 }, { players: Object.values(N.s.seats).filter(Boolean).map((id, i) => ({ player: id, done: 10 + i, avgSec: 5 + i, mistakes: i, burnt: i === 2 ? 3 : 0, exact: i === 3 ? 4 : 0, helps: 0, hurries: 0, streak: 9 - i })) }));
    }
  }
  const close = C.closeCard(N.s);
  assert.deepEqual(close.people.map(p => p.id).sort(), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  for (const p of close.people) assert.ok(p.awards.length >= 1, `${p.id} has no award`);
  const names = close.people.flatMap(p => p.awards.map(a => a.name));
  assert.ok(names.includes('燶嘢之王') && names.includes('金手指') && names.includes('最快手'));
});

test('收舖 buttons: 再開一日 keeps the group and remembers tonight; 散水 ends it; only the host decides', () => {
  const N = wholeNight(2, { revenue: 2000 });
  const bank = N.s.bank;
  assert.equal(N.input({ k: 'again', player: 'p1' })[0].k, 'reject');
  N.input({ k: 'again', player: 'p0' });
  assert.equal(N.s.phase, 'lobby'); assert.equal(N.s.prevBank, bank); assert.equal(N.s.nights, 2);
  // p0 keeps 樓面's first place (every party shop seats 樓面)
  assert.equal(N.s.seats.floor1, 'p0');
  assert.equal(N.s.history.length, 0); assert.equal(N.s.tokenUsed, false);
  assert.equal(C.closeCard(N.s).prevBank, bank);
  const M = wholeNight(1, { revenue: 10 });
  M.input({ k: 'bye', player: 'p0' });
  assert.equal(M.s.phase, 'done');
  assert.equal(M.input({ k: 'join', player: 'zz', name: 'z' })[0].k, 'reject');
});

test('title ladder: per shop and length; higher tills climb it, below $0 is 執笠; the comeback measure undoes only the finale\'s card', () => {
  for (const shop of C.SHOP_LADDER) for (const days of [1, 2]) {
    const lines = C.titleLines(C.newNight(1, { shop, days }));
    assert.equal(lines.length, 5, `${shop} ${days}`);
    assert.ok(lines.every((x, i) => i === 0 || x >= lines[i - 1]));
  }
  const lines = C.titleLines(C.newNight(1, { shop: 'mongkok' }));
  assert.equal(C.titleIx(0, lines), 0); assert.equal(C.titleIx(1e9, lines), 5); assert.equal(C.titleIx(-50, lines), -1);
  assert.equal(C.titleName(-1), C.FOLD_TITLE);
  const N = wholeNight(4, { ...ALL_MET, revenue: 1500 });
  const last = N.s.history.at(-1);
  assert.equal(C.bankWithoutFinale(N.s), N.s.bank - last.cardDelta);
});

test('purity: the night never changes the state it was given, and it is plain JSON', () => {
  const s0 = C.newNight(5);
  const frozen = JSON.stringify(s0);
  const a = C.nightInput(s0, { k: 'join', player: 'a', name: 'A' });
  assert.equal(JSON.stringify(s0), frozen);
  const b = C.nightTick(a.s, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(b.s)), b.s);
  const seam = C.partySeam(a.s);
  seam.input({ k: 'start', player: 'a' });
  assert.equal(a.s.phase, 'lobby', 'a seam over a saved state works on its own copy');
});
