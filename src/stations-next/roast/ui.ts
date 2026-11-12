// The 燒味 screen: the original prototype's drawing and touch input, drawn from the station state. The pixel
// art, colours, text and layout are the prototype's, line for line; the only changes are where things live (the finger, the
// board and the plate are in the core state; customer walk-in positions and particles are screen-only).
import { BASE, BASES, DEFAULT_VIEW, LY, MEAT, TUNE, boardDone, boardMarks, guideMode, lastCut, layout, nextStep, ticketSteps, uncut, widths, type Board, type Customer, type Fx, type Layout, type MeatK, type Order, type Plate, type RoastCmd, type RoastState } from './core';
import { INK, beginScene, hash, pixels, shake, texts, type Scene, type Sound } from '../lab-kit';

const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
const sum = (a: readonly number[]) => a.reduce((s, v) => s + v, 0);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pickR = (a: readonly string[]) => a[Math.floor(Math.random() * a.length)] ?? INK;
const FAMILY = '"PingFang HK","Noto Sans HK","Microsoft JhengHei",sans-serif';

/* ---------- sound (the prototype's SFX on the injected Sound) ---------- */
function sfx(snd: Sound) {
  const { tone, noise } = snd;
  return {
    thunk() { tone(120, 0.1, 'square', 0.07, 55); noise(0.07, 0.12, 350); noise(0.03, 0.05, 2500, 0.005); },   // cleaver into the board
    slice() { noise(0.05, 0.03, 3200, 0, 3); },                                       // knife drawing through 叉燒
    sliced(n: number) { noise(0.1, 0.06, 2400, 0, 2); tone(1500 + n * 120, 0.06, 'triangle', 0.03); },
    splinter() { tone(2600, 0.03, 'square', 0.03); noise(0.08, 0.06, 5000, 0.01, 2); },
    hook() { tone(1800, 0.04, 'triangle', 0.03); tone(2400, 0.05, 'triangle', 0.02, 0, 0.03); },
    plop() { tone(420, 0.1, 'sine', 0.05, 200); },
    pour() { noise(0.09, 0.02, 700, 0, 2); },
    pick() { tone(700, 0.04, 'square', 0.025); },
    ding() { tone(1320, 0.1, 'sine', 0.05); tone(1760, 0.14, 'sine', 0.05, 0, 0.08); },
    combo(n: number) { const f = 660 * Math.pow(1.122, Math.min(10, n)); tone(f, 0.08, 'square', 0.03); tone(f * 1.5, 0.08, 'square', 0.02, 0, 0.05); },
    bad() { tone(150, 0.14, 'square', 0.06, 90); },
    leave() { tone(500, 0.2, 'triangle', 0.04, 250); },
  };
}

/* ---------- drawing: colours ---------- */
const COL: Record<MeatK, { out: string; a: string; b: string; c: string; face: string; face2: string }> = {
  char: { out: '#3a120c', a: '#9e2a22', b: '#c94a36', c: '#4a160f', face: '#e89a8a', face2: '#d97060' },
  pork: { out: '#5a3010', a: '#e2a63a', b: '#f7d98a', c: '#b8741e', face: '#f3e6cf', face2: '#c9876e' },
  duck: { out: '#2e0e04', a: '#7a2e12', b: '#b5531f', c: '#4e1c0a', face: '#f2ddc8', face2: '#c97a5a' },
  chick: { out: '#5a3408', a: '#c8862a', b: '#f0c060', c: '#8a5410', face: '#fbf0dc', face2: '#e6c9a0' },
};
const BOARD = '#d9a866';
interface Part { x: number; y: number; vx: number; vy: number; col: string; life: number; g: number; s: number }

