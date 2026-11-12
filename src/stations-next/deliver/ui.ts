// 送外賣 deliver screen: the road seen from above, scrolling toward the rider, drawn in code on the two-layer scene of
// lab-kit.ts (a chunky pixel layer and a crisp text layer). Input: a tap on the left / right half of the road (or a
// swipe) changes lane, the big 加速 button steps a gear up; arrows and space on a computer. The ride lives in core.ts;
// this file sends commands, steps the core on frame time (standalone) or draws the state the game page hands it
// (?seat), and plays the core's cues through the injected sound interface. Math.random here is looks only.
import { seededRng, type Difficulty, type StationCtx } from '../contract';
import type { Recipes, StationSound } from '../sound';
import { INK, beginScene, hash, makeScene, pixels, shake, texts } from '../lab-kit';
import { phoneLandscape } from '../orient';
import { CRASH_T, TOP, TUNE, bagBonus, deliver, init, tierOf, type Car, type DeliverCmd, type DeliverState } from './core';
import { makeDeliverBot, type DeliverBotOpts } from './bot';

const $ = (id: string): HTMLElement => { const e = document.getElementById(id); if (!e) throw new Error(`#${id} missing`); return e; };
function $b(id: string): HTMLButtonElement { const e = $(id); if (!(e instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`); return e; }
const store = {
  get(k: string): unknown { try { const v = localStorage.getItem('st_deliver_' + k); return v === null ? undefined : JSON.parse(v); } catch { return undefined; } },
  set(k: string, v: unknown): void { try { localStorage.setItem('st_deliver_' + k, JSON.stringify(v)); } catch { /* private mode: no memory */ } },
};
const isDiff = (v: unknown): v is Difficulty => v === 'rookie' || v === 'pro' || v === 'ace';
const FONT = '"PingFang HK","Noto Sans HK","Microsoft JhengHei",sans-serif';
const DIFF_NAME: Record<Difficulty, string> = { rookie: '新人', pro: '熟手', ace: '阿姐' };

/** Sound recipes for the core's cues (off until the 聲 button). */
export const DELIVER_SOUNDS: Recipes = {
  go(s) { s.tone(520, 0.08, 'square', 0.04); s.tone(780, 0.12, 'square', 0.04, 0, 0.09); },
  gear(s, n) { s.tone(220 + n * 90, 0.09, 'square', 0.05, 330 + n * 120); },
  rocket(s) { s.noise(0.5, 0.09, 900); s.tone(180, 0.5, 'sawtooth', 0.04, 620); },
  lane(s) { s.tone(1200, 0.03, 'sine', 0.025); },
  crash(s) { s.noise(0.4, 0.14, 1800); s.tone(240, 0.45, 'square', 0.05, 60); },
  up(s) { s.tone(660, 0.07, 'triangle', 0.04); },
  drop(s) { s.tone(1320, 0.09, 'sine', 0.05); s.tone(1760, 0.14, 'sine', 0.05, 0, 0.1); },
  cold(s) { s.tone(400, 0.2, 'triangle', 0.05, 260); },
  back(s) { [660, 880, 990, 1320].forEach((f, i) => { s.tone(f, 0.12, 'square', 0.035, 0, i * 0.08); }); },
};

export interface DeliverScreen {
  readonly state: DeliverState | null; readonly paused: boolean;
  /** Starts a run of n made-up orders (standalone). */
  begin(n: number): void;
  ctx(): StationCtx;
  /** A command through the page's own path (the seat link when there is one). */
  cmd(c: DeliverCmd): void;
  /** What a computer rider with these settings would do now. */
  bot(o?: Partial<DeliverBotOpts>): DeliverCmd | null;
  /** Metres of road the scene shows ahead of the rider's centre as last drawn (>= TUNE.reach.view). */
  sight(): number;
}
/** The game page's seat: the state to draw and where the commands go; the ride is stepped there, not here. */
export interface DeliverExt { live(): DeliverState | null; send(c: DeliverCmd): void; mine(): boolean }

interface Fx { text: string; col: string; t: number; life: number; size: number; dy: number }

export function mountDeliver(sound: StationSound, ext?: DeliverExt): DeliverScreen {
  const dv = store.get('diff'); let diff: Difficulty = isDiff(dv) ? dv : 'pro';
  const nv = store.get('n'); let nOrders = typeof nv === 'number' && nv >= 1 && nv <= 3 ? nv : 1;
  // steered: the rider has changed lane once on this page, so the 撳左邊／撳右邊 hint on the road is not shown again
  const G = { paused: false, started: false, steered: false };
  let S: DeliverState | null = null;
  const rng = seededRng((Math.random() * 2 ** 32) >>> 0);
  const ctx = (): StationCtx => ({ t: S ? S.clock : 0, rng, seat: 'solo', byPlayer: true, shared: { t: S ? S.clock : 0, paused: G.paused } });
  let lastCue = 0, seenRuns = -1, seenHome = -1, ordKey = '';
  const fxs: Fx[] = [];
  const bots = new Map<string, ReturnType<typeof makeDeliverBot>>();

  /* ---------- menu ---------- */
  function segInit(id: string, cur: string, on: (v: string) => void): void {
    const seg = $(id); const paint = (v: string): void => { seg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.v === v); }); };
    paint(cur); seg.addEventListener('click', e => { const b = e.target instanceof Element ? e.target.closest('button') : null; if (!b?.dataset.v) return; on(b.dataset.v); paint(b.dataset.v); });
  }
  segInit('segDiff', diff, v => { if (isDiff(v)) { diff = v; store.set('diff', v); } });
  segInit('segN', String(nOrders), v => { nOrders = Number(v); store.set('n', nOrders); });
  $b('bSnd').onclick = () => { const on = sound.toggle(); $b('bSnd').textContent = on ? '聲 開' : '聲 關'; $b('bSnd').classList.toggle('on', on); if (on) sound.play('drop'); };
  $b('bMenu').onclick = () => { G.paused = true; $b('bStart').textContent = live() ? '繼續' : '出發！'; $('ovStart').hidden = false; };
  $b('bStart').onclick = () => {
    if (G.paused && live()) { G.paused = false; $('ovStart').hidden = true; return; }
    begin(nOrders);
  };
  const live = (): boolean => S !== null && (S.st === 'ride' || S.st === 'crash');

  function begin(n: number): void {
    G.paused = false; G.started = true; $('ovStart').hidden = true; $('ovCard').hidden = true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (ext) return;
    const tier = TUNE.diffTier[diff];
    if (!S || tierOf(S).tier !== tier) S = init({ difficulty: diff, seed: (Math.random() * 1e9) >>> 0, players: 1, tier });
    deliver.command(S, { t: 'start', n }, ctx());
    wakeLock();
  }
  function cmd(c: DeliverCmd): void { if (c.t === 'lane') G.steered = true; if (ext) { if (ext.mine()) ext.send(c); } else if (S && !G.paused) deliver.command(S, c, ctx()); }
  let wl: WakeLockSentinel | null = null;
  function wakeLock(): void {
    try { if ('wakeLock' in navigator && !wl) navigator.wakeLock.request('screen').then(w => { wl = w; w.addEventListener('release', () => { wl = null; }); }).catch(() => undefined); } catch { /* not offered */ }
  }

  /* ---------- input: tap a half of the road or swipe to change lane, 加速 for a gear ---------- */
  const road = $('road');
  let down: { id: number; x: number; y: number; t: number; done: boolean } | null = null;
  road.addEventListener('pointerdown', e => {
    if (G.paused) return;
    e.preventDefault(); down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), done: false };
  });
  window.addEventListener('pointermove', e => {
    const d = down; if (!d || e.pointerId !== d.id || d.done) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(e.clientY - d.y)) { d.done = true; cmd({ t: 'lane', d: dx > 0 ? 1 : -1 }); }
  });
  window.addEventListener('pointerup', e => {
    const d = down; if (!d || e.pointerId !== d.id) return;
    down = null;
    if (d.done || performance.now() - d.t > 600) return;
    const r = road.getBoundingClientRect();
    cmd({ t: 'lane', d: d.x < r.left + r.width / 2 ? -1 : 1 });
  });
  window.addEventListener('pointercancel', () => { down = null; });
  const go = $b('bGo');
  go.addEventListener('pointerdown', e => { e.preventDefault(); cmd({ t: 'gear' }); go.classList.add('press'); });
  const unpress = (): void => { go.classList.remove('press'); };
  go.addEventListener('pointerup', unpress); go.addEventListener('pointerleave', unpress); go.addEventListener('pointercancel', unpress);
  window.addEventListener('keydown', e => {
    if (G.paused || e.repeat) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); cmd({ t: 'lane', d: -1 }); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); cmd({ t: 'lane', d: 1 }); }
    else if (e.code === 'ArrowUp' || e.code === 'Space' || e.code === 'KeyW') { e.preventDefault(); cmd({ t: 'gear' }); }
  });
  document.addEventListener('touchmove', e => { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', e => { e.preventDefault(); });
  document.addEventListener('contextmenu', e => { e.preventDefault(); });
  document.addEventListener('dblclick', e => { e.preventDefault(); });

  /* ---------- drawing ---------- */
  const sc = makeScene(road);
  const { P, bx, el, pline } = pixels(sc, true);
  const { chipT, outlineT } = texts(sc, FONT);
  const PPM = 5;   // logical px per metre along the road
  // the road's design height (lab-kit beginScene) and where the rider sits. The scene is DESIGN_H rows tall
  // (or more, on a wide short screen) so the rider, at RIDER_AT of it, always sees TUNE.reach.view + 1 m ahead (44 m):
  // the safe-lane guard's sight holds on every screen, the game's floor job too (its scene is ~390 css px tall at
  // 390x666: the pixel scale drops to ~1.5 there, a little zoomed out, instead of showing less road). MIN_S: below
  // it a scene that short shows less road (the page test checks the phones).
  const RIDER_AT = 0.84, DESIGN_H = Math.ceil((TUNE.reach.view + 1) * PPM / RIDER_AT), MIN_S = 1.25;
  interface Geo { laneW: number; rx0: number; roadW: number; riderY: number; pave: number }
  function geo(): Geo {
    const laneW = Math.max(22, Math.min(30, Math.floor((sc.LW - 50) / 3))), roadW = laneW * 3, rx0 = Math.floor((sc.LW - roadW) / 2);
    return { laneW, rx0, roadW, riderY: Math.round(sc.LH * RIDER_AT), pave: 10 };
  }
  const ROOFS = ['#8f9a9c', '#a59a86', '#7f8c8a', '#b0a58f', '#9a8f9c', '#8a968a'];
  const AWN = ['#c8323c', '#2f9a57', '#3b7fd0', '#e8a21a', '#8a4fc0', '#d2603a'];
  const NEON = ['#ff4f6a', '#4fe0ff', '#ffe04f', '#7bff6a', '#ff8af0'];
  function pick(a: readonly string[], r: number): string { return a[Math.floor(r * a.length) % a.length] ?? INK; }
  function scenery(g: Geo, s: DeliverState, pos: number): void {
    const { rx0, roadW, riderY, pave } = g, LW = sc.LW, LH = sc.LH, Y = (y: number): number => riderY - (y - pos) * PPM;
    const y0 = pos - (LH - riderY) / PPM - 2, y1 = pos + riderY / PPM + 2;
    // asphalt with grit that moves with the road
    P(0, 0, LW, LH, '#b9b4a6');
    P(rx0, 0, roadW, LH, '#4b5154');
    for (let m = Math.floor(y0); m <= y1; m++) for (let k = 0; k < 3; k++) { const r = hash(m, k, 7); P(rx0 + Math.floor(r * roadW), Math.round(Y(m)) + k * 2, 1, 1, r > 0.5 ? '#5a6164' : '#41474a'); }
    // lane dashes and the double yellow lines at the kerbs
    for (let m = Math.floor(y0 / 7) * 7; m <= y1; m += 7) for (const L of [1, 2]) P(rx0 + L * g.laneW - 1, Math.round(Y(m + 3)), 2, 3 * PPM, '#e9e6da');
    for (const xx of [rx0 + 2, rx0 + 5, rx0 + roadW - 3, rx0 + roadW - 6]) P(xx, 0, 1, LH, '#f0c419');
    // kerbs and the pavement tiles
    for (const [a, b] of [[rx0 - pave, rx0], [rx0 + roadW, rx0 + roadW + pave]] as const) {
      P(a, 0, b - a, LH, '#c9c4b5');
      for (let m = Math.floor(y0 / 2) * 2; m <= y1; m += 2) P(a, Math.round(Y(m)), b - a, 1, '#b3ad9c');
    }
    P(rx0 - 2, 0, 2, LH, '#e6e2d6'); P(rx0 + roadW, 0, 2, LH, '#e6e2d6');
    // buildings: flat roofs with water tanks and AC boxes, shop awnings on the pavement, neon signs over it
    const BL = 12;
    for (let b = Math.floor(y0 / BL) - 1; b <= Math.floor(y1 / BL) + 1; b++) {
      for (const side of [-1, 1] as const) {
        const x0 = side < 0 ? 0 : rx0 + roadW + pave, x1 = side < 0 ? rx0 - pave : LW, w = x1 - x0;
        if (w < 4) continue;
        const r = (k: number): number => hash(b, side + 5, k), top = Math.round(Y((b + 1) * BL)), h = BL * PPM - 2;
        bx(x0 - 1, top, w + 2, h, pick(ROOFS, r(1)), '#c7cfcf');
        if (r(2) < 0.7) el(x0 + w * (0.3 + r(3) * 0.4), top + h * (0.3 + r(4) * 0.3), 4, 4, '#d9dfe2');
        for (let k = 0; k < 3; k++) if (r(5 + k) < 0.5) bx(x0 + 3 + Math.floor(r(9 + k) * Math.max(1, w - 12)), top + 6 + k * 18, 7, 6, '#e8ece9');
        const ax = side < 0 ? x1 : x0 - 4;
        for (let k = 0; k < h; k += 4) P(ax, top + k, 4, 2, k % 8 ? '#f4efd9' : pick(AWN, r(13)));
        if (r(14) < 0.55) { const nx = side < 0 ? x1 + 2 : x0 - 9, ny = top + 8 + Math.floor(r(15) * (h - 26)); bx(nx, ny, 7, 16, '#1d2925'); P(nx + 2, ny + 2, 3, 12, pick(NEON, r(16))); }
      }
    }
    // our cha chaan teng at both ends of the road (the road loops back), the drop buildings on the right
    const run = s.run;
    const shopAt = (y: number): void => {
      const top = Math.round(Y(y + 7)), w = rx0 - pave;
      bx(-1, top, w + 1, 14 * PPM, '#2f6b5a', '#5f9a86');
      for (let k = 0; k < 14 * PPM; k += 4) P(w, top + k, 4, 2, k % 8 ? '#f4efd9' : '#c8323c');
      P(rx0 - pave, Math.round(Y(y)) - 1, pave, 2, '#ffd25a');
    };
    shopAt(0); if (run) shopAt(run.len);
    if (run) for (const o of run.orders) {
      const top = Math.round(Y(o.y + 5)), x0 = rx0 + roadW + pave, w = LW - x0;
      bx(x0 - 1, top, w + 2, 10 * PPM, o.done ? '#c9dccc' : '#fff1c2', '#ffffff');
      for (let k = 0; k < 10 * PPM; k += 4) P(x0 - 4, top + k, 4, 2, k % 8 ? '#f4efd9' : '#e8a21a');
      if (!o.done && Math.floor(performance.now() / 300) % 2) { P(rx0 + roadW, top, 2, 10 * PPM, '#ffd25a'); P(x0 - 6, top - 2, w + 6, 2, '#ffd25a'); P(x0 - 6, top + 10 * PPM, w + 6, 2, '#ffd25a'); }
      // the customer waiting at the door
      if (!o.done) { el(x0 - 7, Math.round(Y(o.y)), 3, 3, '#3b7fd0'); el(x0 - 7, Math.round(Y(o.y)) - 1, 2, 2, '#2b2b2b'); }
    }
  }
  const TAXI = ['#d23a2e', '#d23a2e', '#3fa34d', '#3b7fd0'];
  function vehicle(g: Geo, c: Car, pos: number, now: number): void {
    const cx = g.rx0 + g.laneW * (c.x + 0.5), cy = g.riderY - (c.y - pos) * PPM, h = Math.round(c.len * PPM);
    const w = c.k === 'bus' ? Math.min(g.laneW - 6, 22) : c.k === 'minibus' ? Math.min(g.laneW - 9, 17) : Math.min(g.laneW - 11, 15);
    const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
    if (y0 > sc.LH + 4 || y0 + h < -4) return;
    P(x0 + 2, y0 + 3, w, h, 'rgba(0,0,0,.28)');
    if (c.k === 'taxi') {
      const body = TAXI[c.col % TAXI.length] ?? '#d23a2e';
      bx(x0, y0, w, h, body, '#ff8a7a');
      P(x0 + 2, y0 + 4, w - 4, 4, '#1d2925'); P(x0 + 2, y0 + h - 6, w - 4, 3, '#1d2925');
      P(x0 + 2, y0 + 8, w - 4, h - 14, c.col === 2 ? '#6fc27a' : c.col === 3 ? '#7fb0e8' : '#e86a5a');
      P(x0 + Math.round(w / 2) - 2, y0 + 10, 4, 2, '#ffffff');
    } else if (c.k === 'minibus') {
      bx(x0, y0, w, h, '#f1ead2', '#ffffff');
      P(x0 + 1, y0 + 6, w - 2, h - 9, c.col % 2 ? '#d23a2e' : '#2f9a57');
      P(x0 + 2, y0 + 2, w - 4, 4, '#1d2925');
      for (let k = y0 + 9; k < y0 + h - 5; k += 5) { P(x0 + 3, k, 2, 2, '#f1ead2'); P(x0 + w - 5, k, 2, 2, '#f1ead2'); }
    } else {
      const yellow = c.col % 2 === 1;
      bx(x0, y0, w, h, yellow ? '#f5c400' : '#ece6cf', '#ffffff');
      if (!yellow) { P(x0 + 1, y0 + 1, 2, h - 2, '#c8323c'); P(x0 + w - 3, y0 + 1, 2, h - 2, '#c8323c'); }
      P(x0 + 3, y0 + 2, w - 6, 3, '#1d2925');
      for (let k = y0 + 9; k < y0 + h - 10; k += 12) bx(x0 + 5, k, w - 10, 6, '#c9d1d6');
      bx(x0 + 4, y0 + h - 8, w - 8, 5, '#8d99a1');
    }
    P(x0 + 1, y0 + h - 2, 3, 2, '#ff3b30'); P(x0 + w - 4, y0 + h - 2, 3, 2, '#ff3b30');
    P(x0 + 1, y0, 3, 1, '#fff6c8'); P(x0 + w - 4, y0, 3, 1, '#fff6c8');
    if (c.to !== c.lane && Math.floor(now / 160) % 2) {
      const sx = c.to > c.lane ? x0 + w - 1 : x0 - 2;
      P(sx, y0 + 1, 3, 4, '#ffb21a'); P(sx, y0 + h - 5, 3, 4, '#ffb21a');
    }
  }
  /** The bike from above, turned by `a` (0 = riding up the screen), with the takeaway bag on its rack. */
  function bike(cx: number, cy: number, a: number): void {
    const fx = Math.sin(a), fy = -Math.cos(a), at = (k: number): [number, number] => [cx + fx * k, cy + fy * k];
    const [w0x, w0y] = at(6), [w1x, w1y] = at(14), [r0x, r0y] = at(-5), [r1x, r1y] = at(-14), [f0x, f0y] = at(-6), [f1x, f1y] = at(8);
    pline(w0x, w0y, w1x, w1y, INK, 4); pline(r0x, r0y, r1x, r1y, INK, 4);
    pline(f0x, f0y, f1x, f1y, '#c8323c', 3);
    const [hx, hy] = at(9); pline(hx - fy * 8, hy + fx * 8, hx + fy * 8, hy - fx * 8, '#333a3d', 2);
    P(hx - fy * 8 - 1, hy + fx * 8 - 1, 3, 3, INK); P(hx + fy * 8 - 1, hy - fx * 8 - 1, 3, 3, INK);
    const [bgx, bgy] = at(-10); bx(bgx - 7, bgy - 7, 14, 12, '#e8402f', '#ff8a6a', '#b52a20'); P(bgx - 5, bgy - 2, 10, 3, '#ffd25a'); P(bgx - 1, bgy - 6, 2, 3, '#ffffff');
  }
  function riderBody(cx: number, cy: number, lying: number): void {
    if (lying) { el(cx, cy, 9, 4, '#2f7fd0'); el(cx + lying * 9, cy, 4, 4, '#ffd25a'); P(cx - lying * 11, cy, 3, 3, '#f0c8a0'); return; }
    el(cx, cy, 8, 4, '#2f7fd0'); P(cx - 9, cy - 6, 3, 5, '#f0c8a0'); P(cx + 7, cy - 6, 3, 5, '#f0c8a0');
    el(cx, cy - 1, 4, 4, '#ffd25a'); P(cx - 2, cy - 4, 3, 2, '#fff6c8'); P(cx - 4, cy + 1, 9, 1, '#c99a12');
  }
  function rider(g: Geo, s: DeliverState, now: number): void {
    const cx = Math.round(g.rx0 + g.laneW * (s.x + 0.5)), cy = g.riderY;
    if (s.st === 'crash') {
      const c = TUNE.crash, t = s.crashT, side = s.side, q = Math.PI / 2;
      el(cx, cy + 2, 14, 7, 'rgba(0,0,0,.25)', null);
      if (t < c.fall + c.lie) {
        const k = Math.min(1, t / c.fall), e = 1 - (1 - k) * (1 - k);
        bike(cx + side * 3 * e, cy - 4 * e, side * q * e);
        riderBody(cx + side * 18 * e, cy - 9 * e, side);
        if (t >= c.fall) for (let i = 0; i < 3; i++) { const an = now / 150 + i * 2.1; P(cx + side * 27 + Math.cos(an) * 6, cy - 13 + Math.sin(an) * 3, 3, 3, '#ffe04f'); }
      } else if (t < c.fall + c.lie + c.lift) {
        const k = (t - c.fall - c.lie) / c.lift;
        bike(cx + side * 3 * (1 - k), cy - 4 * (1 - k), side * q * (1 - k));
        riderBody(cx + side * 15, cy - 2, 0);
      } else {
        const k = Math.min(1, (t - c.fall - c.lie - c.lift) / c.mount);
        bike(cx, cy, 0); riderBody(Math.round(cx + side * 15 * (1 - k)), cy - 3, 0);
      }
      return;
    }
    if (s.safeT > 0 && Math.floor(now / 90) % 2) sc.x.globalAlpha = 0.4;
    el(cx + 2, cy + 4, 9, 15, 'rgba(0,0,0,.25)', null);
    if (s.gear === TOP && s.st === 'ride') {
      // the rocket under the bag and its flame
      bx(cx - 4, cy + 15, 8, 8, '#9aa4ab', '#dfe5e8', '#6f7b85');
      const L = 14 + Math.floor(Math.random() * 12);
      P(cx - 4, cy + 23, 8, L, '#e8402f'); P(cx - 3, cy + 23, 6, L - 4, '#ff8a2a'); P(cx - 1, cy + 23, 2, L - 9, '#fff2a0');
      for (let k = 0; k < 4; k++) P(cx - 6 + Math.floor(Math.random() * 12), cy + 23 + L + Math.floor(Math.random() * 8), 2, 2, '#ffb21a');
    }
    bike(cx, cy, 0);
    const pedal = s.st === 'ride' ? Math.floor(now / Math.max(40, 220 - s.gear * 35)) % 2 : 0;
    riderBody(cx, cy - 3 + pedal, 0);
    sc.x.globalAlpha = 1;
  }
  function speedLines(g: Geo, s: DeliverState): void {
    if (s.st !== 'ride' || s.gear < 3) return;
    const n = (s.gear - 2) * 3, LH = sc.LH;
    for (let k = 0; k < n; k++) {
      const x = g.rx0 + Math.floor(hash(k, 3, 1) * g.roadW), len = 6 + s.gear * 3, y = ((hash(k, 9, 2) * LH + s.pos * PPM * 1.7) % (LH + len)) - len;
      P(x, Math.round(y), 1, len, 'rgba(255,255,255,.45)');
    }
  }
  function drawText(g: Geo, s: DeliverState): void {
    const Sc = sc.S, Y = (y: number): number => (g.riderY - (y - s.pos) * PPM) * Sc, run = s.run;
    const rightX = (g.rx0 + g.roadW + g.pave + (sc.LW - g.rx0 - g.roadW - g.pave) / 2) * Sc;
    if (run) for (const o of run.orders) {
      const y = Y(o.y);
      if (y < -20 || y > sc.LH * Sc + 20) continue;
      if (o.done) chipT(rightX / Sc, y / Sc, o.cold ? '凍咗' : o.fast ? '火箭✓' : '✓', o.cold ? '#bcd6f2' : o.fast ? '#ffb070' : '#7be08f', INK, 14);
      else chipT(rightX / Sc, y / Sc, `#${o.no}`, '#ffd25a', INK, 17);
    }
    const leftX = ((g.rx0 - g.pave) / 2) * Sc;
    for (const y of run ? [0, run.len] : [0]) { const yy = Y(y); if (yy > -20 && yy < sc.LH * Sc + 20) chipT(leftX / Sc, yy / Sc - 4, '茶餐廳', '#c8323c', '#ffffff', 12); }
    const cx = (g.rx0 + g.laneW * (s.x + 0.5)) * Sc, cy = g.riderY * Sc;
    if (s.st === 'crash') {
      const c = TUNE.crash;
      if (s.crashT < c.fall + c.lie) outlineT(cx / Sc, g.riderY - 34, '撞車！', '#ff5a5a', 24);
      else outlineT(cx / Sc, g.riderY - 34, '扶返起身…', '#ffe9a8', 16);
      const t = sc.t, w = 60, frac = Math.min(1, s.crashT / CRASH_T);
      t.fillStyle = INK; t.fillRect(cx - w / 2 - 2, cy + 46, w + 4, 8); t.fillStyle = '#ffd25a'; t.fillRect(cx - w / 2, cy + 48, w * frac, 4);
    }
    if (G.started && !G.steered && run && run.t < 4 && s.st === 'ride' && !ext) {
      const a = Math.max(0, Math.min(1, 4 - run.t)), t = sc.t;
      t.globalAlpha = a; outlineT(sc.LW * 0.25, sc.LH * 0.5, '◀ 撳左邊', '#ffffff', 15); outlineT(sc.LW * 0.75, sc.LH * 0.5, '撳右邊 ▶', '#ffffff', 15); t.globalAlpha = 1;
    }
    for (let i = fxs.length - 1; i >= 0; i--) {
      const f = fxs[i]; if (!f) continue;
      f.t += 1 / 60;
      if (f.t > f.life) { fxs.splice(i, 1); continue; }
      const t = sc.t; t.globalAlpha = Math.min(1, (f.life - f.t) / 0.3);
      outlineT(sc.LW / 2, sc.LH * 0.36 + f.dy - f.t * 14, f.text, f.col, f.size); t.globalAlpha = 1;
    }

  }
  function draw(now: number): void {
    beginScene(sc, DESIGN_H, MIN_S);
    const g = geo(), s = S;
    if (!s) { scenery(g, init0, 0); return; }
    scenery(g, s, s.pos);
    for (const c of s.cars) vehicle(g, c, s.pos, now);
    speedLines(g, s);
    if (s.st !== 'idle') rider(g, s, now); else { bike(Math.round(g.rx0 + g.laneW * 1.5), g.riderY, 0); riderBody(Math.round(g.rx0 + g.laneW * 1.5), g.riderY - 2, 0); }
    drawText(g, s);
  }
  const init0 = deliver.init({ difficulty: 'pro', seed: 1, players: 1 }, 'solo');

  /* ---------- orders row, HUD, gauge, summary ---------- */
  function orders(): void {
    const box = $('orders'), run = S?.run ?? null;
    const key = run && S ? `${S.runs}:${run.orders.map(o => o.gid).join(',')}` : S?.st ?? 'none';
    if (key !== ordKey) {
      ordKey = key;
      if (!run) box.innerHTML = `<span class="hint">${ext ? '等緊外賣單…' : '揀好單數就出發'}</span>`;
      else box.innerHTML = run.orders.map(o => `<div class="oc" data-gid="${o.gid}"><div class="h">#${o.no}<small></small></div><div class="bar"><i></i></div></div>`).join('');
    }
    if (!run) return;
    const next = run.orders.find(o => !o.done);
    run.orders.forEach((o, i) => {
      const c = box.children[i]; if (!(c instanceof HTMLElement)) return;
      const frac = o.left0 > 0 ? Math.max(0, o.left / o.left0) : 0, cold = o.done ? o.cold : o.left <= 0;
      c.className = 'oc' + (o.done ? ' done' : '') + (cold ? ' cold' : frac < 0.25 ? ' cool' : frac < 0.5 ? ' warm' : '') + (o === next ? ' next' : '');
      const sm = c.querySelector('small'), bar = c.querySelector('.bar i');
      if (sm) sm.textContent = o.done ? (o.cold ? '凍咗' : '✓') : cold ? '凍咗！' : `${Math.ceil(o.left)}秒`;
      if (bar instanceof HTMLElement) bar.style.width = `${(o.done && !o.cold ? 1 : frac) * 100}%`;
    });
  }
  /** Seat mode at the door: how many bags to take (more = a bigger tip, a heavier bike); then waiting for the claims. */
  let doorKey = '';
  function door(): void {
    const el = $('door'), s = S, d = s && (s.st === 'idle' || s.st === 'home') ? s.door : null;
    const key = d ? `${d.bags.map(b => b.no).join(',')}/${d.want}` : '';
    if (key === doorKey) return;
    doorKey = key; el.hidden = !d;
    if (!d) return;
    if (d.want === 0) $('ovCard').hidden = true;
    const btn = (n: number): string => {
      const nos = d.bags.slice(0, n).map(b => `#${b.no}`).join(' ');
      return `<button data-n="${n}"${n > d.bags.length || d.want > 0 ? ' disabled' : ''}${d.want === n ? ' class="on"' : ''}>${n} 袋<small>${n <= d.bags.length ? nos : '—'}</small><small>貼士 ×${bagBonus(n)}</small></button>`;
    };
    el.innerHTML = `<h3>${d.want ? '等確認袋數…' : '今轉帶幾多袋？'}</h3><p>${d.want ? '全部袋確認咗先出發；俾人攞咗嗰袋就唔帶。' : '袋多貼士加成多，但架車重：轉線、升波都慢啲。'}</p><div class="pk">${[1, 2, 3].map(btn).join('')}</div>`;
  }
  $('door').addEventListener('click', e => { const b = e.target instanceof Element ? e.target.closest('button') : null; if (b instanceof HTMLButtonElement && !b.disabled) cmd({ t: 'load', n: Number(b.dataset.n) }); });
  function hud(): void {
    const s = S; let txt = '';
    if (s?.run && (s.st === 'ride' || s.st === 'crash')) {
      const next = s.run.orders.find(o => !o.done), to = next ? next.y : s.run.len;
      // only the metres to the next stop (the yellow-framed bag, or 返舖 on the way home); the run time is
      // on the card at the shop
      txt = `${next ? '' : '返舖 '}${Math.max(0, Math.ceil(to - s.pos))}米`;
    }
    $('hs').textContent = txt;
    const gear = s && s.st === 'ride' ? s.gear : 0;
    $('gauge').querySelectorAll('.pips i').forEach((p, i) => { p.classList.toggle('on', s !== null && s.st === 'ride' && i <= gear); });
    $('gN').textContent = s?.st === 'crash' ? '跌咗' : gear === TOP ? '火箭！' : `${gear} 波`;
    go.classList.toggle('top', gear === TOP);
    go.disabled = !s || s.st !== 'ride';
  }
  function summary(): void {
    const s = S;
    if (!s || s.st !== 'home' || !s.last) { if (ext && !$('ovCard').hidden && s?.st !== 'home') $('ovCard').hidden = true; return; }
    if (seenHome === s.runs) return;
    seenHome = s.runs;
    const L = s.last, n = L.orders.length, cold = L.orders.filter(o => o.cold).length;
    const bestKey = `best_${tierOf(s).tier}_${n}`, prev = store.get(bestKey), best = typeof prev === 'number' ? Math.min(prev, L.secs) : L.secs;
    if (!ext) store.set(bestKey, best);
    const tip = L.crashes >= 2 ? '撞得多：低一兩波，睇定啲車先轉線，仲快過扶車'
      : cold ? '有嘢凍咗：早啲升波，直路放膽踩'
        : L.crashes ? '差少少就完美：見到車打燈就預早轉線'
          : '穩陣！下一轉試下升多一波，搏快啲返舖頭';
    $('cardBody').innerHTML = `<h2>返到舖頭！</h2>
      <div class="secs">${L.secs.toFixed(1)}<small> 秒離開舖頭</small></div>
      <ul class="ol">${L.orders.map(o => `<li class="${o.cold ? 'cold' : ''}">#${o.no}<span>${o.cold ? `凍咗（遲 ${Math.max(0.1, -o.left).toFixed(1)} 秒）` : o.fast ? `火箭送到 ✓ 貼士 ×${TUNE.rocket.tip}` : '熱辣辣 ✓'}</span></li>`).join('')}</ul>
      <p class="stat">撞車 ${L.crashes} 次 · ${n - cold}/${n} 張熱辣辣送到${n > 1 ? ` · 貼士 ×${bagBonus(n)}` : ''}</p>
      <p class="quote">${tip}</p>
      ${ext ? '<p class="mute">等下一轉外賣…</p>' : `<p class="mute">${DIFF_NAME[diff]} · ${n} 張單最快 ${best.toFixed(1)} 秒</p>
      <button class="big" id="bAgain">再送一轉</button><button class="big alt" id="bHome">返去揀單數／難度</button>`}`;
    $('ovCard').hidden = false;
    if (!ext) {
      $b('bAgain').onclick = () => { begin(n); };
      $b('bHome').onclick = () => { $('ovCard').hidden = true; $b('bStart').textContent = '出發！'; $('ovStart').hidden = false; };
    }
  }
  function playCues(): void {
    const s = S; if (!s) return;
    if (seenRuns !== s.runs) { seenRuns = s.runs; lastCue = s.cues.reduce((a, c) => (c.k === 'go' ? Math.max(a, c.id - 1) : a), lastCue); }
    for (const c of s.cues) {
      if (c.id <= lastCue) continue;
      lastCue = c.id;
      sound.play(c.k, s.gear);
      if (c.k === 'crash') { shake(sc); fxs.length = 0; }
      if (c.k === 'go') fxs.push({ text: '出發！', col: '#ffd25a', t: 0, life: 1.1, size: 30, dy: 0 });
      if (c.k === 'rocket') fxs.push({ text: '火箭！', col: '#ff8a2a', t: 0, life: 0.9, size: 26, dy: 30 });
      if (c.k === 'drop' || c.k === 'cold') {
        const o = s.run?.orders.filter(x => x.done).sort((a, b) => b.doneAt - a.doneAt)[0];
        if (o) fxs.push(c.k === 'drop' ? { text: `#${o.no} 熱辣辣送到！`, col: '#7be08f', t: 0, life: 1.4, size: 22, dy: 0 } : { text: `#${o.no} 凍咗…`, col: '#9cc8ff', t: 0, life: 1.4, size: 22, dy: 0 });
      }
    }
  }
  const coarse = matchMedia('(pointer:coarse)');
  function checkRot(): boolean { const land = phoneLandscape() && coarse.matches; $('rot').hidden = !land; return land; }

  /* ---------- main loop: the core steps on frame time (it keeps fixed 1/120 s steps inside) ---------- */
  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const land = checkRot();
    if (ext) S = ext.live();
    else if (S && !G.paused && !land && !document.hidden) deliver.step(S, dt, ctx());
    draw(now); orders(); door(); hud(); summary(); playCues();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (ext) { $b('bMenu').hidden = true; $('ovStart').hidden = true; G.started = true; }

  return {
    get state() { return S; }, get paused() { return G.paused; },
    begin, ctx, cmd,
    bot(o = {}) {
      if (!S) return null;
      const k = JSON.stringify(o); let b = bots.get(k);
      if (!b) { b = makeDeliverBot(o); bots.set(k, b); }
      return b(S, ctx());
    },
    sight: () => geo().riderY / PPM,
  };
}
