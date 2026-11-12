// Effects the shop's rules report instead of playing them: core/ has no DOM, no sound and no timers, so where
// the rules used to call toast(), say(), floatAt(), sfx.x() or a renderer, they emit() an event here. The page's sink
// (src/ui/wire.ts) plays each event the moment it is emitted, so effects keep their exact order relative to the state
// changes around them (and run under the same co-op `netActing` as the call that caused them). Without a sink (a
// simulation, a test in Node) the events queue up and the caller takes them with drainFx().

/** A sound effect of the page's sfx table (src/ui/juice.ts) that the rules trigger. */
export type SfxName = 'pull' | 'pour' | 'cup' | 'ding' | 'ice' | 'sizzle' | 'blup' | 'stir' | 'plate' | 'good' | 'coin' | 'fanfare' | 'broke' | 'bad' | 'door' | 'kiai';

export type Fx =
  /** A message on this phone (ui.ts toast; routed to the teammate whose tap is being applied). */
  | { k: 'toast'; msg: string }
  /** A message for whoever plays `role` (ui.ts say). */
  | { k: 'say'; role: StationId; msg: string }
  /** Text floating up from a table on the floor (ui.ts floatAt). */
  | { k: 'float'; table: number | null; text: string; color: string }
  /** The table refuses the selected group (ui.ts shake). */
  | { k: 'shake'; table: number }
  /** A sound; `n` is its argument (the combo for 'good', a pitch factor for 'blup'); `delay` ms plays it later. */
  | { k: 'sfx'; name: SfxName; n?: number; delay?: number }
  /** Show the combo counter (juice.ts showCombo): `tip` just earned, or `broke`. */
  | { k: 'combo'; tip: number; broke: boolean }
  /** Fever starts or ends (juice.ts feverFx). */
  | { k: 'fever'; on: boolean }
  /** The 搏盡 mishap strikes (on) or, for the blackout, ends (ui/juice.ts twistFx). */
  | { k: 'twist'; twist: string; on: boolean }
  /** The background chatter level, 0..1 (juice.ts ambient), once per frame. */
  | { k: 'ambient'; level: number }
  /** The order sheet opened for group `gid` (waiter.ts draws it; `lemon`: first 「凍檸」, show the hint). */
  | { k: 'sheetOpen'; gid: number; lemon: boolean }
  /** The order sheet changed (redraw it) or closed. */
  | { k: 'sheet'; open: boolean }
  /** The price board / recipe board closed. */
  | { k: 'boardClosed' }
  /** The till keypad changed (redraw it: entry and notes are not part of `ver`). */
  | { k: 'pad' }
  /** The shift is over (the page shows the end card). */
  | { k: 'end' };

const queue: Fx[] = [];
let sink: ((e: Fx) => void) | null = null;
/** The page plays effects as they happen; null = queue them for drainFx(). */
export function setFxSink(f: ((e: Fx) => void) | null): void { sink = f; }
let route: ((e: Fx) => boolean) | null = null;
/**
 * Co-op (core/coop/referee.ts): decides, effect by effect, whether it plays on this phone; false = it is for a
 * teammate's phone (the router sends it there) or for nobody (the computer's seat, or the teammate already predicted it).
 */
export function setFxRoute(f: ((e: Fx) => boolean) | null): void { route = f; }
export const fxRoute = (): ((e: Fx) => boolean) | null => route;
export function emit(e: Fx): void { if (route && !route(e)) return; if (sink) sink(e); else queue.push(e); }
/** The queued effects, oldest first (and the queue emptied). */
export function drainFx(): Fx[] { return queue.splice(0); }

// Shorthands with the names and arguments of the page functions they replace, so the moved rules read as before.
export const toast = (msg: string): void => { emit({ k: 'toast', msg }); };
export const say = (role: StationId, msg: string): void => { emit({ k: 'say', role, msg }); };
export const floatAt = (table: number | null, text: string, color: string): void => { emit({ k: 'float', table, text, color }); };
const play = (name: SfxName) => (n?: number): void => { emit(n === undefined ? { k: 'sfx', name } : { k: 'sfx', name, n }); };
/** sfx.cup(), sfx.good(combo): emits the sound instead of playing it. */
export const sfx: Record<SfxName, (n?: number) => void> = {
  pull: play('pull'), pour: play('pour'), cup: play('cup'), ding: play('ding'), ice: play('ice'), sizzle: play('sizzle'), blup: play('blup'),
  stir: play('stir'), plate: play('plate'), good: play('good'), coin: play('coin'), fanfare: play('fanfare'), broke: play('broke'),
  bad: play('bad'), door: play('door'), kiai: play('kiai'),
};
