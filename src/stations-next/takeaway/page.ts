// The standalone 外賣 page (site/stations/takeaway.html): the station on its own, printing its own slips, with the original
// prototype's start card (how to play, difficulty, 淨係練綁袋), HUD, debug readout and end card, so it can be played on
// a phone outside the shop. Built by scripts/build.mjs into site/stations/takeaway.js.
import { seededRng, type Difficulty } from '../contract';
import { el$, isDifficulty, isNumber, makeScene, beginScene, pageGuards, store, wakeLock, webSound } from '../lab-kit';
import { takeaway, takeawayDrill, LY, TUNE, WHY, active, custOrders, custSlot, needEx, slotXY, tiePath, trayRect, type TakeCmd, type TakeResult, type TakeState } from './index';
import { attachTakeawayInput, takeawayScreen } from './ui';
import { knotBand } from './knots';
import { seatLink } from '../seat-link';

const st = store('lab_take_');
let diff: Difficulty = st.get('diff', 'pro', isDifficulty), debug = false, paused = true, s: TakeState | null = null, seed = 1, fps = 60;
const sc = makeScene(el$('sc')), snd = webSound(), scr = takeawayScreen(sc, snd.sound);
let rng = seededRng(1), mod = takeaway;
const ctx = () => ({ t: s ? s.t : 0, rng, seat: 'solo', byPlayer: true, shared: { t: s ? s.t : 0, paused } });

// As a seat of the shop (?seat): the game page runs the station; this page draws it and sends the commands.
const link = seatLink('takeaway', (x: unknown) => takeaway.validate(x));
function send(c: TakeCmd) { if (link) link.send(c); else if (s && !paused) handle(mod.command(s, c, ctx())); }
function handle(rs: TakeResult[]) { for (const r of rs) if (r.kind === 'shiftEnd') endCard(); }
function newRun(mode: 'shift' | 'drill') {
  seed = Math.floor(Math.random() * 2 ** 31); rng = seededRng(seed); mod = mode === 'drill' ? takeawayDrill : takeaway;
  scr.reset(); beginScene(sc);
  s = mod.init({ difficulty: diff, seed, players: 1 }, 'solo');
  mod.command(s, scr.view(), ctx());
}

/* ---------- start card, buttons ---------- */
function segInit(id: string, cur: string, on: (v: string) => void) {
  const seg = el$(id), paint = (v: string) => { seg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset['v'] === v); }); };
  paint(cur); seg.addEventListener('click', e => { const tg = e.target, b = tg instanceof Element ? tg.closest('button') : null; if (!b?.dataset['v']) return; on(b.dataset['v']); paint(b.dataset['v']); });
}
segInit('segDiff', diff, v => { if (isDifficulty(v)) { diff = v; st.set('diff', v); } });
el$('bGo').onclick = () => { el$('ovStart').hidden = true; newRun('shift'); paused = false; wakeLock(); };
el$('bDrill').onclick = () => { el$('ovStart').hidden = true; newRun('drill'); paused = false; wakeLock(); };
el$('bSnd').onclick = () => { const on = snd.set(!snd.on); el$('bSnd').textContent = on ? '聲 開' : '聲 關'; el$('bSnd').classList.toggle('on', on); if (on) for (let i = 0; i < 2; i++) snd.sound.tone(880 * Math.pow(1.26, i), 0.12, 'sine', 0.05, 0, i * 0.07); };
el$('bDbg').onclick = () => { debug = !debug; el$('dbg').hidden = !debug; el$('bDbg').classList.toggle('on', debug); };
el$('bMenu').onclick = () => { paused = true; el$('bGo').textContent = s && !s.over ? '由頭開過' : '開工'; el$('ovStart').hidden = false; };
pageGuards();
attachTakeawayInput(el$('sc'), scr, () => (paused || (link && !link.mine()) ? null : s), send);
if (link) { el$('ovStart').hidden = true; el$('bMenu').hidden = true; paused = false; }

/* ---------- end card ---------- */
function endCard() {
  if (!s?.end) return;
  const e = s.end, best = Math.max(st.get(`best_${diff}`, 0, isNumber), e.score); st.set(`best_${diff}`, best);
  const qs = e.quotes.join('<br>'), why = e.why.map(([k, v]) => `${WHY[k] ?? k} ×${v}`).join(' · ');
  el$('cardBody').innerHTML = `<h2>收工！</h2>
    <p class="stars">${'★'.repeat(e.big)}<span>${'★'.repeat(3 - e.big)}</span></p>
    <p class="stat">${e.verdict}</p>
    ${qs ? `<p class="quote">${qs}</p>` : ''}
    <p class="stat">交咗 ${e.n} 單${e.undone ? `（仲有 ${e.undone} 單未交）` : ''} · ★${e.stars}/${e.max} · 貼士 $${e.score.toFixed(2)}<br>
      綁袋平均 ${e.avgTie.toFixed(2)} 秒（標準 ${e.avgPar.toFixed(2)}）· 最快 ${e.fastest.toFixed(2)} · 甩線 ${e.offs} 次</p>
    ${why ? `<p class="mute">失分：${why}</p>` : ''}
    <p class="mute">${TUNE.diff[diff].name}最高貼士 $${best.toFixed(2)}</p>
    <button class="big" id="bAgain">再嚟一更</button><button class="big alt" id="bHome">返去睇玩法</button>`;
  el$('ovCard').hidden = false;
  el$('bAgain').onclick = () => { el$('ovCard').hidden = true; newRun('shift'); };
  el$('bHome').onclick = () => { el$('ovCard').hidden = true; paused = true; el$('bGo').textContent = '開工'; el$('ovStart').hidden = false; };
}

