// The room's referee: what the room's Durable Object runs (worker/index.ts), and what
// the co-op simulations (tests/sim/coop.js) run as the referee, so both drive this exact code. One core instance per room
// (scripts/build.mjs wraps the core in a factory for the Worker; the sims load a fresh copy per phone), so every module
// variable (G, the referee, the random stream, the clock) is this room's own.
//
// No phone is special: the referee (core/coop/referee.ts) runs here headless (ROOM_ME is the room, never a player), every
// player is a phone (core/coop/phone.ts) that predicts its own station and sends results; the computer drives every seat
// nobody holds. The shift is set up the way the host's phone used to set it up (after levelEnter and
// levelBegin): the level's fixed shop and pace, the computer on every seat, the lobby's seats granted on hello, the bar's
// pot empty when a player sits at the bar.
//
// The clock: the room calls roomAdvance(now) about 20 times a second while a shift runs (a timer in the Durable
// Object; it stays awake anyway while phones talk to it). Each call plays the wall time since the last one in the shop's
// fixed steps (core/referee/clock.ts, 1/60 s), at most ROOM_CATCHUP_S at once, so a late wake-up catches up instead of
// slowing the shop; then refFrame sends the 4 Hz tick and the keyframes.
import type { Envelope, RefBody, SeatId, PlayerId, StationKind, Keyframe } from '../proto/messages';
import { DEFAULT_PORT, setPort } from '../env';
import { setRng, mulberry32 } from '../rng';
import { G, liveG, newGame, setSlot, setDiff, setStation, setTABLES, TABLES, D, byId, bump } from '../state';
import { DIFFS, CFG, SLOTS } from '../data/menus';
import { resetClock, advance } from '../referee/clock';
import { careerTick, makeGroup, enqueue, seatProblem, tillWarmup } from '../referee/customers';
import { seat as seatGroup, submitOrder } from '../referee/judge';
import { genOrder } from '../rules/order';
import { itemsOf, isMeal } from '../rules/price';
import { drainFx } from '../fx';
import { refStart, refReceive, referee, setDriver, setPaused, refTakeOver, keyframe, refMarkDurable } from './referee';
import { coopStep, coopFrame } from './index';
import { sharedOf } from './replica';
import { isExtraKind } from '../referee/extras';
import { PARTY_FLOOR, PARTY_SHOPS, TWISTS, isPartyFloor, partyFloor, partySeats, shopDifficulty } from '../party/config';
import { roundPay } from '../party/pay';
import type { PlayerRoundStats, RoundPlan, RoundReport, ShopId, StationReport, Twist } from '../party/types';
import { TWIST } from '../referee/twist';
import { SPEED_WHAT, STAR3, isSpeedStation } from '../referee/speed';
import { tallyOf, tallySave, tallyLoad } from './tally';
import { levelRoles, needsFloor } from '../work/roles';
import { floorLevel } from '../work/floor';
import { workSpecFor } from '../work/spec';

/** The referee's own id in the room: never a player's (phone ids are [a-z0-9]{4,16}). */
export const ROOM_ME = '#room';
/** How often the room wakes while a shift runs (ms), and the most game time one wake-up plays (a late timer). */
export const ROOM_WAKE_MS = 50, ROOM_CATCHUP_S = 5;

