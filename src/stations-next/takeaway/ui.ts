// The 外賣 screen: the original prototype's drawing and touch input, drawn from the station state. The
// pixel art, colours, text and layout are the prototype's, line for line; the only changes are where things live (the finger,
// the bag, the counter and the tie are in the core state; particles are screen-only, started by the core's fx).
import { EXK, EXN, EXU, LY, PPL, TUNE, active, layout, custOrders, custSlot, dragPos, inR, itemById, knotPt, needEx, slipRect, slotXY, tiePath, trayRect, undoRect,
  type Bag, type BagItem, type ExK, type Fx, type Item, type Order, type TakeCmd, type TakeState, type Tie, type Who } from './core';
import { INK, beginScene, pixels, shake, texts, type Scene, type Sound } from '../lab-kit';

const SKIN = '#f2c9a0';
const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
function pickR<T>(a: readonly T[]): T { const v = a[Math.floor(Math.random() * a.length)] ?? a[0]; if (v === undefined) throw new Error('empty'); return v; }
const FAMILY = '"PingFang HK","Noto Sans HK",sans-serif';
const ease = (u: number) => u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
/** The OS "reduce motion" setting (the tie finish then skips its flash, hand blur and burst). */
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// The singlet bag on the tie screen, logical px: strap = handle width as a share of the bag width, strapT = the
// handle's thickness, handleH = tallest handle, headroom = space kept above it; the finish: flash = s the white flash
// takes to fade, turns = laps the blurred hand makes round the neck, blurR = their radius, ghostK = afterimage spacing
// as a multiple of TUNE.fx.ghostGap; bow = the bow's scale, pop = how much it swells as it pops.
const BAG_ART = { strap: 0.26, strapT: 4, handleH: 24, headroom: 6, flash: 0.18, turns: 2.5, blurR: 13, ghostK: 3, bow: 1.8, pop: 0.35 };
// the slip's packing note: a red band across the foot of the slip, white text (size in css px, shrunk to fit)
const NOTE_ART = { h: 7.5, pad: 1.5, size: 12, minSize: 9, bg: '#b8262f', fg: '#ffffff' };
// the open bag's contents: smallest scale things shrink to so every shelf fits, rows of extras packets drawn;
// the slip: font (css px) of an item / extras line, the smallest it may shrink to, line pitch (logical px)
const PACK_ART = { minS: 0.4, exRows: 3 };
const SLIP_ART = { size: 10.5, minSize: 8, pitch: 4.2 };

/* ---------- sound (the prototype's SFX on the injected Sound; its noise decays linearly) ---------- */
function sfx(snd: Sound) {
  const tone = snd.tone, noise = (dur: number, vol?: number, freq?: number, delay?: number, q?: number) => { snd.noise(dur, vol, freq, delay, q, 1); };
  return {
    rustle() { noise(0.035, 0.035, rnd(3200, 6500), 0, 2.5); if (Math.random() < 0.3) noise(0.02, 0.02, rnd(7000, 9000), 0.012, 3); },
    whoosh() { for (let i = 0; i < 6; i++) noise(0.05, 0.03, 2500 + i * 700, i * 0.05, 1.5); },
    pop() { tone(520, 0.09, 'sine', 0.09, 140); noise(0.07, 0.09, 1600, 0, 0.8); tone(1400, 0.06, 'sine', 0.04, 0, 0.07); tone(2100, 0.08, 'sine', 0.03, 0, 0.11); },
    thud() { tone(170, 0.08, 'triangle', 0.06, 90); noise(0.05, 0.03, 900); },
    tick() { noise(0.03, 0.04, 2400, 0, 3); tone(1800, 0.03, 'square', 0.015); },
    spill() { noise(0.35, 0.08, 500); tone(300, 0.2, 'sine', 0.04, 120); },
    bang() { tone(140, 0.12, 'square', 0.06, 80); },
    chime(n = 3) { for (let i = 0; i < n; i++) tone(880 * Math.pow(1.26, i), 0.12, 'sine', 0.05, 0, i * 0.07); },
    slip() { tone(1300, 0.04, 'square', 0.025); tone(1000, 0.05, 'square', 0.02, 0, 0.05); },
  };
}
interface Part { x: number; y: number; vx: number; vy: number; col: string; life: number; g: number; s: number; star: boolean }

