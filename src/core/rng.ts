// Randomness for the shop's rules. core/ never calls Math.random: every draw comes
// from an Rng, a function returning a number in [0, 1) like Math.random. The shop draws from `rng`, the injected stream:
// the page seeds it once from Math.random (src/ui/wire.ts), a test or simulation seeds it explicitly (setRng(mulberry32(n))).
// A draw that the daily challenge must make the same for everyone takes the shift's daily stream instead (G.drng), passed
// down as the `r` argument (makeGroup, spawnGap). Every function that draws takes `r` last, defaulting to `rng`.
import { must } from './util';

/** A source of numbers in [0, 1), drawn one after another (Math.random's shape). */
export type Rng = () => number;

/** mulberry32: a small, fast, seedable PRNG with a 2^32 period. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * mulberry32 whose state is plain data (the shift state is plain JSON, so a stream kept in `G`, the daily
 * challenge's G.drng, survives a keyframe or a hand-over). drawState(st) is one draw of mulberry32(st.a) and advances st.
 */
export function drawState(st: RngState): number {
  st.a = (st.a + 0x6D2B79F5) >>> 0;
  let t = st.a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** An Rng drawing from (and advancing) a data stream. */
export const streamOf = (st: RngState): Rng => () => drawState(st);
/** A 32-bit seed from a string (FNV-1a): the daily challenge seeds G.drng from the date. */
export function hashSeed(str: string): number { let h = 2166136261; for (const c of str){ h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/** The stream the shop draws from. Until the page (or a test) injects one, a fixed seed: deterministic, never Math.random. */
export let rng: Rng = mulberry32(1);
export function setRng(v: Rng): void { rng = v; }
export const rnd = (a: number, b: number, r: Rng = rng): number => a + r()*(b-a);
/** undefined only for an empty list, as in the JS (other scripts call it too). */
export const pick = <T>(a: readonly T[], r: Rng = rng): T | undefined => a[Math.floor(r()*a.length)];
/** pick() for lists that are never empty. */
export const pickSure = <T>(a: readonly T[], r: Rng = rng): T => must(pick(a, r), 'pick from an empty list');
