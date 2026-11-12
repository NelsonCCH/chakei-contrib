// A party night in a room: the room's Durable Object keeps the night here, beside the
// shift's referee (room.ts), in the same per-room core. The night is the state machine (core/party/night.ts)
// behind its seam; this file only checks what phones send, hands the night its inputs, its clock and each round's report,
// and gives the Worker what the night asks for (PartyOut: start a round, hand a seat to the computer, a new host, a
// refusal). The night is plain JSON, so the Worker stores it as it is and a restarted room carries on from it.
import { partySeam, type PartySeam } from '../party/seam';
import type { NightState, PartyEvent, PartyOut, PlayerId, RoundPlan } from '../party/types';
import { roomPartyShift, roomReport, type RoomShift } from './room';

let N: PartySeam | null = null;

/** The night, or null when the room plays plain shifts. */
export const partyNight = (): NightState | null => N ? N.night() : null;
/** Opens a night (its first player, the room's owner, is its host) or restores a saved one. */
export function partyOpen(seed: number, owner: PlayerId, name: string): PartyOut[] {
  N = partySeam(seed >>> 0);
  return N.input({ k: 'join', player: owner, name: cleanName(name) });
}
/** A saved night (storage): false if it is not one. */
export function partyLoad(v: unknown): boolean {
  if (!isRec(v) || v.v !== 2 || !Array.isArray(v.players) || !Array.isArray(v.schedule) || typeof v.phase !== 'string') return false;
  trustNight(v);
  N = partySeam(v);
  return true;
}
/** Trust boundary: a night the room stored itself (partyNight's JSON), checked above only for its version and shape. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter exists only to carry the assertion
function trustNight(_v: unknown): asserts _v is NightState { /* the room's own storage */ }
/** The room goes back to plain shifts. */
export function partyDrop(): void { N = null; }

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// eslint-disable-next-line no-control-regex -- stripping control characters from a player name is the point
const cleanName = (v: unknown): string => typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '';
const seatOf = (v: unknown): string | null => typeof v === 'string' && v.length <= 16 ? v : null;

/**
 * A phone's party input as the room got it (`player` stamped by the room, never trusted from the phone). Only the kinds a
 * phone may send; join and leave of a lost link are the room's own (partyJoin / partyLeave). Refused or junk: a reject.
 */
export function partyIn(raw: unknown, player: PlayerId): PartyOut[] {
  if (!N) return [{ k: 'reject', why: 'no party night' }];
  if (!isRec(raw)) return [{ k: 'reject', why: 'not a party input' }];
  const ev = eventOf(raw, player);
  return ev ? N.input(ev) : [{ k: 'reject', why: 'not a party input' }];
}
function eventOf(r: Record<string, unknown>, player: PlayerId): PartyEvent | null {
  switch (r.k) {
    case 'join': return { k: 'join', player, name: cleanName(r.name) };
    case 'seat': { const seat = seatOf(r.seat); return seat === null ? null : { k: 'seat', player, seat }; }
    case 'slot': { const seat = seatOf(r.seat); return seat === null || typeof r.on !== 'boolean' ? null : { k: 'slot', player, seat, on: r.on }; }
    case 'watch': case 'start': case 'next': case 'again': case 'bye': return { k: r.k, player };
    case 'setup': {
      if (!isRec(r.cfg)) return null;
      const cfg: Partial<NightState['cfg']> = {}, c = r.cfg;
      if (typeof c.shop === 'string') Reflect.set(cfg, 'shop', c.shop);   // the night falls back to its default for an unknown shop
      if (c.days === 1 || c.days === 2) cfg.days = c.days;
      if (c.chooser === 'vote' || c.chooser === 'host') cfg.chooser = c.chooser;
      return { k: 'setup', player, cfg };
    }
    case 'vote': return r.card === null || (typeof r.card === 'number' && Number.isInteger(r.card)) ? { k: 'vote', player, card: r.card } : null;
    case 'token': case 'ready': return typeof r.on === 'boolean' ? { k: r.k, player, on: r.on } : null;
    default: return null;
  }
}
/** A player's link came back (the room saw them again) / was lost for good or they left the room. */
export const partyJoin = (player: PlayerId, name: string): PartyOut[] => N ? N.input({ k: 'join', player, name: cleanName(name) }) : [];
export const partyLeave = (player: PlayerId): PartyOut[] => N && N.night().players.some(p => p.id === player && p.present) ? N.input({ k: 'leave', player }) : [];
/** Wall seconds passing (the vote's change window and the countdown are the only clocks between rounds). */
export const partyTick = (dt: number): PartyOut[] => N ? N.tick(dt) : [];
/** A clock runs on the night's current screen (the Worker ticks it only then). */
export const partyTimed = (): boolean => { const s = partyNight(); return !!s && (s.phase === 'countdown' || (s.phase === 'vote' && !!s.wager && s.wager.allAt !== null)); };
/** The round's books are closed: its report goes to the night (a round the night is not playing is refused there). */
export function partyResult(): PartyOut[] {
  const r = roomReport(); if (!N || !r) return [];
  return N.roundResult(r);
}
/** The shift a round start asks for, with the players' names from the night. */
export function partyShift(plan: RoundPlan): RoomShift {
  const names: Record<PlayerId, string> = {};
  for (const p of N ? N.night().players : []) names[p.id] = p.name;
  return roomPartyShift(plan, names);
}
