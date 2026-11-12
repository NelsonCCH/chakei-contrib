// Makes the knot library, run by scripts/knots-build.mjs, never by the game. Draws a large
// pool of candidate strokes from the parametric one-stroke families in knots-shapes.ts (circles and loops, spirals,
// polygons and stars, figure-eight chains, zigzags, waves, nested rings, rosettes, hearts, tornadoes, doodles, cursive
// words, brush characters, thread ends, magic circles and two shapes joined) under six
// sets of finger rules (from easier than 新人 to 阿姐's), measures each one exactly as the game will draw it (stored,
// decoded, fitted to the reference tie area and resampled), then fills 10 tiers by complexity score. Tier t takes
// candidates whose score is nearest the tier's target, from rule sets whose stroke spacing is fair for the tier's trace
// band: first the nearest of each family (rarest families first), then the nearest of the rest, at most two of a
// family, each one visibly different from every knot of the tier. Today's three difficulties (the old generator in
// path.ts) are measured the same way and play at the tier nearest their median score.
import { at, buildPath, checkPath, fitTo, hashStr, mulberry, resample, STEP, type PathRules, type Pt, type Rect } from './path';
import { encode, decode, knotMetrics, looksAlike, shapeDist, type KnotMetrics } from './knot-metrics';
import { SHAPES, type Box } from './knots-shapes';
import { TUNE, layout, tieRect } from './core';
import type { Difficulty } from '../contract';

/** The reference tie area: a 390 x 844 phone (scene 130 x 260 logical px at scale 3). */
export const REF_R: Rect = tieRect(layout(130, 260), 3);
// seeds: candidates per family and rule set; minDist: smallest shapeDist between two knots of a tier (famDist: of the
// same family; anyDist: any two in the library); perFam: most knots of one family in a tier; minFams: fewest families
// in a tier; minTiers: fewest tiers each family must appear in; rdp: storage simplification (px); gapK: a tier takes
// rule sets whose stroke gap is at least band x gapK; lo / hi: tier 1's and tier 10's target score (on a fixed scale,
// so the difficulties keep their tiers); band / speed: clamps (css px, css px/s).
const GEN = { seeds: 300, minDist: 0.22, famDist: 0.35, anyDist: 0.1, perFam: 2, minFams: 7, minTiers: 3, rdp: 0.12, gapK: 1.08, lo: 3.70, hi: 13.47, band: [24, 38], speed: [240, 520] } as const;

const r = TUNE.diff.rookie, p = TUNE.diff.pro, a = TUNE.diff.ace;
const mix = (x: PathRules, y: PathRules, lv: number): PathRules => ({ lv, gap: (x.gap + y.gap) / 2, minSeg: (x.minSeg + y.minSeg) / 2, maxTurn: (x.maxTurn + y.maxTurn) / 2,
  minCross: (x.minCross + y.minCross) / 2, maxCross: Math.round((x.maxCross + y.maxCross) / 2), minR: (x.minR + y.minR) / 2, lenK: [(x.lenK[0] + y.lenK[0]) / 2, (x.lenK[1] + y.lenK[1]) / 2], parSpeed: (x.parSpeed + y.parSpeed) / 2 });
// The finger rules only: length and crossing count are what the tiers grade, so they are left open here.
const open = (d: PathRules): PathRules => ({ ...d, maxCross: 80, lenK: [0.5, 20] });
export const RULES: readonly PathRules[] = [
  { ...r, gap: 46, minR: 40, maxTurn: 115 }, { ...r }, mix(r, p, 1), { ...p }, mix(p, a, 2), { ...a },
].map(open);

