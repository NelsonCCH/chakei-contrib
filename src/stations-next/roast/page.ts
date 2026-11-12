// The standalone 燒味 page (site/stations/roast.html): the station on its own, making its own customers, with the original
// prototype's start card (how to play + difficulty), HUD, debug readout and end card, so it can be played on a phone
// outside the shop. Built by scripts/build.mjs into site/stations/roast.js.
// 斬料 is cutting along the dashed guides (no rhythm game): the 刀工 row picks the cutting tier.
import { seededRng, type Difficulty } from '../contract';
import { el$, isDifficulty, isNumber, makeScene, beginScene, pageGuards, store, wakeLock, webSound } from '../lab-kit';
import { roast, LY, TIERS, TUNE, widths, type RoastCmd, type RoastResult, type RoastState } from './index';
import { attachRoastInput, roastScreen } from './ui';
import { seatLink } from '../seat-link';

const st = store('lab_roast_');
const isTierPick = (v: unknown): v is string => v === 'auto' || (typeof v === 'string' && /^[0-9]$/.test(v) && Number(v) < TIERS);
let diff: Difficulty = st.get('diff', 'pro', isDifficulty), tierPick: string = st.get('tier', 'auto', isTierPick), debug = false, paused = true, s: RoastState | null = null, seed = 1;
const sc = makeScene(el$('shop')), snd = webSound(), scr = roastScreen(sc, snd.sound);
let rng = seededRng(1);
const ctx = () => ({ t: s ? s.t : 0, rng, seat: 'solo', byPlayer: true, shared: { t: s ? s.t : 0, paused } });

// As a seat of the shop (?seat): the game page runs the station; this page draws it and sends the commands.
const link = seatLink('roast', (x: unknown) => roast.validate(x));
function send(c: RoastCmd) { if (link) link.send(c); else if (s) handle(roast.command(s, c, ctx())); }
function handle(rs: RoastResult[]) { for (const r of rs) if (r.kind === 'shiftEnd') endCard(); }
function newRun() {
  seed = Math.floor(Math.random() * 2 ** 31); rng = seededRng(seed);
  s = roast.init({ difficulty: diff, seed, players: 1 }, 'solo');
  if (tierPick !== 'auto') roast.onEvent(s, { kind: 'tier', tier: Number(tierPick) }, ctx());
  scr.reset(); beginScene(sc); send(scr.view());
}

/* ---------- start card, buttons ---------- */
function segInit(id: string, cur: string, on: (v: string) => void) {
  const seg = el$(id), paint = (v: string) => { seg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset['v'] === v); }); };
  paint(cur); seg.addEventListener('click', e => { const tg = e.target, b = tg instanceof Element ? tg.closest('button') : null; if (!b?.dataset['v']) return; on(b.dataset['v']); paint(b.dataset['v']); });
}
const diffHelp = () => { el$('diffHelp').textContent = TUNE.diff[diff].help; };
segInit('segDiff', diff, v => { if (isDifficulty(v)) { diff = v; st.set('diff', v); diffHelp(); } }); diffHelp();
segInit('segTier', tierPick, v => { if (isTierPick(v)) { tierPick = v; st.set('tier', v); } });
const go = () => { el$('ovStart').hidden = true; newRun(); paused = false; wakeLock(); };
el$('bGo').onclick = go;
/** Sound on: iOS plays through the silent switch where Safari allows it (audio session "playback", 16.4+). */
function audioSession() {
  try { const as: unknown = Reflect.get(navigator, 'audioSession'); if (typeof as === 'object' && as !== null && 'type' in as) Reflect.set(as, 'type', 'playback'); } catch { /* not supported */ }
}
el$('bSnd').onclick = () => {
  const on = snd.set(!snd.on); el$('bSnd').textContent = on ? '聲 開' : '聲 關'; el$('bSnd').classList.toggle('on', on);
  if (on) { audioSession(); snd.sound.tone(120, 0.1, 'square', 0.07, 55); snd.sound.noise(0.07, 0.12, 350); }
};
el$('bDbg').onclick = () => { debug = !debug; el$('dbg').hidden = !debug; el$('bDbg').classList.toggle('on', debug); };
el$('bMenu').onclick = () => { paused = true; el$('bGo').textContent = s && !s.over ? '由頭開過' : '開工'; el$('ovStart').hidden = false; };
pageGuards();
attachRoastInput(el$('app'), scr, () => (paused || (link && !link.mine()) ? null : s), send);
if (link) { el$('ovStart').hidden = true; el$('bMenu').hidden = true; paused = false; }

