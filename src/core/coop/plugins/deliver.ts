// 送外賣 on the floor: a bag at the door (core/work/floor.ts F.out) claimed from the 樓面 job bar is
// ridden out in the station (src/stations-next/deliver, fed mode). The floor plugin (plugins/floor.ts) starts the run
// once the claim is this phone's (`ride` has gone to the referee: the rider is away, the order has left the door); this
// plugin then sends `dropped` for each drop-off on the road and `back` when the rider is home.
// Up to RUN_MAX bags per run: whoever claims the bags (the floor's claim path: the job bar
// today, the map's 送 bubble batch claim) hands their ids to deliverSetOff, which sets off only once the
// referee has granted every claim, and leaves out only a bag that was lost before departure. This plugin claims nothing.
// At the door the station can show a bag picker (deliverDoor); the rider's choice comes back through setDeliverLoad.
import { deliver, init, type DeliverState, type DeliverResult, type DeliverCmd } from '../../../stations-next/deliver/core';
import { registerStation } from '../registry';
import { submit } from '../results';
import { liveG } from '../../state';
import { PORT } from '../../env';
import { levelTier } from '../../work/roles';
import { ctxOf, dk, store, registerSeatCommand, obj } from './kit';
import { actor } from '../results';
import { phone } from '../phone';
import { taskOf, RUN_MAX } from '../../work/floor';

function tier(): number {
  const lv = liveG().level, L = lv ? PORT.level(lv) : undefined;
  return Math.min(8, Math.max(1, levelTier(L ?? liveG().party, 'takeaway') ?? 1));
}
const st = store<DeliverState>(() => init({ difficulty: dk(), seed: liveG().nextId * 7919, players: 1, selfFeed: false, tier: tier() }));
export const deliverState = (): DeliverState | null => st.peek();
const ctx = (byPlayer: boolean): ReturnType<typeof ctxOf> => ctxOf('deliver', byPlayer);

/** Has the run of this job come back (its `back` sent)? The floor plugin ends the job on it. */
let home = true;
export const deliverHome = (): boolean => home;
const leftOf = (gid: number): number => { const S = liveG(); return Math.max(1, (S.floor?.out.find(x => x.gid === gid)?.cold ?? S.t + 30) - S.t); };
/** At the door: the bags this rider could take (empty: not at the door), and how many they chose (0: not yet). */
export function deliverDoor(bags: readonly { gid: number; no: number }[], want: number): void {
  const s = st.get();
  if (!bags.length){ if (s.door) deliver.onEvent(s, { kind: 'door', bags: [] }, ctx(false)); return; }
  const key = bags.map(b => b.gid).join(',') + '/' + String(want), was = s.door ? s.door.bags.map(b => b.gid).join(',') + '/' + String(s.door.want) : '';
  if (key !== was) deliver.onEvent(s, { kind: 'door', bags: bags.map(b => ({ gid: b.gid, no: b.no, left: leftOf(b.gid) })), want }, ctx(false));
}
/** The claimer takes the rider's choice of how many bags (the floor sets it: it owns the claims). */
let onLoad: (n: number) => void = () => undefined;
export function setDeliverLoad(f: (n: number) => void): void { onLoad = f; }
/** Where a claimed bag stands for this phone: granted by the referee, still pending, or lost (someone else's, left the door). */
export function bagClaim(gid: number): 'ok' | 'wait' | 'lost' {
  const S = liveG(), id = 'deliver:' + String(gid), x = taskOf(id), o = S.floor?.out.find(y => y.gid === gid);
  if (Object.values(phone()?.pend ?? {}).includes(id)) return 'wait';
  if (!x || !o || o.rider !== null) return 'lost';
  return x.by === actor() ? 'ok' : 'lost';
}
/**
 * Sets off with the bags this rider claimed (gids, at most RUN_MAX, in the order they go): 'wait' while any claim is not
 * granted yet (the bike stays at the door); a lost bag is left out, only that one; 'none' when no bag is left; 'go' when
 * the `ride` went to the referee with the granted bags and the station's run started (`gids`: the bags on the road).
 */
export function deliverSetOff(bags: readonly number[]): { st: 'go' | 'wait' | 'none'; gids: number[]; lost: number[] } {
  const want = [...new Set(bags)].slice(0, RUN_MAX), stv = want.map(bagClaim);
  const lost = want.filter((_, i) => stv[i] === 'lost'), gids = want.filter((_, i) => stv[i] === 'ok');
  if (stv.includes('wait')) return { st: 'wait', gids: [], lost };
  if (!gids.length) return { st: 'none', gids, lost };
  const F = liveG().floor;
  submit('deliver', { k: 'ride', gids });
  deliverRun(gids.map(g => ({ gid: g, no: F?.out.find(y => y.gid === g)?.no ?? g })));
  return { st: 'go', gids, lost };
}
/** Sets off with these orders (the referee has the `ride`): the station's run. */
export function deliverRun(orders: { gid: number; no: number }[]): void {
  const s = st.get();
  const qs = orders.map(o => ({ gid: o.gid, no: o.no, left: leftOf(o.gid) }));
  if (!qs.length) return;
  home = false;
  deliver.onEvent(s, { kind: 'run', orders: qs }, ctx(false));
}
function report(out: DeliverResult[]): void {
  for (const r of out){
    if (r.kind === 'dropped') submit('deliver', r.fast ? { k: 'dropped', gid: r.gid, fast: true } : { k: 'dropped', gid: r.gid });
    else if (r.kind === 'back'){ submit('deliver', { k: 'back' }); home = true; }
    else if (r.kind === 'load') onLoad(r.n);
  }
}
export function deliverCommand(cmd: DeliverCmd): void { report(deliver.command(st.get(), cmd, ctx(true))); }

function stepRun(dt: number, driver: 'me' | 'computer'): void {
  const s = st.get();
  if (driver === 'computer'){ const c = deliver.bot.next(s, ctx(false)); if (c) report(deliver.command(s, c, ctx(false))); }
  report(deliver.step(s, dt, ctx(driver === 'me')));
}
/** Steps this phone's run as its driver (the floor job does the same through the registry). */
export function deliverDrive(dt: number): void { stepRun(dt, 'me'); }
registerStation({
  kind: 'deliver', v: 1,
  pick: () => st.get(),
  put: (_S, s) => { if (!deliver.validate(s)) return false; st.set(structuredClone(s)); return true; },
  waiting: () => deliver.status(st.get(), ctx(false)).waiting,
  step: (dt, driver) => { stepRun(dt, driver); },
});
registerSeatCommand('deliver', c => {
  if (!obj(c)) return false;
  if (c.t === 'lane' && (c.d === -1 || c.d === 1)){ deliverCommand({ t: 'lane', d: c.d }); return true; }
  if (c.t === 'gear'){ deliverCommand({ t: 'gear' }); return true; }
  if (c.t === 'load' && typeof c.n === 'number'){ deliverCommand({ t: 'load', n: c.n }); return true; }
  return false;
});
export function deliverBotPress(): void { const c = deliver.bot.next(st.get(), ctx(true)); if (c) deliverCommand(c); }
