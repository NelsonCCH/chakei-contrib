// The party night as a state machine: the lobby, rounds back to back as one day of the
// shop, the screens between rounds (end card, vote, ready check, countdown), 收舖, seats anyone can take or leave at any
// time, late joiners and leavers, the host changing hands, and the team's shared till across rounds.
//
// Nothing between rounds runs on a clock: the end card waits for everyone's 下一步, the vote for everyone's
// vote (then 5 s to change it), the ready check for everyone's 我準備好 and the host's start (then a 5 s countdown that
// any un-ready stops). A leaver stops counting at once, so a locked phone never holds the room.
//
// Pure and deterministic: every entry point takes a NightState and returns a new one plus what it asks of the referee
// (PartyOut). Time only moves through nightTick(dt) in game seconds; randomness only through the night's own stream
// (rand.ts). The referee owns the round itself and hands the result in through nightResult (seam.ts).
import { COUNTDOWN_SEC, DEFAULT_NIGHT, PARTY_FLOOR, PARTY_MAX_PLAYERS, PARTY_SHOPS, PLAYED_MIN_SEC, ROUND_SLOT, VOTE_CHANGE_SEC, isPartyFloor, partySchedule, partySeats } from './config';
import { climbTo } from './close';
import { cardMet, cardPay, crowdVote, dealCards, drawTwist, openWager, rentFor, resolveVote, startTill } from './wager';
import type { FollowFrom } from './wager';
import type { NightConfig, NightState, PartyEvent, PartyOut, Phase, Player, PlayerId, RoundPlan, RoundRecord, RoundReport, SeatId } from './types';

export interface NightStep { s: NightState; out: PartyOut[] }

/** A night in its lobby. `prevBank` is the group's last night, if the page remembers one (收舖 "上次 $14,200"). */
export function newNight(seed: number, cfg: Partial<NightConfig> = {}, prevBank: number | null = null): NightState {
  const c = cleanConfig({ ...DEFAULT_NIGHT, ...cfg }), schedule = partySchedule(c), start = openingFloat(schedule);
  return {
    v: 2, seed, rs: seed >>> 0, cfg: c, phase: 'lobby', phaseT: 0, t: 0, round: -1, schedule, host: null, players: [],
    seats: Object.fromEntries(partySeats(c.shop).map(id => [id, null])), bank: start, book: { start, takings: 0, cards: 0, rent: 0 },
    tokenUsed: false, wager: null, history: [], taps: [], prevBank, climbed: null, nights: 1,
  };
}

const openingFloat = (schedule: NightState['schedule']): number => { const f = schedule[0]; return f ? startTill(f.shop, f.kind) : 0; };

function cleanConfig(c: NightConfig): NightConfig {
  return {
    shop: Object.prototype.hasOwnProperty.call(PARTY_SHOPS, c.shop) ? c.shop : DEFAULT_NIGHT.shop,
    days: c.days === 2 ? 2 : 1,
    chooser: c.chooser === 'host' ? 'host' : 'vote',
  };
}
/** A new shop or length re-plans the night and resets the opening float (the lobby only: nothing is booked yet). */
function replan(s: NightState): void {
  s.schedule = partySchedule(s.cfg);
  s.bank = openingFloat(s.schedule);
  s.book = { start: s.bank, takings: 0, cards: 0, rent: 0 };
  fitSeats(s);
}
/**
 * The seats follow the shop (the four plus its extra stations, partySeats): a seat the new shop has keeps who
 * sits there; a player at a seat it does not have stands up (watching, free to take another). Lobby and 再開一日 only.
 * 伙記 and 樓面 are the same job on either kind of shop: 伙記 moves to 樓面's first place, and 樓面's first player
 * to 伙記, rather than standing up.
 */
