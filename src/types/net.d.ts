// Types owned by src/net/net.ts (global, type-only): the co-op room client. The shift itself runs on the room's
// referee (src/core/coop/): its messages are envelopes (`{t:'env', e}`), checked by core/proto/validate.ts. What is
// typed here is the lobby the room relays as is (meta, seats, hello); the netTrust* functions in net.ts mark those
// boundaries.

/** 'host' or 'client' while in a room. */
type NetRole = 'host' | 'client';

/** The shared state of the co-op client (`NET`). Fields after `t` are added while in a room. */
interface NetState {
  role: NetRole | null; code: string;
  /** This tab's player id (sessionStorage 'ckf-netid'): a reload keeps it, so the room gives the seat back. */
  id: string;
  seats: NetSeats; meta: NetMeta | null; t: NetTransport | null;
  myStation?: LobbySeat; rejoinSt?: LobbySeat; link?: NetStatus | ''; wasDown?: boolean;
  /** The host's shop setting: the extra stations of this room, and the extra seat or 樓面 place the host sits at
   *  ('' = their shop seat). */
  extra?: ExtraKind[]; hostX?: ExtraKind | LobbyFloor | '';
  /** The room's 樓面 places switched off (the owner's, sent in meta). */
  floorOff?: LobbyFloor[];
  /** The level the host picked, and the shift count in this room. */
  level?: string | undefined; round?: number | undefined;
  /** The room's party night as last received; null or absent: none. */
  night?: NetNight | null;
}

/**
 * A teammate's seat: what pickSeat() sends; the room adds `at` (worker Seat) and keys the map by player id. The room
 * stores a missing station as ''.
 */
interface NetSeat { id?: string; name: string; station: LobbySeat; at?: number; z?: boolean }
/** A 樓面 place in a room's lobby on a level with the floor (as a party night's). */
type LobbyFloor = 'floor1' | 'floor2';
/** A lobby seat key: a shop station, an extra station, a 樓面 place, or none. */
type LobbySeat = StationId | ExtraKind | LobbyFloor | '';
type NetSeats = Record<string, NetSeat>;

/** The room as the host describes it (pushMeta); the room relays it as is. */
interface NetMeta {
  host: string; hostName: string; hostStation: StationId; slot: Slot; diff: string;
  state: 'lobby' | 'playing'; level: string; round: number; at: number;
  /** The extra stations this room opens (absent: the shop's four), and the one the host sits at. */
  extra?: ExtraKind[]; hostX?: ExtraKind | LobbyFloor | '';
  /** 樓面 places switched off for the next shift (absent: none). */
  floorOff?: LobbyFloor[];
  /** Set by the room while a party night is open there: the lobby is the night's screens. */
  party?: boolean;
}
/** The room's party night as it sends it (core/party/types.ts NightState; null: the night was closed). */
type NetNight = import('../core/party/types').NightState;
/** The room's party message: the night (to everyone, on every change), or why a press was refused (to the presser). */
interface NetParty { t: 'party'; night?: NetNight | null; why?: string }
/** What a transport reports when the room closed: the last meta it had (or nothing), marked closed. */
type NetClosedMeta = Partial<Omit<NetMeta, 'state'>> & { state: 'closed' };
/** What a meta listener gets: null when the room does not exist (or is gone). */
type NetMetaSeen = NetMeta | NetClosedMeta | null;

/** hostBoard: kept for the type of G (a phone field, never shared). */
interface GameState { hostBoard?: boolean }
/** A hint page code sends for a teammate's station (ui.ts say / floatAt): the referee routes it as an effect. */
interface NetEv { role: string; msg?: string; float?: [tid: number | null, text: string, color: string] }

/** Link status a transport reports ('up' / 'down', or a room error). */
type NetStatus = 'up' | 'down' | 'noroom' | 'taken' | 'seat_taken';
/** The room made this teammate the host (the old host stayed away): seats and meta as the room has them. */
interface NetPromote { t: 'promote'; station?: LobbySeat; seats?: NetSeats; meta?: NetMeta | null }

/** Messages from the room (worker/index.ts Room), as net.ts reads them. */
type NetMsg =
  /** floor: who holds the push-to-talk floor (src/ptt/ptt.d.ts); missing from a room older than push-to-talk. */
  | { t: 'hello'; you: NetRole; host?: string | null; meta?: NetMeta | null; seats?: NetSeats | null; floor?: PttHelloFloor | null }
  | PttIn
  | { t: 'meta'; meta: NetMeta }
  | { t: 'seats'; seats?: NetSeats | null }
  /** A protocol envelope (unchecked here: core validates it). */
  | { t: 'env'; e: unknown }
  | { t: 'closed' }
  | { t: 'host'; id: string }
  | NetParty
  | NetPromote
  /** tests only: the room's referee answering a dbg request (ROOM_DEBUG) */
  | { t: 'dbg'; id: number; res: unknown }
  /** A teammate's 樓面 place switch, relayed to the owner: the owner's page decides. */
  | { t: 'slot'; seat: string; on: boolean; from?: string }
  | { t: 'error'; error: string; station?: string };
