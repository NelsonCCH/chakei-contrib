// Small helpers shared by the shop's rules and the page.

/** Unwraps a value the JS assumed is present. Throws where the JS would have thrown on it anyway. */
export function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new TypeError(`chakei: missing ${what}`);
  return v;
}
/** True when `k` is one of the object's own keys (the JS checked `OBJ[k]` is truthy; every value is an object). */
export const ownKey = <K extends string>(o: Partial<Record<K, unknown>>, k: string | null): k is K => k !== null && Object.prototype.hasOwnProperty.call(o, k);
/** Money as the player reads it: whole dollars. Core keeps dollars as floats and the takeaway tips
 *  book 10 cents, so a sum can carry float noise (377.0999999999997); every takings, tips, savings or till display goes
 *  through this. `-0` reads $0. */
export const cash = (n: number): string => `$${String(Math.round(n) || 0)}`;
/** Money where cents matter (a takeaway tip, booked to 10 cents): always two decimals, $16.10. */
export const cashCents = (n: number): string => `$${(Math.round(n * 100) / 100 || 0).toFixed(2)}`;
