// A teammate's phone: it drives its own seat(s) and keeps a replica of the
// shared shift. A tap changes the station's own state at once, here, with no network involved; what the station did
// goes to the referee as a result (core/coop/results.ts), predicted on the replica at once and kept in the outbox until
// the referee's keyframe has it (acks per player per round, resent until acknowledged, never dropped: 8.3).
// Each keyframe rewrites the replica in place; results the referee has not applied yet are replayed over it, silently.
import type { Envelope, PhoneBody, Keyframe, SeatView, SeatId, PlayerId, Caps, AwayWhy, Result, SeatStatus } from '../proto/messages';
import { PROTO, BUILD, SEQUENCED, PHONE_MAX_BYTES } from '../proto/messages';
import { isRefEnv } from '../proto/validate';
import { G, liveG, bump, local } from '../state';
import { emit, setFxRoute, fxRoute, type Fx } from '../fx';
import { kitAuto } from '../stations/kitchen';
import { updatePot, potAutoBoil } from '../stations/bar';
import { tillStep } from '../stations/till';
import { stationOf, blobOf, putBlob } from './registry';
import { applyResult, setResultSink, setLocalActor } from './results';
import { taskClaim, taskRelease, kindOf, resultTask } from '../work/floor';   // 樓面 claims: predicted on the replica
import { applyShared } from './replica';

/** Resend what the referee has not acknowledged after this long; status (with the station's checkpoint) this often. */
export const RESEND_MS = 1000, STATUS_MS = 1000;
/** The outbox never drops a result: at the cap, new results wait here (unsent) until acks drain it (8.3). */
export const OUTBOX_CAP = 512;
/** Room for the socket wrapper (`{"t":"env","e":...}`) inside the room's PHONE_MAX_BYTES limit. */
const ENV_WRAP = 64;
/** I-7: the station's clock runs on between ticks, never more than this ahead of the referee's last tick. */
export const CLOCK_AHEAD_S = 0.8;
/** A seat a keyframe names this phone's whose grant has not come this long after: played with the state it has (a lost grant). */
export const GRANT_WAIT_MS = 1000;

interface Out { seq: number; e: Envelope<PhoneBody>; sentAt: number }
interface PhoneState {
  room: string; me: PlayerId; name: string; role: 'player' | 'viewer'; caps: Caps;
  send: (e: Envelope<PhoneBody>) => void; now: number;
  /** `refSeq` / `tickSeq`: the referee seq of the last keyframe / tick applied (each kind is ordered on its own). */
  round: number; seq: number; refEpoch: number; refSeq: number; tickSeq: number;
  outbox: Out[]; waiting: Out[]; acked: number;
  key: Keyframe | null; seats: Record<SeatId, SeatView>;
  /**
   * The seats whose state this phone holds (its grant arrived). A keyframe can name this phone the driver before the
   * grant follows it (the welcome goes first): the seat is played here only from the grant on, so a press made in
   * between is never overwritten by the grant's state. `waitGrant`: since when a keyframe has named this phone the
   * driver of a seat it does not hold yet (after GRANT_WAIT_MS the grant counts as lost).
   */
  held: SeatId[]; waitGrant: Record<SeatId, number>;
  tickT: number; statusAt: number; inputs: Record<SeatId, number>;
  /** The referee's clock pace at its last tick (its slip or board open slows the shop). */
  scale: number;
  /** `closing`: this phone saw the bell and sent `closed`; `ended`: the books are closed and the end card is drawn. */
  rejected: { reason: string; newer: boolean } | null; closing: boolean; ended: boolean; potSent: boolean;
  stats: { sent: number; resent: number; nacked: number; replayed: number; junk: number; tooBig: number };
  /** 樓面: claims sent and not yet decided (seq -> task id), shown as this phone's at once; claims the referee
   *  refused (task ids, for the screen's notice; it drains them). */
  pend: Record<number, string>; lost: string[];
}
let P: PhoneState | null = null;
/** This phone's link state, or null (the referee's phone, or no co-op). Read by tests and sims. */
export const phone = (): Readonly<PhoneState> | null => P;
export function phoneStop(): void { P = null; setResultSink(null); setLocalActor(null); }
/** 樓面: the floor tasks this phone's player is on now (the screen registers it; the status touches them). */
let workingFn: () => string[] = () => [];
export function setWorking(f: (() => string[]) | null): void { workingFn = f ?? ((): string[] => []); }
/** Starts a new audit window (the tests' auditReset): the counters back to zero. */
export function phoneStatsReset(): void { if (P) P.stats = { sent: 0, resent: 0, nacked: 0, replayed: 0, junk: 0, tooBig: 0 }; }