/**
 * The owner's start message: the shift's settings for the room's referee. `lv` is the whole level (the room has no
 * page code to look it up); `port` is what the owner's save answers for the shop (rank, recipe levels and names).
 */
interface NetStart {
  level: string; lv: Level | null; slot: Slot; diff: string; extra: ExtraKind[];
  port: { rank: number; rlv: Record<string, number>; names: Record<string, string> };
  /** 樓面's switched-on places (1-2, the floor seats of the shift; absent: the level's own count, as before). */
  floorOn?: number;
}
/** Messages this page sends to the room. */
type NetOut =
  | { t: 'meta'; meta: NetMeta }
  | { t: 'seat'; seat: NetSeat | null | undefined }
  | { t: 'env'; e: unknown }
  | ({ t: 'start' } & NetStart)
  | { t: 'dbg'; id: number; d: unknown }
  | { t: 'close' }
  /** A teammate asks the owner to switch a 樓面 place on or off. */
  | { t: 'slot'; seat: LobbyFloor; on: boolean }
  /** Party night: the owner opens / closes it; anyone sends a press (the room stamps who). */
  | { t: 'partyOpen'; name: string }
  | { t: 'partyClose' }
  | { t: 'party'; ev: Record<string, unknown> };
/** What each transport event passes to its listeners. */
interface NetEvents {
  meta: [m: NetMetaSeen]; seats: [s: NetSeats]; env: [e: unknown]; party: [m: NetParty]; slot: [seat: string, on: boolean];
  promote: [m: NetPromote]; host: [id: string]; status: [s: NetStatus];
  /** push-to-talk: a floor / floorNo message, or a binary audio frame (src/ptt) */
  ptt: [m: PttIn | ArrayBuffer];
}
type NetSubs = { [K in keyof NetEvents]?: ((...a: NetEvents[K]) => void)[] };

interface NetTransportBase {
  setMeta: (m: NetMeta) => void;
  onMeta: (f: (m: NetMetaSeen) => void) => void;
  setSeat: (s: NetSeat | null) => void;
  onSeats: (f: (s: NetSeats) => void) => void;
  /** A protocol envelope: the referee's to the room (everyone, or `to`), a teammate's to the referee. */
  sendEnv: (e: unknown) => void;
  onEnv: (f: (e: unknown) => void) => void;
  close: () => void;
}
/** The room over a WebSocket (wsTransport). */
interface NetOnlineTransport extends NetTransportBase {
  kind: 'online';
  up: boolean; rtt: number;
  /** Set once the socket has opened at least once; pingAt is when the last ping went out. */
  everUp?: boolean; pingAt?: number;
  readonly role: NetRole;
  /** Connected, but nothing heard for LINK_QUIET_MS. */
  readonly quiet: boolean;
  /** The owner starts a shift in the room. */
  sendStart: (s: NetStart) => void;
  /** Tests only: a referee operation in the room (core/coop/room.ts roomDebug); resolves with its answer. */
  dbg: (d: unknown) => Promise<unknown>;
  onPromote: (f: (m: NetPromote) => void) => void;
  onHost: (f: (id: string) => void) => void;
  onStatus: (f: (s: NetStatus) => void) => void;
  /** Disconnect without saying goodbye (page closing): the room keeps the seat for a while. */
  drop: () => void;
  /** Push-to-talk (src/ptt): send a floor message or an audio frame (dropped while not connected), and hear the room's. */
  pttSend: (m: PttOut | ArrayBuffer) => void;
  onPtt: (f: (m: PttIn | ArrayBuffer) => void) => void;
  /** Party night: a party message to the room, and the room's (the night, or a refusal). */
  partySend: (m: Extract<NetOut, { t: 'partyOpen' | 'partyClose' | 'party' }>) => void;
  onParty: (f: (m: NetParty) => void) => void;
  /** A teammate's 樓面 place switch (sent to the owner), and the owner's hearing of one. */
  slotSend: (seat: LobbyFloor, on: boolean) => void;
  onSlot: (f: (seat: string, on: boolean) => void) => void;
}
/** The room's transport (online only, no BroadcastChannel between tabs: the referee lives in the room). */
type NetTransport = NetOnlineTransport;

/** sessionStorage 'ckf-room': the room and seat this tab was in, for a reload. */
interface NetSavedRoom { code: string; st: LobbySeat }

/** Set on a shift played in a co-op room. */
interface GameState {
  coop?: boolean;
  /** The host's shift count in this room (NET.round). */
  round?: number | undefined;
}

interface Window {
  /** Set by the test harness (tests/helpers/browser.js). */
  __TEST__?: boolean;
}
