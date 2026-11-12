// 一個人做新位：傳菜、洗碗、燒味、外賣 一個人都玩得。揀咗新位，四個舊位全部電腦做，你淨係做嗰個位；
// 員工培訓每個新位一課（三個固定嘅客、冇時限、第一次學識有利是），學識咗先揀得嗰個位做關卡或者自己間舖（一個位）。
// The rules are core's (core/career/xseat.ts: a referee of one with no room); the seat's screen is the station's own page
// in the seat view (ui/seat.ts), exactly as in co-op. This module keeps the player's pick, starts and stops the solo
// seat around a shift, runs the extra stations' training lessons (hint line and set customers) and draws the end card.
import './target';   // load order: src/entry.ts
import { must, cash } from '../core/util';
import { liveG, bump } from '../core/state';
import { floorJob } from '../core/coop/plugins/floor';
import { mapNow, mapLook } from './floor-map';
import { DELIVER_COLD_S } from '../core/work/floor';
import type { FloorLesson } from '../core/work/roles';
import { $ } from './prefs';
import { SHOP } from './decor';
import { toast } from './ui';
import { SEAT_NAMES, showSeat, seatIdNow, homeSeat, seatLabel } from './seat';
import { isExtraKind, addWalkIn, addPack } from '../core/referee/extras';
import { soloSeatStart, soloSeatOn, SOLO_ME } from '../core/career/xseat';
import { refStop, setDriver } from '../core/coop/referee';
import { itemsOf } from '../core/rules/price';
import { runnerState } from '../core/coop/plugins/runner';
import { roastState } from '../core/coop/plugins/roast';
import { takeawayState } from '../core/coop/plugins/takeaway';
import { available } from '../stations-next/runner/core';
import { MEAT, BASE, boardDone } from '../stations-next/roast/core';
import { HOOK } from './hooks';
import { ptMove } from '../core/playtest/hook';
import { NET } from '../net/net';
import { tutArmed, tutX, TUT_GROUPS, tutGroup } from './tutorial';
import { dailyArmed, dailyChallenge, roleOpenNow, ptAllRolesOn } from './career';
import { levelArmed, lvGet } from './levels';
import { seatsOffered } from '../core/career/seats';
import { levelRoles, isFloorTask } from '../core/work/roles';
import { showEnd, endGame, saveSet, showStation } from './main';
import { applyView } from './floor-iso';
import { iconImg } from './icons';
import { ownTakeSeat, measureName, measureTxt, shiftMeasure } from '../core/career/targets';
import { runnerControl } from '../permit/motion';

/** What each new seat does, under its name on the pickers. */
export const X_SHORT: Readonly<Record<ExtraKind, string>> = { runner: '碌托盤上菜', roast: '斬料上碟', takeaway: '執袋綁袋' };

/** The new seats open once their training is done (員工培訓). */
export const xTrained = (k: ExtraKind): boolean => ptAllRolesOn() || !!(SHOP.tutDone || {})[k];   // preview: no lesson needed
let soloX: ExtraKind | '' = '';
// an old save's 傳菜 / 外賣 pick is dropped: those are 樓面's tasks, not seats
try { const v = localStorage.getItem('ckf-xseat'); if (isExtraKind(v) && !isFloorTask(v)) soloX = v; } catch { /* storage blocked */ }
/** The extra seat picked for levels and the own shop ('' = one of the four), only once it is trained. */
export const pickedX = (): ExtraKind | '' => soloX && xTrained(soloX) ? soloX : '';
/** Picks an extra seat ('' = back to the shop's four). A seat not trained yet is refused with a toast. */
export function pickX(k: ExtraKind | ''): boolean {
  if (k && (!roleOpenNow(k) || isFloorTask(k))) return false;   // not reached on the ladder yet, or a 樓面 task: never offered, so never picked
  if (k && !xTrained(k)){ toast(`未學識${SEAT_NAMES[k]}：先去「員工培訓」學咗先`); return false; }
  soloX = k; saveSet('ckf-xseat', k); return true;
}
/**
 * The picker list: the four stations, then the new seats this player has reached on the main ladder (a role not
 * reached yet is not shown at all; one reached but not learned shows a lock). Levels without the picked seat's station
 * are played at the shop's station (xNext; the level list says so).
 */
