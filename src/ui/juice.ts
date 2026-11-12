// 手感：連擊、貼士、聲（全部用 Web Audio 即場砌，唔使聲檔）
// TypeScript port of the original game's juice.js, as an ES module: every
// top-level name is exported. The kitchen / bar sound effects that the JS added to
// `sfx` with Object.assign right after defining it are written into the object literal itself (same methods, same key
// order, and nothing reads sfx in between), so the checker knows every method.
import './sets';   // load order: src/entry.ts
import { G, liveG } from '../core/state';
import { must } from '../core/util';
import { CFG } from '../core/data/menus';
import { feverTipMul } from '../core/referee/fever';
import { $ } from './prefs';
import { toast, netActing } from './ui';
import { bossSay, bossEl } from './career';
import { LEVELS, lvCat } from './levels';
import { pttSoundLevel, AUDIO_REVIVE, onPttVoice, pttVoice } from '../ptt/sfx';
import { DUCK, duckRamp } from '../ptt/duck';

// 旺場效果：畫面轉暖、音樂快啲高啲、彈大字
export function feverFx(on: boolean): void {
  document.body.classList.toggle('fever', on);
  // the shift's one fever, CFG.fever.sec long: it builds slowly, peaks, then winds down (the HUD's heat bar shows it)
  if (on){ bossSay(`旺場嚟喇！${String(CFG.fever.sec)} 秒，客人會愈嚟愈密，貼士最多 ×${String(CFG.fever.tip)}！`); sfx.fanfare(); setTimeout(() => { sfx.fanfare(); }, 250); }
  else toast('旺場過咗，辛苦晒！');
}
/** The 搏盡 card's mishap strikes (core/referee/twist.ts), told alike on every phone from the shared state; the
 *  blackout darkens the shop (body.blackout) until `on` is false again. */
export function twistFx(twist: string, on: boolean): void {
  if (twist === 'blackout'){
    document.body.classList.toggle('blackout', on);
    if (on){ bossSay('停電！冇燈都要頂住，一陣就有電！'); sfx.bad(); } else toast('電返嚟喇！');
    return;
  }
  if (!on) return;
  if (twist === 'critic') bossSay('食評家駕到！佢冇乜耐性，快啲招呼佢！');
  else if (twist === 'bigTable') bossSay('八人大枱到！要兩張卡位，快啲執枱！');
  sfx.fanfare();
}
/** The tip multiplier as the combo shows it in a fever: one decimal, nothing when it is (about) 1. */
const tipMulTxt = (): string => { const m = Math.round(feverTipMul(liveG()) * 10) / 10; return m > 1 ? ` ×${String(m)}` : ''; };
export let comboEl: HTMLElement | null = null, comboTimer = 0;
export function showCombo(tip: number, broke?: boolean): void {
  if (!comboEl){ comboEl = document.createElement('div'); comboEl.id = 'combo'; comboEl.setAttribute('aria-live', 'polite'); document.body.appendChild(comboEl); }
  if (broke) comboEl.innerHTML = '<b>斷咗</b>';
  else if ((liveG().combo ?? NaN) < 2) { comboEl.hidden = true; return; }
  else comboEl.innerHTML = `${liveG().fever ? '<small>旺場</small>' : ''}<b>連 ×${String(liveG().combo)}</b>${tip ? `<span>+$${tip} 貼士${tipMulTxt()}</span>` : ''}`;
  comboEl.className = broke ? 'broke' : liveG().fever ? 'hot fever' : '';
  // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- reading offsetWidth forces a reflow so the CSS animation restarts; the read is the point
  comboEl.hidden = false; comboEl.style.animation = 'none'; void comboEl.offsetWidth; comboEl.style.animation = '';
  clearTimeout(comboTimer); comboTimer = setTimeout(() => { must(comboEl, 'comboEl').hidden = true; }, broke ? 1200 : 2200);
}
// 收工畫面加兩行
export function comboStats(): void {
  if (!G) return;
  must($('result'), 'result').insertAdjacentHTML('beforeend', `<div><span>最長連擊</span><b>${(G.maxCombo ?? 0)|0}</b></div><div><span>貼士</span><b>$${(G.tips ?? 0)|0}</b></div>${G.fevers ? `<div><span>旺場</span><b>${G.fevers} 次</b></div>` : ''}`);
  document.body.classList.remove('fever', 'feverPeak', 'blackout');
  sfx.end();
}

