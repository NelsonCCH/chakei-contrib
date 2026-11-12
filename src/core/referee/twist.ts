// The 搏盡 card's mishap (意外): a party round played on the all-in card carries
// one twist, dealt by the night (core/party/wager.ts drawTwist) and played here by the referee, its own round only.
//   rush      人潮長啲   the shift's one fever runs TWIST.rushSec instead of CFG.fever.sec (installParty sets it)
//   critic    食評家駕到 one extra table of one or two, 食評家, whose patience is half at every stage
//   bigTable  八人大枱   eight people at once, two groups of four, each needing a whole 卡位
//   blackout  停電五秒   the lights go out for TWIST.blackSec: every phone's shop goes dark (play goes on)
// The twist itself travels in the keyframe (G.party.twist, set from the round start). When it strikes is drawn once from
// the shift's stream on the first open step, like the fever (G.twistAt, shared), so the referee and every phone agree on
// it and the same seed gives the same mishap. A round without the card has no G.party.twist: nothing here runs or draws.
import { liveG, bump } from '../state';
import { CFG } from '../data/menus';
import { genOrder, groupKind, sigLine } from '../rules/order';
import { itemsOf } from '../rules/price';
import { makeGroup } from './customers';
import type { Rng } from '../rng';

/** The mishaps' numbers. `from` / `to`: when a one-off mishap strikes, as shares of the shift (drawn uniform between). */
export const TWIST = { from: .2, to: .6, rushSec: 60, blackSec: 5, criticPat: .5, bigSize: 4, bigGroups: 2 };

/** The round's twist (null: no 搏盡 card, or a plain shift). */
export const twistOf = (S: GameState): string | null => S.party?.twist ?? null;

/**
 * Each referee step (referee/index.ts update, right after the fever): on the first open step the strike time is drawn
 * from `r`; at that time the critic or the big table walks in (once). Rush and blackout need no action here: rush is the
 * fever's length, blackout is read off the clock (blackoutOn).
 */
export function twistTick(r: Rng): void {
  const S = liveG(), tw = twistOf(S);
  if (!tw || tw === 'rush') return;
  if (S.twistAt === undefined) S.twistAt = CFG.gameSec * (TWIST.from + (TWIST.to - TWIST.from) * r());
  if (S.twistHit || S.t < S.twistAt) return;
  S.twistHit = true;
  if (tw === 'critic'){
    let g: SeatGroup; do g = makeGroup(undefined, undefined, r); while (g.size > 2);
    Object.assign(g, { label: '食評家', critic: true, noShare: true });
    g.max *= TWIST.criticPat; g.until = S.t + g.max;
    S.groups.push(g);   // walks in even past a full queue: the twist always happens
  } else if (tw === 'bigTable'){
    for (let i = 0; i < TWIST.bigGroups; i++){
      const g = makeGroup(undefined, undefined, r), o = genOrder(TWIST.bigSize, r);
      Object.assign(g, groupKind(TWIST.bigSize, r), { size: TWIST.bigSize, persons: o.persons, lines: o.lines, label: `八人大枱（${i ? '二' : '一'}）`, big: true, noShare: true });
      g.items = itemsOf(g.persons); sigLine(g, r);
      S.groups.push(g);
    }
  }
  bump();
}

/** The patience multiplier of a group (the critic's is half, at every stage). */
export const twistPat = (g: { critic?: boolean }): number => g.critic ? TWIST.criticPat : 1;

/** The lights are out at game time t (the blackout's TWIST.blackSec from G.twistAt). */
export function blackoutOn(S: GameState, t: number = S.t): boolean {
  return twistOf(S) === 'blackout' && S.twistAt != null && t >= S.twistAt && t < S.twistAt + TWIST.blackSec;
}