function fitSeats(s: NightState): void {
  const want = partySeats(s.cfg.shop), old = s.seats;
  const moved = (k: string): string => !want.includes(k) && k === 'waiter' && want.includes('floor1') ? 'floor1' : !want.includes(k) && k === 'floor1' && want.includes('waiter') ? 'waiter' : k;
  s.seats = Object.fromEntries(want.map(k => [k, null]));
  for (const [k, p] of Object.entries(old)) if (p !== null && want.includes(moved(k))) s.seats[moved(k)] = p;
  for (const p of s.players) if (p.seat !== null){ const k = moved(p.seat); p.seat = want.includes(k) && s.seats[k] === p.id ? k : null; }
}

// ---------------------------------------------------------------- small reads

const player = (s: NightState, id: PlayerId): Player | undefined => s.players.find(p => p.id === id);
const presentPlayers = (s: NightState): Player[] => s.players.filter(p => p.present);
const seatedPlayers = (s: NightState): Player[] => s.players.filter(p => p.present && p.seat !== null);
const isSeat = (s: NightState, seat: string): boolean => Object.prototype.hasOwnProperty.call(s.seats, seat);
/** The round being played or about to be. */
export const currentSlot = (s: NightState): NightState['schedule'][number] | undefined => s.schedule[s.round];
/** Who counts for "everyone has voted / tapped 下一步": present seated players, or every present player if nobody sits. */
export function counted(s: NightState): Player[] {
  const seated = seatedPlayers(s);
  return seated.length ? seated : presentPlayers(s);
}
/** Who must vote before the change window opens: the counted players, or only the host in 老闆話事. */
export function voters(s: NightState): Player[] {
  return s.cfg.chooser === 'host' ? presentPlayers(s).filter(p => p.id === s.host) : counted(s);
}
/** Who must be ready before the host may start: the seated players. A seat the computer covers counts as ready. */
export const mustReady = (s: NightState): Player[] => seatedPlayers(s);
export const allReady = (s: NightState): boolean => mustReady(s).every(p => s.taps.includes(p.id));

// ---------------------------------------------------------------- entry points

/** A phone's input. Refused inputs leave the night unchanged and say why. */
export function nightInput(s0: NightState, ev: PartyEvent): NightStep {
  const s = structuredClone(s0), out: PartyOut[] = [];
  const why = apply(s, ev, out);
  if (why) return { s: s0, out: [{ k: 'reject', why }] };
  fixHost(s, out);
  advance(s, 0, out);
  return { s, out };
}

/** Time passing (game seconds). Only the vote's change window and the countdown run out; the rest waits for people. */
export function nightTick(s0: NightState, dt: number): NightStep {
  if (!(dt > 0) || !Number.isFinite(dt)) return { s: s0, out: [] };
  const s = structuredClone(s0), out: PartyOut[] = [];
  advance(s, dt, out);
  return { s, out };
}

/** The referee's report when a round's clock ends: settles the wager, the rent and the till, then shows the end card. */
export function nightResult(s0: NightState, report: RoundReport): NightStep {
  if (s0.phase !== 'round') return { s: s0, out: [{ k: 'reject', why: 'no round is being played' }] };
  if (report.round !== s0.round) return { s: s0, out: [{ k: 'reject', why: `report for round ${String(report.round)}, playing ${String(s0.round)}` }] };
  const s = structuredClone(s0), out: PartyOut[] = [], r = cleanReport(report);
  settle(s, r, out);
  advance(s, 0, out);
  return { s, out };
}

// ---------------------------------------------------------------- inputs

