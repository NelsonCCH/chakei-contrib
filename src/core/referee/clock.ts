// The shift's clock: the rules always advance in fixed steps of STEP seconds, however
// long a frame took. A frame's real time goes into an accumulator and whole steps come out, so a slow phone and a fast
// one play the same shift step for step, and a long pause (a stalled frame, a tab in the background) is caught up in
// bounded, equal pieces instead of one big jump. The caller (ui/main.ts loop, net/net.ts hostTick) says what one step is.

/** One step of the shop, in seconds. */
export const STEP = 1 / 60;
/** At most this much real time per frame is played (a longer stall loses the rest, as the old 0.1 s frame cap did). */
export const MAX_FRAME = .25;

let acc = 0;
/** Starts a fresh clock (a new shift): no time left over from before. */
export function resetClock(): void { acc = 0; }
/** The real time not yet played (less than one STEP between calls). */
export const clockLeft = (): number => acc;
/**
 * Plays `dt` real seconds (at most `max`) as whole steps: calls step(STEP) for each, stopping early when `go()` turns
 * false (the shift ended). The remainder waits for the next call. Returns the number of steps played.
 */
export function advance(dt: number, step: (h: number) => void, go: () => boolean = () => true, max: number = MAX_FRAME): number {
  acc += Math.min(max, Math.max(0, dt));
  let n = 0;
  while (acc >= STEP && go()){ acc -= STEP; step(STEP); n++; }
  if (!go()) acc = 0;
  return n;
}
