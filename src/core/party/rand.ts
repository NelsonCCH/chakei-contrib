// The night's own random stream (party mode): which metrics are dealt and which 搏盡 twist comes.
// The state is a plain number inside NightState, so the night stays JSON data: a referee can save it, send it to a new
// host or replay it, and the same seed always deals the same night. Same generator as core/rng.ts mulberry32.

/** One draw: the number in [0, 1) and the stream's next state. */
export function partyDraw(state: number): { x: number; next: number } {
  const next = (state + 0x6D2B79F5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { x: ((t ^ (t >>> 14)) >>> 0) / 4294967296, next };
}