/* ===================== 聲 ===================== */
export let soundOn = true;
try { soundOn = localStorage.getItem('ckf-sound') !== 'off'; } catch { /* storage blocked: keep the default */ }
export let AC: AudioContext | null = null, master: GainNode | null = null, noiseG: GainNode | null = null, clatterT = 0;
export function audio(): AudioContext | null {
  if (AC) return AC;
  const C = typeof window.AudioContext === 'function' ? window.AudioContext : window.webkitAudioContext; if (!C) return null;
  AC = new C(); master = AC.createGain(); master.gain.value = soundOn ? .5 : 0; master.connect(AC.destination);
  // 背景人聲：啡色噪音經過帶通濾波，似遠遠啲人傾偈
  const len = AC.sampleRate * 3, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
  let last = 0; for (let i = 0; i < len; i++){ last = (last + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = .7;
  noiseG = AC.createGain(); noiseG.gain.value = 0;
  src.connect(bp); bp.connect(noiseG); noiseG.connect(master); src.start();
  const ac = AC;
  ac.addEventListener('statechange', () => { if (ac.state==='running') acRan = true; });
  return AC;
}
/**
 * The game's sound comes back by itself. Once the context has run (a tap unlocked it), a context that stopped
 * without the game asking (iOS: 'interrupted' or 'suspended' when the walkie-talkie's mic moves the audio route, a
 * phone call, the page hidden) is resumed: at once when src/ptt says a turn or the mic is over (AUDIO_REVIVE) or the
 * page comes back into view, and at most once a second from the music's tick while it stays stopped. The music then
 * picks up from the context's clock (bgmTick restarts its schedule when it fell behind).
 */
export let acRan = false, healAt = 0;
export function healAudio(now: boolean): void {
  if (AC && AC.state==='running') acRan = true;
  if (!AC || !acRan || AC.state==='running' || AC.state==='closed' || document.visibilityState!=='visible') return;
  const t = performance.now();
  if (!now && t - healAt < 1000) return;
  healAt = t;
  AC.resume().catch(() => { /* still interrupted: the next try */ });
}
addEventListener(AUDIO_REVIVE, () => { healAudio(true); });
document.addEventListener('visibilitychange', () => { healAudio(true); });
// 第一次撳嘢先開聲（瀏覽器規定）；之後每次撳掣有少少「嗒」聲
addEventListener('pointerdown', e => {
  audio(); if (AC && AC.state!=='running' && AC.state!=='closed') void AC.resume();   // 'interrupted' (iOS) too
  // The JS called e.target.closest() here, which threw on a target that is not an element.
  const tg = e.target; if (!(tg instanceof Element)) throw new TypeError('chakei: pointerdown target is not an element');
  // not on the walkie-talkie's talk button: its own key-up chirp is the press's sound
  if (tg.closest('button') && !tg.closest('#pttBtn')) sfx.tap();
}, true);
export function tone(f: number, dur: number, { type = 'sine', vol = .3, at = 0, to = null, attack = .005, when = null, dest = null }: ToneOpts = {}): void {
  if (!AC || !soundOn || (netActing && !dest)) return;
  const t = when !== null ? when : AC.currentTime + at, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(dest || must(master, 'master gain')); o.start(t); o.stop(t + dur + .02);
}
export const semi = (n: number): number => Math.pow(2, n / 12);
export const sfx = {
  tap(){ tone(1800, .03, { type:'square', vol:.04 }); },
  // 叮：連擊愈長音愈高（最多高一個八度）
  good(c: number){ const f = 880 * semi(Math.min(12, (c - 1) * 2)); tone(f, .35, { vol:.22 }); tone(f * 2, .25, { vol:.08 }); },
  coin(){ tone(1976, .08, { type:'square', vol:.06 }); tone(2637, .18, { type:'square', vol:.06, at:.07 }); },
  bad(){ tone(180, .28, { type:'square', vol:.12, to:110 }); },
  broke(){ tone(520, .3, { type:'triangle', vol:.15, to:260, at:.05 }); },
  door(){ tone(1319, .25, { vol:.08 }); tone(1047, .35, { vol:.08, at:.18 }); },
  fanfare(){ [0, 4, 7, 12].forEach((n, i) => { tone(784 * semi(n), .22, { type:'triangle', vol:.12, at:i * .08 }); }); },
  kiai(){ tone(520, .12, { type:'sawtooth', vol:.12, to:900 }); tone(900, .18, { type:'square', vol:.08, at:.1, to:600 }); },
  end(){ [0, 7, 12].forEach((n, i) => { tone(523 * semi(n), .6, { vol:.15, at:i * .15 }); }); },
  /* ===================== 廚房、水吧音效（全部即場合成，唔使聲檔） ===================== */
  // (In the JS these were added with Object.assign(sfx, {...}) after noiseHit; see the header.)
  // 出餐鐘：「叮」
  ding(){ tone(2093, 1.1, { vol:.16 }); tone(5280, .5, { vol:.04 }); tone(2637, .8, { vol:.05, at:.01 }); },
  // 炒鑊：鑊鏟刮一下、火爆一下
  stir(){ noiseHit(.22, { freq:2400, to:900, q:.8, vol:.12 }); tone(420 + Math.random() * 80, .12, { type:'triangle', vol:.05 }); noiseHit(.35, { type:'highpass', freq:4500, vol:.05, at:.05 }); },
  // 攞上碟：碟仔聲
  plate(){ tone(1650 + Math.random() * 200, .09, { type:'triangle', vol:.06 }); tone(2480, .06, { vol:.03, at:.03 }); },
  // 落爐：油「嗞」一聲
  sizzle(){ noiseHit(.6, { type:'highpass', freq:3500, vol:.07 }); },
  // 倒嘢：水聲由低去高
  pour(){ noiseHit(.45, { freq:700, to:2200, q:3, vol:.07 }); noiseHit(.35, { type:'highpass', freq:5000, vol:.015 }); },
  // 撞茶：一大嘩
  pull(){ noiseHit(.6, { freq:500, to:1800, q:2, vol:.11 }); },
  // 落冰：幾粒冰碰杯
  ice(){ for (let k = 0; k < 3; k++) tone(3200 + Math.random() * 2200, .07, { vol:.05, at:k * .06 + Math.random() * .03 }); },
  cup(){ tone(1300, .07, { type:'triangle', vol:.05 }); },
  blup(f = 1){ tone((180 + Math.random() * 160) * f, .07, { vol:.07, to:(420 + Math.random() * 240) * f }); },
};
export let noiseBuf: AudioBuffer | null = null;
export function noiseHit(dur: number, { type = 'bandpass', freq = 1000, to = null, q = 1, vol = .05, when = null, attack = .004 }: NoiseOpts = {}): void {
  if (!AC || !soundOn || netActing) return;
  if (!noiseBuf){ noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t = when !== null ? when : AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; s.loop = true; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t); if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(must(master, 'master gain')); s.start(t, Math.random() * .8); s.stop(t + dur + .02);
}
// 爐頭聲：煎嘢油滾、煲嘢水滾、炒緊嘢嗞嗞聲；水吧茶膽水滾（只係自己做緊嗰個位先有）
setInterval(() => {
  if (!AC || !soundOn || !G || !G.running || G.paused) return;
  // G may be a host's snapshot (net.js, still JS) or main.js's demo shift with only some roles: the JS guards stay.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above
  const me_ = (r: StationId): boolean => liveG().roles && liveG().roles[r]==='me';
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above
  if (me_('kitchen') && G.kit){
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above
    const t = G.t, pans = (G.kit.pan || []).filter(j => j && t < (j.burnAt ?? NaN)).length, wok = (G.kit.wok || [])[0] ? 1 : 0, pots = (G.kit.pot || []).filter(j => j).length;
    const fry = pans + wok * .7;
    if (fry) for (let k = 0; k < (fry > 1.5 ? 3 : 2); k++) if (Math.random() < .6) noiseHit(.02 + Math.random() * .05, { type:'highpass', freq:3000 + Math.random() * 4000, vol:.011 * Math.min(2, fry), when: AC.currentTime + Math.random() * .1 });
    if (pots){ if (Math.random() < .3 * pots) sfx.blup(.9); if (Math.random() < .4) noiseHit(.2, { type:'lowpass', freq:380, vol:.03 * Math.min(2, pots) }); }
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above
  if (me_('bar') && G.pot && G.pot.st==='boil'){ if (Math.random() < .45) sfx.blup(1.1); if (Math.random() < .5) noiseHit(.2, { type:'lowpass', freq:420, vol:.035 }); }
}, 100);
export function ambient(level: number): void {
  if (!AC || !noiseG) return;
  noiseG.gain.setTargetAtTime(soundOn ? level * .5 : 0, AC.currentTime, .4);
  // 間中有碗碟聲
  if (level > 0 && soundOn && performance.now() > clatterT){
    clatterT = performance.now() + 900 + Math.random() * 2500 / level;
    const f = 2400 + Math.random() * 1800; tone(f, .05, { type:'triangle', vol:.025 * level }); if (Math.random() < .5) tone(f * 1.3, .04, { type:'triangle', vol:.02 * level, at:.06 });
  }
}
export function setSound(on: boolean): void {
  soundOn = on; try { localStorage.setItem('ckf-sound', on ? 'on' : 'off'); } catch { /* storage blocked */ }
  if (master) master.gain.value = on ? .5 : 0;
  document.querySelectorAll('.soundBtn').forEach(b => { b.textContent = on ? '聲：開' : '聲：熄'; });
}
document.querySelectorAll('.soundBtn').forEach(b => { b.addEventListener('click', () => { setSound(!soundOn); }); });
setSound(soundOn);
// the walkie-talkie's chirp / roger / squelch follow this switch at the master gain's level
pttSoundLevel(() => soundOn ? .5 : 0);

/* ===================== 背景音樂 ===================== */
// 原創小調（幾首按關卡揀），兩段輪流；繁忙時間快啲
// 開工先播；暫停、收工停；可以獨立熄
export let musicOn = true;
try { musicOn = localStorage.getItem('ckf-music') !== 'off'; } catch { /* storage blocked: keep the default */ }
export const _ = null;
// 幾首原創曲，按關卡揀：主線、懷舊（似水流年／老街舊舖）、萬聖（陰森）、修羅場（急）
export const BGM: Record<BgmKey, BgmTrack> = {
  // 主線：五聲音階，C → Am → F → G
  main: { lead:[
    [76,_,79,81, 79,_,76,_,  74,_,72,_, 74,76,_,_,  72,74,76,_, 79,_,76,74,  74,_,_,_, 79,_,74,_],
    [84,_,81,79, 81,_,79,76, 79,_,76,74, 76,_,_,_,  72,74,76,79, 81,79,76,74, 72,_,_,_, _,_,_,_]],
    bass:[48, 45, 41, 43], lw:'square', lv:.06, bw:'triangle', bv:.16, fifth:7, tempo:1 },
  // 懷舊：D 宮調，慢少少，柔啲嘅三角波，似舊收音機播緊嘅時代曲
  old: { lead:[
    [74,_,76,_, 79,_,_,81, 79,_,76,_, 74,_,_,_,  71,_,74,_, 76,_,79,_, 76,_,74,71, 69,_,_,_],
    [69,_,71,_, 74,_,76,_, 79,_,81,79, 76,_,_,_,  74,_,76,74, 71,_,69,_, 71,_,74,_, 74,_,_,_]],
    bass:[50, 47, 43, 45], lw:'triangle', lv:.11, bw:'sine', bv:.2, fifth:7, tempo:.85, hat:false },
  // 萬聖：A 和聲小調，三全音、慢、時鐘滴答，間中有鬼叫咁嘅滑音
  spooky: { lead:[
    [69,_,72,_, 76,_,75,_, 74,_,_,_, 72,71,_,_,  69,_,72,_, 76,_,80,_, 81,_,_,_, _,_,_,_],
    [81,_,80,_, 77,_,76,_, 74,_,77,_, 76,_,_,_,  72,_,71,_, 68,_,71,_, 69,_,_,_, _,_,_,_]],
    bass:[45, 41, 38, 40], lw:'triangle', lv:.14, bw:'sawtooth', bv:.09, fifth:6, tempo:.8, hat:false,
    extra(i: number, when: number, step: number, dest: AudioNode | null){
      if (i % 4===2) tone(1250, .015, { type:'square', vol:.012, when, dest });              // 滴答
      if (i===0 && bgmPart===1) tone(620, step * 10, { type:'sine', vol:.035, when, dest, to:290 }); // 嗚～
      if (i===16) tone(midiHz(93), step * 6, { type:'sine', vol:.02, when, dest });         // 好高嘅風聲
    } },
  // 修羅場：E 小調，快、低音每兩拍一下
  hell: { lead:[
    [76,_,76,79, 76,_,74,_, 76,_,76,79, 81,_,79,_,  76,_,76,79, 76,_,74,72, 71,_,72,_, 74,_,71,_],
    [83,_,81,_, 79,_,81,_, 83,_,86,_, 83,_,_,_,  81,_,79,_, 78,_,79,_, 76,_,_,_, 76,79,83,88]],
    bass:[40, 36, 38, 35], lw:'square', lv:.055, bw:'triangle', bv:.16, fifth:12, tempo:1.15, every:2 },
};
export function bgmPick(): BgmKey {
  const L = G && G.running && G.level && typeof LEVELS!=='undefined' && LEVELS[G.level];
  if (!L) return 'main';
  if (L.ghost || L.fest) return 'spooky';
  if (L.hell) return 'hell';
  const c = typeof lvCat==='function' ? lvCat(L) : 'main';
  return c==='era' || c==='old' ? 'old' : 'main';
}
export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export let musicG: GainNode | null = null, bgmStep = 0, bgmNext = 0, bgmPart = 0, bgmCur: BgmKey = 'main';
export function bgmTick(): void {
  // 開工畫面、裝修、收工都播（慢啲）；只係暫停先停
  healAudio(false);
  if (!AC || !soundOn || !musicOn || AC.state!=='running' || (G && G.paused)){ bgmNext = 0; return; }
  if (!musicG){ musicG = AC.createGain(); musicG.gain.value = pttVoice() ? MUSIC_GAIN * DUCK.depth : MUSIC_GAIN; musicG.connect(must(master, 'master gain')); }
  const k = bgmPick(); if (k!==bgmCur){ bgmCur = k; bgmStep = 0; bgmPart = 0; }
  // `playing` is true only while G is set, so liveG() below never throws where the JS did not.
  const T = BGM[bgmCur], playing = G && G.running, busy = playing && !liveG().tut && liveG().t > 35 && liveG().t < 135;
  const step = 60 / ((playing && liveG().fever ? 140 : busy ? 126 : playing ? 104 : 90) * T.tempo) / 2, up = playing && liveG().fever ? 2 : 0;
  if (!bgmNext || bgmNext < AC.currentTime) bgmNext = AC.currentTime + .05;
  while (bgmNext < AC.currentTime + .25){
    const i = bgmStep % 32, bar = Math.floor(i / 8), n = must(T.lead[bgmPart], 'bgm part')[i], ev = T.every || 4;
    if (n) tone(midiHz(n + up), step * 1.6, { type:T.lw, vol:T.lv, when:bgmNext, dest:musicG });
    if (i % ev===0) tone(midiHz((T.bass[bar] ?? NaN) + up + (i % 8 ? T.fifth : 0)), step * (ev===2 ? 1.6 : 3), { type:T.bw, vol:T.bv, when:bgmNext, dest:musicG });
    if (T.hat!==false && playing && i % 2===1) tone(busy ? 7000 : 6000, .02, { type:'square', vol:.012, when:bgmNext, dest:musicG });
    if (T.extra) T.extra(i, bgmNext, step, musicG);
    bgmNext += step; bgmStep++;
    if (bgmStep % 32===0) bgmPart = 1 - bgmPart;
  }
}
setInterval(bgmTick, 60);
// the music steps back under every walkie-talkie voice (own or a teammate's) and comes back after, by ramps
export const MUSIC_GAIN = .9;
onPttVoice(on => { if (AC && musicG) duckRamp(musicG.gain, AC.currentTime, on, MUSIC_GAIN); });
export function setMusic(on: boolean): void {
  musicOn = on; try { localStorage.setItem('ckf-music', on ? 'on' : 'off'); } catch { /* storage blocked */ }
  document.querySelectorAll('.musicBtn').forEach(b => { b.textContent = on ? '音樂：開' : '音樂：熄'; });
}
document.querySelectorAll('.musicBtn').forEach(b => { b.addEventListener('click', () => { setMusic(!musicOn); }); });
setMusic(musicOn);

// 提示（老闆講嘢、連擊、toast）會遮畫面：喺畫面任何位置㩒一下就收，㩒落去嗰下照樣生效（capture，唔攔住）。培訓關嘅「撳一下繼續」唔受影響
document.addEventListener('pointerdown', () => {
  if (typeof bossEl !== 'undefined' && bossEl && !bossEl.hidden && !bossEl.classList.contains('stay')) bossEl.hidden = true;
  if (comboEl && !comboEl.hidden) comboEl.hidden = true;
  const t = document.getElementById('toast'); if (t && !t.hidden) t.hidden = true;
}, true);