function env(b: PhoneBody, seq: number): Envelope<PhoneBody> {
  const p = P; if (!p) throw new Error('chakei: not in a room');
  return { p: PROTO, room: p.room, from: p.me, round: p.round, seq, at: G ? G.t : 0, b };
}
function post(b: PhoneBody): void {
  const p = P; if (!p) return;
  if (!SEQUENCED.includes(b.k)){ p.send(env(b, 0)); return; }
  const o: Out = { seq: p.seq + 1, e: env(b, p.seq + 1), sentAt: p.now };
  // the room drops a message over PHONE_MAX_BYTES unseen, so its seq would never arrive and stall the stream for
  // good: it is not sent and its seq is not used (counted; the next keyframe takes back what it predicted)
  if (JSON.stringify(o.e).length > PHONE_MAX_BYTES - ENV_WRAP){ p.stats.tooBig++; return; }
  p.seq = o.seq;
  if (p.outbox.length >= OUTBOX_CAP){ p.waiting.push(o); return; }
  p.outbox.push(o); p.stats.sent++; p.send(o.e);
}

export interface JoinOpts { room: string; me: PlayerId; name: string; send: (e: Envelope<PhoneBody>) => void; now: number; role?: 'player' | 'viewer'; caps?: Caps }
/** Joins the room's referee: hello (protocol and build), then the welcome's keyframe makes the replica. */
export function phoneJoin(o: JoinOpts): void {
  const resume = P && P.room === o.room ? { round: P.round, seq: P.seq, ack: P.acked } : null;
  P = { room: o.room, me: o.me, name: o.name, role: o.role ?? 'player', caps: o.caps ?? { z: false, cs: true, ptt: false }, send: o.send, now: o.now,
    round: resume?.round ?? 0, seq: resume?.seq ?? 0, refEpoch: P?.refEpoch ?? -1, refSeq: -1, tickSeq: -1, outbox: P?.outbox ?? [], waiting: P?.waiting ?? [], acked: resume?.ack ?? 0,
    key: P?.key ?? null, seats: P?.seats ?? {}, held: resume ? P?.held ?? [] : [], waitGrant: {}, tickT: P?.tickT ?? 0, scale: P?.scale ?? 1, statusAt: o.now, inputs: {}, rejected: null, closing: false, ended: false, potSent: false,
    stats: P?.stats ?? { sent: 0, resent: 0, nacked: 0, replayed: 0, junk: 0, tooBig: 0 }, pend: P?.pend ?? {}, lost: [] };
  setResultSink(phoneSubmit);
  setLocalActor(() => P?.me ?? '');
  setFxRoute(null);
  P.send(env({ k: 'hello', proto: PROTO, build: BUILD, caps: P.caps, role: P.role, name: o.name, player: o.me, resume }, 0));
}