/** The room owner's save, for the few rules that read it in a level. */
export interface RoomPort { rank: number; rlv: Record<string, number>; names: Record<string, string> }
/** What a shift is played with: the lobby's settings (the room owner's start message) and who sits where. */
export interface RoomShift {
  /** The level's id and its definition (ui/levels.ts LEVELS, sent by the owner's page); null = the plain shop. */
  level: string; lv: Level | null; slot: Slot; diff: string;
  extra: StationKind[];
  /** 樓面: floor seats on a level whose roles have 傳菜 or 外賣 (its spec's `floor`); absent / 0: the old seats. */
  floor?: number;
  /** The co-op lobby's switched-on 樓面 places (1-2) that gave `floor`; kept so a restart reads the same. */
  floorOn?: number;
  /** The lobby's seats: these players drive these seats from the start (granted on their hello). */
  seated: Record<SeatId, { player: PlayerId; name: string }>;
  port: RoomPort | null;
  /** A party night's round: the plain shop at the party shop's pace, for the round's length. */
  party?: PartyShift;
}
/** speed: the clock's rate against the wall clock (1; tests only raise it, dbg 'speed', like the page's Bot.scale). */
interface RoomHost { room: string; send: (e: Envelope<RefBody>) => void; last: number; sh: RoomShift; round: number; seed: number; speed: number;
  /** Party rounds: who drove each seat for how many game seconds (the round report's drivers), and the clock it is at. */
  drove: Record<SeatId, Record<PlayerId, number>>; droveT: number }
let H: RoomHost | null = null;
/** The room's shift settings, round and seed while one has been started here (null: still in the lobby). */
export const roomHost = (): Readonly<RoomHost> | null => H;

// ---- the owner's start message, checked (worker/index.ts hands it over as it came) ----
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const isSlot = (v: unknown): v is Slot => typeof v === 'string' && Object.keys(SLOTS).includes(v);
function isLevel(v: unknown): v is Level {
  if (!isRec(v) || typeof v.name !== 'string' || !isSlot(v.slot) || !isStrs(v.menu) || !isNum(v.pat) || !isNum(v.gap)) return false;
  if (!Array.isArray(v.stars) || v.stars.length !== 3 || !v.stars.every(isNum)) return false;
  const lay = v.lay;
  if (!isRec(lay) || !Array.isArray(lay.tables) || !lay.tables.length || lay.tables.length > 12) return false;
  if (!lay.tables.every(t => Array.isArray(t) && typeof t[0] === 'string' && t[0] in TABLE_CAP)) return false;
  return v.kit === undefined || (isRec(v.kit) && isRec(v.kit.st) && isStrs(v.kit.inst));
}
function portOf(v: unknown): RoomPort | null {
  if (!isRec(v) || !isNum(v.rank) || !isRec(v.rlv) || !isRec(v.names)) return null;
  const rlv: Record<string, number> = {}, names: Record<string, string> = {};
  for (const [k, x] of Object.entries(v.rlv)) if (isNum(x)) rlv[k] = Math.max(1, Math.min(3, Math.round(x)));
  for (const [k, x] of Object.entries(v.names)) if (typeof x === 'string') names[k] = x.slice(0, 20);
  return { rank: Math.max(0, Math.min(9, Math.round(v.rank))), rlv, names };
}
/**
 * The settings of a start message (`{ level, lv, slot, diff, extra, port }`), or null if they are not usable. `seated`
 * comes from the room's own seat list, never from the message.
 */
export function roomShiftOf(m: unknown, seated: RoomShift['seated']): RoomShift | null {
  if (!isRec(m)) return null;
  const lv = m.lv === null || m.lv === undefined ? null : isLevel(m.lv) ? m.lv : undefined;
  if (lv === undefined) return null;
  const slot = lv ? lv.slot : isSlot(m.slot) ? m.slot : 'lunch';
  const diff = typeof m.diff === 'string' && Object.keys(DIFFS).includes(m.diff) ? m.diff : 'pro';
  // a level's own stations (its `roles`) replace the lobby's toggles; free play keeps the toggles
  const extra = lv?.roles ? levelRoles(lv) : isStrs(m.extra) ? [...new Set(m.extra.filter(isExtraKind))] : [];
  const party = partyOf(m.party);
  if (party) return { level: '', lv: null, slot, diff: 'party', extra: levelRoles(PARTY_SHOPS[party.shop]), seated, port: null, party, ...partyFloorOf(party.shop, seated) };
  const level = lv && typeof m.level === 'string' ? m.level.slice(0, 40) : '';
  // 樓面: a floor level seats the floor; so does free play with 傳菜 or 外賣 added, since those are the
  // floor's tasks, never seats of their own. The lobby's switched-on 樓面 places (1-2, as a
  // party night's) are the floor seats, a player's or the computer's each; a place switched off is no
  // seat, so with every place a player's nobody else works the floor (core/work/floor.ts floorShareNow gives the players
  // all of it), and a computer place covers the rest as before. A message without `floorOn` (an older page, the sims):
  // the level's own count, as before.
  const isFloor = lv ? floorLevel(lv) : needsFloor(extra);
  const on = isFloor && isNum(m.floorOn) ? Math.max(1, Math.min(PARTY_FLOOR.length, Math.round(m.floorOn))) : 0;
  const floor = isFloor ? on || workSpecFor(level).floor : 0;
  return { level, lv, slot, diff, extra, seated, port: portOf(m.port), ...(floor ? { floor } : {}), ...(on ? { floorOn: on } : {}) };
}