function apply(s: NightState, ev: PartyEvent, out: PartyOut[]): string | null {
  if (s.phase === 'done' && ev.k !== 'leave') return 'the night is over';
  const p = player(s, ev.player);
  switch (ev.k) {
    case 'join': return join(s, ev.player, ev.name, out);
    case 'leave': {
      if (!p?.present) return 'not here';
      p.present = false;
      p.lastSeat = p.seat;
      if (p.seat !== null) moveSeat(s, p, null, out);
      forget(s, p.id);
      return null;
    }
    case 'seat': return p?.present ? tapSeat(s, p, ev.seat, out) : 'not here';
    case 'slot': return p?.present ? switchSlot(s, ev.seat, ev.on) : 'not here';
    case 'watch': {
      if (!p?.present) return 'not here';
      if (s.phase === 'close') return 'the night is closing';
      if (p.seat !== null) moveSeat(s, p, null, out);
      return null;
    }
    case 'setup': {
      if (s.phase !== 'lobby') return 'only in the lobby';
      if (ev.player !== s.host) return 'only the host sets up the night';
      s.cfg = cleanConfig({ ...s.cfg, ...ev.cfg });
      s.climbed = null;
      replan(s);
      return null;
    }
    case 'start': {
      if (s.phase === 'lobby') {
        if (ev.player !== s.host) return 'only the host opens the shop';
        replan(s);
        s.round = 0; s.t = 0;
        enterVote(s, out);
        return null;
      }
      if (s.phase === 'ready') {
        if (ev.player !== s.host) return 'only the host starts the round';
        if (!allReady(s)) return 'not everyone is ready';
        enter(s, 'countdown', out, true);
        return null;
      }
      return 'nothing to start';
    }
    case 'next': {
      if (s.phase !== 'endcard') return 'no end card';
      if (!p?.present) return 'not here';
      if (!s.taps.includes(p.id)) s.taps.push(p.id);
      return null;
    }
    case 'vote': {
      const w = s.wager;
      if (s.phase !== 'vote' || !w) return 'no vote open';
      if (!p?.present) return 'not here';
      if (s.cfg.chooser === 'host' && p.id !== s.host) return 'the host decides tonight';
      if (ev.card === null) Reflect.deleteProperty(w.votes, p.id);
      else if (Number.isInteger(ev.card) && ev.card >= 0 && ev.card < w.cards.length) w.votes[p.id] = ev.card;
      else return 'no such card';
      return null;
    }
    case 'token': {
      const w = s.wager;
      if (s.phase !== 'vote' || !w) return 'no vote open';
      if (!p?.present || p.seat === null) return 'only seated players';
      if (s.tokenUsed) return 'the token is spent';
      w.token = w.token.filter(id => id !== p.id);
      if (ev.on) w.token.push(p.id);
      return null;
    }
    case 'ready': {
      if (s.phase !== 'ready' && s.phase !== 'countdown') return 'no ready check';
      if (!p?.present) return 'not here';
      s.taps = s.taps.filter(id => id !== p.id);
      if (ev.on) s.taps.push(p.id);
      return null;
    }
    case 'again': {
      if (s.phase !== 'close') return 'only at 收舖';
      if (ev.player !== s.host) return 'only the host';
      const keep = s.seats, off = floorOff(s), players = s.players, host = s.host, nights = s.nights + 1, prev = s.bank;
      const from = s.cfg.shop, to = climbTo(s);
      Object.assign(s, newNight(s.rs, { ...s.cfg, shop: to }, prev), { seats: keep, floorOff: off, players, host, nights, climbed: to === from ? null : from });
      for (const q of s.players) q.rounds = [];
      fitSeats(s);   // one shop up: its extra stations join the seats
      enter(s, 'lobby', out);
      return null;
    }
    case 'bye': {
      if (s.phase !== 'close') return 'only at 收舖';
      if (ev.player !== s.host) return 'only the host';
      enter(s, 'done', out);
      return null;
    }
  }
}

function join(s: NightState, id: PlayerId, name: string, out: PartyOut[]): string | null {
  const p = player(s, id);
  if (p?.present) return 'already here';
  if (presentPlayers(s).length >= PARTY_MAX_PLAYERS) return 'the room is full';
  let q: Player;
  if (p) { q = p; q.present = true; q.name = name || q.name; }
  else {
    q = { id, name: name || id, present: true, seat: null, lastSeat: null, rounds: [] }; s.players.push(q);
    // the night's very first player opened it: they are its host before anyone sits
    if (s.players.length === 1 && s.host === null) { s.host = id; out.push({ k: 'host', player: id }); }
  }
  // Back from a drop: the old seat if the computer still runs it. A newcomer watches until they tap one.
  if (q.lastSeat !== null && s.seats[q.lastSeat] === null && s.phase !== 'close') moveSeat(s, q, q.lastSeat, out);
  q.lastSeat = null;
  return null;
}

