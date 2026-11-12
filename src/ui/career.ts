// 事業：每更目標同星星、每日挑戰、升職、熟客簿同名人
// TypeScript port of the original game's career.js, as an ES module: every
// top-level name is exported. SHOP fields other than the starting shop are optional in
// the save type (types/decor.d.ts), so reading one the JS assumed is there goes through must() / `?? NaN`.
import './market';   // load order: src/entry.ts
import { diff, setDiff, liveG, G, setStation, setSlot, station, slot } from '../core/state';
import { must, ownKey } from '../core/util';
import { STATIONS, SLOTS, REG, DIFFS, CELEBS, CELEB_TIP } from '../core/data/menus';
import { pickSure, pick, hashSeed } from '../core/rng';
import { $ } from './prefs';
import { itemsOf, label } from '../core/rules/price';
import { toast } from './ui';
import { SHOP, saveShop, evEl } from './decor';
import { setOn, SET_BONUS, placeFx } from './sets';
import { sfx } from './juice';
import { orderOpen } from '../core/rules/order';
import { shiftIngr, mortTick, gradeTick, teaGrade, mortHtml, gradeHtml, crateHtml, branchHtml } from './market';
import { masteryEnd, masteryMenu } from './mastery';
import { levelBegin, levelEnd, levelLeave, LEVELS, LEVEL_IDS, lvGet, lvLine, lvSpeed, speedNeed, speedHave, seatName } from './levels';
import { speedGoal, isSpeedStation } from '../core/referee/speed';
import { dexBtn } from './dex';
import { gateOk, gateRender } from './gates';
import { tutBegin, tutEnd } from './tutorial';
import { cloudScore, cloudState, renderAcct, openLeaderboard } from './cloud';
import { trackOnce, trackRank } from './stats';
import { SMOKE_SCENES, HER, SMOKE_ENDS } from './smoke';
import { renderMe } from './outfit';
import { NET } from '../net/net';
import { saveSet, buildMenus } from './main';
import { targetText, shiftMeasure, shiftSlips, cleanMet, calmMet, measureTxt } from '../core/career/targets';
import { seats, shopSeat, isSeat, dailySeat, dailyOpen, roleOpen, floorLessonOpen, type Seat } from '../core/career/seats';
import { FLOOR_LESSONS, type FloorLesson } from '../core/work/roles';
import { isExtraKind } from '../core/referee/extras';
import { targetN } from '../core/career/targets';
import { applyTarget, chosenTarget, targetSeat, targetSettle, beginShift } from './target';

/* ===================== 升職 ===================== */
// 星星累積升職；升到某級先解鎖嗰個難度
export const RANKS = [ { name:'學師', s:0 }, { name:'新人', s:3 }, { name:'熟手', s:10 }, { name:'阿姐', s:25 }, { name:'老闆', s:50 } ];
export const DIFF_RANK: Record<string, number> = { rookie:0, pro:2, ace:3 };
SHOP.stars = (SHOP.stars ?? 0)|0; SHOP.regs = SHOP.regs || {}; SHOP.celebs = SHOP.celebs || {}; SHOP.eggs = SHOP.eggs || {}; SHOP.daily = SHOP.daily || '';
export const rankIx = (s: number | undefined = SHOP.stars): number => RANKS.reduce((a, r, i) => (s ?? NaN) >= r.s ? i : a, 0);
export const diffOpen = (d: string): boolean => rankIx() >= (DIFF_RANK[d] ?? NaN);
if (!diffOpen(diff)) setDiff('rookie');