// ---- party rounds ----
/** A party round as the shop plays it: which party shop sets the pace, how long, the night's round index, and the 搏盡
 *  card's mishap (core/referee/twist.ts; null without the card). */
export interface PartyShift { shop: ShopId; sec: number; round: number; twist: Twist | null; roles?: Partial<Record<ExtraKind, number>>;
  /** 樓面's switched-on places (1 or 2; absent: both, as before). core/work/floor.ts partyFloorCpu. */
  floorOn?: number }
const isShop = (v: unknown): v is ShopId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PARTY_SHOPS, v);
const twistIn = (v: unknown): Twist | null => TWISTS.find(x => x === v) ?? null;
/** A party shop's stations and tiers, from the shop itself, never from a message: the stations read their tier
 *  from the shift's G.party as a level's from its `roles` (core/work/roles.ts levelTier). */
const shopRoles = (shop: ShopId): Pick<PartyShift, 'roles'> => { const r = PARTY_SHOPS[shop].roles; return r ? { roles: { ...r } } : {}; };
/** A 樓面 party shop's floor seats: one per player on 樓面 (two at most), one for the computer when
 *  nobody is, so the floor's work is about one player's load per player on it. */
function partyFloorOf(shop: ShopId, seated: RoomShift['seated']): Pick<RoomShift, 'floor'> {
  if (!partyFloor(shop)) return {};
  return { floor: Math.max(1, Object.keys(seated).filter(isPartyFloor).length) };
}
export function partyOf(v: unknown): PartyShift | null {
  if (!isRec(v) || !isShop(v.shop) || !isNum(v.sec) || !isNum(v.round)) return null;
  const on = isNum(v.floorOn) ? Math.max(1, Math.min(PARTY_FLOOR.length, Math.round(v.floorOn))) : null;
  return { shop: v.shop, sec: Math.max(30, Math.min(600, v.sec)), round: Math.max(0, Math.round(v.round)), twist: twistIn(v.twist), ...shopRoles(v.shop), ...(on === null ? {} : { floorOn: on }) };
}
/** 樓面's switched-on places in a round's plan: the floor seats less the ones switched off, at least 1. */
const floorOnOf = (plan: RoundPlan): Pick<PartyShift, 'floorOn'> =>
  partyFloor(plan.shop) ? { floorOn: Math.max(1, PARTY_FLOOR.filter(k => k in plan.seats && !(plan.floorOff ?? []).includes(k)).length) } : {};
/** The shift a party night's round start asks for: the plan's slot, shop, length and seats. */
export function roomPartyShift(plan: RoundPlan, names: Record<PlayerId, string>): RoomShift {
  const seated: RoomShift['seated'] = {};
  for (const [seat, p] of Object.entries(plan.seats)) if (typeof p === 'string') seated[seat] = { player: p, name: names[p] ?? p };
  return { level: '', lv: null, slot: plan.slot, diff: 'party', extra: levelRoles(PARTY_SHOPS[plan.shop]), seated, port: null, party: { shop: plan.shop, sec: plan.sec, round: plan.round, twist: plan.twist, ...shopRoles(plan.shop), ...floorOnOf(plan) }, ...partyFloorOf(plan.shop, seated) };
}
/** The game's own round length and fever length, before any party round changed them. */
const BASE_SEC = CFG.gameSec, BASE_FEVER = CFG.fever.sec;
/**
 * The party shop's pace and the round's length (the plain shop, as the calibration played it: tests/sim/party-team.js);
 * null puts the game's own length back. The room and every phone install the same, so a station predicts what the
 * referee does.
 */
