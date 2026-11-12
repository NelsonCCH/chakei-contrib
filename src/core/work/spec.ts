// Level design as workload: a shop's busyness is its customers and what they
// order. A level is its dine-in pace (the level's gap and patience, unchanged), plus this spec: how many
// takeaway orders and 斬料 walk-ins come, how big a takeaway order is, how many are delivered, and the station knobs
// (players on the floor). The order mix is the mixer's (core/work/mix.ts): equal prep seconds on the
// prep seats a shift has, and a diner orders food or only a drink by the same rule. The values are solved by
// scripts/workload-solve.mjs (each seat's busy share within BAND of the mean at the human mid profile, the 樓面 roster)
// and checked by tests/sim/workload.test.js.
//
// A spec is used only in a shop with extra seats (G.extra, core/referee/work.ts): the shop's four alone (solo, the
// default room) keep their customers exactly as before.

export interface WorkSpec {
  /** 外賣 orders a shift: pay at the till, made, bagged, collected or delivered (needs the takeaway seat). */
  take: number;
  /** Items in one takeaway order; the mixer picks each (a drink, a meal or a roast box). */
  items: number;
  /** Share of takeaway orders delivered (送外賣) rather than collected at the counter. */
  deliver: number;
  /** 斬料 walk-ins a shift: one roast dish, paid at the roast counter (needs the roast seat). */
  chop: number;
  /** Players on the floor (樓面) this level is balanced for. */
  floor: number;
  /** Dine-in party sizes (cumulative chances of 1, 2 and 3; the rest are 4) instead of the level's: the order mix's
   *  lever between the per-party seats (seating, the till) and the per-diner ones (bar, kitchen). Absent: the level's. */
  sizes?: readonly [number, number, number];
  /** The dine-in arrival gap times this: the busyness lever that keeps each seat's work from falling along the
   *  main ladder (a level's own gap is its feel in the four-only shop; this is its pace with the roles on).
   *  Absent: 1. */
  gapK?: number;
}
/** Each seat's busy share within this fraction of the roster's mean (the balance target). */
export const BAND = 0.15;

/** A shop with no spec of its own (a room off the levels, a party shop, a solo seat on a level without the role): about
 *  today's takeaway rate (every 20 s); 斬料 6 a shift, a walk-in every 20-37 s, so an opened 燒味 seat always has a
 *  customer waiting within the 60 s a walk-in waits (at 4 a shift, gaps up to 56 s left it empty for half a minute and
 *  more), and the mixer adds diners' roast on top when the kitchen runs ahead. */
export const WORK_DEFAULT: WorkSpec = { take: 8, items: 2, deliver: 0.5, chop: 6, floor: 2 };

/** Per level with `roles` (ui/levels.ts ids). Solved by `node scripts/workload-solve.mjs --seeds 5`,
 *  except 機場 and 年廿八, hand-picked near the solve so the main ladder's served share keeps falling (tests/sim/roles.test.js). */
export const WORK_LEVELS: Readonly<Record<string, WorkSpec>> = {
  // Lines that fell up the main ladder: 中環 gapK .95 (its waiter is at capacity at breakfast, order-taking
  // 4.7 s a diner, so only the bar's line moves: 634 -> 722, over 屋邨's 688); 旺角 gapK .75 and sizes [.7, .93, 1] ->
  // [.6, .88, .98] (70% singles at a 3.3 gap left it the quietest level after 屋邨: floor 69%; waiter 767 -> 961, bar 773
  // -> 849, mid served 99%)
  central: { take: 0, items: 2, deliver: 0, chop: 0, floor: 2, gapK: 0.95 },
  // 旺角 is the 外賣 intro level now that 洗碗 is gone: take 0 -> 3 (bags to learn on, as 機場
  // had), items 2 -> 1 (one-item bags to learn on; at 2 the till sat 17% under the mean, at 1 the band is 10.6%, 5 seeds),
  // deliver .5 (deliveries only from 外賣 tier 2, core/referee/work.ts deliversOn, so none here)
  mongkok: { take: 3, items: 1, deliver: 0.5, chop: 0, floor: 2, sizes: [0.6, 0.88, 0.98], gapK: 0.75 },
  // With the measured bag: take 2 -> 1, sizes [.5, .8, .95] -> [.45, .75, .92]. As the 外賣 intro level it then needed
  // bags to learn on: take 1 -> 3, sizes -> [.4, .7, .9], washK .6 -> .55 to keep the band (11.4%, was 12.8%); mid
  // served over the four seats 91.1% (12 seeds; was 91.9%), so the ladder rule still holds against 打風. With 洗碗
  // gone, 機場 is 外賣 tier 2, the deliveries' first level: its floor sat 20% over the mean with 2 players, so
  // floor 2 -> 3, take 3 -> 6, sizes -> [.5, .8, .95] (the band: 3.9%, 5 seeds)
  airport: { take: 6, items: 2, deliver: 0.5, chop: 0, floor: 3, sizes: [0.5, 0.8, 0.95] },
  typhoon: { take: 8, items: 2, deliver: 0.5, chop: 0, floor: 3, sizes: [0.5, 0.8, 0.95] },
  // with 洗碗 gone and 外賣 a tier up, 打風 fell to 89% mid served and 年廿八 sat 7 points over it
  // (the ladder rule allows 6): gapK .9 (94.4% over 16 shifts; the band 12.1% -> 7.6%)
  newyear: { take: 18, items: 2, deliver: 0.5, chop: 0, floor: 3, sizes: [0.7, 0.93, 1], gapK: 0.9 },
  // 通宵 sat under 年廿八 at every seat with the same busy shares: its 1-item bags made half the takeaway takings.
  // items 1 -> 2 (the bags of 年廿八), gapK .85, sizes [.6, .88, .98] -> [.7, .93, 1], washK .67 -> .55 (the band: 6.2%)
  latenight: { take: 18, items: 2, deliver: 0.5, chop: 4, floor: 3, sizes: [0.7, 0.93, 1], gapK: 0.85 },
  bingsutt: { take: 0, items: 2, deliver: 0, chop: 0, floor: 2, sizes: [0.7, 0.93, 1] },
  silver: { take: 0, items: 2, deliver: 0, chop: 0, floor: 2, sizes: [0.6, 0.88, 0.98] },
  kwc: { take: 0, items: 2, deliver: 0, chop: 4, floor: 2 },
  milktea: { take: 12, items: 2, deliver: 0.5, chop: 0, floor: 2, sizes: [0.6, 0.88, 0.98] },
  fastmilk: { take: 0, items: 2, deliver: 0, chop: 0, floor: 2, sizes: [0.4, 0.7, 0.9] },
  hangwan: { take: 6, items: 2, deliver: 0.5, chop: 0, floor: 2, sizes: [0.5, 0.8, 0.95] },
  hell: { take: 12, items: 2, deliver: 0.5, chop: 8, floor: 3, sizes: [0.5, 0.8, 0.95] },
};

/** The spec for a shift on level `level` (an id), else the default. */
export function workSpecFor(level: string | null | undefined): WorkSpec {
  return (level ? WORK_LEVELS[level] : undefined) ?? WORK_DEFAULT;
}
