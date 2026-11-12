// The referee: the one writer of the shared shift. In a room it runs in the
// room's Durable Object (core/coop/room.ts drives it, headless); in solo and the room of one it runs on
// the phone. Each step the caller runs the shop's step (referee/index.ts update) and then refFrame(): the seat rules
// (cover, link loss), the 4 Hz tick and the keyframes.
// What teammates' phones send arrives in refReceive(): checked (proto/validate.ts), put in order per player (`seq`),
// applied once (acks), and answered (welcome, grant, revoke, nack, keyframes).
//
// Seats are leases: a seat is a station plus who drives it (a player, or the computer) and an `epoch` that
// goes up on every change of driver. Cover, hand-back, a mid-shift join, a reconnect and a host change are all the same
// operation, setDriver(): the epoch goes up and the station's state goes to the new driver. Results carry the epoch they
// were made under: one from an older lease is refused (nack 'epoch'), so a covered phone cannot write over the computer.
import { flowReset } from '../referee/flow';
import type { Envelope, PhoneBody, RefBody, Keyframe, SeatView, Driver, PlayerInfo, StationBlob, SeatId, PlayerId, CoverReason, NackReason, Caps, StationKind, Result } from '../proto/messages';
import { PROTO, BUILD } from '../proto/messages';
import { isPhoneEnv, isPhoneHead } from '../proto/validate';
import { G, liveG, bump, setRefOn } from '../state';
import { setFxRoute, emit, type Fx } from '../fx';
import { setRng, mulberry32 } from '../rng';
import { stationOf, blobOf, putBlob } from './registry';
import { applyResult, setResultSink, setLocalActor, withActor } from './results';
import { FLOOR_IDS, isFloorSeat, freshFloor, setFloorSeats, releaseAll, taskClaim, taskRelease, taskTouch, isAway } from '../work/floor';   // 樓面
import { sharedOf, applyShared } from './replica';
import { isExtraKind } from '../referee/extras';
import { tallyReset, tallyBefore, tallyAfter, tallyBurnt, setTallyDrivers } from './tally';
import { noteHandOut } from './fresh';

/** Defaults: quiet with work waiting, link loss (worker SEAT_GRACE_MS), tick and keyframe rates. */
export const COVER_QUIET_S = 30, COVER_LINK_S = 15, TICK_MS = 250, KEY_MS = 2000;
/**
 * Memory bounds against a buggy or hostile phone: a phone's messages held for order reach at most AHEAD_MAX past
 * its ack (later ones are dropped unseen and come again with the resend), and a paused shift holds at most HELD_MAX
 * results (more are refused, nack 'paused-queue').
 */
export const AHEAD_MAX = 64, HELD_MAX = 256;
/**
 * Closing the books: after the bell the referee still takes results stamped at or before the end until every
 * online teammate has said it sent them all (`closed`), or this long has passed (a phone that is gone never blocks it).
 */
export const CLOSE_GRACE_MS = 2000;
/** Up to 8 players; and 2 viewers (a TV) on top. */
export const MAX_PLAYERS = 8, MAX_VIEWERS = 2;
/** A new referee after a host change numbers its messages from refEpoch x this (so a host change is not undone by a late tick). */
export const REF_SEQ_EPOCH = 1_000_000_000;
/** The shop's four seats (one each). */
export const SHOP_SEATS: readonly StationKind[] = ['waiter', 'bar', 'kitchen', 'till'];

