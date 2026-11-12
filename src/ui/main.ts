import './xseat';   // load order: src/entry.ts
import { HOOK } from './hooks';
import { $ } from './prefs';
import { must, ownKey, cash } from '../core/util';
import { newGame, liveG, slot, D, G, station, diff, setStation, setSlot, setDiff, local } from '../core/state';
import { SLOTS, STATIONS, DIFFS } from '../core/data/menus';
import { makeGroup, careerTick, tillWarmup } from '../core/referee/customers';
import { endShift } from '../core/referee/index';
import { advance, resetClock } from '../core/referee/clock';
import { grpEls, queueEl, toast, setDrawn, paint } from './ui';
import { closePop } from './kitchen';
import { iconImg } from './icons';
import { shopStale, applyShopWhenIdle, SHOP, bankRevenue, saveShop, openDecor } from './decor';
import { comboStats } from './juice';
import { juiceTick } from '../core/referee/score';
import { careerStart, careerEnd, goalText, renderCareer } from './career';
import { LEVELS, lvGet, nextLevel, levelOpen, closestIn, dsEl, armLevel, levelLeave, levelArmed } from './levels';
import { levelRoles } from '../core/work/roles';
import { firstShiftDone, gateFree } from './gates';
import { armTut, tutStop, tutTick } from './tutorial';
import { track, trackOnce, trackLeave } from './stats';
import { smokeShow } from './smoke';
import { netBeforeStart, NET, netLeave, backToStart, netFrame, netPause, netSeat } from '../net/net';
import { showSeat } from './seat';
import { coopStep } from '../core/coop/index';
import { phone } from '../core/coop/phone';
import { floorFrame, floorReset } from './floor-jobs';
import { soloBegin, soloFrame } from './solo';
import { beginShift, renderTargetBox } from './target';
import { pressMark } from './pressure';
import { xNext, xBegin, xStop, endX, seatOptions, pickerCur, pickX } from './xseat';
import { soloSeatOn, soloShopStart } from '../core/career/xseat';
import { coopFrame } from '../core/coop/index';
import { seatFrame } from './seat';
import { isExtraKind } from '../core/referee/extras';
import { motionAsk } from '../permit/motion';

export let lastEnd: { sign: string; line: string; role: string } | null = null;   // 成績卡用
// 開工、暫停、收工、主迴圈
// TypeScript port of the original game's main.js, as an ES module: every
// top-level name is exported, none renamed.
/* ===================== 開工、暫停、收工 ===================== */
/** $(id) as a button, where the JS set `.disabled` on it. */
export const btnById = (id: string): HTMLButtonElement => { const b = $(id); return must(b instanceof HTMLButtonElement ? b : null, id); };
/** $(id) as an input, where the JS read or set `.value` on it. */
export const inputById = (id: string): HTMLInputElement => { const i = $(id); return must(i instanceof HTMLInputElement ? i : null, id); };
/**
 * Will the shift about to start have 傳菜? Its seat (a solo 傳菜 shift or lesson), or the level's 傳菜
 * role (the 樓面's 「傳」 bubble), or a room's 加位 傳菜.
 */
