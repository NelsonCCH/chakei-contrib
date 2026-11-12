// Career pressure (硬核模式): an opt-in experiment for the solo career. Fixed costs per shift
// played (rent, wages, upkeep; never per real day), a warning streak, and a soft failure the player recovers from: the
// landlord takes the shop back and the player restarts in a smaller one, keeping stars, recipes and looks. Pure numbers
// only; the page (ui/pressure.ts) owns the save, the shop floor and the screens. Party mode never runs it.

export const PRESS = {
  /** Rent per shift by shop size (細舖, 中舖, 大舖) in a district at the reference price (PLACE_REF). */
  sizeRent: [100, 170, 240] as const,
  /** District price the rent above is quoted for; dearer districts pay more, cheaper less (clamped). */
  placeRef: 18000, placeMin: .6, placeMax: 1.6,
  /** Wage per computer helper per shift; half when the player works every station (輪流做 / 一腳踢). */
  wage: 40,
  /** Upkeep per table per shift (water, power, crockery). */
  perTable: 8,
  /** Losing shifts in a row: 1 = a warning on the card, 2 = the landlord's letter, 3 with rent owing = the shop is lost. */
  letterAt: 2, failAt: 3,
  /** Profitable shifts in the smaller shop before the landlord offers the old one back (東山再起). */
  comeback: 5,
  /** 師傅's red packet to restart with after the shop is lost. */
  restart: 500,
};

export interface CostInput {
  /** Shop size index (0..2). */ size: number;
  /** The district's price (ui/market.ts placePrice). */ placePrice: number;
  /** The player owns the district (the mortgage is paid): no rent. */ owned: boolean;
  /** Tables in the shop. */ tables: number;
  /** Stations the computer covers this shift. */ helpers: number;
  /** The player works every station in turn (輪流做 / 一腳踢): helpers are on call, half wage. */ allStations: boolean;
}
export interface Costs { rent: number; wages: number; upkeep: number; total: number }

export function shiftCosts(c: CostInput): Costs {
  const f = Math.min(PRESS.placeMax, Math.max(PRESS.placeMin, c.placePrice / PRESS.placeRef));
  const rent = c.owned ? 0 : Math.round((PRESS.sizeRent[Math.max(0, Math.min(2, c.size))] ?? PRESS.sizeRent[0]) * f / 10) * 10;
  const wages = Math.max(0, c.helpers) * (c.allStations ? PRESS.wage / 2 : PRESS.wage);
  const upkeep = Math.max(0, c.tables) * PRESS.perTable;
  return { rent, wages, upkeep, total: rent + wages + upkeep };
}

/** The pressure state kept in the save (Shop.press). */
export interface PressState {
  /** Losing shifts in a row. */ red: number;
  /** Rent owing: what the bank could not cover. */ debt: number;
  /** Times the shop was lost. */ fails: number;
  /** Profitable shifts since the shop was lost (counts to PRESS.comeback while a lost shop waits). */ back: number;
}
export const PRESS0: PressState = { red: 0, debt: 0, fails: 0, back: 0 };
export function cleanPress(v: unknown): PressState {
  const n = (k: keyof PressState): number => {
    const x: unknown = v && typeof v === 'object' ? Reflect.get(v, k) : 0;
    return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1e9 ? Math.floor(x) : 0;
  };
  return { red: n('red'), debt: n('debt'), fails: n('fails'), back: n('back') };
}

/** 0 = fine, 1 = a losing shift (warning), 2 = the landlord's letter, 3 = the shop is lost this shift. */
export type PressStage = 0 | 1 | 2 | 3;
export interface Settled { bank: number; press: PressState; repaid: number; owed: number; stage: PressStage; fail: boolean }

/**
 * After a shift: `bank` is the savings with everything this shift paid or cost already booked (it may be negative), and
 * `net` how much the shift changed them. A negative bank becomes rent owing; savings pay owing rent back first. A losing
 * shift adds to the streak and a profitable one clears it. The shop is lost after PRESS.failAt losing shifts in a row
 * while rent is owing; then the owing is written off, the streak cleared, and the player restarts with PRESS.restart.
 * `lostWaiting`: a lost shop is waiting to be won back (profitable shifts count towards it).
 */
export function settleShift(bank: number, net: number, p: PressState, lostWaiting: boolean): Settled {
  let debt = p.debt, b = bank, repaid = 0, owed = 0;
  if (b < 0){ owed = -b; debt += owed; b = 0; }
  else if (debt > 0){ repaid = Math.min(b, debt); debt -= repaid; b -= repaid; }
  const red = net < 0 ? p.red + 1 : 0;
  const back = lostWaiting && net >= 0 ? p.back + 1 : p.back;
  if (red >= PRESS.failAt && debt > 0)
    return { bank: PRESS.restart, press: { red: 0, debt: 0, fails: p.fails + 1, back: 0 }, repaid, owed, stage: 3, fail: true };
  const stage: PressStage = red >= PRESS.letterAt ? 2 : red >= 1 ? 1 : 0;
  return { bank: b, press: { red, debt, fails: p.fails, back }, repaid, owed, stage, fail: false };
}