/** A seat tap: a free seat, sit (leaving your old one); your own seat, stand up; someone else's, refused. */
function tapSeat(s: NightState, p: Player, seat: SeatId, out: PartyOut[]): string | null {
  if (!isSeat(s, seat)) return 'no such seat';
  // at 收舖 seats are frozen, except to give a host-less room its host (the first to sit decides 再開一日 / 散水)
  if (s.phase === 'close' && s.host !== null) return 'the night is closing';
  if (p.seat === seat) { moveSeat(s, p, null, out); return null; }
  if ((s.seats[seat] ?? null) !== null) return 'that seat is taken';
  moveSeat(s, p, seat, out);
  return null;
}

/** 樓面's places switched off. */
export const floorOff = (s: NightState): SeatId[] => s.floorOff ?? [];
/**
 * A free 樓面 place switched on (the computer works it) or off (nobody does; the floor's load is budgeted per switched-on
 * place). Between rounds and in the lobby only: a round keeps the layout it started with.
 */
function switchSlot(s: NightState, seat: SeatId, on: boolean): string | null {
  if (!isPartyFloor(seat) || !isSeat(s, seat)) return 'no such seat';
  if (s.phase === 'round' || s.phase === 'close') return 'not during a round';
  if ((s.seats[seat] ?? null) !== null) return 'that seat is taken';
  const off = floorOff(s).filter(k => k !== seat);
  if (!on && PARTY_FLOOR.filter(k => isSeat(s, k) && !off.includes(k)).length <= 1) return 'one 樓面 place stays on';
  s.floorOff = on ? off : [...off, seat];
  return null;
}

/** Moves a player to a seat (or off any seat: null); mid-round the referee hands the leases over. */
function moveSeat(s: NightState, p: Player, seat: SeatId | null, out: PartyOut[]): void {
  const old = p.seat;
  if (old !== null) {
    s.seats[old] = null;
    if (s.phase === 'round') out.push({ k: 'drive', seat: old, player: null });
  }
  p.seat = seat;
  if (seat !== null) {
    s.seats[seat] = p.id;
    if (floorOff(s).includes(seat)) s.floorOff = floorOff(s).filter(k => k !== seat);   // sitting at a switched-off 樓面 place switches it on
    if (s.phase === 'round') out.push({ k: 'drive', seat, player: p.id });
  }
}

/** A leaver stops counting for anything open: their vote, token wish, 下一步 and ready. */
function forget(s: NightState, id: PlayerId): void {
  const w = s.wager;
  if (w && s.phase === 'vote') { Reflect.deleteProperty(w.votes, id); w.token = w.token.filter(x => x !== id); }
  s.taps = s.taps.filter(x => x !== id);
}

/**
 * Host duty: the night's first player opens it and is its host, seat or not. When the host leaves, the duty
 * passes to the earliest-joined *seated* player still here, never to an onlooker (睇戲) or a TV. Nobody seated: no
 * host until someone takes a seat, and the first to sit becomes the host (the screens wait for them meanwhile).
 */
function fixHost(s: NightState, out: PartyOut[]): void {
  if (s.host !== null && player(s, s.host)?.present) return;
  const next = seatedPlayers(s)[0]?.id ?? null;
  if (next === s.host) return;
  s.host = next;
  out.push({ k: 'host', player: next });
}

// ---------------------------------------------------------------- phases and time

function enter(s: NightState, phase: Phase, out: PartyOut[], keepTaps = false): void {
  s.phase = phase; s.phaseT = 0;
  if (!keepTaps) s.taps = [];
  out.push({ k: 'phase', phase, round: s.round });
  if (phase === 'round') out.push({ k: 'roundStart', plan: planOf(s) });
}

function enterVote(s: NightState, out: PartyOut[]): void {
  const slot = currentSlot(s);
  if (!slot) return;
  const d = dealCards(s.rs, slot.kind, slot.shop, followFrom(s));
  s.rs = d.rs;
  s.wager = openWager(d.cards);
  enter(s, 'vote', out);
}

