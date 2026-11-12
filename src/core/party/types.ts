// Party mode: the night loop, the wager, the shared till and the shop ladder. The types every party
// module shares. Everything here is plain JSON data (no functions, Maps, Sets or undefined-vs-missing
// that matters), so the referee can keep a night in its state, broadcast it to the phones and the TV, and hand it to a
// new host.
import type { TargetMetric, TargetTier } from '../career/targets';

// PlayerId / SeatId are the protocol's (core/proto/messages.ts): a station seat is 'waiter', 'bar', 'kitchen', 'till' in
// other seat ids (e.g. 'runner', 'bar#2') may be added.
import type { PlayerId, SeatId } from '../proto/messages';
export type { PlayerId, SeatId };

/** What a card measures: the career's four (core/career/targets.ts) plus the party's 貼士 and 旺場. */
export type PartyMetric = TargetMetric | 'tips' | 'fever';
/** The shifts of one 茶記 day. There is no 試更 any more. */
export type RoundKind = 'breakfast' | 'lunch' | 'tea' | 'dinner' | 'late';
/** The shop ladder, small and slow to big and busy: the original game's levels of the same ids. */
export type ShopId = 'estate' | 'mongkok' | 'central' | 'airport' | 'hell';
/** Who picks the card: everyone votes and the host breaks ties (default), or the host alone (老闆話事). */
export type Chooser = 'vote' | 'host';
/**
 * The night's screens. Between rounds: endcard (results, waits for everyone's 下一步), vote (waits for everyone, then a
 * 5 s change window), ready (everyone taps 我準備好, then the host starts), countdown (5 s; anyone un-readying stops it).
 * Nothing between rounds runs on a timer except those two 5 s windows.
 */
export type Phase = 'lobby' | 'vote' | 'ready' | 'countdown' | 'round' | 'endcard' | 'close' | 'done';
/** The 搏盡 card's twist: its own round only. The referee plays it; the night only deals it. */
export type Twist = 'rush' | 'critic' | 'bigTable' | 'blackout';

export interface NightConfig {
  shop: ShopId;
  /** 一日 (one day, ~30 min) or 兩日 (two days in the same shop, ~1 hour). */
  days: 1 | 2;
  chooser: Chooser;
}

/** One round of the night's schedule. */
export interface RoundSlot {
  day: number;              // 1 or 2
  kind: RoundKind;
  sec: number;              // round length in game seconds
  /** The shop this round is played in (day 2 is the next shop up the ladder). It sets the pace, the lines and the rent. */
  shop: ShopId;
}

/** One of the three cards dealt before a round. */
export interface Card {
  tier: TargetTier;
  metric: PartyMetric;
  /** The number the card asks for: a line to reach (revenue, combo, tips, fevers) or a cap (mistakes, walk-outs). */
  n: number;
  text: string;
  /** Money when met / missed before the 孤注一擲 token (the miss is a positive number to lose). */
  win: number;
  lose: number;
  /** What this team did on this metric last round, shown on the card, or null on the first round. */
  last: number | null;
  /** The success chance the line was set for (the tier's target, moved halfway toward last round's result). */
  aim: number;
}

/** The open vote before a round (and, once closed, the round's wager). */
export interface Wager {
  cards: Card[];
  votes: Record<PlayerId, number>;
  /** Players who want to spend the 孤注一擲 token on this round. */
  token: PlayerId[];
  /** Seconds into the vote when everyone who counts had voted (the 5 s change window runs from here); null while waiting. */
  allAt: number | null;
  /** Set when the vote closes. */
  chosen: number | null;
  tokenOn: boolean;
  twist: Twist | null;
}

export interface Player {
  id: PlayerId;
  name: string;
  present: boolean;
  /** The seat this player drives, or null for an onlooker (睇戲). */
  seat: SeatId | null;
  /** The seat they had when they left, to take back if it is still computer-run. */
  lastSeat: SeatId | null;
  /** Rounds (schedule indexes) this player played, by the referee's report. */
  rounds: number[];
}

/** Per-station result for one round, as the referee supplies it. */
export interface StationReport {
  seat: SeatId;
  /** The station kind ('waiter', 'bar', ...): the end card uses it for the column's name. */
  kind: string;
  /** Stars on this station's own line, 0-3. */
  stars: number;
  /** The station's own measures, in display order (slips correct, average drink seconds, ...). */
  measures: { key: string; label: string; value: number }[];
  /** The best-moment line ("一壺茶出咗 9 杯"), if any. */
  best: string | null;
  /** Who drove this seat and for how many game seconds (a seat can change hands mid-round). The computer is left out. */
  drivers: { player: PlayerId; sec: number }[];
}

/** Per-person counters for one round (the 收舖 awards read these). Missing counters are 0. */
export interface PlayerRoundStats {
  player: PlayerId;
  /** Jobs finished: slips taken, drinks made, dishes plated, bills settled. */
  done: number;
  /** Average seconds per job (0 when nothing was done). */
  avgSec: number;
  mistakes: number;
  burnt: number;
  /** Bills where the change was exactly right at the till. */
  exact: number;
  /** 幫 answered and 催 sent (0 until the pings exist). */
  helps: number;
  hurries: number;
  /** Longest run of jobs without a mistake. */
  streak: number;
  /** Their pay this round (core/party/pay.ts): their jobs at their own seats, less their mistakes. */
  pay?: number;
  /** Their 樓面 work this round in a mid player's seconds (each 樓面 player's own part). */
  floor?: number;
}

