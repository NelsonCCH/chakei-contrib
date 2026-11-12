// Types of the push-to-talk channel (global, type-only). The room Durable Object owns the floor
// (worker/index.ts); src/ptt/ is the phone side. The transport (src/net.ts) only carries these messages.

/** Why the floor became free. */
type PttWhy = 'release' | 'limit' | 'silent' | 'gone' | 'leave';
/** Who holds the floor, as the room sends it on every change (holder null = free). `left`: ms of the turn left. */
interface PttFloorMsg { t: 'floor'; holder: string | null; name: string; turn: number; left: number; why?: PttWhy }
/** A request the room refused: someone else talks ('busy') or this phone asked too often ('slow'). */
interface PttNoMsg { t: 'floorNo'; why: 'busy' | 'slow'; holder: string | null; name: string; turn: number; left: number }
type PttIn = PttFloorMsg | PttNoMsg;
/** The floor as `hello` carries it (null = free). */
interface PttHelloFloor { holder: string; name: string; turn: number; left: number }
type PttOut =
  | { t: 'floorReq'; name: string }
  | { t: 'floorHold'; turn: number }
  | { t: 'floorRelease'; turn: number }
  | { t: 'pttMute'; on: boolean };

/** What src/ptt needs from the transport: who this phone is, whether the link is up, and a way to send. */
interface PttLink {
  id: string;
  up: () => boolean;
  /** JSON messages and binary audio frames; dropped while the link is down. */
  send: (m: PttOut | ArrayBuffer) => void;
}
/**
 * What src/ptt needs from the game: the player's name, whether the talk strip belongs on screen now, and the column it
 * goes at the bottom of (the station above it gives up the strip's height; null: the page's body). Both are asked every
 * frame (the strip shows in the room's lobby once this phone sits, then moves to the shift's game column).
 */
interface PttHud {
  name: () => string;
  shown: () => boolean;
  mount: () => HTMLElement | null;
}

interface Window {
  webkitAudioContext?: typeof AudioContext;
}