interface RefSeat extends SeatView { ckpt?: StationBlob; quiet: number }
/** `buf`: messages that came early, by seq; null for a good envelope whose body failed the check (nacked in its turn). */
interface RefPlayer extends PlayerInfo { heard: number; statusAt: number; away: boolean; buf: Map<number, Envelope<PhoneBody> | null> }
interface RefState {
  /**
   * In a room the referee runs in the room's Durable Object, not on a phone. `me` is then the room's own
   * id (ROOM_ME), never a player: no seat is driven here except by the computer, and the cover rules apply with one
   * player online (on a phone referee a lone player is the referee's own player, whom they never cover).
   */
  headless: boolean;
  room: string; me: PlayerId; round: number; refEpoch: number; seed: number; rseq: number; seq: number;
  seats: Record<SeatId, RefSeat>; players: Record<PlayerId, RefPlayer>; acks: Record<PlayerId, number>;
  /**
   * What a restarted referee would still have: on a phone referee every ack; in the room the acks
   * as of its last save (refMarkDurable), so phones keep, and resend after a restart, what that save does not hold.
   */
  durable: Record<PlayerId, number>;
  send: (e: Envelope<RefBody>) => void; now: number; tickAt: number; keyAt: number; keyVer: number; scale: () => number;
  /** Results that reached a paused shift: acked, applied on resume. */
  held: { p: PlayerId; seat: SeatId; e: Envelope<PhoneBody> }[];
  /** The roles this referee last wrote into G.roles (a write by anyone else is a request to change driver). */
  roles: Record<string, Role | undefined>;
  /** The seat whose result is being applied (null: the referee's own step or a station on this phone). */
  origin: SeatId | null;
  /**
   * The bell: null while the shift runs; then when it rang (`at`, page ms), the shift's end time (`t`, game s),
   * the teammates who have sent everything (`closed`), and `done` once the books are closed and the end card drawn.
   */
  end: { at: number; t: number; closed: PlayerId[]; done: boolean } | null;
  /** Counters for the tests and sims (I-3, I-4). */
  stats: { applied: number; nacked: number; junk: number; dup: number; ahead: number };
}
let R: RefState | null = null;
/** The referee state on this phone, or null (a teammate's phone, or no co-op). Read by tests and sims. */
export const referee = (): Readonly<RefState> | null => R;
export const isReferee = (): boolean => R !== null;
export function refStop(): void { R = null; setRefOn(false); setFxRoute(null); setResultSink(null); setTallyDrivers(null); setFloorSeats(null); setLocalActor(null); }
/** 樓面: the floor seats and who drives each, for the floor's computer workers. */
function floorSeatsNow(): { id: string; player: string | null }[] {
  const r = R; if (!r) return [];
  return Object.values(r.seats).filter(s => s.kind === 'floor').map(s => ({ id: s.id, player: playerOf(s.driver) }));
}
/** The floor's task list as a tick carries it: every open task id -> its holder ('' = open). */
function claimsOf(F: FloorShared): Record<string, string> {
  const o: Record<string, string> = {};
  for (const x of F.tasks) o[x.id] = x.by ?? '';
  return o;
}
/** The player driving seat seat on this referee, or null (the computer, or no such seat). */
const seatPlayer = (seat: SeatId): PlayerId | null => { const d = R?.seats[seat]?.driver; return d?.type === 'player' ? d.player : null; };
/** Starts a new audit window (the tests' auditReset): the counters back to zero. */
export function refStatsReset(): void { if (R) R.stats = { applied: 0, nacked: 0, junk: 0, dup: 0, ahead: 0 }; }
/** A teammate's result as the referee takes it: `ok` is null just before it applies, then true / false (applied / refused). */
export interface RefResultSeen { player: PlayerId; seq: number; seat: SeatId; r: Result; ok: boolean | null }
let refListener: ((e: RefResultSeen) => void) | null = null;
/** The tests' window on the referee (the journey auditor): every teammate result, before and after. */
export function onRefEvent(f: ((e: RefResultSeen) => void) | null): void { refListener = f; }

const drv = { computer: (): Driver => ({ type: 'computer' }), player: (p: PlayerId): Driver => ({ type: 'player', player: p }) };
const playerOf = (d: Driver): PlayerId | null => d.type === 'player' ? d.player : null;
const roleOf = (d: Driver, me: PlayerId): Role => d.type === 'player' ? (d.player === me ? 'me' : 'remote') : 'ai';

/** The view of a seat everyone sees (no checkpoint, no timers). */
const viewOf = (s: RefSeat): SeatView => ({ id: s.id, kind: s.kind, driver: s.driver, epoch: s.epoch, away: s.away, coverReason: s.coverReason, last: s.last });
const infoOf = (p: RefPlayer): PlayerInfo => ({ name: p.name, role: p.role, build: p.build, caps: p.caps, online: p.online });

export interface RefStartOpts { room: string; me: PlayerId; name: string; send: (e: Envelope<RefBody>) => void; seed: number; round: number; now: number; caps?: Caps;
  /** Seats of registered stations-next kinds this shift has (computer-driven until claimed). */
  extraSeats?: StationKind[];
  /** Teammates who sat down in the lobby: their seats are theirs from the start (granted on their hello). */
  seated?: Record<SeatId, { player: PlayerId; name: string }>;
  /** The shop clock's pace on this phone (the slow-down while a slip or the board is open); 1 if absent. */
  scale?: () => number;
  /** The room's referee: `me` is not a player and drives no seat (see RefState.headless). */
  headless?: boolean;
  /** 樓面: this many floor seats (floor1..3) replace the waiter, 傳菜 and 外賣 seats (their shop rules stay on). */
  floorSeats?: number }

