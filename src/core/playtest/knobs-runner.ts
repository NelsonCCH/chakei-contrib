// 傳菜 runner's own knob for the playtest slider: the floor plan's tier (maze size, loops, dining rooms and walking
// customers, puddles, pocket size, damage; stations-next/runner/maze.ts TUNE.diff). Today's tier (the level's) is
// kept at 5-6; each two steps of the slider move one tier, held at 第一日 and 阿姐. The dish rate is the shop's customer
// flow (pace.ts flowStation: the runner's slider when the player sits at the runner).
import type { Floor } from '../../stations-next/runner/maze';
import { shiftTier, paceOf } from './pace';

export const RUNNER_FLOORS: readonly Floor[] = ['first', 'rookie', 'pro', 'ace'];
/** The floor tier for slider value `v` when today's is `base`. */
export const runnerFloor = (base: Floor, v: number = paceOf('runner')): Floor => shiftTier(RUNNER_FLOORS, base, v);
