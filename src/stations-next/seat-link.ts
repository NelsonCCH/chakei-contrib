// A station page shown as a seat of the shop: the game page puts site/stations/<kind>.html?seat in an
// iframe of its seat view (src/ui/seat.ts) and hangs a small host object on its window (`__chakeiSeat`). The station
// itself runs on the game page (core/coop/plugins/<kind>.ts, stepped where the seat is driven); the page here only
// draws that state and sends the player's commands back. Without `?seat` (the standalone playtest page) there is no
// link and the page runs its own shift as before.
import type { StationKind } from './contract';

/** What the game page offers its seat's screen (window.__chakeiSeat on the parent page). */
export interface SeatHost {
  /** The station's state on that phone (null before the shift has one). */
  state(kind: string): unknown;
  /** A player's command; `t` is the wash stroke clock. Ignored unless this phone holds the seat. */
  send(kind: string, cmd: unknown, t?: number): void;
  /** Does this phone hold the seat now ('me')? */
  mine(kind: string): boolean;
}
export interface SeatLink<S> { live(): S | null; send(cmd: unknown, t?: number): void; mine(): boolean }

const isHost = (v: unknown): v is SeatHost => typeof v === 'object' && v !== null
  && typeof Reflect.get(v, 'state') === 'function' && typeof Reflect.get(v, 'send') === 'function' && typeof Reflect.get(v, 'mine') === 'function';

/** The link to the game page's seat, or null when this page runs on its own. Each new state object is checked once. */
export function seatLink<S>(kind: StationKind, valid: (x: unknown) => x is S): SeatLink<S> | null {
  if (!/[?&]seat\b/.test(location.search) || window.parent === window) return null;
  let host: unknown;
  try { host = Reflect.get(window.parent, '__chakeiSeat'); } catch { return null; }
  if (!isHost(host)) return null;
  const h = host;
  let seen: unknown = null, ok: S | null = null;
  return {
    live(): S | null {
      const x = h.state(kind);
      if (x !== seen){ seen = x; ok = valid(x) ? x : null; }
      return ok;
    },
    send(cmd, t): void { h.send(kind, cmd, t); },
    mine: () => h.mine(kind),
  };
}