/** A station on this phone reports what it did: sent to the referee and predicted on the replica at once. */
/** The station roles a floor seat plays (樓面): the waiter's screens and the floor's mini-games. */
const FLOOR_PARTS: readonly string[] = ['waiter', 'runner', 'takeaway', 'clear', 'deliver'];
/** The seat this phone's results, taps and claims for `seat` go to: on a floor shift its floor seat stands for the parts. */
export function seatFor(seat: SeatId): SeatId {
  const p = P; if (!p || !G?.floor || !FLOOR_PARTS.includes(seat)) return seat;
  const s = Object.values(p.seats).find(x => x.kind === 'floor' && ((x.driver.type === 'player' && x.driver.player === p.me) || x.last === p.me));
  // not on the floor yet (a party night's 樓面 taken mid-round): a floor seat the computer runs
  const free = s ? undefined : Object.values(p.seats).find(x => x.kind === 'floor' && x.driver.type === 'computer');
  return s ? s.id : free ? free.id : seat;
}
function phoneSubmit(seat0: SeatId, r: Result): void {
  const p = P; if (!p) return;
  const seat = seatFor(seat0), s = p.seats[seat];
  post({ k: 'res', seat, epoch: s?.epoch ?? 0, r });
  p.inputs[seat] = (p.inputs[seat] ?? 0) + 1;
  applyResult(seat, r);
}
/** A tap on a seat (for the cover rule: a seat with taps is not quiet). The page calls it on every press. */
export function noteInput(seat0: SeatId): void { const seat = seatFor(seat0); if (P) P.inputs[seat] = (P.inputs[seat] ?? 0) + 1; }

export const claim = (seat: SeatId): void => { post({ k: 'claim', seat: seatFor(seat) }); };
/**
 * 樓面: claim floor task `id`. Hidden from this phone's floor at once (the claim is predicted on the replica);
 * shown again if the referee refuses it (nack 'taken'). False when the replica already shows someone else on it.
 */
export function taskWant(id: string): boolean {
  const p = P; if (!p || !G?.floor) return false;
  const mine = G.floor.tasks.find(x => x.id === id)?.by === p.me;
  if (!mine && !taskClaim(p.me, id)) return false;
  if (mine) return true;
  const seq = p.seq + 1;
  post({ k: 'task', op: 'claim', id });
  if (p.seq === seq) p.pend[seq] = id;
  return true;
}
/** 樓面: let floor task `id` go (back to everyone's floor). */
export function taskDrop(id: string): void {
  const p = P; if (!p) return;
  for (const [s, x] of Object.entries(p.pend)) if (x === id) Reflect.deleteProperty(p.pend, s);
  // a task this phone just finished stays hidden here until the referee has its result (or the bubble would flash back)
  if (G?.floor && !pendingIds(p, p.acked).has(id)) taskRelease(p.me, id);
  post({ k: 'task', op: 'release', id });
}
/** 樓面: the claims the referee refused since the last call (the screen tells the player). */
export function takeLost(): string[] { const p = P; if (!p) return []; const l = p.lost; p.lost = []; return l; }
/** The tasks this phone holds as far as it knows: claims not decided yet, and tasks its results not yet applied finish. */
function pendingIds(p: PhoneState, applied: number): Set<string> {
  const ids = new Set(Object.values(p.pend));
  for (const o of [...p.outbox, ...p.waiting]) if (o.e.b.k === 'res' && o.seq > applied) for (const id of resultTask(o.e.b.r)) ids.add(id);
  return ids;
}
/**
 * The claims not yet decided go back over a replica the referee rewrote (a keyframe, a tick's list), until it has decided
 * them. A decided claim the list does not give this phone was refused even if its nack was lost on the way: it counts
 * as lost all the same (the screen's notice).
 */
function floorPredict(p: PhoneState, applied: number): void {
  const F = G?.floor, decided: string[] = [];
  for (const [s, id] of Object.entries(p.pend)) if (Number(s) <= applied || !F){ Reflect.deleteProperty(p.pend, s); decided.push(id); }
  if (!F) return;
  const ids = pendingIds(p, applied);
  for (const x of F.tasks) if (x.by === null && ids.has(x.id)) x.by = p.me;
  for (const id of decided) if (!ids.has(id) && F.tasks.find(x => x.id === id)?.by !== p.me && !p.lost.includes(id)) p.lost.push(id);
}
export const release = (seat: SeatId): void => { post({ k: 'release', seat }); };
export const away = (why: AwayWhy): void => { post({ k: 'away', why }); };
export const back = (why: AwayWhy): void => { post({ k: 'back', why }); };
export const askPause = (on: boolean): void => { post({ k: 'pause', on }); };
/** Results not yet in a keyframe (the tests' "has the referee got my press": unacked() empty). */
/** This phone's results the referee has not put in a keyframe yet (a host change re-applies them on the new referee). */
export const pendingResults = (): { seat: SeatId; r: Result; seq: number; at: number }[] => P ? [...P.outbox, ...P.waiting].flatMap(o => o.e.b.k === 'res' ? [{ seat: o.e.b.seat, r: o.e.b.r, seq: o.seq, at: o.e.at }] : []) : [];
export const unacked = (): number => { const p = P; return p ? p.outbox.filter(o => o.seq > p.acked).length + p.waiting.length : 0; };