export function shiftHasRunner(): boolean {
  const L = levelArmed ? lvGet(levelArmed) : null;
  return xNext()==='runner' || levelRoles(L).includes('runner') || (!!NET.role && (NET.meta?.extra ?? []).includes('runner'));
}
export function start(): void {
  // 傳菜's tilt needs the motion sensors. Asked here, inside the tap that starts the shift, level or
  // lesson (iOS asks only from a gesture), before anything can open 傳菜: never mid-play from the 「傳」 bubble or the job
  // bar. A room's owner asks with this tap too (before netBeforeStart hands the start to the room). No guide: the finger
  // still plays.
  if (shiftHasRunner()) void motionAsk(false);
  if (typeof netBeforeStart==='function' && !netBeforeStart()) return;
  xStop(); const xk = xNext();   // solo at a new seat: decided before the shift is made
  document.body.classList.remove('fever', 'feverPeak', 'blackout');
  if (shopStale) applyShopWhenIdle();   // a save that arrived during the last shift
  newGame(); careerStart();
  const S = liveG();
  if (!S.tut && typeof track==='function'){ track('shift_' + S.station); if (S.level){ track('lvs_' + S.level); trackOnce('lv_start'); } else trackOnce('shop_start'); }
  must($('clockLbl'), 'clockLbl').textContent = SLOTS[slot].name; grpEls.forEach(el => { el.remove(); }); grpEls.clear(); must(queueEl, 'queue').innerHTML = ''; must($('fx'), 'fx').innerHTML = '';
  ['startView','endView','pauseView'].forEach(id => { must($(id), id).hidden = true; });
  tillWarmup();
  floorReset();   // no job page or job bar left from the last shift
  showStation(S.station);
  showSeat(netSeat(), NET.id);   // an extra seat in a room; '' hides the seat view
  if (xk) xBegin(xk);
  else if (!NET.role) soloShopStart(performance.now(), S.station==='waiter' ? 'floor' : 'shop');   // 樓面 on a floor level plays the floor; any seat there runs it   // a level's own extra stations run, the computer at each
  if (S.station==='bar' && !netSeat() && !xk) toast('開舖前，撳左邊個茶膽煲茶');
  soloBegin();
  HOOK.closeSheet(); HOOK.closeBoard(); closePop(); setDrawn(0); last = performance.now(); resetClock();
}
/** Shows station `st`'s screen and HUD labels (at the start of a shift, and when a solo mode switches station). */
export function showStation(st: string): void {
  const till = st==='till', bar = st==='bar', kit = st==='kitchen';
  must($('floorWrap'), 'floorWrap').hidden = must($('doorWrap'), 'doorWrap').hidden = till || bar || kit; must($('till'), 'till').hidden = must($('pad'), 'pad').hidden = !till; must($('barView'), 'barView').hidden = must($('barPad'), 'barPad').hidden = !bar; must($('kitView'), 'kitView').hidden = must($('kitPad'), 'kitPad').hidden = !kit;
  must($('misLbl'), 'misLbl').textContent = till ? '計錯' : bar ? '沖錯' : kit ? '整錯' : '落錯單';
  must($('angLbl'), 'angLbl').textContent = till ? '走數' : '嬲走';
}
export function endGame(): void { endShift(); }
/**
 * A party night's round ends on the night's own end card (net.ts): the hook shows it and says so. No
 * initialiser on purpose: net.ts sets it at load, and in the bundle net.ts runs before this module (they import each
 * other), so `= null` here would wipe it.
 */
