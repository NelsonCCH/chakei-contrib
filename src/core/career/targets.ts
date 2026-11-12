// The 老闆目標 the player chooses before a solo shift: a target and a stake. Pure rules: the
// list, the numbers, whether a shift met its target and what that pays or costs. The page (ui/target.ts) shows the
// choice and books the money; the party / lobby version later picks through the same `TargetChoice`.
import { cash } from '../util';

/** What the target measures: takings (營業額), a mistake cap (出錯), walk-outs (嬲走), a combo (連擊). */
export type TargetMetric = 'rev' | 'clean' | 'calm' | 'combo';
/** How hard: 穩陣 (a median player meets it ~80% of the time), 搏一搏 (~50%), 搏盡 (~25%). */
export type TargetTier = 'safe' | 'bet' | 'allin';
export interface TargetChoice { metric: TargetMetric; tier: TargetTier }
/** Where the player stands this shift: one station, or the solo modes (輪流做 / 一腳踢) that work all four. */
export type TargetSeat = StationId | ExtraKind | 'solo';

export const TARGET_METRICS: readonly TargetMetric[] = ['rev', 'clean', 'calm', 'combo'];
export const TARGET_TIERS: readonly TargetTier[] = ['safe', 'bet', 'allin'];
export const METRIC_NAME: Record<TargetMetric, string> = { rev: '營業額', clean: '少出錯', calm: '冇人嬲走', combo: '連擊' };
/** win / lose in units of TARGET_UNIT (+1 / 0, +2.5 / −1, +10 / −2). */
export const TIERS: Record<TargetTier, { name: string; win: number; lose: number }> = {
  safe: { name: '穩陣', win: 1, lose: 0 },
  bet: { name: '搏一搏', win: 2.5, lose: 1 },
  allin: { name: '搏盡', win: 10, lose: 2 },
};
/** One unit of stake: the old second-star prize, so a 穩陣 target pays what the random boss goal paid. */
export const TARGET_UNIT = 100;
export const DEFAULT_TARGET: TargetChoice = { metric: 'rev', tier: 'safe' };

/** Median takings of a 3-minute lunch shift in the player's own shop, per seat, played by the sim's human "mid" profile
 *  (tests/sim/human.js; solo = 輪流做). The kitchen keeps its earlier x1 numbers: the sim's
 *  kitchen bot cooks one meal at a time and cannot stand in for a person there. Re-measured at the re-paced free
 *  play; the kitchen's numbers are scaled by the drop in customers (x .58 / .56 / .61), an estimate. The extra seats
 * are the mid profile alone at the seat (scripts/xseat-calibrate.mjs).
 *  The new seats' combos book tips; 燒味 and 外賣 hold the seat's own takings (shiftMeasure).
 *  All measured with the levels' stations, the cutting, the 外賣 hand and 10 solo orders,
 *  16 seeds (the four and solo: a scratch run of runShift, solo = 輪流做 from the waiter; kitchen kept as above).
 *  The new seats: 32 seeds; 傳菜's is a dish count (its hot dishes, countSeat).
 *  外賣 measured (32 seeds) with 外賣 introduced at 旺角. */
export const REV_MEDIAN: Record<string, Record<TargetSeat, number>> = {
  rookie: { waiter: 1290, bar: 690, kitchen: 370, till: 1150, solo: 880, runner: 16, roast: 300, takeaway: 440 },
  pro: { waiter: 1070, bar: 840, kitchen: 520, till: 1300, solo: 1040, runner: 21, roast: 250, takeaway: 430 },
  ace: { waiter: 1050, bar: 710, kitchen: 620, till: 1270, solo: 1100, runner: 18, roast: 160, takeaway: 530 },
};
/**
 * Seats a solo shift is judged on the money their own work booked: with the computer at the four, the shop's
 * takings at 燒味 and 外賣 came mostly from the computer (an idle 外賣 player still made the first star). Their
 * REV_MEDIAN and STAR_LINES hold these takings (G.seatRev).
 */
export const ownTakeSeat = (seat: string | undefined): seat is 'roast' | 'takeaway' => seat === 'roast' || seat === 'takeaway';
/**
 * 傳菜 is judged on the dishes it put on their tables hot (G.runHot), never the shop's takings: on the levels
 * with 外賣 and 燒味 those include the computer's sales, and an idle runner made the first star. A knock-out or a dish
 * left to go cold at the pass is a mistake. Its REV_MEDIAN and STAR_LINES hold dish counts.
 */