/* ---------- end card ---------- */
function endCard() {
  if (!s?.end) return;
  const e = s.end, best = Math.max(st.get(`best_${diff}`, -999, isNumber), s.score); st.set(`best_${diff}`, best);
  el$('cardBody').innerHTML = `<h2>收檔</h2>
    <p class="stars">${'★'.repeat(e.stars)}<span>${'★'.repeat(3 - e.stars)}</span></p>
    <p class="stat">出咗 ${s.served} 碟 · 平均 ${e.avg.toFixed(1)} 粒星 · 客走咗 ${s.left}<br>靚刀 ${s.cleanCuts}/${s.cuts}（${e.even}%）· 最長連續 ${s.bestCombo}</p>
    <p class="stat">收入 $${s.score}（貨款 $${s.earned} + 貼士 $${s.tips} − 蝕本 $${s.loss}${s.left ? ` − 走客 $${s.left * TUNE.leaveCost}` : ''}${s.dumped ? ` − 倒碟 $${s.dumped * TUNE.dumpCost}` : ''}）<br><span class="mute">${TUNE.diff[diff].name}最高 $${best}</span></p>
    ${e.why.length ? `<p class="mute"><b>扣分喺邊：</b>${e.why.map(([t, n, pts]) => `${t}${n > 1 ? ` x${n}` : ''}（-${Math.round(pts)}）`).join(' · ')}${e.wrong ? ` · 拉錯燒味 x${e.wrong}（嘥時間）` : ''}</p>` : ''}
    <button class="big" id="bAgain">再開一檔</button><button class="big alt" id="bHome">返去睇做法</button>`;
  el$('ovCard').hidden = false;
  el$('bAgain').onclick = () => { el$('ovCard').hidden = true; newRun(); };
  el$('bHome').onclick = () => { el$('ovCard').hidden = true; paused = true; el$('bGo').textContent = '開工'; el$('ovStart').hidden = false; };
}

/* ---------- HUD and debug ---------- */
function hud() {
  if (!s) { el$('hs').textContent = '手感測試'; return; }
  const b = s.board, left = Math.max(0, TUNE.shift - s.t), m = Math.floor(left / 60), sec = Math.floor(left % 60);
  el$('hs').textContent = `${m}:${String(sec).padStart(2, '0')} · $${s.score} · 出 ${s.served} · 走 ${s.left}${s.combo >= 2 ? ` · 連 x${s.combo}` : ''} · ${TUNE.diff[s.diff].name}`;
  el$('progI').style.width = `${(100 * s.t / TUNE.shift).toFixed(1)}%`;
  if (debug) {
    const ws = b ? widths(b) : [], F = s.f;
    el$('dbg').textContent = [
      `finger ${F.down ? String(F.mode) : '-'}  tier ${s.tier}  knob pcs ${s.knob.pcs} snap x${s.knob.snap.toFixed(2)}`,
      b ? `${b.k} n${b.n} w${b.w} cuts ${b.cuts.map(c => c.toFixed(1)).join(' ')} on ${b.on.map(c => c.toFixed(1)).join(' ')}` : 'board -',
      b ? `widths ${ws.map(w => w.toFixed(1)).join(' ')} splinter ${b.splinter} ragged ${b.ragged}` : '',
      `plate ${s.plate.base ?? '-'} soy ${s.plate.soy.toFixed(2)}${s.plate.flood ? ' FLOOD' : ''} items ${s.plate.items.map(i => `${i.k}x${i.widths.length}@${i.zone}`).join(' ')}`,
      `queue ${s.q.map(c => Math.round(c.pat)).join(' ')}  combo ${s.combo}  clean ${s.cleanCuts}/${s.cuts}`,
      ...s.orders.slice(-3).map(o => `${o.name} q${Math.round(o.q)} ${o.stars}* ${o.why.join(',')}`),
    ].join('\n');
  }
}

/* ---------- loop ---------- */
let last = performance.now();
function frame(nowMs: number) {
  const dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs;
  beginScene(sc);
  if (link) s = link.live();
  if (s && (s.view.LW !== sc.LW || s.view.LH !== sc.LH || s.view.S !== sc.S)) send(scr.view());
  if (link) scr.stepParts(dt);
  else if (!paused && !document.hidden && s && !s.over) { handle(roast.step(s, dt, ctx())); scr.stepParts(dt); }
  scr.draw(s, nowMs / 1000); hud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook (Playwright only: the harness sets window.__TEST__ before the page loads): read-only views of the run, and
// ff(sec) to run the clock on without waiting (to reach the end card).
if (Reflect.get(window, '__TEST__') === true) {
  Reflect.set(window, '__station', {
    ff(sec: number) { for (let i = 0; i < Math.round(sec * 60) && s && !s.over; i++) handle(roast.step(s, 1 / 60, ctx())); },
    get s() { return s; }, get layout() { return s ? LY(s) : null; }, get S() { return sc.S; }, get paused() { return paused; },
    get sound() { return snd.on; }, get parts() { return scr.parts; }, get seed() { return seed; }, tiers: TIERS,
    get outLatNow() { return snd.sound.lat ? snd.sound.lat() : 0; }, get audioState() { return snd.state; },
    canvas() { const r = sc.tv.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; },
  });
}