/** Last scored round, for follow-the-team (2.3). Not across days: a new day starts fresh. */
function followFrom(s: NightState): FollowFrom | null {
  const last = s.history.at(-1), slot = currentSlot(s);
  if (!last || !slot || last.day !== slot.day) return null;
  return { kind: last.kind, shop: last.shop, team: last.report.team };
}

/** Keeps the vote's change window and the countdown in step with who is here and what they did. */
function sync(s: NightState, out: PartyOut[]): void {
  const w = s.wager;
  if (s.phase === 'vote' && w) {
    const v = voters(s), all = v.length > 0 && v.every(p => w.votes[p.id] !== undefined);
    if (!all) w.allAt = null;
    else w.allAt ??= s.phaseT;
  }
  // Anyone not ready during the countdown (an un-ready, someone sitting down) sends it back to waiting.
  if (s.phase === 'countdown' && !allReady(s)) enter(s, 'ready', out, true);
}

/** How long the current phase runs, given who has done what. Infinity: it waits for people or the referee. */
function deadline(s: NightState): number {
  switch (s.phase) {
    case 'endcard': {
      const c = counted(s);
      return c.length && c.every(p => s.taps.includes(p.id)) ? 0 : Infinity;
    }
    case 'vote': {
      const at = s.wager?.allAt ?? null;
      return s.wager ? at === null ? Infinity : at + VOTE_CHANGE_SEC : 0;
    }
    case 'countdown': return COUNTDOWN_SEC;
    default: return Infinity;
  }
}

/** Runs dt game seconds through the phases. */
function advance(s: NightState, dt: number, out: PartyOut[]): void {
  let left = dt;
  for (let guard = 0; guard < 64; guard++) {
    const between = s.phase === 'endcard' || s.phase === 'vote' || s.phase === 'ready' || s.phase === 'countdown';
    if (between && presentPlayers(s).length === 0) return;   // an empty room waits: the night is not lost
    sync(s, out);
    const end = deadline(s);
    if (s.phaseT >= end) { finish(s, out); continue; }
    if (left <= 0) return;
    const use = Math.min(left, end - s.phaseT);
    s.phaseT += use; left -= use;
    if (s.phase !== 'lobby' && s.phase !== 'done') s.t += use;
  }
}

function finish(s: NightState, out: PartyOut[]): void {
  switch (s.phase) {
    case 'endcard':
      if (s.round >= s.schedule.length - 1) { enter(s, 'close', out); return; }
      s.round++;
      enterVote(s, out);
      return;
    case 'vote': closeVote(s); enter(s, 'ready', out); return;
    case 'countdown': enter(s, 'round', out); return;
    default: return;
  }
}

function closeVote(s: NightState): void {
  const w = s.wager;
  if (!w) return;
  const seated = seatedPlayers(s), present = presentPlayers(s);
  if (s.cfg.chooser === 'host') w.chosen = (s.host !== null ? w.votes[s.host] : undefined) ?? 0;
  else {
    const counting = counted(s), ids = new Set(counting.map(p => p.id));
    const votes = counting.flatMap(p => { const v = w.votes[p.id]; return v === undefined ? [] : [v]; });
    // the onlookers (when anyone sits) add one shared 街坊 vote
    const crowd = crowdVote(present.filter(p => !ids.has(p.id)).flatMap(p => { const v = w.votes[p.id]; return v === undefined ? [] : [v]; }));
    if (crowd !== null) votes.push(crowd);
    w.chosen = resolveVote(votes, s.host !== null ? w.votes[s.host] ?? null : null, w.cards.length);
  }
  // 孤注一擲: once a night, on when more than half the seated players want it (the host alone in 老闆話事).
  const want = w.token.filter(id => seated.some(p => p.id === id)).length;
  const tokenOn = !s.tokenUsed && (s.cfg.chooser === 'host' ? s.host !== null && w.token.includes(s.host) : seated.length > 0 && want * 2 > seated.length);
  w.tokenOn = tokenOn;
  if (tokenOn) s.tokenUsed = true;
  if (w.cards[w.chosen]?.tier === 'allin') { const d = drawTwist(s.rs); s.rs = d.rs; w.twist = d.twist; }
  else w.twist = null;
}

