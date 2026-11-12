// Applies the playtest sliders' station-own knobs to the extra seats' stations on this phone, every step
// (core/coop/index.ts coopStep). A station keeps the tier / level it was made with (today's, from the shift or the level)
// as its base the first time a slider moves; the knob is then base shifted by the slider, so back at 5 it is today's
// again. Nothing happens until a slider has moved on this page, so a shift that nobody touched plays exactly as before.
import { paceEverMoved } from './pace';
import { G } from '../state';
import { runnerFloor } from './knobs-runner';
import { roastKnob } from './knobs-roast';
import { knotTier } from './knobs-takeaway';
import { runnerState, runnerFloorTo } from '../coop/plugins/runner';
import { roastState } from '../coop/plugins/roast';
import { takeawayState } from '../coop/plugins/takeaway';
import type { Floor } from '../../stations-next/runner/maze';

const floorBase = new WeakMap<object, Floor>(), numBase = new WeakMap<object, number>();
/** Today's value of a station state's knob (remembered the first time it is seen). */
function baseOf<T>(m: WeakMap<object, T>, s: object, now: T): T { const b = m.get(s); if (b !== undefined) return b; m.set(s, now); return now; }

export function paceStep(): void {
  if (!paceEverMoved()) return;
  const r = runnerState();
  if (r) runnerFloorTo(runnerFloor(baseOf(floorBase, r, r.next ?? r.dk)));
  const o = roastState();
  if (o) o.knob = roastKnob();                              // relative to the station's own tier: 5 is no change
  const k = takeawayState();
  if (k) k.knot = knotTier(baseOf(numBase, k, k.knot));
}
/** For the marks: each extra station's knob now (null: not in this shift). */
export function knobsNow(): Record<string, string | null> {
  const x = G?.extra ?? [], on = (k: ExtraKind): boolean => x.includes(k);
  const r = runnerState(), o = roastState(), k = takeawayState();
  return {
    runner: r && on('runner') ? r.dk : null,
    roast: o && on('roast') ? `cut tier ${String(o.tier)} pieces ${o.knob.pcs >= 0 ? '+' : ''}${String(o.knob.pcs)} snap x${o.knob.snap.toFixed(2)}` : null, takeaway: k && on('takeaway') ? `knot tier ${String(k.knot)}` : null,
  };
}
