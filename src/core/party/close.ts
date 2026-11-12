// 收舖, the close of the night: the day's takings, the shop's title from the ladder, the group's
// own history, and awards, at least one per person who played. Pure data for the ceremony and the team card.
import { CLIMB_TITLE, FOLD_TITLE, PARTY_SHOPS, TITLES, shopUp } from './config';
import { TITLE_LINES } from './lines';
import { stationName } from './endcard';
import type { NightState, PlayerId, RoundRecord, ShopId } from './types';

/** The ladder's thresholds for the night (set per shop, from its own team's nights, and per number of days). */
export function titleLines(s: NightState): readonly number[] {
  return TITLE_LINES[s.cfg.shop]?.[String(s.cfg.days)] ?? TITLE_LINES['mongkok']?.[String(s.cfg.days)] ?? [];
}
/** The title's place on the ladder (0 = 大牌檔 ... 5 = 茶記傳奇) for a till; −1 when it ends below $0 (執笠). */
export function titleIx(bank: number, lines: readonly number[]): number {
  if (bank < 0) return -1;
  return Math.min(TITLES.length - 1, lines.filter(x => bank >= x).length);
}
/** The title's words, 執笠 for a night that ended below $0. */
export const titleName = (ix: number): string => ix < 0 ? FOLD_TITLE : TITLES[ix] ?? '';

/**
 * The bank the night would have ended on if the finale's wager (the last round's card) had moved nothing,
 * (the round's takings and rent still booked): the comeback measure compares the two titles.
 */
export function bankWithoutFinale(s: NightState): number {
  const last = s.history.at(-1);
  if (!last) return s.bank;
  return last.bankBefore + last.takings - last.rent;
}

export interface Award { key: string; name: string; why: string }
export interface CloseCard {
  shop: string;
  bank: number;
  title: string;
  /** −1 when the night ended below $0 (執笠). */
  titleIx: number;
  folded: boolean;
  /** 再開一日 moves up to this shop (the night reached 排隊名店 without folding), or null to stay. */
  nextShop: string | null;
  /** The next title up and how far it was, when there is one. */
  nextTitle: { title: string; short: number } | null;
  prevBank: number | null;
  rounds: number;
  cardsWon: number;
  cardsLost: number;
  /** Everyone who played at least one round, in join order, with their awards. */
  people: { id: PlayerId; name: string; rounds: number; awards: Award[] }[];
}

/** One person's night, from the rounds they played. */
interface Tally {
  id: PlayerId; name: string; rounds: number; sec: number; done: number; avgSec: number; mistakes: number; burnt: number;
  exact: number; helps: number; hurries: number; streak: number; worst: number; worstRound: string; bySeat: Record<string, number>;
}

function tallies(s: NightState): Tally[] {
  const out: Tally[] = [];
  for (const p of s.players) {
    const played = s.history.filter(r => p.rounds.includes(r.round));
    if (!played.length) continue;
    const t: Tally = { id: p.id, name: p.name, rounds: played.length, sec: 0, done: 0, avgSec: 0, mistakes: 0, burnt: 0, exact: 0, helps: 0, hurries: 0, streak: 0, worst: -1, worstRound: '', bySeat: {} };
    let timeSum = 0;
    for (const r of played) {
      for (const st of r.report.stations) for (const d of st.drivers) if (d.player === p.id) { t.sec += d.sec; t.bySeat[st.kind] = (t.bySeat[st.kind] ?? 0) + d.sec; }
      const x = r.report.players.find(q => q.player === p.id);
      if (!x) continue;
      t.done += x.done; timeSum += x.avgSec * x.done; t.mistakes += x.mistakes; t.burnt += x.burnt; t.exact += x.exact;
      t.helps += x.helps; t.hurries += x.hurries; t.streak = Math.max(t.streak, x.streak);
      if (x.mistakes > t.worst) { t.worst = x.mistakes; t.worstRound = roundName(r); }
    }
    t.avgSec = t.done ? timeSum / t.done : 0;
    out.push(t);
  }
  return out;
}
const roundName = (r: RoundRecord): string => ({ breakfast: '早市', lunch: '午市', tea: '下午茶', dinner: '晚市', late: '宵夜' })[r.kind];