let endHook: (() => boolean) | undefined;
export function setEndHook(f: (() => boolean) | undefined): void { endHook = f; }
/** The end card ('end' from core's endShift, src/ui/wire.ts). */
export function endCard(): void {
  const S = liveG();
  if (endHook && endHook()) return;
  if (S.solo){ endSolo(); return; }
  if (S.xseat){ endX(); return; }
  if (S.station==='till'){ endTill(); return; }
  if (S.station==='bar'){ endBar(); return; }
  if (S.station==='kitchen'){ endKitchen(); return; }
  const served = S.served + S.groups.filter(g => g.state==='eat' || g.state==='wait').length;
  must($('result'), 'result').innerHTML = `
    <div><span>營業額</span><b>${cash(S.revenue)}</b></div>
    <div><span>招呼咗</span><b>${served} 枱</b></div>
    <div><span>落錯單</span><b>${S.mistakes}</b></div>
    <div><span>嬲走</span><b>${S.angry}</b></div>`;
  let line, sign;
  if (S.angry===0 && S.mistakes===0){ sign = '頂呱呱'; line = '阿姐都要讚你。聽日加人工？講吓笑啫。'; }
  else if (S.angry <= 2 && S.mistakes <= 2){ sign = '唔錯'; line = '幾好，聽日照返工。手腳再快少少就得。'; }
  else if (S.mistakes > S.angry){ sign = '眼大睇過龍'; line = '你今日落錯咁多單，水吧同收銀都想打你。'; }
  else { sign = '手腳慢'; line = '啲客唔等人㗎！企喺門口等到嬲走晒。'; }
  if (S.errLog && S.errLog.length) must($('result'), 'result').insertAdjacentHTML('beforeend', `<details class="errs" open><summary>睇返邊幾張單落錯（${S.errLog.length}）</summary>${S.errLog.map(e => `<p><b>${e.tb}</b>\u3000客人講：${e.said}<br>你寫咗：${e.wrote.join('、') || '（冇）'}<br>應該係：${e.want.join('、')}</p>`).join('')}</details>`);
  if (S.regHit) line += ` 熟客話你記性好，${S.regHit} 次照舊都冇錯。`;
  else if (S.regMiss) line += ' 熟客講照舊你都記唔到，佢哋好失望。';
  showEnd(sign, line, '伙記');
}
/** 輪流做 / 一腳踢: the whole shop's numbers (the player worked every station). */
export function endSolo(): void {
  const S = liveG(), name = S.solo==='rotate' ? '輪流做' : '一腳踢';
  must($('result'), 'result').innerHTML = `
    <div><span>營業額</span><b>${cash(S.revenue)}</b></div>
    <div><span>招呼咗</span><b>${S.served} 枱</b></div>
    <div><span>出錯</span><b>${S.mistakes}</b></div>
    <div><span>嬲走</span><b>${S.angry}</b></div>`;
  let sign, line;
  if (S.angry===0 && S.mistakes===0){ sign = '一腳踢王'; line = '成間舖你一個人睇晒，一個錯都冇。阿姐都話要拜你為師。'; }
  else if (S.angry <= 2 && S.mistakes <= 2){ sign = '周身刀'; line = '四個位都識做，周身刀，張張利。'; }
  else if (S.mistakes > S.angry){ sign = '手忙腳亂'; line = '轉位轉到頭都暈，錯咗幾張單。慢慢嚟，熟咗就得。'; }
  else { sign = '分身不暇'; line = '一個人點顧得晒？唔緊要，睇吓邊個位最多嘢做先去嗰度。'; }
  showEnd(sign, line, name);
}
export function endKitchen(): void {
  const S = liveG();
  must($('result'), 'result').innerHTML = `
    <div><span>營業額</span><b>${cash(S.revenue)}</b></div>
    <div><span>出咗</span><b>${S.dishes} 碟</b></div>
    <div><span>整錯</span><b>${S.mistakes}</b></div>
    <div><span>嬲走</span><b>${S.angry}</b></div>`;
  let line, sign;
  if (S.mistakes===0 && S.angry===0){ sign = '鑊氣十足'; line = '碟碟都啱，老闆話要同你加人工。講吓笑啫。'; }
  else if (S.angry > S.mistakes){ sign = '火候慢'; line = `啲客等食等到嬲，${S.angry} 枱走咗。幾個煲同時開，唔好一樣一樣嚟。`; }
  else if (S.mistakes > 2){ sign = '亂咁整'; line = '漏蔥、漏飯、多士冇烘底，客人退晒返嚟。睇清張飛先出餐。'; }
  else { sign = '唔錯'; line = '有少少錯，但係出得切餐。聽日再嚟。'; }
  showEnd(sign, line, '廚房');
}
export function endBar(): void {
  const S = liveG();
  must($('result'), 'result').innerHTML = `
    <div><span>營業額</span><b>${cash(S.revenue)}</b></div>
    <div><span>沖咗</span><b>${S.cups} 杯</b></div>
    <div><span>沖錯</span><b>${S.mistakes}</b></div>
    <div><span>嬲走</span><b>${S.angry}</b></div>`;
  let line, sign;
  if (S.mistakes===0 && S.angry===0){ sign = '絲襪王'; line = '杯杯都啱，老闆話你可以去參加奶茶比賽。'; }
  else if (S.angry > S.mistakes){ sign = '手腳慢'; line = `啲客等嘢飲等到嬲，${S.angry} 枱走咗。記住趁閒煲定茶。`; }
  else if (S.mistakes > 2){ sign = '亂咁沖'; line = '凍熱調轉、走冰落冰，客人飲到一頭霧水。睇清張飛先沖。'; }
  else { sign = '唔錯'; line = '有少少錯，但係趕得切。聽日再嚟。'; }
  showEnd(sign, line, '水吧');
}
export function endTill(): void {
  const S = liveG();
  must($('result'), 'result').innerHTML = `
    <div><span>營業額</span><b>${cash(S.revenue)}</b></div>
    <div><span>埋咗單</span><b>${S.paidCount} 枱</b></div>
    <div><span>計錯</span><b>${S.mistakes}</b></div>
    <div><span>蝕咗</span><b>${cash(S.loss)}</b></div>`;
  let line, sign;
  if (S.mistakes===0 && S.angry===0){ sign = '數口精'; line = '一個錯都冇，老闆話你可以坐收銀坐到退休。'; }
  else if (S.loss > 100){ sign = '蝕本貨'; line = `今日蝕咗 ${cash(S.loss)}，老闆話要喺你人工度扣。講吓笑啫……應該。`; }
  else if (S.angry > S.mistakes){ sign = '手腳慢'; line = `條隊排到出門口，${S.angry} 枱客等唔切走數。`; }
  else { sign = '計數要準'; line = '快係好，但係計錯數老闆會心痛。聽日再嚟。'; }
  showEnd(sign, line, '收銀');
}
export function showEnd(sign: string, line: string, role: string): void {
  const S = liveG();
  lastEnd = { sign, line, role };
  must($('endSign'), 'endSign').textContent = sign;
  must($('endKick'), 'endKick').textContent = `第 ${SHOP.day} 日 · ${((S.level && LEVELS[S.level] && LEVELS[S.level]?.clock) || SLOTS[S.slot]).endTxt} · ${role} · ${D().name}`;
  must($('boss'), 'boss').innerHTML = `<small>老闆講</small>${line}`;
  pressMark(); careerEnd(); comboStats(); bankRevenue();
  // 一日：早市 → 午市 → 晚市 → 收舖
  const nx = NEXT_SLOT[S.slot];
  must($('nextBtn'), 'nextBtn').textContent = nx ? `做埋${SLOTS[nx].name}` : '收舖，聽日早市';
  must($('againBtn'), 'againBtn').textContent = `再做一次${SLOTS[S.slot].name}`;
  btnById('nextBtn').disabled = btnById('againBtn').disabled = NET.role==='client';
  if (NET.role==='client'){ must($('nextBtn'), 'nextBtn').textContent = '等老闆開下一更'; must($('againBtn'), 'againBtn').textContent = '（老闆決定）'; }
  else if (S.tut){ must($('nextBtn'), 'nextBtn').textContent = firstShiftDone() ? '正式開工' : `第一關：${lvGet('estate').name}`; must($('againBtn'), 'againBtn').textContent = '再學一次'; }
  else if (S.level){ const nl = nextLevel(S.level); must($('nextBtn'), 'nextBtn').textContent = nl && levelOpen(nl) ? `下一關：${lvGet(nl).name}` : '再挑戰呢關'; must($('againBtn'), 'againBtn').textContent = '再玩呢關'; }
  else if (!nx && !S.coop) must($('result'), 'result').insertAdjacentHTML('beforeend', `<div class="wide"><span>第 ${SHOP.day} 日全日營業額</span><b>${cash(SHOP.dayRev)}</b></div>`);
  must($('endView'), 'endView').hidden = false; must($('nextBtn'), 'nextBtn').focus();
}
export function setPause(on: boolean): void {
  if (!G || !G.running) return;
  G.paused = on; if (G.coop) netPause(on); must($('pauseView'), 'pauseView').hidden = !on; must($('pauseGoal'), 'pauseGoal').textContent = `${G.daily ? '每日挑戰' : '老闆目標'}：${goalText()}`; if (on){ HOOK.closeSheet(); HOOK.closeBoard(); smokeShow(); }
  last = performance.now();
}
// ico(k) = 掣上面嘅細圖（位同市先有）
export function seg(id: string, list: Record<string, { name: string; desc?: string | undefined }>, cur: string, attr: string, ico?: (k: string) => string): void {
  must($(id), id).innerHTML = Object.entries(list).map(([k, d]) =>
    `<button type="button" data-${attr}="${k}" aria-pressed="${String(k===cur)}">${ico ? ico(k) : ''}<b>${d.name}</b><span>${String(d.desc)}</span>${attr==='st' ? '<small class="mt"></small>' : ''}</button>`).join('');
}
export const SLOT_TOK: Record<string, string> = { breakfast:'多士', lunch:'通粉', dinner:'番茄牛肉飯' };
export const ST_ICO = (k: string): string => iconImg('ui', k), SLOT_ICO = (k: string): string => iconImg('tok', String(SLOT_TOK[k]));
export const ST_SHORT: Record<string, string> = { waiter:'帶位落單', kitchen:'煲麵煎蛋', bar:'沖奶茶', till:'計數找錢' };
export const ST_LIST = (): Record<string, { name: string; desc: string | undefined }> => Object.fromEntries(Object.entries(STATIONS).map(([k, d]) => [k, { ...d, desc: ST_SHORT[k] }]));
export const SLOT_SHORT: Record<string, string> = { breakfast:'常餐 A B C', lunch:'粉麵、搭枱', dinner:'碟頭飯、走青' };
export function buildMenus(): void {
  if (shopStale) applyShopWhenIdle();   // home screen: a save that arrived during a shift or while decorating
  seg('stSeg', seatOptions(ST_LIST()), pickerCur(station), 'st', ST_ICO);
  seg('slotSeg', Object.fromEntries(Object.entries(SLOTS).map(([k, d]) => [k, { ...d, desc: SLOT_SHORT[k] }])), slot, 's', SLOT_ICO);
  seg('diffSeg', DIFFS, diff, 'd');
  renderCareer(); renderTargetBox();
  if (typeof renderShopName==='function') renderShopName();
}
export function saveSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* storage full or blocked */ } }
// The segment buttons are built by seg() from STATIONS / SLOTS, so their data-st / data-s is always a valid key.
must($('stSeg'), 'stSeg').addEventListener('click', e => { const b = closestIn(e.target, 'button'); if (!b) return; const v = b.dataset.st ?? null; if (isExtraKind(v)) pickX(v); else if (ownKey(STATIONS, v)){ setStation(v); pickX(''); } saveSet('ckf-station', station); buildMenus(); });
must($('slotSeg'), 'slotSeg').addEventListener('click', e => { const b = closestIn(e.target, 'button'); if (!b) return; const v = b.dataset.s ?? null; if (ownKey(SLOTS, v)) setSlot(v); saveSet('ckf-slot', slot); buildMenus(); });
must($('diffSeg'), 'diffSeg').addEventListener('click', e => { const b = closestIn(e.target, 'button'); if (!b) return; setDiff(String(b.dataset.d)); saveSet('ckf-diff', diff); buildMenus(); });
buildMenus();
must($('startBtn'), 'startBtn').onclick = beginShift;   // the goal card first, then start()
// 主畫面兩步：先揀玩法，「自己間舖」先揀位、市、級數
export const homeStep = (s: string): void => { dsEl(must(document.querySelector('.home'), '.home')).dataset.step = s; must($('startView'), 'startView').scrollTop = 0; };
must($('shopBtn'), 'shopBtn').onclick = () => { homeStep('shop'); };
must($('homeBack'), 'homeBack').onclick = () => { homeStep('mode'); gateFree(); };
// 間舖個名：預設「我的茶餐廳」，玩家可以改（最多十個字）
export function shopName(): string { return (SHOP.name || '').trim() || '我的茶餐廳'; }
export function renderShopName(): void { must($('shopName'), 'shopName').textContent = must($('shopName2'), 'shopName2').textContent = shopName(); }
must($('shopRename'), 'shopRename').onclick = () => { const f = must($('shopForm'), 'shopForm'); f.hidden = !f.hidden; if (!f.hidden){ inputById('shopIn').value = SHOP.name || ''; inputById('shopIn').focus(); } };
must($('shopForm'), 'shopForm').onsubmit = e => { e.preventDefault(); SHOP.name = inputById('shopIn').value.trim().slice(0, 10); saveShop(); must($('shopForm'), 'shopForm').hidden = true; renderShopName(); toast(`間舖而家叫「${shopName()}」`); };
renderShopName();
must($('decorBtn'), 'decorBtn').onclick = () => { openDecor(); };
must($('estateBtn'), 'estateBtn').onclick = () => { openDecor('grow'); };
must($('endDecorBtn'), 'endDecorBtn').onclick = openDecor;
must($('homeBtn'), 'homeBtn').onclick = () => { xStop(); showSeat(''); if (NET.role) netLeave(); if (typeof backToStart==='function') backToStart(); gateFree(); renderCareer(); };
must($('againBtn'), 'againBtn').onclick = () => { if (G && G.tut){ armTut(); start(); return; } if (G && G.level){ armLevel(G.level); start(); return; } beginShift(); };
export const NEXT_SLOT: Record<Slot, Slot | null> = { breakfast:'lunch', lunch:'dinner', dinner:null };
must($('nextBtn'), 'nextBtn').onclick = () => {
  if (G && G.tut){ if (!firstShiftDone()) armLevel('estate'); start(); return; }
  if (G && G.level){ const nl = nextLevel(G.level), go = nl && levelOpen(nl) ? nl : G.level; if (NET.role==='host') NET.level = go; armLevel(go); start(); return; }
  const nx = NEXT_SLOT[slot];
  if (nx) setSlot(nx); else { setSlot('breakfast'); SHOP.day++; SHOP.dayRev = 0; saveShop(); }
  saveSet('ckf-slot', slot); buildMenus(); beginShift();
};
must($('pauseBtn'), 'pauseBtn').onclick = () => { HOOK.setPause(true); };
must($('resumeBtn'), 'resumeBtn').onclick = () => { HOOK.setPause(false); };
must($('quitBtn'), 'quitBtn').onclick = () => { if (typeof trackLeave==='function') trackLeave('pause'); liveG().running = false; xStop(); showSeat(''); document.body.classList.remove('fever', 'feverPeak', 'blackout'); if (NET.role) netLeave(); tutStop(); levelLeave(); buildMenus(); must($('pauseView'), 'pauseView').hidden = true; must($('startView'), 'startView').hidden = false; };
addEventListener('keydown', e => {
  if (e.key==='Escape' && G && G.board){ HOOK.closeBoard(); return; }
  if (e.key==='Escape' && G && G.sheet){ HOOK.closeSheet(); return; }
  if (!G || !local('till') || !G.running || G.paused || G.board) return;
  if ((/^\d$/.test(e.key) || e.key==='+') && G.step==='total'){ e.preventDefault(); HOOK.tillKey(e.key); }
  else if (e.key==='=' && G.step==='total'){ e.preventDefault(); HOOK.tillKey('ok'); }
  else if (e.key==='Backspace'){ e.preventDefault(); HOOK.tillKey('back'); }
  else if (e.key==='Enter'){ e.preventDefault(); HOOK.tillKey('ok'); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && G && G.running && !G.paused && !G.coop) HOOK.setPause(true); });

