// Validators for every inbound co-op message: what arrives from the room is
// `unknown` until one of these says otherwise. They never throw; junk is refused (and the caller logs it). Hand-written,
// no library: each is a type guard over the shapes in messages.ts. Station states inside (handover, grant, checkpoints)
// are only checked as a StationBlob here; the station module validates its own `s` (core/stations/registry.ts).
import type { Envelope, PhoneBody, RefBody, Result, MadeItem, StationBlob, SeatStatus, Caps, Keyframe, SeatView, Driver, PlayerInfo, RefEvent, PassRef, RackKind } from './messages';

type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A finite number, never negative: every time, count, id and amount in the protocol. */
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
export const isStr = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length <= max;
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isArr = (v: unknown, each: (x: unknown) => boolean, max = 4096): v is unknown[] => Array.isArray(v) && v.length <= max && v.every(each);
const isRec = (v: unknown, each: (x: unknown) => boolean, max = 256): v is Obj => isObj(v) && Object.keys(v).length <= max && Object.values(v).every(each);
const has = (o: Obj, k: string, f: (x: unknown) => boolean): boolean => f(o[k]);

const isPassRef = (v: unknown): v is PassRef => isObj(v) && isInt(v.gid) && isInt(v.i) && (v.dest === 'bar' || v.dest === 'kitchen' || v.dest === 'roast');
const isRack = (v: unknown): v is RackKind => v === 'hot' || v === 'cold' || v === 'plate' || v === 'bowl';
export function isMade(v: unknown): v is MadeItem {
  if (!isObj(v)) return false;
  if (v.t === 'cup') return (v.cup === null || v.cup === 'hot' || v.cup === 'cold') && isRec(v.ing, isInt, 32);
  if (v.t === 'plate') return isArr(v.tokens, x => isStr(x, 40), 24);
  if (v.t === 'score') return isNum(v.q) && isNum(v.pay);
  return false;
}
export function isResult(v: unknown): v is Result {
  if (!isObj(v)) return false;
  switch (v.k){
    case 'seat': return isInt(v.gid) && isInt(v.table);
    case 'clean': return isInt(v.table);
    case 'slipOpen': return isInt(v.gid) && isBool(v.regSeen);
    case 'slipClose': return isInt(v.gid);
    case 'order': return isInt(v.gid) && isArr(v.keys, x => isStr(x, 80), 40) && isBool(v.peeked);
    case 'lineDone': return isInt(v.gid) && isStr(v.dest, 16) && isInt(v.i) && isMade(v.made);
    case 'potReady': return true;
    case 'tillTake': return isInt(v.cid);
    case 'tillMiss': return isInt(v.cid) && isNum(v.loss);
    case 'tillPaid': return isInt(v.cid) && isNum(v.charged);
    case 'carried': return isArr(v.refs, isPassRef, 24) && isInt(v.table) && (v.sec === undefined || isNum(v.sec)) && (v.hot === undefined || isInt(v.hot));
    case 'took': return isInt(v.upTo);
    case 'knock': case 'cold': return true;
    case 'washed': return isRack(v.rack) && (v.pts === undefined || (isNum(v.pts) && v.pts >= 0 && v.pts <= 100)) && (v.secs === undefined || (isNum(v.secs) && v.secs >= 0 && v.secs <= 600));
    case 'broken': return isRack(v.rack) && (v.pile === undefined || typeof v.pile === 'boolean');
    case 'slip': return true;
    case 'walkout': case 'remake': return isInt(v.gid) && isInt(v.i);
    case 'packed': return isInt(v.gid) && isInt(v.stars) && isNum(v.tip);
    case 'pace': return isStr(v.st, 16) && isInt(v.v) && v.v >= 1 && v.v <= 10;
    case 'cleared': return isInt(v.table) && isNum(v.secs) && isInt(v.resets);
    case 'ride': return isArr(v.gids, isInt, 3) && v.gids.length > 0;
    case 'dropped': return isInt(v.gid) && (v.fast === undefined || isBool(v.fast));
    case 'back': return true;
    default: return false;
  }
}
export const isBlob = (v: unknown): v is StationBlob => isObj(v) && isStr(v.kind, 16) && isInt(v.v) && 's' in v;
const isCaps = (v: unknown): v is Caps => isObj(v) && isBool(v.z) && isBool(v.cs) && isBool(v.ptt);
const isStatus = (v: unknown): v is SeatStatus => isObj(v) && isInt(v.inputs) && isNum(v.waiting) && isNum(v.load) && (v.ckpt === undefined || isBlob(v.ckpt));
const isWhy = (v: unknown): boolean => v === 'hidden' || v === 'pagehide' || v === 'freeze';
const seatId = (v: unknown): v is string => isStr(v, 24);

