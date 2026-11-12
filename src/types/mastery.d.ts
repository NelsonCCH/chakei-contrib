// Types owned by src/mastery.ts (global, type-only).

/** One station's record: correct actions, shifts, best revenue, longest combo, three-star shifts. */
interface MasteryRec { n: number; shifts: number; rev: number; combo: number; three: number }
interface Shop {
  /** Per station. mastery.ts sets it at load; decor.ts creates SHOP before that, so it is optional. */
  mastery?: Record<string, MasteryRec>;
}
interface GameState { mastered?: boolean }
