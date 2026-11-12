// The co-op protocol: every message between a phone and the referee is an
// Envelope with a body. Stations send results (what they did), never taps; the referee answers with events, a keyframe
// of the shared shop, and seat grants. Order and de-duplication go by counters only: `seq` per
// player per round, `rseq` for the referee's events, `epoch` per seat lease, `refEpoch` per referee.
// Types only (and the version numbers): validate.ts checks every inbound message against them.

/** Protocol number. A phone with a different one cannot play in the room (請重新載入). */
export let PROTO = 1;
/** This build, for the night card and support. Builds that share PROTO are compatible by definition. */
export let BUILD = '2026.11.10-c';
/** Tests only: pretend to be an older or newer page. */
export function setProto(p: number, b: string): void { PROTO = p; BUILD = b; }

export type SeatId = string;
export type PlayerId = string;
export type StationKind = 'waiter' | 'bar' | 'kitchen' | 'till' | 'runner' | 'roast' | 'takeaway' | (string & {});

/** What a station made, for the referee to judge with the same pure functions the station predicts with. */
export type MadeItem =
  /** A drink: the cup and how much of each ingredient (bar). */
  | { t: 'cup'; cup: 'hot' | 'cold' | null; ing: Record<string, number> }
  /** A plate: its tokens (kitchen). */
  | { t: 'plate'; tokens: string[] }
  /** A station that grades its own craft (roast): quality 0..100, and what the customer paid for it. */
  | { t: 'score'; q: number; pay: number };

export interface LineAt { gid: number; i: number }
/** A line on the pass: group, the station that made it, its index there. */
export interface PassRef { gid: number; dest: 'bar' | 'kitchen' | 'roast'; i: number }
export type RackKind = 'hot' | 'cold' | 'plate' | 'bowl';

/** One result a station reports. */
export type Result =
  | { k: 'seat'; gid: number; table: number }
  | { k: 'clean'; table: number }
  /** The slip is open (a player) or the computer picked the order up: the group waits without losing patience. */
  | { k: 'slipOpen'; gid: number; regSeen: boolean }
  /** The slip was put away unsent: the group waits laterGrace more seconds. */
  | { k: 'slipClose'; gid: number }
  | { k: 'order'; gid: number; keys: string[]; peeked: boolean }
  | { k: 'lineDone'; gid: number; dest: StationKind; i: number; made: MadeItem }
  /** The tea pot is ready: the shop opens. */
  | { k: 'potReady' }
  /** The till took customer `cid` from the pay queue (its station state holds them from now on). */
  | { k: 'tillTake'; cid: number }
  /** The till got a step wrong for customer `cid`: a mistake, and `loss` dollars short (0 when the customer caught it). */
  | { k: 'tillMiss'; cid: number; loss: number }
  /** Customer `cid` paid `charged` (the till's total): revenue, a paid count and a good step. */
  | { k: 'tillPaid'; cid: number; charged: number }
  // the extra seats
  /** The runner put these lines (from the pass) on table number `table` (index + 1). Absent from an older phone:
   *  `sec` the trip's seconds since its last table (or since it left the pass), the seat's 每碟上枱 speed; `hot` how many
   *  of them left the pass before going cold on the runner's watch, the seat's measure. */
  | { k: 'carried'; refs: PassRef[]; table: number; sec?: number; hot?: number }
  /** The runner's tray was knocked over (its health ran out; the trip starts again from the pass): a mistake. */
  | { k: 'knock' }
  /** A dish went cold on the pass while the runner stood there not taking it: a mistake. One gone cold while the
   *  runner was out on a trip is the shop's pace, not counted. */
  | { k: 'cold' }
  /** The wash seat took the dirty batches up to id `upTo` into its sink. */
  | { k: 'took'; upTo: number }
  /** One clean piece racked (`pts`: its work score; `secs`: seconds the hand spent on it, the third star), or one broken. */
  | { k: 'washed'; rack: RackKind; pts?: number; secs?: number }
  | { k: 'broken'; rack: RackKind; pile?: boolean }   // pile: lost to an overflowing pile, not the hand
  /** A dirt worked with the wrong tool, once a stroke. */
  | { k: 'slip' }
  /** A roast customer gave up waiting at the roast counter (line i of group gid). */
  | { k: 'walkout'; gid: number; i: number }
  /** A takeaway bag handed over (`tip` dollars); an item packed into the wrong bag must be made again. */
  | { k: 'packed'; gid: number; stars: number; tip: number }
  | { k: 'remake'; gid: number; i: number }
  /** Playtest build: a teammate moved the pace slider of their own seat's station to `v` (1..10). */
  | { k: 'pace'; st: string; v: number }
  // 樓面 (core/work/floor.ts)
  /** 執枱: table (index) cleared by the count-and-tap mini-game, after `resets` over-taps. */
  | { k: 'cleared'; table: number; secs: number; resets: number }
  /** 送外賣: the rider sets off with these bagged orders (1-3); `dropped` at each door; `back` at the shop. */
  | { k: 'ride'; gids: number[] }
  /** fast: dropped on the rocket (deliver core Order.fast): its tip pays x TUNE.rocket.tip. */
  | { k: 'dropped'; gid: number; fast?: boolean }
  | { k: 'back' };