export function seatOptions(base: Record<string, { name: string; desc: string | undefined }>): Record<string, { name: string; desc: string | undefined }> {
  // roles only: 伙記's seat is 樓面, whose tasks include 傳菜 and 外賣 (not offered as seats)
  const out: Record<string, { name: string; desc: string | undefined }> = { ...base }, w = base.waiter;
  if (w) out.waiter = { ...w, name: '樓面' };
  for (const k of seatsOffered(null, roleOpenNow)) out[k] = { name: SEAT_NAMES[k], desc: xTrained(k) ? X_SHORT[k] : '🔒 先培訓' };
  return out;
}
/** Which button the picker shows pressed. */
export const pickerCur = (station: string): string => pickedX() || station;

/**
 * At the top of start(), before the shift is made: the extra seat this shift is played at, or ''. The training lesson
 * armed for one; else a level or the own shop (always one seat) with an extra seat picked. Never in a room or the daily
 * challenge (everyone plays the same customers there at the shop's four).
 */
export function xNext(): ExtraKind | '' {
  if (NET.role) return '';
  if (tutArmed) return tutX;
  if (dailyArmed){ const s = dailyChallenge().station; return isExtraKind(s) ? s : ''; }   // the day's seat
  // a level is played at the picked seat only where the level has that station; else at the shop's station
  const px = pickedX(), L = levelArmed ? lvGet(levelArmed) : null;
  return px && (!L || levelRoles(L).includes(px)) ? px : '';
}
/** After the shift is made (start()): this phone runs the solo seat. */
export function xBegin(k: ExtraKind): void {
  const S = liveG();
  soloSeatStart(k, performance.now());
  showSeat(k, SOLO_ME);
  must($('misLbl'), 'misLbl').textContent = '出錯'; must($('angLbl'), 'angLbl').textContent = '嬲走';
  // training: only the lesson's set customers (no walk-ins, no takeaway orders of the shop's own)
  if (S.tut){ S.nextRoast = Infinity; S.nextPack = Infinity; S.tutNext = 0; S.tutAt = 1.5; }
}
/**
 * The strip's 換做 / 返做 on a phone that is its own referee (a solo seat shift, or a level's stations around a
 * shop station). It used to draw the buttons and do nothing (only the room's owner had a handler). The old seat goes to
 * the computer, the new one is the player's; both stations' state is this phone's own G, so the new seat's screen shows
 * the shop as it is (seated tables, slips waiting, the pass). The shift keeps its target and scoring seat (S.xseat).
 * Not in a lesson: a lesson teaches one seat.
 */
export function soloSwitch(k: ExtraKind | ''): void {
  const S = liveG();
  if (!soloSeatOn() || !S.running || S.tut) return;
  const from = seatIdNow(), to = k || homeSeat();
  if (!to || to === from || Reflect.get(S.roles, to) !== 'ai') return;
  ptMove();   // the timing log notes the old seat first
  if (from) setDriver(from, { type: 'computer' }, 'release');
  setDriver(to, { type: 'player', player: SOLO_ME }, 'claim');
  if (!k){ showStation(S.station); applyView(); }
  showSeat(k, SOLO_ME);
  toast(`你而家做${seatLabel(to)}`);
}
/** Before a new shift, and when the player leaves one: this phone is no longer a solo referee. */
export function xStop(): void { if (soloSeatOn()) refStop(); }

