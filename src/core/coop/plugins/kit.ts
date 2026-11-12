// What the extra seats' plugins share: the station context, the shift's difficulty, and a store for a
// station's state on this phone that starts afresh with each shift (a new G). A plugin feeds its station from the
// shared shift on every step of the phone that drives the seat ("level-triggered": it compares what the shift says is
// waiting with what the station holds and sends the difference as the station's own events), so a lost message, a
// hand-over or a host change can never lose or double a piece of work: the next step simply sees the difference again.
import type { StationCtx, Difficulty } from '../../../stations-next/contract';
import { liveG, diff } from '../../state';
import { rng } from '../../rng';

export const ctxOf = (seat: string, byPlayer: boolean, t?: number): StationCtx => {
  const S = liveG();
  return { t: t ?? S.t, rng: { next: () => rng() }, seat, byPlayer, shared: { t: S.t, paused: S.paused } };
};
export const dk = (): Difficulty => diff === 'rookie' || diff === 'ace' ? diff : 'pro';

/** A station's state on this phone, for the shift it was made in (a new shift makes a new one). */
export interface Store<S> { get(): S; set(s: S): void; peek(): S | null; reset(): void }
export function store<S>(make: () => S): Store<S> {
  let g: GameState | null = null, s: S | null = null;
  return {
    get: () => { const G = liveG(); if (g !== G || s === null){ g = G; s = make(); } return s; },
    set: v => { g = liveG(); s = v; },
    peek: () => s,
    reset: () => { g = null; s = null; },
  };
}

/**
 * The computer finishes what it started before a player takes the seat. Its bot plays on
 * in fast time (the station's own clock, FINISH_DT a step; the shop's clock does not move) until the station holds no
 * begun work, at most FINISH_S of station time. Returns whether it finished (else the caller puts the work back
 * untouched). `play(dt)`: one bot move and one station step, results reported as the computer's.
 */
export const FINISH_DT = 0.05, FINISH_S = 60;
export function finishStarted(started: () => boolean, play: (dt: number) => void): boolean {
  for (let t = 0; t < FINISH_S && started(); t += FINISH_DT) play(FINISH_DT);
  return !started();
}

/** A command from a seat's screen (the station page in the game page's seat view): checked, then the station's own. */
type SeatCommand = (c: unknown, t?: number) => boolean;
const SEAT_CMD = new Map<string, SeatCommand>();
export function registerSeatCommand(kind: string, f: SeatCommand): void { SEAT_CMD.set(kind, f); }
/** Runs a player's command at extra seat `kind` on this phone; false = not a command of that station (ignored). */
export const seatCommand = (kind: string, c: unknown, t?: number): boolean => SEAT_CMD.get(kind)?.(c, t) ?? false;
export const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A pointer command of the roast / takeaway screens (down / move / up with the scene's and the canvas's point, cancel,
 * view), rebuilt from checked fields; null if it is not one. `ms` (takeaway's clock for the tie) is 0 when absent. */
export type PtrCmd = { k: 'down' | 'move' | 'up'; x: number; y: number; cx: number; cy: number; ms: number } | { k: 'cancel' } | { k: 'view'; LW: number; LH: number; S: number };
export function ptrCmd(c: unknown): PtrCmd | null {
  if (!obj(c)) return null;
  const k = c.k;
  if (k === 'cancel') return { k };
  if (k === 'view') return fin(c.LW) && fin(c.LH) && fin(c.S) ? { k, LW: c.LW, LH: c.LH, S: c.S } : null;
  return (k === 'down' || k === 'move' || k === 'up') && fin(c.x) && fin(c.y) && fin(c.cx) && fin(c.cy) ? { k, x: c.x, y: c.y, cx: c.cx, cy: c.cy, ms: fin(c.ms) ? c.ms : 0 } : null;
}