/** What the referee needs to start the round. */
export function planOf(s: NightState): RoundPlan {
  const slot = currentSlot(s), w = s.wager, shop = slot?.shop ?? s.cfg.shop;
  const card = !w || w.chosen === null ? null : w.cards[w.chosen] ?? null;
  return {
    round: s.round, day: slot?.day ?? 1, kind: slot?.kind ?? 'breakfast', sec: slot?.sec ?? 240, slot: ROUND_SLOT[slot?.kind ?? 'breakfast'],
    shop, pace: { ...PARTY_SHOPS[shop].pace }, card, twist: card ? w?.twist ?? null : null, token: w?.tokenOn ?? false, seats: { ...s.seats }, floorOff: [...floorOff(s)],
  };
}

// ---------------------------------------------------------------- the round's result

const num = (v: number, int = true): number => !Number.isFinite(v) || v < 0 ? 0 : int ? Math.round(v) : v;

/** The report with every number made sane (finite, not negative, whole counts, stars 0-3). */
export function cleanReport(r: RoundReport): RoundReport {
  const t = r.team;
  return {
    round: r.round,
    team: { revenue: num(t.revenue), tips: num(t.tips), mistakes: num(t.mistakes), angry: num(t.angry), maxCombo: num(t.maxCombo), fevers: num(t.fevers), served: num(t.served), ...(t.sales !== undefined ? { sales: num(t.sales) } : {}) },
    stations: r.stations.map(st => ({
      seat: st.seat, kind: st.kind, stars: Math.min(3, num(st.stars)), best: st.best,
      measures: st.measures.map(m => ({ key: m.key, label: m.label, value: num(m.value, false) })),
      drivers: st.drivers.map(d => ({ player: d.player, sec: num(d.sec, false) })),
    })),
    players: r.players.map(p => ({
      player: p.player, done: num(p.done), avgSec: num(p.avgSec, false), mistakes: num(p.mistakes), burnt: num(p.burnt),
      exact: num(p.exact), helps: num(p.helps), hurries: num(p.hurries), streak: num(p.streak), ...(p.pay !== undefined ? { pay: num(p.pay) } : {}), ...(p.floor !== undefined ? { floor: num(p.floor) } : {}),
    })),
  };
}

function settle(s: NightState, r: RoundReport, out: PartyOut[]): void {
  const slot = currentSlot(s);
  if (!slot) return;
  const minSec = Math.min(PLAYED_MIN_SEC, slot.sec / 2);
  for (const st of r.stations) for (const d of st.drivers) {
    const p = player(s, d.player);
    if (p && d.sec >= minSec && !p.rounds.includes(s.round)) p.rounds.push(s.round);
  }
  const w = s.wager, card = w && w.chosen !== null ? w.cards[w.chosen] ?? null : null;
  const met = card ? cardMet(card.metric, card.n, r.team) : null;
  const token = w?.tokenOn ?? false, cardDelta = card ? cardPay(card, met === true, token) : 0;
  const takings = r.team.revenue, rent = rentFor(slot.shop, slot.kind), before = s.bank;
  s.bank = before + takings + cardDelta - rent;
  s.book.takings += takings; s.book.cards += cardDelta; s.book.rent += rent;
  const record: RoundRecord = {
    round: s.round, day: slot.day, kind: slot.kind, shop: slot.shop, card, met, cardDelta, takings, rent, bankBefore: before, bankAfter: s.bank,
    token, twist: card ? w?.twist ?? null : null, report: r,
  };
  s.history.push(record);
  out.push({ k: 'settled', record });
  enter(s, 'endcard', out);
}

// ---------------------------------------------------------------- invariants