/**
 * This phone becomes the referee of a new shift (after newGame()): the seats it plays itself are its own, the rest the
 * computer's until a teammate claims them. Teammates already in the room keep their place in `players`.
 */
export function refStart(o: RefStartOpts): void {
  const S = liveG(), keep = R && R.room === o.room ? R.players : {};
  flowReset(); setRefOn(true); tallyReset(); setTallyDrivers(seatPlayer);
  // the room's extra stations: the shop's rules for them (core/referee/extras.ts) run while G.extra is set
  const extra = (o.extraSeats ?? []).filter(isExtraKind).filter(k => stationOf(k));
  if (extra.length) S.extra = extra; else Reflect.deleteProperty(S, 'extra');
  // 樓面: the floor seats take the waiter's, 傳菜's and 外賣's work; those seats are not made
  const nFloor = Math.max(0, Math.min(FLOOR_IDS.length, Math.round(o.floorSeats ?? 0)));
  if (nFloor) S.floor = freshFloor(); else Reflect.deleteProperty(S, 'floor');
  const merged = (k: string): boolean => nFloor > 0 && (k === 'waiter' || k === 'runner' || k === 'takeaway');
  const seats: Record<SeatId, RefSeat> = {};
  for (const k of SHOP_SEATS){
    if (merged(k)) continue;
    const mine = Reflect.get(S.roles, k) === 'me';
    seats[k] = { id: k, kind: k, driver: mine ? drv.player(o.me) : drv.computer(), epoch: 1, away: false, coverReason: mine ? null : 'empty', last: mine ? o.me : null, quiet: 0 };
  }
  for (const k of o.extraSeats ?? []) if (stationOf(k) && !merged(k)) seats[k] = { id: k, kind: k, driver: drv.computer(), epoch: 1, away: false, coverReason: 'empty', last: null, quiet: 0 };
  for (const id of FLOOR_IDS.slice(0, nFloor)) seats[id] = { id, kind: 'floor', driver: drv.computer(), epoch: 1, away: false, coverReason: 'empty', last: null, quiet: 0 };
  // a lobby seat at the waiter, 傳菜 or 外賣 (an older page, the owner's start screen) sits at a free floor seat
  const floorAt = (id0: string): string => {
    if (!nFloor || !(merged(id0) || isFloorSeat(id0))) return id0;
    const free = FLOOR_IDS.slice(0, nFloor).filter(f => seats[f]?.driver.type === 'computer');
    return free.find(f => f === id0) ?? free[0] ?? id0;
  };
  const players: Record<PlayerId, RefPlayer> = {};
  for (const [id, p] of Object.entries(keep)) players[id] = { ...p, buf: new Map() };
  for (const [id0, sp] of Object.entries(o.seated ?? {})){
    const s = seats[floorAt(id0)]; if (!s || sp.player === o.me) continue;
    s.driver = drv.player(sp.player); s.coverReason = null; s.last = sp.player;
    // not heard from yet: the link rule covers the seat if they never arrive
    const pl = players[sp.player] ?? { name: sp.name, role: 'player', build: BUILD, caps: { z: false, cs: true, ptt: false }, online: true, heard: o.now, statusAt: o.now, away: false, buf: new Map() };
    pl.heard = o.now; pl.online = true; players[sp.player] = pl;
  }
  if (!o.headless) players[o.me] = { name: o.name, role: 'player', build: BUILD, caps: o.caps ?? { z: false, cs: true, ptt: false }, online: true, heard: o.now, statusAt: o.now, away: false, buf: new Map() };
  R = { headless: !!o.headless, room: o.room, me: o.me, round: o.round, refEpoch: 0, seed: o.seed, rseq: 0, seq: 0, seats, players, acks: {}, durable: {}, send: o.send, now: o.now, scale: o.scale ?? ((): number => 1),
    tickAt: -1e9, keyAt: -1e9, keyVer: -1, held: [], roles: {}, origin: null, end: null, stats: { applied: 0, nacked: 0, junk: 0, dup: 0, ahead: 0 } };
  syncRoles();
  setResultSink(null);   // this phone's stations apply their results at once (the in-memory bus)
  setFxRoute(routeFx);
  setFloorSeats(floorSeatsNow); setLocalActor(() => R?.me ?? '');
}

