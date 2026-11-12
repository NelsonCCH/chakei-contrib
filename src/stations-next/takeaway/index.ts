// The 外賣 station as the referee will register it: the core with its computer driver. `takeaway` prints its own slips
// (the standalone page and the tests); `takeawayFed` waits for the referee's `bag` / `item` events; `takeawayDrill` is
// the prototype's 淨係練綁袋 (ties only, no slips).
import { takeawayStation } from './core';
import { takeawayBot } from './bot';

export const takeaway = takeawayStation({ selfFeed: true }, takeawayBot);
export const takeawayFed = takeawayStation({ selfFeed: false }, takeawayBot);
export const takeawayDrill = takeawayStation({ selfFeed: false, drill: true }, takeawayBot);
export * from './core';
export { buildPath, checkPath, famsFor, FAM, type Pt, type TiePath } from './path';
export { plan, resetBot, BOT } from './bot';
export { KNOT_TIERS, KNOT_PATTERNS, KNOT_TUNE, knotDef, knotPts, knotBand, knotSpeed, knotPar, drawKnot, newKnotBag, resetKnotBag, sessionKnots, keepKnots } from './knots';
export { knotMetrics, looksAlike, shapeDist } from './knot-metrics';
