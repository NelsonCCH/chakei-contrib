// What the Worker uses of worker/room-core.js, the room's referee (src/core/coop/room-worker.ts bundled into a factory by
// scripts/build.mjs) and its party night. The core's own types stay in src/; here everything
// the Worker passes through unread (envelopes, settings, keyframes, the night) is `unknown`, and the Worker reads only
// the fields named below.

/** A shift's settings as roomShiftOf checked them (opaque to the Worker: it only stores and hands them back). */
export interface RoomShift { readonly __roomShift: true }
export interface RoomStartOpts { room: string; send: (e: { to?: string; b: { k: string } }) => void; now: number; round: number; seed: number }
export interface RoomSaved { sh: RoomShift; round: number; seed: number; key: unknown; drove: unknown; tally?: unknown }
/** What the party night asks of the room (core/party/types.ts PartyOut, the fields the Worker reads). */
export type PartyOut =
  | { k: 'roundStart'; plan: unknown }
  | { k: 'drive'; seat: string; player: string | null }
  | { k: 'host'; player: string | null }
  | { k: 'reject'; why: string }
  | { k: 'phase' | 'settled' };

export interface RoomCore {
  ROOM_WAKE_MS: number;
  roomShiftOf(m: unknown, seated: Record<string, { player: string; name: string }>): RoomShift | null;
  roomStart(o: RoomStartOpts, sh: RoomShift): void;
  roomRestore(o: RoomStartOpts, sh: RoomShift, key: unknown, drove?: unknown, tally?: unknown): void;
  roomSave(): RoomSaved | null;
  roomAdvance(now: number): void;
  roomReceive(raw: unknown, now: number): void;
  roomLeave(player: string): void;
  roomDrive(seat: string, player: string | null): void;
  roomStatus(): { running: boolean; paused: boolean; closed: boolean; t: number; round: number } | null;
  roomDebug(d: unknown, now: number): unknown;
  /** The party night (null: plain shifts), plain JSON to store and broadcast. */
  partyNight(): { phase: string; host: string | null; players: { id: string; present: boolean; seat: string | null }[] } | null;
  partyOpen(seed: number, owner: string, name: string): PartyOut[];
  partyLoad(v: unknown): boolean;
  partyDrop(): void;
  partyIn(raw: unknown, player: string): PartyOut[];
  partyJoin(player: string, name: string): PartyOut[];
  partyLeave(player: string): PartyOut[];
  partyTick(dt: number): PartyOut[];
  partyTimed(): boolean;
  partyResult(): PartyOut[];
  partyShift(plan: unknown): RoomShift;
}
/** A new, independent copy of the room's core (one per room: every module variable is that room's own). */
export function freshCore(): RoomCore;
