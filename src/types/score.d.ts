// Fields owned by the new seats' scoring (core/referee/seatscore.ts, core/career/seats.ts). Global, type-only.
interface TakeGroup {
  /** A takeaway order (via 'pack'): game time every line of the bag was made, so the 外賣 seat's third star times the
   *  packing, not the kitchen. Cleared when a line has to be made again. */
  readyAt?: number;
}
interface GameState {
  /** What a new seat's own work booked this shift while a player drove it: the 燒味 counter's and the 外賣 bags'
   *  takings. A solo shift at 燒味 or 外賣 is starred on these, not the computer shop's takings. */
  seatRev?: Partial<Record<ExtraKind, number>>;
  /** Dishes the 傳菜 seat carried to their tables hot while a player drove it: a solo 傳菜 shift is starred on
   *  this count, not the shop's takings. */
  runHot?: number;
}
