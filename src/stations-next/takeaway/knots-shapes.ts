// Parametric one-stroke shapes for the knot library, used only by knots-gen.ts. In the spirit of 一筆畫 puzzles
// with the answer drawn: circles and loops, spirals in and out, polygons and star polygons, figure-eight chains and
// Lissajous knots, zigzags and saw teeth, waves, nested rings and rosettes, and two of them joined into one stroke;
// plus hearts, chains of hearts, tornadoes, doodles, cursive words, brush characters, tangled thread ends and
// magic circles.
// Each family draws one continuous stroke in css px for a box c.W x c.H, sized so its strokes keep c.G apart, its
// curves no tighter than c.minR and its corners no sharper than c.maxTurn; `k` (0..1) is the complexity knob (more
// loops, turns, rows, points or rings). The generator then fits, measures and checks every candidate (path.ts
// checkPath) and grades it, so a family only has to aim near the rules, not prove them.
import { at, crSpline, FAM, resample, type Pt } from './path';

export type R01 = () => number;
export interface Box { W: number; H: number; G: number; minR: number; minSeg: number; maxTurn: number; minCross: number }
export interface Shape { pts: Pt[]; label: string }
/** rot: the largest random turn (deg) the generator may give the shape (180 = any); upright: never turned a quarter to
 * fit the tie area better (a word, a character, a heart or a tornado reads the right way up); tries: how many times
 * the usual number of seeds to draw (default 1), for a family whose drawings often break a finger rule. */
export interface ShapeFam { name: string; rot: number; upright?: boolean; tries?: number; gen: (rng: R01, c: Box, k: number) => Shape | null }

const TAU = Math.PI * 2, deg = Math.PI / 180;
const C = (x: number, y: number): Pt => [x, y, 1];
const P = (x: number, y: number): Pt => [x, y];
const lastOf = (a: readonly Pt[]) => at(a, a.length - 1);
const mod = (x: number, m: number) => ((x % m) + m) % m;
const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
const rnd = (rng: R01) => ({
  r: (a: number, b: number) => a + rng() * (b - a),
  i: (a: number, b: number) => a + Math.floor(rng() * (b - a + 1)),
  p: <T>(a: readonly T[]): T => { const v = a[Math.floor(rng() * a.length)] ?? a[0]; if (v === undefined) throw new Error('empty'); return v; },
});
function curve(f: (t: number) => Pt, a: number, b: number, n: number): Pt[] { const o: Pt[] = []; for (let k = 0; k <= n; k++) o.push(f(a + (b - a) * k / n)); return o; }
const unit = (x: number, y: number): [number, number] => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const tanEnd = (p: readonly Pt[]) => { const a = at(p, Math.max(0, p.length - 4)), b = lastOf(p); return unit(b[0] - a[0], b[1] - a[1]); };
const tanStart = (p: readonly Pt[]) => { const a = at(p, 0), b = at(p, Math.min(p.length - 1, 3)); return unit(b[0] - a[0], b[1] - a[1]); };
const plain = (p: readonly Pt[]): Pt[] => p.map((q): Pt => [q[0], q[1]]);
const flags = (p: readonly Pt[]): Pt[] => p.map((q): Pt => q[2] ? [q[0], q[1], 1] : [q[0], q[1]]);
/** A smooth bridge (cubic Bezier) from a, leaving along ta, to b, arriving along tb; a itself left out. */
function join(a: Pt, ta: readonly [number, number], b: Pt, tb: readonly [number, number], k = 0.45): Pt[] {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), c1 = [a[0] + ta[0] * d * k, a[1] + ta[1] * d * k], c2 = [b[0] - tb[0] * d * k, b[1] - tb[1] * d * k], o: Pt[] = [], n = Math.max(8, Math.ceil(d / 5));
  for (let s = 1; s <= n; s++) {
    const t = s / n, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    o.push([w0 * a[0] + w1 * (c1[0] ?? 0) + w2 * (c2[0] ?? 0) + w3 * b[0], w0 * a[1] + w1 * (c1[1] ?? 0) + w2 * (c2[1] ?? 0) + w3 * b[1]]);
  }
  return o;
}
/** The shortest bridge from a (leaving along ta) to b (arriving along tb) that never curves tighter than rho: an arc, a
 * straight and an arc (a Dubins path); a itself left out. A brush's travel between two strokes, however they face.
 * With zig, a join that bends one way then the other (a Z, as 行書 links strokes) wins over a loop unless it is twice
 * as long. */
function bridge(a: Pt, ta: readonly [number, number], b: Pt, tb: readonly [number, number], rho: number, zig = false): Pt[] {
  const th0 = Math.atan2(ta[1], ta[0]), th1 = Math.atan2(tb[1], tb[0]);
  let best: { len: number; pts: () => Pt[] } | null = null;
  for (const s0 of [1, -1]) for (const s1 of [1, -1]) {
    // circle centres: on side s of the heading (moving round a centre in direction s, angle phi = heading - s pi/2)
    const f0 = th0 - s0 * Math.PI / 2, f1e = th1 - s1 * Math.PI / 2, c0 = [a[0] - rho * Math.cos(f0), a[1] - rho * Math.sin(f0)], c1 = [b[0] - rho * Math.cos(f1e), b[1] - rho * Math.sin(f1e)];
    const dx = (c1[0] ?? 0) - (c0[0] ?? 0), dy = (c1[1] ?? 0) - (c0[1] ?? 0), D = Math.hypot(dx, dy), del = Math.atan2(dy, dx);
    let psi: number;
    if (s0 === s1) psi = del; else { if (D < 2 * rho) continue; psi = del + Math.asin(2 * rho * s0 / D); }
    const p0 = psi - s0 * Math.PI / 2, p1 = psi - s1 * Math.PI / 2, sw0 = s0 * mod(s0 * (p0 - f0), TAU), sw1 = s1 * mod(s1 * (f1e - p1), TAU);
    const t0: Pt = [(c0[0] ?? 0) + rho * Math.cos(p0), (c0[1] ?? 0) + rho * Math.sin(p0)], t1: Pt = [(c1[0] ?? 0) + rho * Math.cos(p1), (c1[1] ?? 0) + rho * Math.sin(p1)];
    const L = Math.hypot(t1[0] - t0[0], t1[1] - t0[1]), len = (rho * (Math.abs(sw0) + Math.abs(sw1)) + L) * (zig && s0 === s1 ? 2 : 1);
    if (best && best.len <= len) continue;
    best = { len, pts: () => {
      const arc = (c: number[], f: number, sw: number) => curve(t => P((c[0] ?? 0) + rho * Math.cos(t), (c[1] ?? 0) + rho * Math.sin(t)), f, f + sw, Math.max(2, Math.ceil(Math.abs(sw) / (4 * deg)))).slice(1);
      const n = Math.max(1, Math.ceil(L / 5)), line = Array.from({ length: n }, (_, i): Pt => [t0[0] + (t1[0] - t0[0]) * (i + 1) / n, t0[1] + (t1[1] - t0[1]) * (i + 1) / n]);
      const o = [...arc(c0, f0, sw0), ...line.slice(0, -1), ...arc(c1, p1, sw1)]; o[o.length - 1] = [b[0], b[1]]; return o;
    } };
  }
  return best ? best.pts() : join(a, ta, b, tb);
}
/** p resampled every 4 px and blurred `passes` times along its length (ends kept): rounds a pen's pointed turns (too
 * many passes would shrink its small loops instead). */
