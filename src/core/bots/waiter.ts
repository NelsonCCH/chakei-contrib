// The computer waiter.
import { CFG, isIced } from '../data/menus';
import { isMeal, drinkKey, drinkOf } from '../rules/price';
import { randDrink } from '../rules/order';
import { pickSure, rng } from '../rng';
import { CORE_HOOK } from '../hooks';
import { must } from '../util';
import { liveG, occupied, me, bump, asSeat, tableAt } from '../state';
import { seatProblem } from '../referee/customers';

/* ===================== 電腦補位 ===================== */
export function aiSlip(g: Group): string[] {
  const keys = [...g.items];
  if (rng() < CFG.aiErr){
    const di = keys.map((k, i) => isMeal(k) ? -1 : i).filter(i => i >= 0);
    if (rng() < .5 || !di.length){
      const d = randDrink();
      keys.splice(Math.floor(rng() * (keys.length + 1)), 0, drinkKey({ ...d, sweet:0, noice:false }));
    } else {
      const i = pickSure(di), k = must(keys[i], 'slip line');
      keys[i] = drinkKey({ d: must(drinkOf(k), 'drink ' + k).id, cold: isIced(must(drinkOf(k), 'drink ' + k).id) || k[0]!=='凍', sweet:0, noice:false });
    }
  }
  return keys;
}
export function bestTable(g: SeatGroup): TableState | undefined {
  return liveG().tables.filter(tb => !seatProblem(g, tb))
    .sort((a, b) => (a.cap - occupied(a.id) - a.dirty) - (b.cap - occupied(b.id) - b.dirty))[0];
}
export function aiWaiter(): void {
  if (me('waiter') || liveG().floor) return;   // 樓面: the floor's own computer workers cover it (work/floor.ts)
  const S = liveG();
  const w = S.aw, t = S.t;
  if (w.job && t >= w.until){ const done = w.job; w.job = null; awDo(done); }
  if (w.job) return;
  const go = (sec: number, job: AwJob): void => { w.job = job; w.until = t + sec * CFG.aiPace; };
  // A takeaway customer never orders at a table (its state is 'wait'), so the order queue holds seated groups only.
  const ord = S.groups.filter((g): g is SeatGroup => g.state==='order' && !g.take && !g.taken).sort((a, b) => a.until - b.until)[0];
  if (ord){ ord.taken = true; bump(); go(1.4 + .5 * ord.items.length, { kind: 'order', gid: ord.id }); return; }
  for (const g of S.groups.filter(g => g.state==='queue')){
    const tb = bestTable(asSeat(g));
    if (tb){ go(.9, { kind: 'seat', gid: g.id, table: tb.id }); return; }
  }
  const dirty = S.tables.find(tb => tb.dirty);
  if (dirty){ go(1.1, { kind: 'clean', table: dirty.id }); return; }
}
/** The computer waiter's job is done: apply it if it still makes sense (the group may have left meanwhile). */
function awDo(job: AwJob): void {
  const S = liveG();
  if (job.kind==='clean'){ CORE_HOOK.cleanTable(tableAt(job.table)); return; }
  const g = S.groups.find(x => x.id===job.gid);
  if (!g) return;
  if (job.kind==='order') CORE_HOOK.submitOrder(asSeat(g), aiSlip(g));
  else if (g.state==='queue' && !seatProblem(asSeat(g), tableAt(job.table))) CORE_HOOK.seat(asSeat(g), tableAt(job.table));
}