export function installParty(p: PartyShift | null): void {
  if (!p) { CFG.gameSec = BASE_SEC; CFG.fever.sec = BASE_FEVER; return; }
  const pro = DIFFS.pro ?? D();
  Object.defineProperty(DIFFS, 'party', { value: shopDifficulty(pro, p.shop), enumerable: false, configurable: true, writable: true });
  setDiff('party');
  CFG.gameSec = p.sec;
  CFG.fever.sec = p.twist === 'rush' ? TWIST.rushSec : BASE_FEVER;   // 人潮長啲: the round's one fever runs longer
}

// ---- the shift ----
const TABLE_CAP: Record<string, number> = { booth: 4, small: 2, round: 4 };
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
/** The plain shop's tables (the core's default), for a shift without a level after one with. */
const PLAIN_TABLES = TABLES.map(t => ({ ...t }));

/** The level's fixed shop and pace, as the page's levelEnter does it (ui/levels.ts levelDiff, ui/decor.ts useFixedShop). */
function installLevel(lv: Level): void {
  const pro = DIFFS.pro ?? D();
  Object.defineProperty(DIFFS, 'lv', { value: { ...pro, name: lv.name, pat: lv.pat, gap: lv.gap, ...(lv.burn ? { burn: lv.burn } : {}) }, enumerable: false, configurable: true, writable: true });
  setDiff('lv'); setSlot(lv.slot);
  setTABLES(lv.lay.tables.map(([kind], i) => ({ name: (CN[i] ?? String(i + 1)) + (kind === 'booth' ? '號卡' : '號枱'), cap: TABLE_CAP[kind] ?? 4, kind })));
}
/** The answers the rules ask of a save (core/env.ts): a fixed shop, the owner's recipe levels and rank. */
function installPort(sh: RoomShift): void {
  const lv = sh.lv, p = sh.port;
  setPort({ ...DEFAULT_PORT,
    level: id => (lv && id === sh.level ? lv : undefined), menuOpen: k => (lv ? lv.menu.includes(k) : true), inMyShop: () => false,
    recipeLv: k => p?.rlv[k] ?? 1, fancyName: k => p?.names[k] ?? k.split(':')[1], rankIx: () => p?.rank ?? 2, potCap: () => CFG.potCap });
}
/** A new G for the shift: the level's shop, every seat the computer's; the bar's pot empty if a player sits at the bar. */
function makeShift(sh: RoomShift, round: number): void {
  installPort(sh);
  installParty(sh.party ?? null);
  if (sh.lv) installLevel(sh.lv);
  else { setSlot(sh.slot); if (!sh.party) setDiff(sh.diff); setTABLES(PLAIN_TABLES.map(t => ({ ...t }))); }
  setStation('waiter'); newGame(); resetClock();
  const S = liveG();
  for (const k of Object.keys(S.roles)) Reflect.set(S.roles, k, 'ai');
  S.coop = true; S.round = round; S.daily = false;
  if (sh.party) S.party = { ...sh.party };
  if (sh.lv){
    // levelBegin (ui/levels.ts): no regulars, the level's goal (co-op: the team's star line), its stove sizes
    S.level = sh.level; S.regPlan = []; S.goal = 'level'; S.goalN = sh.lv.stars[0];
    const n = sh.lv.kit?.n;
    if (n) for (const [st, c] of Object.entries(n)) if (Object.prototype.hasOwnProperty.call(S.kit, st) && isNum(c)) Reflect.set(S.kit, st, new Array<KitJob | null>(c).fill(null));
  }
  // a player at the bar boils the first pot before the shop opens
  if (sh.seated.bar){ S.phase = 'prep'; S.pot = { level: 0, st: 'empty', until: 0, pulls: 0 }; }
}