/** Everything that must hold for any night (the fuzz checks it after every step). Empty when the night is sound. */
export function checkNight(s: NightState): string[] {
  const errs: string[] = [];
  const b = s.book;
  if (s.bank !== b.start + b.takings + b.cards - b.rent) errs.push(`bank ${String(s.bank)} != book ${JSON.stringify(b)}`);
  const sum = (f: (r: RoundRecord) => number): number => s.history.reduce((a, r) => a + f(r), 0);
  if (b.takings !== sum(r => r.takings) || b.cards !== sum(r => r.cardDelta) || b.rent !== sum(r => r.rent)) errs.push('book does not match the rounds');
  let run = b.start;
  for (const r of s.history) {
    if (r.bankBefore !== run) errs.push(`round ${String(r.round)} starts at ${String(r.bankBefore)}, till was ${String(run)}`);
    if (r.bankAfter !== r.bankBefore + r.takings + r.cardDelta - r.rent) errs.push(`round ${String(r.round)} does not add up`);
    if (r.rent <= 0) errs.push(`round ${String(r.round)} paid no rent`);
    run = r.bankAfter;
  }
  if (run !== s.bank) errs.push('history does not end at the till');
  if (s.history.filter(r => r.token).length > 1) errs.push('the token was spent twice');
  if (s.history.some(r => r.token) && !s.tokenUsed) errs.push('token spent but not marked used');
  // an off 樓面 place is a free one, and one place stays on
  for (const k of floorOff(s)) if (!isPartyFloor(k) || (s.seats[k] ?? null) !== null) errs.push(`樓面 place ${k} is off but taken (or no 樓面 place)`);
  if (PARTY_FLOOR.some(k => isSeat(s, k)) && PARTY_FLOOR.every(k => !isSeat(s, k) || floorOff(s).includes(k))) errs.push('every 樓面 place is off');
  for (const [seat, id] of Object.entries(s.seats)) {
    if (!partySeats(s.cfg.shop).includes(seat)) errs.push(`seat ${seat} is not one of ${s.cfg.shop}'s`);   // seats follow the shop's roles
    if (id !== null) { const p = player(s, id); if (!p?.present || p.seat !== seat) errs.push(`seat ${seat} held by ${id}, who is not there`); }
  }
  for (const p of s.players) if (p.seat !== null && (!p.present || s.seats[p.seat] !== p.id)) errs.push(`${p.id} thinks it sits at ${p.seat}`);
  if (s.players.filter(p => p.present).length > PARTY_MAX_PLAYERS) errs.push('too many players');
  const anyone = s.players.some(p => p.present);
  // a host is never handed to an onlooker, so a room of onlookers only may have none until someone sits
  if (s.players.some(p => p.present && p.seat !== null) && (s.host === null || !player(s, s.host)?.present)) errs.push('seated players here but no host');
  if (s.host !== null && !player(s, s.host)?.present) errs.push('a host who is not here');
  if (!anyone && s.host !== null) errs.push('a host with nobody here');
  if (s.phase !== 'lobby' && (s.round < 0 || s.round >= s.schedule.length)) errs.push(`round ${String(s.round)} out of the schedule`);
  for (const id of s.taps) if (!player(s, id)?.present) errs.push(`a tap from ${id}, who left`);
  if (s.phase === 'countdown' && anyone && !allReady(s)) errs.push('a countdown with someone not ready');
  const w = s.wager;
  if (s.phase === 'vote' || s.phase === 'ready' || s.phase === 'countdown') {
    if (!w || w.cards.length !== 3) errs.push('no three cards before a round');
    else {
      if (new Set(w.cards.map(c => c.metric)).size !== 3) errs.push('two cards share a metric');
      if (w.cards.map(c => c.tier).join() !== 'safe,bet,allin') errs.push('cards not one per tier');
      if (s.phase !== 'vote' && (w.chosen === null || w.chosen < 0 || w.chosen > 2)) errs.push('vote closed without a card');
      if (s.phase === 'vote') {
        for (const id of Object.keys(w.votes)) if (!player(s, id)?.present) errs.push(`a vote from ${id}, who left`);
        const v = voters(s), all = v.length > 0 && v.every(p => w.votes[p.id] !== undefined);
        if (anyone && all !== (w.allAt !== null)) errs.push('the change window does not match who has voted');
      }
    }
  }
  if (!Number.isFinite(s.t) || !Number.isFinite(s.phaseT) || s.phaseT < 0) errs.push('time is not a number');
  return errs;
}