export function isPhoneBody(v: unknown): v is PhoneBody {
  if (!isObj(v)) return false;
  switch (v.k){
    case 'hello': return isInt(v.proto) && isStr(v.build, 40) && isCaps(v.caps) && (v.role === 'player' || v.role === 'viewer') && isStr(v.name, 24) && isStr(v.player, 24)
      && (v.resume === null || (isObj(v.resume) && isInt(v.resume.round) && isInt(v.resume.seq) && isInt(v.resume.ack)));
    case 'claim': case 'release': return seatId(v.seat);
    case 'res': return seatId(v.seat) && isInt(v.epoch) && isResult(v.r);
    case 'focus': return seatId(v.seat) && isBool(v.board) && isBool(v.sheet);
    case 'status': return isRec(v.seats, isStatus, 16) && (v.tasks === undefined || isArr(v.tasks, x => isStr(x, 24), 16));
    case 'task': return (v.op === 'claim' || v.op === 'release') && isStr(v.id, 24);
    case 'away': case 'back': return isWhy(v.why);
    case 'handover': return seatId(v.seat) && isInt(v.epoch) && isBlob(v.state);
    case 'pause': return isBool(v.on);
    case 'closed': return true;
    case 'resync': return isInt(v.from);
    case 'floorReq': return true;
    case 'floorHold': case 'floorRelease': return isInt(v.turn);
    case 'nudge': return seatId(v.seat) && isStr(v.kind, 16);
    default: return false;
  }
}
const isDriver = (v: unknown): v is Driver => isObj(v) && (v.type === 'computer' || v.type === 'none' || (v.type === 'player' && isStr(v.player, 24)));
const isCover = (v: unknown): boolean => v === null || v === 'quiet' || v === 'away' || v === 'link' || v === 'empty';
const isSeatView = (v: unknown): v is SeatView & { ckpt?: StationBlob } => isObj(v) && seatId(v.id) && isStr(v.kind, 16) && isDriver(v.driver) && isInt(v.epoch)
  && isBool(v.away) && isCover(v.coverReason) && (v.last === null || isStr(v.last, 24)) && (v.ckpt === undefined || isBlob(v.ckpt));
const isPlayer = (v: unknown): v is PlayerInfo => isObj(v) && isStr(v.name, 24) && (v.role === 'player' || v.role === 'viewer') && isStr(v.build, 40) && isCaps(v.caps) && isBool(v.online);
/** The shared shift state: the fields every screen reads must be there with the right types (the rest rides along). */
export const isShared = (v: unknown): boolean => isObj(v) && isNum(v.t) && isNum(v.rt) && isBool(v.running) && isBool(v.paused) && Array.isArray(v.groups)
  && Array.isArray(v.payQ) && Array.isArray(v.tables) && isNum(v.revenue) && isNum(v.mistakes) && isNum(v.angry) && isStr(v.slot, 16) && (v.phase === 'prep' || v.phase === 'open');
export function isKeyframe(v: unknown): v is Keyframe {
  return isObj(v) && isInt(v.rseq) && isInt(v.round) && isInt(v.refEpoch) && isInt(v.seed) && isShared(v.shared)
    && isRec(v.seats, isSeatView, 16) && isRec(v.players, isPlayer, 16) && isRec(v.acks, isInt) && isRec(v.durable, isInt)
    && (v.closed === undefined || v.closed === true);
}
const isFx = (v: unknown): boolean => isObj(v) && isStr(v.k, 16);
function isEvent(v: unknown): v is RefEvent {
  if (!isObj(v)) return false;
  switch (v.e){
    case 'left': case 'served': case 'toPay': case 'took': return isInt(v.gid);
    case 'sendBack': return isInt(v.gid) && isStr(v.dest, 16);
    case 'tillNext': return seatId(v.to) && isObj(v.cust);
    case 'paid': return isInt(v.cid);
    case 'fx': return (v.to === null || seatId(v.to)) && isFx(v.fx);
    case 'driver': return seatId(v.seat) && isDriver(v.driver) && isInt(v.epoch) && isStr(v.why, 16);
    case 'pause': return isBool(v.on);
    case 'end': return true;
    case 'order': return seatId(v.to) && isInt(v.gid) && isInt(v.i) && isStr(v.item, 80);
    default: return false;
  }
}
export function isRefBody(v: unknown): v is RefBody {
  if (!isObj(v)) return false;
  switch (v.k){
    case 'welcome': return isStr(v.you, 24) && isKeyframe(v.key);
    case 'reject': return (v.reason === 'proto' || v.reason === 'full' || v.reason === 'closed') && isBool(v.newer);
    case 'tick': return isNum(v.t) && isNum(v.rt) && isBool(v.running) && isBool(v.paused) && isNum(v.scale) && isRec(v.acks, isInt) && isInt(v.rseq) && isInt(v.round) && (v.tk === undefined || isRec(v.tk, x => isStr(x, 24), 64));
    case 'ev': return isInt(v.rseq0) && isArr(v.list, isEvent, 512);
    case 'keyframe': return isKeyframe(v.key);
    case 'grant': return seatId(v.seat) && isInt(v.epoch) && (v.state === null || isBlob(v.state));
    case 'revoke': return seatId(v.seat) && isInt(v.epoch) && isStr(v.why, 16);
    case 'nack': return isStr(v.player, 24) && isInt(v.seq) && isStr(v.reason, 16);
    case 'floor': return (v.holder === null || isStr(v.holder, 24)) && isInt(v.turn) && isNum(v.until) && isNum(v.busyFor);
    default: return false;
  }
}
const isEnvHead = (v: unknown): v is Obj => isObj(v) && isInt(v.p) && isStr(v.room, 16) && isStr(v.from, 24) && (v.to === undefined || isStr(v.to, 24))
  && isInt(v.round) && isInt(v.seq) && v.seq >= 0 && isNum(v.at);
/** An envelope whose body has not been checked (a good envelope around a bad body still has its place in the stream). */
export type EnvHead = Omit<Envelope, 'b'> & { b?: unknown };
export const isPhoneHead = (v: unknown): v is EnvHead => isEnvHead(v);
/** A message a phone sent (the referee's inbound check). */
export const isPhoneEnv = (v: unknown): v is Envelope<PhoneBody> => isEnvHead(v) && has(v, 'b', isPhoneBody);
/** A message the referee sent (a phone's inbound check). */
export const isRefEnv = (v: unknown): v is Envelope<RefBody> => isEnvHead(v) && v.from === 'ref' && has(v, 'b', isRefBody);
