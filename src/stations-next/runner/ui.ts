// 傳菜 runner screen: the tilt maze's drawing and input, ported 1:1 from the original prototype.
// The simulation lives in core.ts; this file reads the phone's tilt (DeviceOrientation, with the prototype's calibration;
// the thumb-drag / keyboard fallbacks; one control path for every entry), sends it as `tilt` commands, steps the core with the frame
// time, draws, and plays the core's cues through the injected sound interface.
import { seededRng, type Difficulty, type StationCtx } from '../contract';
import type { Recipes, StationSound } from '../sound';
import { TUNE, at, clamp, rngFn, SHIRTS, type Layout, type Wall } from './maze';
import { runner, available, carrying, hardV, layoutOf, remaining, tableNo, type RunnerCmd, type RunnerState, type Order } from './core';
import { runnerBot } from './bot';
import { motionAsk, setRunnerControl } from '../../permit/motion';
import { phoneLandscape } from '../orient';

const INK = '#0f1a16', D2R = Math.PI / 180;
const $ = (id: string): HTMLElement => { const e = document.getElementById(id); if (!e) throw new Error(`#${id} missing`); return e; };
function $b(id: string): HTMLButtonElement { const e = $(id); if (!(e instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`); return e; }
const store = {
  get(k: string): unknown { try { const v = localStorage.getItem('st_runner_' + k); return v === null ? undefined : JSON.parse(v); } catch { return undefined; } },
  set(k: string, v: unknown): void { try { localStorage.setItem('st_runner_' + k, JSON.stringify(v)); } catch { /* private mode: no memory */ } },
};
const isDiff = (v: unknown): v is Difficulty => v === 'rookie' || v === 'pro' || v === 'ace';
const fx = Math.random;   // cosmetic randomness only

/* ---------- pixel helpers (the prototype's, standalone) ---------- */
let PX: CanvasRenderingContext2D;
const P = (x: number, y: number, w: number, h: number, c: string): void => { PX.fillStyle = c; PX.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
function bx(x: number, y: number, w: number, h: number, fill: string, hi?: string, lo?: string): void {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h); P(x, y, w, h, INK); P(x + 1, y + 1, w - 2, h - 2, fill); if (hi) P(x + 1, y + 1, w - 2, 1, hi); if (lo) P(x + w - 2, y + 1, 1, h - 2, lo);
}
function el(cx: number, cy: number, rx: number, ry: number, fill: string, edge: string | null = INK): void {
  cx = Math.round(cx); cy = Math.round(cy); rx = Math.max(0, Math.round(rx)); ry = Math.max(0, Math.round(ry));
  const row = (r1: number, r2: number, col: string): void => { for (let dy = -r2; dy <= r2; dy++) { const span = Math.round(r1 * Math.sqrt(Math.max(0, 1 - (dy * dy) / (r2 * r2 || 1)))); P(cx - span, cy + dy, span * 2 + 1, 1, col); } };
  if (edge) { row(rx, ry, edge); if (rx > 1 && ry > 1) row(rx - 1, ry - 1, fill); }
  else row(rx, ry, fill);
}
function blob(x: number, y: number, r: number, col: string): void { x = Math.round(x); y = Math.round(y); P(x - r + 1, y - r + 1, 2 * r - 1, 2 * r - 1, col); P(x - r + 2, y - r, 2 * r - 3, 2 * r + 1, col); P(x - r, y - r + 2, 2 * r + 1, 2 * r - 3, col); }
interface Scene { wrap: HTMLElement; cv: HTMLCanvasElement; tv: HTMLCanvasElement; x: CanvasRenderingContext2D; t: CanvasRenderingContext2D; W: number; H: number; S: number; LW: number; LH: number; dpr: number; key: string; div: number }
function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D { const x = c.getContext('2d'); if (!x) throw new Error('no 2d canvas'); return x; }
function canvasIn(wrap: HTMLElement, sel: string): HTMLCanvasElement { const c = wrap.querySelector(sel); if (!(c instanceof HTMLCanvasElement)) throw new Error(`${sel} missing`); return c; }
function makeScene(id: string, div: number): Scene {
  const wrap = $(id), cv = canvasIn(wrap, '.pxl'), tv = canvasIn(wrap, '.txl');
  const sc: Scene = { wrap, cv, tv, x: ctx2d(cv), t: ctx2d(tv), W: 300, H: 160, S: 3, LW: 100, LH: 53, dpr: 1, key: '', div };
  const fit = (): void => { const r = wrap.getBoundingClientRect(); sc.W = Math.max(60, Math.floor(r.width)); sc.H = Math.max(40, Math.floor(r.height)); sc.key = ''; };
  new ResizeObserver(fit).observe(wrap); fit();
  return sc;
}
function beginScene(sc: Scene): void {
  const S = clamp(sc.W / sc.div, 2, 4), key = [sc.W, sc.H, S].join('x');
  if (key !== sc.key) {
    sc.key = key; sc.S = S; sc.LW = Math.floor(sc.W / S); sc.LH = Math.floor(sc.H / S);
    sc.cv.width = sc.LW; sc.cv.height = sc.LH; sc.cv.style.width = `${Math.round(sc.LW * S)}px`; sc.cv.style.height = `${Math.round(sc.LH * S)}px`;
    sc.dpr = Math.min(2, window.devicePixelRatio || 1);
    sc.tv.width = Math.round(sc.LW * S * sc.dpr); sc.tv.height = Math.round(sc.LH * S * sc.dpr); sc.tv.style.width = `${Math.round(sc.LW * S)}px`; sc.tv.style.height = `${Math.round(sc.LH * S)}px`;
  }
  PX = sc.x; PX.imageSmoothingEnabled = false;
  sc.t.setTransform(sc.dpr, 0, 0, sc.dpr, 0, 0); sc.t.clearRect(0, 0, sc.LW * sc.S, sc.LH * sc.S);
}
const FONT = '"PingFang HK","Noto Sans HK","Microsoft JhengHei",sans-serif';
function chipC(t: CanvasRenderingContext2D, px: number, py: number, text: string, bg: string, fg = INK, size = 12): void {
  t.font = `900 ${size}px ${FONT}`;
  const w = t.measureText(text).width + 10, h = size + 4;
  t.fillStyle = INK; t.fillRect(px - w / 2 - 2, py - h / 2 - 2, w + 4, h + 5);
  t.fillStyle = bg; t.fillRect(px - w / 2, py - h / 2, w, h);
  t.fillStyle = fg; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillText(text, px, py + 1);
}
function outlineC(t: CanvasRenderingContext2D, px: number, py: number, text: string, col: string, size = 14): void {
  t.font = `900 ${size}px ${FONT}`; t.textAlign = 'center'; t.textBaseline = 'middle';
  t.lineWidth = 4; t.lineJoin = 'round'; t.strokeStyle = INK; t.strokeText(text, px, py); t.fillStyle = col; t.fillText(text, px, py);
}

/** The prototype's SFX, as recipes for the injected sound interface. */
export const RUNNER_SOUNDS: Recipes = {
  tick(s) { s.tone(900, 0.03, 'sine', 0.02); },
  clink(s) { s.tone(2400, 0.08, 'sine', 0.05); s.tone(3100, 0.1, 'sine', 0.04, 0, 0.05); },
  bump(s) { s.tone(160, 0.12, 'square', 0.06, 90); },
  guest(s) { s.tone(520, 0.1, 'triangle', 0.05, 380); s.tone(160, 0.12, 'square', 0.05, 90); },
  ko(s) { s.noise(0.35, 0.12, 2500); s.tone(300, 0.5, 'square', 0.05, 70); },
  sink(s) { [660, 880, 1100, 1320].forEach((f, i) => { s.tone(f, 0.12, 'square', 0.035, 0, i * 0.07); }); },
  lip(s) { s.tone(700, 0.08, 'sine', 0.04, 1000); },
  splash(s) { s.noise(0.15, 0.04, 700); },
};

export interface RunnerScreen { readonly state: RunnerState | null; readonly mode: 'tilt' | 'thumb' | null; readonly paused: boolean; begin(mode: 'tilt' | 'thumb'): void; ctx(): StationCtx; bot(): RunnerCmd | null; screenOf(x: number, y: number): { x: number; y: number } }

/** The game page's seat: the state to draw and where the commands go; the shift is stepped there, not here. */
export interface RunnerExt { live(): RunnerState | null; send(c: RunnerCmd): void; mine(): boolean }
export function mountRunner(sound: StationSound, ext?: RunnerExt): RunnerScreen {
  const dv = store.get('diff'); let diff: Difficulty = isDiff(dv) ? dv : 'pro';
  const sv = store.get('sens'); let sens = typeof sv === 'number' ? sv : 1, debug = false;
  const G: { st: 'start' | 'live'; mode: 'tilt' | 'thumb' | null; paused: boolean; calT: number } = { st: 'start', mode: null, paused: false, calT: 0 };
  let S: RunnerState | null = null;
  interface Input {
    raw: { b: number; g: number } | null; cal: { x: number; y: number } | null; calBuf: { x: number; y: number }[]; evN: number; evRate: number;
    keys: Record<string, boolean>; kx: number; ky: number; drag: { id: number; x0: number; y0: number; x: number; y: number } | null;
  }
  const IN: Input = { raw: null, cal: null, calBuf: [], evN: 0, evRate: 0, keys: {}, kx: 0, ky: 0, drag: null };
  const rng = seededRng((Math.random() * 2 ** 32) >>> 0);
  const ctx = (): StationCtx => ({ t: S ? S.clock : 0, rng, seat: 'solo', byPlayer: true, shared: { t: S ? S.clock : 0, paused: G.paused } });
  let lastCue = 0, seenTrip = '', seenResult = false, seenEnd = false;

  /* ---------- menu wiring ---------- */
  function segInit(id: string, cur: string, on: (v: string) => void): void {
    const seg = $(id); const paint = (v: string): void => { seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); };
    paint(cur); seg.addEventListener('click', e => { const b = e.target instanceof Element ? e.target.closest('button') : null; if (!b?.dataset.v) return; on(b.dataset.v); paint(b.dataset.v); });
  }
  segInit('segDiff', diff, v => { if (isDiff(v)) { diff = v; store.set('diff', v); } });
  segInit('segSens', String(sens), v => { sens = +v; store.set('sens', +v); });
  $b('bSnd').onclick = () => { const on = sound.toggle(); $b('bSnd').textContent = on ? '聲 開' : '聲 關'; $b('bSnd').classList.toggle('on', on); if (on) sound.play('clink'); };
  $b('bDbg').onclick = () => { debug = !debug; $('dbg').hidden = !debug; $b('bDbg').classList.toggle('on', debug); };
  $b('bMenu').onclick = () => { G.paused = true; $('ovStart').hidden = false; };
  $b('bCal').onclick = () => { calibrate(); };
  $('pick').addEventListener('click', e => { const b = e.target instanceof Element ? e.target.closest('button') : null; if (b instanceof HTMLButtonElement && !b.disabled) cmd({ t: 'pick', n: Number(b.dataset.n) }); });

  function setMsg(s: string): void { const m = document.getElementById('msg'); if (m) m.textContent = s; }
  /*
   * One control everywhere (solo, co-op, party, lessons and this page alike). The finger plays from the
   * first frame; the first motion reading switches the screen to tilt (calibrated on that resting angle),
   * and a finger drag still adds to it. iOS gives readings only after its permission: asked (motionAsk, once per tab)
   * before play starts, never mid-play: here by the standalone page's 開工 tap, on the game page by the
   * level's start tap or the room's lobby (main.ts, net.ts); the picker's 1/2/3 taps no longer ask.
   * Refused, not asked or no sensor: no reading comes, the finger stays. Nothing waits on the prompt.
   */
  function onOrient(e: DeviceOrientationEvent): void {
    if (e.beta == null || e.gamma == null) return;
    IN.raw = { b: e.beta, g: e.gamma }; IN.evN++;
    if (G.mode === 'thumb') toTilt();
  }
  if ('DeviceOrientationEvent' in window) window.addEventListener('deviceorientation', onOrient);
  function toTilt(): void { G.mode = 'tilt'; $b('bCal').hidden = false; setRunnerControl('tilt'); calibrate(); }
  function askTilt(): void {
    void motionAsk(false).then(r => { if (r === 'denied' && !IN.raw) setMsg('冇開動作感應：用手指拖嚟玩。想用斜：關咗呢個分頁再開，彈出嚟就撳「允許」。'); });
  }
  /** The one start: the control is decided by the readings, not by the player. */
  function play(): void { setMsg(''); askTilt(); wakeLock(); begin(IN.raw ? 'tilt' : 'thumb'); }
  $b('bGo').onclick = play;
  let wl: WakeLockSentinel | null = null;
  function wakeLock(): void {
    try { if ('wakeLock' in navigator && !wl) navigator.wakeLock.request('screen').then(w => { wl = w; w.addEventListener('release', () => { wl = null; }); }).catch(() => undefined); } catch { /* not offered */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) IN.drag = null; else if (G.mode) wakeLock(); });

  function begin(mode: 'tilt' | 'thumb'): void {
    // From the pause menu with a shift going (same difficulty): continue; otherwise a fresh shift.
    const resume = S !== null && S.dk === diff && G.st !== 'start' && S.st !== 'end';
    G.mode = mode; G.paused = false; $('ovStart').hidden = true; $('ovCard').hidden = true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    $b('bCal').hidden = mode !== 'tilt'; setRunnerControl(mode);
    if (!resume && !ext) newRun();
    if (ext) G.st = 'live';
    if (mode === 'tilt') calibrate();
  }
  function calibrate(): void { if (G.mode !== 'tilt') return; G.calT = 0.45; IN.calBuf = []; }
  function newRun(): void {
    S = runner.init({ difficulty: diff, seed: (Math.random() * 1e9) >>> 0, players: 1 }, 'solo');
    G.st = 'live'; lastCue = 0; seenTrip = ''; seenResult = false; seenEnd = false;
    $('ovCard').hidden = true; $('toast').hidden = true;
  }
  function cmd(c: RunnerCmd): void { if (ext) { if (ext.mine()) ext.send(c); } else if (S) runner.command(S, c, ctx()); }

  /* ---------- picker, toast and end card follow the core's state ---------- */
  function syncPick(): void {
    if (!S) return;
    const key = `${S.run.trip}:${S.trip.seed}:${S.trip.nos.join(',')}:${S.st === 'pick' ? 1 : 0}`;
    if (key === seenTrip) return;
    seenTrip = key; seenResult = false;
    const pk = $('pick'), s = S;
    if (s.st !== 'pick') { pk.hidden = true; return; }
    $('toast').hidden = true;
    const av = available(s), L = layoutOf(s), T = L.targets;
    for (let n = 1; n <= 3; n++) {
      const b = pk.querySelector(`[data-n="${n}"]`); if (b instanceof HTMLButtonElement) b.disabled = n > av;
      $(`pk${n}`).textContent = S.trip.nos.length >= n ? `${S.trip.nos.slice(0, n).join('+')}號` : '';
    }
    pk.querySelector('h3')?.replaceChildren(av > 0 ? '今轉拎幾多張單？越多越重、越難控制，但有加成' : '等出餐…');
    // the picker goes where it covers none of this trip's tables (bottom, then top, then the middle), else where it
    // covers the fewest, so you can see where they are before choosing
    pk.hidden = false; pk.style.top = ''; pk.style.bottom = '';
    const H = $('board').clientHeight, ph = pk.offsetHeight, Sc = BS.S, cell = BL.cell * Sc;
    const ys = T.filter((_, i) => tableNo(s, i) !== null).flatMap(t => [t.hole.y, (t.tab.y0 + t.tab.y1) / 2].map(y => BL.oy * Sc + y * cell));
    const spots = [H - ph - 8, 8, Math.round(H / 2 - ph / 2)], cover = (top: number): number => ys.filter(y => y > top - cell * 0.8 && y < top + ph + cell * 0.8).length;
    const best = spots.reduce((b, sp) => cover(sp) < cover(b) ? sp : b, at(spots, 0));
    pk.style.top = `${best}px`; pk.style.bottom = 'auto';
  }
  function syncToast(): void {
    if (!S) return;
    const res = S.trip.result;
    if (S.st !== 'toast' || !res) { if (S.st !== 'toast') $('toast').hidden = true; return; }
    if (seenResult) return;
    seenResult = true;
    const o = S.trip, T = $('toast'), parts = [`上菜 +${res.base}`, `快 +${res.time}`, `體力 +${res.health}`];
    if (res.crash) parts.push(`撞暈 −${res.crash}`);
    const head = res.del === res.n ? `${o.orders.map(x => at(x.work, 0).table).join('+')}號 送晒` : res.why;
    T.innerHTML = `<h3>${head}</h3><div class="pts" style="color:${res.pts >= 90 * res.n ? '#1f8a4c' : res.pts >= 55 * res.n ? '#b5730f' : '#c8323c'}">+${res.pts}</div><div class="ln">${parts.join(' · ')}<br>${res.n} 張單 · ${res.t.toFixed(1)} 秒（標準 ${o.par.toFixed(1)}）</div>`;
    T.hidden = false;
  }
  function syncEnd(): void {
    if (ext || !S || S.st !== 'end' || seenEnd) return;
    seenEnd = true;
    const r = S.run, prev = store.get(`best_${S.dk}`), best = Math.max(typeof prev === 'number' ? prev : 0, r.points); store.set(`best_${S.dk}`, best);
    $('toast').hidden = true; $('pick').hidden = true;
    const carried = r.carried.length ? (r.carried.reduce((a, b) => a + b, 0) / r.carried.length).toFixed(1) : '0';
    // one instruction for the next shift, aimed at where the most points went missing
    const verdict = r.crashes ? '下一更：見到紅點就收細斜度，撞少啲就唔會撞暈'
      : r.failed ? '下一更：快啲出發，超時嘅單冇分；路遠就揀少啲單'
        : +carried < 2 ? '下一更：試下每轉拎 2–3 張單，分數有加成'
          : r.bumps > TUNE.orders ? '下一更：轉彎前早啲減速，少撞留返體力分'
            : '下一更：直路斜多啲行快啲，攞多啲快分';
    $('cardBody').innerHTML = `<h2>收工！</h2>
    <p class="stars">${'★'.repeat(r.stars)}<span>${'★'.repeat(3 - r.stars)}</span></p>
    <p class="quote">${verdict}</p>
    <p class="stat">總分 ${r.points} <span class="mute">（${TUNE.diff[S.dk].name}最高 ${best}）</span></p>
    <p class="mute">送到 ${r.done}/${TUNE.orders} 張單 · ${r.trip} 轉（平均每轉 ${carried} 張）· 撞 ${r.bumps} 次（撞客 ${r.guest}）· 撞暈 ${r.crashes} 次 · 用咗 ${r.time.toFixed(0)} 秒</p>
    <button class="big" id="bAgain">再嚟一更</button><button class="big alt" id="bHome">返去揀模式 / 難度</button>`;
    $('ovCard').hidden = false;
    $b('bAgain').onclick = () => { newRun(); if (G.mode === 'tilt') calibrate(); };
    $b('bHome').onclick = () => { $('ovCard').hidden = true; G.st = 'start'; S = null; $('pick').hidden = true; $('ovStart').hidden = false; };
  }

  /* ---------- input ---------- */
  const boardEl = $('board');
  const inside = (e: Event, sel: string): boolean => e.target instanceof Element && e.target.closest(sel) !== null;
  boardEl.addEventListener('pointerdown', e => {
    if (G.st === 'start' || G.paused || inside(e, '.ov') || inside(e, '#pick')) return;
    e.preventDefault(); IN.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 };
  });
  window.addEventListener('pointermove', e => {
    const d = IN.drag; if (!d || e.pointerId !== d.id) return;
    let x = (e.clientX - d.x0) / TUNE.dragR, y = (e.clientY - d.y0) / TUNE.dragR; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    d.x = x; d.y = y;
  });
  const lift = (e: PointerEvent): void => { if (IN.drag && e.pointerId === IN.drag.id) IN.drag = null; };
  window.addEventListener('pointerup', lift); window.addEventListener('pointercancel', lift);
  window.addEventListener('blur', () => { IN.drag = null; IN.keys = {}; });
  document.addEventListener('touchmove', e => { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', e => { e.preventDefault(); });
  document.addEventListener('contextmenu', e => { e.preventDefault(); });
  document.addEventListener('dblclick', e => { e.preventDefault(); });
  window.addEventListener('keydown', e => {
    IN.keys[e.code] = true; if (e.code.startsWith('Arrow')) e.preventDefault();
    if (S?.st === 'pick' && !G.paused && /^Digit[123]$/.test(e.code)) { const n = +e.code.slice(5); if (n <= available(S)) cmd({ t: 'pick', n }); }
  });
  window.addEventListener('keyup', e => { IN.keys[e.code] = false; });

  /* ---------- tilt reading: the player's tilt vector, |t| <= 1 after the core's clamp ---------- */
  function rawDown(b: number, g: number): { x: number; y: number } { b *= D2R; g *= D2R; return { x: Math.sin(g) * Math.cos(b), y: Math.sin(b) }; }  // x right, y toward the player
  function readTilt(dt: number): void {
    let tx = 0, ty = 0;
    if (G.mode === 'tilt' && IN.raw && IN.cal) {
      const d = rawDown(IN.raw.b, IN.raw.g), k = sens / Math.sin(TUNE.tiltMax * D2R);
      tx += (d.x - IN.cal.x) * k; ty += (d.y - IN.cal.y) * k;
    }
    const K = IN.keys, kx = ((K.ArrowRight || K.KeyD) ? 1 : 0) - ((K.ArrowLeft || K.KeyA) ? 1 : 0), ky = ((K.ArrowDown || K.KeyS) ? 1 : 0) - ((K.ArrowUp || K.KeyW) ? 1 : 0);
    const ka = 1 - Math.exp(-dt / TUNE.keyTau); IN.kx += (kx * TUNE.keyMax - IN.kx) * ka; IN.ky += (ky * TUNE.keyMax - IN.ky) * ka;
    tx += IN.kx; ty += IN.ky;
    if (IN.drag) { tx += IN.drag.x * sens; ty += IN.drag.y * sens; }
    cmd({ t: 'tilt', x: tx, y: ty });
  }

  /* ---------- drawing ---------- */
  const BS = makeScene('board', 150);
  let BL = { cell: 16, ox: 0, oy: 12 }, bgCache: { key: string; cv: HTMLCanvasElement | null } = { key: '', cv: null };
  function boardLayout(sc: Scene): typeof BL {
    const GW = TUNE.grid.w, GH = TUNE.grid.h, top = 10;
    const cell = Math.max(8, Math.floor(Math.min((sc.LW - 4) / GW, (sc.LH - top - 3) / GH)));
    return { cell, ox: Math.floor((sc.LW - cell * GW) / 2), oy: top + Math.floor((sc.LH - top - 3 - cell * GH) / 2) };
  }
  function drawWall(w: Wall, X: (x: number) => number, Y: (y: number) => number, cell: number, R: () => number): void {
    const x = Math.round(X(w.x0)), y = Math.round(Y(w.y0)), ww = Math.max(2, Math.round((w.x1 - w.x0) * cell)), hh = Math.max(2, Math.round((w.y1 - w.y0) * cell));
    const hor = w.hor, len = hor ? ww : hh, th = hor ? hh : ww;
    const rect = (a: number, b: number, l: number, t2: number, c: string): void => { if (hor) P(x + a, y + b, l, t2, c); else P(x + b, y + a, t2, l, c); };   // a along, b across
    P(x + 1, y + 2, ww, hh, 'rgba(0,0,0,.18)');
    P(x, y, ww, hh, INK);
    if (w.kind === 'booth') {
      // red bench | cream table | red bench, with people sitting on the benches
      const bw = Math.max(1, Math.floor((th - 2) * 0.3));
      rect(1, 1, len - 2, th - 2, '#f3e5b2'); rect(1, 1 + bw, len - 2, 1, '#fff6d0');
      rect(1, 1, len - 2, bw, '#b8352c'); rect(1, th - 1 - bw, len - 2, bw, '#b8352c');
      for (let a = 3; a < len - 4; a += 6) for (const side of [1, th - 1 - bw]) if (R() < 0.4) { rect(a, side, 3, bw, at(SHIRTS, Math.floor(R() * SHIRTS.length))); rect(a + 1, side + (side === 1 ? 0 : bw - 1), 1, 1, '#2b2b2b'); }
      for (let a = 5; a < len - 3; a += 7) if (R() < 0.6) rect(a, Math.round(th / 2) - 1, 2, 2, '#ffffff');
    } else if (w.kind === 'tables') {
      rect(1, 1, len - 2, th - 2, '#f3e5b2'); rect(1, 1, len - 2, 1, '#fff6d0'); rect(1, th - 2, len - 2, 1, '#cdb877');
      for (let a = cell; a < len - 2; a += cell) rect(a, 1, 1, th - 2, '#b7c1c8');
      for (let a = 4; a < len - 3; a += 6) if (R() < 0.5) rect(a, Math.round(th / 2) - 1, 2, 2, '#ffffff');
    } else if (w.kind === 'counter') {
      rect(1, 1, len - 2, th - 2, '#8a5a2b'); rect(1, 1, len - 2, Math.max(1, Math.round(th * 0.4)), '#c08a4a'); rect(1, 1, len - 2, 1, '#e0b070');
      for (let a = 5; a < len - 3; a += 8) if (R() < 0.6) rect(a, 1, 2, 2, R() < 0.5 ? '#e6ecef' : '#ffd25a');
    } else {
      // a wooden partition with frosted glass panes
      rect(1, 1, len - 2, th - 2, '#cfe3ea');
      for (let a = 0; a < len; a += Math.max(4, Math.round(cell * 0.5))) rect(a, 1, 1, th - 2, '#8a5a2b');
    }
  }
  function renderBg(sc: Scene, L: Layout): HTMLCanvasElement {
    const key = [sc.LW, sc.LH, L.seed, L.dk, L.attempts].join(':');
    if (bgCache.key === key && bgCache.cv) return bgCache.cv;
    const cv = bgCache.cv ?? document.createElement('canvas'); cv.width = sc.LW; cv.height = sc.LH;
    const keep = PX; PX = ctx2d(cv); PX.imageSmoothingEnabled = false;
    const { cell, ox, oy } = BL, X = (x: number): number => ox + x * cell, Y = (y: number): number => oy + y * cell, GW = L.GW, GH = L.GH, R = rngFn(L.seed + 99);
    P(0, 0, sc.LW, sc.LH, '#235648');
    for (let y = 0; y < sc.LH; y += 4) P(0, y, sc.LW, 1, '#2a604f');
    // floor: the green-and-white mosaic of an old cha chaan teng; dining rooms get a warmer tile
    P(X(0) - 2, Y(0) - 2, GW * cell + 4, GH * cell + 4, INK);
    P(X(0), Y(0), GW * cell, GH * cell, '#c9d8cc');
    for (let ty = 0; ty < GH * cell; ty += 3) for (let tx = 0; tx < GW * cell; tx += 3) {
      const i = tx / 3, j = ty / 3, m = ((i + j) % 8 === 0 || ((i - j) % 8 + 8) % 8 === 0);
      P(X(0) + tx, Y(0) + ty, 2, 2, m ? '#94c6aa' : ((i * 7 + j * 3) % 13 === 0 ? '#e2ece2' : '#eef3ea'));
    }
    for (const rm of L.rooms) {
      const x0 = X(rm.i * L.cw), y0 = Y(rm.j * L.ch), w = rm.w * L.cw * cell, h = rm.h * L.ch * cell;
      for (let ty = 0; ty < h - 2; ty += 3) for (let tx = 0; tx < w - 2; tx += 3) P(x0 + tx + 1, y0 + ty + 1, 2, 2, ((tx + ty) / 3) % 2 ? '#f1e3c4' : '#e6d2a8');
    }
    // the pass at the top: a steel counter
    bx(X(0) - 2, Y(0) - 9, GW * cell + 4, 8, '#8d99a1', '#e6ecef', '#6f7b85');
    P(X(L.start.x) - 8, Y(0), 16, 2, '#ffd25a');
    // walking lanes: footprints
    for (const w of L.walkers) { for (let s = 0; s <= w.len + 1e-6; s += 0.33) { const q = s / w.len; P(X(w.a.x + (w.b.x - w.a.x) * q) - 1, Y(w.a.y + (w.b.y - w.a.y) * q) - 1, 2, 2, '#b89f74'); } }
    // puddles
    for (const p of L.puddles) {
      const Rp = rngFn(Math.floor(p.seed * 1e6));
      el(X(p.x), Y(p.y), p.r * cell, p.r * cell * 0.85, '#8fc9f0', '#5f9fd0');
      for (let k = 0; k < 3; k++) { const a = Rp() * 6.28, dd = p.r * 0.55; el(X(p.x + Math.cos(a) * dd), Y(p.y + Math.sin(a) * dd * 0.85), p.r * cell * 0.42, p.r * cell * 0.36, '#8fc9f0', null); }
    }
    // furniture walls, then the target tables, stools, seated customers
    for (const w of L.walls) drawWall(w, X, Y, cell, R);
    for (const tg of L.targets) { const t = tg.tab; bx(X(t.x0), Y(t.y0), (t.x1 - t.x0) * cell, (t.y1 - t.y0) * cell, '#f3e5b2', '#fff6d0', '#cdb877'); }
    for (const s of L.stools) {
      const x = Math.round(X(s.x)), y = Math.round(Y(s.y));
      P(x - 2, y - 3, 5, 7, INK); P(x - 3, y - 2, 7, 5, INK); P(x - 2, y - 2, 5, 5, '#c8323c'); P(x - 1, y - 2, 2, 1, '#f08a8a');
      if (s.sit) person(x, y, cell * 0.22, s.col, 0, s.fx, s.fy);
    }
    PX = keep; bgCache = { key, cv };
    return cv;
  }
  // a person seen from above: a round body in a coloured shirt, dark hair, a sliver of face on the side they face
  function person(x: number, y: number, R: number, col: string, ph: number, fxd = 0, fyd = 1): void {
    R = Math.max(3, Math.round(R)); const hr = Math.max(2, Math.round(R * 0.45)), bob = ph ? (Math.sin(ph) > 0 ? 1 : 0) : 0;
    if (ph) { const st = Math.sin(ph) > 0 ? 1 : -1; P(x - fyd * R + fxd * st * 2 - 1, y + fxd * R + fyd * st * 2 - 1, 2, 2, '#f0c8a0'); P(x + fyd * R - fxd * st * 2 - 1, y - fxd * R - fyd * st * 2 - 1, 2, 2, '#f0c8a0'); }
    el(x, y + bob, R, R, col); P(x - R + 2, y - R + 2 + bob, 2, 1, 'rgba(255,255,255,.55)');
    blob(x, y + bob, hr, '#2b2b2b');
    P(x + Math.round(fxd * hr) - 1, y + bob + Math.round(fyd * hr), 2, 1, '#f0c8a0');
  }
  function W2L(x: number, y: number): { x: number; y: number } { return { x: BL.ox + x * BL.cell, y: BL.oy + y * BL.cell }; }
  function drawBoard(now: number): void {
    const sc = BS; beginScene(sc);
    BL = boardLayout(sc);
    const t = sc.t, Sc = sc.S, cell = BL.cell;
    if (!S) { P(0, 0, sc.LW, sc.LH, '#235648'); return; }
    const s = S, o = s.trip, L = layoutOf(s), d = TUNE.diff[s.dk];
    const shake = o.shake > 0 ? Math.round((fx() - 0.5) * 4 * o.shake / 0.25) : 0;
    PX.drawImage(renderBg(sc, L), shake, 0);
    const C = (x: number, y: number): { x: number; y: number } => { const q = W2L(x, y); return { x: q.x + shake, y: q.y }; }, CS = (x: number, y: number): { x: number; y: number } => { const q = C(x, y); return { x: q.x * Sc, y: q.y * Sc }; };
    for (const p of L.puddles) { const q = C(p.x, p.y), k = Math.floor(now / 400 + p.seed * 10) % 3; P(q.x - 3 + k, q.y - 2, 3, 1, '#ffffff'); P(q.x + 2 - k, q.y + 2, 2, 1, '#e6f6ff'); }
    // the tables to serve: blinking frame + the pocket; at the pass every candidate with an order shows
    const live: { ti: number; done: boolean; no: number }[] = s.st === 'pick'
      ? L.targets.flatMap((_, ti) => { const no = tableNo(s, ti); return no === null ? [] : [{ ti, done: false, no }]; })
      : o.orders.map((x: Order) => ({ ti: x.ti, done: x.done, no: at(x.work, 0).table }));
    const on = Math.floor(now / 350) % 2;
    for (const x of live) {
      const tg = at(L.targets, x.ti), tb = tg.tab, h = C(tg.hole.x, tg.hole.y), hr = tg.hole.r * cell;
      if (!x.done) {
        if (on) { const a = C(tb.x0, tb.y0), w = (tb.x1 - tb.x0) * cell, hh = (tb.y1 - tb.y0) * cell; P(a.x - 2, a.y - 2, w + 4, 2, '#ffd25a'); P(a.x - 2, a.y + hh, w + 4, 2, '#ffd25a'); P(a.x - 2, a.y, 2, hh, '#ffd25a'); P(a.x + w, a.y, 2, hh, '#ffd25a'); }
        el(h.x, h.y, hr + 1, hr + 1, '#ffd25a', INK); el(h.x, h.y, hr - 1, hr - 1, '#5a6b62', null);
        el(h.x, h.y + 1, hr * 0.8, hr * 0.8, '#3a4a43', null); el(h.x, h.y + 1, hr * TUNE.sinkK - 1, hr * TUNE.sinkK - 1, '#1d2925', null);
      } else { el(h.x, h.y, hr * 0.7, hr * 0.7, '#7be08f', INK); P(h.x - 2, h.y, 2, 2, INK); P(h.x, h.y + 1, 2, 2, INK); P(h.x + 2, h.y - 1, 2, 2, INK); P(h.x + 3, h.y - 2, 2, 2, INK); }
    }
    o.walkers.forEach((w, i) => {
      const def = at(L.walkers, i), q = C(w.x, w.y), sp = Math.hypot(w.vx, w.vy), dir = sp > 0.05 ? { x: w.vx / sp, y: w.vy / sp } : { x: 0, y: 1 }, R = TUNE.rw * cell;
      el(q.x + 1, q.y + 2, R + 1, R + 1, 'rgba(0,0,0,.25)', null); el(q.x, q.y, R + 1, R + 1, '#ffffff', null); person(q.x, q.y, R, def.col, sp > 0.05 ? w.ph : 0, dir.x, dir.y);
    });
    // ---- crisp overlay (css px) ----
    const b = o.ball, br = TUNE.r * cell, bsp = Math.hypot(b.vx, b.vy), vHard = hardV(s);
    // the speed cue: the trail. Dots are dropped at a fixed rate, so their spacing is the speed; green = slow enough to
    // sink, red = fast enough that a hit will hurt (the waiter's rim turns red too)
    const spCol = (c: number): string => c < d.capV ? '31,157,85' : c >= vHard ? '232,64,47' : '35,86,72';
    t.save();
    if (s.st === 'play') o.trail.forEach((p, i) => { if (Math.hypot(p.x - b.x, p.y - b.y) < TUNE.r * 1.1) return; const q = CS(p.x, p.y), a = (i + 1) / o.trail.length; t.fillStyle = `rgba(${spCol(p.v)},${(0.15 + a * 0.55).toFixed(2)})`; t.beginPath(); t.arc(q.x, q.y, 2 + a * 3, 0, 6.283); t.fill(); });
    const tiltX = s.tilt.x, tiltY = s.tilt.y;
    // the waiter: white jacket, dark hair, one silver tray per order still carried
    {
      const k = s.st === 'toast' ? 0 : s.st === 'sink' ? Math.max(0.35, 1 - o.sinkT / 0.4 * 0.65) : 1, q = CS(b.x, b.y), R = br * Sc * k;
      const disc = (x: number, y: number, r: number, fill: string, lw = 0, sc2 = INK): void => { t.beginPath(); t.arc(x, y, r, 0, 6.283); t.fillStyle = fill; t.fill(); if (lw) { t.lineWidth = lw; t.strokeStyle = sc2; t.stroke(); } };
      if (k > 0.05) {
        const spin = s.st === 'crash' ? now / 60 : 0;
        disc(q.x + 2, q.y + 4, R, 'rgba(0,0,0,.22)');
        disc(q.x, q.y, R, s.st === 'crash' ? '#ffd6d0' : '#fbfaf4', s.st === 'play' && bsp >= vHard ? 3.5 : 2.5, s.st === 'play' && bsp >= vHard ? '#e8402f' : INK);
        const tm = Math.hypot(tiltX, tiltY), ux = spin ? Math.cos(spin) : tm > 0.08 ? tiltX / tm : 0.7, uy = spin ? Math.sin(spin) : tm > 0.08 ? tiltY / tm : -0.7;
        disc(q.x - ux * R * 0.12, q.y - uy * R * 0.12, R * 0.48, '#2b2b2b');
        const nT = Math.max(1, carrying(o) || o.orders.length || 1);
        for (let i = 0; i < nT; i++) { const a = Math.atan2(uy, ux) + (i - (nT - 1) / 2) * 0.75; disc(q.x + Math.cos(a) * R * 0.8, q.y + Math.sin(a) * R * 0.8, R * 0.36, '#c9d1d6', 1.8); }
      }
    }
    // the health ring: full = fresh; it empties with every bump; empty = knocked out, back to the pass
    if (s.st === 'play' || s.st === 'ready' || s.st === 'crash') {
      const q = CS(b.x, b.y), R = (br + 3.5) * Sc, frac = Math.max(0, o.hp / TUNE.hp);
      const col = frac > 0.6 ? '#1f9d55' : frac > 0.3 ? '#e8a21a' : '#e8402f';
      t.lineWidth = 7; t.strokeStyle = 'rgba(15,26,22,.35)'; t.beginPath(); t.arc(q.x, q.y, R, 0, 6.283); t.stroke();
      if (frac > 0.005) {
        t.lineWidth = 7; t.strokeStyle = INK; t.beginPath(); t.arc(q.x, q.y, R, -Math.PI / 2, -Math.PI / 2 + frac * 6.283); t.stroke();
        t.lineWidth = 4.5; t.strokeStyle = col; t.beginPath(); t.arc(q.x, q.y, R, -Math.PI / 2, -Math.PI / 2 + frac * 6.283); t.stroke();
      }
      if (o.hitFlash > 0) { t.lineWidth = 3; t.strokeStyle = `rgba(232,64,47,${(o.hitFlash / 0.35).toFixed(2)})`; t.beginPath(); t.arc(q.x, q.y, R + 8 + (0.35 - o.hitFlash) * 40, 0, 6.283); t.stroke(); }
      const tm = Math.hypot(tiltX, tiltY);
      if (tm > 0.06 && s.st !== 'crash') {
        const Lx = tiltX / tm, Ly = tiltY / tm, len = R + 4 + tm * cell * Sc * 1.1, x0 = q.x + Lx * (R + 4), y0 = q.y + Ly * (R + 4), x1 = q.x + Lx * len, y1 = q.y + Ly * len;
        for (const [lw, cl] of [[5, INK], [2.5, '#fff6c8']] as const) {
          t.lineWidth = lw; t.strokeStyle = cl; t.lineCap = 'round'; t.beginPath(); t.moveTo(x0, y0); t.lineTo(x1, y1);
          t.moveTo(x1, y1); t.lineTo(x1 - Lx * 7 - Ly * 5, y1 - Ly * 7 + Lx * 5); t.moveTo(x1, y1); t.lineTo(x1 - Lx * 7 + Ly * 5, y1 - Ly * 7 - Lx * 5); t.stroke();
        }
      }
    }
    // labels
    for (const x of live) { if (x.done) continue; const tb = at(L.targets, x.ti).tab, q = CS((tb.x0 + tb.x1) / 2, (tb.y0 + tb.y1) / 2); chipC(t, q.x, q.y, `${x.no}號`, '#ffd25a', INK, 13); }
    const sq = CS(L.start.x, 0); outlineC(t, sq.x, sq.y - 5 * Sc, '出餐口', '#e6f1ec', 11);
    o.walkers.forEach((w, i) => {
      const def = at(L.walkers, i), q = CS(w.x, w.y), lx = (def.b.x - def.a.x) / def.len * w.dir, ly = (def.b.y - def.a.y) / def.len * w.dir, d0 = (TUNE.rw * cell + 3) * Sc, px = q.x + lx * d0, py = q.y + ly * d0;
      t.fillStyle = '#ffffff'; t.strokeStyle = INK; t.lineWidth = 1.5; t.beginPath(); t.moveTo(px + lx * 7, py + ly * 7); t.lineTo(px - ly * 5, py + lx * 5); t.lineTo(px + ly * 5, py - lx * 5); t.closePath(); t.fill(); t.stroke();
    });
    for (const f of o.fx) { const q = CS(f.x, f.y); t.font = `900 ${f.size}px ${FONT}`; const hw = t.measureText(f.text).width / 2 + 4; outlineC(t, clamp(q.x, hw, sc.LW * Sc - hw), Math.max(q.y - f.t * 22, BL.oy * Sc + 12), f.text, f.col, f.size); }
    if (s.st === 'ready' && !o.restart) {
      const q = CS(L.GW / 2, L.GH * 0.3); chipC(t, q.x, q.y, `送去 ${o.orders.map(x => at(x.work, 0).table).join('、')}號枱`, '#ffd25a', INK, 15);
      // the control actually in use
      chipC(t, q.x, q.y + 26, G.mode === 'tilt' ? '斜部電話就行' : '手指撳住拖就行', '#ffffff', INK, 13);
    }
    if (G.calT > 0) { const q = CS(L.GW / 2, L.GH * 0.5); chipC(t, q.x, q.y, '拎穩…當呢個角度係平', '#ffffff', INK, 16); }
    if (IN.drag) {
      const r0 = sc.wrap.getBoundingClientRect(), cx = IN.drag.x0 - r0.left, cy = IN.drag.y0 - r0.top;
      t.lineWidth = 2; t.strokeStyle = 'rgba(15,26,22,.6)'; t.beginPath(); t.arc(cx, cy, TUNE.dragR, 0, 6.283); t.stroke();
      t.fillStyle = 'rgba(255,246,200,.85)'; t.beginPath(); t.arc(cx + IN.drag.x * TUNE.dragR, cy + IN.drag.y * TUNE.dragR, 14, 0, 6.283); t.fill(); t.stroke();
    }
    t.restore();
  }

  /* ---------- HUD, debug, orientation ---------- */
  function hud(): void {
    let txt = '';
    if (S && G.st !== 'start') txt = `送咗 ${S.run.done}/${TUNE.orders} 張 · ${S.trip.t.toFixed(1)}s · ${S.run.points}分`;
    $('hud').classList.toggle('live', S !== null && G.st !== 'start');
    $('hs').textContent = txt;
    if (debug && S) {
      const b = S.trip.ball, d = TUNE.diff[S.dk], L = layoutOf(S);
      $('dbg').textContent = [
        `mode ${G.mode ?? '-'}  ev ${IN.evRate.toFixed(0)}/s  ${IN.raw ? `b ${IN.raw.b.toFixed(1)} g ${IN.raw.g.toFixed(1)}` : 'no sensor'}`,
        `tilt ${S.tilt.x.toFixed(2)} ${S.tilt.y.toFixed(2)}  v ${Math.hypot(b.vx, b.vy).toFixed(2)} max ${S.trip.maxV.toFixed(2)}${S.trip.wet ? ' WET' : ''}  mass ${at(TUNE.mass, Math.max(0, carrying(S.trip) - 1))}`,
        `cap ${d.capV} hard ${hardV(S).toFixed(2)} tap ${TUNE.tapV}  hp ${S.trip.hp}`,
        `seed ${L.seed} try ${L.attempts} par ${S.trip.par.toFixed(1)}  wind ${L.targets.map(t => t.wind.toFixed(2)).join(' ')}`,
        `bumps ${S.trip.bumps} guest ${S.trip.guest} ko ${S.trip.crashes}  left ${remaining(S)}`,
      ].join('\n');
    }
  }
  const coarse = matchMedia('(pointer:coarse)');
  function checkRot(): boolean { const land = phoneLandscape() && (coarse.matches || G.mode === 'tilt'); $('rot').hidden = !land; return land; }

  function playCues(): void {
    if (!S) return;
    for (const c of S.cues) if (c.id > lastCue) { lastCue = c.id; sound.play(c.k); }
  }
  /* ---------- main loop: the core steps on frame time (it keeps the prototype's fixed 240 Hz steps inside) ---------- */
  let last = performance.now(), evT = performance.now(), evN0 = 0;
  const liveSt = (): boolean => S !== null && G.st === 'live' && S.st !== 'end';
  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (now - evT > 1000) { IN.evRate = (IN.evN - evN0) * 1000 / (now - evT); evN0 = IN.evN; evT = now; }
    const land = checkRot();
    if (ext) S = ext.live();
    if (!G.paused && !land && !document.hidden && liveSt() && S) {
      readTilt(dt);
      if (G.calT > 0) {
        // calibration: the shift holds still while the phone's resting angle is read (the prototype's G.calT)
        G.calT -= dt;
        if (IN.raw) IN.calBuf.push(rawDown(IN.raw.b, IN.raw.g));
        if (G.calT <= 0 && IN.calBuf.length) { const n = IN.calBuf.length; IN.cal = { x: IN.calBuf.reduce((a, p) => a + p.x, 0) / n, y: IN.calBuf.reduce((a, p) => a + p.y, 0) / n }; cmd({ t: 'tilt', x: 0, y: 0, snap: true }); }
      } else if (!ext) runner.step(S, dt, ctx());
    }
    drawBoard(now); syncPick(); syncToast(); syncEnd(); hud(); playCues();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // as a seat: straight in, no menu, the same control as everywhere (see onOrient): the finger until a motion reading
  // arrives, then tilt. The game page asked for motion before the level started; nothing asks here.
  if (ext) { $b('bMenu').hidden = true; wakeLock(); begin('thumb'); }
  return {
    get state() { return S; }, get mode() { return G.mode; }, get paused() { return G.paused; },
    begin, ctx,
    bot: () => S ? runnerBot(S, ctx()) : null,
    screenOf(x, y) { const r = BS.tv.getBoundingClientRect(), q = W2L(x, y); return { x: r.left + q.x * BS.S, y: r.top + q.y * BS.S }; },
  };
}