/* ===================== 培訓：新位 ===================== */
// 燒味：三碟由淺入深（叉燒 → 燒鴨 → 湯粉），斬料係沿虛線斬；外賣：同舊位培訓一樣嘅三枱客，變外賣單；洗碗：三枱客嘅碗碟
export const TUT_ROAST = ['叉燒飯', '燒鴨飯', '叉燒瀨粉'];
/** How far the lesson is: [done, of, unit]. */
export function xTutDone(S: GameState): [number, number, string] {
  return [S.served, 3, S.xseat === 'runner' ? '枱客' : S.xseat === 'roast' ? '碟' : '袋'];
}
/** The lesson's set customers: one at a time (the runner: at most two tables, as the shop's own lesson). */
function xTutSpawn(S: GameState): void {
  const n = S.tutNext ?? 0, k = S.xseat;
  if (S.phase !== 'open' || S.t < (S.tutAt ?? 0)) return;
  if (k === 'runner'){
    if (n >= TUT_GROUPS.length){ if (S.nextSpawn === Infinity) S.nextSpawn = S.t + 6; return; }   // someone left: the shop's own flow
    if (S.groups.length + S.payQ.length + (S.cur ? 1 : 0) >= 2) return;
    HOOK.enqueue(tutGroup(n));
  } else if (k === 'roast'){
    if (S.groups.some(g => g.via === 'roast')) return;
    addWalkIn(TUT_ROAST[n % TUT_ROAST.length] ?? '叉燒飯');
  } else if (k === 'takeaway'){
    if (S.groups.some(g => g.via === 'pack')) return;
    addPack(itemsOf(must(TUT_GROUPS[n % TUT_GROUPS.length], 'lesson order').persons));
  } else return;
  S.tutNext = n + 1; S.tutAt = S.t + 3;
}
/** The yellow hint line: the next step at that seat, read from the station's state. */
export function xTutLine(S: GameState): string {
  const k = S.xseat;
  if (k === 'runner'){
    const s = runnerState();
    if (!s) return '等緊客人入嚟……';
    if (s.st === 'pick') return available(s) ? '① 出餐口有嘢：撳 1、2 或 3，揀今轉拎幾多張枱嘅嘢。' : '等廚房同水吧出餐，整好就會擺上出餐口。';
    if (s.st === 'ready') return runnerControl() === 'tilt' ? '② 準備好：斜部電話開始碌（斜向邊就碌去邊）。' : '② 準備好：手指喺地下撳住拖開始碌（拖去邊就碌去邊）。';
    if (s.st === 'play') return '③ 碌去閃黃燈嗰張枱，慢慢碌入枱前面個洞就上咗菜。紅點 = 太快，撞嘢會扣體力。';
    if (s.st === 'crash') return '撞暈咗：等陣由出餐口重新嚟過，慢慢碌。';
    return '上咗菜！返出餐口拎下一轉。';
  }
  if (k === 'roast'){
    const s = roastState(), c = s?.q[0];
    if (!s || !c) return '等斬料客嚟……';
    const o = c.ord, P = s.plate, need = o.meats.filter(m => P.items.filter(i => i.k === m).length < o.meats.filter(x => x === m).length);
    if (!P.base) return `① 張飛要「${o.name}」：撳${BASE[o.base].name}揀底（白飯用碟，粉用碗）。`;
    if (BASE[o.base].soup && P.soup < 1) return '② 湯粉：由湯煲拖一殼湯落碗，再撳蔥花。';
    if (s.board) {
      const b = s.board, nm = MEAT[b.k].name;
      if (boardDone(s, b)) return `④ 斬好喇：將斬好嗰 ${String(b.cuts.length)} 件拖去碟／碗（「剩」嗰截自己掛返）。`;
      if (b.k === 'char') return `④ 叉燒：砧板上 1 至 ${String(b.n)} 每條虛線，手指由上面沿住條線𠝹落去，一條一刀 = ${String(b.n)} 件。`;
      return `④ ${nm}：數字 1 至 ${String(b.n)} 就係落刀位，每條虛線（骨位）撳一下斬一刀 = ${String(b.n)} 件；斬歪咗骨會碎。`;
    }
    const m = need[0];
    if (m) return `③ 將${MEAT[m].name}由鐵通拖落砧板。`;
    if (o.base === 'rice' && P.soy <= 0) return '⑤ 白飯：撳住豉油樽，淋到綠色格就放手。';
    if (o.ginger && !P.ginger) return '⑤ 張飛有寫薑葱：撳薑葱加落去。';
    if (o.veg && !P.veg) return '⑤ 張飛有寫油菜：撳油菜加落去。';
    return '⑥ 喺碟／碗向上掃出餐（向下掃 = 倒咗重做）。';
  }
  if (k === 'takeaway'){
    const s = takeawayState();
    if (!s || !s.orders.some(o => !o.done)) return '等外賣單……';
    if (s.phase === 'tie') return '② 綁袋：由「起」嗰點撳住，跟住條虛線畫，發光嗰段係下一段。';
    if (s.phase === 'hand' || s.phase === 'fx') return '③ 將個袋拖俾門口啱號碼嗰位。';
    return '① 照單執：櫃面啲嘢整好就睇清楚貼紙號碼拖入袋（飯盒落底、飲品擺面），再撳下面啲盤加餐具、紙巾、飲管，數到啱會變灰。';
  }
  return '';
}
/** Every frame of a training lesson at an extra seat (tutorial.ts tutTick hands it over): hint, customers, the end. */
export function xTutTick(S: GameState, el: HTMLElement): void {
  const [done, of, unit] = xTutDone(S);
  const txt = `${xTutLine(S)}<small>教學 · ${String(Math.min(done, of))}/${String(of)} ${unit}</small>`;
  if (el.innerHTML !== txt) el.innerHTML = txt;
  el.hidden = false;
  if (done >= of){ endGame(); return; }
  xTutSpawn(S);
}