/** Piecewise linear through the three difficulties' (tier, value), extrapolated past them with the end slopes. */
function through(at3: Readonly<Record<Difficulty, number>>, v: Readonly<Record<Difficulty, number>>): (t: number) => number {
  const P: [number, number][] = [[at3.rookie, v.rookie], [at3.pro, v.pro], [at3.ace, v.ace]];
  return t => { const i = t <= at3.pro ? 0 : 1, A = P[i] ?? [0, 0], B = P[i + 1] ?? [1, 0]; return A[1] + (B[1] - A[1]) * (t - A[0]) / (B[0] - A[0]); };
}
// Douglas-Peucker, never dropping a marked corner or an end
function rdp(pts: readonly Pt[], eps: number): Pt[] {
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1; pts.forEach((q, i) => { if (q[2]) keep[i] = 1; });
  const run = (i: number, j: number) => {
    const A = at(pts, i), B = at(pts, j), L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1; let best = -1, bd = eps;
    for (let k = i + 1; k < j; k++) { const q = at(pts, k), d = Math.abs((B[0] - A[0]) * (A[1] - q[1]) - (A[0] - q[0]) * (B[1] - A[1])) / L; if (d > bd) { bd = d; best = k; } }
    if (best > 0) { keep[best] = 1; run(i, best); run(best, j); }
  };
  const marks = pts.flatMap((_, i) => keep[i] ? [i] : []);
  for (let k = 1; k < marks.length; k++) run(marks[k - 1] ?? 0, marks[k] ?? 0);
  return pts.filter((_, i) => keep[i]);
}
/** A path as the library stores it and as the game then draws it in the reference area. */
function roundTrip(pts: readonly Pt[]): { data: [string, number[]]; pts: Pt[] } {
  const s = rdp(pts, GEN.rdp); let x0 = 1e9, y0 = 1e9; for (const q of s) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); }
  const data = encode(s.map((q): Pt => q[2] ? [q[0] - x0, q[1] - y0, 1] : [q[0] - x0, q[1] - y0]));
  return { data, pts: resample(fitTo(decode(data[0], data[1]), REF_R), STEP) };
}
const median = (v: number[]) => { const s = v.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const scaleIn = (q: readonly Pt[]) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const v of q) { x0 = Math.min(x0, v[0]); y0 = Math.min(y0, v[1]); x1 = Math.max(x1, v[0]); y1 = Math.max(y1, v[1]); } return Math.min(REF_R.w / Math.max(1e-6, x1 - x0), REF_R.h / Math.max(1e-6, y1 - y0)); };
/** A drawn shape mirrored, reversed and turned at random (up to rot degrees), then a quarter turn more when that lets
 * it fill the tie area better (an upright shape is never mirrored or turned a quarter); the two ends are never corners. */
function place(raw: readonly Pt[], rng: () => number, rot: number, upright = false): Pt[] {
  const mk = (x: number, y: number, c: number | undefined): Pt => c ? [x, y, 1] : [x, y];
  let q = raw.map(v => mk(v[0], v[1], v[2]));
  if (rng() < 0.5 && !upright) q = q.map(v => mk(-v[0], v[1], v[2]));
  if (rng() < 0.5) q = q.reverse();
  const an = (rng() * 2 - 1) * rot * Math.PI / 180, ca = Math.cos(an), sa = Math.sin(an);
  q = q.map(v => mk(v[0] * ca - v[1] * sa, v[0] * sa + v[1] * ca, v[2]));
  const turned = q.map(v => mk(-v[1], v[0], v[2])); if (!upright && scaleIn(turned) > scaleIn(q) * 1.02) q = turned;
  const f = at(q, 0), l = at(q, q.length - 1); q[0] = [f[0], f[1]]; q[q.length - 1] = [l[0], l[1]];
  return q;
}

