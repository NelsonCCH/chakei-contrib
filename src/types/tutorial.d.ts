// Types owned by src/tutorial.ts (global, type-only).

/** How the tutorial expects one slip line: a food (t 'f') or a drink (t 'k'). */
type WantLine = { t: 'f'; id: string } | { t: 'k'; d: string; cold: boolean; sweet: number; noice: boolean };
/** A line of the waiter's slip as the tutorial reads it (waiter.js owns the slip; G's draft is untyped until then). */
interface SlipLineView { t: unknown; cold?: unknown; sweet?: unknown; noice?: unknown }
interface Shop {
  /**
   * Stations whose training is done (true, or 1 in the taste saves). tutorial.ts sets it at load, but gates.ts runs
   * before that (script order), so it may still be missing there.
   */
  tutDone?: Record<string, boolean | number>;
  skipTut?: boolean;
}
interface GameState { tutNext?: number; tutAt?: number }