const mineSeats = (p: PhoneState): SeatView[] => Object.values(p.seats).filter(s => s.driver.type === 'player' && s.driver.player === p.me);

function setRoles(p: PhoneState): void {
  if (!G) return;
  const fl: Role[] = [];
  for (const s of Object.values(p.seats)){
    const role: Role = s.driver.type === 'player' ? (s.driver.player === p.me && p.held.includes(s.id) ? 'me' : 'remote') : 'ai';
    Reflect.set(G.roles, s.kind === 'floor' ? s.id : s.kind, role);
    if (s.kind === 'floor') fl.push(role);
  }
  // 樓面: the floor as one role; the waiter's screens follow it
  if (fl.length){ const agg: Role = fl.includes('me') ? 'me' : fl.includes('remote') ? 'remote' : 'ai'; G.roles.floor = agg; G.roles.waiter = agg; }
}

/** Runs `f` with every effect muted (a replay of results this phone already played once). */
function muted(f: () => void): void { const was = fxRoute(); setFxRoute(() => false); try { f(); } finally { setFxRoute(was); } }

function applyKey(k: Keyframe): void {
  const p = P; if (!p) return;
  if (k.round !== p.round){ p.round = k.round; p.seq = 0; p.outbox = []; p.waiting = []; p.acked = 0; p.closing = false; p.ended = false; p.potSent = false; p.held = []; }
  const newRef = k.refEpoch !== p.refEpoch; p.refEpoch = k.refEpoch;
  p.key = k;
  const S = liveG(), t0 = S.t, rt0 = S.rt, wasRunning = S.running;
  const sh = isRec(k.shared) ? k.shared : {};
  applyShared(S, sh);
  // the clock: keep this phone's own if it is at most CLOCK_AHEAD_S ahead of the referee's (no jumps back, I-7)
  if (S.running && t0 >= S.t && t0 <= S.t + CLOCK_AHEAD_S) S.t = t0;
  if (S.running && rt0 >= S.rt && rt0 <= S.rt + CLOCK_AHEAD_S) S.rt = rt0;
  p.tickT = Math.max(p.tickT, S.t);
  p.seats = {}; for (const [id, v] of Object.entries(k.seats)) p.seats[id] = { id: v.id, kind: v.kind, driver: v.driver, epoch: v.epoch, away: v.away, coverReason: v.coverReason, last: v.last };
  p.held = p.held.filter(id => { const d = p.seats[id]?.driver; return d?.type === 'player' && d.player === p.me; });
  const wait: Record<SeatId, number> = {};
  for (const s of mineSeats(p)) if (!p.held.includes(s.id)){
    const t0 = p.waitGrant[s.id] ?? p.now;
    if (p.now - t0 >= GRANT_WAIT_MS) p.held.push(s.id); else wait[s.id] = t0;
  }
  p.waitGrant = wait;
  setRoles(p);
  // `durable` (what a restarted referee still has) may trail `acks` (what it applied): the outbox keeps everything above
  // durable for a resend after a restart, and replays as a prediction only what is above acks. A new referee's
  // acks are the truth, even lower ones (it lost what came after its save: the resend below brings it back).
  const acked = k.durable[p.me] ?? 0, applied = k.acks[p.me] ?? 0;
  p.acked = newRef ? applied : Math.max(p.acked, applied);
  if (!p.outbox.length && !p.waiting.length) p.seq = Math.max(p.seq, p.acked);   // a reloaded page counts on from its ack
  p.outbox = p.outbox.filter(o => o.seq > acked);
  while (p.waiting.length && p.outbox.length < OUTBOX_CAP){ const o = p.waiting.shift(); if (o){ o.sentAt = p.now; p.outbox.push(o); p.send(o.e); } }
  // what the referee has not applied yet stays predicted (not once the books are closed: they are final)
  floorPredict(p, applied);   // 樓面: claims the referee has not decided yet stay this phone's
  if (!k.closed) muted(() => { for (const o of p.outbox) if (o.e.b.k === 'res' && o.seq > applied){ p.stats.replayed++; applyResult(o.e.b.seat, o.e.b.r, o.e.at); } });
  // a new referee (host change): everything it has not acknowledged goes again at once
  if (newRef) for (const o of p.outbox){ o.sentAt = p.now; p.stats.resent++; p.send(o.e); }
  reconcileStations(S);
  // the bell: everything not yet acknowledged goes again at once, then `closed` behind it; the end card waits
  // for the keyframe that says the referee has closed the books
  if (wasRunning && !S.running && !p.closing){
    p.closing = true;
    for (const o of p.outbox){ o.sentAt = p.now; p.stats.resent++; p.send(o.e); }
    if (p.role === 'player') post({ k: 'closed' });
  }
  if (p.closing && k.closed && !p.ended){ p.ended = true; emit({ k: 'end' }); }
  bump();
}
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** After a keyframe: this phone's stations let go of work that is no longer there (the group left, the line was made). */
function reconcileStations(S: GameState): void {
  if (local('waiter') && S.sheet && !S.groups.some(g => g.id === S.sheet?.gid)){ S.sheet = null; emit({ k: 'sheet', open: false }); }
  if (local('waiter') && S.selected !== null && !S.groups.some(g => g.id === S.selected)) S.selected = null;
  if (local('bar') && S.bench.target){ const t = S.bench.target, line = S.groups.find(g => g.id === t.gid)?.drinks?.[t.i]; if (!line || line.done) S.bench.target = null; }   // the player picks the next ticket
}

