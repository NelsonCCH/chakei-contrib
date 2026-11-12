// The game's music steps back while anyone talks on the walkie-talkie, own turn or a teammate's,
// and comes back a moment after. Gain ramps only, never a jump. Pure: the caller passes the gain's AudioParam and the
// context's clock. No imports, so Node can load it for the unit test and the sound layer (src/ui/juice.ts) can use it.

/**
 * depth: the music's gain while a voice plays, as a share of its full gain (0.25 = -12 dB). down: the fade under a
 * voice (s). hold: how long the music stays down after the voice ends (s), so the other phone's last words (jitter
 * buffer, ~0.12-0.6 s behind) and a quick reply stay clear. up: the fade back (s).
 */
export const DUCK = { depth: 0.25, down: 0.12, hold: 0.55, up: 0.4 } as const;

/** The part of AudioParam the duck uses (a fake one in the unit test). */
export interface RampParam {
  readonly value: number;
  cancelScheduledValues(t: number): unknown;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
}

/**
 * Schedules the music gain `g` for a voice starting (`on`) or ending at context time `now`; `full` is the music's
 * normal gain. Starts from the value the gain has now, so a voice that starts again inside the hold or the fade back
 * turns the ramp round where it is, with no step.
 */
export function duckRamp(g: RampParam, now: number, on: boolean, full: number): void {
  const v = g.value;
  g.cancelScheduledValues(now);
  g.setValueAtTime(v, now);
  if (on) { g.linearRampToValueAtTime(full * DUCK.depth, now + DUCK.down); return; }
  g.setValueAtTime(v, now + DUCK.hold);
  g.linearRampToValueAtTime(full, now + DUCK.hold + DUCK.up);
}