export const countSeat = (seat: string | undefined): seat is 'runner' => seat === 'runner';
/** What a shift is measured on: the seat's own takings at 燒味 / 外賣, the hot dishes at 傳菜, else the shop's takings. */
export const shiftMeasure = (S: GameState): number => S.coop ? S.revenue : ownTakeSeat(S.xseat) ? Math.round(S.seatRev?.[S.xseat] ?? 0) : countSeat(S.xseat) ? (S.runHot ?? 0) : S.revenue;
/** An amount on that measure as the player reads it: 「$540」, 「540 分」 or 「12 碟」. */
export const measureTxt = (seat: string | undefined, n: number): string => countSeat(seat) ? `${String(n)} 碟` : cash(n);
/** The measure's name: 營業額, 熱餸上枱, 燒味收入 or 外賣收入. */
/**
 * What the 少出錯 and 冇人嬲走 targets count: for a work seat its own slips and losses (洗碗: pieces the hand
 * broke plus wrong-tool slips; pieces lost to an overflowing pile), else the shop's mistakes and walk-outs.
 */
export const shiftSlips = (S: GameState): { mistakes: number; angry: number } =>
  ({ mistakes: S.mistakes, angry: S.angry });
export const measureName = (seat: string | undefined): string => seat === 'roast' ? '燒味收入' : seat === 'takeaway' ? '外賣收入' : countSeat(seat) ? '熱餸上枱' : '營業額';
/** A target's name on the picker for that seat: the sink's 少出錯 / 冇碗碟堆爆. */
export const metricName = (m: TargetMetric, seat: string | undefined): string => m === 'rev' ? measureName(seat) : METRIC_NAME[m];
/** Customer flow of the time slot relative to lunch (as the old boss goal: ui/career.ts SLOT_F). */
export const SLOT_REV: Record<Slot, number> = { breakfast: .85, lunch: 1, dinner: 1.1 };
/** Revenue line per tier as a share of the median: shift-to-shift spread is ~10%. */
export const REV_TIER: Record<TargetTier, number> = { safe: .85, bet: 1, allin: 1.15 };
/** Mistakes allowed, walk-outs allowed, combo to reach (pro; the combo scales with the difficulty as the old goal did). */
export const CLEAN_TIER: Record<TargetTier, number> = { safe: 3, bet: 1, allin: 0 };
export const CALM_TIER: Record<TargetTier, number> = { safe: 2, bet: 1, allin: 0 };
/** The sink's caps: breaks + slips allowed, pieces lost to the pile allowed. */
/** 外賣's walk-outs allowed: bags left standing ready at the bell count (referee/seatscore.ts seatsClose); the mid
 *  profile leaves 2-3 a shift (it packs about 3 bags), so the shop's 2 / 1 / 0 would be a coin toss at 穩陣. */
export const TAKE_CALM_TIER: Record<TargetTier, number> = { safe: 3, bet: 2, allin: 1 };
export const COMBO_TIER: Record<TargetTier, number> = { safe: .6, bet: 1, allin: 1.6 };
export const COMBO_BASE: Record<string, number> = { rookie: 6, pro: 10, ace: 14 };
/**
 * The new seats' combo: the mid profile's median longest combo alone at the seat, own shop lunch
 * (scripts/xseat-calibrate.mjs). A seat does far fewer jobs a shift than the waiter (a 外賣 bag, a 斬料 order), so the
 * four's COMBO_BASE was out of reach there.
 */
// Measured over 16 seeds; 外賣 3 -> 8 with the measured hand and 10 orders a solo shift
export const COMBO_SEAT: Record<string, Record<ExtraKind, number>> = {
  rookie: { runner: 11.5, roast: 5, takeaway: 8 },
  pro: { runner: 12, roast: 4, takeaway: 8 },
  ace: { runner: 6, roast: 1.5, takeaway: 9 },
};
/**
 * The most a seat's combo can ask: the station's own bot at full pace (no hand faster), its lower quartile in the
 * own shop. A seat's jobs are capped by the shop (傳菜 carries the tables the computer cooks for; 外賣 bags come at the
 * order pace), so the four's ×1.6 for 搏盡 would ask for more jobs than the shift has.
 */