export let last = performance.now();
export function setLast(v: typeof last): void { last = v; }
// One fixed step of the shift (core/referee/clock.ts): solo plays the rules, slowed while a slip or the board is open; in a
// room every phone (the owner's too) plays its own station and runs the clock at the room referee's pace.
export function shiftStep(h: number): void {
  const S = liveG();
  if (NET.role && phone()){ const P = phone(); coopStep(h * (S.sheet ? Math.max(.5, D().slow) : P ? P.scale : 1)); return; }   // 組隊：做自己個位，個鐘跟間房
  // solo at a new seat: the referee's step and the seat's station; at one of the four on a level with roles
  // (soloShopStart) the same, slowed like solo while a slip or the board is open
  if (soloSeatOn()){ coopStep(h * (!S.xseat && (S.sheet || S.board) ? D().slow : 1)); careerTick(); return; }
  HOOK.update(h * (S.sheet || S.board ? (S.coop ? Math.max(.5, D().slow) : D().slow) : 1));
  careerTick();
}
export const shiftGoes = (): boolean => !!G && G.running && !G.paused;
export function loop(now: number): void {
  // 啱啱開工：rAF 個時間可以早過 start() 記低嘅 last，唔好俾個鐘倒行
  const dt = Math.max(0, (now - last) / 1000); last = now;
  if (G){
    advance(dt, shiftStep, shiftGoes);
    netFrame(performance.now());   // link timers run on the wall clock (the frame time may be scaled: tests' Bot.scale)
    if (soloSeatOn()){ coopFrame(performance.now()); seatFrame(); floorFrame(); }   // solo seat: its referee closes the books
    else if (!NET.role) floorFrame();   // off the floor (a shift left mid-job) its job page and bar go at once
    if (NET.role!=='client') tutTick();
    soloFrame();
    juiceTick();
    paint();
  }
  requestAnimationFrame(loop);
}
// 開工前喺背景擺個樣板午市，等標題後面有嘢睇
export function showBackdrop(): void {
  newGame(); const S = liveG(); S.running = false; S.roles = { waiter:'me', till:'ai' };
  ([[0,'think'],[1,'order'],[4,'eat']] as const).forEach(([tid, st]) => { let g = makeGroup(); while (g.size > must(S.tables[tid], 'table ' + String(tid)).cap) g = makeGroup(); g.state = st; g.table = tid; S.groups.push(g); });
  must(S.tables[2], 'table 2').dirty = 2; S.groups.push(makeGroup(), makeGroup());
}
showBackdrop();
requestAnimationFrame(loop);
