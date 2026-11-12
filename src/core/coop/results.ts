// Results: a station never writes the shared shift; it says what it did, and the
// referee applies it with the shop's own judge (seat, submitOrder, the recipes, good/breakCombo). On the referee's phone
// a result is applied at once, inside the tap (the in-memory bus: solo and the host's own seats behave exactly as before,
// so a test reading G right after a press sees the effect); on a teammate's phone it is predicted the same way on the
// replica and sent to the referee (core/coop/phone.ts installs that sink).
import type { Result, SeatId } from '../proto/messages';
import { liveG, byId, asSeat, bump } from '../state';
import { CORE_HOOK } from '../hooks';
import { CFG } from '../data/menus';
import { cupMatches, kitRecipe, sameBag } from '../rules/recipes';
import { toast } from '../fx';
import { seatProblem } from '../referee/customers';
import { pluginForDest } from './registry';
import { noteSpeed } from '../referee/speed';
import { xOn, lineMade, carried, roastGone, packed, remake } from '../referee/extras';
import { seatGood, seatMiss, seatTake, seatHot, ROAST_GOOD_Q, BAG_GOOD_STARS } from '../referee/seatscore';
import { priceSlip } from '../rules/price';
import { isPaceStation, setPace } from '../playtest/pace';
import { isPaid, markPaid } from './paid';
import { tallyMiss } from './tally';   // a party round's mistakes per person
import { taskGuard, rideOut, dropOff, rideBack } from '../work/floor';   // 樓面 claims

/** Who a result is applied for (樓面 claims): the teammate whose message the referee applies, else this phone's
 *  own player (the referee's or the phone's id, registered by each). */
let actorHere: () => string = () => '';
let actorNow: string | null = null;
export function setLocalActor(f: (() => string) | null): void { actorHere = f ?? ((): string => ''); }
export const actor = (): string => actorNow ?? actorHere();
/** Runs `f` with results applied for player `p` (the referee applying a teammate's message). */
export function withActor<T>(p: string, f: () => T): T { const was = actorNow; actorNow = p; try { return f(); } finally { actorNow = was; } }

export type ResultSink = (seat: SeatId, r: Result) => void;
const applyNow: ResultSink = (seat, r) => { applyResult(seat, r); };
let sink: ResultSink = applyNow;
/** Where results go: null = applied here at once (the referee's phone; the default). */
export function setResultSink(f: ResultSink | null): void { sink = f ?? applyNow; }
/** A station reports what it did. */
export function submit(seat: SeatId, r: Result): void { sink(seat, r); }

/**
 * Applies one result to the shared shift. Returns false when it no longer applies (the group left, the line is gone, the
 * table is taken): the referee answers with a nack and the station's prediction is corrected by the next keyframe.
 * `at`: the game time the station made it (a teammate's envelope); absent, now. Only the third star's timings read it
 * (referee/speed.ts): they are taken here, where the result is applied, so a teammate's lag is not counted.
 */
