// Measuring and storing tie paths for the knot library: the storage code, the metrics the tiers are graded on and
// a shape distance. No data here, so the generator (knots-gen.ts) can use it before the library exists.
import { at, checkPath, STEP, type PathRules, type Pt, type Rect } from './path';

/* ---------- storage: 2 base-64 characters per coordinate (1/8 px of the reference tie area), corners by index ---------- */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const KNOT_UNIT = 8;
/** Points (px, from their own top-left corner, under 512 px) as a string, plus the indexes of the sharp corners. */
export function encode(pts: readonly Pt[]): [string, number[]] {
  const c = (v: number) => { const n = Math.max(0, Math.min(4095, Math.round(v * KNOT_UNIT))); return (B64[n >> 6] ?? 'A') + (B64[n & 63] ?? 'A'); };
  return [pts.map(p => c(p[0]) + c(p[1])).join(''), pts.flatMap((p, i) => p[2] ? [i] : [])];
}
export function decode(s: string, corners: readonly number[]): Pt[] {
  const v = (i: number) => (B64.indexOf(s.charAt(i)) * 64 + B64.indexOf(s.charAt(i + 1))) / KNOT_UNIT, cs = new Set(corners), out: Pt[] = [];
  for (let i = 0; i + 3 < s.length; i += 4) out.push(cs.has(out.length) ? [v(i), v(i + 2), 1] : [v(i), v(i + 2)]);
  return out;
}

/* ---------- metrics ---------- */
// No finger rule is checked here: these rules let any path through, so checkPath only measures it.
export const OPEN: PathRules = { lv: 0, gap: 1, minSeg: 0, maxTurn: 180, minCross: 0, maxCross: 1e9, minR: 0, lenK: [0, 1e9], parSpeed: 1 };
export interface KnotMetrics { len: number; lenK: number; turn: number; crossings: number; corners: number; ends: number; score: number }
/** Path length (px, and per sqrt of R's area), total turning (laps of 360 degrees), self-crossings, sharp corners, how
 * far apart the two ends are (per sqrt of R's area: small for a ring left open, large for a coil or a line) and the
 * combined complexity score the tiers are graded on: lenK + turn + 0.4 x crossings. */
export function knotMetrics(pts: readonly Pt[], R: Rect): KnotMetrics {
  const st = checkPath(pts, OPEN, R), n = pts.length, k = Math.max(1, Math.round(9 / STEP));
  let turn = 0, prev: number | null = null;
  for (let i = k; i < n; i += k) {
    const a = at(pts, i - k), b = at(pts, i), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (prev !== null) { let d = ang - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turn += Math.abs(d); }
    prev = ang;
  }
  const lenK = st.len / Math.sqrt(R.w * R.h), laps = turn / (2 * Math.PI), e0 = at(pts, 0), e1 = at(pts, n - 1);
  return { len: st.len, lenK, turn: laps, crossings: st.crossings, corners: st.corners.length, ends: Math.hypot(e1[0] - e0[0], e1[1] - e0[1]) / Math.sqrt(R.w * R.h), score: lenK + laps + 0.4 * st.crossings };
}
/** How different two shapes look (0 = the same drawing): mean distance between 64 points spaced evenly along each,
 * after centring and scaling to unit size, the smallest over both directions (a path traced backwards looks the same),
 * its mirror image and turns in 15 degree steps (a mirrored maze or a turned spiral is the same drawing to the eye). */
export function shapeDist(a: readonly Pt[], b: readonly Pt[]): number {
  const A = norm64(a), B = norm64(b), n = A.length;
  let best = 1e9;
  for (const mx of [1, -1]) for (let k = 0; k < 24; k++) {
    const c = Math.cos(k * Math.PI / 12), s = Math.sin(k * Math.PI / 12);
    let f = 0, r = 0;
    for (let i = 0; i < n; i++) {
      const p = A[i] ?? [0, 0], qf = B[i] ?? [0, 0], qr = B[n - 1 - i] ?? [0, 0];
      f += Math.hypot(p[0] - (qf[0] * mx * c - qf[1] * s), p[1] - (qf[0] * mx * s + qf[1] * c));
      r += Math.hypot(p[0] - (qr[0] * mx * c - qr[1] * s), p[1] - (qr[0] * mx * s + qr[1] * c));
    }
    best = Math.min(best, f / n, r / n);
  }
  return best;
}
/** Two knots look alike when their outlines are close (shapeDist under minD) and they are built the same way:
 * about the same number of sharp corners and of crossings (within a quarter, at least 1), of whole turns, and ends as
 * near or far apart. A square and a pentagon have close outlines but different corners, a ring left open and a
 * one-turn coil close outlines but ends together or apart, so each pair reads as two different drawings. */
export function looksAlike(a: readonly Pt[], ma: KnotMetrics, b: readonly Pt[], mb: KnotMetrics, minD: number): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < Math.max(1, 0.25 * Math.max(x, y));
  return near(ma.corners, mb.corners) && near(ma.crossings, mb.crossings) && Math.abs(ma.turn - mb.turn) < 1 && Math.abs(ma.ends - mb.ends) < 0.25 && shapeDist(a, b) < minD;
}
function norm64(p: readonly Pt[]): Pt[] {
  const r = resampleN(p, 64), cx = r.reduce((s, q) => s + q[0], 0) / r.length, cy = r.reduce((s, q) => s + q[1], 0) / r.length;
  const sc = Math.sqrt(r.reduce((s, q) => s + (q[0] - cx) ** 2 + (q[1] - cy) ** 2, 0) / r.length) || 1;
  return r.map((q): Pt => [(q[0] - cx) / sc, (q[1] - cy) / sc]);
}
function resampleN(p: readonly Pt[], n: number): Pt[] {
  const cum = [0]; for (let i = 1; i < p.length; i++) cum.push((cum[i - 1] ?? 0) + Math.hypot(at(p, i)[0] - at(p, i - 1)[0], at(p, i)[1] - at(p, i - 1)[1]));
  const L = cum[cum.length - 1] ?? 0, out: Pt[] = []; let j = 1;
  for (let k = 0; k < n; k++) {
    const s = L * k / (n - 1); while (j < p.length - 1 && (cum[j] ?? 0) < s) j++;
    const a = at(p, j - 1), b = at(p, j), s0 = cum[j - 1] ?? 0, s1 = cum[j] ?? 0, u = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}
