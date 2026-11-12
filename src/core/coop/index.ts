// The one game path: solo and co-op both run through here. On the referee's phone
// (solo, or the host) a step is the shop's step (referee/index.ts update) and the stations' results apply at once; on a
// teammate's phone a step is its stations' own step and results go to the referee (core/coop/phone.ts).
import { CORE_HOOK } from '../hooks';
import type { Keyframe } from '../proto/messages';
import { isReferee, refFrame, refTakeOver, referee, SHOP_SEATS, type TakeOverOpts } from './referee';
import { stationOf } from './registry';
import './plugins/roast';
import './plugins/runner';
import './plugins/takeaway';
import './plugins/floor';   // 樓面: the floor seats' jobs, with 執枱 and 送外賣
import { phone, phoneStep, phoneFrame, phoneStop, pendingResults } from './phone';
import { paceStep } from '../playtest/apply';

/** One fixed step of the shift on this phone (core/referee/clock.ts advance calls it). */
export function coopStep(dt: number): void {
  const R = referee(), P = phone();
  if (!R && P) phoneStep(dt);
  else CORE_HOOK.update(dt);
  // the stations-next seats (registered with a step): stepped where they are driven
  const seats = R ? Object.values(R.seats) : P ? Object.values(P.seats) : [];
  const me = R ? R.me : P ? P.me : '';
  paceStep();   // the playtest sliders' station-own knobs (nothing until a slider moved)
  for (const s of seats){
    if (SHOP_SEATS.includes(s.kind)) continue;
    const m = stationOf(s.kind), d = s.driver;
    if (!m?.step) continue;
    if (d.type === 'player' && d.player === me) m.step(dt, 'me');
    else if (d.type === 'computer' && R) m.step(dt, 'computer');
  }
}
/** After the frame's steps: the referee's seat rules and messages, or this phone's resends and status. `now` in ms. */
export function coopFrame(now: number): void {
  if (isReferee()) refFrame(now);
  else if (phone()) phoneFrame(now);
}

/**
 * Host change: this phone stops being a teammate and becomes the referee, from the room's last keyframe
 * (the room keeps it), carrying its own results that keyframe does not have yet.
 */
export function takeOver(key: Keyframe, o: Omit<TakeOverOpts, 'mine'>): void {
  const mine = pendingResults();
  phoneStop();
  refTakeOver(key, { ...o, mine });
}
