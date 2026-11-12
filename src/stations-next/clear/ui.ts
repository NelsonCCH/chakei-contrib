// 執枱 screen: a top-down cha chaan teng table (formica top on the mosaic floor) with the plates, bowls and cups the
// core laid out, the three big buttons with code-drawn icons, the done stamp, the over-tap flash, and sound. It never
// shows how many of a kind are left: counting what is on the table is the game. The core steps on frame time here
// (standalone); as a seat of the shop (?seat) the game page runs the core and this screen only draws its state
// and sends taps back.
import { seededRng, type Difficulty, type StationCtx } from '../contract';
import type { Recipes, StationSound } from '../sound';
import { hash } from '../lab-kit';
import { KINDS, TUNE, clear, tappable, type ClearCmd, type ClearState, type Item, type Kind, type Noise, type Table } from './core';

const INK = '#0f1a16';
const FONT = '"PingFang HK","Noto Sans HK","Microsoft JhengHei",sans-serif';
const $ = (id: string): HTMLElement => { const e = document.getElementById(id); if (!e) throw new Error(`#${id} missing`); return e; };
function $b(id: string): HTMLButtonElement { const e = $(id); if (!(e instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`); return e; }
function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D { const x = c.getContext('2d'); if (!x) throw new Error('no 2d canvas'); return x; }
const store = {
  get(k: string): unknown { try { const v = localStorage.getItem('st_clear_' + k); return v === null ? undefined : JSON.parse(v); } catch { return undefined; } },
  set(k: string, v: unknown): void { try { localStorage.setItem('st_clear_' + k, JSON.stringify(v)); } catch { /* private mode: no memory */ } },
};
const isDiff = (v: unknown): v is Difficulty => v === 'rookie' || v === 'pro' || v === 'ace';
const isKind = (v: unknown): v is Kind => v === 'plate' || v === 'bowl' || v === 'cup';
const TAU = Math.PI * 2;

/** The screen's sounds (the core names the cues). */
export const CLEAR_SOUNDS: Recipes = {
  tap(s, k) { const f = [1500, 1250, 2100][k] ?? 1500; s.tone(f, 0.07, 'sine', 0.05); s.tone(f * 1.52, 0.06, 'sine', 0.03, 0, 0.025); },
  reset(s) { s.noise(0.45, 0.12, 2400); s.tone(320, 0.45, 'square', 0.05, 90); },
  done(s) { [660, 880, 1100, 1320].forEach((f, i) => { s.tone(f, 0.12, 'square', 0.035, 0, i * 0.07); }); },
  table(s) { s.tone(520, 0.08, 'triangle', 0.03); },
};

/* ---------- the art: top-down dishes in table units, drawn on a 2d context already scaled ---------- */
function disc(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | CanvasGradient, lw = 0, stroke = INK): void {
  c.beginPath(); c.arc(x, y, Math.max(0.1, r), 0, TAU); c.fillStyle = fill; c.fill();
  if (lw > 0) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
}
function ring(c: CanvasRenderingContext2D, x: number, y: number, r: number, lw: number, col: string): void {
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.lineWidth = lw; c.strokeStyle = col; c.stroke();
}
function blob(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, fill: string): void {
  c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); c.fillStyle = fill; c.fill();
}
/** The line width that reads as the game's ink outline whatever the table scale (u = px per table unit). */
let LW = 0.6;
/** 碟: a big white melamine plate with a green rim band and the meal's leftovers (a sauce smear, rice grains). */
export function drawPlate(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  disc(c, x + 0.9, y + 1.3, r, 'rgba(15,26,22,.28)');
  disc(c, x, y, r, '#fbfbf3', LW * 1.4);
  ring(c, x, y, r * 0.84, r * 0.1, '#3f9a6a');
  ring(c, x, y, r * 0.71, LW * 0.6, '#c9cfc4');
  const ox = Math.cos(rot) * r * 0.25, oy = Math.sin(rot) * r * 0.25;
  blob(c, x + ox, y + oy, r * 0.36, r * 0.2, rot + 0.6, 'rgba(201,119,43,.75)');
  blob(c, x + ox * 0.6, y + oy * 0.6, r * 0.18, r * 0.09, rot + 0.9, 'rgba(160,80,30,.6)');
  for (let i = 0; i < 4; i++) {
    const a = rot + 2.4 + i * 0.5, d = r * (0.35 + 0.08 * i);
    blob(c, x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.07, r * 0.035, a, '#ffffff');
  }
}
/** 碗: a smaller, deep rice bowl with two blue rim lines, a shaded inside and some soup at the bottom. */
export function drawBowl(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  disc(c, x + 0.9, y + 1.4, r, 'rgba(15,26,22,.3)');
  disc(c, x, y, r, '#f7f8f2', LW * 1.4);
  ring(c, x, y, r * 0.9, r * 0.07, '#2f5fa8');
  ring(c, x, y, r * 0.78, r * 0.04, '#2f5fa8');
  const g = c.createRadialGradient(x - r * 0.15, y - r * 0.2, r * 0.05, x, y, r * 0.72);
  g.addColorStop(0, '#c2c8bf'); g.addColorStop(1, '#e9ece4');
  disc(c, x, y, r * 0.72, g);
  const ox = Math.cos(rot) * r * 0.16, oy = Math.sin(rot) * r * 0.16;
  blob(c, x + ox, y + oy, r * 0.34, r * 0.28, rot, 'rgba(217,164,65,.8)');
  blob(c, x + ox - r * 0.08, y + oy - r * 0.06, r * 0.1, r * 0.05, rot, 'rgba(255,240,200,.8)');
}
/** 杯: a thick white milk-tea cup with its handle (which way it points shows the rotation) and a brown tea stain inside. */
export function drawCup(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  const hx = Math.cos(rot), hy = Math.sin(rot), hl = r * (1 + TUNE.handle);
  c.save(); c.translate(x, y); c.rotate(rot);
  c.fillStyle = 'rgba(15,26,22,.28)'; c.fillRect(r * 0.6, -r * 0.24 + 1.2, hl - r * 0.6 + 0.8, r * 0.5);
  c.beginPath(); c.roundRect(r * 0.6, -r * 0.24, hl - r * 0.6, r * 0.48, r * 0.2); c.fillStyle = '#fbfbf3'; c.fill(); c.lineWidth = LW * 1.2; c.strokeStyle = INK; c.stroke();
  c.restore();
  disc(c, x + 0.8, y + 1.2, r, 'rgba(15,26,22,.3)');
  disc(c, x, y, r, '#fbfbf3', LW * 1.4);
  disc(c, x, y, r * 0.74, '#efe9dc', LW * 0.5, '#b9b2a2');
  disc(c, x - hx * r * 0.06, y - hy * r * 0.06, r * 0.56, '#a8642f');
  ring(c, x - hx * r * 0.06, y - hy * r * 0.06, r * 0.56, r * 0.08, '#d6a26a');
  blob(c, x - hx * r * 0.2 - hy * r * 0.15, y - hy * r * 0.2 + hx * r * 0.15, r * 0.14, r * 0.08, rot, 'rgba(255,236,200,.7)');
}
export const DRAW: Record<Kind, typeof drawPlate> = { plate: drawPlate, bowl: drawBowl, cup: drawCup };
function drawNoise(c: CanvasRenderingContext2D, n: Noise, top: boolean): void {
  const { x, y, rot, s } = n, ca = Math.cos(rot), sa = Math.sin(rot);
  if (!top && n.k === 'stain') {
    blob(c, x, y, 7 * s, 4.5 * s, rot, 'rgba(150,95,40,.22)');
    blob(c, x + ca * 3 * s, y + sa * 3 * s, 3 * s, 2 * s, rot + 1, 'rgba(150,95,40,.2)');
  } else if (!top && n.k === 'crumbs') {
    for (let i = 0; i < 7; i++) {
      const a = hash(Math.round(x * 10), i, 3) * TAU, d = hash(Math.round(y * 10), i, 7) * 5 * s;
      blob(c, x + Math.cos(a) * d, y + Math.sin(a) * d, 0.7 + hash(i, 1, Math.round(x)) * 0.6, 0.5, a, i % 2 ? '#c48a4a' : '#e0b070');
    }
  } else if (!top && n.k === 'napkin') {
    c.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = rot + i * TAU / 9, d = (6 + hash(i, Math.round(x), 11) * 3.5) * s;
      if (i === 0) c.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d); else c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
    c.closePath(); c.fillStyle = '#f4efe3'; c.fill(); c.lineWidth = LW * 0.8; c.strokeStyle = '#9a9384'; c.stroke();
    c.beginPath(); c.moveTo(x - ca * 4 * s, y - sa * 4 * s); c.lineTo(x + sa * 2 * s, y - ca * 2 * s); c.lineTo(x + ca * 3 * s, y + sa * 3 * s);
    c.lineWidth = LW * 0.6; c.strokeStyle = '#c5bdac'; c.stroke();
  } else if (top && n.k === 'chops') {
    for (const off of [-1.1, 1.1]) {
      const px = -sa * off * s, py = ca * off * s, L = 17 * s;
      c.beginPath(); c.moveTo(x + px - ca * L, y + py - sa * L); c.lineTo(x + px + ca * L, y + py + sa * L);
      c.lineCap = 'round'; c.lineWidth = 1.7 * s + LW; c.strokeStyle = INK; c.stroke(); c.lineWidth = 1.7 * s - LW * 0.4; c.strokeStyle = '#d8b878'; c.stroke();
    }
    c.lineCap = 'butt';
  } else if (top && n.k === 'spoon') {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.beginPath(); c.roundRect(2 * s, -1.1 * s, 7 * s, 2.2 * s, 1 * s); c.fillStyle = '#fbfbf3'; c.fill(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
    blob(c, 0, 0, 3.6 * s, 2.8 * s, 0, '#fbfbf3'); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
    blob(c, -0.3 * s, 0, 2.4 * s, 1.8 * s, 0, '#e3ddcf');
    c.restore();
  }
}

/* ---------- the screen ---------- */
export interface ClearScreen {
  readonly state: ClearState | null; readonly paused: boolean;
  begin(d?: Difficulty): void; ctx(): StationCtx; tap(k: Kind): void;
  /** Where a table-unit point is on the page (css px). */
  screenOf(x: number, y: number): { x: number; y: number };
}
/** The game page's seat: the state to draw and where the commands go; the core is stepped there, not here. */
export interface ClearExt { live(): ClearState | null; send(c: ClearCmd): void; mine(): boolean }

export function mountClear(sound: StationSound, ext?: ClearExt): ClearScreen {
  const dv = store.get('diff'); let diff: Difficulty = isDiff(dv) ? dv : 'rookie';
  const G: { st: 'start' | 'live'; paused: boolean } = { st: 'start', paused: false };
  let S: ClearState | null = null;
  const rng = seededRng((Math.random() * 2 ** 32) >>> 0);
  const ctx = (): StationCtx => ({ t: S ? S.t : 0, rng, seat: 'solo', byPlayer: true, shared: { t: S ? S.t : 0, paused: G.paused } });
  let lastCue = 0, shookAt = -1, primed = false;

  /* ---------- menu ---------- */
  const seg = $('segDiff');
  const paintSeg = (): void => { seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === diff)); };
  paintSeg();
  seg.addEventListener('click', e => { const b = e.target instanceof Element ? e.target.closest('button') : null; const v = b?.dataset.v; if (isDiff(v)) { diff = v; store.set('diff', v); paintSeg(); } });
  $b('bSnd').onclick = () => { const on = sound.toggle(); $b('bSnd').textContent = on ? '聲 開' : '聲 關'; $b('bSnd').classList.toggle('on', on); if (on) sound.play('table'); };
  $b('bMenu').onclick = () => { G.paused = true; $('ovStart').hidden = false; };
  $b('bGo').onclick = () => { begin(); };
  function begin(d?: Difficulty): void {
    if (d) { diff = d; paintSeg(); }
    // from the pause menu on the same difficulty: carry on; otherwise a fresh session
    const resume = S !== null && G.st === 'live' && S.tier === TUNE.diffTier[diff];
    G.paused = false; G.st = 'live'; $('ovStart').hidden = true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (!resume && !ext) { S = clear.init({ difficulty: diff, seed: (Math.random() * 1e9) >>> 0, players: 1 }, 'solo'); lastCue = 0; }
    wakeLock();
  }
  let wl: WakeLockSentinel | null = null;
  function wakeLock(): void {
    try { if ('wakeLock' in navigator && !wl) navigator.wakeLock.request('screen').then(w => { wl = w; w.addEventListener('release', () => { wl = null; }); }).catch(() => undefined); } catch { /* not offered */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && G.st === 'live') wakeLock(); });
  function cmd(c: ClearCmd): void { if (ext) { if (ext.mine()) ext.send(c); } else if (S && !G.paused) clear.command(S, c, ctx()); }
  function tap(k: Kind): void { if (G.st === 'live' && !G.paused) cmd({ t: 'tap', k }); }

  /* ---------- the three buttons ---------- */
  const keys = Array.from(document.querySelectorAll<HTMLButtonElement>('#keys .key'));
  for (const b of keys) {
    const k = b.dataset.k;
    if (!isKind(k)) continue;
    const cv = b.querySelector('canvas');
    if (cv) {
      const dpr = Math.min(2, window.devicePixelRatio || 1), c = ctx2d(cv); cv.width = cv.height = Math.round(64 * dpr);
      // the icon at the same size for each kind, so the buttons do not hint at the real sizes
      c.scale(64 * dpr / 40, 64 * dpr / 40); LW = 0.9;
      DRAW[k](c, k === 'cup' ? 17 : 20, 20, k === 'cup' ? 11 : 16, k === 'cup' ? 0.2 : 0.7);
    }
    b.addEventListener('pointerdown', e => {
      e.preventDefault(); tap(k);
      b.classList.add('dn'); setTimeout(() => { b.classList.remove('dn'); }, 90);
    });
  }
  window.addEventListener('keydown', e => {
    const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    const k = KINDS[i];
    if (k && !e.repeat) tap(k);
  });
  document.addEventListener('touchmove', e => { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', e => { e.preventDefault(); });
  document.addEventListener('contextmenu', e => { e.preventDefault(); });
  document.addEventListener('dblclick', e => { e.preventDefault(); });

  /* ---------- the board ---------- */
  const wrap = $('board'), cv0 = wrap.querySelector('canvas');
  if (!(cv0 instanceof HTMLCanvasElement)) throw new Error('board canvas missing');
  const cv: HTMLCanvasElement = cv0;
  const C = ctx2d(cv);
  const view = { W: 300, H: 400, dpr: 1, u: 3, ox: 0, oy: 0, key: '' };
  const fit = (): void => { const r = wrap.getBoundingClientRect(); view.W = Math.max(200, Math.floor(r.width)); view.H = Math.max(200, Math.floor(r.height)); view.key = ''; };
  new ResizeObserver(fit).observe(wrap); fit();
  const TOP = 40;   // room above the table for its name and clock
  let bg: HTMLCanvasElement | null = null;
  function layout(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1), key = [view.W, view.H, dpr].join('x');
    if (key === view.key) return;
    view.key = key; view.dpr = dpr;
    cv.width = Math.round(view.W * dpr); cv.height = Math.round(view.H * dpr); cv.style.width = `${view.W}px`; cv.style.height = `${view.H}px`;
    view.u = Math.min((view.W - 20) / TUNE.tw, (view.H - TOP - 14) / TUNE.th);
    view.ox = (view.W - TUNE.tw * view.u) / 2; view.oy = TOP + (view.H - TOP - 6 - TUNE.th * view.u) / 2;
    bg = renderBg();
  }
  /** The mosaic floor and the empty table, cached per size. */
  function renderBg(): HTMLCanvasElement {
    const b = document.createElement('canvas'); b.width = cv.width; b.height = cv.height;
    const c = ctx2d(b); c.scale(view.dpr, view.dpr);
    c.fillStyle = '#c9d8cc'; c.fillRect(0, 0, view.W, view.H);
    const T = 11;
    for (let ty = 0; ty * T < view.H; ty++) for (let tx = 0; tx * T < view.W; tx++) {
      const m = (tx + ty) % 7 === 0 || ((tx - ty) % 7 + 7) % 7 === 0;
      c.fillStyle = m ? '#94c6aa' : hash(tx, ty, 5) < 0.12 ? '#e2ece2' : '#eef3ea'; c.fillRect(tx * T + 1, ty * T + 1, T - 2, T - 2);
    }
    const u = view.u, x = view.ox, y = view.oy, w = TUNE.tw * u, h = TUNE.th * u, R = 4 * u;
    c.fillStyle = 'rgba(15,26,22,.35)'; c.beginPath(); c.roundRect(x + 4, y + 7, w, h, R); c.fill();
    // aluminium edge band, then the cream formica top with its speckle
    c.beginPath(); c.roundRect(x - 3, y - 3, w + 6, h + 6, R + 2); c.fillStyle = INK; c.fill();
    c.beginPath(); c.roundRect(x - 1, y - 1, w + 2, h + 2, R + 1); c.fillStyle = '#b9c2c6'; c.fill();
    c.beginPath(); c.roundRect(x + 3, y + 3, w - 6, h - 6, R - 1); c.fillStyle = '#efe2bd'; c.fill();
    for (let i = 0; i < 900; i++) {
      const px = x + 4 + hash(i, 1, 9) * (w - 8), py = y + 4 + hash(i, 2, 9) * (h - 8);
      c.fillStyle = i % 3 === 0 ? 'rgba(160,130,80,.28)' : i % 3 === 1 ? 'rgba(255,255,255,.45)' : 'rgba(120,150,120,.22)'; c.fillRect(px, py, 1.6, 1.6);
    }
    c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(x + 6, y + 5, w - 12, 2);
    return b;
  }
  function chip(text: string, px: number, py: number, bg2: string, fg = INK, size = 15, align: 'left' | 'right' | 'center' = 'center'): void {
    C.font = `900 ${size}px ${FONT}`;
    const w = C.measureText(text).width + 14, h = size + 9, x = align === 'left' ? px : align === 'right' ? px - w : px - w / 2;
    C.fillStyle = INK; C.beginPath(); C.roundRect(x - 2, py - h / 2 - 2, w + 4, h + 6, 8); C.fill();
    C.fillStyle = bg2; C.beginPath(); C.roundRect(x, py - h / 2, w, h, 7); C.fill();
    C.fillStyle = fg; C.textAlign = 'center'; C.textBaseline = 'middle'; C.fillText(text, x + w / 2, py + 1);
  }
  function outline(text: string, px: number, py: number, col: string, size: number): void {
    C.font = `900 ${size}px ${FONT}`; C.textAlign = 'center'; C.textBaseline = 'middle';
    C.lineJoin = 'round'; C.lineWidth = Math.max(4, size / 5); C.strokeStyle = INK; C.strokeText(text, px, py); C.fillStyle = col; C.fillText(text, px, py);
  }
  /** The dishes still there (and the ones just taken, lifting away; or popping back after a reset). */
  function drawTable(tb: Table, now: number, popAt: number | null): void {
    const u = view.u;
    C.save(); C.translate(view.ox, view.oy); C.scale(u, u); LW = Math.max(0.35, 1.6 / u);
    // clip to the table top so a dish at the edge never paints over the floor
    C.beginPath(); C.roundRect(0, 0, TUNE.tw, TUNE.th, 4); C.clip();
    for (const n of tb.noise) drawNoise(C, n, false);
    const pop = popAt !== null && now - popAt < 0.25 ? 0.75 + (now - popAt) : 1;
    for (const it of tb.items) drawItem(it, now, pop);
    for (const n of tb.noise) drawNoise(C, n, true);
    C.restore();
  }
  function drawItem(it: Item, now: number, pop: number): void {
    let k = pop, a = 1, lift = 0;
    if (it.goneAt !== null) {
      const p = (now - it.goneAt) / 0.22;
      if (p >= 1 || p < 0) return;
      k = 1 + 0.35 * p; a = 1 - p; lift = 6 * p;
    }
    C.save(); C.globalAlpha = a; C.translate(it.x, it.y - lift); C.scale(k, k);
    DRAW[it.k](C, 0, 0, it.r, it.rot);
    C.restore();
  }
  function stamp(secs: number, resets: number, age: number): void {
    const cx = view.ox + TUNE.tw * view.u / 2, cy = view.oy + TUNE.th * view.u * 0.45, R = Math.min(96, TUNE.tw * view.u * 0.3);
    const k = age < 0.18 ? 1.6 - (age / 0.18) * 0.6 : 1;
    C.save(); C.translate(cx, cy); C.rotate(-0.2); C.scale(k, k);
    C.globalAlpha = Math.min(1, age / 0.12);
    C.fillStyle = 'rgba(251,250,241,.85)'; C.beginPath(); C.arc(0, 0, R, 0, TAU); C.fill();
    C.lineWidth = 7; C.strokeStyle = '#c8323c'; C.stroke();
    C.lineWidth = 2; C.beginPath(); C.arc(0, 0, R - 9, 0, TAU); C.stroke();
    C.fillStyle = '#c8323c'; C.textAlign = 'center'; C.textBaseline = 'middle';
    C.font = `900 ${Math.round(R * 0.5)}px ${FONT}`; C.fillText('執好', 0, -R * 0.18);
    C.font = `900 ${Math.round(R * 0.26)}px ${FONT}`; C.fillText(`${secs.toFixed(1)} 秒`, 0, R * 0.32);
    if (resets > 0) { C.font = `700 ${Math.round(R * 0.16)}px ${FONT}`; C.fillText(`重嚟 ${resets} 次`, 0, R * 0.6); }
    C.restore();
  }
  function draw(): void {
    layout();
    C.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    if (bg) C.drawImage(bg, 0, 0, view.W, view.H);
    const s = S;
    if (!s) { if (ext) chip('等緊開工…', view.W / 2, view.oy + TUNE.th * view.u / 2, '#fff6c8'); return; }
    const now = s.t, tb = s.tables[0], last = s.last;
    if (s.hold > 0 && last) {
      drawTable(last, now, null);
      chip(last.name, view.ox, TOP / 2 + 2, '#ffd25a', INK, 16, 'left');
      stamp(last.secs, last.resets, now - last.doneAt);
    } else if (tb) {
      const flash = s.resetAt !== null && s.resetTable === tb.table && now - s.resetAt < TUNE.resetPen + 0.25 ? now - s.resetAt : -1;
      drawTable(tb, now, flash >= 0 ? s.resetAt : null);
      chip(tb.name, view.ox, TOP / 2 + 2, '#ffd25a', INK, 16, 'left');
      chip(`${Math.max(0, now - tb.at).toFixed(1)} 秒`, view.ox + TUNE.tw * view.u, TOP / 2 + 2, '#fbfaf1', INK, 16, 'right');
      if (flash >= 0) {
        const a = Math.max(0, 1 - flash / (TUNE.resetPen + 0.25));
        C.fillStyle = `rgba(200,50,60,${(0.35 * a).toFixed(3)})`; C.beginPath(); C.roundRect(view.ox, view.oy, TUNE.tw * view.u, TUNE.th * view.u, 4 * view.u); C.fill();
        const cy = view.oy + TUNE.th * view.u * 0.42;
        C.globalAlpha = Math.min(1, a * 2.5);
        C.fillStyle = 'rgba(15,26,22,.82)'; C.fillRect(0, cy - 44, view.W, 92);
        outline('多撳咗！', view.W / 2, cy - 14, '#ff6b6b', 34);
        outline('成張枱重新嚟過', view.W / 2, cy + 26, '#fff6c8', 22);
        C.globalAlpha = 1;
      }
      if (s.selfFeed && s.sess.tables === 0 && now - s.upAt < 3 && flash < 0 && tb.taps === 0) chip('數清楚先撳！', view.W / 2, view.oy + TUNE.th * view.u - 22, '#fff6c8', INK, 15);
    } else chip(s.selfFeed ? '擺緊枱…' : '等緊客走…', view.W / 2, view.oy + TUNE.th * view.u / 2, '#fff6c8');
  }

  /* ---------- HUD, sound, buttons follow the state ---------- */
  function hud(): void {
    let txt = '';
    if (S && G.st === 'live') {
      const se = S.sess;
      txt = S.selfFeed
        ? `執咗 ${se.tables} 張${se.tables ? ` · 平均 ${(se.secs / se.tables).toFixed(1)}秒 · 最快 ${se.best.toFixed(1)}秒` : ''}${se.resets ? ` · 重嚟 ${se.resets} 次` : ''}`
        : `等緊 ${S.tables.length} 張枱`;
    }
    $('hs').textContent = txt; $('hud').classList.toggle('live', txt !== '');
    const on = S !== null && tappable(S) && !G.paused;
    for (const b of keys) b.classList.toggle('off', !on);
  }
  function cues(): void {
    if (!S) return;
    if (S.cueN < lastCue) lastCue = 0;   // a new session
    // a seat's page opens on a station that ran before: the last tables' taps and stamps are old news; play
    // only from this table's arrival on
    if (ext && !primed) { primed = true; const up = S.cues.reduce((a, c) => (c.k === 'table' ? c.id : a), 0); lastCue = up ? up - 1 : S.cueN; }
    for (const c of S.cues) if (c.id > lastCue) {
      lastCue = c.id; sound.play(c.k, c.arg);
      if (c.k === 'reset' && shookAt !== c.id) { shookAt = c.id; wrap.classList.remove('shake'); wrap.getBoundingClientRect(); wrap.classList.add('shake'); }
    }
  }

  /* ---------- main loop ---------- */
  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (ext) S = ext.live();
    else if (S && G.st === 'live' && !G.paused && !document.hidden) clear.step(S, dt, ctx());
    draw(); hud(); cues();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // as a seat: straight in, no menu (the game page owns the shift)
  if (ext) { $b('bMenu').hidden = true; $('ovStart').hidden = true; G.st = 'live'; }
  return {
    get state() { return S; }, get paused() { return G.paused; },
    begin, ctx, tap,
    screenOf(x, y) { const r = cv.getBoundingClientRect(); return { x: r.left + view.ox + x * view.u, y: r.top + view.oy + y * view.u }; },
  };
}