// 外賣 7 -> 9 (the bot's lower quartile with 10 orders a solo shift; 7 sat under the mid median of 8)
export const COMBO_CAP: Record<ExtraKind, number> = { runner: 11, roast: 9, takeaway: 9 };
/** A new seat's combo per tier: the median scaled as the four's (COMBO_TIER), 搏盡 at most COMBO_CAP, each tier above the last. */
function seatCombo(seat: ExtraKind, tier: TargetTier, diff: string): number {
  const m = (COMBO_SEAT[diff] ?? COMBO_SEAT['pro'])?.[seat] ?? 4, at = (t: TargetTier): number => Math.round(m * COMBO_TIER[t]);
  const allin = Math.max(4, Math.min(COMBO_CAP[seat], at('allin'))), bet = Math.max(3, Math.min(at('bet'), allin - 1)), safe = Math.max(2, Math.min(at('safe'), bet - 1));
  return tier === 'allin' ? allin : tier === 'bet' ? bet : safe;
}
/**
 * 少出錯 and 冇人嬲走 need work done: at least WORK_MIN jobs right (G.goods), at any seat, so a shift that does
 * nothing no longer passes them on zero mistakes, or on customers whose patience outlasts a 3-minute shift.
 */
export const WORK_MIN = 3;
const worked = (goods: number | undefined): boolean => goods === undefined || goods >= WORK_MIN;
/** Whether a shift with `mistakes` and `goods` jobs right meets a 少出錯 cap of `n`. */
export const cleanMet = (n: number, mistakes: number, goods: number | undefined): boolean => mistakes <= n && worked(goods);
/** Whether a shift with `angry` walk-outs and `goods` jobs right meets a 冇人嬲走 cap of `n`. */
export const calmMet = (n: number, angry: number, goods: number | undefined): boolean => angry <= n && worked(goods);
const isX = (s: string): s is ExtraKind => s === 'runner' || s === 'roast' || s === 'takeaway';

/** The number a target asks for (a revenue line, a cap, or a combo). */
export function targetN(c: TargetChoice, seat: TargetSeat, slot: Slot, diff: string): number {
  if (c.metric === 'rev') {
    const base = (REV_MEDIAN[diff] ?? REV_MEDIAN['pro'] ?? { solo: 1420 })[seat] ?? 1420;
    // work points and one seat's takings are small: round finer; 傳菜's dishes to the dish
    const step = countSeat(seat) ? 1 : ownTakeSeat(seat) ? 10 : 50;
    return Math.round(base * SLOT_REV[slot] * REV_TIER[c.tier] / step) * step;
  }
  if (c.metric === 'clean') return CLEAN_TIER[c.tier];
  if (c.metric === 'calm') return (seat === 'takeaway' ? TAKE_CALM_TIER : CALM_TIER)[c.tier];
  if (isX(seat)) return seatCombo(seat, c.tier, diff);
  return Math.max(3, Math.round((COMBO_BASE[diff] ?? 10) * COMBO_TIER[c.tier]));
}
/** What the shift did, as the target reads it. `goods`: jobs done right (少出錯 needs CLEAN_MIN; absent: not checked). */
export interface TargetScore { revenue: number; mistakes: number; angry: number; maxCombo: number; goods?: number }
export function targetMet(metric: TargetMetric, n: number, s: TargetScore): boolean {
  if (metric === 'rev') return s.revenue >= n;
  if (metric === 'clean') return cleanMet(n, s.mistakes, s.goods);
  if (metric === 'calm') return calmMet(n, s.angry, s.goods);
  return s.maxCombo >= n;
}
/** Money the target moves: + when met, − when missed (0 for a missed 穩陣). */
export function targetPay(tier: TargetTier, met: boolean): number {
  const t = TIERS[tier];
  return Math.round((met ? t.win : -t.lose) * TARGET_UNIT) + 0;   // + 0: a missed 穩陣 is 0, not -0
}
/** The line the player reads (the same words as the old boss goals). */
export function targetText(metric: TargetMetric, n: number, seat?: TargetSeat): string {
  if (metric === 'rev') return countSeat(seat) ? `熱辣辣上枱做到 ${String(n)} 碟` : `${measureName(seat)}做到 ${cash(n)}`;
  if (metric === 'clean') return n === 0 ? '一張單都唔可以錯' : `出錯唔好多過 ${String(n)} 次`;
  if (metric === 'calm') return n === 0 ? '一個客都唔可以嬲走' : `嬲走唔好多過 ${String(n)} 個`;
  return `連擊做到 ${String(n)}`;
}
/** A saved choice from an old or edited save: anything unknown falls back to the default. */
export function cleanTarget(v: unknown): TargetChoice {
  if (!v || typeof v !== 'object') return { ...DEFAULT_TARGET };
  const m: unknown = Reflect.get(v, 'metric'), t: unknown = Reflect.get(v, 'tier');
  const metric = TARGET_METRICS.find(x => x === m), tier = TARGET_TIERS.find(x => x === t);
  return { metric: metric ?? DEFAULT_TARGET.metric, tier: tier ?? DEFAULT_TARGET.tier };
}
