// The end card after each round: the team line first, then each station on its own scale.
// A view model only: plain data from a settled round, for the phones, the TV and the tests. No drawing here.
import { STATIONS } from '../data/menus';
import { ROUND_NAME, tierName } from './config';
import { lastText } from './wager';
import type { NightState, PlayerId, RoundKind, RoundRecord, SeatId, StationReport } from './types';

/** A station column's heading: 伙記, 水吧, 廚房, 收銀 (傳菜 and later kinds by their own names). */
const KIND_NAME: Record<string, string> = { runner: '傳菜', roast: '燒味', takeaway: '外賣', floor: '樓面' };
const isStation = (k: string): k is StationId => Object.prototype.hasOwnProperty.call(STATIONS, k);
export function stationName(kind: string): string {
  return isStation(kind) ? STATIONS[kind].name : KIND_NAME[kind] ?? kind;
}

export interface EndColumn {
  seat: SeatId;
  kind: string;
  title: string;
  /** Who worked this station this round (the computer when nobody did). */
  names: string[];
  stars: number;
  measures: StationReport['measures'];
  best: string | null;
}

export interface EndCard {
  round: number;
  day: number;
  kind: RoundKind;
  name: string;
  /** The last round of the night: the next screen is 收舖. */
  last: boolean;
  team: {
    card: { tier: string; tierName: string; text: string; last: string | null } | null;
    met: boolean | null;
    /** Money the card won or lost (after the token). */
    cardDelta: number;
    /** What the round put in the till: the players' pay at their own seats, scaled to a team of four. */
    takings: number;
    /** The shop's till takings this round, a display only; null on an older report. */
    sales: number | null;
    /** Each player's pay this round (their own seats' jobs less their mistakes), best first. */
    pays: { player: PlayerId; name: string; pay: number }[];
    /** The round's rent, paid from the shared till. */
    rent: number;
    bank: number;
    bankBefore: number;
    maxCombo: number;
    fevers: number;
    token: boolean;
    twist: string | null;
  };
  columns: EndColumn[];
}

const nameOf = (s: NightState, id: PlayerId): string => s.players.find(p => p.id === id)?.name ?? id;

/** The end card for a settled round (the latest by default). Null before any round has been settled. */
export function endCard(s: NightState, round?: number): EndCard | null {
  const r: RoundRecord | undefined = round === undefined ? s.history.at(-1) : s.history.find(x => x.round === round);
  if (!r) return null;
  const t = r.report.team;
  return {
    round: r.round, day: r.day, kind: r.kind, name: ROUND_NAME[r.kind], last: r.round >= s.schedule.length - 1,
    team: {
      card: r.card ? { tier: r.card.tier, tierName: tierName(r.card.tier), text: r.card.text, last: r.card.last === null ? null : lastText(r.card.metric, r.card.last) } : null,
      met: r.met, cardDelta: r.cardDelta, takings: r.takings, sales: t.sales ?? null, rent: r.rent, bank: r.bankAfter,
      pays: r.report.players.filter(p => p.pay !== undefined).map(p => ({ player: p.player, name: nameOf(s, p.player), pay: p.pay ?? 0 })).sort((a, b) => b.pay - a.pay),
      bankBefore: r.bankBefore, maxCombo: t.maxCombo, fevers: t.fevers, token: r.token, twist: r.twist,
    },
    columns: r.report.stations.map(st => {
      const names = st.drivers.filter(d => d.sec > 0).sort((a, b) => b.sec - a.sec).map(d => nameOf(s, d.player));
      return {
        seat: st.seat, kind: st.kind, title: stationName(st.kind), names: names.length ? names : ['電腦'], stars: st.stars,
        measures: st.measures, best: st.best,
      };
    }),
  };
}

/** The column a player's own phone opens with detail: the station they drove longest this round. */
export function myColumn(card: EndCard, s: NightState, player: PlayerId): EndColumn | null {
  const r = s.history.find(x => x.round === card.round);
  if (!r) return null;
  let best: SeatId | null = null, sec = 0;
  for (const st of r.report.stations) for (const d of st.drivers) if (d.player === player && d.sec > sec) { best = st.seat; sec = d.sec; }
  return card.columns.find(c => c.seat === best) ?? null;
}