export const WHY: Record<string, number> = {};
export interface Cand { name: string; fam: string; ri: number; gap: number; data: [string, number[]]; pts: Pt[]; m: KnotMetrics; score: number }
export interface Library { data: [string, string, string, number[]][]; tune: { base: Record<Difficulty, number>; band: number[]; parSpeed: number[] }; report: string[] }
export function buildLibrary(log: (s: string) => void = () => { /* quiet */ }): Library {
  // the pool
  const pool: Cand[] = [], fams = Object.keys(SHAPES);
  for (const f of fams) {
    const F = SHAPES[f]; if (!F) continue;
    RULES.forEach((d, ri) => {
      const box: Box = { W: REF_R.w, H: REF_R.h, G: d.gap, minR: d.minR, minSeg: d.minSeg, maxTurn: d.maxTurn, minCross: d.minCross };
      const n = GEN.seeds * (F.tries ?? 1);
      for (let seed = 0; seed < n; seed++) {
        const rng = mulberry(hashStr(f) ^ (seed * 7919 + ri * 104723 + 1)), k = (seed + rng()) / n;
        const sh = F.gen(rng, box, k); if (!sh || sh.pts.length < 3) { WHY[`${f} none`] = (WHY[`${f} none`] ?? 0) + 1; continue; }
        const pts = resample(fitTo(place(sh.pts, rng, F.rot, F.upright), REF_R), STEP), why = checkPath(pts, d, REF_R).why;
        if (why) { WHY[`${f} ${why}`] = (WHY[`${f} ${why}`] ?? 0) + 1; continue; }
        // the stored copy is checked again: it must keep every finger rule of its set (simplifying can tighten a curve)
        const rt = roundTrip(pts), why2 = checkPath(rt.pts, d, REF_R).why; if (why2) { WHY[`${f} stored ${why2}`] = (WHY[`${f} stored ${why2}`] ?? 0) + 1; continue; }
        const m = knotMetrics(rt.pts, REF_R);
        pool.push({ name: sh.label, fam: f, ri, gap: d.gap, data: rt.data, pts: rt.pts, m, score: m.score });
      }
    });
  }
  const pct = (v: number[], q: number) => { const s = v.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) * q)] ?? 0; };
  log(`dropped: ${JSON.stringify(WHY)}`);
  log(`pool ${pool.length}: ${fams.map(f => { const s = pool.filter(c => c.fam === f).map(c => c.score); return `${f} ${s.length} [${pct(s, 0.05).toFixed(1)}-${pct(s, 0.95).toFixed(1)}]`; }).join('; ')}`);
  // tier targets: a geometric scale, each tier about a seventh more complex than the one before
  const tiers = Array.from({ length: 10 }, (_, i) => i + 1), tgt = tiers.map(t => GEN.lo * Math.pow(GEN.hi / GEN.lo, (t - 1) / 9));
  // today's three difficulties, measured as the game drew them, play at the tier nearest their median score
  const base: Record<Difficulty, number> = { rookie: 0, pro: 0, ace: 0 };
  for (const d of ['rookie', 'pro', 'ace'] as const) {
    const m = median(Array.from({ length: 60 }, (_, i) => knotMetrics(roundTrip(buildPath(TUNE.diff[d], r, i * 7919 + 13, REF_R).pts).pts, REF_R).score));
    base[d] = tiers.reduce((b, t) => Math.abs((tgt[t - 1] ?? 0) - m) < Math.abs((tgt[b - 1] ?? 0) - m) ? t : b, 1);
    log(`today's ${d}: median score ${m.toFixed(2)} -> tier ${base[d]}`);
  }
  if (!(base.rookie < base.pro && base.pro < base.ace)) throw new Error(`today's difficulties map to tiers ${JSON.stringify(base)}: not three steps`);
  // trace band and par speed: today's values at those tiers, linear between, extrapolated past them, clamped
  const band = through(base, { rookie: r.band, pro: p.band, ace: a.band }), speed = through(base, { rookie: r.parSpeed, pro: p.parSpeed, ace: a.parSpeed });
  const bands = tiers.map(t => Math.round(Math.min(GEN.band[1], Math.max(GEN.band[0], band(t))))), speeds = tiers.map(t => Math.round(Math.min(GEN.speed[1], Math.max(GEN.speed[0], speed(t))) / 10) * 10);
  log(`targets ${tgt.map(v => v.toFixed(2)).join(' ')}; bands ${bands.join(' ')}; par speeds ${speeds.join(' ')}`);
  // tier edges halfway between neighbouring targets: the tiers cannot overlap on the score
  const edge = (t: number) => t <= 0 ? -1e9 : t >= 10 ? 1e9 : ((tgt[t - 1] ?? 0) + (tgt[t] ?? 0)) / 2;
  const chosen: Cand[][] = [], all: Cand[] = [], report: string[] = [], used: Record<string, number> = {};
  for (const t of tiers) {
    const lo = edge(t - 1), hi = edge(t), bandT = bands[t - 1] ?? 30, want = tgt[t - 1] ?? 0;
    const ok = pool.filter(c => c.score >= lo && c.score < hi && c.gap >= bandT * GEN.gapK).sort((x, y) => Math.abs(x.score - want) - Math.abs(y.score - want));
    // two of one name (two 8字) must differ in outline alone; otherwise the build (corners, crossings, turns, ends) may
    // tell them apart
    const alike = (q: Cand, c: Cand) => q.fam === c.fam && q.name === c.name ? shapeDist(q.pts, c.pts) < GEN.famDist : looksAlike(q.pts, q.m, c.pts, c.m, q.fam === c.fam ? GEN.famDist : GEN.minDist);
    const pick: Cand[] = [];
    const fits = (c: Cand, cap: number, newName: boolean) => !pick.includes(c) && pick.filter(q => q.fam === c.fam).length < cap && !(newName && pick.some(q => q.name === c.name))
      && !pick.some(q => alike(q, c)) && !all.some(q => shapeDist(q.pts, c.pts) < GEN.anyDist);
    // one of each family first, the families seen in the fewest tiers so far leading (then the scarcest here); then the
    // nearest of the rest, a new name first, at most perFam of a family (one more as a last resort)
    const nOk = (f: string) => ok.filter(q => q.fam === f).length;
    for (const f of fams.slice().sort((x, y) => (used[x] ?? 0) - (used[y] ?? 0) || nOk(x) - nOk(y))) { const c = ok.find(q => q.fam === f && fits(q, 1, true)); if (c && pick.length < 10) pick.push(c); }
    for (const [cap, newName] of [[GEN.perFam, true], [GEN.perFam, false], [GEN.perFam + 1, true], [GEN.perFam + 1, false]] as const) for (const c of ok) { if (pick.length >= 10) break; if (fits(c, cap, newName)) pick.push(c); }
    const fs = new Set(pick.map(c => c.fam));
    const line = `tier ${t}: score [${lo.toFixed(2)}, ${hi.toFixed(2)}) target ${want.toFixed(2)} band ${bandT}: ${ok.length} fit, picked ${pick.length}, ${fs.size} families (${pick.map(c => `${c.fam}:${c.name}`).join(" ")})`;
    log(line); report.push(line);
    log(`  fit by family: ${fams.map(f => `${f} ${ok.filter(c => c.fam === f).length}`).join(', ')}`);
    if (pick.length < 10) throw new Error(`tier ${t} has only ${pick.length} distinct knots`);
    if (fs.size < GEN.minFams) throw new Error(`tier ${t} has only ${fs.size} families`);
    for (const f of fs) used[f] = (used[f] ?? 0) + 1;
    pick.sort((x, y) => x.score - y.score); chosen.push(pick); all.push(...pick);
  }
  const line = `tiers per family: ${fams.map(f => `${f} ${used[f] ?? 0}`).join(', ')}`; log(line); report.push(line);
  const rare = fams.filter(f => (used[f] ?? 0) < GEN.minTiers); if (rare.length) throw new Error(`families in fewer than ${GEN.minTiers} tiers: ${rare.join(' ')}`);
  return { data: chosen.flat().map(c => [c.name, c.fam, c.data[0], c.data[1]]), tune: { base, band: bands, parSpeed: speeds }, report };
}