/** The shop's clock pace: slowed while a player's order slip is open (only levels' and 新人's slow < 1). */
function roomScale(): number {
  const S = G; if (!S || S.roles.waiter !== 'remote' || S.floor) return 1;   // 樓面: several players share the floor, the shop never slows for one slip
  return S.groups.some(g => !g.take && g.state === 'order' && g.taken && g.later == null) ? Math.max(.5, D().slow) : 1;
}

export interface RoomStartOpts { room: string; send: (e: Envelope<RefBody>) => void; now: number; round: number; seed: number }
/** A shift starts in this room: a fresh shop, the referee (headless) with the lobby's seats, its own seeded random stream. */
export function roomStart(o: RoomStartOpts, sh: RoomShift): void {
  setRng(mulberry32(o.seed >>> 0));
  makeShift(sh, o.round);
  H = { room: o.room, send: o.send, last: o.now, sh, round: o.round, seed: o.seed, speed: 1, drove: {}, droveT: 0 };
  refStart({ room: o.room, me: ROOM_ME, name: '', send: o.send, seed: o.seed, round: o.round, now: o.now, extraSeats: sh.extra, seated: sh.seated, scale: roomScale, headless: true, floorSeats: sh.floor ?? 0 });
  tillWarmup();   // a player at the till: a few tables are already eating, so bills come soon (ui/main.ts start, solo)
  drainFx();
}

/**
 * The room restarted in the middle of a shift (the Durable Object was evicted or redeployed): the shift carries on from the
 * keyframe the room saved (roomSave), as a host change did when a phone was the referee. Phones resend what that keyframe does not have.
 */
export function roomRestore(o: RoomStartOpts, sh: RoomShift, key: Keyframe, drove?: unknown, tally?: unknown): void {
  setRng(mulberry32(o.seed >>> 0));
  makeShift(sh, o.round);
  H = { room: o.room, send: o.send, last: o.now, sh, round: o.round, seed: o.seed, speed: 1, drove: droveOf(drove), droveT: 0 };
  refTakeOver(key, { room: o.room, me: ROOM_ME, send: o.send, now: o.now, gone: [], mine: [], scale: roomScale, headless: true });
  tallyLoad(tally);   // the party round's per-person counts so far
  H.droveT = liveG().t;
  drainFx();
}
function droveOf(v: unknown): RoomHost['drove'] {
  const out: RoomHost['drove'] = {};
  if (!isRec(v)) return out;
  for (const [seat, m] of Object.entries(v)) if (isRec(m)) { const d: Record<PlayerId, number> = {}; for (const [p, s] of Object.entries(m)) if (isNum(s)) d[p] = s; out[seat] = d; }
  return out;
}
/**
 * What the room saves to carry a shift over a restart (a few KB; worker/index.ts writes it every few seconds). From now on
 * the keyframes' `durable` is this save's acks: phones keep, and resend after a restart, what came later.
 */
export function roomSave(): { sh: RoomShift; round: number; seed: number; key: Keyframe; drove: RoomHost['drove']; tally: unknown } | null {
  if (!H || !referee() || !G) return null;
  refMarkDurable();
  return { sh: H.sh, round: H.round, seed: H.seed, key: keyframe(), drove: H.drove, tally: tallySave() };
}

