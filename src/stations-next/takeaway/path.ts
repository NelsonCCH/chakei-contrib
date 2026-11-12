// The 外賣 bag-tying path generator, ported 1:1 from the original prototype: every family,
// the fitting, resampling, smoothing, the finger rules (checkPath) and the par time. Pure and deterministic for a seed
// (its own mulberry32 stream), so the station state keeps only the path's spec and any driver rebuilds the same path.
// One change: the prototype shuffled 亂線頭's curl slots with `sort(() => rng() - 0.5)`, whose result depends on the engine's
// sort; a Fisher-Yates shuffle on the same stream keeps the shapes the same kind on every phone.

/** A point in css px; a third element 1 marks a sharp corner that must stay sharp. */
export type Pt = [number, number, number?];
export interface Rect { x: number; y: number; w: number; h: number }
/** The per-difficulty pattern rules (css px, degrees): see TUNE.diff in core.ts. */
export interface PathRules { lv: number; gap: number; minSeg: number; maxTurn: number; minCross: number; maxCross: number; minR: number; lenK: readonly [number, number]; parSpeed: number }

export const GEN = { margin: 30, timerH: 12, jitter: 0.32, rot: 12, tries: 24, smoothMax: 6 } as const;
export const PAR = { base: 0.6, rFull: 70, corner: [0.05, 0.15] } as const;
export const STEP = 3;   // TUNE.trace.step: the path is resampled every 3 css px

const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
const deg = Math.PI / 180, TAU = Math.PI * 2;
const V = (x: number, y: number): Pt => [x, y, 1];
/** pts[i], which must exist. */
export function at(a: readonly Pt[], i: number): Pt { const p = a[i]; if (!p) throw new Error(`no point ${i} of ${a.length}`); return p; }
const num = (a: ArrayLike<number>, i: number) => a[i] ?? 0;
const lastOf = (a: readonly Pt[]) => at(a, a.length - 1);
const lerp2 = (a: Pt, b: Pt, u: number): Pt => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
type R01 = () => number;
const R_ = (rng: R01) => ({ r: (a: number, b: number) => a + rng() * (b - a), i: (a: number, b: number) => a + Math.floor(rng() * (b - a + 1)), p: <T>(a: readonly T[]): T => { const v = a[Math.floor(rng() * a.length)] ?? a[0]; if (v === undefined) throw new Error('empty'); return v; } });

