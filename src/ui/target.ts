// 揀老闆目標同開工前嘅目標卡。自己間舖開工前：揀做法（一個位／輪流做／一腳踢）、揀目標同賭注
// （穩陣／搏一搏／搏盡：越難賺越多，做唔到蝕越多）；撳開工先彈一張卡講清楚今更目標，撳「開工！」個鐘先行。
// The rules (the list, the numbers, met or not, the money) are core/career/targets.ts. The party / lobby version (the host
// or the team picks) is a later job: it calls applyTarget() with the team's choice where careerStart picks a random goal.
import './pressure';   // load order: src/entry.ts
import { $ } from './prefs';
import { must, ownKey } from '../core/util';
import { liveG, station, slot, diff } from '../core/state';
import { STATIONS, SLOTS } from '../core/data/menus';
import { TARGET_METRICS, TARGET_TIERS, TIERS, metricName, targetN, targetPay, targetText, cleanTarget, TARGET_UNIT, type TargetChoice, type TargetSeat } from '../core/career/targets';
import { SOLO_MODES, type SoloMode } from '../core/career/solo';
import { SHOP, saveShop } from './decor';
import { SOLO_NAME, soloMode } from './solo';
import { pressBoxHtml } from './pressure';
import { tutArmed } from './tutorial';
import { levelArmed } from './levels';
import { dailyArmed, dailyChallenge, dailyGoalTxt } from './career';
import { isExtraKind } from '../core/referee/extras';
import { gateOk } from './gates';
import { NET } from '../net/net';
import { start, seg, homeStep, buildMenus } from './main';
import { pickedX } from './xseat';
import { SEAT_NAMES } from './seat';

/** The target saved on the pre-shift screen (the default for a new or old save). */
export const chosenTarget = (): TargetChoice => cleanTarget(SHOP.target);
/** Where the target is measured: the solo modes count the whole shop. */
export const targetSeat = (): TargetSeat => pickedX() || (soloMode() !== 'one' ? 'solo' : station);
/** Sets this shift's goal from a choice (careerStart for a solo own-shop shift; later the party lobby). */
export function applyTarget(c: TargetChoice, seat: TargetSeat): void {
  const S = liveG();
  S.goal = c.metric; S.goalN = targetN(c, seat, S.slot, diff); S.tier = c.tier;
}
const stakeTxt = (t: TargetChoice['tier']): string => { const w = targetPay(t, true), l = -targetPay(t, false); return `做到 +$${String(w)} · ${l ? `做唔到 −$${String(l)}` : '做唔到冇蝕'}`; };

/* ===================== 開工前：做法、目標、賭注 ===================== */
export function renderTargetBox(): void {
  const box = $('targetBox'); if (!box) return;
  const c = chosenTarget(), seat = targetSeat(), open = gateOk('shop');
  box.hidden = !open;
  seg('soloSeg', Object.fromEntries(SOLO_MODES.map(m => [m, SOLO_NAME[m]])), soloMode(), 'solo');
  // 輪流做 / 一腳踢 are the shop's four; with a new seat picked the shift is that one seat, so the 做法 picker goes
  must($('soloH'), 'soloH').hidden = must($('soloSeg'), 'soloSeg').hidden = !!pickedX();
  seg('tgMetric', Object.fromEntries(TARGET_METRICS.map(m => [m, { name: metricName(m, seat), desc: targetText(m, targetN({ metric: m, tier: c.tier }, seat, slot, diff), seat) }])), c.metric, 'tm');
  seg('tgTier', Object.fromEntries(TARGET_TIERS.map(t => [t, { name: TIERS[t].name, desc: stakeTxt(t) }])), c.tier, 'tt');
  must($('tgLine'), 'tgLine').textContent = `${targetText(c.metric, targetN(c, seat, slot, diff), seat)} · ${TIERS[c.tier].name}：${stakeTxt(c.tier)}`;
  must($('pressBox'), 'pressBox').innerHTML = pressBoxHtml();
}
must($('targetBox'), 'targetBox').addEventListener('click', e => {
  const b = e.target instanceof Element ? e.target.closest('button') : null; if (!(b instanceof HTMLButtonElement)) return;
  const d = b.dataset, c = chosenTarget();
  if (d.solo !== undefined){ const m = SOLO_MODES.find(x => x === d.solo); if (m) SHOP.solo = m satisfies SoloMode; }
  else if (d.tm !== undefined){ const m = TARGET_METRICS.find(x => x === d.tm); if (m) SHOP.target = { ...c, metric: m }; }
  else if (d.tt !== undefined){ const t = TARGET_TIERS.find(x => x === d.tt); if (t) SHOP.target = { ...c, tier: t }; }
  else return;
  saveShop(); renderTargetBox();
});