/** How many players / viewers are online (the cover rules only apply in co-op: with one player, solo plays as before). */
const online = (role: 'player' | 'viewer'): number => R ? Object.values(R.players).filter(p => p.online && p.role === role).length : 0;
/** The cover rules for quiet and away apply: in a room of players (on a phone referee, more than its own player). */
const coverOn = (): boolean => online('player') > (R?.headless ? 0 : 1);

function env(b: RefBody, to?: PlayerId): Envelope<RefBody> {
  const r = R; if (!r) throw new Error('chakei: no referee');
  const e: Envelope<RefBody> = { p: PROTO, room: r.room, from: 'ref', round: r.round, seq: ++r.seq, at: G ? G.t : 0, b };
  if (to !== undefined) e.to = to;
  return e;
}
const sendTo = (to: PlayerId | undefined, b: RefBody): void => { if (R && (to === undefined || to !== R.me)) R.send(env(b, to)); };

/** An effect: plays on this phone, or goes to the teammate whose seat it is for, or to nobody. */
function routeFx(e: Fx): boolean {
  const r = R; if (!r) return true;
  // the bell (endShift): the end card waits until the books are closed (refFrame draws it then)
  if (e.k === 'end'){
    if (r.end?.done) return true;
    if (!r.end) r.end = { at: r.now, t: G ? G.t : 0, closed: [], done: false };
    return false;
  }
  const target = e.k === 'say' ? e.role : e.k === 'float' || e.k === 'shake' ? 'waiter' : null;
  // toasts, sounds, the combo: the phone whose step caused them (a teammate predicted their own already)
  if (target === null) return r.origin === null;
  const s = r.seats[target]; if (!s) return r.origin === null;
  const p = playerOf(s.driver);
  if (p === r.me) return true;
  if (p !== null && target !== r.origin){ r.rseq++; sendTo(p, { k: 'ev', rseq0: r.rseq, list: [{ e: 'fx', to: target, fx: { ...e } }] }); }
  return false;
}

/** G.roles is this phone's view of the seats: 'me' (I drive it), 'remote' (a teammate), 'ai' (the computer). */
function syncRoles(): void {
  const r = R; if (!r || !G) return;
  const fl: Role[] = [];
  for (const s of Object.values(r.seats)){
    const role = roleOf(s.driver, r.me), key = s.kind === 'floor' ? s.id : s.kind;
    Reflect.set(G.roles, key, role); r.roles[key] = role;
    if (s.kind === 'floor') fl.push(role);
  }
  // 樓面: the floor as one role (the waiter's complaints and screens follow it)
  if (fl.length){ const agg: Role = fl.includes('me') ? 'me' : fl.includes('remote') ? 'remote' : 'ai'; G.roles.floor = agg; G.roles.waiter = agg; }
}
/** Someone wrote G.roles (a test, the page's 換人 button): that is a request to change who drives the seat. */
function reconcileRoles(): void {
  const r = R; if (!r || !G) return;
  for (const s of Object.values(r.seats)){
    const key = s.kind === 'floor' ? s.id : s.kind, now: unknown = Reflect.get(G.roles, key), was = r.roles[key];
    if (now === was || was === undefined) continue;
    if (now === 'ai') setDriver(s.id, drv.computer(), 'release');
    else if (now === 'me') setDriver(s.id, drv.player(r.me), 'claim');
    else syncRoles();
  }
}

/**
 * The one way a seat changes hands: the epoch goes up, the station's state goes to the new driver (a grant
 * to a teammate's phone, or into this phone's G for the computer or for this phone's player), the old driver is told.
 */
export function setDriver(id: SeatId, d: Driver, why: CoverReason | 'claim' | 'release' | 'start'): boolean {
  const r = R, s = r?.seats[id]; if (!r || !s) return false;
  const S = liveG(), m = stationOf(s.kind), old = s.driver, oldP = playerOf(old), newP = playerOf(d);
  if (old.type === d.type && oldP === newP) return false;
  if (s.kind === 'floor' && oldP !== null) releaseAll(oldP);   // 樓面: their claims and any run go back
  // the state comes back from a teammate's phone: the latest checkpoint now, the exact state with their handover
  if (oldP !== null && oldP !== r.me && s.ckpt) putBlob(S, s.ckpt);
  if (d.type === 'computer') m?.toComputer?.(S);
  else if (old.type === 'computer'){ m?.toPlayer?.(S); noteHandOut(s.kind, 'seat'); }   // untouched work only
  s.epoch++; s.driver = d; s.quiet = 0;
  s.coverReason = d.type === 'computer' ? (why === 'claim' || why === 'release' || why === 'start' ? 'empty' : why) : null;
  s.away = d.type === 'computer' && (why === 'away' || why === 'link');
  if (oldP !== null) s.last = oldP;
  if (newP !== null) s.last = newP;
  if (oldP !== null && oldP !== r.me) sendTo(oldP, { k: 'revoke', seat: id, epoch: s.epoch, why });
  if (newP !== null && newP !== r.me) sendTo(newP, { k: 'grant', seat: id, epoch: s.epoch, state: blobOf(S, s.kind) });
  r.rseq++;
  r.keyVer = -1;   // a keyframe goes out with the next frame
  syncRoles(); bump();
  return true;
}