/* ===================== 每更目標 ===================== */
export const REV_T: Record<string, number> = { rookie:800, pro:1500, ace:2100 }, SLOT_F: Record<string, number> = { breakfast:.85, lunch:1, dinner:1.1 };
export const COMBO_T: Record<string, number> = { rookie:6, pro:10, ace:14 }, TIPS_T: Record<string, number> = { rookie:15, pro:30, ace:45 };
export const GOALS: Record<string, Goal> = {
  rev:   { n: () => Math.round((REV_T[diff] ?? NaN) * (SLOT_F[liveG().slot] ?? NaN) / 50) * 50, txt: n => targetText('rev', n ?? 0), ok: n => shiftMeasure(liveG()) >= (n ?? NaN) },
  // calm / clean read their cap from goalN: 0 / 1 for the random boss goal, the chosen tier's cap for a chosen target
  calm:  { n: () => 0, txt: n => targetText('calm', n ?? 0), ok: n => calmMet(n ?? 0, shiftSlips(liveG()).angry, liveG().goods ?? 0) },
  clean: { n: () => 1, txt: n => (n ?? 1)===1 ? '出錯唔好多過一次' : targetText('clean', n ?? 1), ok: n => cleanMet(n ?? 1, shiftSlips(liveG()).mistakes, liveG().goods ?? 0) },
  combo: { n: () => COMBO_T[diff], txt: n => `連擊做到 ${String(n)}`, ok: n => ((liveG().maxCombo ?? 0)|0) >= (n ?? NaN) },
  tips:  { n: () => TIPS_T[diff], txt: n => `貼士儲到 $${String(n)}`, ok: n => ((liveG().tips ?? 0)|0) >= (n ?? NaN) },
};
export const BOSS_SAY = ['今日', '聽住，今日', '喂後生仔，', '今日人手緊，'];
// 每日挑戰：同一日人人一樣（用日期做種子）
export function todayStr(): string { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
export function seeded(str: string): () => number { let h = 2166136261; for (const c of str){ h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
/** The main ladder's levels, id and number (the role gates and the daily challenge read progress along it). */
export const mainLevels = (): { id: string; n: number }[] => LEVEL_IDS.filter(id => !lvGet(id).fest).map(id => ({ id, n: lvGet(id).n }));
/** A new role is open for this save: its lesson is offered, and its seat once learned (core/career/seats.ts roleOpen). */
export const roleOpenNow = (k: ExtraKind): boolean => ptAllRoles || roleOpen(k, SHOP.tutDone, SHOP.levels, mainLevels());
/** A 樓面 task's own lesson is offered (執枱 from 中環, 送外賣 from level 5; core/career/seats.ts floorLessonOpen). */
export const floorLessonNow = (k: FloorLesson): boolean => ptAllRoles || floorLessonOpen(k, SHOP.tutDone, SHOP.levels, mainLevels());
/** Preview only (the 試玩 panel, src/playtest): open every role's lesson and seat at once, so a playtester can try any station
 *  without climbing the ladder. Never set on the live Worker, which never mounts the panel. The
 *  same switch opens every level and level tab (levels.ts levelOpen, gates.ts catOpen), every seat without its lesson
 *  (xseat.ts xTrained), the full home screen, and quiets every gate card (gates.ts gatePop). Nothing is written to the
 *  save: every unlock is derived, so switching it off (or the live game) restores the normal gates. */
let ptAllRoles = false;
export const setPtAllRoles = (on: boolean): void => { ptAllRoles = on; };
export const ptAllRolesOn = (): boolean => ptAllRoles;
export function dailyChallenge(): DailyChallenge {
  // The lists are never empty, so a pick is always there.
  const r = seeded('ckf' + todayStr()), pickR = <T>(a: readonly T[]): T => must(a[Math.floor(r() * a.length)], 'daily pick');
  // every seat, a new one only once it is open for this player (learned and past its intro level); at a new seat
  // the goal is one it can affect (貼士 are the computer shop's there, so it reads 連擊)
  const station = dailySeat(r(), k => dailyOpen(k, SHOP.tutDone, SHOP.levels, mainLevels())), slot = pickR(Object.keys(SLOTS)), goal = pickR(Object.keys(GOALS));
  return { station, slot, goal: isExtraKind(station) && goal === 'tips' ? 'combo' : goal, prize:500 };
}
type SeatMetric = 'rev' | 'clean' | 'calm' | 'combo';
const seatMetric = (g: string): g is SeatMetric => g === 'rev' || g === 'clean' || g === 'calm' || g === 'combo';
const slotOf = (s: string): Slot => s === 'breakfast' || s === 'dinner' ? s : 'lunch';
/** The daily's goal number: at a new seat that seat's own (targets.ts, the 博一博 line), else the boss goal's. */
export function dailyN(dc: DailyChallenge): number {
  if (isExtraKind(dc.station) && seatMetric(dc.goal)) return targetN({ metric: dc.goal, tier: 'bet' }, dc.station, slotOf(dc.slot), diff);
  return dc.goal === 'rev' ? Math.round((REV_T[diff] ?? NaN) * (SLOT_F[dc.slot] ?? NaN) / 50) * 50 : must(GOALS[dc.goal], 'goal').n() ?? 0;
}
/** The daily's goal in words, on the day's seat's own measure. */
export const dailyGoalTxt = (dc: DailyChallenge): string => isExtraKind(dc.station) && seatMetric(dc.goal) ? targetText(dc.goal, dailyN(dc), dc.station) : must(GOALS[dc.goal], 'goal').txt(dailyN(dc));
export let dailyArmed = false;
export function setDailyArmed(v: typeof dailyArmed): void { dailyArmed = v; }
// ---- 返工日數：每日開一更就多一日；隔咗幾日唔返都唔會由頭計（never punish absence） ----
export function dayStr(off: number): string { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
SHOP.streak = SHOP.streak || { n:0, last:'' };
export const streakNow = (): number => must(SHOP.streak, 'SHOP.streak').n;
// 今日第一更收工：返工日數 +1，派獎（第七日、十四日……大獎）
export function streakTick(): { n: number; cash: number; big: boolean } | null {
  const s = must(SHOP.streak, 'SHOP.streak'), today = todayStr();
  if (s.last===today) return null;
  s.n = s.n + 1; s.last = today;
  const big = s.n % 7===0, cash = big ? 700 : Math.min(300, 50 * s.n);
  SHOP.bank += cash; if (big) SHOP.stars = (SHOP.stars ?? NaN) + 1;
  return { n: s.n, cash, big };
}
// ---- 今日熟客：每日（全港一樣）一位熟客會喺某一更嚟 ----
export function todayReg(): TodayReg | null {
  const rk = rankIx(), r = seeded('reg' + todayStr());
  // Every regular has `persons` (the JS's `REG[k].persons &&` test is always true and is gone).
  const slotsOf = (k: string): Slot[] => Object.keys(SLOTS).filter((s): s is Slot => ownKey(SLOTS, s) && !!must(REG[k], 'regular ' + k).persons[s] && orderOpen(must(must(REG[k], 'regular ' + k).persons[s], 'order')));
  const ks = PERSIST.filter(k => (must(REG[k], 'regular ' + k).rank ?? NaN) <= rk && slotsOf(k).length);
  if (!ks.length) return null;
  // ks is not empty and every key in it has a slot, so both picks are always there.
  const k = must(ks[Math.floor(r() * ks.length)], 'regular pick'), sl = slotsOf(k);
  return { key:k, slot: must(sl[Math.floor(r() * sl.length)], 'slot pick') };
}
export const TODAY_TIP = 100, REG_TIP = (v: number): number => Math.min(40, 10 + 5 * v);
export function careerStart(): void {
  if (tutBegin()){ liveG().daily = false; return; }
  if (levelBegin()){ liveG().daily = false; return; }
  const dc = dailyArmed && dailyChallenge();
  liveG().daily = !!dc; dailyArmed = false;
  // 全港同一題：每日挑戰用日期做種子出客，人人同一批客、同一張單（core/referee/index.ts update draws them from G.drng）
  if (dc) liveG().drng = { a: hashSeed('ckf-day' + todayStr()) };
  // own shop: the target chosen on the pre-shift screen; co-op keeps the random boss goal until its lobby picks one
  if (!dc && !liveG().coop && !NET.role) applyTarget(chosenTarget(), targetSeat());
  else { liveG().goal = dc ? dc.goal : pickSure(Object.keys(GOALS)); liveG().goalN = must(GOALS[String(liveG().goal)], 'goal').n(); }
  // a daily at a new seat: the goal's number is that seat's own (targets.ts, the 博一博 line), as a chosen target is
  if (dc && isExtraKind(dc.station)) liveG().goalN = dailyN(dc);
  bossSay(`${dc ? '每日挑戰（全港同一批客）：' : '老闆：' + pickSure(BOSS_SAY)}${goalText()}！`);
  if (!dc) planVisitors();   // 每日挑戰唔出熟客名人，大家公平
}
// a solo new seat's targets read that seat: only the running shift knows its seat
export const goalText = (): string => { const S = liveG(); return (S.goal === 'rev' || S.goal === 'clean' || S.goal === 'calm') && !S.coop && S.xseat ? targetText(S.goal, S.goalN ?? 0, S.xseat) : must(GOALS[String(S.goal)], 'goal').txt(S.goalN); };
export let bossEl: HTMLElement | null = null, bossT = 0;
export function bossSay(txt: string): void {
  if (!bossEl){ bossEl = document.createElement('div'); bossEl.id = 'bossSay'; bossEl.setAttribute('aria-live', 'polite'); document.body.appendChild(bossEl); }
  bossEl.textContent = txt; bossEl.hidden = false; clearTimeout(bossT);
  // 培訓：老闆講嘢唔會自己散，撳一下先收（新手讀字慢）
  if (G && G.tut){ bossEl.classList.add('stay'); bossEl.onclick = () => { must(bossEl, 'bossEl').hidden = true; }; }
  else { bossEl.classList.remove('stay'); bossT = setTimeout(() => { must(bossEl, 'bossEl').hidden = true; }, 2600); }
}
// 收工：計星、獎錢、升職
export function careerEnd(): void {
  if (bossEl) bossEl.hidden = true;
  if (!G || G.scored) return; G.scored = true;
  if (G.tut){ tutEnd(); return; }
  // 返工日數：今日第一更（關卡都計）
  const stk = G.coop && NET.role==='client' ? null : streakTick();
  const stkHtml = stk ? `<div class="wide streakw"><span>返工第 ${stk.n} 日${stk.big ? ' · 一個禮拜！多 1★' : ''}</span><b>+$${stk.cash}</b></div>` : '';
  if (!G.coop || NET.role!=='client') SHOP.shifts = ((SHOP.shifts ?? 0)|0) + 1;
  const tryH = G.solo ? '' : stationFirst();   // 輪流做 / 一腳踢 is not a first shift at any one station
  if (typeof trackOnce==='function'){ if (!G.level) trackOnce('shop_done'); if ((SHOP.shifts ?? NaN) >= 3) trackOnce('shift3'); if ((SHOP.shifts ?? NaN) >= 10) trackOnce('shift10'); }
  if (G.level){ const st = levelEnd(); if (typeof trackRank==='function') trackRank(); masteryEnd(st); levelLeave(); if (stk){ saveShop(); must($('result'), 'result').insertAdjacentHTML('beforeend', stkHtml); } must($('result'), 'result').insertAdjacentHTML('beforeend', shiftIngr(st, false) + tryH + nextGoalHtml({ level: G.level })); return; }
  const goalOk = must(GOALS[String(G.goal)], 'goal').ok(G.goalN);
  // 第三粒星：一個人做一個位就睇手速；輪流做／一腳踢同組隊照舊睇少出錯、少人嬲
  const seat = G.xseat ?? G.station;   // every seat has a speed measure
  const sg = !G.solo && !G.coop && isSpeedStation(seat) ? speedGoal(seat, false) : null;
  const sl = shiftSlips(G);   // a solo work seat counts its own slips and losses
  const s1 = sl.angry <= 3, s2 = s1 && goalOk, s3 = s2 && (sg ? sg.ok : sl.mistakes <= 1 && sl.angry <= 1);
  const s3Txt = sg ? ` · ★★★ 要${speedNeed(sg)}，${speedHave(sg)} ${sg.ok ? '✓' : '✗'}` : '';
  const stars = s3 ? 3 : s2 ? 2 : s1 ? 1 : 0;
  const before = rankIx();
  let prize = stars * 100;
  const dailyWin = G.daily && goalOk && SHOP.daily !== todayStr();
  if (dailyWin){ prize += dailyChallenge().prize; SHOP.daily = todayStr(); }
  if (G.daily && goalOk) void cloudScore({ revenue: shiftMeasure(G), stars, station: seat, slot: G.slot });   // a new seat's daily: its own seat and measure
  if (setOn('estate')){ prize += SET_BONUS; }
  prize += placeFx().bonus || 0;
  const bet = targetSettle(goalOk);   // a chosen target's stake: booked in the bank by targetSettle
  SHOP.stars = (SHOP.stars ?? NaN) + stars; SHOP.bank += prize; saveShop();
  const after = rankIx(), up = after > before; if (typeof trackRank==='function') trackRank();
  const unlock: string[] = up ? Object.entries(DIFF_RANK).filter(([, r]) => r===after).map(([d]) => must(DIFFS[d], 'difficulty ' + d).name + '難度') : [];
  if (before < 2 && after >= 2) unlock.push('廚房第二隻碟');
  const next = RANKS[after + 1];
  if (stk) must($('result'), 'result').insertAdjacentHTML('afterbegin', stkHtml);
  must($('result'), 'result').insertAdjacentHTML('afterbegin', `<div class="wide stars"><span>${G.daily ? '每日挑戰' : '老闆目標'}：${goalText()} ${goalOk ? '✓' : '✗'}${s3Txt}</span>
    <b aria-label="${stars} 粒星">${'★'.repeat(stars)}<i>${'★'.repeat(3 - stars)}</i></b>
    <span>${prize ? `獎金 $${prize}${dailyWin ? '（包埋挑戰 $500）' : ''} · ` : ''}${up ? `升職！你而家係<em>${must(RANKS[after], 'rank').name}</em>${unlock.length ? '，解鎖' + unlock.join('、') : ''}` : `${must(RANKS[after], 'rank').name} · ${String(SHOP.stars)}★${next ? `，再儲 ${next.s - (SHOP.stars ?? NaN)}★ 升${next.name}` : ''}`}</span></div>`);
  if (up){ toast(`升職做${must(RANKS[after], 'rank').name}！`); sfx.fanfare(); }
  must($('result'), 'result').insertAdjacentHTML('beforeend', bet.html + shiftIngr(stars, dailyWin) + mortTick() + tryH + nextGoalHtml());
  gradeTick();
  if (!G.solo) masteryEnd(stars);   // station mastery counts one-station shifts only
}

// 每個位第一更獎 $150（鼓勵試水吧、收銀）；舊玩家照關卡紀錄當試過
export const TRY_BONUS = 150;
export function triedMap(): Record<string, number> {
  if (!SHOP.tried){ SHOP.tried = {}; Object.values(SHOP.lvst || {}).forEach(r => { Object.keys(r || {}).forEach(k => { must(SHOP.tried, 'SHOP.tried')[k] = 1; }); }); }
  return SHOP.tried;
}
/** STATIONS[k] where the JS read a field of it straight away. */
export const stationDef = (k: string): StationDef => must(ownKey(STATIONS, k) ? STATIONS[k] : undefined, 'station ' + k);
export function stationFirst(): string {
  const st = G ? G.xseat ?? G.station : '';   // every seat (the new seats too)
  if (!G || G.tut || (G.coop && NET.role==='client') || !isSeat(st)) return '';
  const T = triedMap(); if (T[st]) return '';
  T[st] = 1; SHOP.bank += TRY_BONUS; saveShop();
  return `<div class="wide ingw"><span>第一次做${seatName(st)}</span><b>+$${TRY_BONUS}</b><span>每個位第一更都有利是</span></div>`;
}
/** Seats the player can take a first shift at: the shop's four, and a new seat once its lesson is done. */
const triable = (): Seat[] => seats().filter(s => shopSeat(s) || !!(SHOP.tutDone || {})[s]);
// 收工畫面「下一個目標」：下一粒星差幾多、升級差幾多同解鎖乜，等人知道再玩一更有咩著數
export const RANK_UNLOCK: Record<number, string> = { 1:'熟客簿、每日挑戰、似水流年關卡', 2:'地產舖、茶記評級、廚房第二隻碟、更多關卡' };
export function nextGoalHtml(opt?: { level?: string | null }): string {
  if (!G || G.tut) return '';
  const lines: string[] = [];
  if (opt && opt.level && LEVELS[opt.level]){
    // the seat's own measure (洗碗分, 燒味收入, 外賣收入), as the stars read it
    const line = lvLine(opt.level, G.xseat ?? G.station, !!G.coop), rev = shiftMeasure(G), mx = G.coop ? undefined : G.xseat, sg = lvSpeed(), k = line.slice(0, sg ? 2 : 3).findIndex(s => rev < s);
    // one person: the third star is the station's speed, once the second revenue line is met
    if (sg && k < 0 && !sg.ok) lines.push(`下一粒星：★★★ 要<em>${speedNeed(sg)}</em>（呢更${speedHave(sg)}）`);
    else if (k >= 0) lines.push(`下一粒星：再${mx === 'runner' ? '送' : '賺'} <em>${measureTxt(mx, (line[k] ?? NaN) - rev)}</em>（${'★'.repeat(k + 1)} 要 ${measureTxt(mx, line[k] ?? NaN)}）`);
  }
  const ix = rankIx(), nr = RANKS[ix + 1];
  if (nr){
    const un = [RANK_UNLOCK[ix + 1], ...Object.entries(DIFF_RANK).filter(([, r]) => r===ix + 1).map(([d]) => must(DIFFS[d], 'difficulty ' + d).name + '難度')].filter(Boolean).join('、');
    lines.push(`再儲 <em>${nr.s - (SHOP.stars ?? NaN)}★</em> 升${nr.name}${un ? '，解鎖' + un : ''}`);
  }
  const T = triedMap(), left = triable().filter(k => !T[k]).map(seatName);
  if (left.length) lines.push(`未試過<em>${left.join('、')}</em>，第一更各有 $${TRY_BONUS} 利是`);
  return lines.length ? `<div class="wide nextg"><span>下一個目標</span>${lines.map(l => `<p>${l}</p>`).join('')}</div>` : '';
}

/* ===================== 熟客（記得你嘅客） ===================== */
export const L = (food: string, d: string, cold: boolean, sweet = 0, noice = false): Person => ({ food, drink:{ d, cold, sweet, noice } });
export const B = (id: string, noodle: string, egg: string, bread: string, hongdai: boolean, feibin: boolean, d: string, cold: boolean, sweet = 0): Person => ({ set:{ id, noodle, egg, bread, hongdai, feibin }, drink:{ d, cold, sweet, noice:false } });
export const N = (id: string, flags: string[], d: string, cold: boolean, sweet = 0, noice = false): Person => ({ dish:{ id, 炒底: flags.includes('炒底'), 加底: flags.includes('加底'), 走青: flags.includes('走青') }, drink:{ d, cold, sweet, noice } });
// 呢班熟客跨日都記得：第一次嚟會講晒，之後淨係講「照舊」；每次嚟講多句自己嘅故事
Object.assign(REG, {
  leebak: { label:'李伯', persist:true, rank:0, who:'晨運完就嚟，坐慣咗近門口嗰張枱',
    persons:{ breakfast:[B('常餐','通粉','煎蛋','牛油多士',false,false,'奶茶',false)], lunch:[L('火腿通粉','奶茶',false)], dinner:[N('咖喱牛腩飯',['走青'],'奶茶',false)] },
    story:['後生仔，我喺呢度食咗三十年早餐㗎喇。', '今日個孫仔考試，我買咗個菠蘿包畀佢。', '下個月我搬去同個仔住……以後少啲嚟喇，多謝你哋照顧。'] },
  ming: { label:'阿明', persist:true, rank:0, who:'地盤佬，餓極都要飲凍嘢',
    persons:{ breakfast:[B('C餐','公仔麵','炒蛋','牛油多士',false,false,'鴛鴦',true,1)], lunch:[L('焗豬扒飯','鴛鴦',true,1)], dinner:[N('揚州炒飯',['加底'],'鴛鴦',true,1)] },
    story:['今朝五點開工，餓到暈！', '儲緊錢結婚呀，加底都要諗吓……照加！', '我派張喜帖畀你！得閒嚟飲啦！'] },
  wong: { label:'Miss 黃', persist:true, rank:1, who:'中環 OL，永遠趕時間',
    persons:{ breakfast:[B('A餐','意粉','太陽蛋','餐包',true,true,'檸水',true)], lunch:[L('西多士','檸水',true,0,true)], dinner:[N('白汁雞皇飯',['走青'],'檸水',true,0,true)] },
    story:['快啲呀唔該，我十五分鐘後開會！', '今日見工……祝我好運！', '我升咗職呀！聽日請全公司飲你哋奶茶！'] },
  fat: { label:'發哥', persist:true, rank:2, who:'夜更的士佬，乜都知',
    persons:{ breakfast:[B('B餐','米粉','煎蛋','奶油多士',false,false,'鴛鴦',false)], lunch:[L('沙嗲牛麵','鴛鴦',false)], dinner:[N('焗豬扒飯',[],'鴛鴦',false)] },
    story:['收工！今晚跑咗廿幾轉。', '隔籬街開咗間新茶記，麻麻地，都係你哋好。', '今日搭咗個明星上車，佢話都鍾意你哋啲奶茶！'] },
  lung: { label:'龍哥', persist:true, rank:2, enter:'呀打！', who:'街坊功夫迷，黃色衛衣印住個「武」字，褲袋插住對雙節棍',
    persons:{ breakfast:[B('C餐','公仔麵','炒蛋','牛油多士',false,false,'鴛鴦',true,2)], lunch:[L('沙嗲牛麵','鴛鴦',true,2)], dinner:[N('豉椒排骨飯',['炒底'],'鴛鴦',true,2)] },
    story:['後生仔，你沖奶茶個手勢，同我出拳一樣要快、要準！（凍鴛鴦走甜，練功唔食糖）', '我喺天台開咗班，教隔籬啲細路練功。你得閒上嚟睇吓？', '今日我啲徒弟比賽攞咗冠軍！照舊，今日我請全舖飲凍鴛鴦！'] },
} satisfies Record<string, Regular>);
Object.assign(must(REG['chan'], 'regular chan'), { persist:true, rank:0, who:'凍檸茶走甜，幾十年如一日',
  story:['凍檸茶走甜，幾十年都係咁。', '今日行運，馬仔中咗！', '張太成日望住我……你話佢係咪有嘢想講？'] } satisfies Partial<Regular>);
Object.assign(must(REG['cheung'], 'regular cheung'), { persist:true, rank:0, who:'熱奶茶，自己落糖，好有要求',
  story:['熱奶茶，糖我自己落。', '陳生又嚟？哼。', '我個孫考到大學喇！今日我請你飲嘢。'] } satisfies Partial<Regular>);
export const PERSIST = Object.keys(REG).filter(k => must(REG[k], 'regular ' + k).persist);
// 呢更有邊個熟客、名人嚟
export function planVisitors(): void {
  // 熟客罕有啲：每更三成五機會冇、五成一個、一成半兩個；名人兩成半
  const rk = rankIx(), r = Math.random(), many = placeFx().reg || teaGrade().g >= 3, n = many ? (r < .1 ? 0 : r < .55 ? 1 : 2) : r < .35 ? 0 : r < .85 ? 1 : 2;
  const tr = todayReg(), tk = tr && tr.slot===liveG().slot && SHOP.regToday!==todayStr() ? tr.key : null;
  if (tk) liveG().regPlan.push({ key:tk, at: 25 + Math.random() * 40, today:true });
  const pool = PERSIST.filter(k => k!==tk && (must(REG[k], 'regular ' + k).rank ?? NaN) <= rk && orderOpen(must(must(REG[k], 'regular ' + k).persons[liveG().slot], 'order of ' + k))).sort(() => Math.random() - .5).slice(0, n);
  pool.forEach(k => liveG().regPlan.push({ key:k, at: 20 + Math.random() * 120,
    // 彩蛋：陳生嚟過兩次之後，間中會帶女伴
    date: k==='chan' && ((must(SHOP.regs, 'SHOP.regs')['chan'] ?? 0)|0) >= 2 && Math.random() < .25 }));
  if (rk >= 1 && Math.random() < .25) liveG().regPlan.push({ celeb: pick(Object.keys(CELEBS)), at: 30 + Math.random() * 100 });
  liveG().regPlan.sort((a, b) => a.at - b.at);
}
// 食完埋單：記低熟客嚟咗幾次；名人揭盅
// The page's half of a regular or celebrity paying (core/referee/judge.ts careerPaid, through PORT.regPaid): the save's
// bookkeeping and the thank-you. Returns the tip, which the rules add to the shift's revenue and tips.
export function regPaid(g: SeatGroup): number {
  let tip = 0;
  const tr = g.regular && todayReg(), today = tr && tr.key===g.regular && tr.slot===liveG().slot && SHOP.regToday!==todayStr();
  if (today){ SHOP.regToday = todayStr(); SHOP.bank += TODAY_TIP; }
  if (g.regular){
    const v = (must(SHOP.regs, 'SHOP.regs')[g.regular] ?? 0)|0, r = REG[g.regular];
    must(SHOP.regs, 'SHOP.regs')[g.regular] = v + 1; if (g.date) must(SHOP.eggs, 'SHOP.eggs').date = true; saveShop();
    // 熟客越嚟得多越疏爽：第一次 $10，每次多 $5，最多 $40
    const reg = must(r, 'regular ' + g.regular);
    if (reg.persist){ tip = REG_TIP(v);
      toast(`${reg.label}食得開心，打賞 $${tip}（第 ${v + 1} 次嚟${today ? `，今日熟客另獎 $${TODAY_TIP}` : ''}）`); }
    else if (today) toast(`今日熟客${reg.label}食得開心，打賞 $${TODAY_TIP}`);
  }
  if (g.celeb){
    const c = CELEBS[g.celeb], first = !must(SHOP.celebs, 'SHOP.celebs')[g.celeb];
    must(SHOP.celebs, 'SHOP.celebs')[g.celeb] = ((must(SHOP.celebs, 'SHOP.celebs')[g.celeb] ?? 0)|0) + 1; saveShop();
    tip += CELEB_TIP;
    const cc = must(c, 'celebrity ' + g.celeb);
    toast(`原來係${cc.name}！「${cc.line}」貼士 $${CELEB_TIP}${first ? ' · 新名人入簿' : ''}`); sfx.fanfare();
  }
  return tip;
}
// 熟客入門：講佢嘅故事（每次講下一段）. The page's half of core/referee/customers.ts careerArrive (PORT.regArrive).
export function regArrive(g: SeatGroup): void {
  const r = g.regular && REG[g.regular];
  if (r && r.persist){ const v = (must(SHOP.regs, 'SHOP.regs')[String(g.regular)] ?? 0)|0, story = must(r.story, 'story of ' + r.label); toast(`${r.enter ? r.enter + ' ' : ''}${r.label}：「${String(story[Math.min(v, story.length - 1)])}」`); if (r.enter) sfx.kiai(); }
}

/* ===================== 開工畫面：級數、挑戰、熟客簿 ===================== */
/** SLOTS[k] where the JS read a field of it straight away. */
export const slotDef = (k: string): SlotDef => must(ownKey(SLOTS, k) ? SLOTS[k] : undefined, 'slot ' + k);
export function renderCareer(): void {
  const rk = rankIx(), next = RANKS[rk + 1], dc = dailyChallenge(), done = SHOP.daily===todayStr();
  const pct = next ? Math.round(((SHOP.stars ?? NaN) - must(RANKS[rk], 'rank').s) / (next.s - must(RANKS[rk], 'rank').s) * 100) : 100;
  if ($('mortBox') && typeof mortHtml==='function') must($('mortBox'), 'mortBox').innerHTML = mortHtml();
  const G1 = typeof gateOk==='function' ? gateOk : () => true, rookie = G1('rookie');
  if ($('mortBox') && !G1('pro')) must($('mortBox'), 'mortBox').innerHTML = '';
  must($('career'), 'career').innerHTML = (typeof gradeHtml==='function' ? (G1('pro') ? gradeHtml() : '') + (G1('shop') ? crateHtml() : '') + branchHtml() : '') + `
    <div class="rank"><b>${must(RANKS[rk], 'rank').name}</b><span>${String(SHOP.stars)}★${next ? ` · 再儲 ${next.s - (SHOP.stars ?? NaN)}★ 升${next.name}` : ' · 最高級'}</span><i style="--p:${pct}%"></i>
      ${rookie ? `<em class="streak">${streakNow() ? `返咗 ${streakNow()} 日工${must(SHOP.streak, 'SHOP.streak').last===todayStr() ? ' ✓' : ''}` : '今日返一更，開始計返工日數'}</em>` : ''}
      ${((tr: TodayReg | null) => tr && rookie ? `<em class="treg">今日熟客：${must(REG[tr.key], 'regular ' + tr.key).label} · ${SLOTS[tr.slot].name}會嚟${SHOP.regToday===todayStr() ? ' ✓' : ''}</em>` : '')(todayReg())}</div>
    ${rookie ? `<div class="daily${done ? ' done' : ''}"><p><small>今日挑戰 · 全港同一批客${done ? ' · 搞掂 ✓' : ` · 獎 $${dc.prize}`}</small>${seatName(dc.station)} · ${slotDef(dc.slot).name} · ${dailyGoalTxt(dc)}</p>
      <span class="dbtns">${done ? '<button type="button" id="dailyBtn" class="again">再挑戰</button>' : '<button type="button" id="dailyBtn">接受挑戰</button>'}${cloudState!=='off' ? '<button type="button" id="lbBtn" class="again">排行榜</button>' : ''}</span></div>` : ''}`;
  renderAcct(); renderMe(); masteryMenu();
  if (typeof dexBtn==='function') dexBtn();
  must($('bookBtn'), 'bookBtn').dataset.gate = ''; must($('bookBtn'), 'bookBtn').innerHTML = `熟客簿 <span>${Object.keys(must(SHOP.regs, 'SHOP.regs')).length + Object.keys(must(SHOP.celebs, 'SHOP.celebs')).length}/${Object.keys(REG).length + Object.keys(CELEBS).length}</span>`;
  must($('tutBtn'), 'tutBtn').classList.toggle('new', !Object.keys(SHOP.tutDone || {}).length);
  // the lessons offered so far: the four, and each new role once the ladder reached it
  // (and each 樓面 task's own lesson once it joins the floor)
  { const open: string[] = [...seats().filter(s => shopSeat(s) || roleOpenNow(s)), ...FLOOR_LESSONS.filter(floorLessonNow)], n = open.filter(s => (SHOP.tutDone || {})[s]).length, all = open.length; must($('tutSub'), 'tutSub').textContent = n >= all ? '每個位都學識 ✓' : `每個位學識獎 $300（${n}/${all}）`; }
  must($('newbie'), 'newbie').hidden = !!Object.keys(SHOP.tutDone || {}).length || !!SHOP.skipTut;
  // 未解鎖嘅難度
  document.querySelectorAll('#diffSeg button').forEach(b => {
    if (!(b instanceof HTMLButtonElement)) return;
    const d = String(b.dataset.d), open = diffOpen(d); b.disabled = !open; b.classList.toggle('locked', !open);
    const sp = b.querySelector('span');
    if (!open && sp) sp.textContent = `要升到${must(RANKS[DIFF_RANK[d] ?? NaN], 'rank').name}（${must(RANKS[DIFF_RANK[d] ?? NaN], 'rank').s}★）`;
  });
  if (typeof gateRender==='function') gateRender();
}
must($('career'), 'career').addEventListener('click', e => {
  const b = evEl(e.target).closest('button'); if (!b) return;
  if (b.id==='dailyBtn'){
    const dc = dailyChallenge(); setStation(shopSeat(dc.station) ? dc.station : 'waiter'); setSlot(must(ownKey(SLOTS, dc.slot) ? dc.slot : null, 'slot ' + dc.slot)); saveSet('ckf-station', station); saveSet('ckf-slot', slot);
    dailyArmed = true; buildMenus(); beginShift();   // a new seat's daily: ui/xseat.ts xNext plays it
  }
  if (b.id==='lbBtn') void openLeaderboard();
});
must($('bookBtn'), 'bookBtn').onclick = openBook;
export function openBook(): void {
  const regs = Object.entries(REG).map(([k, r]) => {
    const v = (must(SHOP.regs, 'SHOP.regs')[k] ?? 0)|0;
    if (!v) return `<li class="locked"><b>？？？</b><span>未見過</span></li>`;
    const orders = (['breakfast','lunch','dinner'] as const).map(s => `<small>${SLOTS[s].name}</small>${itemsOf(must(r.persons[s], 'order of ' + k)).map(x => label(x)).join(' ＋ ')}`).join('<br>');
    const story = r.story ? r.story.slice(0, v).map(t => `<q>${t}</q>`).join('') + (v < r.story.length ? '<q class="more">（佢下次再嚟會講多啲……）</q>' : '') : '';
    return `<li><b>${r.label}</b><span>${String(r.who)} · 嚟咗 ${v} 次</span><p class="ord">照舊：<br>${orders}</p>${story}</li>`;
  }).join('');
  const celebs = Object.entries(CELEBS).map(([k, c]) => must(SHOP.celebs, 'SHOP.celebs')[k] ? `<li><b>${c.name}</b><q>${c.line}</q></li>` : `<li class="locked"><b>？？？</b><span>戴住黑超，認唔出</span></li>`).join('');
  const eggs = must(SHOP.eggs, 'SHOP.eggs').date ? '<li><b>陳生嘅秘密</b><q>陳生帶過個女伴嚟……佢照舊，女伴自己叫。張太有冇見到？</q></li>' : '<li class="locked"><b>？？？</b><span>一個秘密</span></li>';
  const sm = must(SHOP.eggs, 'SHOP.eggs').smoke || [];
  const smoke = SMOKE_SCENES.map(s => sm.includes(s.id) ? `<li><b>食煙位：${s.name}</b><q>${s.line}</q></li>` : '<li class="locked"><b>？？？</b><span>撳暫停，伙記仔會去邊度抖氣？</span></li>').join('');
  const hc = Math.min((must(SHOP.eggs, 'SHOP.eggs').her ?? 0)|0, HER.length);
  const herLi = hc ? `<li><b>後巷嘅佢（${hc}/${HER.length}）</b><q>${String(must(HER[hc - 1], 'her line')[0])}</q></li>` : '<li class="locked"><b>？？？</b><span>後巷好似有人同你一樣出嚟抖氣</span></li>';
  const se = must(SHOP.eggs, 'SHOP.eggs').smokeEnd || [];
  const ends = Object.entries(SMOKE_ENDS).map(([k, e]) => se.includes(k) ? `<li><b>隱藏結局：${e.name}</b><q>${e.line}</q></li>` : '<li class="locked"><b>？？？</b><span>隱藏結局：多啲撳暫停睇吓</span></li>').join('') + herLi;
  must($('book'), 'book').innerHTML = `<div class="sh-head"><b>熟客簿</b><span>${must(RANKS[rankIx()], 'rank').name} · ${String(SHOP.stars)}★</span></div>
    <p class="hint">熟客同名人只會嚟你自己間舖（關卡同每日挑戰冇）。熟客嚟得越多次打賞越多（$10 起，最多 $40）；茶記評級三碗或以上，熟客嚟得密啲。</p>
    <h3>熟客</h3><ul class="booklist">${regs}</ul>
    <h3>名人（${Object.keys(must(SHOP.celebs, 'SHOP.celebs')).length}/${Object.keys(CELEBS).length}）</h3><ul class="booklist">${celebs}</ul>
    <h3>彩蛋</h3><ul class="booklist">${eggs}${smoke}${ends}</ul>
    <button type="button" class="big" id="bookClose">返回</button>`;
  must($('bookView'), 'bookView').hidden = false; must($('bookClose'), 'bookClose').focus();
}
must($('bookView'), 'bookView').addEventListener('click', e => { const t = evEl(e.target); if (t.id==='bookClose' || t.id==='bookView') must($('bookView'), 'bookView').hidden = true; });
// 試玩密技：同借錢一齊，送 5★
export function careerCheat(): void { SHOP.stars = (SHOP.stars ?? NaN) + 5; saveShop(); renderCareer(); }
