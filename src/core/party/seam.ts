// The seam between the party night and the co-op referee. The
// referee owns one PartySeam per room and calls exactly these four things:
//
//   input(ev)        a phone's party input (lobby setup, seat, vote, token, 下一步, 我準備好, 開工, 再開一日, 散水), and the
//                    room's join / leave, already tagged with the sender's PlayerId by the room
//   tick(dt)         every fixed step, in game seconds: the between-round screens run on it
//   roundResult(r)   once, when a round's clock ends: the per-seat results (RoundReport)
//   night()          the night's state, for the 4 Hz broadcast to the phones and the TV
//
// and acts on what comes back (PartyOut): 'roundStart' (start a shift with this plan: slot, length, shop and pace, the
// chosen card, twist, seats), 'drive' (mid-round: hand this seat's lease to a player or the computer, state included),
// 'host' (host duty moved), 'phase' / 'settled' (for the screens), 'reject' (tell the sender why).
// The night itself is plain JSON, so a host change (option 2) or the Durable Object (option 3) carries it as it is.
import { newNight, nightInput, nightResult, nightTick } from './night';
import type { NightConfig, NightState, PartyEvent, PartyOut, RoundReport } from './types';

export interface PartySeam {
  input(ev: PartyEvent): PartyOut[];
  tick(dt: number): PartyOut[];
  roundResult(r: RoundReport): PartyOut[];
  night(): NightState;
}

/** A seam over a night (new, or restored from a saved / handed-over state). */
export function partySeam(seedOrState: number | NightState, cfg: Partial<NightConfig> = {}, prevBank: number | null = null): PartySeam {
  let s: NightState = typeof seedOrState === 'number' ? newNight(seedOrState, cfg, prevBank) : structuredClone(seedOrState);
  const run = (step: { s: NightState; out: PartyOut[] }): PartyOut[] => { s = step.s; return step.out; };
  return {
    input: ev => run(nightInput(s, ev)),
    tick: dt => run(nightTick(s, dt)),
    roundResult: r => run(nightResult(s, r)),
    night: () => s,
  };
}