function soften(p: readonly Pt[], passes: number): Pt[] {
  let q = resample(p, 4).map((v): Pt => [v[0], v[1]]);
  for (let s = 0; s < passes; s++) q = q.map((v, i): Pt => i === 0 || i === q.length - 1 ? v : [(at(q, i - 1)[0] + 2 * v[0] + at(q, i + 1)[0]) / 4, (at(q, i - 1)[1] + 2 * v[1] + at(q, i + 1)[1]) / 4]);
  return q;
}
/** p with d px of arc cut from each end. */
function trim(p: readonly Pt[], d: number): Pt[] | null {
  const cum = [0]; for (let i = 1; i < p.length; i++) cum.push((cum[i - 1] ?? 0) + Math.hypot(at(p, i)[0] - at(p, i - 1)[0], at(p, i)[1] - at(p, i - 1)[1]));
  const L = cum[cum.length - 1] ?? 0; if (L < 4 * d) return null;
  const pt = (s: number): Pt => {
    let j = 1; while (j < p.length - 1 && (cum[j] ?? 0) < s) j++;
    const a = at(p, j - 1), b = at(p, j), s0 = cum[j - 1] ?? 0, s1 = cum[j] ?? 0, u = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
  const out: Pt[] = [pt(d)];
  for (let i = 0; i < p.length; i++) { const s = cum[i] ?? 0; if (s > d + 1 && s < L - d - 1) out.push(at(p, i)); }
  out.push(pt(L - d));
  return out;
}
/** A closed curve (first point = last) opened into one stroke: cut where no other stroke runs near (and not at a
 * corner), leaving a gap of about 1.5 G, so the start and the end sit apart and clear of the rest. */
export function openRing(closed: readonly Pt[], G: number, rng: R01): Pt[] | null {
  const p = resample(closed, 3); if (p.length < 12) return null;
  const c0 = at(closed, 0); if (c0[2]) p[0] = C(c0[0], c0[1]);   // resample never marks its first point
  const f = at(p, 0), l = lastOf(p), q = Math.hypot(f[0] - l[0], f[1] - l[1]) < 2 ? p.slice(0, -1) : p.slice();
  const n = q.length, cum = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) { const a = at(q, i - 1), b = at(q, i % n); cum[i] = (cum[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const L = cum[n] ?? 0, cs = q.flatMap((v, i) => v[2] ? [i] : []);
  const arc = (i: number, j: number) => { const d = Math.abs((cum[i] ?? 0) - (cum[j] ?? 0)); return Math.min(d, L - d); };
  const ok: number[] = [];
  for (let i = 0; i < n; i += 3) {
    if (cs.some(j => arc(i, j) < G * 1.2)) continue;
    const a = at(q, i); let clear = 1e9;
    for (let j = 0; j < n && clear >= 1.7 * G; j += 2) { if (arc(i, j) < 2.5 * G) continue; const b = at(q, j); clear = Math.min(clear, Math.hypot(b[0] - a[0], b[1] - a[1])); }
    if (clear >= 1.7 * G) ok.push(i);
  }
  if (!ok.length) return null;
  const i0 = ok[Math.floor(rng() * ok.length)] ?? 0, ring = [...q.slice(i0), ...q.slice(0, i0), at(q, i0)];
  for (let g = 1.5 * G; g < 4 * G; g += 0.2 * G) {
    const out = trim(ring, g / 2); if (!out) return null;
    const a = at(out, 0), b = lastOf(out);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= 1.3 * G) { out[0] = [a[0], a[1]]; out[out.length - 1] = [b[0], b[1]]; return out; }
  }
  return null;
}
// a half circle at the end of a row, from (x, y) to (x, y + 2R), bulging out to side `out` (+1 right, -1 left)
const uTurn = (x: number, y: number, R: number, out: number): Pt[] => { const o: Pt[] = []; for (let s = 1; s < 18; s++) { const a = -Math.PI / 2 + Math.PI * s / 18; o.push([x + out * R * Math.cos(a), y + R + R * Math.sin(a)]); } return o; };
/** Loops strung along a base polyline: each loop (radius b, moving on a along the base) starts at arc length s on side
 * sg (+1 / -1 of the base's direction). A loop that moves on about 1.5 b or more while it turns crosses itself at a
 * clear angle (the 彈簧 rule in path.ts). */
function along(base: readonly Pt[], loops: readonly (readonly [number, number])[], a: number, b: number): Pt[] {
  const cum = [0]; for (let i = 1; i < base.length; i++) cum.push((cum[i - 1] ?? 0) + Math.hypot(at(base, i)[0] - at(base, i - 1)[0], at(base, i)[1] - at(base, i - 1)[1]));
  const L = cum[cum.length - 1] ?? 0;
  const pos = (s: number) => {
    let j = 1; while (j < base.length - 1 && (cum[j] ?? 0) < s) j++;
    const p0 = at(base, j - 1), p1 = at(base, j), s0 = cum[j - 1] ?? 0, s1 = cum[j] ?? 0, u = s1 > s0 ? (s - s0) / (s1 - s0) : 0, [tx, ty] = unit(p1[0] - p0[0], p1[1] - p0[1]);
    return { x: p0[0] + (p1[0] - p0[0]) * u, y: p0[1] + (p1[1] - p0[1]) * u, tx, ty };
  };
  const o: Pt[] = []; let s = 0, li = 0;
  while (s < L) {
    const nx = loops[li];
    if (nx && s >= nx[0] - 1e-6) {
      for (let q = 0; q < 60; q++) { const t = q / 60 * TAU, w = pos(nx[0] + a * t / TAU), al = b * Math.sin(t), off = nx[1] * b * (1 - Math.cos(t)); o.push([w.x + w.tx * al - w.ty * off, w.y + w.ty * al + w.tx * off]); }
      s = nx[0] + a; li++; continue;
    }
    const w = pos(s); o.push([w.x, w.y]);
    s = Math.min(s + 4, nx ? Math.max(nx[0], s + 0.5) : L);
  }
  const w = pos(L); o.push([w.x, w.y]);
  return o;
}
/** The boundary of a circle (n = 0) or a regular n-gon (circumradius r, a vertex at angle a0), from angle `from` for a
 * signed `span` (radians); polygon vertices are marked corners. */
function ringPath(n: number, r: number, a0: number, from: number, span: number): Pt[] {
  const rad = (th: number) => n ? r * Math.cos(Math.PI / n) / Math.cos(mod(th - a0, TAU / n) - Math.PI / n) : r;
  const pt = (th: number, c = false): Pt => c ? C(rad(th) * Math.cos(th), rad(th) * Math.sin(th)) : P(rad(th) * Math.cos(th), rad(th) * Math.sin(th));
  if (!n) return curve(th => pt(th), from, from + span, Math.ceil(Math.abs(span) / (3 * deg)));
  const o = [pt(from)], sg = Math.sign(span), step = TAU / n, to = from + span;
  for (let j = sg > 0 ? Math.floor((from - a0) / step) + 1 : Math.ceil((from - a0) / step) - 1; ; j += sg) {
    const th = a0 + j * step; if (sg > 0 ? th >= to - 1e-6 : th <= to + 1e-6) break;
    if (Math.abs(th - from) > 1e-6) o.push(pt(th, true));
  }
  o.push(pt(to));
  return o;
}
const POLY = ['', '', '', '三角形', '四方形', '五邊形', '六邊形', '七邊形', '八邊形'];
const STAR_NAME: Record<number, string> = { 5: '五角星', 7: '七角星', 8: '八角星', 9: '九角星', 10: '十角星', 11: '十一角星' };
// star polygons {n/k}, roughly from simplest to most crossings
const STARS: readonly (readonly [number, number])[] = [[5, 2], [7, 2], [9, 2], [8, 3], [10, 3], [7, 3], [11, 3]];
/** A rounded loop at polygon corner V instead of a sharp turn: the stroke runs on past V, curls round outside it the
 * other way and comes back through V onto the next edge, crossing itself at V. */
function cornerLoop(prev: Pt, V: Pt, next: Pt, b: number): Pt[] {
  const d1 = unit(V[0] - prev[0], V[1] - prev[1]), d2 = unit(next[0] - V[0], next[1] - V[1]);
  const th = Math.acos(clamp(-(d1[0] * d2[0] + d1[1] * d2[1]), -1, 1)), u = unit(d1[0] - d2[0], d1[1] - d2[1]);
  const dc = b / Math.sin(th / 2), t = b / Math.tan(th / 2), O = [V[0] + u[0] * dc, V[1] + u[1] * dc], ox = O[0] ?? 0, oy = O[1] ?? 0;
  const T1: Pt = [V[0] + d1[0] * t, V[1] + d1[1] * t], T2: Pt = [V[0] - d2[0] * t, V[1] - d2[1] * t];
  const a1 = Math.atan2(T1[1] - oy, T1[0] - ox), a2 = Math.atan2(T2[1] - oy, T2[0] - ox), ccw = d1[0] * -Math.sin(a1) + d1[1] * Math.cos(a1) > 0;
  const sweep = ccw ? mod(a2 - a1, TAU) : -mod(a1 - a2, TAU);
  return [T1, ...curve(a => P(ox + b * Math.cos(a), oy + b * Math.sin(a)), a1, a1 + sweep, Math.ceil(Math.abs(sweep) / (4 * deg))).slice(1, -1), T2];
}
/** A heart (lobe radius rho, lobe centres at +-d, tip at y = ty, y down): two round lobes meeting in a dip at the top
 * (the cusp), straight sides from the lobes' outer tangent points R1 / L1 down to the tip. right: the right lobe from
 * the cusp over the top to R1; left: the left lobe from L1 over the top back to the cusp. */
interface Heart { cusp: Pt; tip: Pt; R1: Pt; L1: Pt; right: Pt[]; left: Pt[] }
function heart(rho: number, d: number, ty: number): Heart {
  const yc = -Math.sqrt(rho * rho - d * d), cusp: Pt = [0, yc];
  const tangent = (ox: number, side: number): Pt => { const vx = -ox, vy = ty, L = Math.hypot(vx, vy), b = Math.acos(rho / L) * side, ux = vx / L, uy = vy / L; return [ox + rho * (ux * Math.cos(b) - uy * Math.sin(b)), rho * (ux * Math.sin(b) + uy * Math.cos(b))]; };
  const lobe = (ox: number, from: Pt, to: Pt): Pt[] => {
    const a1 = Math.atan2(from[1], from[0] - ox), a2 = Math.atan2(to[1], to[0] - ox);
    let sw = mod(a2 - a1, TAU); if (Math.sin(a1 + sw / 2) > 0) sw -= TAU;   // over the top (y < 0)
    return curve(a => P(ox + rho * Math.cos(a), rho * Math.sin(a)), a1, a1 + sw, Math.ceil(Math.abs(sw) / (3 * deg))).slice(1, -1);
  };
  const outer = (q: Pt, s: number) => q[0] * s > 0 ? q : null, R1 = outer(tangent(d, 1), 1) ?? tangent(d, -1), L1 = outer(tangent(-d, -1), -1) ?? tangent(-d, 1);
  return { cusp, tip: [0, ty], R1, L1, right: lobe(d, cusp, R1), left: lobe(-d, L1, cusp) };
}
const heartRing = (h: Heart, tip: Pt[] = [C(h.tip[0], h.tip[1])]): Pt[] => [C(h.cusp[0], h.cusp[1]), ...h.right, P(h.R1[0], h.R1[1]), ...tip, P(h.L1[0], h.L1[1]), ...h.left, C(h.cusp[0], h.cusp[1])];
/** Open pieces joined end to start into one stroke by smooth bridges, each piece turned round when its other end is the
 * nearer one and already heads the right way (bridges no tighter than rho). */
function chainParts(parts: readonly Pt[][], rho: number): Pt[] | null {
  const first = parts[0]; if (!first) return null;
  const cost = (a: readonly Pt[], b: readonly Pt[]) => {
    const e = lastOf(a), s = at(b, 0), d = Math.hypot(s[0] - e[0], s[1] - e[1]), [ux, uy] = unit(s[0] - e[0], s[1] - e[1]), ta = tanEnd(a), tb = tanStart(b);
    return d * (3 - (ta[0] * ux + ta[1] * uy) - (tb[0] * ux + tb[1] * uy));
  };
  const second = parts[1];
  let out = second && Math.min(cost(first, second), cost(first, second.slice().reverse())) > Math.min(cost(first.slice().reverse(), second), cost(first.slice().reverse(), second.slice().reverse())) ? first.slice().reverse() : first.slice();
  for (const part of parts.slice(1)) {
    const b = cost(out, part) <= cost(out, part.slice().reverse()) ? part : part.slice().reverse(), e = lastOf(out), s = at(b, 0);
    out = [...out.slice(0, -1), P(e[0], e[1]), ...bridge(P(e[0], e[1]), tanEnd(out), P(s[0], s[1]), tanStart(b), rho).slice(0, -1), P(s[0], s[1]), ...b.slice(1)];
  }
  return out;
}
/** p cut back from its end until the end sits at least 1.3 G clear of every other stroke (the start is kept). */
function stopShort(p: readonly Pt[], G: number): Pt[] | null {
  const q = resample(p, 3), n = q.length, cum = [0];
  for (let i = 1; i < n; i++) cum.push((cum[i - 1] ?? 0) + Math.hypot(at(q, i)[0] - at(q, i - 1)[0], at(q, i)[1] - at(q, i - 1)[1]));
  const L = cum[n - 1] ?? 0;
  for (let j = n - 1 - Math.ceil(G * 1.2 / 3); j > n * 0.6; j--) {
    const e = at(q, j), lim = (cum[j] ?? 0) - 2.5 * G; let ok = true;
    for (let i = 0; i < j && (cum[i] ?? 0) < lim; i += 2) { const v = at(q, i); if (Math.hypot(v[0] - e[0], v[1] - e[1]) < 1.3 * G) { ok = false; break; } }
    if (ok && !e[2] && (cum[j] ?? 0) > L * 0.6) return [...q.slice(0, j), P(e[0], e[1])];
  }
  return null;
}
/** Open centripetal Catmull-Rom through control points; corner-marked points split it into separately smoothed runs. */
function brush(cp: readonly Pt[]): Pt[] {
  const o: Pt[] = []; let run: Pt[] = [];
  const flush = (corner: Pt | null) => { if (run.length >= 2) { const s = crSpline(run.map((q): Pt => [q[0], q[1]]), 10); o.push(...(o.length ? s.slice(1) : s)); } if (corner) { o.pop(); o.push(C(corner[0], corner[1])); } };
  for (const q of cp) { run.push(q); if (q[2]) { flush(q); run = [P(q[0], q[1])]; } }
  flush(null);
  return o;
}
// Brush characters in a unit square (y down): strokes in writing order, each a few control points (1 = a sharp turn);
// the stroke between two strokes is the brush's travel in the air, drawn as a smooth bridge (行書's joined strokes).
const CHARS: Record<string, readonly (readonly Pt[])[]> = {
  一: [[[0.04, 0.55], [0.5, 0.46], [0.96, 0.52]]],
  二: [[[0.22, 0.28], [0.78, 0.25]], [[0.06, 0.74], [0.5, 0.7], [0.95, 0.76]]],
  三: [[[0.25, 0.16], [0.75, 0.14]], [[0.8, 0.47], [0.18, 0.5]], [[0.05, 0.86], [0.5, 0.81], [0.96, 0.86]]],
  // 十 vertical first: drawn horizontal first, the join from its right end to the top of the vertical loops over the top.
  // The middle strokes of 三 and 川 run backwards, so the joins are short turns at the ends and the three bars stay
  // the three biggest things; written forwards, each join is a long diagonal that reads as a fourth and fifth bar.
  十: [[[0.5, 0.04], [0.5, 0.5], [0.5, 0.97]], [[0.05, 0.42], [0.5, 0.38], [0.95, 0.42]]],
  川: [[[0.2, 0.1], [0.19, 0.55], [0.06, 0.95]], [[0.5, 0.86], [0.5, 0.18]], [[0.84, 0.04], [0.84, 0.97]]],
  人: [[[0.5, 0.04], [0.42, 0.5], [0.05, 0.95]], [[0.66, 0.42], [0.8, 0.72], [0.97, 0.94]]],
  大: [[[0.06, 0.35], [0.5, 0.31], [0.94, 0.35]], [[0.5, 0.04], [0.46, 0.52], [0.06, 0.95]], [[0.64, 0.55], [0.8, 0.76], [0.97, 0.95]]],
  小: [[[0.5, 0.04], [0.5, 0.86, 1], [0.36, 0.85]], [[0.26, 0.36], [0.1, 0.7]], [[0.72, 0.32], [0.9, 0.66]]],
  永: [[[0.42, 0.03], [0.52, 0.14]], [[0.26, 0.26], [0.6, 0.24, 1], [0.58, 0.92, 1], [0.4, 0.9]], [[0.1, 0.44], [0.32, 0.42, 1], [0.2, 0.8]], [[0.9, 0.3], [0.7, 0.46]], [[0.68, 0.58], [0.82, 0.76], [0.98, 0.93]]],
};
// 人 left out: its second stroke starts on the first, so the join back up always runs alongside the first stroke
const CHAR_ORDER = ['二', '十', '川', '三', '小', '大', '永'];
// cursive letters in x-heights (y up), entering from the baseline on the left and leaving on it on the right
const LETTERS: Record<string, { adv: number; cp: readonly Pt[] }> = {
  e: { adv: 1.1, cp: [[0.1, 0.1], [0.6, 0.4], [0.85, 0.75], [0.75, 1.02], [0.45, 1.1], [0.2, 0.9], [0.18, 0.5], [0.35, 0.15], [0.65, 0.02], [1.1, 0.12]] },
  l: { adv: 1.15, cp: [[0.1, 0.15], [0.7, 0.8], [1.0, 1.5], [0.95, 1.95], [0.65, 2.2], [0.32, 2.0], [0.22, 1.4], [0.38, 0.45], [0.62, 0.04], [1.15, 0.12]] },
  n: { adv: 1.1, cp: [[0.05, 0.2], [0.2, 0.8], [0.4, 1.02], [0.65, 0.95], [0.8, 0.6], [0.85, 0.2], [1.1, 0.05]] },
  g: { adv: 1.1, cp: [[0.05, 0.15], [0.3, 0.8], [0.6, 0.95], [0.8, 0.6], [0.65, -0.5], [0.55, -1.0], [0.25, -1.15], [0.02, -0.85], [0.12, -0.4], [0.5, -0.05], [1.1, 0.12]] },
};
const WORDS = ['ee', 'el', 'le', 'ell', 'eel', 'gel', 'leg', 'lee', 'gee', 'nee', 'glee', 'glen', 'gene'];
const NUM = ['', '', '兩', '三', '四', '五', '六'];

export const SHAPES: Record<string, ShapeFam> = {
  loop: { name: '圈圈', rot: 180, gen(rng, c, k) {
    const { r, p } = rnd(rng), long = Math.max(c.W, c.H), short = Math.min(c.W, c.H);
    if (k < 0.1) {
      const e = r(0.65, 1), R0 = short / 2, pts = openRing(curve(t => P(R0 * Math.cos(t), e * R0 * Math.sin(t)), 0, TAU, 240), c.G, rng);
      return pts && { pts, label: e > 0.88 ? '圓圈' : '橢圓' };
    }
    // loops strung on a row, on rows joined by half circles, round an open ring (a garland) or on a wave
    // the top of a loop curves at about (1 - a / (2 pi b))^2 x b: keep that wider than minR
    const m = Math.max(1, Math.round(k * 11 * r(0.8, 1.15))), ka = r(1.5, 2), b = Math.max(c.minR * r(1.1, 1.3) / (1 - ka / TAU) ** 2, c.G * 0.6), a = b * ka;
    const gp = Math.max(c.G * 0.6, c.G + 2 * b - 1.5 * a) * r(1, 1.25), lead = c.G * r(1.3, 1.8), side = rng() < 0.5 ? 1 : -1, alt = rng() < 0.3;
    const need = 2 * lead + m * a + (m - 1) * gp, kind = need <= long ? p(['row', 'row', 'wave', 'ring']) : p(['rows', 'rows', 'ring']);
    const at0 = (s0: number, cnt: number, sg: (j: number) => number) => Array.from({ length: cnt }, (_, j): [number, number] => [s0 + j * (a + gp), sg(j)]);
    if (kind === 'row' || kind === 'wave') {
      const Lb = Math.max(need, long * r(0.7, 1)), A = kind === 'wave' ? short * r(0.15, 0.3) : 0, lam = Lb / r(1, 2);
      const base = curve(x => P(x, A * Math.sin(TAU * x / lam)), 0, Lb, Math.ceil(Lb / 4)), cl = Lb > need ? (Lb - need) / 2 : 0;
      return { pts: along(base, at0(lead + cl, m, j => alt && j % 2 ? -side : side), a, b), label: m === 1 ? '打個圈' : kind === 'wave' ? '浪花圈' : '一串圈' };
    }
    if (kind === 'ring') {
      const Rb = short / 2 - 2 * b, dl = 2 * Math.asin(Math.min(0.95, 0.9 * c.G / Math.max(1, Rb))), span = Rb * (TAU - dl);
      if (Rb < c.G * 1.5 || need > span) return null;
      const a0 = rng() * TAU, base = curve(t => P(Rb * Math.cos(a0 + t / Rb), Rb * Math.sin(a0 + t / Rb)), 0, span, Math.ceil(span / 4));
      return { pts: along(base, at0(lead + (span - need) / 2, m, () => -1), a, b), label: '花環' };
    }
    // rows: loops above the base on every row, rows a loop height and a gap apart, joined by half circles
    const per = Math.floor((long - 2 * lead + gp) / (a + gp)); if (per < 1) return null;
    const nr = Math.ceil(m / per), pitch = 2 * b + c.G * 1.4; if (nr * pitch > short * 1.2 + pitch) return null;
    const base: Pt[] = [], loops: [number, number][] = []; let s = 0, left = m;
    for (let j = 0; j < nr; j++) {
      const dir = j % 2 ? -1 : 1, y = j * pitch, cnt = Math.min(per, left), x0 = dir > 0 ? 0 : long; left -= cnt;
      const row = curve(x => P(x0 + dir * x, y), 0, long, Math.ceil(long / 4)); base.push(...(j ? row.slice(1) : row));
      const used = cnt * a + (cnt - 1) * gp;
      loops.push(...at0(s + (long - used) / 2, cnt, () => dir > 0 ? -1 : 1));
      s += long;
      if (j < nr - 1) { const tu = uTurn(dir > 0 ? long : 0, y, pitch / 2, dir); base.push(...tu); s += Math.PI * pitch / 2; }
    }
    return { pts: along(base, loops, a, b), label: '彈簧圈' };
  } },
  spiral: { name: '蚊香', rot: 180, gen(rng, c, k) {
    const { r, p } = rnd(rng), kind = k < 0.2 ? p(['plain', 'square']) : p(['plain', 'square', 'double', 'inout']);
    const Rm = Math.min(c.W, c.H) / 2, long = Math.max(c.W, c.H), want = 0.9 + k * 5.4 * r(0.85, 1.1);
    if (kind === 'plain' || kind === 'square') {
      const pe = kind === 'square' ? r(3, 5) : 2, fmax = Math.pow(2, 0.5 - 1 / pe), g = c.G * r(1.15, 1.35) * fmax, rin = Math.max(c.minR * 1.35, g * 0.55);
      const turns = Math.min(want, (Rm - rin) / g); if (turns < 0.8) return null;
      const f = (th: number) => Math.pow(Math.pow(Math.abs(Math.cos(th)), pe) + Math.pow(Math.abs(Math.sin(th)), pe), -1 / pe) / fmax;
      return { pts: curve(th => { const rr = (rin + g * th / TAU) * f(th); return P(rr * Math.cos(th), rr * Math.sin(th)); }, 0, TAU * turns, Math.ceil(turns * 150)), label: kind === 'square' ? '方蚊香' : '蚊香' };
    }
    const g = c.G * r(1.15, 1.35);
    if (kind === 'double') {
      // two coils, point-symmetric, out of the first and into the second through the middle in an S
      const rin = Math.max(c.minR * 1.35, g * 0.55), Rc = Math.min((long - 1.4 * c.G) / 4, Rm), turns = Math.min(want / 2, (Rc - rin) / g); if (turns < 0.7) return null;
      const D = 2 * (rin + g * turns) + 1.4 * c.G, aa = r(0, TAU);
      const A = curve(th => { const rr = rin + g * th / TAU; return P(-D / 2 + rr * Math.cos(th + aa), rr * Math.sin(th + aa)); }, 0, TAU * turns, Math.ceil(turns * 150));
      const B = A.slice().reverse().map((q): Pt => [-q[0], -q[1]]);
      return { pts: [...A, ...join(lastOf(A), tanEnd(A), at(B, 0), tanStart(B)).slice(0, -1), ...B], label: '雙漩渦' };
    }
    // in along one arm, an S through the middle, out along the other arm between the first arm's rings
    const rin = Math.max(c.minR * 1.7, g * 0.8), turns = Math.min(want / 2, (Rm - rin) / (2 * g)); if (turns < 0.6) return null;
    const arm = curve(th => { const rr = rin + 2 * g * th / TAU; return P(rr * Math.cos(th), rr * Math.sin(th)); }, 0, TAU * turns, Math.ceil(turns * 150));
    const inA = arm.slice().reverse(), outB = arm.map((q): Pt => [-q[0], -q[1]]);
    return { pts: [...inA, ...join(lastOf(inA), tanEnd(inA), at(outB, 0), tanStart(outB), 0.7).slice(0, -1), ...outB], label: '雙螺旋' };
  } },
  star: { name: '星形', rot: 180, gen(rng, c, k) {
    // a polygon, a polygon with loops at some corners, or a star polygon {n/k}, drawn the way a hand does: in through
    // the first tip along the first edge, all the way round, and out through the same tip along the last edge
    const { r, i } = rnd(rng), R0 = Math.min(c.W, c.H) / 2;
    let n: number, kk = 1, loops = 0;
    if (k < 0.18) n = i(3, 7);
    else if (k < 0.5) { n = i(3, 6); loops = clamp(Math.round((k - 0.18) / 0.32 * n * r(0.6, 1.3)), 1, n - 1); }
    else { const s = STARS[clamp(Math.floor((k - 0.5) / 0.5 * STARS.length * r(0.75, 1.25)), 0, STARS.length - 1)] ?? [5, 2]; n = s[0]; kk = s[1]; }
    const a0 = rng() * TAU, sq = r(0.88, 1.12), v = (j: number): Pt => [R0 * Math.cos(a0 + TAU * j * kk / n), R0 * sq * Math.sin(a0 + TAU * j * kk / n)];
    const tip = Math.PI * (1 - 2 * kk / n), tail = c.G * r(1.3, 1.5) / Math.sin(Math.min(tip, Math.PI - tip, Math.PI / 2));
    const out = (a: Pt, b: Pt): Pt => { const [ux, uy] = unit(b[0] - a[0], b[1] - a[1]); return [b[0] + ux * tail, b[1] + uy * tail]; };
    const lp = new Set<number>(); while (lp.size < loops) lp.add(i(1, n - 1));
    const b = Math.max(c.minR * 1.3, c.G * 0.7) * r(1, 1.3), o: Pt[] = [out(v(1), v(0)), v(0)];
    for (let j = 1; j < n; j++) { const q = v(j); if (lp.has(j)) o.push(...cornerLoop(v(j - 1), q, v(j + 1), b)); else o.push(C(q[0], q[1])); }
    o.push(v(0), out(v(n - 1), v(0)));
    return { pts: o, label: kk > 1 ? STAR_NAME[n] ?? '星' : loops ? `${POLY[n] ?? ''}打圈` : POLY[n] ?? '多邊形' };
  } },
  eight: { name: '8字', rot: 180, gen(rng, c, k) {
    // a chain of m lobes on a line, crossing between them (a figure eight for m = 2): out along one strand over a lobe,
    // through a crossing, under the next ..., round a teardrop at the far end, back along the other strand and round a
    // teardrop at the near end. Strands cross at 2 alpha; every piece is a circular arc or a straight line.
    const { r } = rnd(rng), long = Math.max(c.W, c.H), short = Math.min(c.W, c.H), al = r(48, 62) * deg, q = r(0.42, 0.58), sa = Math.sin(al), ca = Math.cos(al);
    const fitW = (m: number) => long / (2 * q * (1 + 1 / sa) + m - 2), eyeH = (1 - ca) / sa;   // an eye's height per unit width
    let m = clamp(2 + Math.floor(k * 6 * r(0.8, 1.25)), 2, 9);
    while (m > 2 && (fitW(m) * eyeH < 1.15 * c.G || fitW(m) / (2 * sa) < c.minR * 1.2)) m--;
    const ww = fitW(m), re = Math.min(q * ww, short / 2), D = re / sa, ell = D * ca; if (re < c.minR * 1.2) return null;
    const X = Array.from({ length: m - 1 }, (_, j) => D + re + j * ww), o: Pt[] = [];
    const arcTo = (cx: number, cy: number, rr: number, a1: number, sweep: number) => { const n = Math.max(4, Math.ceil(Math.abs(sweep) / (4 * deg))); for (let s = 1; s <= n; s++) { const a = a1 + sweep * s / n; o.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); } };
    const eye = (xa: number, xb: number, sg: number) => {
      const rr = Math.abs(xb - xa) / 2 / sa, cy = -sg * rr * ca, xm = (xa + xb) / 2, a1 = Math.atan2(-cy, xa - xm), a2 = Math.atan2(-cy, xb - xm);
      let sw = mod(a2 - a1, TAU); if (sw > Math.PI) sw -= TAU; arcTo(xm, cy, rr, a1, sw);
    };
    const tear = (x: number, dx: number, s: number) => {
      const t1: Pt = [x + dx * ell * ca, s * ell * sa], t2: Pt = [x + dx * ell * ca, -s * ell * sa], ox = x + dx * D;
      o.push(t1); const a1 = Math.atan2(t1[1], t1[0] - ox), a2 = Math.atan2(t2[1], t2[0] - ox);
      let sw = mod(a2 - a1, TAU); if (Math.cos(a1 + sw / 2) * dx < 0) sw -= TAU; arcTo(ox, 0, re, a1, sw);
      o.push([x, 0]);
    };
    if (k < 0.12 && rng() < 0.6) {
      // the one-lobe chain: a ribbon, a single teardrop whose two tails cross at its neck
      const tail = c.G * r(1.5, 2.1); o.push([-tail * ca, -tail * sa], [0, 0]); tear(0, 1, 1); o.push([-tail * ca, tail * sa]);
      return { pts: o, label: '絲帶' };
    }
    const x0 = X[0] ?? 0, xl = X[m - 2] ?? 0, sg = (j: number) => j % 2 ? -1 : 1;
    o.push([x0, 0]);
    for (let j = 0; j < m - 2; j++) eye(X[j] ?? 0, X[j + 1] ?? 0, sg(j));
    tear(xl, 1, m > 2 ? -sg(m - 3) : 1);
    for (let j = m - 3; j >= 0; j--) eye(X[j + 1] ?? 0, X[j] ?? 0, -sg(j));
    tear(x0, -1, 1);
    const pts = openRing(o, c.G, rng);
    return pts && { pts, label: m === 2 ? '8字' : `${m}連環` };
  } },
  zigzag: { name: '鋸齒', rot: 6, gen(rng, c, k) {
    const { r, p } = rnd(rng), long = Math.max(c.W, c.H), short = Math.min(c.W, c.H), minInt = (180 - c.maxTurn + 8) * deg;
    const kind = k < 0.2 ? p(['zig', 'saw']) : p(['zig', 'zig', 'saw', 'ring']);
    if (kind === 'ring') {
      // teeth round an open ring: a crown
      const n = Math.round((5 + k * 15) * r(0.85, 1.15)), R0 = short / 2, A = R0 * r(0.18, 0.34), gapA = 2 * Math.asin(Math.min(0.95, 0.85 * c.G / (R0 - A))), a0 = rng() * TAU, st = (TAU - gapA) / n, o: Pt[] = [];
      for (let j = 0; j <= 2 * n; j++) { const th = a0 + st * j / 2, rr = j % 2 ? R0 : R0 - A; o.push(j && j < 2 * n ? C(rr * Math.cos(th), rr * Math.sin(th)) : P(rr * Math.cos(th), rr * Math.sin(th))); }
      return { pts: o, label: '皇冠' };
    }
    let nr = 1 + Math.floor(k * 4.2 * r(0.8, 1.2));
    const teeth = Math.max(2, Math.round((2 + k * 9) * r(0.8, 1.2))), w = long / teeth, saw = kind === 'saw';
    // the tip angle a finger may turn, and parallel legs a gap apart
    const half = saw ? w : w / 2, A = Math.min(half / Math.tan(minInt / 2) * (saw ? 2 : 1), short * 0.4) * r(0.7, 1);
    if (half * A / Math.hypot(half, A) * (saw ? 1 : 2) < 1.1 * c.G) return null;
    const pitch = A + c.G * 1.4; while (nr > 1 && nr * pitch - c.G * 1.4 > short * 1.15) nr--;
    const o: Pt[] = [];
    for (let j = 0; j < nr; j++) {
      const dir = j % 2 ? -1 : 1, yb = A + j * pitch, X = (x: number) => dir > 0 ? x : long - x;
      for (let q = 0; q < teeth; q++) {
        const x = q * w, first = j === 0 && q === 0;
        o.push(first ? P(X(x), yb) : C(X(x), yb));
        if (saw) { o.push(C(X(x + w), yb - A)); } else o.push(C(X(x + w / 2), yb - A));
      }
      const xe = X(long), lastRow = j === nr - 1;
      o.push(lastRow ? P(xe, yb) : C(xe, yb));
      if (!lastRow) o.push(...uTurn(xe, yb, pitch / 2, dir));
    }
    return { pts: o, label: saw ? '鋸齒' : nr > 1 ? '之字' : '山峰' };
  } },
  wave: { name: '波浪', rot: 6, gen(rng, c, k) {
    const { r } = rnd(rng), long = Math.max(c.W, c.H), short = Math.min(c.W, c.H);
    let rows = 1 + Math.floor(k * 5.5 * r(0.8, 1.2));
    const hp = Math.max(1, Math.round((1 + k * 8) * r(0.7, 1.3))), half = long / hp, Amax = half * half / (Math.PI * Math.PI * c.minR * 1.2);
    const A = Math.min(Amax, short * 0.32) * r(0.6, 1); if (A < c.G * 0.3) return null;
    const pitch = 2 * A + c.G * 1.4; while (rows > 1 && (rows - 1) * pitch + 2 * A > short * 1.15) rows--;
    const o: Pt[] = [], n = hp * 24;
    for (let j = 0; j < rows; j++) {
      const dir = j % 2 ? -1 : 1, y0 = A + j * pitch, X = (x: number) => dir > 0 ? x : long - x;
      for (let q = 0; q <= n; q++) { const x = long * q / n, y = y0 + A * Math.sin(Math.PI * x / half); o.push((q === 0 && j > 0) || (q === n && j < rows - 1) ? C(X(x), y) : P(X(x), y)); }
      if (j < rows - 1) o.push(...uTurn(X(long), y0, pitch / 2, dir));
    }
    return { pts: o, label: rows > 1 ? '蛇形' : '波浪' };
  } },
  nested: { name: '套圈', rot: 180, gen(rng, c, k) {
    // rings inside rings (circles and polygons), each almost all the way round, then a straight step in to the next;
    // on 迴紋 the way round turns back at every step
    const { r, p } = rnd(rng), want = 2 + Math.floor(k * 4.6 * r(0.85, 1.15)), same = rng() < 0.35, alt = rng() < 0.4, kinds = [0, 0, 3, 4, 5, 6], k0 = p(kinds);
    let rr = Math.min(c.W, c.H) / 2, th = rng() * TAU, dir = 1, rings = 0, circles = true;
    const o: Pt[] = [];
    for (let j = 0; j < want; j++) {
      const n = same ? k0 : j ? p(kinds) : k0; if (n) circles = false;
      const inner = n ? rr * Math.cos(Math.PI / n) : rr, gapA = 2 * Math.asin(Math.min(0.95, 0.8 * c.G / inner));
      // the ring starts mid-edge, so the step in does not land next to a polygon corner
      const seg = ringPath(n, rr, th - Math.PI / Math.max(3, n) * r(0.75, 1.25), th, dir * (TAU - gapA));
      if (o.length) { const s0 = at(seg, 0), l = lastOf(o); seg[0] = C(s0[0], s0[1]); o[o.length - 1] = C(l[0], l[1]); }
      o.push(...seg); rings++;
      th += dir * (TAU - gapA);
      const next = inner - Math.max(c.G * r(1.3, 1.6), c.minSeg * 1.1); if (next < Math.max(c.minR * 1.4, c.G)) break;
      rr = next; if (alt) dir = -dir;
    }
    if (rings < 2) return null;
    const l = lastOf(o); o[o.length - 1] = P(l[0], l[1]);
    return { pts: o, label: circles ? '套圈' : alt ? '迴紋' : '套形' };
  } },
  rosette: { name: '花', rot: 180, gen(rng, c, k) {
    // z(t) = e^(iat) + s e^(ibt): a rounded n-petal flower (a = 1, s|b| < 1), a ring of n loops (a = 1, s|b| > 1) or a
    // spirograph rosette that winds round two or three times (a = 2, 3)
    const { r, p } = rnd(rng), R0 = Math.min(c.W, c.H) / 2;
    let a = 1, b: number, s: number, label: string;
    if (k < 0.3) { b = p([-2, -3, -4, -5, -6, 4, 5, 6, 7]); s = r(0.3, 0.65) / Math.abs(b); label = `${Math.abs(b - a)}瓣花`; }
    // loops are only wide enough for a finger when s|b| is well past 1 (the loop's tightest turn grows with s|b| - 1)
    else if (k < 0.62) { b = p([3, 4, 5, 6, 7]); s = r(2.6, 4.5) / b; label = `${b - 1}圈花`; }
    else {
      a = p([2, 3]); const opts = [-3, -5, -7, 5, 7, 8, -8, 9, 10, 11].filter(v => { let x = Math.abs(v), y = a; while (y) [x, y] = [y, x % y]; return x === 1; });
      b = p(opts); s = (rng() < 0.5 ? r(0.25, 0.6) : r(1.8, 2.8)) * a / Math.abs(b); label = '萬花筒';
    }
    const sc = R0 / (1 + s), pts = openRing(curve(t => P(sc * (Math.cos(a * t) + s * Math.cos(b * t)), sc * (Math.sin(a * t) + s * Math.sin(b * t))), 0, TAU, 240 * (Math.abs(a) + Math.abs(b))), c.G, rng);
    return pts && { pts, label };
  } },
  heart: { name: '心形', rot: 15, upright: true, gen(rng, c, k) {
    const { r } = rnd(rng), rho = Math.min(c.W / 3.5, c.H / 2.8) * r(0.9, 1), h = heart(rho, rho * r(0.62, 0.75), rho * r(1.5, 2));
    if (k < 0.3) { const pts = openRing(heartRing(h), c.G, rng); return pts && { pts, label: '心形' }; }
    if (k < 0.6) {
      // 愛心 in one go: in along one side past the tip, round both lobes, and out along the other side past the tip,
      // the two sides crossing at the tip
      const t = h.tip, ul = unit(t[0] - h.L1[0], t[1] - h.L1[1]), ur = unit(t[0] - h.R1[0], t[1] - h.R1[1]), ang = Math.acos(clamp(ul[0] * ur[0] + ul[1] * ur[1], -1, 1));
      const tail = c.G * r(1.3, 1.6) / Math.sin(Math.max(0.3, Math.min(ang, Math.PI - ang, Math.PI / 2)));
      return { pts: [P(t[0] + ul[0] * tail, t[1] + ul[1] * tail), P(t[0], t[1]), P(h.L1[0], h.L1[1]), ...h.left, C(h.cusp[0], h.cusp[1]), ...h.right, P(h.R1[0], h.R1[1]), P(t[0], t[1]), P(t[0] + ur[0] * tail, t[1] + ur[1] * tail)], label: '愛心' };
    }
    if (k < 0.82) {
      const b = Math.max(c.minR * 1.3, c.G * 0.7) * r(1, 1.3), pts = openRing(heartRing(h, cornerLoop(h.R1, h.tip, h.L1, b)), c.G, rng);
      return pts && { pts, label: '心形打圈' };
    }
    // a heart in a heart: round the outer one, a step in, round the inner one
    const cy = (h.tip[1] - rho) / 2, ring = heartRing(h), dist = (s: number) => {
      let m = 1e9; for (let i = 0; i < ring.length; i += 2) { const q = at(ring, i), x = q[0] * s, y = cy + (q[1] - cy) * s; for (let j = 0; j < ring.length; j += 2) { const v = at(ring, j); m = Math.min(m, Math.hypot(v[0] - x, v[1] - y)); } }
      return m;
    };
    let s = 0.8; while (s > 0.35 && dist(s) < 1.5 * c.G) s -= 0.03; if (s <= 0.35) return null;
    const A = openRing(ring, c.G, rng), B = openRing(ring.map((q): Pt => q[2] ? [q[0] * s, cy + (q[1] - cy) * s, 1] : [q[0] * s, cy + (q[1] - cy) * s]), c.G, rng);
    const pts = A && B && chainParts([A, B], c.minR * 1.4);
    return pts && { pts, label: '心中有心' };
  } },
  hearts: { name: '心心', rot: 15, upright: true, gen(rng, c, k) {
    // a garland: two to six hearts, overlapping or a gap apart, each drawn like 愛心 (up one side from the tip, round
    // both lobes, down the other side and across the tip), the stroke swooping on from one heart's tip to the next
    // one's; four or more go on two rows, left to right and back. Overlapping hearts sit so that one heart's lobe
    // crosses the next one's lobe steeply (their centres about a lobe radius apart).
    const { r } = rnd(rng), over = rng() < 0.55, sp = c.G * r(1.2, 1.6), ov = r(2.4, 2.75);
    let m = clamp(2 + Math.floor(k * 5 * r(0.8, 1.2)), 2, 6), rho = 0, dx = 0, m1 = m;
    const tail = c.G * r(1.3, 1.6), rowGap = 2 * c.G;
    for (; m >= 2; m--) {
      const rows = m >= 4 ? 2 : 1; m1 = Math.ceil(m / rows);
      const byW = over ? (c.W - 1.6 * c.G) / (ov * (m1 - 1) + 3.6) : (c.W - 1.6 * c.G - (m1 - 1) * sp) / (3.5 * (m1 - 1) + 3.6);
      rho = Math.min(byW, (c.H - (rows - 1) * rowGap) / (3.4 * rows)); dx = over ? ov * rho : 3.5 * rho + sp;
      if (rho >= Math.max(0.85 * c.G, 1.1 * c.minR)) break;
    }
    if (m < 2) return null;
    const o: Pt[] = [];
    for (let j = 0; j < m; j++) {
      const row = j < m1 ? 0 : 1, dir = row ? -1 : 1, X = row ? (m1 - 1 - (j - m1)) * dx : j * dx, Y = row * (3.4 * rho + rowGap) + r(-0.15, 0.15) * rho;
      const z = rho * r(0.92, 1.05), h = heart(z, z * r(0.62, 0.75), z * r(1.5, 1.9)), tw = r(-8, 8) * deg, cw = Math.cos(tw), sw = Math.sin(tw);
      // the heart turned a little about its tip, which sits at (X, Y); on the way back it is drawn the other way round
      const T = (q: Pt): Pt => { const x = dir * (q[0] - h.tip[0]), y = q[1] - h.tip[1], u: Pt = [X + x * cw - y * sw, Y + x * sw + y * cw]; return q[2] ? [u[0], u[1], 1] : u; };
      const up = unit(h.R1[0] - h.tip[0], h.R1[1] - h.tip[1]), dn = unit(h.tip[0] - h.L1[0], h.tip[1] - h.L1[1]);
      // a tail in at the start of each row, a tail out at the end of each; within a row the swoop leaves one tip and
      // arrives at the next
      const first = j === 0 || j === m1, last = j === m - 1 || j === m1 - 1;
      const body = [...(first ? [P(h.tip[0] - up[0] * tail, h.tip[1] - up[1] * tail)] : []), P(h.tip[0], h.tip[1]), P(h.R1[0], h.R1[1]), ...h.right.slice().reverse(), C(h.cusp[0], h.cusp[1]), ...h.left.slice().reverse(), P(h.L1[0], h.L1[1]), P(h.tip[0], h.tip[1]), ...(last ? [P(h.tip[0] + dn[0] * tail, h.tip[1] + dn[1] * tail)] : [])].map(T);
      if (o.length) {
        const e = lastOf(o), s = at(body, 0), te = tanEnd(o), ts = tanStart(body);
        o.push(...(j === m1 ? bridge(e, te, s, ts, Math.max(1.4 * c.minR, rho)) : join(e, te, s, ts)).slice(0, -1));
      }
      o.push(...body);
    }
    return { pts: o, label: m === 2 ? '心心相印' : `${NUM[m] ?? ''}個心` };
  } },
  tornado: { name: '龍捲風', rot: 8, upright: true, gen(rng, c, k) {
    // the way a hand scribbles a tornado: a funnel of sweeps back and forth, each one wider and higher than the last
    // (two sweeps a turn, as many turns as fit a finger apart: 2 on the easiest rules, 3-4 on the hard ones), the front
    // sweeps bowed down and the back ones bowed up like the halves of a flat ring, narrow at the foot and standing on a
    // short tail, the turns at the sides round (no tighter than minR). A real coil seen from the side does not fit:
    // its small round bottom laps cross the next lap too shallowly, or run alongside it, at every gap tried.
    const { r } = rnd(rng), bow = c.G * r(0.2, 0.45), g = r(0.8, 1.2), sway = r(0, 0.08) * c.W, ph = rng() * TAU;
    const h = Math.max(1.3 * c.G + 2 * bow, 2.4 * c.minR), tail = Math.max(c.minSeg * 1.15, 1.4 * c.G);
    const want = 2 * Math.round(3 + k * 2 * r(0.9, 1.15)), rows = Math.min(want, Math.floor((c.H - tail - bow) / h) + 1); if (rows < 4) return null;
    const a1 = (c.W - 2 * sway) / 2 - h / 2, a0 = Math.max(a1 * r(0.08, 0.16), 1.2 * c.G); if (a1 < a0 + c.G) return null;
    const o: Pt[] = [];
    for (let i = 0; i < rows; i++) {
      const u = i / (rows - 1), a = a0 + (a1 - a0) * u ** g, cx = sway * Math.sin(1.4 * Math.PI * u + ph), dir = i % 2 ? -1 : 1, y = -i * h;
      const x0 = cx - dir * a, x1 = cx + dir * a, row = curve(t => P(x0 + (x1 - x0) * t, y + dir * bow * Math.sin(Math.PI * t)), 0, 1, Math.max(4, Math.ceil(2 * a / 4)));
      if (!o.length) { o.push(P(x0 - 0.3 * tail, y + tail), C(x0, y), ...row.slice(1)); continue; }
      const e = lastOf(o), st = at(row, 0);
      o.push(...bridge(e, tanEnd(o), st, tanStart(row), h / 2 * 0.98).slice(0, -1), ...row);
    }
    return { pts: o, label: rows <= 5 ? '小旋風' : '龍捲風' };
  } },
  doodle: { name: '塗鴉', rot: 180, tries: 3, gen(rng, c, k) {
    // a pen left to wander: its curvature drifts between two slow waves (never tighter than minR), so it curls into
    // loops now one way, now the other; near the edge it turns back towards the middle
    const { r } = rnd(rng), kmax = 1 / (1.3 * c.minR), L = (c.W + c.H) * (0.8 + k * 3.6) * r(0.85, 1.15), ds = 3, per = TAU / kmax;
    const w1 = TAU / (per * r(1.2, 3)), w2 = TAU / (per * r(0.5, 1.2)), f1 = rng() * TAU, f2 = rng() * TAU, mx = c.W * 0.12, my = c.H * 0.12;
    let x = r(0.3, 0.7) * c.W, y = r(0.3, 0.7) * c.H, h = rng() * TAU, run = 0, most = 0;
    const o: Pt[] = [P(x, y)];
    for (let s = 0; s < L; s += ds) {
      let kap = kmax * (0.7 * Math.sin(w1 * s + f1) + 0.5 * Math.sin(w2 * s + f2));
      const out = Math.max(mx - x, x - (c.W - mx), 0) / mx + Math.max(my - y, y - (c.H - my), 0) / my;
      if (out > 0) { const dh = mod(Math.atan2(c.H / 2 - y, c.W / 2 - x) - h + Math.PI, TAU) - Math.PI; if (Math.abs(dh) > 0.5) kap = Math.sign(dh) * kmax; }
      kap = clamp(kap, -kmax, kmax); h += kap * ds; x += Math.cos(h) * ds; y += Math.sin(h) * ds; o.push(P(x, y));
      // the longest turn one way without unbending: a full lap of it is a loop
      run = Math.sign(kap) === Math.sign(run) || !run ? run + kap * ds : kap * ds; most = Math.max(most, Math.abs(run));
    }
    // a scribble, not a lazy S: at least one real loop
    if (most < TAU * 0.85) return null;
    // both ends pulled back until they sit clear of the rest
    const a = stopShort(o, c.G), pts = a && stopShort(a.reverse(), c.G);
    return pts && { pts, label: k < 0.4 ? '塗鴉' : '亂塗' };
  } },
  cursive: { name: '草書英文', rot: 6, upright: true, tries: 4, gen(rng, c, k) {
    // a word (or a signature-like scrawl of letters) in joined-up handwriting: each letter a few control points in
    // x-heights, jittered and slanted, one spline through them all, perhaps an underline swept back beneath it; the
    // baseline may climb to the right, a signature's more steeply
    const { r, p } = rnd(rng), sign = rng() < 0.35, slant = r(0.15, 0.35), jit = 0.05, climb = (sign ? r(15, 38) : r(5, 35)) * deg;
    const nL = clamp(Math.round(2 + k * 2.5 * r(0.8, 1.2)), 2, 4), cands = WORDS.filter(w => Math.abs(w.length - nL) <= 1);
    const word = sign ? Array.from({ length: nL }, () => p(['e', 'l', 'n', 'e', 'l', 'g'])).join('') : p(cands.length ? cands : WORDS), flour = sign || rng() < 0.4;
    const cp: Pt[] = [[-0.3, 0.02]]; let x = 0;
    for (const ch of word) { const L = LETTERS[ch]; if (!L) continue; for (const q of L.cp.slice(x ? 1 : 0)) cp.push([x + q[0] + r(-jit, jit), q[1] + r(-jit, jit)]); x += L.adv; }
    if (flour) { const xe = lastOf(cp)[0]; cp.push([xe + 0.45, -0.05], [xe + 0.6, -0.75], [xe + 0.15, -1.5], [x / 2, -1.65], [-0.1, -1.5]); }
    // slanted and turned up by climb (y down from here), then scaled to fill the box
    const cc = Math.cos(climb), sc = Math.sin(climb), u = cp.map((q): Pt => { const X = q[0] + slant * q[1], Y = q[1]; return [X * cc - Y * sc, -(X * sc + Y * cc)]; });
    const xs = u.map(q => q[0]), ys = u.map(q => q[1]), xh = Math.min(c.W / (Math.max(...xs) - Math.min(...xs)), c.H / (Math.max(...ys) - Math.min(...ys) + 0.4)) * r(0.92, 1);
    if (xh < Math.max(2.2 * c.G, 3.6 * c.minR)) return null;
    const pts = soften(crSpline(u.map((q): Pt => [q[0] * xh, q[1] * xh]), 14), 40);
    return { pts, label: sign ? '簽名' : `草書 ${word}` };
  } },
  brush: { name: '書法', rot: 4, upright: true, gen(rng, c, k) {
    // one to three brush characters, one above the other, each stroke a few control points; the brush's travel
    // between strokes is a short tucked join, a tight hook off one stroke and a straight into a tight hook onto the
    // next (a Z where it can, the way 行書 links strokes), never a wide loop that would hide the character
    const { r, i } = rnd(rng), nch = k < 0.4 ? 1 : k < 0.75 ? i(1, 2) : i(2, 3), top = clamp(Math.round(3 + k * 6 * r(0.8, 1.2)), 2, CHAR_ORDER.length), chars: string[] = [];
    for (let t = 0; chars.length < nch && t < 20; t++) { const ch = CHAR_ORDER[i(Math.max(0, top - 4), top - 1)] ?? '二'; if (!chars.includes(ch)) chars.push(ch); }
    // each character as tall as its share of the height allows (up to 1.35x its width): the joins between strokes then
    // run steeply and read as joins, not as extra strokes
    const gapY = c.G * 1.6, hy = (c.H - (nch - 1) * gapY) / nch, sz = Math.min(c.W, hy) * r(0.9, 1), sy = Math.min(hy * r(0.9, 1), 1.35 * sz), jit = 0.04, strokes: Pt[][] = [];
    chars.forEach((ch, j) => { for (const st of CHARS[ch] ?? []) strokes.push(brush(st.map((q): Pt => { const xy: Pt = [(q[0] + r(-jit, jit)) * sz, j * (sy + gapY) + (q[1] + r(-jit, jit)) * sy]; return q[2] ? [xy[0], xy[1], 1] : xy; }))); });
    let out = strokes[0]; if (!out) return null;
    for (const s of strokes.slice(1)) {
      // a Z between strokes that run the same way (二), the shortest turn between ones that run back (三, 川)
      const e = lastOf(out), b = at(s, 0), te = tanEnd(out), ts = tanStart(s);
      out = [...out.slice(0, -1), P(e[0], e[1]), ...bridge(P(e[0], e[1]), te, P(b[0], b[1]), ts, c.minR * 1.05, te[0] * ts[0] + te[1] * ts[1] > 0.3).slice(0, -1), ...s];
    }
    return { pts: out, label: chars.join('') };
  } },
  thread: { name: '線頭', rot: 180, gen(rng, c, k) {
    // the old 亂線頭 drawing (path.ts): a loose thread with curls, more runs and curls as k grows
    const lv = k < 0.34 ? 0 : k < 0.67 ? 1 : 2, pts = FAM['tangle']?.gen(rng, { W: c.W, H: c.H, G: c.G, S: c.minSeg, lv, maxTurn: c.maxTurn, minCross: c.minCross, maxCross: 80, minR: c.minR, label: '' });
    return pts ? { pts, label: ['線頭', '亂線頭', '一團線'][lv] ?? '線頭' } : null;
  } },
  magic: { name: '魔法陣', rot: 180, gen(rng, c, k) {
    // a spell sigil: round a circle (two or three, one inside the other, on the harder ones), stepping in to the next;
    // the innermost one breaks off at a gate opposite the step, runs in along a polygon's first edge to its first corner,
    // all the way round and out through the same corner along the last edge (the way 星形 draws one), and
    // takes up the circle again where it left off. The polygon is whole and every corner sits the same way in from the ring.
    const { r } = rnd(rng), R0 = Math.min(c.W, c.H) / 2, nr = k > 0.55 && rng() < 0.7 ? 3 : k > 0.25 && rng() < 0.7 ? 2 : 1;
    // a polygon, its corners growing with k; a star cannot keep a finger between its tips, its crossings and the rings
    // this far in from the circle (a seven-point star ring only fitted by leaving its last edge open)
    const n = clamp(Math.round(3 + k * 5 * r(0.7, 1.3)), 3, 8);
    const dr = c.G * r(1.3, 1.5), rings = Array.from({ length: nr }, (_, j) => R0 - j * dr), o: Pt[] = [], dir = rng() < 0.5 ? 1 : -1;
    const arc = (rr: number, from: number, span: number, turn = true) => {
      const seg = ringPath(0, rr, 0, from, span);
      if (o.length) { const s0 = at(seg, 0), l = lastOf(o); seg[0] = C(s0[0], s0[1]); if (turn) o[o.length - 1] = C(l[0], l[1]); }
      o.push(...seg);
    };
    let th = rng() * TAU;
    for (const rr of rings.slice(0, -1)) { const gapA = 2 * Math.asin(Math.min(0.95, 0.8 * c.G / rr)); arc(rr, th, dir * (TAU - gapA)); th += dir * (TAU - gapA); }
    // the tip stands far enough in from the ring that the two lines through it are a finger apart where they meet it
    const tip = Math.PI * (1 - 2 / n), d = c.G * Math.max(1.7, 0.85 / Math.sin(tip / 2) + 0.5) * r(1, 1.1);
    const Rin = rings[nr - 1] ?? R0, Rs = Rin - d; if (Rs < 1.3 * c.G || 2 * Rs * Math.sin(Math.PI / n) < 1.5 * c.G) return null;
    const gate = th + dir * Math.PI, v = (j: number): Pt => { const a = gate + dir * TAU * j / n; return [Rs * Math.cos(a), Rs * Math.sin(a)]; };
    // where the line from a on through tip b meets the ring
    const hit = (a: Pt, b: Pt): number => { const [ux, uy] = unit(b[0] - a[0], b[1] - a[1]), bu = b[0] * ux + b[1] * uy, t = -bu + Math.sqrt(bu * bu - (Rs * Rs - Rin * Rin)); return Math.atan2(b[1] + uy * t, b[0] + ux * t); };
    const a1 = hit(v(1), v(0)), a2 = hit(v(n - 1), v(0)), gapA = 2 * Math.asin(Math.min(0.95, 0.8 * c.G / Rin));
    const s1 = mod(dir * (a1 - th), TAU), s2 = mod(dir * (th - a2), TAU) - gapA; if (s1 < 0.5 || s2 < 0.5) return null;
    arc(Rin, th, dir * s1);
    const l = lastOf(o); o[o.length - 1] = C(l[0], l[1]); o.push(P(v(0)[0], v(0)[1]));
    for (let j = 1; j < n; j++) o.push(C(v(j)[0], v(j)[1]));
    o.push(P(v(0)[0], v(0)[1]));
    arc(Rin, a2, dir * s2, false);
    return { pts: o, label: `${['', '', '雙環', '三環'][nr] ?? ''}${POLY[n] ?? ''}陣` };
  } },
  combo: { name: '組合', rot: 4, tries: 3, gen(rng, c, k) {
    // two shapes, one above the other, joined into one stroke by a smooth bridge
    const { r, p } = rnd(rng), parts = ['loop', 'spiral', 'star', 'eight', 'zigzag', 'wave', 'rosette', 'nested'], fa = p(parts), fb = p(parts.filter(f => f !== fa));
    const hh = (c.H - 1.6 * c.G) / 2, sub: Box = { ...c, H: hh }, part = (f: string) => { for (let t = 0; t < 4; t++) { const s = SHAPES[f]?.gen(rng, sub, k * r(0.2, 0.8)); if (s) return s; } return null; };
    const A0 = part(fa), B0 = part(fb); if (!A0 || !B0) return null;
    const into = (q: readonly Pt[], y0: number): Pt[] => {
      let x0 = 1e9, y1 = 1e9, x1 = -1e9, y2 = -1e9; for (const v of q) { x0 = Math.min(x0, v[0]); y1 = Math.min(y1, v[1]); x1 = Math.max(x1, v[0]); y2 = Math.max(y2, v[1]); }
      const s = Math.min(c.W / Math.max(1, x1 - x0), hh / Math.max(1, y2 - y1)), ox = (c.W - (x1 - x0) * s) / 2, oy = y0 + (hh - (y2 - y1) * s) / 2;
      return q.map((v): Pt => v[2] ? [ox + (v[0] - x0) * s, oy + (v[1] - y1) * s, 1] : [ox + (v[0] - x0) * s, oy + (v[1] - y1) * s]);
    };
    const A1 = into(A0.pts, 0), B1 = into(B0.pts, hh + 1.6 * c.G);
    let best: [Pt[], Pt[]] = [A1, B1], bd = 1e9;
    // the pair of ends that are close and already head towards each other, so the bridge is a gentle curve
    for (const a of [A1, A1.slice().reverse()]) for (const b of [B1, B1.slice().reverse()]) {
      const e = lastOf(a), s = at(b, 0), d = Math.hypot(s[0] - e[0], s[1] - e[1]), [ux, uy] = unit(s[0] - e[0], s[1] - e[1]), ta = tanEnd(a), tb = tanStart(b);
      const cost = d * (2 - (ta[0] * ux + ta[1] * uy) - (tb[0] * ux + tb[1] * uy)) + d; if (cost < bd) { bd = cost; best = [a, b]; }
    }
    const [A, B] = best, a1 = plain([lastOf(A)])[0] ?? lastOf(A), b0: Pt = [at(B, 0)[0], at(B, 0)[1]];
    const pts = [...flags(A.slice(0, -1)), a1, ...join(a1, tanEnd(A), b0, tanStart(B)).slice(0, -1), b0, ...flags(B.slice(1))];
    return { pts, label: `${A0.label}+${B0.label}` };
  } },
};
/** The families' display names (Cantonese), by id. */
export const KNOT_FAM_NAME: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(SHAPES).map(([id, f]) => [id, f.name]));