const step = (h: number): void => { coopStep(h * roomScale()); careerTick(); };
const goes = (): boolean => !!G && G.running && !G.paused;
/** Plays the wall time since the last call (fixed steps, at most ROOM_CATCHUP_S), then the referee's seat rules and messages. */
export function roomAdvance(now: number): void {
  const h = H; if (!h || !G || !referee()) return;
  const dt = Math.max(0, (now - h.last) / 1000) * h.speed; h.last = now;
  if (goes()) advance(dt, step, goes, ROOM_CATCHUP_S);
  logDrivers();
  coopFrame(now);
  drainFx();   // every effect was already routed to the phone it is for (referee.ts routeFx); none plays here
}
/** Party rounds: the game seconds since the last call go to whoever drives each seat (the computer is not counted). */
function logDrivers(): void {
  const h = H, R = referee(), S = G; if (!h || !R || !S || !h.sh.party) return;
  const dt = Math.max(0, S.t - h.droveT); h.droveT = S.t;
  if (!dt) return;
  for (const s of Object.values(R.seats)) if (s.driver.type === 'player'){ const d = h.drove[s.id] ??= {}; d[s.driver.player] = (d[s.driver.player] ?? 0) + dt; }
}
/** A party night's seat changed hands mid-round (the night's 'drive'): to the computer at once; a player claims it themselves. */
export function roomDrive(seat: SeatId, player: PlayerId | null): void {
  const R = referee(); if (!R || !G || player !== null) return;
  logDrivers();
  if (R.seats[seat]?.driver.type === 'player') setDriver(seat, { type: 'computer' }, 'release');
  drainFx();
}

/** The station's own words for its count (the end card's column). */
const JOB_LABEL: Record<string, string> = { waiter: '落咗單', bar: '出咗杯', kitchen: '出咗碟', till: '埋咗單', runner: '上咗枱', roast: '斬咗碟', takeaway: '交咗袋', floor1: '做咗', floor2: '做咗' };
/**
 * The round's report for the party night ("round result in"), once the books are closed: the team line
 * from the shop's books, one column per seat and one line per person. What the referee measures per seat is what a
 * player drove: its jobs and their average time (G.spd, the third star's timings), so a seat's stars are read on
 * its own line: 1 for working it, 2 within 1.3x of the third-star line, 3 within the line (STAR3 levels: the party shop
 * is a fixed shop). Per person: their share of the seat's jobs by the seconds they drove it; their mistakes, burns, bills
 * with exact change and longest clean run from their own results (./tally.ts); 幫 / 催 stay 0 (no pings yet).
 * 樓面's seats (up to two players share its bubbles) count each player's own floor tasks (tally
 * floorN / floorSec), so each 樓面 player's column and pay is their own part.
 */
