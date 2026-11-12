// 燒味 roast's own knob for the playtest slider (the cutting game). Today's cutting tier (the level's, or
// the difficulty's; stations-next/roast/core.ts TUNE.cut: pieces, snap, guides) stays; each step of the slider away from
// 5 moves the two things that make 斬料 harder: the cut count (one piece more or less per roast of a new order, kept in
// 2..TUNE.cut.maxPieces) and the guide precision (the snap distance / 1.15 per step up, x 1.15 per step down, so at 10 a
// cut must land about half as close to the guide as at 5; never more than half a piece). The meat type is the order's:
// bone-in roasts splinter off a joint, 叉燒 is traced. 5 is exactly today's setting. Orders already queued keep their
// piece counts; the snap changes at once. The 斬料 walk-ins' arrival gap and patience scale in core/referee/extras.ts
// (pace.ts gapMul / patMul 'roast'): in the shop the referee sends the customers.
import type { CutKnob } from '../../stations-next/roast/core';
import { PACE_BASE, paceOf } from './pace';

export const ROAST_SNAP_STEP = 1.15;
/** The cut knob for slider value `v` (5: today's, nothing changes). */
export const roastKnob = (v: number = paceOf('roast')): CutKnob => ({ pcs: Math.round(v) - PACE_BASE, snap: Math.pow(ROAST_SNAP_STEP, PACE_BASE - Math.round(v)) });
