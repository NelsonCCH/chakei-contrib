// Push-to-talk, the phone's side of the floor. The room owns the floor (worker/index.ts); this only
// asks for it, says floorHold every second while it has it, gives it back on every way a finger or a page can leave,
// and keeps what it knows of the floor for the screen. Pure: time is passed in, effects are returned. No imports.

export const HOLD_EVERY_MS = 1000;
/** A floor this phone heard of but never heard end is dropped this long after its turn should have ended. */
export const SHOW_SLACK_MS = 3000;

/** Radio sounds: key = the chirp as a turn starts (ours or another talker's), roger = beep + squelch as it ends. */
export type Beep = 'key' | 'roger' | 'limit' | 'busy';
/**
 * What the caller must do: send a message, open the mic, start / stop sending audio for a turn, play a beep (`own`: the
 * chirp of our own turn, which must not go out in our voice).
 */
export type Fx = { send: PttOut } | { mic: true } | { stream: number } | { stop: true } | { beep: Beep; own?: true };

/** Why a press got no floor (shown on the button until the finger lifts). */
export type Refusal = 'busy' | 'slow' | 'limit' | 'lost' | 'link';
/** The button's state. */
export type Btn = 'idle' | 'asking' | 'talking' | Refusal;

export class FloorClient {
  pressed = false;
  /** This phone's turn while it talks (0 = not talking). */
  turn = 0;
  /** Who holds the floor as far as this phone knows; `until` is in local time. */
  holder: { id: string; name: string; turn: number; until: number } | null = null;
  refused: { why: Refusal; name: string } | null = null;
  private lastHold = 0;
  readonly me: string;
  readonly name: () => string;

  // plain fields, no parameter properties: tests load this file with Node's type stripping, which does not support them
  constructor(me: string, name: () => string) { this.me = me; this.name = name; }

  /** The finger went down on the talk button. */
  press(): Fx[] {
    if (this.pressed) return [];
    this.pressed = true;
    this.refused = null;
    const h = this.holder;
    // Someone else talks: say so at once; the room's answer (busy, or a grant if that turn just ended) follows.
    if (h && h.id !== this.me) this.refused = { why: 'busy', name: h.name };
    return [{ send: { t: 'floorReq', name: this.name() } }, { mic: true }];
  }

  /** The finger is gone (up, cancel, page hidden, ...). Safe to call any number of times. */
  release(): Fx[] {
    if (!this.pressed) return [];
    this.pressed = false;
    this.refused = null;
    if (!this.turn) return [];   // a grant that arrives later is given back at once (floor())
    const turn = this.turn;
    this.turn = 0;
    // stop first: the last part-frame goes out while the turn is still ours
    return [{ stop: true }, { send: { t: 'floorRelease', turn } }, { beep: 'roger' }];
  }

  /** The room says who holds the floor now. */
  floor(m: PttFloorMsg, now: number): Fx[] {
    const fx: Fx[] = [];
    const prev = this.holder;
    if (m.holder) {
      this.holder = { id: m.holder, name: m.name, turn: m.turn, until: now + m.left };
      if (m.holder === this.me) {
        if (!this.pressed) fx.push({ send: { t: 'floorRelease', turn: m.turn } });   // let go before the grant came
        else if (this.turn !== m.turn) {
          if (this.refused && (this.refused.why === 'limit' || this.refused.why === 'lost' || this.refused.why === 'link')) fx.push({ send: { t: 'floorRelease', turn: m.turn } });   // must press again
          else { this.turn = m.turn; this.lastHold = now; this.refused = null; fx.push({ stream: m.turn }, { beep: 'key', own: true }); }
        }
        return fx;
      }
      if (this.turn) {
        this.turn = 0;   // someone else has it: ours is over
        fx.push({ stop: true });
        if (this.pressed) this.refused = { why: 'lost', name: m.name };
      } else if (this.pressed && !this.refused) this.refused = { why: 'busy', name: m.name };
      // another talker's turn starts (not a repeat of the one we know): everyone hears the chirp
      if (!prev || prev.id !== m.holder || prev.turn !== m.turn) fx.push({ beep: 'key' });
      return fx;
    }
    this.holder = null;
    const limit = m.why === 'limit';
    if (this.turn) {
      this.turn = 0;
      fx.push({ stop: true }, { beep: limit ? 'limit' : 'roger' });
      if (this.pressed) this.refused = { why: limit ? 'limit' : 'lost', name: '' };   // lift the finger and press again
    } else if (prev && prev.id !== this.me && m.why) fx.push({ beep: limit ? 'limit' : 'roger' });   // the talker's roger beep
    // Still holding the button while the other talker finished: ask again (a radio transmits once the channel is clear).
    if (this.pressed && this.refused && this.refused.why === 'busy') fx.push({ send: { t: 'floorReq', name: this.name() } });
    return fx;
  }

  /** The room refused a request. */
  no(m: PttNoMsg, now: number): Fx[] {
    if (m.holder && m.holder !== this.me) this.holder = { id: m.holder, name: m.name, turn: m.turn, until: now + m.left };
    if (!this.pressed || this.turn) return [];
    this.refused = { why: m.why, name: m.name };
    return [{ beep: 'busy' }];
  }

  /** Every ~200 ms: the keep-alive, and the local safety nets (a turn past its end, a floor never heard to end). */
  tick(now: number): Fx[] {
    const fx: Fx[] = [];
    const h = this.holder;
    if (this.turn && h && now > h.until + 500) {
      // our own turn ran out and the room's word on it never came: stop sending; the room frees it anyway
      const turn = this.turn;
      this.turn = 0;
      fx.push({ send: { t: 'floorRelease', turn } }, { stop: true }, { beep: 'limit' });
      if (this.pressed) this.refused = { why: 'limit', name: '' };
    } else if (this.turn && now - this.lastHold >= HOLD_EVERY_MS) {
      this.lastHold = now;
      fx.push({ send: { t: 'floorHold', turn: this.turn } });
    }
    if (h && h.id !== this.me && now > h.until + SHOW_SLACK_MS) this.holder = null;
    if (h && h.id === this.me && !this.turn && now > h.until + SHOW_SLACK_MS) this.holder = null;
    return fx;
  }

  /** The link dropped: no turn survives it (the room frees it on the close); what we knew of the floor is stale. */
  linkDown(): Fx[] {
    this.holder = null;
    if (!this.turn) { if (this.pressed) this.refused = { why: 'link', name: '' }; return []; }
    this.turn = 0;
    if (this.pressed) this.refused = { why: 'link', name: '' };
    return [{ stop: true }, { beep: 'roger' }];
  }

  btn(): Btn {
    if (this.turn) return 'talking';
    if (this.refused) return this.refused.why;
    return this.pressed ? 'asking' : 'idle';
  }
}