export function roomReport(): RoundReport | null {
  const h = H, R = referee(), S = G; if (!h || !R || !S || !h.sh.party) return null;
  logDrivers();
  const p = h.sh.party, stations: StationReport[] = [], players = new Map<PlayerId, PlayerRoundStats>();
  const jobsBy: Record<string, Record<PlayerId, number>> = {}, mistakes: Record<PlayerId, number> = {};   // the round's pay
  let seatSec = 0;
  // a person's seconds on 樓面 over both its seats (their floor tally is split over the seats by these)
  const onFloor: Record<PlayerId, number> = {};
  for (const seat of partySeats(p.shop)) if (isPartyFloor(seat)) for (const [pl, sec] of Object.entries(h.drove[seat] ?? {})) onFloor[pl] = (onFloor[pl] ?? 0) + sec;
  for (const seat of partySeats(p.shop)){   // the four (or 樓面's two) and the shop's extra stations
    const drove = h.drove[seat] ?? {}, floor = isPartyFloor(seat);
    if (floor && !R.seats[seat]) continue;   // 樓面's second seat when only one player (or none) was on 樓面
    const drivers = Object.entries(drove).filter(([, sec]) => sec > 0).map(([player, sec]) => ({ player, sec: Math.round(sec * 10) / 10 }));
    const share = (pl: PlayerId, sec: number): number => (onFloor[pl] ? sec / (onFloor[pl] ?? 1) : 0);
    const a = isSpeedStation(seat) ? S.spd?.[seat] : undefined;
    const jobs = floor ? Math.round(drivers.reduce((x, d) => x + (tallyOf(d.player)?.floorN ?? 0) * share(d.player, d.sec), 0)) : a ? a[0] : 0;
    const avg = !floor && a && a[0] ? a[1] / a[0] : 0;
    const line = isSpeedStation(seat) ? STAR3.level[seat] : 0;
    const stars = !jobs ? 0 : floor ? 1 : avg <= line ? 3 : avg <= line * 1.3 ? 2 : 1;
    const measures = [{ key: 'jobs', label: JOB_LABEL[seat] ?? '做咗', value: jobs }];
    if (isSpeedStation(seat)) measures.push({ key: 'avg', label: `${SPEED_WHAT[seat]}（秒）`, value: Math.round(avg * 10) / 10 });
    stations.push({ seat, kind: floor ? 'floor' : seat, stars, measures, best: null, drivers });
    const all = drivers.reduce((x, d) => x + d.sec, 0);
    seatSec += all;
    for (const d of drivers){
      const mine = floor ? (tallyOf(d.player)?.floorN ?? 0) * share(d.player, d.sec) : all ? jobs * d.sec / all : 0;
      // 樓面's pay counts its work in a mid player's seconds (jobSec('floor') = 1), its results only for the card
      const key: string = floor ? 'floor' : seat, per = jobsBy[key] ??= {};
      per[d.player] = (per[d.player] ?? 0) + (floor ? (tallyOf(d.player)?.floorSec ?? 0) * share(d.player, d.sec) : mine);
      const done = Math.round(mine), q = players.get(d.player) ?? { player: d.player, done: 0, avgSec: 0, mistakes: 0, burnt: 0, exact: 0, helps: 0, hurries: 0, streak: 0 };
      q.avgSec = q.done + done ? (q.avgSec * q.done + avg * done) / (q.done + done) : 0; q.done += done; q.streak = Math.max(q.streak, done);
      players.set(d.player, q);
    }
  }
  for (const q of players.values()){
    const x = tallyOf(q.player);
    if (x){ q.mistakes = x.mistakes; q.burnt = x.burnt; q.exact = x.exact; q.streak = x.streak; if (x.floorSec > 0) q.floor = Math.round(x.floorSec); }
    else q.streak = 0;
    mistakes[q.player] = q.mistakes;
  }
  // the round's money is the players' own work (core/party/pay.ts); the till's takings are a display (sales)
  const pay = roundPay(jobsBy, mistakes, seatSec, p.sec, S.slot);
  for (const x of pay.parts){ const q = players.get(x.player); if (q) q.pay = x.pay; }
  const tips = S.tips ?? 0;
  return { round: p.round, team: { revenue: pay.money, tips, mistakes: S.mistakes, angry: S.angry, maxCombo: S.maxCombo ?? 0, fevers: S.fevers ?? 0, served: S.served, sales: S.revenue }, stations, players: [...players.values()] };
}
/** A phone's message (an envelope the room stamped with the sender's id). */
export function roomReceive(raw: unknown, now: number): void {
  if (!referee()) return;
  refReceive(raw, now);
  drainFx();
}
/** A player left the room (not a lost link): their seats go to the computer at once. */
export function roomLeave(player: PlayerId): void {
  const R = referee(); if (!R || !G) return;
  for (const s of Object.values(R.seats)) if (s.driver.type === 'player' && s.driver.player === player) setDriver(s.id, { type: 'computer' }, 'release');
  drainFx();
}
/**
 * Where the shift is: `running` (the clock runs), `closed` (the bell rang and the books are closed: the end card is drawn
 * from them). The room stops its timer a little after `closed`.
 */
export function roomStatus(): { running: boolean; paused: boolean; closed: boolean; t: number; round: number } | null {
  const R = referee(); if (!R || !G || !H) return null;
  return { running: G.running, paused: G.paused, closed: !!R.end?.done, t: G.t, round: H.round };
}