/* ---------- HUD and debug ---------- */
function hud() {
  if (!s) { el$('hs').textContent = '手感測試'; return; }
  const name = TUNE.diff[s.diff].name;
  if (s.mode === 'drill') { const n = s.ties.length, avg = n ? s.ties.reduce((a, t) => a + t.time / t.par, 0) / n : 0; el$('hs').textContent = `練綁袋 · ${name} · ${n} 條${n ? ` · 平均 ${Math.round(avg * 100)}% 標準` : ''}`; el$('progI').style.width = '0%'; }
  else {
    const left = Math.max(0, TUNE.shift - s.t), m = Math.floor(left / 60), sec = Math.floor(left % 60);
    el$('hs').textContent = `${m}:${String(sec).padStart(2, '0')} · 交咗 ${s.results.length} · 貼士 $${s.tips.toFixed(2)} · ${name}`;
    el$('progI').style.width = `${(100 * Math.min(1, s.t / TUNE.shift)).toFixed(1)}%`;
  }
  if (debug) {
    const T = s.tie, a = active(s), d = TUNE.diff[s.diff], P = T ? tiePath(T) : null;
    el$('dbg').textContent = [
      `phase ${s.phase}  fps ${Math.round(fps)}  t ${s.t.toFixed(1)}`,
      T && P ? `knot tier ${T.tier} #${T.pat} ${P.fam}/${P.name} len ${Math.round(P.len)}px minR ${Math.round(P.minR)} corners ${P.corners.length}` : 'path -',
      T ? `prog ${Math.round(T.i * TUNE.trace.step)}/${Math.round(T.len)}  dist ${Math.round(T.dist)}/${knotBand(T.tier)}  ${T.on ? 'ON' : 'off'}  offs ${T.offs}  par ${T.par.toFixed(2)}` : '',
      `knot ${s.knot} band ${knotBand(s.knot)} win ${d.win} gap ${TUNE.trace.gap} undo ${d.undo}`,
      a ? `#${a.no} need ${JSON.stringify(needEx(a))}` : '',
      `bag ${JSON.stringify(s.bag.ex)} items ${s.bag.items.length} spills ${s.bag.spills}`,
      `finger v ${Math.round(Math.hypot(s.f.vx, s.f.vy))} px/s`,
    ].join('\n');
  }
}

/* ---------- loop ---------- */
let last = performance.now();
function frame(nowMs: number) {
  const dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs; fps += (1 / Math.max(0.001, dt) - fps) * 0.05;
  beginScene(sc);
  if (link) s = link.live();
  if (s && (s.view.LW !== sc.LW || s.view.LH !== sc.LH || s.view.S !== sc.S)) { if (link) link.send(scr.view()); else mod.command(s, scr.view(), ctx()); }
  if (!link && !paused && !document.hidden && s && !s.over) handle(mod.step(s, dt, ctx()));
  scr.stepParts(dt); scr.draw(s, nowMs / 1000); hud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook (Playwright only: the harness sets window.__TEST__ before the page loads): read-only views of the run, the
// screen positions a test needs (logical px), and ff(sec) to run the clock on without waiting (to reach the end card).
if (Reflect.get(window, '__TEST__') === true) {
  Reflect.set(window, '__station', {
    ff(sec: number) { for (let i = 0; i < Math.round(sec * 60) && s && !s.over; i++) handle(mod.step(s, 1 / 60, ctx())); },
    get s() { return s; }, get S() { return sc.S; }, get paused() { return paused; }, get sound() { return snd.on; }, get parts() { return scr.parts; }, get seed() { return seed; },
    get layout() {
      if (!s) return null;
      const L = LY(s), cur = s;
      return { ...L, slots: Array.from({ length: TUNE.counterSlots }, (_, i) => slotXY(L, i)), trays: Object.fromEntries((['cut', 'nap', 'str', 'sug', 'syr'] as const).map(k => [k, trayRect(L, k)])),
        door: custOrders(cur).map((o, i) => ({ no: o.no, cx: custSlot(L, i).cx })), pts: cur.tie ? tiePath(cur.tie).pts : null };
    },
    canvas() { const r = sc.tv.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; },
  });
}
