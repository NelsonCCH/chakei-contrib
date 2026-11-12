// The knot library: 100 fixed tie paths, 10 tiers of 10 patterns, graded by a complexity score (knot-metrics.ts).
// The paths are made once by scripts/knots-build.mjs (knots-gen.ts, from the path families in path.ts) and stored in
// knots-data.ts; here they are decoded and fitted to the phone's tie area. Levels and the 試玩 slider pick the tier, the
// session's bag holds the patterns left and the order's seed picks among them (drawKnot).
import { checkPath, fitTo, parOf, resample, STEP, type Pt, type Rect } from './path';
import { decode, OPEN } from './knot-metrics';
import { KNOT_DATA, KNOT_TUNE } from './knots-data';

export const KNOT_TIERS = 10, KNOT_PATTERNS = 10;
export { KNOT_TUNE };
export interface KnotDef { tier: number; pat: number; name: string; fam: string; pts: Pt[] }
const memo = new Map<number, KnotDef>();
/** The knot for (tier 1-10, pattern 0-9), the tier clamped and the pattern wrapped into range. */
export function knotDef(tier: number, pat: number): KnotDef {
  const t = Math.min(KNOT_TIERS, Math.max(1, Math.round(tier))), p = ((Math.round(pat) % KNOT_PATTERNS) + KNOT_PATTERNS) % KNOT_PATTERNS, key = (t - 1) * KNOT_PATTERNS + p;
  let k = memo.get(key);
  if (!k) {
    const d = KNOT_DATA[key]; if (!d) throw new Error(`knot ${t}/${p} missing`);
    k = { tier: t, pat: p, name: d[0], fam: d[1], pts: decode(d[2], d[3]) }; memo.set(key, k);
  }
  return k;
}
/**
 * The session's knot bags (so one knot, such as 川, does not come up three or four times in one session). A shift's knot is
 * drawn without replacement from a bag of its tier's ten patterns, and never from the family of the knot drawn just
 * before (also across a refill, and when the tier changes). The order's seed picks, as before: seed % 10 when that
 * knot is still in the bag and allowed, else the next allowed one after it. A bag holding only the last knot's family
 * is refilled (the knot left over waits for the new bag), and right after a refill the tier's last five knots are
 * skipped while others are left, so no knot comes back soon.
 *
 * The bag is plain JSON in the station's state (TakeState.kb), so a hand-over carries it and a run continues the same
 * on any phone. Between shifts it is carried in this module (the page that drives the seat: a session): a new run
 * starts from `sessionKnots()`, and every draw stores the bag back with `keepKnots()`. Not saved to storage, so a
 * reload starts a new session.
 */
export interface KnotBag { bags: Record<string, number[]>; recent: Record<string, number[]>; fam: string }
export const newKnotBag = (): KnotBag => ({ bags: {}, recent: {}, fam: '' });
const copyBag = (b: KnotBag): KnotBag => ({ bags: Object.fromEntries(Object.entries(b.bags).map(([k, v]) => [k, [...v]])), recent: Object.fromEntries(Object.entries(b.recent).map(([k, v]) => [k, [...v]])), fam: b.fam });
let carry = newKnotBag();
/** The session's bag as it stands, for a new run (a copy). */
export const sessionKnots = (): KnotBag => copyBag(carry);
/** Stores a run's bag as the session's (a copy). */
export function keepKnots(b: KnotBag): void { carry = copyBag(b); }
/** Starts a new session (tests). */
export function resetKnotBag(): void { carry = newKnotBag(); }
/** How many of a tier's latest knots are skipped right after a refill. */
const KNOT_RECENT = KNOT_PATTERNS / 2;
/** The next pattern (0-9) of `tier` from `b` (changed in place), picked by `seed` (an order's). */
export function drawKnot(b: KnotBag, tier: number, seed: number): number {
  const t = String(Math.min(KNOT_TIERS, Math.max(1, Math.round(tier)))), tn = Number(t);
  const fits = (p: number): boolean => knotDef(tn, p).fam !== b.fam;
  let bag = b.bags[t] ?? [];
  if (!bag.some(fits)) { bag = Array.from({ length: KNOT_PATTERNS }, (_, i) => i); b.bags[t] = bag; }
  const recent = b.recent[t] ?? [], fresh = bag.filter(p => fits(p) && !recent.includes(p)), ok = fresh.length ? fresh : bag.filter(fits);
  const want = ((Math.floor(seed) % KNOT_PATTERNS) + KNOT_PATTERNS) % KNOT_PATTERNS;
  const p = ok.find(q => q >= want) ?? ok[0] ?? 0;
  bag.splice(bag.indexOf(p), 1);
  b.fam = knotDef(tn, p).fam;
  b.recent[t] = [...recent.filter(q => q !== p), p].slice(-KNOT_RECENT);
  return p;
}/** The knot fitted (aspect kept, centred) into R and resampled every STEP px: what the player traces. */
export const knotPts = (k: KnotDef, R: Rect): Pt[] => resample(fitTo(k.pts, R), STEP);
/** The trace band (css px) and par speed (css px/s) of a tier. */
export const knotBand = (tier: number): number => KNOT_TUNE.band[Math.min(KNOT_TIERS, Math.max(1, Math.round(tier))) - 1] ?? 30;
export const knotSpeed = (tier: number): number => KNOT_TUNE.parSpeed[Math.min(KNOT_TIERS, Math.max(1, Math.round(tier))) - 1] ?? 380;
/** Par (s) for a fitted knot: a careful hand at the tier's par speed (path.ts parOf). */
export const knotPar = (pts: readonly Pt[], tier: number, R: Rect): number => parOf(checkPath(pts, OPEN, R), { ...OPEN, parSpeed: knotSpeed(tier) });