export type ResultKind = Result['k'];

/** A station's whole private state, tagged with its kind and format version; the station module validates `s`. */
export interface StationBlob { kind: StationKind; v: number; s: unknown }

export interface Caps { z: boolean; cs: boolean; ptt: boolean }
export type AwayWhy = 'hidden' | 'pagehide' | 'freeze';
export type CoverReason = 'quiet' | 'away' | 'link' | 'empty';

/** What a phone reports about each seat it drives, every 0.5-1 s. */
export interface SeatStatus {
  /** Real taps on this seat since the last status (the cover rule's "quiet"). */
  inputs: number;
  /** Items waiting at this station, as the station sees them. */
  waiting: number;
  /** How busy, 0..1 (the director's input, BUSY_SEATS). */
  load: number;
  /** The station's state, at most 1 Hz and only when it changed (the referee's checkpoint). */
  ckpt?: StationBlob;
}

export type Driver = { type: 'player'; player: PlayerId } | { type: 'computer' } | { type: 'none' };

/** A seat as every phone sees it (the referee keeps its checkpoint privately). */
export interface SeatView {
  id: SeatId; kind: StationKind; driver: Driver; epoch: number;
  away: boolean; coverReason: CoverReason | null;
  /** The player who drove it last (a covered player can take it back with one tap). */
  last: PlayerId | null;
}
export interface PlayerInfo { name: string; role: 'player' | 'viewer'; build: string; caps: Caps; online: boolean }

/** A phone to the referee. */
export type PhoneBody =
  | { k: 'hello'; proto: number; build: string; caps: Caps; role: 'player' | 'viewer'; name: string; player: PlayerId;
      resume: { round: number; seq: number; ack: number } | null }
  | { k: 'claim'; seat: SeatId }
  | { k: 'release'; seat: SeatId }
  | { k: 'res'; seat: SeatId; epoch: number; r: Result }
  | { k: 'focus'; seat: SeatId; board: boolean; sheet: boolean }
  /** `tasks`: the 樓面 tasks this phone's player is still on (a claim not touched times out). */
  | { k: 'status'; seats: Record<SeatId, SeatStatus>; tasks?: string[] }
  /** 樓面: claim or let go of floor task `id`; the envelope's seq is the claim's sequence (a loss: nack 'taken'). */
  | { k: 'task'; op: 'claim' | 'release'; id: string }
  | { k: 'away'; why: AwayWhy }
  | { k: 'back'; why: AwayWhy }
  | { k: 'handover'; seat: SeatId; epoch: number; state: StationBlob }
  | { k: 'pause'; on: boolean }
  /** After the end: every result this phone made before the bell has been sent before this. */
  | { k: 'closed' }
  | { k: 'resync'; from: number }
  | { k: 'floorReq' }
  | { k: 'floorHold'; turn: number }
  | { k: 'floorRelease'; turn: number }
  | { k: 'nudge'; seat: SeatId; kind: string };