/* ===================== 培訓：樓面工作 ===================== */
// 執枱同送外賣各自一課：樓面得你一個（冇電腦幫手），冇客人入嚟；執枱 = 三張污糟枱一張一張嚟，送外賣 = 門口先有兩袋（一轉送晒），再一袋
export const FLOOR_NAMES: Readonly<Record<FloorLesson, string>> = { clear: '執枱', deliver: '送外賣' };
export const F_SHORT: Readonly<Record<FloorLesson, string>> = { clear: '數住收碟碗杯', deliver: '踩單車送上門' };
const F_TUT_N = 3;
/** The lesson's dirty tables, in the map's first view at 390x666 (the top row's bubbles sit under the HUD). */
const F_TUT_TABLES = [1, 3, 4];
/** How far a 樓面 lesson is: [done, of, unit]. */
export function fTutDone(S: GameState): [number, number, string] {
  if (S.tutF === 'deliver') return [S.floor?.stats.drops ?? 0, F_TUT_N, '袋'];
  return [Math.max(0, (S.tutNext ?? 0) - S.tables.filter(t => t.dirty > 0).length), F_TUT_N, '張枱'];
}
/** The lesson's set work: one dirty table at a time; or two bags at the door (one run takes both), then one more. */
function fTutSpawn(S: GameState): void {
  const n = S.tutNext ?? 0, F = S.floor;
  if (!F || S.phase !== 'open' || S.t < (S.tutAt ?? 0) || n >= F_TUT_N) return;
  if (S.tutF === 'clear'){
    if (S.tables.some(t => t.dirty > 0)) return;
    const tb = S.tables[(F_TUT_TABLES[n] ?? n) % S.tables.length]; if (!tb) return;
    tb.dirty = 2 + n; S.tutNext = n + 1;
  } else {
    if (F.out.length || Object.keys(F.away).length) return;
    const k = n === 0 ? 2 : 1;
    for (let i = 0; i < k; i++) F.out.push({ gid: 900 + n + i, no: 31 + n + i, cold: S.t + DELIVER_COLD_S * 2, items: 2, rider: null });
    S.tutNext = n + k;
    // the rider exit is on the pavement past the entrance, outside the map's first view: look there
    const sp = mapNow()?.spots.find(x => x.kind === 'deliver'); if (sp) mapLook(sp.u, sp.v);
  }
  S.tutAt = S.t + 2; bump();
}
/** The yellow hint line of a 樓面 lesson, read from the floor and the job this phone is on. */
export function fTutLine(S: GameState): string {
  const j = floorJob();
  if (S.tutF === 'clear'){
    if (j?.game === 'clear') return '② 數清楚枱面有幾多隻碟、碗、杯，撳下面「碟／碗／杯」一下收走一隻。撳多咗（嗰樣已經冇）成張枱會打回頭，慢慢數。';
    return S.tables.some(t => t.dirty > 0) ? '① 客走咗留低碗碟：撳嗰張枱頭頂個「執」。' : '等下一張枱……';
  }
  if (j?.game === 'deliver') return '② 撳「加速」轉高波，撳左右轉線避車；撞車要扶返架車，慢咗會凍。去到門牌號碼就交咗，送晒踩返舖頭。';
  return S.floor?.out.some(o => o.rider === null) ? '① 門口有外賣等人送：撳門口外面個紫色「送」（一次最多攞三袋）。' : '等外賣袋……';
}
/** Every frame of a 樓面 lesson (tutorial.ts tutTick hands it over): hint, set work, the end once the rider is home. */
export function fTutTick(S: GameState, el: HTMLElement): void {
  const [done, of, unit] = fTutDone(S);
  const txt = `${fTutLine(S)}<small>教學 · ${String(Math.min(done, of))}/${String(of)} ${unit}</small>`;
  if (el.innerHTML !== txt) el.innerHTML = txt;
  el.hidden = false;
  if (done >= of && !floorJob()){ endGame(); return; }
  fTutSpawn(S);
}