/** The screen for one station state. Call draw() every frame; it plays the core's fx (sound, particles, shake). */
export function takeawayScreen(sc: Scene, snd: Sound) {
  const { P, bx, el, pline } = pixels(sc, false), { FONT, chipT, outlineT, textT } = texts(sc, FAMILY), SFX = sfx(snd), PX = sc.x;
  let parts: Part[] = [], fxSeen = 0;
  const df = (s: TakeState) => TUNE.diff[s.diff];

  function playFx(s: TakeState) {
    for (const f of s.fx) { if (f.seq <= fxSeen) continue; fxSeen = f.seq; play(f); }
    if (s.fxSeq < fxSeen) fxSeen = s.fxSeq;                    // a new run
  }
  function play(f: Fx) {
    if (f.kind === 'shake') shake(sc);
    else if (f.kind === 'trail') { if (Math.random() < f.p) parts.push({ x: f.x, y: f.y, vx: rnd(-20, 20), vy: rnd(-30, -5), col: pickR(['#e0424c', '#ffffff', '#ffd25a']), life: rnd(0.2, 0.45), g: 60, s: 1, star: false }); }
    else if (f.kind === 'splash') { for (let i = 0; i < f.n; i++) parts.push({ x: f.x + rnd(-8, 8), y: f.y, vx: rnd(-40, 40), vy: rnd(-50, -10), col: pickR([f.col, f.col, '#ffffff']), life: rnd(0.4, 0.8), g: 160, s: pickR([1, 2]), star: false }); }
    else if (f.kind === 'pop') { for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2, v = rnd(40, 90); parts.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, col: pickR(['#ffd25a', '#ffffff', '#e0424c']), life: rnd(0.35, 0.7), g: 40, s: pickR([1, 2]), star: i % 3 === 0 }); } }
    else if (f.name === 'chime') SFX.chime(f.n);
    else SFX[f.name]();
  }
  /** Moves the particles on by dt (the prototype moves them every frame, paused or not). */
  function stepParts(dt: number) {
    for (const q of parts) { q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; }
    parts = parts.filter(q => q.life > 0); if (parts.length > 400) parts.splice(0, parts.length - 400);
  }
  function reset() { parts = []; fxSeen = 0; }

  /* ---------- drawing: objects ---------- */
  function drawItem(it: Item, x: number, y: number, now: number, s = 1, squashed = false) {
    x = Math.round(x); y = Math.round(y);
    if (it.kind === 'box') {
      const w = Math.round(22 * s), h = Math.round(13 * s);
      bx(x - w / 2, y - h / 2, w, h, '#fbfaf4', '#ffffff', '#d6dcd8'); P(x - w / 2 + 1, y - 1, w - 2, 1, '#c9d1d6');
      P(x - 3 * s, y - h / 2 + 2, Math.round(6 * s), Math.max(1, Math.round(3 * s)), it.col);
    } else if (it.kind === 'soft') {
      const w = Math.round(16 * s), h = Math.round(squashed ? 6 * s : 12 * s);
      bx(x - w / 2, y + 6 * s - h, w, h, '#d9b47a', '#ecd0a0', '#b8925a'); P(x - w / 2 + 2, y + 6 * s - h + 2, w - 4, 1, '#b8925a');
    } else {
      const w = Math.round(12 * s), h = Math.round(16 * s), x0 = x - w / 2, y0 = y - h / 2;
      if (squashed) { bx(x - h / 2, y + 2, h, w * 0.8, it.hot ? '#fbfaf4' : '#e6f4f8'); P(x - h / 2 + 2, y + 4, h - 4, 2, it.col); return; }
      bx(x0, y0 + 2, w, h - 2, it.hot ? '#fbfaf4' : '#e6f4f8', '#ffffff');
      P(x0 + 1, y0 + 4, w - 2, Math.round(h * 0.55), it.col);
      if (!it.hot) { P(x0 + 3, y0 + 5, 2, 2, '#ffffff'); P(x0 + w - 5, y0 + 7, 2, 2, '#ffffff'); }
      bx(x0 - 1, y0, w + 2, 3, it.hot ? '#ffffff' : '#bfe3ff');
      if (it.hot && s >= 1) { const ph = Math.floor(now * 1000 / 180) % 3; P(x - 2, y0 - 3 - ph, 1, 2, '#ffffff'); P(x + 2, y0 - 2 - ((ph + 1) % 3), 1, 2, '#ffffff'); }
    }
  }
  function drawOpenBag(s: TakeState, b: Bag, now: number) {
    const B = LY(s).bag;
    // handles
    for (const hx of [B.x + 12, B.x + B.w - 12]) { el(hx, B.y + 2, 6, 7, '#f7f5ec'); el(hx, B.y + 2, 3, 4, '#e9e0c8', null); }   // handle loops
    bx(B.x, B.y + 4, B.w, B.h - 4, '#f7f5ec', '#ffffff', '#e2ded0');
    for (let y = B.y + 12; y < B.y + B.h - 4; y += 14) P(B.x + 6 + ((y / 14) % 2) * 20, y, 14, 1, '#e8e4d6');
    // extras inside: little packets along the bottom-left (at most PACK_ART.exRows rows of 9 are drawn)
    const nEx = Math.min(EXK.reduce((a, k) => a + b.ex[k], 0), 9 * PACK_ART.exRows), exRows = Math.ceil(nEx / 9);
    let ex = 0; for (const k of EXK) for (let i = 0; i < b.ex[k] && ex < nEx; i++) { const px = B.x + 3 + (ex % 9) * 5.6, py = B.y + B.h - 7 - Math.floor(ex / 9) * 4; exIcon(k, px, py, 0.5); ex++; }
    // contents: shelves from the bottom up in packing order (boxes first), shrunk until every shelf fits inside the bag,
    // below the extras' text lines at the top and above the packets at the bottom
    const kinds = EXK.filter(k => b.ex[k]).length, top = B.y + 9 + Math.max(1, Math.ceil(kinds / 2)) * 4 + 1, bot = B.y + B.h - 3 - exRows * 4;
    const sh = packShelves(b.items, B.w - 6, bot - top), k = sh.s;
    let y = bot;
    for (const row of sh.rows) {
      const rh = Math.max(...row.map(c => c.h)), rw = row.reduce((a, c) => a + c.w, 0) + row.length - 1; let x = B.x + 3 + (B.w - 6 - rw) / 2;
      for (const c of row) {
        const it = c.x.it, sq = c.x.squashed;
        // each kind's drawing hangs differently from its centre: put its bottom on the shelf
        const lift = it.kind === 'box' ? 6.5 * k : it.kind === 'soft' ? 6 * k : sq ? 2 + 9.6 * k : 8 * k;
        drawItem(it, x + c.w / 2, y - lift, now, k, sq);
        if (sq && it.kind === 'drink') P(B.x + 3, y + 1, B.w - 6, 2, it.col);
        x += c.w + 1;
      }
      y -= rh + 1;
    }
  }
  /** The bag's contents as shelves (bottom shelf first) at the largest scale that fits w x h. */
  function packShelves(items: readonly BagItem[], w: number, h: number) {
    type Cell = { x: BagItem; w: number; h: number };
    const size = (x: BagItem, s: number) => { const k = x.it.kind; return k === 'box' ? { w: 22 * s, h: 13 * s } : k === 'soft' ? { w: 16 * s, h: (x.squashed ? 6 : 12) * s } : x.squashed ? { w: 16 * s, h: 2 + 10 * s } : { w: 14 * s, h: 19 * s }; };
    let best: { rows: Cell[][]; s: number } = { rows: [], s: 1 };
    for (let s = 1; s >= PACK_ART.minS - 1e-9; s -= 0.05) {
      const rows: Cell[][] = []; let cur: Cell[] = [], cw = 0;
      for (const x of items) { const z = size(x, s); if (cur.length && cw + 1 + z.w > w) { rows.push(cur); cur = []; cw = 0; } cur.push({ x, ...z }); cw += (cw ? 1 : 0) + z.w; }
      if (cur.length) rows.push(cur);
      best = { rows, s };
      if (rows.reduce((a, r) => a + Math.max(...r.map(c => c.h)) + 1, 0) <= h) break;
    }
    return best;
  }
  function exIcon(k: ExK, x: number, y: number, s = 1) {
    x = Math.round(x); y = Math.round(y);
    if (s < 1) { P(x, y, 4, 3, INK); P(x + 1, y + 1, 2, 1, k === 'cut' ? '#cfd6da' : k === 'nap' ? '#ffffff' : k === 'str' ? '#7fd0ff' : k === 'sug' ? '#f2b8c6' : '#e8a21a'); return; }
    if (k === 'cut') { bx(x - 7, y - 5, 14, 10, '#e6eef2', '#ffffff'); P(x - 4, y - 3, 1, 6, '#8d99a1'); P(x - 5, y - 3, 3, 1, '#8d99a1'); P(x + 2, y - 3, 3, 2, '#8d99a1'); P(x + 3, y - 1, 1, 4, '#8d99a1'); }
    else if (k === 'nap') { bx(x - 7, y - 4, 14, 9, '#ffffff', '#ffffff'); P(x - 6, y - 1, 12, 1, '#e2ded0'); P(x - 6, y + 2, 12, 1, '#e2ded0'); }
    else if (k === 'str') { for (let i = 0; i < 4; i++) { const sx = x - 6 + i * 4, c = ['#7fd0ff', '#ff8a8a', '#7be08f', '#ffd25a'][i] ?? INK; P(sx, y - 6 + (i % 2), 2, 12, INK); P(sx, y - 5 + (i % 2), 1, 10, c); } }
    else if (k === 'sug') { for (let i = 0; i < 3; i++) bx(x - 8 + i * 5, y - 4 + (i % 2) * 2, 6, 8, '#f2b8c6', '#ffffff'); }
    else { el(x, y + 1, 6, 4, '#fbfaf4'); el(x, y, 4, 2, '#e8a21a', null); }
  }
  function drawTiedBag(x: number, y: number, s = 1) {
    x = Math.round(x); y = Math.round(y);
    const w = Math.round(26 * s), h = Math.round(24 * s);
    bx(x - w / 2, y - h / 2, w, h, '#f7f5ec', '#ffffff', '#e2ded0');
    P(x - w / 2 + 3, y - 1, w - 6, 1, '#e8e4d6');
    P(x - 4 * s, y + 3 * s, Math.round(8 * s), Math.max(1, Math.round(2 * s)), '#e0424c');
    // the gathered neck, then the handles tied into a bow on top
    const nk = Math.max(1, Math.round(4 * s));
    for (let r = 1; r <= nk; r++) { const nw = Math.max(3, Math.round(w * 0.5 * (1 - r / (nk + 2)))); P(x - nw / 2 - 1, y - h / 2 - r, nw + 2, 1, INK); P(x - nw / 2, y - h / 2 - r, nw, 1, '#f7f5ec'); }
    bow(x, y - h / 2 - nk, s * 0.7, '#a89870');
  }
  /** The handles of a singlet bag tied into a bow: two loops (ears) with their holes (`hole`: what shows through), a knot, two short tails. */
  function bow(x: number, y: number, s = 1, hole = '#2f5f52') {
    if (s >= 0.8) for (const sg of [-1, 1]) { const tx = x + sg * 3 * s, ty = y + 3 * s; pline(x, y, tx, ty, INK, 5); pline(x, y, tx, ty, '#f7f5ec', 3); P(tx - 2, ty + 1, 5, 1, INK); }
    for (const sg of [-1, 1]) {
      const ex = x + sg * 5 * s, ey = y - 3 * s; blob(ex, ey, 4 * s, 3 * s, '#f7f5ec');
      if (s >= 0.8) { P(ex - s, ey - s / 2, 2 * s, Math.max(1, s), hole); P(ex - s, ey + s / 2, 2 * s, 1, '#e2ded0'); }   // the handle's hole
    }
    blob(x, y - 1, 1.5 * s, 1.5 * s, '#ffffff');
  }
  /** A filled oval with a 1 px ink rim and no single-pixel spikes at its top and bottom rows. */
  function blob(cx: number, cy: number, rx: number, ry: number, fill: string) {
    cx = Math.round(cx); cy = Math.round(cy); rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
    const row = (r1: number, r2: number, col: string) => { for (let dy = -r2; dy <= r2; dy++) { const span = Math.round(r1 * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((r2 + 0.6) * (r2 + 0.6))))); P(cx - span, cy + dy, span * 2 + 1, 1, col); } };
    row(rx + 1, ry + 1, INK); row(rx, ry, fill);
  }
  /** One handle loop standing on the bag at (cx, baseY): a strap `t` thick, `a` half-width, `h` high, its hole open. */
  function handleLoop(cx: number, baseY: number, a: number, h: number, t: number) {
    const ai = Math.max(0, a - t), hi = Math.max(0, h - t);
    for (let dy = 0; dy <= h + 1; dy++) {
      const so = a * Math.sqrt(Math.max(0, 1 - (dy / (h + 1)) * (dy / (h + 1)))), si = dy < hi ? ai * Math.sqrt(1 - (dy / hi) * (dy / hi)) : 0, y = baseY - dy;
      for (const sg of [-1, 1]) {
        const o = cx + sg * (so + 1), i = cx + sg * Math.max(0, si - 1), x0 = Math.min(o, i), w0 = Math.abs(o - i);
        P(x0, y, Math.max(1, w0), 1, INK);
        const x1 = Math.min(cx + sg * so, cx + sg * si), w1 = Math.abs(so - si);
        if (w1 >= 1 && dy <= h) P(x1, y, w1, 1, dy % 5 ? '#f7f5ec' : '#e2ded0');
      }
    }
  }
  function hand(x: number, y: number, a = 1) {
    // a pointing hand, fingertip at (x, y)
    PX.globalAlpha = a; const X = Math.round(x) - 4, Y = Math.round(y);
    bx(X + 2, Y, 4, 9, SKIN, '#ffe0c0'); bx(X + 5, Y + 4, 4, 6, SKIN); bx(X + 8, Y + 5, 3, 5, SKIN); bx(X - 1, Y + 8, 4, 4, SKIN);
    bx(X + 1, Y + 8, 10, 8, SKIN, '#ffe0c0', '#d9a882'); bx(X + 2, Y + 15, 8, 3, '#7fd0ff');
    PX.globalAlpha = 1;
  }
  function customer(o: { seed: number; who: Who }, cx: number, footY: number, t: number, mood: number) {
    const rnd2 = (o.seed % 97) / 97, x = Math.round(cx), y = Math.round(footY);
    const shirt = ['#c8323c', '#3f5fb0', '#2a8b67', '#cf861a', '#6a4aa0'][o.seed % 5] ?? INK;
    const bob = Math.floor(t * 2 + rnd2 * 6) % 2;
    P(x - 4, y - 2, 3, 2, INK); P(x + 1, y - 2, 3, 2, INK);                       // shoes
    bx(x - 4, y - 10, 8, 9, '#3c474f');                                              // trousers
    bx(x - 6, y - 21 - bob, 12, 12, o.who === 'rider' ? '#e8c23a' : shirt);        // jacket / shirt
    if (o.who === 'rider') P(x - 5, y - 16 - bob, 10, 2, '#ffffff');                // reflective stripe
    bx(x - 4, y - 29 - bob, 8, 8, SKIN);                                             // face
    P(x - 2, y - 26 - bob, 1, 1, INK); P(x + 1, y - 26 - bob, 1, 1, INK);
    if (mood < 0.25) { P(x - 2, y - 23 - bob, 4, 1, INK); P(x - 3, y - 28 - bob, 2, 1, INK); P(x + 1, y - 28 - bob, 2, 1, INK); }
    if (o.who === 'rider') { bx(x - 5, y - 33 - bob, 10, 6, shirt, '#ffffff'); P(x - 5, y - 28 - bob, 10, 1, INK); }    // helmet
    else P(x - 4, y - 31 - bob, 8, 3, INK);                                           // hair
  }

  /* ---------- drawing: scene ---------- */
  function draw(W: TakeState | null, now: number) {
    if (W) playFx(W);
    const S = sc.S, LW = sc.LW, LH = sc.LH;
    // tiled wall
    P(0, 0, LW, LH, '#b2d2c3');
    for (let y = 0; y < LH; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < LW; x += 6) P(x, y, 5, 5, (x * 7 + y * 3) % 11 ? '#d6ebe1' : '#c3e0d2');
    const L = W ? LY(W) : layout(LW, LH);
    // order rail
    bx(0, 0, LW, L.rail.h, '#6f7b85', '#9aa6ad');
    P(0, 3, LW, 2, '#c9d1d6');
    const os = W ? custOrders(W) : [], a = W ? active(W) : null;
    os.forEach((o, i) => { const r = slipRect(L, i); bx(r.x, r.y, r.w, r.h, '#fffdf3', '#ffffff', '#e2ded0'); P(r.x + r.w / 2 - 2, r.y - 3, 4, 4, '#c9d1d6'); if (o === a) { P(r.x - 1, r.y - 1, r.w + 2, 1, '#ffd25a'); P(r.x - 1, r.y + r.h, r.w + 2, 1, '#ffd25a'); P(r.x - 1, r.y, 1, r.h, '#ffd25a'); P(r.x + r.w, r.y, 1, r.h, '#ffd25a'); } });
    // counter and work surface
    bx(0, L.rail.h + 1, LW, L.cust.y - L.rail.h - 1, '#e9e0c8', '#f6efdc', '#cdbf9c');
    bx(L.counter.x - 2, L.counter.y - 1, L.counter.w + 3, L.counter.h + 1, '#c8b88e', '#ddd0a8', '#a89870');
    for (let i = 0; i < TUNE.counterSlots; i++) { const p = slotXY(L, i); P(p.x - 12, p.y + 8, 24, 2, '#b4a47c'); }
    // the trays of extras
    for (const k of EXK) { const r = trayRect(L, k); bx(r.x, r.y, r.w, r.h, '#8d99a1', '#c9d1d6', '#6f7b85'); P(r.x + 2, r.y + 2, r.w - 4, r.h - 11, '#5d6870'); exIcon(k, r.x + r.w / 2, r.y + 8); }
    // the door: riders and walk-ins
    const C = L.cust; bx(C.x, C.y, C.w, C.h, '#4b555d', '#6f7b85'); for (let x = 2; x < C.w; x += 8) P(x, C.y + C.h - 8, 6, 1, '#3c474f');
    P(0, C.y + C.h - 6, LW, 6, '#8d99a1');
    if (!W) {
      for (const k of EXK) { const r = trayRect(L, k); textT(r.x + r.w / 2, r.y + r.h - 8.6, EXN[k], '#ffffff', 11, 900, 'center'); }
      outlineT(LW / 2, LH / 2, '撳「開工」', '#ffffff', 16);
      return;
    }
    os.forEach((o, i) => { const sl = custSlot(L, i), mood = clamp(1 - (W.t - o.t0) / o.pat, 0, 1), hx = o.huff > 0 ? Math.sin(o.huff * 40) * 2 : 0; customer(o, sl.cx + hx, C.y + C.h - 6, now, mood);
      const bw = sl.w - 8; P(sl.x + 4, C.y + 3, bw, 3, INK); P(sl.x + 5, C.y + 4, Math.max(0, Math.round((bw - 2) * mood)), 1, mood > 0.5 ? '#7be08f' : mood > 0.25 ? '#ffb347' : '#ff5a5a'); });
    for (const l of W.leaving) { const sl = custSlot(L, Math.min(l.slot, TUNE.maxOrders - 1)), k = l.t / 1.6; PX.globalAlpha = 1 - k; customer(l, sl.cx + k * 40, C.y + C.h - 6, now, 1); drawTiedBag(sl.cx + k * 40 + 7, C.y + C.h - 18, 0.45); PX.globalAlpha = 1; }
    // counter items
    const dragSlot = W.drag?.kind === 'item' ? W.drag.slot : -1;
    W.counter.forEach((ci, i) => { const it = ci ? itemById(W, ci.id) : null; if (!ci || !it || dragSlot === i) return; const p = slotXY(L, i), e = ci.enter / 0.25, bk = ci.back > 0 ? Math.sin(ci.back * 40) * 2 : 0; drawItem(it, p.x + e * 40 + bk, p.y, now); });
    // the bag
    const tieOn = W.phase === 'tie' || W.phase === 'fx' || W.phase === 'drillRes';
    if (W.mode === 'shift' && !tieOn) {
      if (W.phase === 'hand') { if (W.drag?.kind !== 'bag') drawTiedBag(L.bag.x + L.bag.w / 2, L.bag.y + L.bag.h / 2, 1.6); }
      else drawOpenBag(W, W.bag, now);
      const ready = a?.items.every(i => i.packed) && W.phase === 'pack', tb = L.tieBtn;
      if (W.phase === 'pack') { bx(tb.x, tb.y, tb.w, tb.h, ready ? '#ffd25a' : '#c9d1d6', ready ? '#fff0a0' : '#e6ecef', ready ? '#cf861a' : '#8d99a1'); if (ready && Math.floor(now * 3) % 2) P(tb.x, tb.y + tb.h, tb.w, 1, '#ffffff'); }
    }
    // flights (extras into the bag)
    for (const f of W.flights) { if (f.kind !== 'ex') continue; const k = Math.min(1, f.t / 0.22), x = f.x0 + (L.bag.x + L.bag.w / 2 - f.x0) * k, y = f.y0 + (L.bag.y + L.bag.h * 0.6 - f.y0) * k - Math.sin(k * Math.PI) * 12; exIcon(f.k, x, y); }
    // the tie overlay
    if (tieOn && W.tie) drawTie(W, W.tie, now);
    // dragged things ride above the finger
    if (W.drag) {
      const q = dragPos(W); P(W.f.lx - 1, W.f.ly - 1, 3, 3, 'rgba(15,26,22,.35)');
      if (W.drag.kind === 'item') { const it = itemById(W, W.drag.id), over = inR(L.bag, q.x, q.y, 8); if (over) { const B = L.bag; P(B.x, B.y + 3, B.w, 1, '#ffd25a'); P(B.x, B.y + B.h, B.w, 1, '#ffd25a'); } if (it) drawItem(it, q.x, q.y, now, 1.2); }
      else drawTiedBag(q.x, q.y, 1.3);
    }
    // particles
    for (const q of parts) { if (q.star) { P(q.x - 1, q.y, 3, 1, q.col); P(q.x, q.y - 1, 1, 3, q.col); } else P(q.x, q.y, q.s, q.s, q.col); }

    /* ---- text layer ---- */
    // slips
    os.forEach((o, i) => { drawSlip(W, o, slipRect(L, i), o === a); });
    if (W.mode === 'shift' && !os.length && !W.over) outlineT(LW / 2, L.rail.h / 2, '等緊單…', '#ffffff', 14);
    // counter labels: name + slip number sticker
    if (!tieOn) W.counter.forEach((ci, i) => { const it = ci ? itemById(W, ci.id) : null; if (!ci || !it || ci.enter > 0 || dragSlot === i) return; const p = slotXY(L, i); chipT(p.x + 8, p.y - 10, `#${it.no}`, it.no === a?.no ? '#ffd25a' : '#ffffff', INK, 10); textT(p.x, p.y + 9.4, it.name, INK, 10, 700, 'center'); });
    if (!tieOn) for (const k of EXK) { const r = trayRect(L, k); textT(r.x + r.w / 2, r.y + r.h - 8.6, EXN[k], '#ffffff', 11, 900, 'center'); }
    if (W.mode === 'shift' && !tieOn) {
      const B = L.bag, tb = L.tieBtn;
      if (W.phase === 'pack') {
        const miss = a ? a.items.filter(i => !i.packed).length : 0;
        textT(tb.x + tb.w / 2, tb.y + 4.4, !a ? '等單' : miss ? `仲差 ${miss} 樣` : '綁袋！', INK, 14, 900, 'center');
        if (a) chipT(B.x + 13, B.y + 2, `#${a.no}`, '#ffd25a', INK, 11);
        const exs = EXK.filter(k => W.bag.ex[k]).map(k => EXN[k] + String(W.bag.ex[k]));
        for (let j = 0; j < exs.length; j += 2) textT(B.x + 2, B.y + 9 + j / 2 * 4, exs.slice(j, j + 2).join(' '), '#235648', 9.5, 900);
        if (W.bag.log.length) { const u = undoRect(L); chipT(u.x + u.w / 2, u.y + u.h / 2, '↶', '#e6f1ec', INK, 12); }
      } else if (W.phase === 'hand' && a) {
        outlineT(B.x + B.w / 2, B.y + B.h - 6, `拖俾 #${a.no} ↓`, '#ffd25a', 15);
        if (df(W).hints) { const i = os.indexOf(a); if (i >= 0) { const sl = custSlot(L, i); outlineT(sl.cx, L.cust.y - 4, '↓', '#ffd25a', 18); } }
      }
    }
    os.forEach((o, i) => { const sl = custSlot(L, i); chipT(sl.cx, L.cust.y + 12, `#${o.no}`, o.huff > 0 ? '#ff8a8a' : '#ffffff', INK, 11); });
    for (const l of W.leaving) { const sl = custSlot(L, Math.min(l.slot, TUNE.maxOrders - 1)); outlineT(sl.cx, L.cust.y + 4 - l.t * 6, '★'.repeat(l.stars) + '☆'.repeat(3 - l.stars), '#ffd25a', 14); if (l.t < 1.4) chipT(LW / 2, L.ex.y - 7, `#${l.no}：${l.quote}`, l.stars === 3 ? '#d6f5df' : '#fff6c8', INK, 13); }
    if (tieOn && W.tie) drawTieText(W, W.tie);
    let i = 0; for (const m of W.msgs) { if (m.t < 0) continue; outlineT(LW / 2, (tieOn ? (L.rail.h + L.cust.y) / 2 + 20 : L.rail.h + 58) - m.t * 18 - i * 16 / S * 1.1, m.text, m.col, 17); i++; }
  }
  // The ticket says everything: what goes in (struck through once packed), every count of extras with its unit (grey
  // once the bag has exactly that, red if it has too many) and, when there is a box and something to keep on top, the
  // packing order. Waiting tickets are stubs: number, takeaway or pick-up, how many things.
  function drawSlip(W: TakeState, o: Order, r: { x: number; y: number; w: number; h: number }, act: boolean) {
    const S = sc.S, tt = sc.t, sx = r.x + 1.6, how = o.who === 'rider' ? '外賣' : '自取';
    const strike = (x: number, y: number, text: string, col: string) => { tt.fillStyle = col; tt.fillRect(x * S, (y + 2) * S, tt.measureText(text).width, 1.5); };
    textT(sx, r.y + 1.2, `#${o.no}`, act ? '#c8323c' : INK, 13, 900);
    if (!act) { textT(sx, r.y + 7.4, how, '#58695f', 10, 700); textT(sx, r.y + 12, `${o.items.length}樣`, '#58695f', 10, 700); return; }
    textT(r.x + r.w - 1.5, r.y + 1.8, `${how} · ${PPL[o.people] ?? ''}`, '#58695f', 10, 700, 'right');
    // every line fits above the note band: past 4 things the list takes two columns, and the pitch and font
    // shrink (to SLIP_ART.minSize) only when the lines would not fit otherwise; a name wider than its column shrinks too
    const need = needEx(o), have = W.bag.ex, cx = r.x + r.w * 0.57, noSug = !need.sug && o.items.some(i => i.kind === 'drink' && i.hot);
    const exLines = EXK.filter(k => need[k] || (k === 'sug' && noSug) || have[k]).length;
    const box = o.items.some(i => i.kind === 'box'), dr = o.items.some(i => i.kind === 'drink'), sf = o.items.some(i => i.kind === 'soft'), noted = box && (dr || sf);
    const y0 = r.y + 7.2, foot = noted ? r.y + r.h - NOTE_ART.h - NOTE_ART.pad - 0.5 : r.y + r.h - 1;
    const cols = o.items.length > 4 ? 2 : 1, rows = Math.ceil(o.items.length / cols), lines = Math.max(1, rows, exLines);
    const pitch = Math.min(SLIP_ART.pitch, (foot - y0) / lines), size = clamp(pitch * S / 1.2, SLIP_ART.minSize, SLIP_ART.size), colW = (cx - sx - 1) / cols;
    o.items.forEach((it, i) => {
      const col = it.packed ? '#9aa6ad' : INK, x = sx + Math.floor(i / rows) * colW, ly = y0 + (i % rows) * pitch;
      let f = size; tt.font = FONT(700, f); while (f > SLIP_ART.minSize && tt.measureText(it.name).width > colW * S - 2) { f -= 0.5; tt.font = FONT(700, f); }
      textT(x, ly, it.name, col, f, 700); if (it.packed) strike(x, ly, it.name, col);
    });
    let ry = y0;
    for (const k of EXK) {
      if (!need[k] && !(k === 'sug' && noSug) && !have[k]) continue;
      const t = need[k] ? `${EXN[k]} ${need[k]}${EXU[k]}` : k === 'sug' && noSug ? `${EXN[k]} 0（走甜）` : `${EXN[k]} 0`;
      const col = have[k] > need[k] ? '#d0303a' : have[k] === need[k] ? '#9aa6ad' : '#235648';
      textT(cx, ry, t, col, size, 900); if (have[k] === need[k]) strike(cx, ry, t, col); ry += pitch;
    }
    if (noted) {
      // the packing note sits in its own band inside the slip, level and centred, shrunk only if a narrow slip needs it
      const N = NOTE_ART, note = `先放飯盒，${dr && sf ? '飲品同菠蘿油' : dr ? '飲品' : '菠蘿油'}擺面`;
      const bx0 = (r.x + N.pad) * S, by0 = (r.y + r.h - N.h - N.pad) * S, bw = (r.w - 2 * N.pad) * S, bh = N.h * S;
      tt.fillStyle = N.bg; tt.fillRect(bx0, by0, bw, bh);
      let size: number = N.size; tt.font = FONT(900, size);
      while (size > N.minSize && tt.measureText(note).width > bw - 8) { size -= 0.5; tt.font = FONT(900, size); }
      tt.fillStyle = N.fg; tt.textAlign = 'center'; tt.textBaseline = 'middle'; tt.fillText(note, bx0 + bw / 2, by0 + bh / 2 + 0.5);
    }
  }
  const cornerMask = new Map<string, Uint8Array>();
  function drawTie(W: TakeState, T: Tie, now: number) {
    const L = LY(W), S = sc.S, R = T.R, path = tiePath(T), p = path.pts, N = p.length, top = L.rail.h + 1, bot = L.cust.y;
    const pt = (i: number) => p[clamp(i, 0, N - 1)] ?? [0, 0];
    // the big bag behind the tangle
    P(0, top, L.LW, bot - top, 'rgba(35,86,72,.88)');
    const bx0 = R.x / S + R.w / S * 0.08, bw = R.w / S * 0.84, by0 = (R.y + R.h * 0.15) / S, bh = bot - by0 - 2;
    bx(bx0, by0, bw, bh, '#f7f5ec', '#ffffff', '#e2ded0');
    for (let y = by0 + 14; y < by0 + bh - 6; y += 18) P(bx0 + 8 + ((y / 18) % 2) * 16, y, bw * 0.4, 1, '#e8e4d6');
    // the classic red print on a white takeaway bag (drawn on the low-res layer, so it comes out chunky)
    PX.font = `900 22px ${FAMILY}`; PX.textAlign = 'center'; PX.textBaseline = 'middle'; PX.fillStyle = 'rgba(224,66,76,.45)';
    PX.fillText('多謝', bx0 + bw / 2, by0 + bh * 0.62); PX.font = `900 9px ${FAMILY}`; PX.fillText('THANK YOU', bx0 + bw / 2, by0 + bh * 0.62 + 16);
    const K = knotPt(W), fx = T.fx, X = TUNE.fx, still = reducedMotion();
    // a singlet bag (背心袋): two handle loops stand up from the top corners, the opening between them. Once the line
    // is drawn they swing in over the gathered neck (u: 0 open .. 1 together) and the pop turns them into a bow.
    const u = fx < 0 ? 0 : T.popped || still ? 1 : ease(clamp(fx / (X.hand + X.cinch), 0, 1));
    const nh = Math.round((by0 - K.y) * u);
    for (let r = 0; r <= nh && u > 0; r++) { const f = 1 - r / Math.max(1, by0 - K.y), w = 8 + (bw - 8) * Math.pow(f, 2.2), y = by0 - r; P(K.x - w / 2 - 1, y, w + 2, 1, INK); P(K.x - w / 2, y, w, 1, r % 4 ? '#f7f5ec' : '#e2ded0'); }
    if (u < 1) {
      const sw = bw * BAG_ART.strap, hh = clamp(by0 - top - BAG_ART.headroom, 10, BAG_ART.handleH), baseY = by0 - nh + 1;
      // the opening: the back panel dips between the handles
      if (u < 0.5) { const ox0 = bx0 + sw, ow = bw - 2 * sw; for (let i = 1; i < ow - 1; i++) { const d = Math.round(Math.sin(i / ow * Math.PI) * 6 * (1 - 2 * u)); P(ox0 + i, by0 + 1, 1, d, '#e2ded0'); P(ox0 + i, by0 + 1 + d, 1, 1, INK); } }
      for (const sg of [-1, 1]) {
        const c0 = sg < 0 ? bx0 + sw / 2 : bx0 + bw - sw / 2, cx = c0 + (K.x + sg * 5 * BAG_ART.bow - c0) * u;
        handleLoop(cx, baseY, sw / 2 + (4 * BAG_ART.bow - sw / 2) * u, hh + (6 * BAG_ART.bow - hh) * u, BAG_ART.strapT);
      }
    } else if (!T.popped) bow(K.x, K.y + 1, BAG_ART.bow);
    if (fx < 0) {
      // remaining path: far end drawn first, so the next stretch is on top at a crossing
      const nextN = Math.round(TUNE.trace.next / path.step), dashN = Math.round(12 / path.step), pulse = Math.floor(now * 6) % 2;
      // within ~15 px of a sharp corner the dashes stay solid, so the corner itself is always drawn
      const key = `${T.tier}|${T.pat}|${N}`;
      let cm = cornerMask.get(key);
      if (!cm) { cm = new Uint8Array(N); const k = Math.round(15 / path.step); for (const c of path.corners) for (let j = Math.max(0, c - k); j <= Math.min(N - 1, c + k); j++) cm[j] = 1; cornerMask.clear(); cornerMask.set(key, cm); }
      for (let i = N - 1; i > T.i; i--) {
        if (Math.floor(i / dashN) % 2 && !cm[i]) continue;
        const q = pt(i), x = q[0] / S, y = q[1] / S; P(x - 2, y - 2, 4, 4, INK);
      }
      for (let i = N - 1; i > T.i; i--) {
        if (Math.floor(i / dashN) % 2 && !cm[i]) continue;
        const near = i - T.i <= nextN, q = pt(i), x = q[0] / S, y = q[1] / S;
        P(x - 1, y - 1, 2, 2, near ? (pulse ? '#ffd25a' : '#fff0a0') : '#e0424c');
      }
      // direction chevrons along what is left
      const ev = Math.round(TUNE.trace.arrowEvery / path.step);
      for (let i = T.i + Math.round(30 / path.step); i < N - 3; i += ev) {
        if (cm[i]) { i -= ev - 2; continue; }   // not on a corner: slide on to just past it
        const a = pt(i - 2), b = pt(i + 2), ang = Math.atan2(b[1] - a[1], b[0] - a[0]), q = pt(i), x = q[0] / S, y = q[1] / S;
        // a chunky chevron (ink outline, then colour) pointing the way to go
        const tx = x + Math.cos(ang) * 3, ty = y + Math.sin(ang) * 3, col = i - T.i <= nextN ? '#ffffff' : '#ffd25a';
        for (const [c, w] of [[INK, 3], [col, 1]] as const) for (const sg of [-1, 1]) { const aa = ang + Math.PI + sg * 0.65; pline(tx, ty, tx + Math.cos(aa) * 6, ty + Math.sin(aa) * 6, c, w); }
      }
      // the end: a little knot target
      const e = pt(N - 1); bow(e[0] / S, e[1] / S + 3, 0.6);
      // the head: where to touch next, ring = the tolerance band
      const h = pt(T.i), hx = h[0] / S, hy = h[1] / S, rr = df(W).band / S, off = W.t - T.offT < 0.5;
      if (!T.fingerDown || !T.on) {
        const col = off ? '#ff5a5a' : pulse ? '#ffffff' : '#ffd25a';
        for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2 + now; P(hx + Math.cos(a) * rr, hy + Math.sin(a) * rr, 1, 1, col); }
      }
      el(hx, hy, 3, 3, T.i === 0 ? '#7be08f' : '#ffd25a');
      if (T.fingerDown && T.on) hand(W.f.lx - 1, W.f.ly + 1, 0.55);
    } else {
      // finish: the drawn line flashes white and fades, a hand blurs round the handles while they swing in over
      // the gathering neck (drawn above), then the pop shows the bow. Reduced motion: no flash, no hand, no burst.
      const A = BAG_ART, fl = still ? 1 : clamp(fx / A.flash, 0, 1);
      if (fl < 1) {
        PX.globalAlpha = 1 - fl; for (let i = 0; i < N; i++) { const q = pt(i); P(q[0] / S - 1, q[1] / S - 1, 2, 2, '#e0424c'); }
        PX.globalAlpha = 0.85 * (1 - fl) * (1 - fl); P(0, top, L.LW, bot - top, '#ffffff'); PX.globalAlpha = 1;
      }
      if (!T.popped && !still) {
        // the hand circles the neck, afterimages behind it on a white streak
        const spot = (t: number) => { const a = -Math.PI / 2 + t * Math.PI * 2 * A.turns; return { x: K.x + Math.cos(a) * A.blurR, y: K.y - 3 + Math.sin(a) * A.blurR * 0.6 }; };
        const ghosts: number = X.ghosts, gap = X.ghostGap * A.ghostK;
        PX.globalAlpha = 0.7; for (let t = fx - ghosts * gap; t <= fx; t += 0.004) { const q = spot(t); P(q.x - 1, q.y - 1, 3, 3, '#ffffff'); } PX.globalAlpha = 1;
        for (let g = ghosts; g >= 1; g--) { const q = spot(fx - g * gap); hand(q.x, q.y, 0.5 * (1 - g / (ghosts + 1))); }
        const q = spot(fx); hand(q.x, q.y, 1);
      } else if (T.popped) {
        const k = still ? 1 : clamp((fx - X.hand - X.cinch) / 0.25, 0, 1), sc2 = 1 + Math.sin(k * Math.PI) * BAG_ART.pop;
        bow(K.x, K.y + 1, BAG_ART.bow * sc2);
        if (!still) { const rr = 4 + k * 26; for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2; PX.globalAlpha = 1 - k; P(K.x + Math.cos(a) * rr, K.y + Math.sin(a) * rr, 1, 1, '#ffd25a'); } PX.globalAlpha = 1; }
      }
    }
  }
  function drawTieText(W: TakeState, T: Tie) {
    const L = LY(W), S = sc.S, R = T.R, p0 = tiePath(T).pts[0] ?? [0, 0], run = T.fx >= 0 ? T.time : Math.max(0, W.t - T.readyAt);
    const under = run <= T.par;
    outlineT(L.LW / 2, L.cust.y - 6, `${run.toFixed(2)} 秒 ／ 標準 ${T.par.toFixed(1)}`, under ? '#7be08f' : '#ffb347', 16);
    // the knot's pattern / family name is never shown to the player
    if (T.fx < 0) {
      if (T.i === 0) chipT(p0[0] / S, p0[1] / S - 8, '起', '#7be08f', INK, 13);
      if (W.t < T.readyAt) outlineT(L.LW / 2, (R.y + R.h / 2) / S, W.mode === 'drill' ? `第 ${W.drillN + 1} 條` : '綁袋！', '#ffd25a', 26);
    } else if (T.popped) {
      const fast = T.time <= T.par;
      outlineT(L.LW / 2, (R.y + R.h * 0.45) / S, fast ? '快手！' : '綁好', fast ? '#7be08f' : '#ffd25a', 26);
    }
    if (W.mode === 'drill' && W.ties.length) { const last = W.ties.slice(-5).map(t => t.time.toFixed(1)).join(' · '); textT(2, L.cust.y + 2, `最近：${last}`, '#ffffff', 11, 700); }
  }

  /** A pointer event in logical px and css px (relative to the scene canvas), with its time. */
  function toL(e: PointerEvent) { const r = sc.tv.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top; return { x: cx / sc.S, y: cy / sc.S, cx, cy, ms: e.timeStamp }; }
  function view(): TakeCmd { return { k: 'view', LW: sc.LW, LH: sc.LH, S: sc.S }; }
  return { draw, stepParts, reset, toL, view, begin: () => { beginScene(sc); }, get parts() { return parts.length; } };
}
export type TakeawayScreen = ReturnType<typeof takeawayScreen>;

/** The prototype's pointer wiring on the scene: one finger, Safari's edge swipe left alone, a cancel lifts like an up. */
export function attachTakeawayInput(scene: HTMLElement, scr: TakeawayScreen, live: () => TakeState | null, send: (c: TakeCmd) => void) {
  let id: number | null = null;
  scene.addEventListener('pointerdown', e => {
    const s = live();
    if (!s || s.over || s.f.down) return;
    if (e.clientX < 10 || e.clientX > innerWidth - 10) return;           // leave Safari's edge swipe alone
    e.preventDefault(); id = e.pointerId;
    try { scene.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    send({ k: 'down', ...scr.toL(e) });
  });
  scene.addEventListener('pointermove', e => { const s = live(); if (s?.f.down && e.pointerId === id) send({ k: 'move', ...scr.toL(e) }); });
  const lift = (e: PointerEvent) => { const s = live(); if (s?.f.down && e.pointerId === id) { send({ k: 'up', ...scr.toL(e) }); id = null; } };
  scene.addEventListener('pointerup', lift);
  scene.addEventListener('pointercancel', lift);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { send({ k: 'cancel' }); id = null; } });
}
