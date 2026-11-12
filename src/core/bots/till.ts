// The computer cashier.
import { me, liveG, bump } from '../state';
import { must } from '../util';
import { CFG } from '../data/menus';
import { isPaid, markPaid } from '../coop/paid';

export function aiTill(): void {
  if (me('till')) return;
  const S = liveG();
  const a = S.at, t = S.t;
  // co-op: a bill a teammate's till already took is not taken again (core/coop/paid.ts)
  if (a.cur && isPaid(a.cur.id)) a.cur = null;
  if (a.cur && t >= a.until){ markPaid(a.cur.id); S.revenue += a.cur.expect ?? NaN; S.paidCount++; a.cur = null; }
  if (!a.cur && S.payQ.length){ const c = must(S.payQ.shift(), 'pay queue'); a.cur = c; a.until = t + (2.5 + .4 * must(c.payLines, 'pay lines').length) * CFG.aiPace; bump(); }
}