export function mulberry(a: number): R01 { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function crSpline(cp: Pt[], n = 18): Pt[] {
  // centripetal Catmull-Rom through every control point (no cusps inside a segment)
  const c0 = at(cp, 0), c1 = at(cp, 1), cl = lastOf(cp), cl1 = at(cp, cp.length - 2);
  const C: Pt[] = [[2 * c0[0] - c1[0], 2 * c0[1] - c1[1]], ...cp, [2 * cl[0] - cl1[0], 2 * cl[1] - cl1[1]]];
  const out: Pt[] = [], kd = (a: Pt, b: Pt) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
  const lt = (a: Pt, b: Pt, ta: number, tb: number, t: number): Pt => { const u = (t - ta) / (tb - ta || 1e-6); return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; };
  for (let s = 0; s < C.length - 3; s++) {
    const p0 = at(C, s), p1 = at(C, s + 1), p2 = at(C, s + 2), p3 = at(C, s + 3), t1 = kd(p0, p1), t2 = t1 + kd(p1, p2), t3 = t2 + kd(p2, p3);
    for (let k = 0; k < n; k++) {
      const t = t1 + (t2 - t1) * k / n, A1 = lt(p0, p1, 0, t1, t), A2 = lt(p1, p2, t1, t2, t), A3 = lt(p2, p3, t2, t3, t);
      out.push(lt(lt(A1, A2, 0, t2, t), lt(A2, A3, t1, t3, t), t1, t2, t));
    }
  }
  out.push([cl[0], cl[1]]);
  return out;
}
const fnPts = (f: (t: number) => Pt, a: number, b: number, n = 400): Pt[] => { const o: Pt[] = []; for (let k = 0; k <= n; k++) o.push(f(a + (b - a) * k / n)); return o; };
// back-and-forth legs joined by semicircle turns of radius r; each leg also drops by `drop`
function snake(legs: number, len: number, r: number, drop: number): Pt[] {
  const o: Pt[] = []; let y = 0;
  for (let k = 0; k < legs; k++) {
    const dir = k % 2 ? -1 : 1, x0 = dir > 0 ? 0 : len, x1 = len - x0;
    for (let s = 0; s <= 20; s++) o.push([x0 + (x1 - x0) * s / 20, y + drop * s / 20]);
    y += drop;
    if (k < legs - 1) for (let s = 1; s < 16; s++) { const a = -Math.PI / 2 + Math.PI * s / 16; o.push([x1 + dir * r * Math.cos(a), y + r + r * Math.sin(a)]); }
    y += 2 * r;
  }
  return o;
}
function segX(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + rx * t, a[1] + ry * t] : null;
}
// The end point for a last straight edge A -> B that must stop short of B: the first spot, at least `from` px back
// from B, that sits clear of every crossing edge in `segs` (including the ones that meet at B). null if none.
function clearEnd(A: Pt, B: Pt, segs: [Pt, Pt][], G: number, from: number, keep = 0): Pt | null {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L, xs: [number, number][] = [];
  for (const [p, q] of segs) { const P = segX(A, B, p, q); if (!P || Math.hypot(P[0] - A[0], P[1] - A[1]) < 1) continue; const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; xs.push([Math.hypot(B[0] - P[0], B[1] - P[1]), Math.max(0.35, Math.abs(ux * (q[1] - p[1]) - uy * (q[0] - p[0])) / l)]); }
  for (let back = from; back < Math.min(L * 0.7, L - keep); back += 3) if (xs.every(([d, s]) => Math.abs(d - back) * s >= G * 1.2)) return lerp2(A, B, 1 - back / L);
  return null;
}
// a half circle at the end of a row, from (x, y) to (x, y + 2R), bulging out to side `out` (+1 right, -1 left)
const uTurn = (x: number, y: number, R: number, out: number): Pt[] => { const o: Pt[] = []; for (let s = 1; s < 18; s++) { const a = -Math.PI / 2 + Math.PI * s / 18; o.push([x + out * R * Math.cos(a), y + R + R * Math.sin(a)]); } return o; };
// The v1 hand-designed shapes, kept as three of the families. cp: control points on a ~10 x 12 grid, jittered per seed.
type Classic = { cp: Pt[] } | { fn: (rng: R01) => Pt[] };
const CLASSIC: Record<string, Classic> = {
  S: { cp: [[2, 1], [7.5, 1.6], [8, 4.3], [3, 6.1], [2.2, 8.9], [8, 11]] },
  loop: { cp: [[1, 11], [3.8, 9.6], [6.4, 6.8], [6.8, 3.6], [5, 1.8], [3, 2.4], [2.4, 4.8], [4, 7.2], [7, 9], [9.3, 10.6]] },
  hook: { cp: [[2.2, 1.2], [2, 6.4], [3.4, 9.8], [6.6, 9.8], [8, 6.4], [7.8, 3], [6, 1.6], [4.6, 2.8]] },
  wave: { fn: rng => { const p = snake(3, 5.5, 1.5, 0.6); return rng() < 0.5 ? p.map((q): Pt => [q[1], q[0]]) : p; } },
  wiggle: { fn: rng => { const o: Pt[] = [], n = 4 + Math.floor(rng() * 3); for (let j = 0; j <= n; j++) o.push([(j % 2 ? 7.5 : 2.5) + (rng() - 0.5) * 2.4, j * 11 / n]); return crSpline(o); } },
  alpha: { cp: [[1.5, 11], [4, 9.4], [5.2, 6.4], [7.6, 3.6], [5.2, 1.4], [2.8, 3.6], [5.2, 6.4], [6.6, 9.2], [9, 11]] },
  eight: { cp: [[5, 0.8], [8, 2.4], [8, 5], [5, 6.2], [2, 7.6], [2, 10.2], [5, 11.5], [8, 10.2], [8, 7.6], [5, 6.2], [2, 5], [2, 2.4], [3.8, 1.3]] },
  double: { cp: [[0.8, 10.5], [2.6, 9.6], [4.2, 6.6], [3.8, 3], [2.6, 2.4], [2.2, 4.6], [3.6, 8.4], [5.6, 9.8], [7.4, 6.6], [7.1, 3], [5.9, 2.4], [5.5, 4.6], [6.9, 8.4], [9.2, 10.5]] },
  pretzel: { fn: () => fnPts(t => [Math.sin(t) + 2 * Math.sin(2 * t), Math.cos(t) - 2 * Math.cos(2 * t)], 0.3, Math.PI * 2 - 0.3) },
};
const classic = (nm: string, rng: R01): Pt[] => {
  const P = CLASSIC[nm], J = GEN.jitter;
  if (!P) return [];
  return 'cp' in P ? crSpline(P.cp.map((c): Pt => [c[0] + (rng() * 2 - 1) * J, c[1] + (rng() * 2 - 1) * J])) : P.fn(rng);
};
export interface GenBox { W: number; H: number; G: number; S: number; lv: number; maxTurn: number; minCross: number; maxCross: number; minR: number; label: string }
interface Fam { name: string; lv: number[]; lenMul?: number; turn90?: number; rot?: number; flip?: number; mirror?: boolean; rev?: boolean; tries?: number; smooth?: number; gen: (rng: R01, c: GenBox) => Pt[] | null }
const pickLv = <T>(a: readonly T[], lv: number): T => { const v = a[lv] ?? a[0]; if (v === undefined) throw new Error('empty'); return v; };
// the names shown for some families' variants
const POLY_NAME: Record<number, string> = { 3: '三角迴', 4: '方迴', 5: '五角迴', 6: '六角迴' };
const EIGHT_NAME: Record<string, string> = { eight: '8字', alpha: '打個圈', double: '雙圈', pretzel: '中國結' };
const SNAKE_NAME: Record<string, string> = { S: '蛇仔', loop: '打圈', hook: '魚鈎', wave: '波浪', wiggle: '蛇仔' };
// Families. lv: the difficulty levels (0 新人, 1 熟手, 2 阿姐) that use it. gen(rng, c) draws one in css px for a box
// c.W x c.H, using c.G (gap), c.S (shortest straight), c.maxTurn, c.minCross, c.maxCross, c.minR and c.lv; it may set
// c.label for the name shown. Options: turn90 (chance to draw it for the box turned a quarter, then turn it back),
// rot (max random rotation, deg), mirror / rev (false to keep handedness / direction), flip (chance of an upside-down
// copy), lenMul (shorter allowed length, for quick sharp shapes), tries (attempts before handing over), smooth (rounding
// passes allowed: the v1 shapes rely on it; new families are drawn round enough and only get a light touch).
export const FAM: Record<string, Fam> = {
  zigzag: { name: '之字路', lv: [0, 1, 2], lenMul: 0.8, turn90: 0.35, rot: 8, gen(rng, c) {
    const { r, i } = R_(rng), gap = c.G * 1.25, minInt = 180 - c.maxTurn + 8, o: Pt[] = [];
    let rows = pickLv([i(1, 2), i(2, 3), i(3, 4)], c.lv), rowH: number;
    for (;; rows--) { rowH = (c.H - (rows - 1) * gap) / rows; if (rows === 1 || rowH >= c.S * 1.3) break; }
    if (rowH < c.S * 1.1) return null;
    let y0 = 0;
    for (let k = 0; k < rows; k++) {
      let A = clamp(rowH * r(0.6, 1), c.S * 1.1, rowH); const th = r(minInt, 100) * deg, dir = k % 2 ? -1 : 1;
      let legs = Math.max(3, Math.floor(c.W / (A * Math.tan(th / 2)))); if (legs % 2 === 0) legs--;   // odd: each row ends low, by the next row
      // legs two apart are parallel: keep them a gap apart
      while (legs > 3 && 2 * (c.W / legs) * A / Math.hypot(c.W / legs, A) < c.G * 1.1) legs -= 2;
      const dx = c.W / legs; A = Math.min(A, dx / Math.tan(minInt * deg / 2));   // never sharper than allowed
      for (let j = 0; j <= legs; j++) {
        const x = (dir > 0 ? j * dx : c.W - j * dx) + (j && j < legs ? r(-0.1, 0.1) * dx : 0);
        o.push(V(x, y0 + (j % 2 ? A * (c.lv === 2 ? r(0.72, 1) : 1) : 0)));
      }
      y0 += rowH + gap;
    }
    return o;
  } },
  wall: { name: '城牆', lv: [0, 1, 2], turn90: 0.35, rot: 6, gen(rng, c) {
    const { r, i } = R_(rng), u = Math.max(c.S, c.G) * 1.05, gap = c.G * 1.25, wave = c.lv > 0 && rng() < 0.5, o: Pt[] = [];
    if (wave) c.label = '方波';
    let rows = pickLv([2, 2, i(2, 3)], c.lv), rowH: number;
    for (;; rows--) { rowH = (c.H - (rows - 1) * gap) / rows; if (rows === 1 || rowH >= u * 1.5) break; }
    if (rowH < u) return null;
    let y0 = 0;
    for (let k = 0; k < rows; k++) {
      const dir = k % 2 ? -1 : 1, X = (x: number) => dir > 0 ? x : c.W - x, base = y0 + rowH, hMax = Math.min(rowH, u * 2.4), hWave = r(u, hMax), hFix = r(u, hMax);
      // runs alternate low / high and every row ends low; battlements start low, the square wave starts high
      let m = Math.max(wave ? 2 : 3, Math.round(c.W / (u * r(1.3, 1.9))));
      if (wave ? m % 2 : m % 2 === 0) m++;
      while (m > (wave ? 2 : 3) && c.W / m < u * 1.12) m -= 2;
      let ws = Array.from({ length: m }, () => r(1, c.lv === 2 ? 2.2 : 1.6)); const sw = ws.reduce((s, v) => s + v, 0);
      ws = ws.map(v => v / sw * c.W); if (Math.min(...ws) < u) ws = ws.map(() => c.W / m);
      let x = 0;
      for (let j = 0; j < m; j++) {
        const low = wave ? j % 2 === 1 : j % 2 === 0, y = low ? base : base - (wave ? hWave : c.lv ? r(u, hMax) : hFix), wj = num(ws, j);
        o.push(V(X(x), y), V(X(x + wj), y)); x += wj;
      }
      y0 += rowH + gap;
    }
    return o;
  } },
  bolt: { name: '閃電', lv: [0, 1, 2], lenMul: 0.55, rot: 14, flip: 0.3, gen(rng, c) {
    const { r, i } = R_(rng), n = pickLv([i(2, 3), i(3, 5), i(5, 7)], c.lv), minPhi = 180 - c.maxTurn + 6, o: Pt[] = [[0, 0]];
    const dy0 = c.H / (n + 0.5); let x = 0, y = 0, s = 1;
    for (let k = 0; k < n; k++) {
      const last = k === n - 1, phi = r(minPhi, 70) * deg, dy = dy0 * (last ? 1.5 : r(0.8, 1.15)), dx = dy / Math.tan(phi);
      if (Math.hypot(dx, dy) < c.S) return null;
      if (c.lv === 2 && k && rng() < 0.3) s = -s;
      x += s * dx; y += dy; o.push(V(x, y));
      // the jog back: long enough that this stroke and the next (parallel) one stay a gap apart
      if (!last) { x -= s * Math.max(c.S, c.G * 1.1 / Math.sin(phi)) * r(1, 1.25); o.push(V(x, y)); }
    }
    return o;
  } },
  baton: { name: '電棍', lv: [0, 1, 2], lenMul: 0.65, turn90: 0.4, rot: 10, flip: 0.3, gen(rng, c) {
    // a straight rod, a hook at the bottom, then sparks zig-zagging back up across the rod
    const { r } = R_(rng), A = c.G * r(1.15, 1.45), minInt = (180 - c.maxTurn + 8) * deg, xc = (c.minCross + 6) * deg;
    const pyLo = 2 * A * Math.tan(minInt / 2), pyHi = 2 * A / Math.tan(xc); if (pyLo > pyHi) return null;
    const py = r(pyLo, pyHi), rh = Math.max(A / 2, c.minR * 1.1), m = Math.min(c.maxCross, pickLv([4, 6, 9], c.lv), Math.floor((c.H - rh - 1.4 * c.G) / py));
    if (m < 2) return null;
    const Lr = m * py + 1.4 * c.G, o: Pt[] = [[0, 0], [0, Lr]];
    for (let s = 1; s < 16; s++) { const t = Math.PI * (1 - s / 16); o.push([rh + rh * Math.cos(t), Lr + rh * Math.sin(t)]); }
    o.push(V(2 * rh, Lr));
    let y = Lr;
    for (let j = 1; j <= m; j++) { y -= py; const amp = c.lv === 2 ? A * r(1, 1.25) : A; o.push(V(j % 2 ? -amp : amp, y)); }
    return o;
  } },
  ecg: { name: '心電圖', lv: [1, 2], lenMul: 0.8, turn90: 0.25, rot: 6, flip: 0, gen(rng, c) {
    // rows of heartbeats: flat, a sharp spike up, down below the line, back; a low bump after it when there is room
    const { r, i } = R_(rng), minInt = (180 - c.maxTurn + 3) * deg, s = c.S * 1.05, gap = c.G * 1.3;
    let rows = pickLv([1, 2, i(2, 3)], c.lv);
    const a1 = minInt / 2 + r(1, 5) * deg, a3 = Math.max(minInt - a1, 8 * deg) + r(2, 10) * deg;
    let h: number, d: number;
    for (;; rows--) { h = Math.min(s * r(1.4, 2.2), (c.H - (rows - 1) * gap) / rows / 1.6); d = Math.max(s * Math.cos(a3) * 1.05, h * r(0.35, 0.5)); if (rows === 1 || h >= s * 1.2) break; }
    if (h < s) return null;
    const w1 = h * Math.tan(a1), w2 = (h + d) * Math.tan(a1), w3 = d * Math.tan(a3), spike = w1 + w2 + w3, tw = s * 1.3;
    // the half-circle turns between rows stick out at the sides: leave room so the fit does not shrink the beats
    const pitch = h + d + gap, Wd = c.W - (rows > 1 ? pitch / 2 : 0) * (rows > 2 ? 2 : 1);
    const beats = Math.min(pickLv([2, 3, 4], c.lv), Math.floor((Wd - s) / (s + spike))); if (beats < 1) return null;
    const o: Pt[] = [], spare = (Wd - s - beats * (s + spike)) / beats, bump = spare >= s + tw;
    for (let k = 0; k < rows; k++) {
      const dir = k % 2 ? -1 : 1, X = (x: number) => dir > 0 ? x : Wd - x, yb = h + k * pitch;
      if (k) o.push(...uTurn(dir > 0 ? 0 : Wd, yb - pitch, pitch / 2, -dir));
      o.push([X(0), yb]);
      let x = 0;
      for (let b = 0; b < beats; b++) {
        x += s + (bump ? (spare - s - tw) * r(0.2, 0.6) : spare * r(0.3, 0.7));
        o.push(V(X(x), yb), V(X(x + w1), yb - h), V(X(x + w1 + w2), yb + d), V(X(x + spike), yb)); x += spike;
        if (bump) {
          // the T wave: a low smooth bump, gentle enough for the finger
          const hT = Math.min(h * 0.4, tw * tw / (Math.PI * Math.PI * c.minR * 1.2)); x += s;
          o.push(V(X(x), yb)); for (let q = 1; q < 12; q++) o.push([X(x + tw * q / 12), yb - hT * Math.sin(Math.PI * q / 12)]); x += tw; o.push(V(X(x), yb));
        }
      }
      o.push([X(Wd), yb]);
    }
    return o;
  } },
  maze: { name: '迷宮', lv: [0, 1, 2], rot: 0, gen(rng, c) {
    const { r, i } = R_(rng), cs = Math.max(c.G * 1.2, c.S * 1.05) * r(1, 1.25);
    const cols = Math.max(2, Math.min(Math.floor(c.W / cs) + 1, pickLv([3, 4, 6], c.lv))), rows = Math.max(3, Math.min(Math.floor(c.H / cs) + 1, pickLv([4, 5, 7], c.lv)));
    const N = cols * rows, want = Math.ceil(N * 0.78);
    let best: number[] = [];
    for (let t = 0; t < 30 && best.length < want; t++) {
      const seen = new Uint8Array(N), path: number[] = []; let cur = i(0, N - 1);
      const free = (q: number) => { const x = q % cols, y = (q / cols) | 0, o: number[] = []; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny * cols + nx]) o.push(ny * cols + nx); } return o; };
      for (;;) {
        seen[cur] = 1; path.push(cur); const nb = free(cur); if (!nb.length) break;
        // Warnsdorff with noise: head where the fewest ways on are left, so the walk does not wall itself in
        const sc = nb.map((q): [number, number] => [free(q).length + rng() * 1.6, q]).sort((a, b) => a[0] - b[0]); cur = sc[0]?.[1] ?? cur;
      }
      if (path.length > best.length) best = path;
    }
    const P = (q: number): Pt => [(q % cols) * cs, ((q / cols) | 0) * cs], o: Pt[] = [P(num(best, 0))];
    for (let k = 1; k < best.length - 1; k++) { const a = P(num(best, k - 1)), b = P(num(best, k)), e = P(num(best, k + 1)); if ((b[0] - a[0]) * (e[1] - b[1]) - (b[1] - a[1]) * (e[0] - b[0])) o.push(V(b[0], b[1])); }
    o.push(P(num(best, best.length - 1)));
    return o.length > 3 ? o : null;
  } },
  polyspiral: { name: '方迴', lv: [0, 1, 2], lenMul: 0.85, rot: 180, gen(rng, c) {
    const { r, p } = R_(rng), k = p(pickLv([[4, 4, 6, 3], [3, 4, 5, 6], [3, 4, 5, 6]], c.lv)), g = c.G * (k === 3 ? r(1.3, 1.55) : r(1.15, 1.4)), laps = pickLv([r(1.2, 1.9), r(1.8, 2.7), r(2.5, 3.8)], c.lv), o: Pt[] = [[0, 0]];
    c.label = POLY_NAME[k] ?? '方迴';
    if (k === 4) {
      let Lb = 0, T = 0, Rb = c.W * r(0.8, 1), B = c.H * r(0.8, 1), x = 0, y = 0;
      for (let e = 0; e < laps * 4; e++) {
        const dd = e % 4; let nx = x, ny = y;
        if (dd === 0) { nx = Rb; T += g; } else if (dd === 1) { ny = B; Rb -= g; } else if (dd === 2) { nx = Lb; B -= g; } else { ny = T; Lb += g; }
        if (Math.hypot(nx - x, ny - y) < c.S * 1.05) break;
        x = nx; y = ny; o.push(V(x, y));
      }
    } else {
      const Rc = Math.min(c.W, c.H) / 2, dL = 2 * g * Math.tan(Math.PI / k) / k; let L = 2 * Rc * Math.sin(Math.PI / k), h = 0, x = 0, y = 0;
      for (let e = 0; e < laps * k && L >= c.S * 1.05; e++, L -= dL) { x += L * Math.cos(h); y += L * Math.sin(h); o.push(V(x, y)); h += TAU / k; }
    }
    return o.length > 3 ? o : null;
  } },
  star: { name: '星形', lv: [0, 1, 2], rot: 180, gen(rng, c) {
    // a polygon or star polygon {n/k} in one stroke, drawn the way a hand does: run in through the first tip along the
    // first edge, all the way round, and out through the same tip along the last edge, so the two ends cross there
    const { r, p } = R_(rng), [n, k] = p(pickLv<readonly (readonly [number, number])[]>([[[3, 1], [4, 1], [5, 1], [6, 1]], [[5, 1], [6, 1], [7, 2]], [[5, 2], [7, 2], [8, 3]]], c.lv));
    c.label = (k === 1 ? ['', '', '', '三角形', '四方形', '五邊形', '六邊形'][n] : ['', '', '', '', '', '五角星', '', '七角星', '八角星'][n]) ?? '';
    const Rc = Math.min(c.W, c.H) / 2, a0 = rng() * TAU, sq = c.lv ? r(0.9, 1.1) : 1, v = (j: number): Pt => [Rc * Math.cos(a0 + TAU * j * k / n), Rc * sq * Math.sin(a0 + TAU * j * k / n)];
    const tip = Math.PI * (1 - 2 * k / n), tail = c.G * r(1.25, 1.45) / Math.sin(Math.min(tip, Math.PI - tip, Math.PI / 2)), out = (a: Pt, b: Pt): Pt => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [b[0] + (b[0] - a[0]) / l * tail, b[1] + (b[1] - a[1]) / l * tail]; };
    const o: Pt[] = [out(v(1), v(0)), v(0)]; for (let j = 1; j < n; j++) { const q = v(j); o.push(V(q[0], q[1])); }
    o.push(v(0), out(v(n - 1), v(0)));
    return o;
  } },
  magic: { name: '魔法陣', lv: [0, 1, 2], rot: 180, gen(rng, c) {
    // round the circle, then straight in to a corner of a polygon inside, round it (either way) and stop short of the
    // corner. Stars stay in their own family: a star inside the circle leaves no clean place to end.
    const { r, p } = R_(rng), n = p(pickLv([[3, 4, 5], [4, 5, 6], [6, 7, 8]], c.lv)), dir = c.lv && rng() < 0.5 ? -1 : 1;
    const Rc = Math.min(c.W, c.H) / 2, te = rng() * TAU, dl = 2 * Math.asin(Math.min(0.9, 1.5 * c.G / (2 * Rc))), rho = c.lv ? r(0.6, 0.7) : r(0.58, 0.64);
    const vv = (j: number): Pt => [rho * Rc * Math.cos(te + dir * TAU * j / n), rho * Rc * Math.sin(te + dir * TAU * j / n)];
    const o = fnPts(t => [Rc * Math.cos(t), Rc * Math.sin(t)], te + dl, te + TAU, 90);
    o[o.length - 1] = V(Rc * Math.cos(te), Rc * Math.sin(te));
    const segs: [Pt, Pt][] = [[lastOf(o), vv(0)]]; for (let j = 0; j < n - 1; j++) segs.push([vv(j), vv(j + 1)]);
    const end = clearEnd(vv(n - 1), vv(0), segs, c.G, c.G * r(1.3, 1.6), c.S * 1.1); if (!end) return null;
    for (let j = 0; j < n; j++) { const q = vv(j); o.push(V(q[0], q[1])); }
    o.push(end);
    return o;
  } },
  tornado: { name: '龍捲風', lv: [0, 1, 2], rot: 8, flip: 0, gen(rng, c) {
    // a funnel scribbled in one stroke: bowed sweeps back and forth, each narrower than the last, joined by finger-wide
    // U-turns, the funnel leaning and wandering a little, and a short tail down to the ground at the bottom. (A drawn
    // coil looks more like a tornado but its turns meet at the sides almost tangent, which a finger cannot read.)
    const { r } = R_(rng), R = Math.max(c.minR * r(1.08, 1.2), c.G * 0.6), dy = 2 * R, bow = dy * r(0.15, 0.35), tail = c.G * r(1.3, 1.7);
    const m = Math.min(pickLv([r(3.6, 4.6), r(5, 6.5), r(6.5, 8.5)], c.lv) | 0, Math.floor((c.H - tail - bow) / dy) + 1); if (m < 3) return null;
    const lean = r(-0.5, 0.5) * R, sway = r(0, 0.6) * R, ph = rng() * TAU, w0 = c.W / 2 - R, w1 = Math.max(w0 * r(0.2, 0.35), R * 1.6);
    const cx = (k: number) => lean * k + sway * Math.sin(ph + k * 1.3), hw = (k: number) => w0 + (w1 - w0) * k / (m - 1);
    // sweep k runs from where the last U-turn left it to its own end, on the other side
    const o: Pt[] = []; let x = cx(0) - hw(0), side = 1;
    for (let k = 0; k < m; k++) {
      const y = k * dy, xe = cx(k) + side * hw(k), n = Math.max(8, Math.ceil(Math.abs(xe - x) / 6));
      for (let s = k ? 1 : 0; s <= n; s++) { const t = s / n; o.push([x + (xe - x) * t, y + bow * Math.sin(Math.PI * t)]); }
      if (k < m - 1) { for (let s = 1; s < 18; s++) { const a = Math.PI * s / 18; o.push([xe + side * R * Math.sin(a), y + R - R * Math.cos(a)]); } }
      x = xe; side = -side;
    }
    // the tail: a quarter turn down and a short drop
    const yl = (m - 1) * dy, sd = -side;
    for (let s = 1; s <= 9; s++) { const a = Math.PI / 2 * s / 9; o.push([x + sd * R * Math.sin(a), yl + R - R * Math.cos(a)]); }
    o.push([x + sd * R, yl + R + tail]);
    return o;
  } },
  spiral: { name: '蚊香', lv: [0, 1, 2], rot: 180, gen(rng, c) {
    const { r, p } = R_(rng), kind = c.lv ? p(['plain', 'tail', 'tail', 'double']) : 'plain';
    const e = c.lv ? r(0.82, 1) : 1, g = c.G * r(1.18, 1.4) / e, rin = Math.max(c.minR * 1.35, g * 0.55), a0 = rng() * TAU;
    const atp = (cx: number, th: number, aa: number): Pt => { const rr = rin + g * th / TAU; return [cx + rr * Math.cos(th + aa), e * rr * Math.sin(th + aa)]; };
    if (kind === 'double') {
      // two coils, point-symmetric, joined through the middle in an S
      c.label = '雙漩渦';
      const Rm = Math.min((c.W - 1.4 * c.G) / 4, c.H / 2 / e), turns = Math.min((Rm - rin) / g, pickLv([0, 1.8, 2.4], c.lv)) * r(0.85, 1);
      if (turns < 1) return null;
      const D = 2 * (rin + g * turns) + 1.4 * c.G, aa = -Math.PI / 2 - TAU * turns, NN = Math.ceil(turns * 18), cp: Pt[] = [];
      for (let s = 0; s <= NN; s++) cp.push(atp(-D / 2, TAU * turns * s / NN, aa));
      for (let s = NN; s >= 0; s--) { const q = atp(-D / 2, TAU * turns * s / NN, aa); cp.push([-q[0], -q[1]]); }
      return crSpline(cp, 8);
    }
    const Rc = Math.min(c.W / 2, c.H / 2 / e);
    let turns = Math.min((Rc - rin) / g, pickLv([2.4, 3.4, 4.2], c.lv)) * r(0.8, 1);
    if (kind === 'tail') {
      // coil in, then a straight line out across every ring
      c.label = '漩渦';
      const full = Math.floor(turns - 0.3); if (full < 1) return null;
      turns = Math.min(turns, full + r(0.3, 0.7));
      const o = fnPts(th => atp(0, th, a0), 0, TAU * turns, Math.ceil(turns * 72)).reverse();
      const ol = lastOf(o); o[o.length - 1] = V(ol[0], ol[1]);
      const rEnd = rin + g * (full + 1.2);
      for (let s = 1; s <= 12; s++) { const rr = rin + (rEnd - rin) * s / 12; o.push([rr * Math.cos(a0), e * rr * Math.sin(a0)]); }
      return o;
    }
    if (turns < 1) return null;
    return fnPts(th => atp(0, th, a0), 0, TAU * turns, Math.ceil(turns * 72));
  } },
  rings: { name: '雙環', lv: [0, 1, 2], rot: 180, gen(rng, c) {
    // two overlapping rings: almost all the way round the first to where they meet, a sharp turn onto the second, and
    // almost all the way round that; the rings cross once more on the far side. Sizes, overlap and the way round vary.
    const { r } = R_(rng), k = c.lv ? r(0.85, 1.35) : r(1.15, 1.35), q = c.lv ? r(0.75, 1) : 1, Ra = Math.min(c.W / (1 + q + k), c.H / 2), Rb = Ra * q, D = Ra * k;
    if (Rb < c.minR * 1.6 || D <= Math.abs(Ra - Rb) + c.G || D >= Ra + Rb - c.G * 0.8) return null;
    const xP = (D * D + Ra * Ra - Rb * Rb) / (2 * D), yP = -Math.sqrt(Math.max(0, Ra * Ra - xP * xP)), tA = Math.atan2(yP, xP), tB = Math.atan2(yP, xP - D);
    // the rings meet at angle X; each ring stops short of the meeting point by enough to clear the other ring
    const X = Math.abs(tA - tB), sx = Math.max(0.35, Math.sin(Math.min(X, Math.PI - X)));
    const back = rng() < (c.lv ? 0.5 : 0), dA = 2 * Math.asin(Math.min(0.95, c.G * 0.65 / sx / Ra)), dB = 2 * Math.asin(Math.min(0.95, c.G * 0.65 / sx / Rb));
    const o = fnPts(t => [Ra * Math.cos(t), Ra * Math.sin(t)], tA + dA, tA + TAU, 90);
    o[o.length - 1] = V(xP, yP);
    return o.concat(fnPts(t => [D + Rb * Math.cos(t), Rb * Math.sin(t)], tB, back ? tB - TAU + dB : tB + TAU - dB, 90).slice(1));
  } },
  tangle: { name: '亂線頭', lv: [0, 1, 2], lenMul: 0.8, tries: 40, rot: 180, gen(rng, c) {
    // a loose thread dropped on the counter: a few straight-ish runs joined by wide bends, turning back towards the
    // middle, with curls of mixed sizes on the runs, now on one side, now on the other. A curl that moves on >= 1.5 x
    // its radius crosses itself at a clear angle, and curls sit a gap apart (the 彈簧 rule). The runs
    // may cross each other; the checks keep those crossings square enough.
    const { r, i } = R_(rng), o: Pt[] = [], curls = pickLv([1, i(1, 2), i(2, 3)], c.lv), legs = curls + pickLv([i(0, 1), i(1, 2), i(1, 2)], c.lv), has: number[] = [];
    for (let j = 0; j < legs; j++) has.push(j < curls ? 1 : 0);
    for (let j = has.length - 1; j > 0; j--) { const q = Math.floor(rng() * (j + 1)), t = num(has, j); has[j] = num(has, q); has[q] = t; }   // at most one curl a run
    let x = r(0.1, 0.9) * c.W, y = r(0.1, 0.9) * c.H, h = Math.atan2(c.H / 2 - y, c.W / 2 - x) + r(-0.4, 0.4);
    const fwd = (L: number) => { const n = Math.max(2, Math.ceil(L / 4)); for (let s = 1; s <= n; s++) o.push([x + Math.cos(h) * L * s / n, y + Math.sin(h) * L * s / n]); x += Math.cos(h) * L; y += Math.sin(h) * L; };
    o.push([x, y]);
    for (let j = 0; j < legs; j++) {
      const nc = num(has, j);
      fwd(c.G * r(0.9, 1.2));
      let sg = rng() < 0.5 ? 1 : -1;
      for (let k = 0; k < nc; k++) {
        const ka = r(1.5, 1.8), rr = c.minR * r(1.12, 1.25) / (1 - ka / TAU) ** 2, a = rr * ka,   // top of the curl: (rr - a/2pi)^2 / rr
          gp = Math.max(c.S * 0.6, c.G + 2 * rr - 1.5 * a) * r(1.05, 1.4), ux = Math.cos(h), uy = Math.sin(h);
        if (k) fwd(gp);
        for (let q = 1; q < 48; q++) { const th = q / 48 * TAU, al = a * th / TAU + rr * Math.sin(th), off = sg * rr * (1 - Math.cos(th)); o.push([x + ux * al - uy * off, y + uy * al + ux * off]); }
        x += ux * a; y += uy * a; o.push([x, y]);
        if (rng() < 0.6) sg = -sg;
      }
      fwd(nc ? c.G * r(0.9, 1.2) : Math.min(c.W, c.H) * r(0.25, 0.45));
      if (j === legs - 1) break;
      // a wide bend back towards the middle
      const want = Math.atan2(c.H / 2 - y, c.W / 2 - x); let dh = want - h; while (dh > Math.PI) dh -= TAU; while (dh < -Math.PI) dh += TAU;
      const t = (Math.sign(dh) || 1) * (c.lv ? r(80, 150) : r(55, 120)) * deg, Rf = c.minR * r(2, 2.6), sgn = Math.sign(t), cx = x - sgn * Rf * Math.sin(h), cy = y + sgn * Rf * Math.cos(h), n = Math.ceil(Math.abs(t) / (6 * deg));
      for (let s = 1; s <= n; s++) { const hh = h + t * s / n; o.push([cx + sgn * Rf * Math.sin(hh), cy - sgn * Rf * Math.cos(hh)]); }
      h += t; const ol = lastOf(o); x = ol[0]; y = ol[1];
    }
    // no shrinking to fit: a thread bigger than the box comes back to try again
    const xs = o.map(q => q[0]), ys = o.map(q => q[1]);
    return Math.max(...xs) - Math.min(...xs) > c.W * 1.02 || Math.max(...ys) - Math.min(...ys) > c.H * 1.02 ? null : o;
  } },
  spring: { name: '彈簧', lv: [1, 2], lenMul: 0.8, turn90: 0.3, rot: 10, gen(rng, c) {
    // rows of loops on a line, rows joined by half circles; on 阿姐 the loops may alternate above and below. A loop
    // that moves on a >= 1.5 r while it turns crosses itself at about 50 degrees or more. The path starts and ends
    // with a longer straight, so its ends stay clear of the loops.
    const { r, i } = R_(rng), alt = c.lv === 2 && rng() < 0.5, rr = c.minR * r(1.85, 2.3), a = rr * r(1.5, 1.85), gp = Math.max(c.S * 0.6, c.G + 2 * rr - 1.5 * a) * r(1, 1.2);
    const rowH = (alt ? 4 : 2) * rr, R2 = (rowH + c.G * 1.3) / 2, rows = Math.max(1, Math.min(pickLv([2, 2, i(2, 3)], c.lv), Math.floor((c.H + c.G * 1.3) / (2 * R2))));
    // the half-circle turns stick out at the sides: leave room so the fit does not shrink the loops
    const Wd = c.W - R2 * (rows > 2 ? 2 : rows > 1 ? 1 : 0), lead = Math.max(gp, c.G * 1.7), loops = Math.min(pickLv([3, 4, 4], c.lv), Math.floor((Wd - 2 * lead + gp) / (a + gp))); if (loops < 1) return null;
    const inner = loops * a + (loops - 1) * gp, w = inner + 2 * lead, o: Pt[] = [];
    for (let k = 0; k < rows; k++) {
      const dir = k % 2 ? -1 : 1, y0 = k * 2 * R2 + 2 * rr, X = (u: number) => dir > 0 ? u : w - u;
      const start = k === 0 ? lead : k === rows - 1 ? w - inner - lead : (w - inner) / 2;
      let u = 0;
      for (let l = 0; l < loops; l++) {
        const sg = alt && l % 2 ? 1 : -1, run = l ? gp : start;
        for (let s = 0; s < 8; s++) o.push([X(u + run * s / 8), y0]);
        u += run;
        for (let s = 0; s < 48; s++) { const th = s / 48 * TAU; o.push([X(u + a * th / TAU + rr * Math.sin(th)), y0 + sg * rr * (1 - Math.cos(th))]); }
        u += a;
      }
      for (let s = 0; s <= 8; s++) o.push([X(u + (w - u) * s / 8), y0]);
      if (k < rows - 1) o.push(...uTurn(X(w), y0, R2, dir));
    }
    return o;
  } },
  script: { name: '草書', lv: [0, 1, 2], lenMul: 0.6, tries: 40, rot: 6, mirror: false, rev: false, gen(rng, c) {
    // joined-up handwriting: each letter is a pen loop - curve up off the line, a straight up-stroke, round over the
    // top (a finger-wide arc), a straight down-stroke that crosses the up-stroke at a clear angle, and curve back onto
    // the line. Small loops (e), tall loops (l) and loops below the line (g / y); each letter starts a gap clear of
    // the last. From 熟手 a flourish swings back underneath the word.
    const { r, p } = R_(rng), sh = r(0.05, 0.2), o: Pt[] = [[0, 0]];
    const want = Math.round(pickLv([r(2, 3), r(3, 4), r(3.5, 5)], c.lv));
    // turtle in math coords (y up), heading in degrees; arcs turn left for t > 0
    const turtle = (cmds: (readonly ['L', number] | readonly ['A', number, number])[]): Pt[] => {
      let x = 0, y = 0, h = 0; const P: Pt[] = [[0, 0]];
      for (const cm of cmds) {
        if (cm[0] === 'L') { const a = cm[1], n = Math.max(2, Math.ceil(a / 4)); for (let s = 1; s <= n; s++) P.push([x + a * s / n * Math.cos(h * deg), y + a * s / n * Math.sin(h * deg)]); const q = lastOf(P); x = q[0]; y = q[1]; }
        else {
          const rad = cm[1], t = cm[2], n = Math.max(3, Math.ceil(Math.abs(t) / 6)), sg = Math.sign(t), cx = x - sg * rad * Math.sin(h * deg), cy = y + sg * rad * Math.cos(h * deg);
          for (let s = 1; s <= n; s++) { const hh = (h + t * s / n) * deg; P.push([cx + sg * rad * Math.sin(hh), cy - sg * rad * Math.cos(hh)]); }
          h += t; const q = lastOf(P); x = q[0]; y = q[1];
        }
      }
      return P;
    };
    let end = c.G * r(0.6, 1), u = -1e9, hasLow = false;
    for (let k = 0; k < want; k++) {
      const g = p(['e', 'e', 'l', 'l', 'g']), rf = c.minR * 1.15, rl = c.minR * r(1.2, 1.4), a1 = r(44, 54), a2 = 360 - a1 + r(-3, 5);
      // up-stroke heading a1, down-stroke heading a2 after the loop; the strokes cross where the loop's tangents meet, so
      // the up-stroke runs that far plus enough to lift the crossing clear of the line
      const td = rl / Math.tan((a2 - a1 - 180) / 2 * deg), up = td + c.G * r(0.4, 0.6) / Math.sin(a1 * deg) + (g === 'e' ? 0 : r(0.5, 1) * rl);
      // land the down-stroke where the last fillet brings it back to the line
      const pre = turtle([['A', rf, a1], ['L', up], ['A', rl, a2 - a1]]), ye = lastOf(pre)[1], yWant = rf * (1 - Math.cos((360 - a2) * deg));
      const down = (ye - yWant) / -Math.sin(a2 * deg);
      if (down < rl) continue;
      const L = turtle([['A', rf, a1], ['L', up], ['A', rl, a2 - a1], ['L', down], ['A', rf, 360 - a2]]).map((q): Pt => [q[0], g === 'g' ? q[1] : -q[1]]);
      const minX = Math.min(...L.map(q => q[0])), maxX = Math.max(...L.map(q => q[0]));
      const x0 = Math.max(end, u + c.G * 0.2 - minX);   // the checks decide how close two letters may sit
      if (k && x0 + maxX + c.G * 0.3 > c.W) break;
      if (g === 'g') hasLow = true;
      for (const q of L) o.push([x0 + q[0], q[1]]);
      u = x0 + maxX; end = x0 + lastOf(L)[0] + c.G * r(0.2, 0.6);
    }
    const xe = Math.max(end, u + c.G * 0.6) + c.G * r(0.3, 0.6); o.push([xe, 0]);
    if (!hasLow && (c.lv || rng() < 0.3)) {
      // the flourish: down and back left under the word, clear of any loop below the line
      const h0 = c.minR * 2, dy = 1.3 * h0 + c.G, cp: Pt[] = [[xe, 0], [xe + h0 * 0.9, dy * 0.45], [xe, dy], [xe * 0.5, dy * 1.05], [h0 * 0.3, dy * 0.95], [-h0 * 0.5, dy * 0.6]];
      o.push(...crSpline(cp, 12).slice(1));
    }
    // slant: x moves right with height (y is down on screen); a word too big for the box would shrink its loops
    const w = o.map((q): Pt => [q[0] - sh * q[1], q[1]]), xs = w.map(q => q[0]), ys = w.map(q => q[1]);
    return Math.max(...xs) - Math.min(...xs) > c.W || Math.max(...ys) - Math.min(...ys) > c.H ? null : w;
  } },
  eight: { name: '8字', lv: [1, 2], smooth: 90, gen(rng, c) { const nm = R_(rng).p(pickLv([[], ['eight', 'alpha', 'double', 'pretzel'], ['double', 'pretzel', 'eight']], c.lv)); c.label = EIGHT_NAME[nm] ?? '8字'; return classic(nm, rng); } },
  snake: { name: '蛇仔', lv: [0, 1], lenMul: 0.8, smooth: 90, gen(rng, c) { const nm = R_(rng).p(['S', 'loop', 'hook', 'wave', 'wiggle']); c.label = SNAKE_NAME[nm] ?? '蛇仔'; return classic(nm, rng); } },
};
export function plen(p: readonly Pt[]): number { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(at(p, i)[0] - at(p, i - 1)[0], at(p, i)[1] - at(p, i - 1)[1]); return L; }
export function resample(p: readonly Pt[], step: number): Pt[] {
  // a sample every `step` px along the polyline; a marked corner always gets a sample of its own, exactly on it
  const p0 = at(p, 0), out: Pt[] = [[p0[0], p0[1]]]; let need = step, i = 1, prev: Pt = p0;
  while (i < p.length) {
    const q = at(p, i), d = Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    if (d >= need) { const u = need / d; prev = [prev[0] + (q[0] - prev[0]) * u, prev[1] + (q[1] - prev[1]) * u]; out.push(prev); need = step; }
    else {
      need -= d; prev = q; i++;
      if (q[2] && i < p.length) { const l = lastOf(out); if (step - need < step * 0.4 && out.length > 1 && !l[2]) out[out.length - 1] = [q[0], q[1], 1]; else out.push([q[0], q[1], 1]); need = step; }
    }
  }
  const last = lastOf(p), lo = lastOf(out); if (Math.hypot(last[0] - lo[0], last[1] - lo[1]) > step * 0.3) out.push([last[0], last[1]]);
  return out;
}
export function fitTo(p: readonly Pt[], R: Rect): Pt[] {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const q of p) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  const s = Math.min(R.w / Math.max(1e-6, x1 - x0), R.h / Math.max(1e-6, y1 - y0)), ox = R.x + (R.w - (x1 - x0) * s) / 2, oy = R.y + (R.h - (y1 - y0) * s) / 2;
  return p.map((q): Pt => q[2] ? [ox + (q[0] - x0) * s, oy + (q[1] - y0) * s, 1] : [ox + (q[0] - x0) * s, oy + (q[1] - y0) * s]);
}
export interface CurveInfo { n: number; cum: Float64Array; len: number; corners: number[]; nearC: Uint8Array; rad: Float64Array; minR: number; back: (i: number, s: number) => number; fwd: (i: number, s: number) => number }
// Arc length, corners and the radius of curvature at each sample (circumradius over a ~10 px chord either side; left
// out within 12 px of a marked corner, where the turn is meant to be sharp).
export function curveInfo(pts: readonly Pt[]): CurveInfo {
  const n = pts.length, cum = new Float64Array(n), corners: number[] = [];
  for (let i = 1; i < n; i++) cum[i] = num(cum, i - 1) + Math.hypot(at(pts, i)[0] - at(pts, i - 1)[0], at(pts, i)[1] - at(pts, i - 1)[1]);
  for (let i = 1; i < n - 1; i++) if (at(pts, i)[2]) corners.push(i);
  const back = (i: number, s: number) => { let j = i; while (j > 0 && num(cum, i) - num(cum, j) < s) j--; return j; }, fwd = (i: number, s: number) => { let j = i; while (j < n - 1 && num(cum, j) - num(cum, i) < s) j++; return j; };
  const nearC = new Uint8Array(n); for (const c of corners) for (let j = back(c, 12); j <= fwd(c, 12); j++) nearC[j] = 1;
  const rad = new Float64Array(n).fill(1e9); let minR = 1e9;
  for (let i = 0; i < n; i++) {
    if (nearC[i] || num(cum, i) < 10 || num(cum, n - 1) - num(cum, i) < 10) continue;
    const a = at(pts, back(i, 10)), b = at(pts, i), c = at(pts, fwd(i, 10)), cr = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    const rr = cr < 1e-6 ? 1e9 : Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(a[0] - c[0], a[1] - c[1]) / (2 * cr);
    rad[i] = rr; if (rr < minR) minR = rr;
  }
  return { n, cum, len: num(cum, n - 1), corners, nearC, rad, minR, back, fwd };
}
// Smooth only where the curve is tighter than minR (and a few samples around it), never at a marked corner.
function smooth(p: readonly Pt[], minR: number): Pt[] {
  const q = resample(p, 6), n = q.length, mask = new Uint8Array(n), hold = new Uint8Array(n), k = 2, spread = 4;
  for (let i = 0; i < n; i++) if (at(q, i)[2]) for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) hold[j] = 1;
  for (let i = k; i < n - k; i++) {
    if (hold[i]) continue;
    const a = at(q, i - k), b = at(q, i), c = at(q, i + k), cr = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    const r = cr < 1e-6 ? 1e9 : Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(a[0] - c[0], a[1] - c[1]) / (2 * cr);
    if (r < minR * 1.25) for (let j = Math.max(1, i - spread); j <= Math.min(n - 2, i + spread); j++) mask[j] = 1;
  }
  const o = q.map((v): Pt => [v[0], v[1], v[2]]);
  for (let i = 1; i < n - 1; i++) if (mask[i] && !hold[i]) { const a = at(q, i - 1), b = at(q, i), c = at(q, i + 1), d = at(o, i); d[0] = 0.25 * a[0] + 0.5 * b[0] + 0.25 * c[0]; d[1] = 0.25 * a[1] + 0.5 * b[1] + 0.25 * c[1]; }
  return o.map((v): Pt => v[2] ? [v[0], v[1], 1] : [v[0], v[1]]);
}
export interface PathCheck { len: number; corners: number[]; turns: number[]; maxTurn: number; minSeg: number; minR: number; crossings: number; crowd: number; rad: Float64Array; cum: Float64Array; why: string; at?: [Pt, Pt] | null }
// Everything a finger needs, measured on the resampled path in css px. Returns the stats and `why`: the first rule
// broken ('' = fine). Rules: inside the rect; no corner sharper than maxTurn; no straight between corners (or an end)
// shorter than minSeg; curves no tighter than minR; two strokes that are not the same bend never closer than `gap`
// unless they cross at minCross or more, never near a corner or an end; crossings at least 0.8 gap apart and no more
// than maxCross; length within lenK x sqrt(rect area).
export function checkPath(pts: readonly Pt[], d: PathRules, R: Rect, lenMul = 1): PathCheck {
  const C = curveInfo(pts), { n, cum, corners, nearC, back, fwd } = C, G = d.gap, area = Math.sqrt(R.w * R.h);
  const turns = corners.map(c => { const a = at(pts, back(c, 8)), b = at(pts, c), e = at(pts, fwd(c, 8)); const t = Math.abs(Math.atan2(e[1] - b[1], e[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) / deg; return t > 180 ? 360 - t : t; });
  const marks = [0, ...corners, n - 1]; let minSeg = 1e9, segAt: [Pt, Pt] | null = null;
  for (let k = 1; k < marks.length; k++) { const m0 = num(marks, k - 1), m1 = num(marks, k), sl = num(cum, m1) - num(cum, m0); if (sl < minSeg) { minSeg = sl; segAt = [at(pts, m0), at(pts, m1)]; } }
  const maxTurn = turns.length ? Math.max(...turns) : 0, st: PathCheck = { len: C.len, corners, turns, maxTurn, minSeg, minR: C.minR, crossings: 0, crowd: 1e9, rad: C.rad, cum, why: '' };
  const out = pts.some(q => q[0] < R.x - 1 || q[0] > R.x + R.w + 1 || q[1] < R.y - 1 || q[1] > R.y + R.h + 1);
  st.why = out ? 'out' : maxTurn > d.maxTurn ? 'sharp' : minSeg < d.minSeg ? 'short' : C.minR < d.minR ? 'tight'
    : C.len < d.lenK[0] * area * lenMul ? 'len<' : C.len > d.lenK[1] * area ? 'len>' : '';
  if (st.why === 'short') st.at = segAt;
  if (st.why) return st;
  const tan = pts.map((_, i): [number, number] => { const a = at(pts, back(i, 4)), b = at(pts, fwd(i, 4)), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; });
  const m = Math.max(1, Math.round(6 / STEP)), idx: number[] = []; for (let i = 0; i < n; i += m) idx.push(i); if (num(idx, idx.length - 1) !== n - 1) idx.push(n - 1);
  // a pair this close along the path compared with across it is one bend (a hairpin, a V at an allowed angle)
  const K = Math.max(3, 1.05 / Math.sin((180 - d.maxTurn) * deg / 2)), cosX = Math.cos(d.minCross * deg), G2 = (G * 1.1) ** 2;
  for (let a = 0; a < idx.length && !st.why; a++) for (let b = a + 1; b < idx.length; b++) {
    const i = num(idx, a), j = num(idx, b), arc = num(cum, j) - num(cum, i); if (arc < G) continue;
    const pi = at(pts, i), pj = at(pts, j), dx = pj[0] - pi[0], dy = pj[1] - pi[1], d2 = dx * dx + dy * dy; if (d2 >= G2) continue;
    const dist = Math.sqrt(d2); if (arc <= K * dist) continue;
    if (i === 0 || j === n - 1) { st.why = 'end'; st.at = [pi, pj]; break; }
    if (dist >= G) continue;
    if (nearC[i] || nearC[j]) { st.why = 'corner'; st.at = [pi, pj]; break; }
    const ti = tan[i] ?? [1, 0], tj = tan[j] ?? [1, 0];
    if (Math.abs(ti[0] * tj[0] + ti[1] * tj[1]) > cosX) { st.why = 'close'; st.at = [pi, pj]; break; }
  }
  if (st.why) return st;
  const X: Pt[] = [];
  for (let a = 0; a < idx.length - 1; a++) for (let b = a + 2; b < idx.length - 1; b++) {
    const i = num(idx, a), i2 = num(idx, a + 1), j = num(idx, b), j2 = num(idx, b + 1); if (num(cum, j) - num(cum, i2) < G) continue;
    const P = segX(at(pts, i), at(pts, i2), at(pts, j), at(pts, j2)); if (P && !X.some(q => Math.hypot(q[0] - P[0], q[1] - P[1]) < 4)) X.push(P);
  }
  for (let a = 0; a < X.length; a++) for (let b = a + 1; b < X.length; b++) st.crowd = Math.min(st.crowd, Math.hypot(at(X, a)[0] - at(X, b)[0], at(X, a)[1] - at(X, b)[1]));
  st.crossings = X.length;
  st.why = X.length > d.maxCross ? 'many' : st.crowd < G * 0.8 ? 'crowd' : '';
  return st;
}
// Par: a careful hand at parSpeed on the straights, slower in tight curves (lateral limit: full speed from rFull px),
// plus a short stop at each sharp corner that grows with the turn.
export function parOf(st: PathCheck, d: PathRules): number {
  const v = d.parSpeed, acc = v * v / PAR.rFull, { rad, cum } = st; let t = 0;
  for (let i = 1; i < cum.length; i++) t += (num(cum, i) - num(cum, i - 1)) / Math.min(v, Math.sqrt(acc * Math.min(num(rad, i), num(rad, i - 1))));
  for (const tu of st.turns) t += PAR.corner[0] + PAR.corner[1] * tu / 180;
  return PAR.base + t;
}
export const famsFor = (lv: number) => Object.keys(FAM).filter(f => FAM[f]?.lv.includes(lv));
export const hashStr = (s: string) => { let h = 7; for (const ch of s) h = (h * 31 + (ch.codePointAt(0) ?? 0)) | 0; return h; };
export interface TryResult { pts: Pt[]; st: PathCheck; label: string; passes: number }
// One attempt at family f. Returns the fitted, resampled path and its check, or null when the family drew nothing.
export function tryPath(f: string, d: PathRules, seed: number, tr: number, R: Rect): TryResult | null {
  const F = FAM[f]; if (!F) return null;
  const rng = mulberry(seed * 7919 + tr * 104729 + hashStr(f));
  const swap = F.turn90 !== undefined && F.turn90 > 0 && rng() < F.turn90, c: GenBox = { W: swap ? R.h : R.w, H: swap ? R.w : R.h, G: d.gap, S: d.minSeg, lv: d.lv, maxTurn: d.maxTurn, minCross: d.minCross, maxCross: d.maxCross, minR: d.minR, label: '' };
  let raw = F.gen(rng, c); if (!raw || raw.length < 2) return null;
  const r0 = at(raw, 0), rl = lastOf(raw);
  raw[0] = [r0[0], r0[1]]; raw[raw.length - 1] = [rl[0], rl[1]];   // the two ends are never corners
  const mk = (x: number, y: number, k: number | undefined): Pt => k ? [x, y, 1] : [x, y];
  if (swap) raw = raw.map(q => mk(q[1], -q[0], q[2]));
  if (F.mirror !== false && rng() < 0.5) raw = raw.map(q => mk(-q[0], q[1], q[2]));
  if (F.flip && rng() < F.flip) raw = raw.map(q => mk(q[0], -q[1], q[2]));
  if (F.rev !== false && rng() < 0.5) raw = raw.slice().reverse();
  const a = (rng() * 2 - 1) * (F.rot ?? GEN.rot) * deg, ca = Math.cos(a), sa = Math.sin(a);
  raw = raw.map(q => mk(q[0] * ca - q[1] * sa, q[0] * sa + q[1] * ca, q[2]));
  let cur = fitTo(raw, R), pts = resample(cur, STEP), mr = curveInfo(pts).minR, passes = 0;
  while (mr < d.minR && passes < (F.smooth || GEN.smoothMax)) { for (let k = 0; k < 4; k++) cur = smooth(cur, d.minR); cur = fitTo(cur, R); pts = resample(cur, STEP); mr = curveInfo(pts).minR; passes++; }
  return { pts, st: checkPath(pts, d, R, F.lenMul ?? 1), label: c.label || F.name, passes };
}
export interface TiePath { name: string; fam: string; seed: number; pts: Pt[]; step: number; len: number; minR: number; passes: number; R: Rect; tries: number; corners: number[]; crossings: number; par: number }
// Build a traceable path of family `fam` (default: one picked by the seed) for a difficulty inside rect R (css px).
// Deterministic for a seed. A family that cannot make a good one in `tries` hands over to the other families.
export function buildPath(d: PathRules, rookie: PathRules, seed: number, R: Rect, fam?: string): TiePath {
  const list = famsFor(d.lv), first = fam ?? list[seed % list.length] ?? 'snake';
  const order = [first, ...list.filter(f => f !== first).sort((a, b) => hashStr(a + String(seed)) - hashStr(b + String(seed)))];
  let tries = 0;
  for (const f of order) for (let tr = 0; tr < (FAM[f]?.tries ?? GEN.tries); tr++) {
    tries++; const T = tryPath(f, d, seed, tr, R); if (!T || T.st.why) continue;
    return { name: T.label, fam: f, seed, pts: T.pts, step: STEP, len: T.st.len, minR: T.st.minR, passes: T.passes, R, tries, corners: T.st.corners, crossings: T.st.crossings, par: parOf(T.st, d) };
  }
  const T = tryPath('snake', rookie, seed, 0, R);   // never seen in the checks; a plain S as the last resort
  if (!T) throw new Error('the last-resort path failed');
  return { name: T.label, fam: 'snake', seed, pts: T.pts, step: STEP, len: T.st.len, minR: T.st.minR, passes: T.passes, R, tries, corners: T.st.corners, crossings: T.st.crossings, par: parOf(T.st, d) };
}
