// Each bill is paid once. In a co-op shift the till changes hands (cover, leave, rejoin, hand-back) and its
// customer travels with the seat's state: a checkpoint a little older than the till's last payment, or a hand-over that
// crossed a payment, gave a customer who had already paid back to the pay queue or to a phone, and they paid again
// (a leave-and-rejoin race). The shift keeps the ids of the bills already paid (`paidIds`, a shared field,
// so it survives a room restart and every phone's prediction agrees with the referee) and every way into the till checks
// it. Solo never sets it (`coop` is off): the rules there are unchanged.
import { liveG } from '../state';

/** This bill was already paid in this co-op shift. */
export const isPaid = (cid: number, S: GameState = liveG()): boolean => !!S.coop && !!S.paidIds && S.paidIds.includes(cid);
/** Books a bill as paid (co-op only). */
export function markPaid(cid: number, S: GameState = liveG()): void { if (S.coop) (S.paidIds ??= []).push(cid); }
/** The till's customers after its state came back from somewhere: anyone already paid is let go, never served again. */
export function dropPaid(S: GameState): void {
  if (!S.coop || !S.paidIds) return;
  if (S.cur && isPaid(S.cur.id, S)) { S.cur = null; S.step = 'total'; S.entry = ''; S.give = []; }
  if (S.at.cur && isPaid(S.at.cur.id, S)) S.at = { cur: null, until: 0 };
  if (S.payQ.some(c => isPaid(c.id, S))) S.payQ = S.payQ.filter(c => !isPaid(c.id, S));
}