/** The screen for one station state. Call draw() every frame; it plays the core's fx (sound, particles, shake). */
export function roastScreen(sc: Scene, snd: Sound) {
  const { P, bx, el } = pixels(sc, true), { FONT, chipT, outlineT } = texts(sc, FAMILY), SFX = sfx(snd);
  const custX = new Map<number, number>();
  let parts: Part[] = [], fxSeen = 0;
  const df = (s: RoastState) => TUNE.diff[s.diff];

  function playFx(s: RoastState) {
    for (const f of s.fx) {
      if (f.seq <= fxSeen) continue;
      fxSeen = f.seq;
      play(f);
    }
    if (s.fxSeq < fxSeen) fxSeen = s.fxSeq;                    // a new run
  }
  function play(f: Fx) {
    if (f.kind === 'shake') shake(sc);
    else if (f.kind === 'bits') { if (Math.random() < f.p) for (let i = 0; i < f.n; i++) parts.push({ x: f.x + rnd(-1, 1), y: f.y, vx: rnd(-f.sp, f.sp), vy: rnd(-f.sp * 1.4, -f.sp * 0.3), col: pickR(f.cols), life: rnd(0.3, 0.7), g: 200, s: Math.random() < 2 / 3 ? 1 : 2 }); }
    else if (f.name === 'sliced' || f.name === 'combo') SFX[f.name](f.n);
    else SFX[f.name]();
  }
  /** Moves the particles on by dt of game time (they stop with the game). */
  function stepParts(dt: number) {
    for (const q of parts) { q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; }
    parts = parts.filter(q => q.life > 0); if (parts.length > 300) parts.splice(0, parts.length - 300);
  }
  function reset() { parts = []; custX.clear(); fxSeen = 0; }

  /* ---------- drawing: roasts ---------- */
  function drawHang(k: MeatK, cx: number, top: number, bot: number, dim: boolean) {
    const c = COL[k], h = bot - top;
    P(cx, top - 1, 1, 5, '#9aa6ad'); P(cx - 2, top + 3, 2, 1, '#9aa6ad'); P(cx - 2, top + 1, 1, 2, '#9aa6ad');
    if (k === 'char') {
      for (const dx of [-6, 1]) {
        const x = cx + dx, y = top + 5, hh = h - 7;
        P(x, y, 6, hh, c.out); P(x + 1, y + 1, 4, hh - 2, c.a); P(x + 1, y + 1, 1, hh - 2, c.b);
        for (let i = 0; i < hh - 2; i += 3) if (hash(x, i, 3) < 0.5) P(x + 1 + (i % 4 > 1 ? 3 : 0), y + 1 + i, 1, 2, c.c);
        P(x + 2, y + 2, 1, 3, '#ffb09a');
      }
      P(cx - 4, top + 4, 9, 1, '#9aa6ad');
    } else if (k === 'pork') {
      const x = cx - 11, y = top + 6, w = 22, hh = h - 9;
      P(x, y, w, hh, c.out); P(x + 1, y + 1, w - 2, hh - 2, c.a);
      for (let yy = 1; yy < hh - 2; yy++) for (let xx = 1; xx < w - 2; xx++) { const r = hash(xx, yy, 11); if (r < 0.14) P(x + xx, y + yy, 1, 1, c.b); else if (r > 0.93) P(x + xx, y + yy, 1, 1, c.c); }
      P(x + w - 3, y + 1, 2, hh - 2, '#f3e6cf'); P(x + w - 2, y + 1, 1, hh - 2, '#c9876e');
    } else {
      const duck = k === 'duck', rx = duck ? 10 : 9, ry = Math.min(duck ? 15 : 13, Math.floor((h - 12) / 2)), by = top + 10 + ry;
      P(cx - 1, top + 3, 3, 9, c.out); P(cx, top + 4, 1, 8, c.a);
      el(cx, by, rx, ry, c.a, c.out);
      el(cx - 3, by - ry * 0.35, rx * 0.35, ry * 0.45, c.b, null);
      P(cx + 3, by + ry * 0.2, 3, ry * 0.5, c.c);
      P(cx - rx + 1, by + ry - 2, 3, 3, c.c); P(cx + rx - 3, by + ry - 2, 3, 3, c.c);
      P(cx - 4, by - ry * 0.55, 1, 2, '#ffffff');
    }
    if (dim) { for (let y = top; y < bot; y += 2) for (let x = cx - 12; x < cx + 12; x += 2) if (((x + y) & 3) === 0) P(x, y, 1, 1, 'rgba(15,26,22,.5)'); }
  }
  // top inset (logical px) of the roast's outline at board x gx: bone-in birds are domed, 叉燒 has rounded corners
  function prof(b: Board, gx: number) {
    const u = clamp((gx - b.x0) / (b.x1 - b.x0), 0, 1), e = Math.min(gx - b.x0, b.x1 - gx);
    if (MEAT[b.k].bone) return Math.round((1 - Math.sin(Math.PI * (0.08 + 0.84 * u))) * b.h * 0.45) + (e < 1.5 ? 2 : 0);
    if (b.k === 'char') return e < 1.5 ? 3 : e < 3 ? 1 : 0;
    return e < 1.5 ? 1 : 0;
  }
  // one piece of the roast drawn at x, covering board span ox .. ox + w; the bottom sits on the board
  function seg(b: Board, x: number, ox: number, w: number, cy: number, faceL: boolean, faceR: boolean) {
    const k = b.k, c = COL[k], h = b.h, yb = Math.round(cy + h / 2); x = Math.round(x); w = Math.max(1, Math.round(w));
    for (let i = 0; i < w; i++) {
      const gx = ox + i, top = Math.round(cy - h / 2) + prof(b, gx), ch = yb - top, xx = x + i, edge = i === 0 || i === w - 1;
      P(xx, top, 1, ch, c.out);
      if (ch < 4 || (edge && !(i === 0 && faceL) && !(i === w - 1 && faceR) && w > 2)) continue;
      const y = top + 1, ih = ch - 2;
      if ((i === 0 && faceL) || (i === w - 1 && faceR)) {
        // a cut face shows the inside
        if (k === 'char') { P(xx, y, 1, ih, c.face2); P(xx, y + 2, 1, ih - 5, c.face); }
        else if (k === 'pork') { P(xx, y, 1, 4, c.a); P(xx, y + 4, 1, ih - 4, c.face); for (let j = y + 7; j < y + ih - 1; j += 4) P(xx, j, 1, 2, c.face2); }
        else { P(xx, y, 1, 2, c.a); P(xx, y + 2, 1, ih - 2, c.face); P(xx, y + Math.round(ih * 0.55), 1, 2, '#ffffff'); P(xx, y + Math.round(ih * 0.55) + 2, 1, 1, c.face2); }
        continue;
      }
      const g3 = (gx * 3) | 0;
      if (k === 'char') {
        P(xx, y, 1, ih, c.a); P(xx, y, 1, 2, c.c); P(xx, y + 2, 1, 1, c.b); P(xx, y + ih - 3, 1, 3, '#6e1c15');
        if (hash(g3, 1, 5) < 0.3) P(xx, y + 3 + Math.floor(hash(g3, 2, 5) * (ih - 6)), 1, 1, c.c);
        if (hash(g3, 3, 5) < 0.15) P(xx, y + 1, 1, 1, '#ffb09a');
      } else if (k === 'pork') {
        P(xx, y, 1, 6, c.a); const r = hash(g3, 4, 7); if (r < 0.35) P(xx, y + Math.floor(r * 15), 1, 1, c.b); else if (r > 0.85) P(xx, y + 1, 1, 1, c.c);
        P(xx, y + 6, 1, 3, '#f3e6cf'); P(xx, y + 9, 1, 3, '#c9876e'); P(xx, y + 12, 1, 2, '#f0d8c0'); P(xx, y + 14, 1, Math.max(0, ih - 14), '#b26a52');
      } else {
        P(xx, y, 1, ih, c.a); P(xx, y, 1, 3, c.b); P(xx, y + ih - 3, 1, 3, c.c);
        if (hash(g3, 9, 13) < 0.15) P(xx, y + 1, 1, 1, '#ffffff');
        if (hash(g3, 8, 13) < 0.2) P(xx, y + 4 + Math.floor(hash(g3, 7, 13) * (ih - 7)), 1, 1, c.c);
      }
    }
  }
  // part: 'all', 'cut' (only the cut pieces) or 'rest' (only the uncut remainder). On the board the pieces stay exactly
  // where they were cut (the guides left must stay true): each cut shows as a 1 px gap, the cut faces either side
  function drawBoardMeat(L: Layout, b: Board, dx = 0, dy = 0, part: 'all' | 'cut' | 'rest' = 'all') {
    const cy = L.meatCy + dy + (b.drop > 0 ? -b.drop * 60 : 0), ws = widths(b), n = ws.length;
    let x = b.x0;
    if (part !== 'rest') for (let i = 0; i < n; i++) {
      const w = ws[i] ?? 0;
      seg(b, x + dx, x, w - 1, cy, i > 0, true);
      x += w;
    }
    const lc = lastCut(b);
    if (part !== 'cut') seg(b, lc + dx, lc, b.x1 - lc, cy, n > 0, false);
  }

  /* ---------- drawing: people, plate, station ---------- */
  function drawCustomer(c: Customer, x: number, y: number, front: boolean, t: number, mood: '' | 'happy' | 'angry') {
    const L = c.look, bob = mood === 'happy' ? -Math.abs(Math.sin(t * 10)) * 2 : 0;
    y += bob;
    bx(x - 7, y + 12, 14, 12, c.look.shirt, '#ffffff33');
    el(x, y + 6, 6, 6, L.skin);
    if (!L.bald) { P(x - 6, y - 1, 13, 4, L.hair); P(x - 6, y + 1, 2, 4, L.hair); P(x + 5, y + 1, 2, 3, L.hair); }
    else P(x - 4, y, 9, 1, '#6a6a6a');
    const f = c.pat / c.max, cross = mood === 'angry' || (!mood && f < 0.3);
    P(x - 3, y + 5, 1, cross ? 1 : 2, INK); P(x + 2, y + 5, 1, cross ? 1 : 2, INK);
    if (mood === 'happy' || (!mood && f > 0.6)) { P(x - 2, y + 9, 5, 1, INK); P(x - 3, y + 8, 1, 1, INK); P(x + 3, y + 8, 1, 1, INK); }
    else if (cross) { P(x - 2, y + 9, 5, 1, INK); P(x - 3, y + 10, 1, 1, INK); P(x + 3, y + 10, 1, 1, INK); P(x - 4, y + 3, 2, 1, INK); P(x + 3, y + 3, 2, 1, INK); }
    else P(x - 1, y + 9, 3, 1, INK);
    if (!mood) {
      P(x - 12, y + 25, 24, 3, INK); P(x - 11, y + 26, Math.max(0, Math.round(22 * f)), 1, f > 0.5 ? '#7be08f' : f > 0.25 ? '#ffd25a' : '#ff5a5a');
      if (front && Math.floor(t * 2) % 2) P(x - 9, y - 4, 18, 1, '#ffd25a');
    }
  }
  // the lower half of an ellipse with an ink outline (the side of a bowl)
  function halfEl(cx: number, cy: number, rx: number, ry: number, fill: string) {
    cx = Math.round(cx); cy = Math.round(cy);
    for (let dy = 0; dy <= ry; dy++) {
      const span = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
      P(cx - span, cy + dy, span * 2 + 1, 1, INK);
      if (dy < ry && span > 1) P(cx - span + 1, cy + dy, span * 2 - 1, 1, fill);
    }
  }
  // v3: rice goes on a flat PLATE; 瀨粉 / 米粉 / 河粉 go in a deep BOWL (a different shape, not a different colour)
  function drawPlate(PL: Plate, cx: number, cy: number, s: number, t: number, order: Order | null) {
    const soup = PL.base !== null && BASE[PL.base].soup;
    if (!PL.base) {
      // nothing chosen yet: a dashed spot where the plate or bowl will go
      for (let a = 0; a < 48; a += 2) { const q = a / 48 * Math.PI * 2; P(cx + Math.cos(q) * 24 * s, cy + Math.sin(q) * 13 * s, 2, 1, '#a89c74'); }
      return;
    }
    let rx: number, ry: number, sy: number;                // the food surface: centre (cx, sy), radii rx, ry
    if (soup) {
      const orx = Math.round(23 * s), ory = Math.max(3, Math.round(9 * s)), oy = Math.round(cy - 7 * s), dep = Math.round(21 * s);
      el(cx + 1, oy + dep + 2, orx * 0.75, 3 * s, 'rgba(0,0,0,.22)', null);
      bx(cx - 9 * s, oy + dep - 3 * s, 18 * s, 5 * s, '#e9eef0', '#ffffff');      // foot
      halfEl(cx, oy, orx, dep, '#fbfaf4');                                          // body
      for (const [f, c] of [[0.3, '#5f7fd0'], [0.42, '#5f7fd0']] as const) {       // blue bands on the side
        const dy = Math.round(dep * f), span = Math.round(orx * Math.sqrt(1 - f * f)) - 1;
        for (let x = -span; x <= span; x += f < 0.4 ? 1 : 3) P(cx + x, oy + dy, 1, 1, c);
      }
      P(cx - orx * 0.7, oy + dep * 0.15, 2, dep * 0.4, '#ffffff');                 // shine
      el(cx, oy, orx, ory, '#fbfaf4');                                              // rim
      const broth = PL.soup > 0;
      el(cx, oy, orx - 2, ory - 2, broth ? '#e2b25a' : '#e3ddcc', broth ? '#c99a48' : '#c9d1d6');
      // noodles in the bowl (under the broth if there is some)
      const kind = PL.base, nr = ory - 3;
      for (let i = 0; i <= nr * 2; i++) {
        const yy = oy - nr + i, half = Math.sqrt(Math.max(0, 1 - ((yy - oy) / (nr + 0.5)) ** 2)) * (orx - 5), col = broth ? '#f3e6c4' : '#fbf6ea';
        if (kind === 'ho') { if (i % 2 === 0) P(cx - half, yy, half * 2, 1, col); }
        else if (kind === 'lai') { for (let x = -half; x < half; x += 3) P(cx + x, yy, 2, 1, (x + i) % 2 ? col : '#efe0b8'); }
        else for (let x = -half; x < half; x += 2) if (hash(x | 0, i, 17) < 0.6) P(cx + x, yy, 1, 1, col);
      }
      if (broth) for (let i = 0; i < 6; i++) P(cx - orx * 0.6 + hash(i, 2, 5) * orx * 1.2, oy - ory * 0.4 + hash(i, 3, 5) * ory * 0.8, 2, 1, '#f6d488');
      if (PL.soup > 1) { P(cx + orx - 3, oy + 1, 2, 4 + Math.floor(t * 6) % 4, '#c99a48'); P(cx - orx + 2, oy + 2, 2, 3 + Math.floor(t * 5 + 2) % 4, '#c99a48'); }
      if (PL.scal) for (let i = 0; i < 14; i++) P(cx - orx * 0.75 + hash(i, 4, 9) * orx * 1.5, oy - ory * 0.6 + hash(i, 5, 9) * ory * 1.2, 1, 1, i % 3 ? '#4fae3a' : '#bfe08a');
      rx = orx - 4; ry = ory - 2; sy = oy;
    } else {
      const prx = Math.round(27 * s), pry = Math.max(4, Math.round(15 * s)), py = Math.round(cy - 2 * s);
      el(cx + 1, py + 4, prx, pry, 'rgba(0,0,0,.2)', null);
      el(cx, py + 2, prx, pry, '#c9d1d6');                                          // the plate's thin edge
      el(cx, py, prx, pry, '#fbfaf4'); el(cx, py, prx - 4, pry - 3, '#ffffff', '#dfe7ea');
      P(cx - prx * 0.6, py - pry * 0.75, prx * 0.4, 1, '#ffffff');
      const rrx = prx - 7, rry = pry - 5;
      for (let y = -rry; y <= rry; y++) for (let x = -rrx; x <= rrx; x++) { if ((x / rrx) ** 2 + (y / rry) ** 2 > 1) continue; const h = hash(x + 40, y + 40, 21); P(cx + x, py + y - 1, 1, 1, h < 0.15 ? '#e6e2d6' : h < 0.3 ? '#f4f1e8' : '#fffdf6'); }
      rx = prx - 5; ry = pry - 3; sy = py;
    }
    // zones for 雙拼 / 三拼
    // never fewer zones than the plate already uses (the customer it was built for may have walked out)
    const nz = soup ? 1 : Math.max(order ? order.meats.length : 1, ...PL.items.map(i => i.zone + 1));
    if (nz > 1) for (let i = 1; i < nz; i++) { const x = cx - rx + i * rx * 2 / nz; for (let y = -ry + 1; y < ry - 1; y += 3) { if (((x - cx) / rx) ** 2 + (y / ry) ** 2 > 1) continue; P(x, sy + y, 1, 2, '#c9d1d6'); } }
    cy = sy;
    // meat, fanned in its zone, on top
    for (const it of PL.items) {
      const zw = rx * 2 / nz, zc = cx - rx + (it.zone + 0.5) * zw, n = it.widths.length, c = COL[it.k], hh = Math.round(13 * s);
      const ws = it.widths.map(w => clamp(Math.round(w * 0.6 * s), 2, 10)), step = Math.min(6 * s, (zw - 8) / Math.max(1, n)), span = step * (n - 1) + (ws[n - 1] ?? 0);
      for (let i = 0; i < n; i++) {
        // slices laid overlapping in a fan, each a little lower, the way a 燒味 master lays them on rice
        const w = ws[i] ?? 2, x = Math.round(zc - span / 2 + i * step), y = Math.round(cy - hh / 2 - 2 + (i % 2) + Math.abs(i - (n - 1) / 2) * 0.6);
        P(x, y, w + 1, hh, c.out); P(x + 1, y + 1, w - 1, hh - 2, c.a); P(x + 1, y + 1, w - 1, 3, it.k === 'pork' ? c.a : c.b);
        if (it.k === 'pork') { P(x + 1, y + 4, w - 1, 2, '#f3e6cf'); P(x + 1, y + 6, w - 1, 2, '#c9876e'); }
        if (it.k === 'char') P(x + 1, y + 1, w - 1, 1, c.c);
        P(x + w - 1, y + 2, 1, hh - 4, c.face); P(x + w, y + 2, 1, hh - 4, c.face2);
      }
    }
    // soy glaze
    if (PL.soy > 0) {
      const n = Math.round(Math.min(PL.soy, 1.5) * 45);
      for (let i = 0; i < n; i++) { const a = hash(i, 3, 9) * Math.PI * 2, d = Math.sqrt(hash(i, 7, 9)) * 0.8; P(cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, 2, 1, i % 3 ? '#5a2a10' : '#7a3a14'); }
      if (PL.flood) { el(cx, cy + ry * 0.4, rx * 0.9, ry * 0.45, 'rgba(70,30,8,.75)', null); P(cx + rx - 2, cy + ry - 2, 3, 6 + Math.floor(t * 8) % 3, '#5a2a10'); }
    }
    if (PL.ginger) { el(cx + rx - 4, cy - ry + 4, 5, 4, '#ffffff'); el(cx + rx - 4, cy - ry + 4, 3, 2, '#b8d84a', null); P(cx + rx - 5, cy - ry + 3, 2, 1, '#f0e080'); }
    if (PL.veg) { for (let i = 0; i < 5; i++) { const x = cx - rx * 0.6 + i * 4, y = cy + ry - 6 + (i % 2); P(x, y, 4, 3, '#2f7a2a'); P(x + 1, y, 2, 2, '#4fae3a'); P(x + 3, y + 2, 3, 1, '#bfe08a'); } }
  }
  function drawStation(L: Layout, s: RoastState | null, t: number) {
    const st = L.station;
    P(0, st.y - 2, L.LW, st.h + 4, '#e9e1c8'); P(0, st.y - 2, L.LW, 1, INK); P(0, st.y - 1, L.LW, 1, '#ffffff');
    for (let x = 0; x < L.LW; x += 8) P(x, st.y + st.h - 3, 4, 1, '#d6cba8');
    for (const k of BASES) {
      const r = L.bases[k], sel = s?.plate.base === k;
      bx(r.x, r.y, r.w, r.h, sel ? '#ffe9a8' : '#c9d1d6', '#ffffff', '#8d99a1');
      const ix = r.x + 2, iy = r.y + 3, iw = r.w - 4, ih = r.h - 5;
      if (k === 'rice') for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const h = hash(x, y, 31); P(ix + x, iy + y, 1, 1, h < 0.2 ? '#e6e2d6' : '#fffdf6'); }
      else for (let y = 0; y < ih; y += k === 'ho' ? 3 : 2) for (let x = 0; x < iw; x += k === 'lai' ? 2 : 1) P(ix + x, iy + y + (k === 'mai' ? Math.round(Math.sin(x + y) * 0.6) : 0), 1, k === 'ho' ? 2 : 1, (x + y) % 3 ? '#f7f2e4' : '#e2d9c0');
    }
    // soy bottle
    const so = L.soy, pouring = s !== null && s.f.down && s.f.mode === 'soy';
    bx(so.x + 2, so.y + 8, so.w - 4, so.h - 8, '#3a1a0a', '#5a2a10');
    P(so.x + 4, so.y + 3, so.w - 8, 6, INK); P(so.x + 5, so.y + 1, so.w - 10, 3, '#c8323c');
    P(so.x + 3, so.y + 16, so.w - 6, 9, '#f4efd9'); P(so.x + 4, so.y + 18, so.w - 8, 1, '#c8323c'); P(so.x + 4, so.y + 21, so.w - 8, 1, '#c8323c');
    if (pouring) { const px = L.plate.cx + 8, top = so.y + 4; for (let x = px; x < so.x + 4; x += 2) P(x, top + Math.round((so.x + 4 - x) * 0.1), 2, 1, '#5a2a10'); for (let y = top; y < L.plate.cy - 2; y += 2) P(px + Math.round(Math.sin(t * 30 + y) * 0.5), y, 1, 2, '#6a3010'); }
    // the soup pot with its ladle (the ladle leaves the pot while it is in the hand)
    const sp = L.soup, ladling = s !== null && s.f.down && s.f.mode === 'ladle';
    bx(sp.x, sp.y + 6, sp.w, sp.h - 6, '#8d99a1', '#c9d1d6', '#6f7b85');
    P(sp.x - 1, sp.y + 9, 1, 3, INK); P(sp.x + sp.w, sp.y + 9, 1, 3, INK);
    P(sp.x + 1, sp.y + 7, sp.w - 2, 3, '#e2b25a'); P(sp.x + 2, sp.y + 7, 3, 1, '#f6d488');
    for (let i = 0; i < 3; i++) { const ph = (t * 5 + i * 1.7) % 5; P(sp.x + 3 + i * 4 + Math.round(Math.sin(t * 3 + i)), sp.y + 5 - ph, 1, 2, 'rgba(255,255,255,.85)'); }
    if (!ladling) { P(sp.x + sp.w - 4, sp.y - 2, 1, 10, '#6f7b85'); P(sp.x + sp.w - 5, sp.y - 2, 3, 1, '#4b555d'); }
    // 薑葱, 蔥花 and 油菜
    const g = L.ginger; bx(g.x, g.y, g.w, g.h, '#fbfaf4', '#ffffff', '#dfe7ea'); el(g.x + g.w / 2, g.y + g.h / 2 - 1, g.w / 2 - 3, Math.max(1, g.h / 2 - 5), '#b8d84a', null);
    for (let i = 0; i < 8; i++) P(g.x + 3 + hash(i, 1, 2) * (g.w - 6), g.y + 3 + hash(i, 2, 2) * (g.h - 10), 1, 1, i % 2 ? '#f0e080' : '#5f9a2a');
    if (s?.plate.ginger) P(g.x, g.y - 1, g.w, 1, '#ffd25a');
    const scl = L.scal; bx(scl.x, scl.y, scl.w, scl.h, '#fbfaf4', '#ffffff', '#dfe7ea');
    for (let i = 0; i < 16; i++) P(scl.x + 2 + hash(i, 6, 3) * (scl.w - 5), scl.y + 2 + hash(i, 7, 3) * (scl.h - 9), 2, 1, i % 3 ? '#4fae3a' : '#bfe08a');
    if (s?.plate.scal) P(scl.x, scl.y - 1, scl.w, 1, '#ffd25a');
    const v = L.veg; bx(v.x, v.y, v.w, v.h, '#fbfaf4', '#ffffff', '#dfe7ea');
    for (let i = 0; i < 3; i++) { const x = v.x + 2 + i * 4, y = v.y + 3 + (i % 2) * 2; P(x, y, 4, 3, '#2f7a2a'); P(x + 1, y, 2, 2, '#4fae3a'); P(x + 2, y + 3, 1, 2, '#bfe08a'); }
    if (s?.plate.veg) P(v.x, v.y - 1, v.w, 1, '#ffd25a');
  }
  // the ladle in the hand, full of soup
  function ladle(x: number, y: number) {
    x = Math.round(x); y = Math.round(y);
    for (let i = 0; i < 9; i++) P(x + 3 + i, y - 3 - Math.round(i * 0.7), 1, 1, '#4b555d');
    el(x, y, 5, 3, '#c9d1d6'); el(x, y - 1, 3, 1, '#e2b25a', null);
  }
  // numbers 1..n on the pieces the order wants, and the leftover end hatched and marked 剩
  function drawMarks(s: RoastState, b: Board, cy: number) {
    const mk = boardMarks(s, b), top = Math.round(cy - b.h / 2), bot = Math.round(cy + b.h / 2);
    if (mk.rest && mk.rest.x1 - mk.rest.x0 > 2)
      for (let x = Math.ceil(mk.rest.x0) + 1; x < mk.rest.x1 - 1; x++) for (let y = top + prof(b, x) + 1; y < bot - 1; y++) if ((x + y) % 4 === 0) P(x, y, 1, 1, 'rgba(255,255,255,.55)');
    return mk;
  }
  function cleaver(x: number, y: number, down: boolean) {
    x = Math.round(x); y = Math.round(y);
    const by = down ? y - 2 : y - 14;
    P(x - 1, by, 13, 11, INK); P(x, by + 1, 11, 9, '#c9d1d6'); P(x, by + 1, 11, 1, '#ffffff'); P(x, by + 9, 11, 1, '#8d99a1');
    P(x + 8, by + 3, 2, 2, '#6f7b85');
    P(x + 11, by + 2, 9, 4, INK); P(x + 12, by + 3, 7, 2, '#7a4a20');
  }

  /** Where the soy level shows: a strip across the top of the station over the plate, clear of the bottle. */
  const soyGauge = (L: Layout) => ({ x: L.plate.cx - 24, y: L.station.y + 3, w: 48, h: 5 });
  /** One frame. s is null before the first run (an empty counter and 撳「開工」). */
  function draw(s: RoastState | null, t: number) {
    beginScene(sc);
    if (s) playFx(s);
    const L = s ? LY(s) : layout(sc.LW, sc.LH), LW = L.LW, LH = L.LH, S = sc.S, tt = sc.t, b = s?.board ?? null, o = s?.q[0]?.ord ?? null, F = s?.f ?? null;
    const down = (m: string) => F !== null && F.down && F.mode === m;
    // shop back wall and the counter front
    P(0, 0, LW, L.ticket.y + L.ticket.h, '#f3e5b2');
    for (let y = 0; y < L.cust.h; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < LW; x += 6) P(x, y, 5, 5, (x * 7 + y * 3) % 11 ? '#f7ecc4' : '#efe0a8');
    // customers (front of the queue on the left)
    if (s) {
      s.q.forEach((c, i) => { const tx = L.ox + 20 + i * 44, x0 = custX.get(c.id), x = x0 === undefined ? LW + 10 : x0 + (tx - x0) * 0.15; custX.set(c.id, x); drawCustomer(c, x, 1, i === 0, t, ''); });
      for (const g of s.gone) { const c = g.c, x = (custX.get(c.id) ?? LW + 10) - g.t * 70; drawCustomer(c, x, 1, false, t, g.happy ? 'happy' : 'angry'); }
      if (custX.size > 40) for (const id of [...custX.keys()]) if (!s.q.some(c => c.id === id) && !s.gone.some(g => g.c.id === id)) custX.delete(id);
    }
    // the ticket
    const tk = L.ticket;
    bx(tk.x, tk.y, tk.w, tk.h, '#fffdf2', '#ffffff', '#e6dcc0'); for (let x = tk.x + 2; x < tk.x + tk.w - 2; x += 4) P(x, tk.y + tk.h - 1, 2, 1, '#c8323c');
    // the shop window: rail and roasts
    const r = L.rail;
    P(0, r.y, LW, r.h, '#7a1e1a'); P(2, r.y + 2, LW - 4, r.h - 4, '#f6e2b0');
    for (let y = r.y + 2; y < r.y + r.h - 2; y += 9) P(2, y, LW - 4, 1, '#fbecc4');
    P(2, r.y + 2, LW - 4, 1, '#ffffff'); P(3, r.y + 3, 1, r.h - 6, '#ffffff');
    P(0, r.y + 3, LW, 2, '#8d99a1'); P(0, r.y + 3, LW, 1, '#e6ecef');
    for (const h of L.hooks) {
      const dragging = down('roast') && F?.k === h.k, back = s !== null && (s.hangBack?.k === h.k || s.restBack?.b.k === h.k);
      if (!dragging && !back) drawHang(h.k, h.x, h.y, h.bot, s !== null && s.lock > s.t);
      if (s && o?.meats.includes(h.k) && df(s).hints && Math.floor(t * 3) % 2 && !s.plate.items.some(i => i.k === h.k) && b?.k !== h.k) P(h.x - 3, h.y - 2, 7, 1, '#ffd25a');
    }
    P(0, r.y + r.h - 2, LW, 2, '#5a1612');
    // the chopping board
    const bd = L.board;
    P(0, bd.y - 3, LW, bd.h + 6, '#8a6a4a');
    bx(bd.x, bd.y, bd.w, bd.h, BOARD, '#ecc488', '#b8864a');
    for (let i = 0; i < 6; i++) P(bd.x + 4 + i * 20, bd.y + 3 + (i % 3) * 7, 10, 1, '#c99858');
    for (let i = 0; i < 12; i++) P(bd.x + 3 + hash(i, 4, 1) * (bd.w - 6), bd.y + 3 + hash(i, 5, 1) * (bd.h - 6), 3, 1, '#c99858');
    let marks: ReturnType<typeof boardMarks> | null = null;
    if (s && b && F) {
      const dragging = down('pieces'), lifted = down('lift');
      if (!lifted) drawBoardMeat(L, b, 0, 0, dragging ? 'rest' : 'all');
      if (!dragging && !lifted && b.drop <= 0) marks = drawMarks(s, b, L.meatCy);
      // the guides not cut yet: dashed lines where the knife goes, as the tier shows them ('full' through the roast,
      // 'short' a stub at the top, 'none' nothing); a bone-in roast always shows its joints as ticks above it
      const top = L.meatCy - b.h / 2, bot = L.meatCy + b.h / 2, mode = guideMode(s), left = uncut(s, b), next = left[0];
      if (!lifted) for (const gx of left) {
        const tracing = down('trace') && Math.abs(gx - F.ax) < b.w / 2, y0 = tracing ? Math.max(top, F.front) : top;
        const col = gx === next ? '#ffffff' : 'rgba(255,255,255,.7)', x = Math.round(gx);
        if (MEAT[b.k].bone) P(x, top - 3, 1, 2, '#f2ead8');
        if (mode === 'full') for (let y = y0; y < bot + 3; y += 3) P(x, y, 1, 2, col);
        else if (mode === 'short') for (let y = y0; y < top + b.h * 0.3; y += 3) P(x, y, 1, 2, col);
      }
      if (b.partial) { const x = Math.round(b.partial.x); P(x, top, 1, b.partial.front - top, '#3a120c'); }
      if (down('trace')) { const x = Math.round(F.ax); P(x, top, 1, Math.max(0, F.front - top), F.off ? '#ff5a5a' : '#2a0a06'); P(x - 1, top - 2, 3, 1, F.off ? '#ff5a5a' : '#ffffff'); }
    }
    // a wrong roast hangs itself back
    if (s?.hangBack) { const hb = s.hangBack, h = L.hooks.find(q => q.k === hb.k); if (h) { const k = Math.min(1, hb.t / (TUNE.wrongLock * 0.6)); const x = hb.x + (h.x - hb.x) * k, y = hb.y + (h.y + 20 - hb.y) * k; drawHang(hb.k, x, y - 20, y + 25, false); } }
    // the leftover end flies back up onto its hook: it lifts off the board, then the whole roast hangs again
    if (s?.restBack) {
      const rb = s.restBack, rbb = rb.b, h = L.hooks.find(q => q.k === rbb.k), u = rb.t / TUNE.restBack, k = u * u * (3 - 2 * u), w = rbb.x1 - rb.from;
      if (h) {
        if (u < 0.7) { const kk = Math.min(1, k / 0.75), x = rb.from + (h.x - w / 2 - rb.from) * kk, cy = L.meatCy + (h.y + 22 - L.meatCy) * kk - Math.sin(kk * Math.PI) * 10; seg(rbb, x, rb.from, w, cy, true, false); }
        else drawHang(rbb.k, h.x, h.y - (1 - u) * 12, h.bot - (1 - u) * 12, false);
      }
    }
    // the station
    drawStation(L, s, t);
    if (s) drawPlate(s.plate, L.plate.cx, L.plate.cy, 1, t, o);
    // flights: the plate to the customer
    if (s) for (const f of s.flights) { const k = Math.min(1, f.t / 0.3); drawPlate(f.plate, f.x, f.y - k * (f.y - 10), 1 - k * 0.6, t, null); }
    // in hand: a roast or the cut pieces
    if (F && down('roast') && F.k) drawHang(F.k, F.x, F.y - 22, F.y + 22, false);
    if (F && down('pieces') && b) drawBoardMeat(L, b, F.x - F.sx, F.y - F.sy - 6, 'cut');
    if (F && down('lift') && b) drawBoardMeat(L, b, F.x - F.sx, F.y - F.sy - 6, 'all');
    if (F && down('ladle')) ladle(F.x, F.y - 4);
    // cleaver
    if (b && s?.chop) cleaver(s.chop.x - 1, L.meatCy - b.h / 2, true);
    else if (b && F && (down('trace') || down('tap') || down('tapOrPieces'))) cleaver(F.x - 1, Math.min(F.y, L.meatCy + b.h / 2) - 2, F.mode === 'trace');
    // particles
    for (const q of parts) P(q.x, q.y, q.s, q.s, q.col);

    // ---- text layer ----
    tt.textBaseline = 'middle';
    if (s && o) {
      const name = o.name;
      tt.font = FONT(900, 16); tt.textAlign = 'left'; tt.fillStyle = INK; tt.fillText(name, (tk.x + 4) * S, (tk.y + 7) * S);
      const nameW = tt.measureText(name).width;
      // every step on the ticket, in the order they are done (the meat goes on top of a noodle bowl last)
      const sub = ticketSteps(s, o);
      tt.font = FONT(700, 12); let x = (tk.x + 4) * S; const y = (tk.y + 16) * S;
      // squeeze the gaps (then the font) so a long ticket (三寶飯 跟油菜) still fits on one line
      let fs = 12, gap = 9; const room = (tk.w - 6) * S, wOf = () => sum(sub.map(q => tt.measureText((q.ok ? '✓' : '') + q.t).width)) + gap * (sub.length - 1);
      if (wOf() > room) gap = 5;
      while (wOf() > room && fs > 9) { fs--; tt.font = FONT(700, fs); }
      for (const q of sub) { const txt = (q.ok ? '✓' : '') + q.t; tt.fillStyle = q.ok ? '#2a8b67' : '#58695f'; tt.fillText(txt, x, y); x += tt.measureText(txt).width + gap; }
      if (s.q.length > 1) { tt.font = FONT(700, 11); tt.textAlign = 'right'; tt.fillStyle = '#8a7a50'; tt.fillText(`之後：${s.q.slice(1).map(c => c.ord.name).join('、')}`, (tk.x + tk.w - 3) * S, (tk.y + 7) * S, Math.max(40, (tk.w - 8) * S - nameW - 12)); }
    } else if (s) { tt.font = FONT(700, 14); tt.textAlign = 'center'; tt.fillStyle = '#8a7a50'; tt.fillText('等客…', (tk.x + tk.w / 2) * S, (tk.y + tk.h / 2) * S); }
    for (const h of L.hooks) chipT(h.x, L.rail.y + L.rail.h - 6, MEAT[h.k].name, '#fff6c8', INK, 10);
    for (const k of BASES) { const rr = L.bases[k]; chipT(rr.x + rr.w / 2, rr.y + rr.h - 4, BASE[k].name, s?.plate.base === k ? '#ffd25a' : '#e6f1ec', INK, 10); }
    chipT(L.soy.x + L.soy.w / 2, L.soy.y + L.soy.h - 4, '豉油', '#e6f1ec', INK, 10);
    chipT(L.soup.x + L.soup.w / 2, L.soup.y + L.soup.h - 3, '湯', s?.plate.soup ? '#ffd25a' : '#e6f1ec', INK, 10);
    chipT(L.ginger.x + L.ginger.w / 2, L.ginger.y + L.ginger.h - 3, '薑葱', s?.plate.ginger ? '#ffd25a' : '#e6f1ec', INK, 10);
    chipT(L.scal.x + L.scal.w / 2, L.scal.y + L.scal.h - 3, '蔥花', s?.plate.scal ? '#ffd25a' : '#e6f1ec', INK, 10);
    chipT(L.veg.x + L.veg.w / 2, L.veg.y + L.veg.h - 3, '油菜', s?.plate.veg ? '#ffd25a' : '#e6f1ec', INK, 10);
    if (b && s) {
      const cut = b.cuts.length, done = boardDone(s, b);
      chipT(bd.x + 20, bd.y + 6, `已切 ${Math.min(cut, 99)}／${b.n}`, done && cut === b.n ? '#7be08f' : cut > b.n ? '#ffb347' : '#fff6c8', INK, 11);
    }
    // the numbers 1..n stand ON the guides, under the roast where the finger and the board's messages do not cover them
    // ("chop 1, 2, 3, 4" means chop where the numbers are); a guide already cut keeps its number, dimmed. 剩 on the
    // end that goes back
    if (marks && b) {
      const ny = L.meatCy + b.h / 2 + 8, fs = b.n > 9 ? 10 : 12;
      for (const m of marks.nums) { tt.globalAlpha = m.cut ? 0.4 : 1; outlineT(m.x, ny, String(m.n), '#ffffff', fs); }
      tt.globalAlpha = 1;
      if (marks.rest && marks.rest.x1 - marks.rest.x0 > 5) chipT((marks.rest.x0 + marks.rest.x1) / 2, L.meatCy + 3, '剩', '#d6d0c0', INK, 10);
    }
    // soy gauge while pouring (on the text layer so it sits above the plate): a level across the top of the plate, left of
    // and above the bottle, so the thumb on the bottle never covers it; green band = 啱啱好
    if (s && (down('soy') || s.plate.soy > 0) && s.plate.base && !BASE[s.plate.base].soup) {
      const g = soyGauge(L), gx = g.x * S, gy = g.y * S, gw = g.w * S, gh = g.h * S, f = clamp(s.plate.soy / TUNE.soy.over, 0, 1), iw = gw - 4;
      tt.fillStyle = INK; tt.fillRect(gx, gy, gw, gh);
      tt.fillStyle = '#3a3a3a'; tt.fillRect(gx + 2, gy + 2, iw, gh - 4);
      tt.fillStyle = '#7be08f'; tt.fillRect(gx + 2 + iw * TUNE.soy.lo / TUNE.soy.over, gy + 2, iw * (TUNE.soy.hi - TUNE.soy.lo) / TUNE.soy.over, gh - 4);
      tt.fillStyle = s.plate.flood ? '#ff5a5a' : 'rgba(150,80,30,.9)'; tt.fillRect(gx + 2, gy + 4, Math.max(2, iw * f), gh - 8);
      tt.fillStyle = '#ffffff'; tt.fillRect(gx + 2 + iw * f - 1, gy, 3, gh);
    }
    // hint: what to do next
    const hint = s && !s.over && !(down('pieces') || down('lift') || down('roast') || down('ladle')) ? nextStep(s) : '';
    if (hint) outlineT(LW / 2, bd.y + bd.h - 7, hint, '#ffffff', 13);
    // customer reaction bubble
    if (s?.react) {
      const rc = s.react, a = rc.t < 0.15 ? rc.t / 0.15 : 1;
      tt.globalAlpha = rc.t > 1.8 ? Math.max(0, (2.2 - rc.t) / 0.4) : 1;
      chipT(LW / 2, L.cust.h - 2 - (1 - a) * 6, `「${rc.text}」`, rc.stars >= 2 ? '#fff6c8' : '#ffd0c0', INK, 14);
      tt.globalAlpha = 1;
    }
    if (s) for (const g of s.gone) if (g.angry && g.t < 1.4) chipT(clamp((custX.get(g.c.id) ?? LW) - g.t * 70, 30, LW - 30), L.cust.h - 2, `「${g.angry}」`, '#ffd0c0', INK, 13);
    const my = bd.y + 9;
    if (s) { let i = 0; for (const m of s.msgs) { if (m.t < 0) continue; outlineT(LW / 2, my - m.t * 6 + i * 13, m.text, m.col, 15); i++; } }
    if (!s) outlineT(LW / 2, LH / 2, '撳「開工」', '#ffffff', 16);
  }

  /** Pointer position in the state's logical px (and css px for the tap and swipe thresholds). */
  function toL(e: PointerEvent) {
    const r = sc.tv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / sc.S, y: (e.clientY - r.top) / sc.S, cx: e.clientX, cy: e.clientY };
  }
  /** The view command for the scene's current size (send it when it changes). */
  function view(): RoastCmd { return sc.LW > 0 ? { k: 'view', LW: sc.LW, LH: sc.LH, S: sc.S } : { k: 'view', ...DEFAULT_VIEW }; }
  return { draw, stepParts, reset, toL, view, get parts() { return parts.length; } };
}
export type RoastScreen = ReturnType<typeof roastScreen>;

