// Party screens: small pure reads of the night for the screens. No rules are decided here: the
// night (src/core/party/) decides everything and refuses what it does not allow; these only say what to show.
import { COUNTDOWN_SEC, PARTY_FLOOR, PARTY_SEATS, PARTY_SHOPS, ROUND_NAME, VOTE_CHANGE_SEC, isPartyFloor } from '../../core/party/config';
import { stationName } from '../../core/party/endcard';
import { rentFor } from '../../core/party/wager';
import type { NightState, Player, PlayerId, SeatId } from '../../core/party/types';

export interface Me {
  id: PlayerId;
  p: Player | undefined;
  present: boolean;
  seat: SeatId | null;
  host: boolean;
}

export const meOf = (s: NightState, id: PlayerId): Me => {
  const p = s.players.find(q => q.id === id);
  return { id, p, present: p?.present ?? false, seat: p?.seat ?? null, host: s.host === id };
};
export const nameOf = (s: NightState, id: PlayerId): string => s.players.find(p => p.id === id)?.name ?? id;
export const presentOf = (s: NightState): Player[] => s.players.filter(p => p.present);
export const seatedOf = (s: NightState): Player[] => s.players.filter(p => p.present && p.seat !== null);
/** Seats in the shop's order (樓面's two or 伙記, 水吧, 廚房, 收銀), then any later kinds the night has. */
export const seatsOf = (s: NightState): SeatId[] => { const first = [...PARTY_FLOOR, ...PARTY_SEATS]; return [...first.filter(k => k in s.seats), ...Object.keys(s.seats).filter(k => !first.includes(k))]; };
export const freeSeats = (s: NightState): SeatId[] => seatsOf(s).filter(k => s.seats[k] === null);
export const seatName = (seat: SeatId): string => isPartyFloor(seat) ? stationName('floor') : stationName(seat.split('#')[0] ?? seat);
export const shopName = (s: NightState): string => PARTY_SHOPS[s.cfg.shop].name;
/** The rent of the round being played or next (null in the lobby, at 收舖 and after). */
export function roundRent(s: NightState): number | null {
  const slot = s.schedule[s.round];
  return slot && s.phase !== 'lobby' && s.phase !== 'close' && s.phase !== 'done' ? rentFor(slot.shop, slot.kind) : null;
}

/** "第1日 · 早市" for the round being played or next; "開舖前" in the lobby. */
export function roundLabel(s: NightState): string {
  const slot = s.schedule[s.round];
  if (s.phase === 'lobby' || !slot) return '開舖前';
  const name = ROUND_NAME[slot.kind];
  return s.cfg.days > 1 ? `第${String(slot.day)}日 · ${name}` : name;
}

/**
 * The screen's clock, for the timer bar: only the round itself, the vote's 5 s change window (once everyone has voted)
 * and the 5 s countdown run on time. Everything else waits for people and shows no clock.
 */
export function phaseLimit(s: NightState): number | null {
  switch (s.phase) {
    case 'vote': return s.wager?.allAt != null ? VOTE_CHANGE_SEC : null;
    case 'countdown': return COUNTDOWN_SEC;
    case 'round': return s.schedule[s.round]?.sec ?? null;
    default: return null;
  }
}
/** Seconds left on the screen's clock, or null when it waits for someone. */
export function remaining(s: NightState): number | null {
  const lim = phaseLimit(s);
  if (lim === null) return null;
  const from = s.phase === 'vote' ? s.wager?.allAt ?? 0 : 0;
  return Math.max(0, lim - (s.phaseT - from));
}

const group = (n: number): string => String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** $12,300 */
export const money = (n: number): string => `${n < 0 ? '−' : ''}$${group(n)}`;
/** +$300 / −$300 / $0 */
export const signed = (n: number): string => n > 0 ? `+$${group(n)}` : n < 0 ? `−$${group(n)}` : '$0';

/** The night's refusals (core/party/night.ts) in the players' words. */
const REJECT: Record<string, string> = {
  'the night is over': '今晚散咗水', 'not here': '你唔喺房入面', 'the night is closing': '收緊舖', 'only in the lobby': '開咗工改唔到',
  'only the host sets up the night': '老闆先可以改設定', 'only the host opens the shop': '老闆先可以開工', 'no end card': '張結算卡已經過咗',
  'no vote open': '投票完咗', 'the host decides tonight': '今晚老闆話事', 'no such card': '冇呢張卡', 'only seated players': '坐低咗先可以',
  'the token is spent': '孤注一擲已經用咗', 'only at 收舖': '收舖先得', 'only the host': '老闆先可以', 'already here': '你已經喺度',
  'the room is full': '房滿咗（最多八個）', 'no such seat': '冇呢個位', 'no round is being played': '而家冇更做緊', 'that seat is taken': '個位有人坐咗', 'not during a round': '做緊更唔改得', 'one 樓面 place stays on': '樓面最少要開一個位',
  'only the host starts the round': '老闆先可以開工', 'not everyone is ready': '仲有人未準備好', 'nothing to start': '而家唔使開工', 'no ready check': '而家唔使準備',
};
export const rejectText = (why: string): string => REJECT[why] ?? why;