// ---- tests only (worker/index.ts answers these only when the Worker's ROOM_DEBUG var is "1": local test servers) ----
/** What a test asks of the room's referee: play time on, read the shift, set up a scene, pause, hand a seat over. */
export type RoomDebug =
  | { op: 'ff'; sec: number }
  | { op: 'state' }
  | { op: 'set'; revenue?: number; nextSpawn?: number | null; noRegs?: boolean; t?: number; slow?: number; gameSec?: number }
  | { op: 'speed'; x: number }
  | { op: 'pause'; on: boolean }
  | { op: 'drive'; seat: SeatId; to: 'computer' }
  | { op: 'scene'; name: 'table3' | 'orderSlip' };
export function roomDebug(d: RoomDebug, now: number): unknown {
  const R = referee(), S = G; if (!R || !S) return { error: 'no shift' };
  let out: unknown = true;
  switch (d.op){
    case 'ff':
      // fastForward (tests/helpers/browser.js) on the referee: 0.05 s steps of the room's shop
      for (let i = 0; i < Math.min(d.sec, 2000) * 20 && S.running; i++) if (!S.paused) step(.05);
      break;
    case 'state': {
      const seats: Record<string, unknown> = {};
      for (const s of Object.values(R.seats)) seats[s.id] = { driver: s.driver, coverReason: s.coverReason, epoch: s.epoch, away: s.away };
      out = { ...sharedOf(S), t: S.t, running: S.running, paused: S.paused, roles: { ...S.roles }, seats, stats: { ...R.stats }, closed: !!R.end?.done, players: Object.keys(R.players) };
      break;
    }
    case 'set':
      if (isNum(d.revenue)) S.revenue = d.revenue;
      if (d.nextSpawn === null) S.nextSpawn = Infinity; else if (isNum(d.nextSpawn)) S.nextSpawn = d.nextSpawn;
      if (d.noRegs) S.regPlan = [];
      if (isNum(d.t)) S.t = d.t;
      // the slip slow-down of this shift's pace (levels run at full speed: a test of the slow clock sets one)
      if (isNum(d.slow)) D().slow = d.slow;
      if (isNum(d.gameSec)) CFG.gameSec = d.gameSec;   // a short shift (the page's tests set it on every phone too)
      bump(); break;
    case 'pause': setPaused(d.on); break;
    case 'speed': if (H && isNum(d.x) && d.x > 0 && d.x <= 8) H.speed = d.x; break;
    case 'drive': setDriver(d.seat, { type: 'computer' }, 'release'); break;
    case 'scene': out = scene(d.name); break;
  }
  if (H) H.last = now;
  coopFrame(now); drainFx();
  return out;
}
/**
 * Scenes the browser tests set up on the referee:
 * table3: one patient table of two seated with an order of at least three meals, nobody else coming in; returns its id.
 * orderSlip: one patient table of one, seated and ready to order; returns its id.
 */
function scene(name: 'table3' | 'orderSlip'): number {
  const S = liveG();
  S.nextSpawn = Infinity; S.regPlan = [];
  let g: SeatGroup;
  for (;;){
    g = makeGroup(); g.size = name === 'table3' ? 2 : 1;
    const od = genOrder(g.size); g.persons = od.persons; g.lines = od.lines; g.items = itemsOf(g.persons);
    if (name === 'orderSlip' || g.items.filter(isMeal).length >= 2) break;
  }
  if (name === 'table3'){ const m = g.items.find(isMeal); if (m) g.items.push(m); }
  g.noShare = false; enqueue(g);
  S.tables.forEach(t => { if (!S.groups.some(x => x.table === t.id)) t.dirty = 0; });
  const tb = S.tables.find(t => !seatProblem(g, t));
  if (tb) seatGroup(g, tb);
  if (name === 'table3') submitOrder(g, g.items, false);
  else { g.state = 'order'; g.until = S.t + 999; }
  const live = byId(g.id);
  if (live && !live.take){ live.mealUntil = live.drinkUntil = S.t + 999; if (name === 'orderSlip') live.until = S.t + 999; }
  bump();
  return g.id;
}