/** A message from the room for this phone (validated here: junk is counted and dropped). */
export function phoneReceive(raw: unknown, now: number): void {
  const p = P; if (!p) return;
  p.now = now;
  if (!isRefEnv(raw) || raw.room !== p.room){ p.stats.junk++; return; }
  if (raw.to !== undefined && raw.to !== p.me) return;
  const b = raw.b;
  // a state older than one already applied is skipped (a held-back message must not move the replica back in time)
  // a keyframe overtaken by a later tick is still the newest state (it used to be skipped, so on a jittery link the
  // keyframes that acknowledge a phone's last messages were lost until the next one 2 s later)
  if (b.k === 'welcome'){ if (b.key.refEpoch < p.refEpoch) return; p.refSeq = raw.seq; p.tickSeq = raw.seq; }
  else if (b.k === 'keyframe'){ if (raw.seq <= p.refSeq || b.key.refEpoch < p.refEpoch) return; p.refSeq = raw.seq; }
  else if (b.k === 'tick'){ if (raw.seq <= p.tickSeq) return; p.tickSeq = raw.seq; }
  switch (b.k){
    case 'welcome': case 'keyframe': if (G) applyKey(b.key); return;
    case 'tick': {
      if (b.round !== p.round || !G) return;
      p.tickT = b.t; p.scale = b.scale; p.acked = Math.max(p.acked, b.acks[p.me] ?? 0);
      const S = G;
      if (S.t < b.t || S.t > b.t + CLOCK_AHEAD_S) S.t = b.t;
      if (S.rt < b.rt || S.rt > b.rt + CLOCK_AHEAD_S) S.rt = b.rt;
      S.paused = b.paused;
      // 樓面: who holds which floor task, as of this tick; a taken bubble goes now, not with the next keyframe
      if (b.tk && S.floor){
        const tk = b.tk, have = new Map(S.floor.tasks.map(x => [x.id, x]));
        S.floor.tasks = Object.entries(tk).map(([id, by]) => {
          const x = have.get(id) ?? { id, k: kindOf(id) ?? 'seat', at: b.t, by: null, free: b.t, ct: 0, seen: 0 };
          x.by = by || null;
          return x;
        });
        floorPredict(p, b.acks[p.me] ?? 0);   // what this phone has sent and the referee has not applied yet
        bump();
      }
      return;
    }
    case 'ev':
      for (const ev of b.list) if (ev.e === 'fx' && ev.to !== null && drivenByMe(p, ev.to) && isFx(ev.fx)) emit(ev.fx);
      return;
    case 'grant': {
      const s = p.seats[b.seat]; if (!s || !G) return;
      p.seats[b.seat] = { ...s, driver: { type: 'player', player: p.me }, epoch: b.epoch, coverReason: null, away: false, last: p.me };
      // a seat already played here keeps its own state (a second grant must not take back a press)
      if (!p.held.includes(b.seat)){ p.held.push(b.seat); if (b.state) putBlob(G, b.state); }
      Reflect.deleteProperty(p.waitGrant, b.seat);
      setRoles(p); bump(); return;
    }
    case 'revoke': {
      const s = p.seats[b.seat]; if (!s || !G) return;
      // the seat's exact state goes back with the hand-over
      const st = blobOf(G, s.kind);
      p.seats[b.seat] = { ...s, driver: { type: 'computer' }, epoch: b.epoch, last: p.me };
      p.held = p.held.filter(id => id !== b.seat);
      if (st) post({ k: 'handover', seat: b.seat, epoch: b.epoch, state: st });
      setRoles(p); bump(); return;
    }
    case 'nack': {
      p.stats.nacked++; p.outbox = p.outbox.filter(o => o.seq !== b.seq);
      // 樓面: a claim someone else won: the bubble comes back (or stays with them, as the next tick says)
      const id = p.pend[b.seq];
      if (id !== undefined){
        Reflect.deleteProperty(p.pend, String(b.seq)); p.lost.push(id);
        const x = G?.floor?.tasks.find(t => t.id === id); if (x && x.by === p.me) x.by = null;
        bump();
      }
      return;
    }
    case 'reject': p.rejected = { reason: b.reason, newer: b.newer }; return;
    default: return;
  }
}
const drivenByMe = (p: PhoneState, seat: SeatId): boolean => { const d = p.seats[seat]?.driver; return d?.type === 'player' && d.player === p.me; };
const isFx = (v: unknown): v is Fx => isRec(v) && typeof v.k === 'string';