/** The awards, in the order they are given out. Each goes to its best eligible person; ties go to who joined first. */
const AWARDS: { key: string; name: string; ok: (t: Tally) => boolean; score: (t: Tally) => number; why: (t: Tally) => string }[] = [
  { key: 'fast', name: '最快手', ok: t => t.done >= 5 && t.avgSec > 0, score: t => -t.avgSec, why: t => `平均每單 ${t.avgSec.toFixed(1)} 秒` },
  { key: 'exact', name: '金手指', ok: t => t.exact >= 1, score: t => t.exact, why: t => `${String(t.exact)} 次找啱晒` },
  { key: 'rescue', name: '救火隊長', ok: t => t.helps >= 1, score: t => t.helps, why: t => `幫手 ${String(t.helps)} 次` },
  { key: 'burnt', name: '燶嘢之王', ok: t => t.burnt >= 1, score: t => t.burnt, why: t => `燶咗 ${String(t.burnt)} 碟` },
  { key: 'hurry', name: '催命符', ok: t => t.hurries >= 1, score: t => t.hurries, why: t => `催咗 ${String(t.hurries)} 次` },
  { key: 'disaster', name: '最佳災難', ok: t => t.worst >= 3, score: t => t.worst, why: t => `${t.worstRound}錯咗 ${String(t.worst)} 次` },
  { key: 'steady', name: '穩如泰山', ok: t => t.streak >= 8, score: t => t.streak, why: t => `連續 ${String(t.streak)} 單冇錯` },
  { key: 'busy', name: '勤力王', ok: t => t.done >= 1, score: t => t.done, why: t => `做咗 ${String(t.done)} 單` },
  { key: 'iron', name: '鐵人', ok: t => t.rounds >= 2, score: t => t.sec, why: t => `做足 ${String(t.rounds)} 更` },
];

/** Awards for everyone who played: the named awards first, then a station star for anyone still without one. */
export function awards(s: NightState): Map<PlayerId, Award[]> {
  const ts = tallies(s), got = new Map<PlayerId, Award[]>(ts.map(t => [t.id, []]));
  for (const a of AWARDS) {
    let best: Tally | null = null;
    for (const t of ts) if (a.ok(t) && (!best || a.score(t) > a.score(best))) best = t;
    if (best) got.get(best.id)?.push({ key: a.key, name: a.name, why: a.why(best) });
  }
  // Nobody leaves without one: the station they worked longest, or a teammate's thanks.
  const given = new Set<string>();
  for (const t of ts) {
    const mine = got.get(t.id);
    if (!mine || mine.length) continue;
    const kind = Object.entries(t.bySeat).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'waiter';
    const star = `${stationName(kind)}之星`;
    if (!given.has(star)) { given.add(star); mine.push({ key: 'star:' + kind, name: star, why: `${stationName(kind)}企足 ${String(Math.round(t.sec))} 秒` }); }
    else mine.push({ key: 'mate', name: '最佳拍檔', why: `一齊做咗 ${String(t.rounds)} 更` });
  }
  return got;
}

/** The shop the next night opens in: one up the ladder after a night at 排隊名店 or better that did not fold. */
export function climbTo(s: NightState): ShopId {
  return titleIx(s.bank, titleLines(s)) >= CLIMB_TITLE ? shopUp(s.cfg.shop) : s.cfg.shop;
}

/** Everything the 收舖 ceremony and the team card show. */
export function closeCard(s: NightState): CloseCard {
  const lines = titleLines(s), ix = titleIx(s.bank, lines), next = ix < 0 ? 0 : lines[ix];
  const got = awards(s), to = climbTo(s);
  return {
    shop: PARTY_SHOPS[s.cfg.shop].name, bank: s.bank, title: titleName(ix), titleIx: ix, folded: ix < 0,
    nextShop: to === s.cfg.shop || s.cfg.shop === 'hell' ? null : PARTY_SHOPS[to].name,
    nextTitle: next !== undefined && ix < TITLES.length - 1 ? { title: TITLES[ix + 1] ?? '', short: next - s.bank } : null,
    prevBank: s.prevBank, rounds: s.history.length,
    cardsWon: s.history.filter(r => r.met === true).length, cardsLost: s.history.filter(r => r.met === false).length,
    people: s.players.filter(p => got.has(p.id)).map(p => ({ id: p.id, name: p.name, rounds: p.rounds.length, awards: got.get(p.id) ?? [] })),
  };
}
