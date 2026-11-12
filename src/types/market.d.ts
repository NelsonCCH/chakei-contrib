// Types owned by src/market.ts: ingredients, the tea-house grade, rent and branches.

interface TeaScore { parts: { deco: number; menu: number; flow: number; place: number }; total: number }
interface TeaGrade extends TeaScore { g: number; name: string; next: [number, string] | undefined }
/** A branch that earns passive income: an owned district, or a level shop with 3 stars at every station. */
interface Branch { k: string; name: string; base: number }
/** End-of-shift pay: what goes into the bank and the lines that explain it. */
interface Payout { get: number; lines: [string, string][] }

/** Fields market.ts adds to the shift state. */
interface GameState {
  /** Game time a customer last praised a signature dish (sigTip). */
  sigSaid?: number;
}
