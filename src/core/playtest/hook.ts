// Playtest timing log hooks. How fast a real person plays each mini-game, recorded on the
// preview only, so the sims' human model (tests/sim/human.js; makeHumanTake) can be calibrated on real players.
//
// This file is the whole API a station or a screen needs; it is DOM-free (core stays DOM-free) and does nothing until
// the page's logger (src/playtest/log.ts) installs its sink, which it does only when /api/config says `playtest` (a
// Worker with PLAYTEST=1, the playtest preview). On live, in the sims and in the room's referee every call is a no-op: no behaviour changes.
//
// Calls (st = the station id: waiter / bar / kitchen / till / runner / roast / takeaway, or a new one's kind):
//   ptDown(st, g)          a gesture starts now (finger down on something); g names it: 'drag', 'trace', 'cut', 'scrub' ...
//   ptUp(st, ok, x?, g?)   the open gesture at st ends now; ok = it did what the player meant (g: renamed, if the end
//                          showed what it really was, e.g. a press that became a drag)
//   ptTap(st, g, ok)       an instant gesture (a button press): start and end at once
//   ptMiss(st, what)       a mistake; attached to the open gesture if there is one, else logged on its own
//   ptDone(st, what)       a task finished (a bag handed over, a plate served, a table carried ...)
//   ptNew(st)              new work showed up (a station whose waiting count the logger cannot see: see below)
// The logger stamps the time itself (ms since the shift began), the gap since the station's last gesture ended (the
// reach + decide time), the read time (work appeared at an idle station -> first touch) and retries (the same gesture
// again right after a mistake). Work appearing is seen by the logger itself for every station registered in
// core/coop/registry.ts (its `waiting` count, polled), so ptNew is only for something outside the registry.
//
// Extra seats drawn in an iframe (src/stations-next/<kind>/page.ts) need nothing in the iframe: every command they send
// through the seat host (src/ui/seat.ts) passes `PT.seat`, and src/playtest/observe.ts turns a station's state before
// and after each command into the calls above. A new seat adds one observer there; a new station that runs on the game
// page calls ptDown / ptUp / ptTap from its input handler.

/** A small extra fact for a log row (numbers or short strings only; never anything personal). */
export type PtExtra = Readonly<Record<string, number | string>>;
export interface PtSink {
  down(st: string, g: string, x?: PtExtra): void;
  up(st: string, ok: boolean, x?: PtExtra, g?: string): void;
  tap(st: string, g: string, ok: boolean, x?: PtExtra): void;
  miss(st: string, what: string): void;
  done(st: string, what: string, x?: PtExtra): void;
  fresh(st: string): void;
}
/**
 * The installed sink (null: not the preview), the seat-command observer (src/ui/seat.ts calls it when set), and
 * `move`, called just before this phone's player switches seat, so the log has the shift and the old seat
 * even when the switch comes before its first poll.
 */
export const PT: { sink: PtSink | null; seat: ((kind: string, cmd: unknown, run: () => boolean) => boolean) | null; move: (() => void) | null } = { sink: null, seat: null, move: null };
/** This phone's player is about to switch seat (the strip's 換做 / 返做). */
export function ptMove(): void { PT.move?.(); }

export const ptOn = (): boolean => PT.sink !== null;
export function ptDown(st: string, g: string, x?: PtExtra): void { PT.sink?.down(st, g, x); }
export function ptUp(st: string, ok: boolean, x?: PtExtra, g?: string): void { PT.sink?.up(st, ok, x, g); }
export function ptTap(st: string, g: string, ok = true, x?: PtExtra): void { PT.sink?.tap(st, g, ok, x); }
export function ptMiss(st: string, what: string): void { PT.sink?.miss(st, what); }
export function ptDone(st: string, what: string, x?: PtExtra): void { PT.sink?.done(st, what, x); }
export function ptNew(st: string): void { PT.sink?.fresh(st); }