/**
 * One step of this phone's stations (instead of the referee's update): the tea pot, the noodle strainer, the till's
 * next customer, and the clock (it runs on between ticks, at most CLOCK_AHEAD_S ahead).
 */
export function phoneStep(dt: number): void {
  const p = P, S = G; if (!p || !S) return;
  if (local('kitchen')) kitAuto();
  S.rt += dt; if (local('bar')) updatePot();
  if (S.phase === 'prep'){
    if (local('bar')) potAutoBoil();   // an untouched pot is boiled for the player after CFG.barOpenSec
    if (local('bar') && S.pot.st === 'ready' && !p.potSent){ p.potSent = true; phoneSubmit('bar', { k: 'potReady' }); }
    return;
  }
  S.t = Math.min(S.t + dt, Math.max(S.t, p.tickT + CLOCK_AHEAD_S));
  if (local('till')) tillStep();
}

/** After the step: resend what is unacknowledged, and the status of this phone's seats (with their checkpoint). */
export function phoneFrame(now: number): void {
  const p = P; if (!p || !G) return;
  p.now = now;
  for (const o of p.outbox) if (o.seq > p.acked && now - o.sentAt >= RESEND_MS){ o.sentAt = now; p.stats.resent++; p.send(o.e); }
  if (now - p.statusAt >= STATUS_MS){
    p.statusAt = now;
    const seats: Record<SeatId, SeatStatus> = {};
    for (const s of mineSeats(p)){
      const m = stationOf(s.kind), st: SeatStatus = { inputs: p.inputs[s.id] ?? 0, waiting: m ? m.waiting(G) : 0, load: 0 };
      const b = blobOf(G, s.kind); if (b) st.ckpt = b;
      seats[s.id] = st;
    }
    p.inputs = {};
    const tasks = G.floor ? workingFn().slice(0, 16) : [];
    if (Object.keys(seats).length) post({ k: 'status', seats, ...(tasks.length ? { tasks } : {}) });
  }
}
