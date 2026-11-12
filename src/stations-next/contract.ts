// The station contract for the new stations (傳菜 runner, 燒味 roast, 外賣 takeaway): the `StationModule` shape, cut
// down to what a station can be built and tested against on its own. The referee (src/core/coop/registry.ts) wires each
// station in with a `RefereePlugin`; the station modules themselves do not depend on the referee.
// Rules for code under src/stations-next/<kind>/: the core (`core.ts`) has no DOM, no timers, no Date.now /
// performance.now and no Math.random: time comes in as `dt` / `ctx.t`, randomness from `ctx.rng`. State is plain JSON
// data (no closures, no class instances) so a seat can be handed to another driver by sending the value.

export type StationKind = 'runner' | 'roast' | 'takeaway' | 'clear' | 'deliver';
export type Difficulty = 'rookie' | 'pro' | 'ace';
export type SeatId = string;

/** A seeded random source (the referee injects the real one). Returns [0, 1). */
export interface Rng { next(): number }

/** What a station knows about the shift when it starts. */
export interface ShiftConfig { difficulty: Difficulty; seed: number; players: number }

/** Read-only view of the shared shop a station may look at (filled by the referee, by a stub on a standalone page). */
export interface SharedView { readonly t: number; readonly paused: boolean }

export interface StationCtx { t: number; rng: Rng; seat: SeatId; byPlayer: boolean; shared: SharedView }

/** A result a station sends to the referee: a kind tag plus plain data. */
export interface Result { kind: string; at: number; [k: string]: unknown }

/** An event the referee sends to a station (new work, a send-back, pause...). */
export interface RefEvent { kind: string; [k: string]: unknown }

/** Load gauge for the busy-seats rules: waiting work, idle time, how close to overload. */
export interface StationStatus { waiting: number; idleFor: number; load: number }

/** The computer driver: picks the next command (or none) from the state, at a human-like pace. */
export interface BotModule<S, Cmd> { next(s: S, ctx: StationCtx): Cmd | null }

export interface StationModule<S extends { v: number }, Cmd, R extends Result> {
  kind: StationKind;
  init(cfg: ShiftConfig, seat: SeatId): S;
  /** A player's (or the bot's) action; returns results for the referee (often none). */
  command(s: S, cmd: Cmd, ctx: StationCtx): R[];
  /** Fixed-step timers (cooking, arrivals in standalone mode); returns results. */
  step(s: S, dt: number, ctx: StationCtx): R[];
  onEvent(s: S, ev: RefEvent, ctx: StationCtx): void;
  status(s: S, ctx: StationCtx): StationStatus;
  bot: BotModule<S, Cmd>;
  /** Checks a value received in a hand-over before using it. */
  validate(x: unknown): x is S;
}

/** Mulberry32: small seeded PRNG for standalone runs and tests until B2's shared Rng lands. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