/* ===================== 開工前嘅目標卡 ===================== */
/** The card comes before every shift whose goal the boss sets: the own shop and the daily challenge (not the tutorial, a
 *  level, or co-op, where the host's lobby decides). */
export const introApplies = (): boolean => !tutArmed && !levelArmed && !NET.role;
/** 開工: the goal card first (the clock waits), or straight into the shift where there is no boss goal. */
export function beginShift(): void {
  if (!introApplies()){ start(); return; }
  const view = must($('introView'), 'introView');
  let goal: string, stake: string, how: string;
  if (dailyArmed){
    const dc = dailyChallenge();
    goal = dailyGoalTxt(dc); stake = `第一次做到獎 $${String(dc.prize)}，全港同一批客`;
    how = `${isExtraKind(dc.station) ? `${SEAT_NAMES[dc.station]}（其餘四個位電腦做）` : ownKey(STATIONS, dc.station) ? STATIONS[dc.station].name : ''} · ${ownKey(SLOTS, dc.slot) ? SLOTS[dc.slot].name : ''}`;
  } else {
    const c = chosenTarget(), m = soloMode();
    goal = targetText(c.metric, targetN(c, targetSeat(), slot, diff), targetSeat()); stake = `${TIERS[c.tier].name}：${stakeTxt(c.tier)}`;
    const px = pickedX();
    how = px ? `${SEAT_NAMES[px]}（其餘四個位電腦做）· ${SLOTS[slot].name}` : m === 'one' ? `${STATIONS[station].name} · ${SLOTS[slot].name}` : `${SOLO_NAME[m].name}：${m === 'rotate' ? `由${STATIONS[station].name}開始，每 45 秒轉位` : '撳上面嘅位轉位，電腦頂住你唔喺嗰度嘅位'} · ${SLOTS[slot].name}`;
  }
  must($('introKick'), 'introKick').textContent = dailyArmed ? '每日挑戰' : '老闆目標';
  must($('introGoal'), 'introGoal').textContent = goal;
  must($('introStake'), 'introStake').textContent = stake;
  must($('introHow'), 'introHow').textContent = how;
  must($('introBack'), 'introBack').hidden = dailyArmed;
  must($('endView'), 'endView').hidden = true;   // from 再做一次 / 做埋下一更: the card replaces the end card
  view.hidden = false; must($('introGo'), 'introGo').focus();
}
must($('introGo'), 'introGo').onclick = () => { must($('introView'), 'introView').hidden = true; start(); };
must($('introBack'), 'introBack').onclick = () => {
  must($('introView'), 'introView').hidden = true; must($('endView'), 'endView').hidden = true; must($('startView'), 'startView').hidden = false;
  homeStep('shop'); buildMenus();
};

/* ===================== 收工：賭注 ===================== */
/** The chosen target's money on the end card: + when met, − when missed (0 for a missed 穩陣). Books it in the bank. */
export function targetSettle(met: boolean): { pay: number; html: string } {
  const S = liveG(); if (!S.tier) return { pay: 0, html: '' };
  const pay = targetPay(S.tier, met);
  SHOP.bank += pay;
  const t = TIERS[S.tier];
  return { pay, html: `<div class="wide betw${met ? '' : ' lost'}"><span>老闆目標 · ${t.name}${met ? ' · 做到' : ' · 做唔到'}</span><b>${pay < 0 ? '−' : pay > 0 ? '+' : ''}$${String(Math.abs(pay))}</b><span>${met ? `賭注 ×${String(t.win)}（每份 $${String(TARGET_UNIT)}）` : t.lose ? `蝕 ${String(t.lose)} 份賭注` : '穩陣，冇蝕'}</span></div>` };
}