/** What the referee hands the night when a round's clock ends. */
export interface RoundReport {
  /** The schedule index this report is for (a stale or repeated report is refused). */
  round: number;
  /** 
evenue: what the round puts in the till: the players' pay at their own seats, scaled to a team of four
   *  (core/party/pay.ts), not the shop's takings; sales: the shop's takings, a display only. */
  team: { revenue: number; tips: number; mistakes: number; angry: number; maxCombo: number; fevers: number; served: number; sales?: number };
  stations: StationReport[];
  players: PlayerRoundStats[];
}

/** One settled round: what was bet, what happened, the rent, and the till before and after. */
export interface RoundRecord {
  round: number;
  day: number;
  kind: RoundKind;
  shop: ShopId;
  card: Card | null;
  met: boolean | null;
  /** The card's money after the token. */
  cardDelta: number;
  takings: number;
  /** The round's rent and running costs, paid from the till (a positive number: what left the till). */
  rent: number;
  bankBefore: number;
  bankAfter: number;
  token: boolean;
  twist: Twist | null;
  report: RoundReport;
}

/** Where every dollar in the till came from: bank = start + takings + cards − rent, always. */
export interface BankBook { start: number; takings: number; cards: number; rent: number }

export interface NightState {
  v: 2;
  seed: number;
  /** The night's random stream (rand.ts). */
  rs: number;
  cfg: NightConfig;
  phase: Phase;
  /** Game seconds in the current phase, and since 開工. */
  phaseT: number;
  t: number;
  /** Schedule index of the round being played, or of the next round while between rounds (-1 in the lobby). */
  round: number;
  schedule: RoundSlot[];
  host: PlayerId | null;
  players: Player[];
  /** The shop's seats and who drives each (null: the computer). */
  seats: Record<SeatId, PlayerId | null>;
  /**
   * 樓面's places switched off: nobody works them, not even the computer, and the
   * floor's load is budgeted per switched-on place. A place a player sits at is always on; at least one stays on.
   * Absent (an older saved night): none off.
   */
  floorOff?: SeatId[];
  /** The team's one shared till (錢箱). It may go below $0 during the night (欠租); below $0 at 收舖 the shop folds. */
  bank: number;
  book: BankBook;
  tokenUsed: boolean;
  /** The vote before the next round, then that round's wager while it is played. */
  wager: Wager | null;
  history: RoundRecord[];
  /** End card: who tapped 下一步. Ready check and countdown: who is ready (我準備好). */
  taps: PlayerId[];
  /** The group's last night (上次 $14,200), from the page or from 再開一日. */
  prevBank: number | null;
  /** 再開一日 after a strong night moved the group up the ladder: the shop it came from (the lobby says so). */
  climbed: ShopId | null;
  /** How many nights this group has opened in a row (再開一日 adds one). */
  nights: number;
}

/** The pace a shop sets: the original game's level numbers (ui/levels.ts levelDiff: 熟手 with the level's own flow). */
export interface ShopPace { gap: number; pat: number; burn: number | null }

/** What the referee needs to start a round (the seam's round start). */
export interface RoundPlan {
  round: number;
  day: number;
  kind: RoundKind;
  sec: number;
  /** The game's time slot for this round (下午茶 runs the breakfast flow, 宵夜 the dinner flow). */
  slot: Slot;
  /** The shop and the pace it sets (the referee installs it as the round's difficulty, as levelEnter does). */
  shop: ShopId;
  pace: ShopPace;
  card: Card | null;
  twist: Twist | null;
  token: boolean;
  seats: Record<SeatId, PlayerId | null>;
  /** 樓面's places switched off for this round (NightState.floorOff). */
  floorOff?: SeatId[];
}

/** What a step of the night asks of the referee and the screens. */
export type PartyOut =
  | { k: 'roundStart'; plan: RoundPlan }
  /** Mid-round: the referee hands this seat's lease to a player (or back to the computer: null), state included. */
  | { k: 'drive'; seat: SeatId; player: PlayerId | null }
  | { k: 'settled'; record: RoundRecord }
  | { k: 'host'; player: PlayerId | null }
  | { k: 'phase'; phase: Phase; round: number }
  | { k: 'reject'; why: string };

/** Everything a phone (or the referee's own clock) can send the night. The room has already said who `player` is. */
export type PartyEvent =
  | { k: 'join'; player: PlayerId; name: string }
  | { k: 'leave'; player: PlayerId }
  /** Tap a seat: sit on it if it is free; tap your own seat to stand up. Any time but 收舖. */
  | { k: 'seat'; player: PlayerId; seat: SeatId }
  /** Stand up (the same as tapping your own seat). */
  | { k: 'watch'; player: PlayerId }
  /** Switch a free 樓面 place on (the computer works it) or off (nobody does). Not mid-round or at 收舖. */
  | { k: 'slot'; player: PlayerId; seat: SeatId; on: boolean }
  | { k: 'setup'; player: PlayerId; cfg: Partial<NightConfig> }
  /** The host: 開工 in the lobby; in the ready check, start the 5 s countdown (only once everyone is ready). */
  | { k: 'start'; player: PlayerId }
  | { k: 'next'; player: PlayerId }
  | { k: 'vote'; player: PlayerId; card: number | null }
  | { k: 'token'; player: PlayerId; on: boolean }
  /** 我準備好 (on) or 未準備好 (off). */
  | { k: 'ready'; player: PlayerId; on: boolean }
  | { k: 'again'; player: PlayerId }
  | { k: 'bye'; player: PlayerId };
