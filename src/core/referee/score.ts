// Combo, tips and fever (the state half of the original game's juice.js).
import { G, diff, liveG } from '../state';
import { CFG } from '../data/menus';
import { must } from '../util';
import { PORT } from '../env';
import { CORE_HOOK } from '../hooks';
import { toast, sfx, emit } from '../fx';
import type { Rng } from '../rng';
import { feverStart, feverClock, feverTipMul, feverPeak } from './fever';
import { blackoutOn, twistOf } from './twist';

/* ===================== 連擊同貼士 ===================== */
// 做啱一樣嘢（落啱單、出啱碟、沖啱杯、收啱錢）連擊 +1；有錯或者有客嬲走就斷
// 連三單起有貼士：3 單 $1、6 單 $2、9 單 $3、12 單起 $5（貼士大約係營業額一成幾，唔再係一半）
export const tipFor = (c: number): number => c < 3 ? 0 : c < 6 ? 1 : c < 9 ? 2 : c < 12 ? 3 : 5;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- callers (still JS) pass where the good action happened; good() ignores it
export function good(_where?: string): void {
  if (!G || !G.running) return;
  noteBad();   // 同一下撳又錯又做啱（例如多找錢）：錯先斷，做啱先加，唔好等下一格畫面先斷埋新嗰單
  G.combo = ((G.combo ?? 0)|0) + 1; G.maxCombo = Math.max((G.maxCombo ?? 0)|0, G.combo);
  // 順手：客人慢慢密返（新人最密都只係正常）
  G.ease = Math.max(diff==='rookie' ? 1 : .9, (G.ease || 1) - .03);
  G.goods = ((G.goods ?? 0)|0) + 1;
  // 旺場: the tips follow the fever's heat, up to CFG.fever.tip times at its climax
  const tip = Math.round(tipFor(G.combo) * feverTipMul(G) * PORT.setTip());
  if (tip){ G.revenue += tip; G.tips = ((G.tips ?? 0)|0) + tip; }
  emit({ k: 'combo', tip, broke: false });
  sfx.good(G.combo); if (tip) emit({ k: 'sfx', name: 'coin', delay: 120 });
  // `msg` always has the entry: includes() just checked the combo is 5, 20 or 30.
  if ([5, 20, 30].includes(G.combo)){ const msg: Record<number, string> = { 5:'手勢唔錯！連續五單', 20:'阿姐都讚你！連續二十單', 30:'茶記之神！連續三十單' }; toast(must(msg[G.combo], 'combo toast')); sfx.fanfare(); }
}
export function breakCombo(): void {
  if ((liveG().combo ?? NaN) >= 3){ emit({ k: 'combo', tip: 0, broke: true }); sfx.broke(); }
  liveG().combo = 0;
}
/**
 * The shift's one fever: on the first open step its start is drawn from `r` (the shift's stream; the tutorial has
 * none), then G.fever follows the clock: on for CFG.fever.sec from G.feverAt. The referee's state only: the page
 * announces it from juiceTick, on every phone alike. Each step.
 */
export function feverTick(r: Rng): void {
  const S = liveG();
  if (S.feverAt === undefined) S.feverAt = S.tut ? null : feverStart(r);
  const on = feverClock(S.feverAt, S.t) !== null;
  if (on && !S.fever){ S.fever = true; S.fevers = ((S.fevers ?? 0)|0) + 1; }
  else if (!on && S.fever) S.fever = false;
}
/** The auto-easing after a mistake wears off (P1): G.ease above 1 goes back to 1 at CFG.easeBack a second. Each step. */
export function easeTick(dt: number): void {
  const S = liveG();
  if ((S.ease ?? 1) > 1) S.ease = Math.max(1, (S.ease ?? 1) - CFG.easeBack * dt);
}// 每格畫面睇吓：有冇新錯、新嬲走、新客入門、繁忙時間
/** `fv`: the fever as this page has announced it: 0 not yet, 1 started, 2 climax, 3 over. `tw`: the 搏盡 mishap
 *: 0 not yet, 1 struck (the blackout: lights out), 2 over. */
export let jLast: { g: GameState; bad: number; inQ: number; rush: number; fv: number; tw: number } | null = null;
// 新錯（或者新嬲走）：斷連擊、客人疏啲；每單錯只計一次
export function noteBad(): void {
  if (!jLast || jLast.g !== G) return;
  const bad = G.mistakes + G.angry;
  if (bad > jLast.bad){ CORE_HOOK.breakCombo(); sfx.bad(); G.ease = Math.min(CFG.easeMax, (G.ease || 1) + .12); } // 出錯：客人疏啲（最多 1.2 倍）
  jLast.bad = bad;
}
export function juiceTick(): void {
  if (!G || !G.running || G.station==='decor'){ jLast = null; emit({ k: 'ambient', level: 0 }); return; }
  const bad = G.mistakes + G.angry, inQ = G.groups.length;
  if (!jLast || jLast.g !== G){ jLast = { g:G, bad, inQ, rush:0, fv:0, tw: G.twistHit ? 2 : 0 }; return; }
  noteBad();
  if (inQ > jLast.inQ) sfx.door();
  if (!jLast.rush && G.t > 35){ jLast.rush = 1; toast('繁忙時間嚟喇！'); sfx.fanfare(); }
  // 旺場: told as it starts, at its climax and when it is over, from the shared clock (G.t, G.feverAt), so every
  // phone tells it alike; a phone that joins after it says nothing
  const fx = feverClock(G.feverAt, G.t), [peak] = feverPeak();
  if (!jLast.fv && fx !== null){ jLast.fv = 1; emit({ k: 'fever', on: true }); }
  if (jLast.fv===1 && fx !== null && fx >= peak){ jLast.fv = 2; toast('旺場高峰！頂住！'); sfx.fanfare(); }
  if ((jLast.fv===1 || jLast.fv===2) && fx === null){ jLast.fv = 3; emit({ k: 'fever', on: false }); }
  // the 搏盡 mishap: told from shared state only (G.party.twist, G.twistAt, G.twistHit), so every phone tells it alike
  const tw = twistOf(G);
  if (tw === 'blackout'){
    const dark = blackoutOn(G);
    if (!jLast.tw && dark){ jLast.tw = 1; emit({ k: 'twist', twist: tw, on: true }); }
    else if (jLast.tw===1 && !dark){ jLast.tw = 2; emit({ k: 'twist', twist: tw, on: false }); }
  } else if (tw && tw !== 'rush' && !jLast.tw && G.twistHit){ jLast.tw = 2; emit({ k: 'twist', twist: tw, on: true }); }
  if (jLast.rush < 4 && G.t > 135){ jLast.rush = 4; toast('靜返少少，執吓手尾'); }
  jLast.inQ = inQ;
  // 背景嘈雜聲：人愈多愈嘈
  const people = G.groups.reduce((a, g) => a + g.size, 0);
  emit({ k: 'ambient', level: G.paused ? 0 : Math.min(1, .25 + people / 30) });
}
