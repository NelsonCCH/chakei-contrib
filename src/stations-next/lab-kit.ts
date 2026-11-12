// Screen helpers shared by the station pages ported from the original prototypes (燒味, 外賣): the two-layer
// canvas scene (a chunky low-res pixel layer and a crisp text layer, both sized from the scene element), the pixel
// primitives, the text chips, and the synthesized sound behind a small interface. Same code as the prototypes, typed.

export const INK = '#0f1a16';
const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;

export interface Scene {
  wrap: HTMLElement; cv: HTMLCanvasElement; tv: HTMLCanvasElement; x: CanvasRenderingContext2D; t: CanvasRenderingContext2D;
  W: number; H: number; S: number; LW: number; LH: number; dpr: number; key: string;
}
function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext('2d');
  if (!x) throw new Error('no 2d canvas');
  return x;
}
/** The scene inside `wrap`, which holds a canvas.pxl and a canvas.txl; it re-fits on every size change. */
export function makeScene(wrap: HTMLElement): Scene {
  const cv = wrap.querySelector('canvas.pxl'), tv = wrap.querySelector('canvas.txl');
  if (!(cv instanceof HTMLCanvasElement) || !(tv instanceof HTMLCanvasElement)) throw new Error('scene canvases missing');
  const sc: Scene = { wrap, cv, tv, x: ctx2d(cv), t: ctx2d(tv), W: 300, H: 400, S: 3, LW: 130, LH: 250, dpr: 1, key: '' };
  const fit = () => { const r = wrap.getBoundingClientRect(); sc.W = Math.max(200, Math.floor(r.width)); sc.H = Math.max(200, Math.floor(r.height)); sc.key = ''; };
  new ResizeObserver(fit).observe(wrap); fit();
  return sc;
}
/**
 * Sizes both layers for a 130 x `designH` logical design (scale `minS` to 4.5) and clears the text layer. The defaults
 * (250, 2) are every prototype's; 送外賣 passes its own so the scene always shows the same metres of road ahead,
 * zooming out a little on a short scene (the game's floor job) instead of showing less road.
 */
export function beginScene(sc: Scene, designH = 250, minS = 2) {
  const S = clamp(Math.min(sc.W / 130, sc.H / designH), minS, 4.5), key = [sc.W, sc.H, S].join('x');
  if (key !== sc.key) {
    sc.key = key; sc.S = S; sc.LW = Math.floor(sc.W / S); sc.LH = Math.floor(sc.H / S);
    sc.cv.width = sc.LW; sc.cv.height = sc.LH; sc.cv.style.width = `${Math.round(sc.LW * S)}px`; sc.cv.style.height = `${Math.round(sc.LH * S)}px`;
    sc.dpr = Math.min(2, window.devicePixelRatio || 1);
    sc.tv.width = Math.round(sc.LW * S * sc.dpr); sc.tv.height = Math.round(sc.LH * S * sc.dpr); sc.tv.style.width = `${Math.round(sc.LW * S)}px`; sc.tv.style.height = `${Math.round(sc.LH * S)}px`;
  }
  sc.x.imageSmoothingEnabled = false; sc.x.globalAlpha = 1;
  sc.t.setTransform(sc.dpr, 0, 0, sc.dpr, 0, 0); sc.t.clearRect(0, 0, sc.LW * sc.S, sc.LH * sc.S);
}
// the prototypes' own formula (float multiply then | 0, not Math.imul), so every speckle lands where it did in the prototype
export function hash(x: number, y: number, s: number) { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = ((h ^ (h >>> 13)) * 1274126177) | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }

/** Pixel primitives on the low-res layer. roundWH: the 燒味 prototype rounds widths and heights too, the 外賣 prototype only x / y. */
export function pixels(sc: Scene, roundWH: boolean) {
  const P = (x: number, y: number, w: number, h: number, c: string) => {
    sc.x.fillStyle = c;
    if (roundWH) sc.x.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); else sc.x.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const bx = (x: number, y: number, w: number, h: number, fill: string, hi?: string, lo?: string) => {
    if (!roundWH) { w = Math.round(w); h = Math.round(h); }
    P(x, y, w, h, INK); P(x + 1, y + 1, w - 2, h - 2, fill); if (hi) P(x + 1, y + 1, w - 2, 1, hi); if (lo) P(x + w - 2, y + 1, 1, h - 2, lo);
  };
  const el = (cx: number, cy: number, rx: number, ry: number, fill: string, edge: string | null = INK) => {
    cx = Math.round(cx); cy = Math.round(cy); rx = Math.max(0, Math.round(rx)); ry = Math.max(0, Math.round(ry));
    const row = (r1: number, r2: number, col: string) => { for (let dy = -r2; dy <= r2; dy++) { const span = Math.round(r1 * Math.sqrt(Math.max(0, 1 - (dy * dy) / (r2 * r2 || 1)))); P(cx - span, cy + dy, span * 2 + 1, 1, col); } };
    if (edge) { row(rx, ry, edge); if (rx > 1 && ry > 1) row(rx - 1, ry - 1, fill); }
    else row(rx, ry, fill);
  };
  const pline = (x0: number, y0: number, x1: number, y1: number, col: string, s = 1) => {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let k = 0; k <= n; k++) P(x0 + (x1 - x0) * k / n - (s >> 1), y0 + (y1 - y0) * k / n - (s >> 1), s, s, col);
  };
  return { P, bx, el, pline };
}

/** Text on the crisp layer, placed in logical px. family: the prototype's font stack. */
export function texts(sc: Scene, family: string) {
  const FONT = (w: number | string, s: number) => `${w} ${s}px ${family}`;
  const chipT = (lx: number, ly: number, text: string, bg: string, fg = INK, size = 12) => {
    const t = sc.t, px = lx * sc.S, py = ly * sc.S;
    t.font = FONT(900, size);
    const w = t.measureText(text).width + 10, h = size + 4;
    t.fillStyle = INK; t.fillRect(px - w / 2 - 2, py - h / 2 - 2, w + 4, h + 5);
    t.fillStyle = bg; t.fillRect(px - w / 2, py - h / 2, w, h);
    t.fillStyle = fg; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillText(text, px, py + 1);
  };
  const outlineT = (lx: number, ly: number, text: string, col: string, size = 14, align: CanvasTextAlign = 'center') => {
    const t = sc.t; t.font = FONT(900, size); t.textAlign = align; t.textBaseline = 'middle';
    t.lineWidth = 4; t.strokeStyle = INK; t.strokeText(text, lx * sc.S, ly * sc.S); t.fillStyle = col; t.fillText(text, lx * sc.S, ly * sc.S);
  };
  const textT = (lx: number, ly: number, text: string, col = INK, size = 11, weight = 700, align: CanvasTextAlign = 'left') => {
    const t = sc.t; t.font = FONT(weight, size); t.textAlign = align; t.textBaseline = 'top'; t.fillStyle = col; t.fillText(text, lx * sc.S, ly * sc.S);
  };
  return { FONT, chipT, outlineT, textT };
}
/** Restarts the scene's shake animation (CSS class .shake). */
export function shake(sc: Scene) { sc.wrap.classList.remove('shake'); sc.wrap.getBoundingClientRect(); sc.wrap.classList.add('shake'); }   // the read forces a reflow

/* ---------- sound: off by default, synthesized ---------- */
/** What a station screen may play. A muted sound is a no-op. */
export interface Sound {
  tone: (f: number, dur: number, type?: OscillatorType, vol?: number, f2?: number, delay?: number) => void;
  /** Band-passed noise burst; curve 2 decays as (1 - t)^2 (the 燒味 prototype), 1 linearly (the 外賣 prototype). */
  noise: (dur: number, vol?: number, freq?: number, delay?: number, q?: number, curve?: number) => void;
  /**
   * s from scheduling a sound to hearing it (the output's latency), read fresh on every call (the audio route,
   * and with it the latency, changes when the walkie-talkie's mic opens and closes). A rhythm schedules this much early.
   */
  lat?: () => number;
}
export const SILENT: Sound = { tone: () => { /* muted */ }, noise: () => { /* muted */ } };
/** Fired on the window when the game page's walkie-talkie says the page's sound should come back (src/ptt/sfx.ts). */
const AUDIO_REVIVE = 'ckf-audio-revive';
/** The most output latency a rhythm takes off (a bad reading must not move the beat by more). */
const LAT_CAP = 0.5;
/**
 * The prototypes' WebAudio sound, created only when the player switches it on (a tap, so iOS allows it). `on` is false until
 * then and whenever the page is muted, and every call is a no-op while it is off.
 */
