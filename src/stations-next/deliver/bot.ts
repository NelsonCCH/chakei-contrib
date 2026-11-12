// 送外賣 computer rider (cover and tests). Stateless: every call reads the state and answers with a lane change, a gear
// step, or nothing. It looks down each lane for the nearest vehicle (a blinking one counts in the lane it is moving to),
// leaves its lane when the gap closes inside its reaction distance, and gears up to its `gear` cap while the road ahead
// is clear. `skill` (0..1) sets the reaction distance and how often it looks away: a low-skill rider reacts late, so
// at high gears it crashes. Its "looking away" windows come from the run clock, so the same state gives the same answer.
import type { StationCtx } from '../contract';
import { TUNE, clearance, speedOf, type DeliverCmd, type DeliverState } from './core';

/** gear: the gear cap; skill: 0..1; bags: how many bags it takes from the door (fed mode). */
export interface DeliverBotOpts { gear: number; skill: number; bags: number }
export const BOT_DEFAULT: DeliverBotOpts = { gear: 3, skill: 0.85, bags: 1 };

export function makeDeliverBot(opts: Partial<DeliverBotOpts> = {}): (s: DeliverState, ctx: StationCtx) => DeliverCmd | null {
  const o: DeliverBotOpts = { ...BOT_DEFAULT, ...opts };
  const react = 0.3 + 0.9 * o.skill;   // seconds of closing speed it looks ahead
  return (s: DeliverState): DeliverCmd | null => {
    const d = s.door;
    if (!s.selfFeed && s.st !== 'ride' && s.st !== 'crash' && d && d.want === 0) return { t: 'load', n: Math.max(1, Math.min(o.bags, d.bags.length)) };
    if (s.st !== 'ride' || !s.run) return null;
    // looking away: short windows in the run clock, longer and more often for a weaker rider
    const ph = (s.run.t / 2.3 + s.runs * 0.618) % 1;
    if (ph < (1 - o.skill) * 0.5) return null;
    const clr = clearance(s), rel = Math.max(1, speedOf(s) - TUNE.vTraffic), need = rel * react + 2.5;
    const cur = s.lane, here = clr[cur] ?? 1e9;
    if (here < need && Math.abs(s.x - s.lane) < 0.15) {
      // the open neighbour with the most road, or through an open neighbour toward a far lane with more
      let pick = -1, best = here;
      for (const L of [cur - 1, cur + 1]) {
        const c = clr[L];
        if (c === undefined || c < 1.5) continue;
        const far = clr[L + (L - cur)];
        const score = Math.max(c, far !== undefined ? far - 1 : -1);
        if (score > best) { best = score; pick = L; }
      }
      if (pick >= 0) return { t: 'lane', d: pick > cur ? 1 : -1 };
    }
    if (s.gear < Math.min(o.gear, TUNE.gears.length - 1) && s.gearCd <= 0 && here > need * 1.6) return { t: 'gear' };
    return null;
  };
}
export const deliverBot = makeDeliverBot();