export function applyResult(seat: SeatId, r: Result, at?: number): boolean {
  const S = liveG(), when = Math.min(at ?? S.t, S.t);
  // 樓面: a floor task another player holds is theirs; their claim wins over this result
  if (!taskGuard(actor(), r)) return false;
  switch (r.k){
    case 'cleared': { const tb = S.tables[r.table]; if (!tb || !tb.dirty) return false; CORE_HOOK.cleanTable(tb); CORE_HOOK.good(); return true; }
    case 'ride': return rideOut(actor(), r.gids);
    case 'dropped': return dropOff(actor(), r.gid, r.fast === true);
    case 'back': return rideBack(actor());
    case 'seat': {
      const g = byId(r.gid), tb = S.tables[r.table];
      if (!g || g.take || g.state !== 'queue' || !tb || seatProblem(g, tb)) return false;
      CORE_HOOK.seat(asSeat(g), tb); return true;
    }
    case 'clean': { const tb = S.tables[r.table]; if (!tb) return false; CORE_HOOK.cleanTable(tb); return true; }
    case 'slipOpen': {
      const g = byId(r.gid); if (!g || g.take || g.state !== 'order') return false;
      if (r.regSeen && g.regular) S.regSeen[g.regular] = true;
      g.taken = true; g.later = null; return true;
    }
    case 'slipClose': { const g = byId(r.gid); if (!g || g.take) return false; if (g.state === 'order') g.later = CFG.laterGrace; return true; }
    case 'order': {
      const g = byId(r.gid); if (!g || g.take || g.state !== 'order') return false;
      if (r.peeked) g.peeked = true;
      noteSpeed('waiter', when - (g.seatAt ?? when));   // 第三粒星：坐低到落單幾耐
      CORE_HOOK.submitOrder(g, r.keys, true); return true;
    }
    case 'lineDone': {
      const g = byId(r.gid);
      if (r.dest === 'bar' || r.dest === 'kitchen'){
        if (!g || g.state !== 'wait') return false;
        const line = r.dest === 'bar' ? g.drinks?.[r.i] : g.meals?.[r.i];
        if (!line) return false;
        const m = r.made;
        if (r.dest === 'bar' && m.t === 'cup') line.ok = cupMatches({ target: null, cup: m.cup, ing: m.ing }, line.k);
        else if (r.dest === 'kitchen' && m.t === 'plate') line.ok = sameBag(m.tokens, kitRecipe(line.k));
        else return false;
        const was = line.done;
        line.done = true; noteSpeed(r.dest === 'bar' ? 'bar' : 'kitchen', when - (g.orderAt ?? when));   // 落單到出飲品／出碟
        if (!was) lineMade(g, r.dest === 'bar' ? 'bar' : 'kitchen', line);
        if (line.ok) CORE_HOOK.good(); else CORE_HOOK.breakCombo();
        return true;
      }
      if (r.dest === 'roast'){
        // 燒味: timed from the order, judged on the counter's quality
        const start = g ? (g.take ? g.until - g.max : g.orderAt ?? when) : when;
        if (!(pluginForDest(r.dest)?.onResult?.(seat, r) ?? false)) return false;
        if (r.made.t === 'score'){
          noteSpeed('roast', when - start); seatTake('roast', r.made.pay);
          if (r.made.q >= ROAST_GOOD_Q) seatGood('roast'); else seatMiss('roast');
        }
        return true;
      }
      return pluginForDest(r.dest)?.onResult?.(seat, r) ?? false;
    }
    // the extra seats (core/referee/extras.ts); what each does to the score: referee/seatscore.ts
    case 'carried': {
      if (!xOn('runner')) return false;
      const c = carried(r.refs, r.table);
      if (c.n <= 0) return false;
      // 每碟上枱, the trip's seconds per dish carried (the driving phone times its trip: r.sec), so a fuller tray
      // is quicker per dish; and the seat's measure, the dishes that left the pass hot on the runner's watch (r.hot, judged
      // where the tray is driven; from an older phone, the dishes not gone cold on the pass at all)
      if (r.sec !== undefined) noteSpeed('runner', r.sec, c.n);
      seatHot(Math.min(c.n, r.hot ?? c.hot)); seatGood('runner'); return true;
    }
    case 'knock': case 'cold': if (!xOn('runner')) return false; seatMiss('runner'); return true;   // the tray knocked over (體力冇晒); a dish left to go cold
    case 'took': return false;   // retired: the sink no longer takes the tables' dishes
    case 'washed': case 'broken': case 'slip': return false;   // retired with 洗碗: an old phone's sink
    case 'walkout': return xOn('roast') && roastGone(r.gid, r.i);
    case 'packed': {
      if (!xOn('takeaway')) return false;
      const g = byId(r.gid), ready = g?.take ? g.readyAt : undefined;
      const worth = g?.take ? priceSlip([...g.drinks, ...g.meals].map(l => l.k)).total + r.tip : 0;   // the bag's takings, as packed() books them
      if (!packed(r.gid, r.tip)) return false;
      if (ready !== undefined) noteSpeed('takeaway', when - ready);
      seatTake('takeaway', worth);
      if (r.stars >= BAG_GOOD_STARS) seatGood('takeaway'); else seatMiss('takeaway');
      return true;
    }
    case 'remake': if (!xOn('takeaway') || !remake(r.gid, r.i)) return false; seatMiss('takeaway'); return true;
    // a teammate's playtest slider: only for the station of the seat it holds
    case 'pace': if (r.st !== seat || !isPaceStation(r.st)) return false; setPace(r.st, r.v); return true;
    case 'potReady':
      if (S.phase === 'prep'){ S.phase = 'open'; toast('開門！'); bump(); }
      return true;
    case 'tillTake': {
      const i = S.payQ.findIndex(c => c.id === r.cid); if (i < 0 || isPaid(r.cid)) return false;
      S.payQ.splice(i, 1); S.billAt = when; return true;   // the bill reaches the counter: the till's timing starts
    }
    // a bill already paid (co-op: the till changed hands around its payment) is never charged or paid again
    case 'tillMiss': if (isPaid(r.cid)) return false; S.mistakes++; tallyMiss('till'); S.loss += r.loss; return true;
    case 'tillPaid':
      if (isPaid(r.cid)) return false;
      markPaid(r.cid); S.revenue += r.charged; S.paidCount++; noteSpeed('till', when - (S.billAt ?? when)); CORE_HOOK.good(); return true;
    default: return false;
  }
}