/** A keyframe of the shift as it is now: shared state, seats (the computer's with their state), players. */
export function keyframe(): Keyframe {
  const r = R; if (!r) throw new Error('chakei: no referee');
  const S = liveG(), seats: Keyframe['seats'] = {};
  for (const s of Object.values(r.seats)){
    const v: SeatView & { ckpt?: StationBlob } = viewOf(s);
    // the computer's seats travel with their state, so a new referee can carry on after a host change (4.7)
    if (s.driver.type === 'computer'){ const b = blobOf(S, s.kind); if (b) v.ckpt = b; }
    seats[s.id] = v;
  }
  const players: Record<PlayerId, PlayerInfo> = {};
  for (const [id, p] of Object.entries(r.players)) players[id] = infoOf(p);
  return { rseq: r.rseq, round: r.round, refEpoch: r.refEpoch, seed: r.seed, shared: sharedOf(S), seats, players, acks: { ...r.acks }, durable: r.headless ? { ...r.durable } : { ...r.acks },
    ...(r.end?.done ? { closed: true as const } : {}) };
}
/** The room saved the shift: what it holds now is what a restarted referee will have (`durable`). */
export function refMarkDurable(): void { if (R) R.durable = { ...R.acks }; }

function nack(p: PlayerId, seq: number, reason: NackReason): void { if (R) R.stats.nacked++; sendTo(p, { k: 'nack', player: p, seq, reason }); }

/**
 * A message from the room (what a teammate's phone sent; the room stamped `from`). Junk is counted and dropped,
 * except a good envelope from a known player whose sequenced body fails the check: it keeps its place in that player's
 * stream and is refused in its turn (nack 'invalid'), so the phone drops it and its later messages still apply.
 */
export function refReceive(raw: unknown, now: number): void {
  const r = R; if (!r) return;
  if (!isPhoneHead(raw) || raw.room !== r.room){ r.stats.junk++; return; }
  const e = isPhoneEnv(raw) ? raw : null, p = raw.from, seq = raw.seq;
  if (!e) r.stats.junk++;
  if (!e && seq === 0) return;
  r.now = now;
  if (e?.b.k === 'hello'){ hello(e, e.b, now); return; }
  const pl = r.players[p];
  if (!pl){ if (e) sendTo(p, { k: 'reject', reason: 'closed', newer: false }); return; }
  pl.heard = now; pl.online = true;
  // a status from the last shift (sent before the phone saw this one) must not become this shift's checkpoint: its
  // station state (the till's customer) would come back in the grant and be served in the wrong shift
  if (e && seq === 0){ if (raw.round === r.round || e.b.k !== 'status') unsequenced(p, pl, e.b, now); return; }
  if (raw.round !== r.round){ nack(p, seq, 'closed'); return; }
  const ack = r.acks[p] ?? 0;
  if (seq <= ack || pl.buf.has(seq)){ r.stats.dup++; return; }
  // too far ahead to hold (memory): dropped unseen, the phone resends it after RESEND_MS
  if (seq > ack + AHEAD_MAX){ r.stats.ahead++; return; }
  pl.buf.set(seq, e);
  // apply in order: a message that arrives early waits for the ones before it (reorder, I-3)
  for (let next = ack + 1; pl.buf.has(next); next++){
    const m = pl.buf.get(next); pl.buf.delete(next); r.acks[p] = next;
    if (m) sequenced(p, m); else nack(p, next, 'invalid');
  }
}

