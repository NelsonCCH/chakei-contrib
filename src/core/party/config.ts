// Party mode's numbers. Values marked "start" in the design are starting
// points for the bot and the playtest; the sims (tests/sim/party-*.test.js) check what they lead to.
import { TARGET_UNIT, TIERS } from '../career/targets';
import type { TargetTier } from '../career/targets';
import { levelRoles } from '../work/roles';
import type { NightConfig, PartyMetric, RoundKind, RoundSlot, ShopId, ShopPace, Twist } from './types';

/** The shop's four seats, every party shop's (its extra stations come after them: partySeats). */
export const PARTY_SEATS: readonly string[] = ['waiter', 'bar', 'kitchen', 'till'];
/** Room size (8 players + 2 viewers); extra people are onlookers. */
export const PARTY_MAX_PLAYERS = 8;

/** Round lengths. First set at 180 s (下午茶 120 s); tuned up so 一日 lasts 28-35 min. */
export const ROUND_SEC: Record<RoundKind, number> = { breakfast: 240, lunch: 240, tea: 150, dinner: 240, late: 240 };
export const ROUND_NAME: Record<RoundKind, string> = { breakfast: '早市', lunch: '午市', tea: '下午茶', dinner: '晚市', late: '宵夜' };
/** The game flow each round runs on until the shop has 下午茶 and 宵夜 slots of its own. */
export const ROUND_SLOT: Record<RoundKind, Slot> = { breakfast: 'breakfast', lunch: 'lunch', tea: 'breakfast', dinner: 'dinner', late: 'dinner' };
export const DAY_KINDS: readonly RoundKind[] = ['breakfast', 'lunch', 'tea', 'dinner', 'late'];

// Between rounds nothing runs on a clock: the end card waits for everyone's 下一步, the vote for everyone's
// vote, the ready check for everyone's 我準備好 and the host's start. Only these two windows are timed.
/** Once everyone has voted: this long to change a vote before the vote closes. */
export const VOTE_CHANGE_SEC = 5;
/** Once the host starts (everyone ready): the countdown to 開門; anyone un-readying sends it back to waiting. */
export const COUNTDOWN_SEC = 5;
/** The 收舖 ceremony's length, for the night's timing (the close itself waits for 再開一日 or 散水). */
export const CLOSE_SEC = 180;
/** A player counts as having played a round after driving a seat this long (per-person results). */
export const PLAYED_MIN_SEC = 20;

/**
 * The shop ladder, small and slow to big and busy. Each is a level of the original game
 * (src/ui/levels.ts LEVELS, same id): its name, where it is, and its pace, which is how the game plays a level
 * (levelDiff: 熟手 with the level's own customer gap, patience and burn). A test holds these to levels.ts.
 * `for` names the team the shop is set for: its card lines, rent and titles come from a bot team of that skill
 * (scripts/party-calibrate.mjs), so the same team finds each shop up the ladder harder.
 * `float` is how many rents the till opens the night with: 2 at the first shop, whose first-night team swings most
 * from round to round (with 1 it folded on 16% of its nights, the others on 1-3%).
 * `rentQ` overrides RENT_Q for one shop: 機場 sets its rent at a higher quantile of its own team's takings, so a mid team
 * folds there clearly more often than at 中環.
 * `roles` are the shop's extra stations and their tiers (core/work/roles.ts), the same as its level's less 洗碗
 * (no 洗碗 on party nights). A party night seats them after the four (partySeats), and the room runs
 * them (the computer at any seat nobody takes), so the roles arrive up the party ladder in the solo ladder's order: 傳菜
 * at 中環, 外賣 at 旺角. A shop with 傳菜 or 外賣 seats 樓面 instead of 伙記, 傳菜 and 外賣, which are
 * 樓面's tasks there (partyFloor).
 */
export const PARTY_SHOPS: Record<ShopId, { name: string; where: string; for: string; pace: ShopPace; float: number; rentQ?: number; roles?: Partial<Record<ExtraKind, number>> }> = {
  estate: { name: '屋邨茶記', where: '公屋樓下', for: '第一次玩', pace: { gap: 3.2, pat: 1.8, burn: null }, float: 2 },
  central: { name: '中環早餐', where: '寫字樓樓下', for: '玩過幾次', pace: { gap: 2.6, pat: 1.3, burn: null }, float: 1, roles: { runner: 1 } },
  mongkok: { name: '旺角晚市', where: '彌敦道橫街', for: '熟手', pace: { gap: 3.3, pat: 1.2, burn: null }, float: 1, roles: { runner: 2, takeaway: 1 } },
  airport: { name: '機場茶記', where: '離境大堂', for: '好熟手', pace: { gap: 3, pat: .9, burn: null }, float: 1, rentQ: .3, roles: { runner: 3, takeaway: 2 } },
  hell: { name: '地獄午市', where: '打風前夕仲有明星駕到', for: '高手', pace: { gap: 1.5, pat: .75, burn: .6 }, float: 1, roles: { runner: 8, takeaway: 8, roast: 8 } },
};
/** The ladder's order, lowest first: the solo main ladder's (屋邨 → 中環 → 旺角 → 機場), then 地獄午市. */
export const SHOP_LADDER: readonly ShopId[] = ['estate', 'central', 'mongkok', 'airport', 'hell'];
/** 樓面's two party seats (up to two players share 樓面 on a party night; core/work/floor.ts floor1, floor2). */
export const PARTY_FLOOR: readonly string[] = ['floor1', 'floor2'];
/**
 * The shop seats 樓面, which takes 伙記's, 傳菜's and 外賣's work: every party shop does (屋邨 too, as 樓面 runs from
 * level 1), so up to two players share it anywhere. Kept as the one switch the seats and the room read.
 */