/* ===================== 收工 ===================== */
/** The end card of a solo seat shift: the shop's takings and what this seat did. */
export function endX(): void {
  const S = liveG(), k = S.xseat; if (!k) return;
  const did: Record<ExtraKind, () => [string, string]> = {
    runner: () => ['上咗', `${String(S.pass?.carried ?? 0)} 樣`],
    roast: () => ['斬咗', `${String(roastState()?.served ?? 0)} 碟`],
    takeaway: () => ['交咗', `${String(takeawayState()?.results.length ?? 0)} 袋`],
  };
  const [dl, dv] = did[k](), extra = k === 'runner' ? ['凍咗', `${String(S.pass?.stale ?? 0)} 樣`] : ['出錯', String(S.mistakes)];
  must($('result'), 'result').innerHTML = `
    ${ownTakeSeat(k) ? `<div><span>${measureName(k)}</span><b>${cash(shiftMeasure(S))}</b></div>` : ''}${k === 'runner' ? `<div><span>${measureName(k)}</span><b>${measureTxt(k, shiftMeasure(S))}</b></div>` : ''}<div><span>營業額</span><b>${cash(S.revenue)}</b></div>
    <div><span>${dl}</span><b>${dv}</b></div>
    <div><span>${extra[0]}</span><b>${extra[1]}</b></div>
    <div><span>嬲走</span><b>${String(S.angry)}</b></div>`;
  const good = S.angry === 0;
  const LINES: Record<ExtraKind, [string, string]> = {
    runner: ['飛毛腿', '啲餸熱辣辣上枱，客人食得開心。'],
    
    roast: ['斬料師傅', '刀刀利落，斬料客排隊都要等你。'],
    takeaway: ['外賣達人', '袋袋執得啱、綁得靚，外賣仔讚你快。'],
  };
  const [sign, line] = good ? LINES[k] : ['唔錯', '有客等到嬲走咗。慢慢嚟，熟咗手就快。'];
  showEnd(sign, line, SEAT_NAMES[k]);
}
/** The small icon of an extra seat on the pickers (ui/icons.ts uiIcon draws them). */
export const xIco = (k: string): string => iconImg('ui', k);