function hello(e: Envelope<PhoneBody>, b: Extract<PhoneBody, { k: 'hello' }>, now: number): void {
  const r = R; if (!r) return;
  if (b.proto !== PROTO){ sendTo(e.from, { k: 'reject', reason: 'proto', newer: b.proto > PROTO }); return; }
  const known = r.players[e.from];
  if (!known && online(b.role) >= (b.role === 'viewer' ? MAX_VIEWERS : MAX_PLAYERS)){ sendTo(e.from, { k: 'reject', reason: 'full', newer: false }); return; }
  // a reloaded page carries on counting from the referee's ack (the welcome tells it), so acks only go up (I-6)
  const fresh = !b.resume || b.resume.round !== r.round;
  r.acks[e.from] = r.acks[e.from] ?? 0;
  r.players[e.from] = { name: b.name, role: b.role, build: b.build, caps: b.caps, online: true, heard: now, statusAt: now, away: false, buf: new Map() };
  sendTo(e.from, { k: 'welcome', you: e.from, key: keyframe() });
  // a reloaded page still holds its seats but lost their state (or a lobby seat's first hello): the seat comes with its state
  if (fresh || !known) for (const s of Object.values(r.seats)) if (playerOf(s.driver) === e.from){
    s.epoch++; sendTo(e.from, { k: 'grant', seat: s.id, epoch: s.epoch, state: s.ckpt ?? blobOf(liveG(), s.kind) });
  }
  // back after a lost link or a locked phone: the seat the computer covered comes back to them
  if (b.role === 'player') for (const s of Object.values(r.seats)) if (s.driver.type === 'computer' && s.last === e.from && (s.coverReason === 'away' || s.coverReason === 'link')) setDriver(s.id, drv.player(e.from), 'claim');
}

/** The kitchen's burns travel in its checkpoint (registry.ts pick): the party round's report counts them per cook. */
function burntOf(p: PlayerId, seat: SeatId, b: StationBlob): void {
  const s: unknown = b.s, n: unknown = typeof s === 'object' && s !== null ? Reflect.get(s, 'burnt') : undefined;
  if (typeof n === 'number' && Number.isFinite(n)) tallyBurnt(p, seat, n);
}
function unsequenced(p: PlayerId, pl: RefPlayer, b: PhoneBody, now: number): void {
  const r = R; if (!r) return;
  if (b.k === 'status'){
    const dt = Math.max(0, (now - pl.statusAt) / 1000); pl.statusAt = now;
    for (const [id, st] of Object.entries(b.seats)){
      const s = r.seats[id]; if (!s || playerOf(s.driver) !== p) continue;
      if (st.ckpt && st.ckpt.kind === s.kind){ s.ckpt = st.ckpt; if (s.kind === 'kitchen') burntOf(p, id, st.ckpt); }
      // a player out on a 送外賣 run is working, not quiet (no cover takes their seat while they are away)
      s.quiet = st.inputs === 0 && st.waiting > 0 && !isAway(p) ? s.quiet + dt : 0;
      if (s.quiet >= COVER_QUIET_S && coverOn()) setDriver(id, drv.computer(), 'quiet');
    }
    if (b.tasks && G?.floor) taskTouch(p, b.tasks);   // 樓面: the tasks they are still on
  } else if (b.k === 'resync') sendTo(p, { k: 'keyframe', key: keyframe() });
  // floorReq / floorHold / floorRelease / nudge: reserved (sections 6, 7: push-to-talk is built on its own branch)
}