export const partyFloor = (shop: ShopId): boolean => SHOP_LADDER.includes(shop);
/** A floor seat of a party night (floor1 / floor2). */
export const isPartyFloor = (seat: string): boolean => PARTY_FLOOR.includes(seat);
/**
 * A party shop's seats: the four, then its extra stations in the pickers' order (core/work/roles.ts levelRoles).
 * A 樓面 shop (partyFloor) seats floor1 and floor2 in 伙記's place and has no 傳菜 or 外賣 seat.
 */
export function partySeats(shop: ShopId): string[] {
  const roles = levelRoles(PARTY_SHOPS[shop]);
  if (!partyFloor(shop)) return [...PARTY_SEATS, ...roles];
  return [...PARTY_FLOOR, ...PARTY_SEATS.filter(s => s !== 'waiter'), ...roles.filter(k => k !== 'runner' && k !== 'takeaway')];
}
/** The next shop up (the top stays where it is): 再開一日 after a strong night. */
export const shopUp = (shop: ShopId): ShopId => SHOP_LADDER[Math.min(SHOP_LADDER.length - 1, SHOP_LADDER.indexOf(shop) + 1)] ?? shop;
/** 收舖 at this title or better (排隊名店), without folding, moves the next night one shop up the ladder. */
export const CLIMB_TITLE = 3;

/** The game's difficulty for a shop's rounds, as levelDiff builds a level's: 熟手 (`base`) with the shop's own pace. */
export function shopDifficulty(base: Difficulty, shop: ShopId): Difficulty {
  const p = PARTY_SHOPS[shop].pace;
  return { ...base, name: PARTY_SHOPS[shop].name, pat: p.pat, gap: p.gap, ...(p.burn === null ? {} : { burn: p.burn }) };
}

export const DEFAULT_NIGHT: NightConfig = { shop: 'estate', days: 1, chooser: 'vote' };

/** The night's rounds, day by day, all in the chosen shop (the step up the ladder is 再開一日's, after a strong night). */
export function partySchedule(cfg: NightConfig): RoundSlot[] {
  const out: RoundSlot[] = [];
  for (let day = 1; day <= cfg.days; day++) {
    for (const kind of DAY_KINDS) out.push({ day, kind, sec: ROUND_SEC[kind], shop: cfg.shop });
  }
  return out;
}

/** The party's stakes per tier in units of the career's TARGET_UNIT ($100): +3 / 0, +8 / −3, +36 / −8. */
export const PARTY_STAKE: Record<TargetTier, { win: number; lose: number }> = {
  safe: { win: 3, lose: 0 },
  bet: { win: 8, lose: 3 },
  allin: { win: 36, lose: 8 },
};
/** The success rate the shop's own team should have per tier. */
export const TIER_AIM: Record<TargetTier, number> = { safe: .8, bet: .5, allin: .25 };
/** Money a card moves, before the token. */
export const stakeOf = (tier: TargetTier): { win: number; lose: number } => ({ win: PARTY_STAKE[tier].win * TARGET_UNIT, lose: PARTY_STAKE[tier].lose * TARGET_UNIT });
/** The tier's name (穩陣 / 搏一搏 / 搏盡), shared with the career. */
export const tierName = (tier: TargetTier): string => TIERS[tier].name;

/**
 * The shared till. Every round's rent and running costs leave the one team till. A round's rent
 * is what the shop's own team takes in that round flow at the RENT_Q quantile of its calibrated takings (so it takes
 * more than the rent in 1 − RENT_Q of its rounds). The night opens with the shop's `float` times the first round's rent
 * in the till. Below $0 the shop owes rent (欠租) and may still earn it back; below $0 at 收舖 it folds (執笠). Tuned by the
 * sims so the shop's own team folds on few nights but runs short on many.
 */
export const RENT_Q = .25;
/** Rent and the opening float round to this ($10: at $1 a second of seat work the first shop's rounds earn ~$400). */
export const RENT_STEP = 10;

/** Follow the team: from the second scored round each line moves halfway toward what the team did, in
 * success-chance terms, by at most this much. */
export const FOLLOW_SHARE = .5;
export const FOLLOW_CAP = .15;
/** A metric is dealt for a tier only if its line can land within this of the tier's aim (count metrics are coarse). */
export const DEAL_SLACK = .12;

/** The metric pool (一齊上 / every station / speed wait for their data). No 'fever' card:
 *  every shift has exactly one fever, so there is nothing to bet on (the metric stays in the types and the lines). */
export const PARTY_METRICS: readonly PartyMetric[] = ['rev', 'clean', 'calm', 'combo', 'tips'];
/** Caps: the card is met at or under the line. */
export const CAP_METRICS: readonly PartyMetric[] = ['clean', 'calm'];
/** Money lines round to this step; counts are whole numbers. */
export const METRIC_STEP: Record<PartyMetric, number> = { rev: 50, tips: 10, clean: 1, calm: 1, combo: 1, fever: 1 };
/** The lowest sensible line per metric (a combo of 2 or no fever at all is not a card). */
export const METRIC_MIN: Record<PartyMetric, number> = { rev: 50, tips: 10, clean: 0, calm: 0, combo: 3, fever: 1 };

export const TWISTS: readonly Twist[] = ['rush', 'critic', 'bigTable', 'blackout'];
export const TWIST_TEXT: Record<Twist, string> = { rush: '人潮長啲', critic: '食評家駕到', bigTable: '八人大枱', blackout: '停電五秒' };

/** The 收舖 title ladder, lowest first. A night that ends below $0 gets 執笠 instead. */
export const TITLES: readonly string[] = ['大牌檔', '街坊茶記', '人氣茶記', '排隊名店', '米芝蓮推介', '茶記傳奇'];
export const FOLD_TITLE = '執笠';