/** The prototype's input wiring on `app`: one finger at a time, Safari's edge swipe left alone, buttons and overlays ignored. */
export function attachRoastInput(app: HTMLElement, scr: RoastScreen, live: () => RoastState | null, send: (c: RoastCmd) => void) {
  let id: number | null = null;
  app.addEventListener('pointerdown', e => {
    const s = live(), tg = e.target;
    if (tg instanceof Element && (tg.closest('.hb') || tg.closest('.ov'))) return;
    if (!s || s.over) return;
    // one finger at a time: a second finger is never the primary pointer. A new primary press always goes through, even
    // when the state still has a finger down (left by the computer at a hand-over, or a lift this page never saw: the
    // core drops that stale finger); before, that stale finger locked every press out
    if (!e.isPrimary) return;
    if (e.clientX < 14 || e.clientX > innerWidth - 14) return;            // leave Safari's edge swipe alone
    e.preventDefault(); id = e.pointerId; send({ k: 'down', ...scr.toL(e) });
  });
  app.addEventListener('pointermove', e => { const s = live(); if (s?.f.down && e.pointerId === id) send({ k: 'move', ...scr.toL(e) }); });
  app.addEventListener('pointerup', e => { const s = live(); if (s?.f.down && e.pointerId === id) { send({ k: 'up', ...scr.toL(e) }); id = null; } });
  app.addEventListener('pointercancel', e => { if (e.pointerId === id) { send({ k: 'cancel' }); id = null; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) send({ k: 'cancel' }); });
}