function sequenced(p: PlayerId, e: Envelope<PhoneBody>): void {
  const r = R, b = e.b; if (!r) return;
  const pl = r.players[p], S = liveG();
  switch (b.k){
    case 'claim': {
      const s = r.seats[b.seat];
      if (!s || pl?.role !== 'player'){ nack(p, e.seq, pl?.role === 'viewer' ? 'viewer' : 'invalid'); return; }
      const holder = playerOf(s.driver);
      if (holder !== null && holder !== p){ nack(p, e.seq, 'taken'); return; }
      setDriver(b.seat, drv.player(p), 'claim'); return;
    }
    case 'release': { const s = r.seats[b.seat]; if (s && playerOf(s.driver) === p) setDriver(b.seat, drv.computer(), 'release'); return; }
    case 'task': {
      // 樓面: the first claim the referee receives wins; a later one is refused ('taken') and the phone shows it again
      const onFloor = Object.values(r.seats).some(s => s.kind === 'floor' && playerOf(s.driver) === p);
      if (!onFloor || !S.floor){ nack(p, e.seq, pl?.role === 'viewer' ? 'viewer' : 'invalid'); return; }
      if (b.op === 'release'){ taskRelease(p, b.id); return; }
      if (!taskClaim(p, b.id)) nack(p, e.seq, 'taken');
      return;
    }
    case 'res': {
      const s = r.seats[b.seat];
      if (!s || playerOf(s.driver) !== p || b.epoch !== s.epoch){ nack(p, e.seq, 'epoch'); return; }
      // after the bell: only what was made before it, and only until the books are closed
      const end = r.end;
      if (end && (end.done || end.closed.includes(p) || e.at > end.t)){ nack(p, e.seq, 'closed'); return; }
      if (S.paused){ if (r.held.length >= HELD_MAX) nack(p, e.seq, 'paused-queue'); else r.held.push({ p, seat: b.seat, e }); return; }
      applyFrom(p, b.seat, e.seq, b.r, e.at);
      return;
    }
    case 'away': if (pl){ pl.away = true; if (coverOn()) for (const s of Object.values(r.seats)) if (playerOf(s.driver) === p) setDriver(s.id, drv.computer(), 'away'); } return;
    case 'back': if (pl){ pl.away = false; for (const s of Object.values(r.seats)) if (s.driver.type === 'computer' && s.last === p && s.coverReason === 'away') setDriver(s.id, drv.player(p), 'claim'); } return;
    case 'handover': {
      // the exact state of a seat this phone just lost: it replaces the checkpoint, if the computer has it
      const s = r.seats[b.seat];
      if (s && s.driver.type === 'computer' && s.last === p && b.epoch === s.epoch && b.state.kind === s.kind){
        if (putBlob(S, b.state)){ s.ckpt = b.state; stationOf(s.kind)?.toComputer?.(S); bump(); }
      }
      return;
    }
    case 'pause': setPaused(b.on); return;
    case 'closed': if (r.end && !r.end.closed.includes(p)) r.end.closed.push(p); return;
    default: return;   // focus: the slip/board slow-down is the station's own
  }
}

/** `at`: the game time on the teammate's phone when it made the result (the envelope's), for the third star's timings. */
function applyFrom(p: PlayerId, seat: SeatId, seq: number, res: Extract<PhoneBody, { k: 'res' }>['r'], at: number): void {
  const r = R; if (!r) return;
  r.origin = seat;
  refListener?.({ player: p, seq, seat, r: res, ok: null });
  let ok: boolean;
  tallyBefore();   // the party round's per-person counts (./tally.ts)
  try { ok = withActor(p, () => applyResult(seat, res, at)); } finally { r.origin = null; }
  tallyAfter(p, res, ok);
  refListener?.({ player: p, seq, seat, r: res, ok });
  if (ok) r.stats.applied++; else nack(p, seq, 'closed');
}

/** Pause or resume the shift for everyone; results that arrived meanwhile are applied on resume. */
export function setPaused(on: boolean): void {
  const r = R, S = liveG(); if (!r) return;
  S.paused = on; bump();
  if (!on){ const held = r.held.splice(0); for (const h of held) if (h.e.b.k === 'res') applyFrom(h.p, h.seat, h.e.seq, h.e.b.r, h.e.at); }
}

/**
 * After the shop's step (update): the seat rules and what goes out to the room. `now` is the page's clock in ms (a
 * simulation's virtual clock); core keeps no clock of its own.
 */
export function refFrame(now: number): void {
  const r = R; if (!r || !G) return;
  r.now = now;
  reconcileRoles();
  // a teammate not heard from for COVER_LINK_S: the computer covers their seats (they get them back on reconnect)
  for (const [id, p] of Object.entries(r.players)){
    if (id === r.me || !p.online || now - p.heard < COVER_LINK_S * 1000) continue;
    p.online = false;
    for (const s of Object.values(r.seats)) if (playerOf(s.driver) === id) setDriver(s.id, drv.computer(), 'link');
  }
  closeBooks(now);
  if (now - r.tickAt >= TICK_MS){
    r.tickAt = now;
    const S = G;
    sendTo(undefined, { k: 'tick', t: S.t, rt: S.rt, running: S.running, paused: S.paused, scale: r.scale(), acks: { ...r.acks }, rseq: r.rseq, round: r.round, ...(S.floor ? { tk: claimsOf(S.floor) } : {}) });
    if ((S.ver !== r.keyVer && now - r.keyAt >= TICK_MS) || now - r.keyAt >= KEY_MS){ r.keyAt = now; r.keyVer = S.ver; sendTo(undefined, { k: 'keyframe', key: keyframe() }); }
  }
}

/**
 * After the bell, the books close once every online teammate has sent all it made before the end (`closed`, in
 * its stream after its last result), or CLOSE_GRACE_MS after the bell; then the end card is drawn here, and the next
 * keyframe (`closed`) draws it on every phone, so every card shows the same books as the shop.
 */