export function webSound() {
  let ac: AudioContext | null = null, on = false;
  const sound: Sound = {
    tone: (f, dur, type = 'square', vol = 0.04, f2 = 0, delay = 0) => {
      if (!on || !ac) return;
      const t0 = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    },
    noise: (dur, vol = 0.05, freq = 1200, delay = 0, q = 1, curve = 2) => {
      if (!on || !ac) return;
      const n = Math.floor(ac.sampleRate * dur), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, curve);
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t0 = ac.currentTime + delay;
      s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol; s.connect(f).connect(g).connect(ac.destination); s.start(t0);
    },
    lat: () => {
      if (!ac) return 0;
      const v = ac.outputLatency > 0 ? ac.outputLatency : ac.baseLatency;
      return Number.isFinite(v) && v > 0 ? Math.min(LAT_CAP, v) : 0;
    },
  };
  // sound that is on comes back by itself after the context stopped without being asked (iOS: 'interrupted'
  // or 'suspended' while the walkie-talkie's mic moves the audio route; the page hidden): on the game page's word
  // (AUDIO_REVIVE, this page is often its seat iframe), the page coming back into view, and shortly after the stop.
  const heal = () => { if (on && ac && ac.state !== 'running' && ac.state !== 'closed' && document.visibilityState === 'visible') ac.resume().catch(() => { /* the next try */ }); };
  addEventListener(AUDIO_REVIVE, heal);
  document.addEventListener('visibilitychange', heal);
  return {
    sound,
    get on() { return on; },
    /** The context's state ('none' before sound was first switched on): what the tests read. */
    get state(): string { return ac ? ac.state : 'none'; },
    /** Switch on (from a tap) or off; returns whether it is on. */
    set(v: boolean): boolean {
      on = false;
      if (!v) return false;
      try {
        if (!ac) { const c = new AudioContext(); c.addEventListener('statechange', () => { if (c.state !== 'running') setTimeout(heal, 300); }); ac = c; }
        void ac.resume(); on = true;
      } catch { on = false; }
      return on;
    },
  };
}

/** Per-viewer settings in localStorage (try/catch: private windows and blocked storage). */
export function store(prefix: string) {
  return {
    get<T>(k: string, d: T, ok: (v: unknown) => v is T): T { try { const v = localStorage.getItem(prefix + k); if (v === null) return d; const p: unknown = JSON.parse(v); return ok(p) ? p : d; } catch { return d; } },
    set(k: string, v: unknown) { try { localStorage.setItem(prefix + k, JSON.stringify(v)); } catch { /* storage off */ } },
  };
}
export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isDifficulty = (v: unknown): v is 'rookie' | 'pro' | 'ace' => v === 'rookie' || v === 'pro' || v === 'ace';

/** The prototypes' page guards: no scroll, pinch, long-press menu or double-tap zoom; a screen wake lock while playing. */
export function pageGuards() {
  document.addEventListener('touchmove', e => { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', e => { e.preventDefault(); });
  document.addEventListener('contextmenu', e => { e.preventDefault(); });
  document.addEventListener('dblclick', e => { e.preventDefault(); });
}
let wl: WakeLockSentinel | null = null;
export function wakeLock() {
  try {
    if (!wl && 'wakeLock' in navigator) navigator.wakeLock.request('screen').then(w => { wl = w; w.addEventListener('release', () => { wl = null; }); }).catch(() => { /* not allowed */ });
  } catch { /* not supported */ }
}
export function el$(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e;
}
