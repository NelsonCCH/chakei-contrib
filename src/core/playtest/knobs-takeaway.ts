// 外賣 takeaway's own knobs for the playtest slider, against today's station code:
// - the knot: the station's knot tier (1-10, the knot library): one tier per slider step from the difficulty's
//   own tier (KNOT_TUNE.base), so 5 is today's, held at 1 and 10;
// - items per order: the people one takeaway order is for (core/referee/extras.ts packOrder), 1 today, 2 at 7-8, 3 at
//   9-10 (each person orders a drink and often a meal).
// Order rate and patience scale in core/referee/extras.ts (pace.ts gapMul / patMul 'takeaway').
import { paceOf, PACE_BASE } from './pace';

/** The knot tier for slider value `v` when today's is `base`. */
export const knotTier = (base: number, v: number = paceOf('takeaway')): number => Math.min(10, Math.max(1, base + v - PACE_BASE));
/** People one takeaway order is for (1 = today's). */
export const packPeople = (v: number = paceOf('takeaway')): number => v >= 9 ? 3 : v >= 7 ? 2 : 1;