function closeBooks(now: number): void {
  const r = R, end = r?.end; if (!r || !end || end.done) return;
  const waiting = Object.entries(r.players).some(([id, p]) => id !== r.me && p.online && p.role === 'player' && !end.closed.includes(id));
  if (waiting && now - end.at < CLOSE_GRACE_MS) return;
  end.done = true; r.keyVer = -1; bump();
  emit({ k: 'end' });
}

export interface TakeOverOpts { room: string; me: PlayerId; send: (e: Envelope<RefBody>) => void; now: number; gone: PlayerId[]; mine: { seat: SeatId; r: Result; seq: number; at?: number }[]; scale?: () => number; headless?: boolean }
/**
 * A new referee carrying on from a keyframe. On a phone referee it serves a host change (a phone takes over from the
 * last keyframe it applied, plus its own unacknowledged results). A room has no host change: the room's Durable
 * Object uses it (headless, `mine` empty) when it restarts mid-shift from the keyframe it saved. Seats of players who are
 * gone go to the computer; the computer's seats get their state from the keyframe. The new referee's epoch is one up,
 * its random stream re-seeded, and every phone is welcomed again (they resend what it has not acknowledged).
 */
export function refTakeOver(key: Keyframe, o: TakeOverOpts): void {
  setRefOn(true); setTallyDrivers(seatPlayer);
  const S = liveG(), gone = new Set(o.gone);
  const seats: Record<SeatId, RefSeat> = {};
  for (const [id, v] of Object.entries(key.seats)) seats[id] = { ...viewOf({ ...v, quiet: 0 }), quiet: 0, ...(v.ckpt ? { ckpt: v.ckpt } : {}) };
  const players: Record<PlayerId, RefPlayer> = {};
  for (const [id, p] of Object.entries(key.players)) if (!gone.has(id)) players[id] = { ...p, online: true, heard: o.now, statusAt: o.now, away: false, buf: new Map() };
  const refEpoch = key.refEpoch + 1;
  // its messages are numbered above any the old referee sent: a phone orders the referee's messages by seq, and one of the
  // old referee's still on the way after the welcome must not out-number (and so shut out) every message of the new one
  const seq0 = refEpoch * REF_SEQ_EPOCH;
  R = { headless: !!o.headless, room: o.room, me: o.me, round: key.round, refEpoch, seed: key.seed, rseq: key.rseq + 1, seq: seq0, seats, players, acks: { ...key.durable }, durable: { ...key.durable }, send: o.send, now: o.now, scale: o.scale ?? ((): number => 1),
    tickAt: -1e9, keyAt: -1e9, keyVer: -1, held: [], roles: {}, origin: null, end: null, stats: { applied: 0, nacked: 0, junk: 0, dup: 0, ahead: 0 } };
  setRng(mulberry32((key.seed + refEpoch * 7919) >>> 0));
  // the shift as the room last saw it (the room keeps the last keyframe: every phone's state is at most that new), then
  // this phone's own results the old referee had not put in a keyframe
  const sh: unknown = key.shared;
  if (typeof sh === 'object' && sh !== null && !Array.isArray(sh)) applyShared(S, Object.fromEntries(Object.entries(sh)));
  setResultSink(null);
  setFxRoute(() => false);
  try { for (const m of o.mine) if (m.seq > (key.durable[o.me] ?? 0)) applyResult(m.seat, m.r, m.at); } finally { setFxRoute(null); }
  R.acks[o.me] = 0;
  // the old referee left after its bell: the books it had closed stay closed; still closing, they close here
  if (key.closed) R.end = { at: o.now, t: S.t, closed: [], done: true };
  else if (!S.running && S.t > 0) R.end = { at: o.now, t: S.t, closed: [], done: false };
  for (const s of Object.values(seats)){
    const p = playerOf(s.driver);
    if (s.driver.type === 'computer' && s.ckpt) putBlob(S, s.ckpt);
    else if (p !== null && (gone.has(p) || !players[p])){
      if (s.ckpt) putBlob(S, s.ckpt);
      s.driver = drv.computer(); s.epoch++; s.coverReason = 'link'; s.away = true; s.last = p;
      stationOf(s.kind)?.toComputer?.(S);
    }
  }
  syncRoles();
  setResultSink(null);
  setFxRoute(routeFx);
  setFloorSeats(floorSeatsNow); setLocalActor(() => R?.me ?? '');
  for (const id of Object.keys(players)) if (id !== o.me) sendTo(id, { k: 'welcome', you: id, key: keyframe() });
  bump();
}