/** The phone messages that travel in the ordered, acknowledged stream (the rest are unsequenced, seq 0). */
export const SEQUENCED: readonly PhoneBody['k'][] = ['claim', 'release', 'task', 'res', 'focus', 'away', 'back', 'handover', 'pause', 'closed'];

/** Something a phone should play: the effect events of core/fx.ts, addressed to a seat. */
export interface FxOut { k: string; [f: string]: unknown }

/** An event of the referee. Effects and station notices carry `to` (the seat they are for). */
export type RefEvent =
  | { e: 'left'; gid: number }
  | { e: 'served'; gid: number }
  | { e: 'sendBack'; gid: number; dest: StationKind }
  | { e: 'toPay'; gid: number }
  | { e: 'took'; gid: number }
  | { e: 'tillNext'; to: SeatId; cust: unknown }
  | { e: 'paid'; cid: number }
  | { e: 'fx'; to: SeatId | null; fx: FxOut }
  | { e: 'driver'; seat: SeatId; driver: Driver; epoch: number; why: CoverReason | 'claim' | 'release' | 'start' }
  | { e: 'pause'; on: boolean }
  | { e: 'end' }
  | { e: 'order'; to: SeatId; gid: number; i: number; item: string };

export interface EventRec { rseq: number; ev: RefEvent }

/** The referee's shared state as it travels: the shift (`shared`, validated by validate.ts) plus the seat roster. */
export interface Keyframe {
  rseq: number; round: number; refEpoch: number; seed: number;
  /** Plain JSON of the shared shift state (core/referee/events.ts sharedOf). */
  shared: unknown;
  seats: Record<SeatId, SeatView & { ckpt?: StationBlob }>;
  players: Record<PlayerId, PlayerInfo>;
  /** Highest applied seq per player. */
  acks: Record<PlayerId, number>;
  /** Highest seq per player whose effect is inside this keyframe: survives a host change. */
  durable: Record<PlayerId, number>;
  /** The shift has ended and its books are closed: the end card can be drawn. Absent while open or closing. */
  closed?: true;
}

export type NackReason = 'closed' | 'epoch' | 'invalid' | 'taken' | 'paused-queue' | 'viewer';

/** The referee to the phones. */
export type RefBody =
  | { k: 'welcome'; you: PlayerId; key: Keyframe }
  | { k: 'reject'; reason: 'proto' | 'full' | 'closed'; newer: boolean }
  | { k: 'tick'; t: number; rt: number; running: boolean; paused: boolean; scale: number; acks: Record<PlayerId, number>; rseq: number; round: number;
      /** 樓面: every open floor task, id -> holder ('' = nobody), so every phone drops a taken or finished bubble on
       *  the next tick (a few hundred bytes; keyframes carry the whole floor). */
      tk?: Record<string, string> }
  | { k: 'ev'; rseq0: number; list: RefEvent[] }
  | { k: 'keyframe'; key: Keyframe }
  | { k: 'grant'; seat: SeatId; epoch: number; state: StationBlob | null }
  | { k: 'revoke'; seat: SeatId; epoch: number; why: string }
  | { k: 'nack'; player: PlayerId; seq: number; reason: NackReason }
  | { k: 'floor'; holder: PlayerId | null; turn: number; until: number; busyFor: number };

export type Body = PhoneBody | RefBody;

export interface Envelope<B extends Body = Body> {
  p: number;
  room: string;
  /** The sender: a player id, or 'ref' (the referee). The room server stamps it on what phones send (never trusted from the body). */
  from: PlayerId;
  /** For addressed referee messages (welcome, grant, revoke, nack, reject): the one player it is for. */
  to?: PlayerId;
  round: number;
  /** Per sender, per round, from 1; 0 for unsequenced messages. */
  seq: number;
  /** The sender's game time when sent: judges lateness, never orders anything. */
  at: number;
  b: B;
}

/** Message size limits: what a phone may send, and the largest keyframe. */
export const PHONE_MAX_BYTES = 16 * 1024;
export const KEYFRAME_MAX_BYTES = 64 * 1024;
