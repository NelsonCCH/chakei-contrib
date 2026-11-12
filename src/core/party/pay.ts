// What a party round earns: the sum of each player's work at their own seats, not the till's
// takings. A seat's job (core/referee/speed.ts G.spd: counted only while a player drives it) pays its size in a mid
// player's seconds (core/work/load.ts) at PAY_PER_SEC; a mistake of theirs takes MISTAKE_PAY off. A player's pay is
// their share of each seat's jobs (by the seconds they drove it) at that seat's rate, less their own mistakes, at least 0.
// The round's money is the players' pay summed and scaled to a team of TEAM_SEATS whole seats (x TEAM_SEATS / seat-rounds
// played, at least one), so a night's rent, card lines and titles (calibrated for a team at the shop's four) mean the same
// with one player or eight: the payout keys on how well the seats were worked, not on how many were. The till's takings
// stay a display (RoundReport team.sales).
import { taskSec } from '../work/load';

/** Dollars per second of a mid player's work done. */
export const PAY_PER_SEC = 2.5;
/** A mistake (a wrong slip, drink, plate, bill or bag) takes this off its player's pay. */
export const MISTAKE_PAY = 15;
/** The team the round's money is scaled to: the shop's four seats, as the lines were set for. */
export const TEAM_SEATS = 4;

/** Mid seconds of one job at a seat, as G.spd counts them (a slip taken with its seating and clearing; a drink; a meal;
 *  a bill; a dish carried; a roast dish; a bag; 樓面's work counted in its own seconds: one "job" is one mid second). */
export function jobSec(seat: string, slot: Slot): number {
  switch (seat){
    case 'waiter': return taskSec('seat') + taskSec('order', 2, slot) + 1;
    case 'bar': return taskSec('drink');
    case 'kitchen': return taskSec('meal', 0, slot);
    case 'till': return taskSec('pay', 2, slot);
    case 'runner': return taskSec('carry') / 1.5;
    case 'floor': return 1;
    case 'roast': return taskSec('chop');
    case 'takeaway': return taskSec('bag', 2, slot);
    default: return 0;
  }
}
/** Dollars one job at a seat pays, to the cent (樓面's job is one second; a player's pay is rounded once, in roundPay). */
export const jobPay = (seat: string, slot: Slot): number => Math.round(jobSec(seat, slot) * PAY_PER_SEC * 100) / 100;

export interface PayPart { player: string; pay: number }
/**
 * The round's pay. `jobs[seat][player]`: jobs each player did at each seat; `mistakes[player]`; `seatSec`: the seat-seconds
 * players drove in all; `sec`: the round's length. Returns each player's pay and the round's money (team-scaled).
 */
export function roundPay(jobs: Record<string, Record<string, number>>, mistakes: Record<string, number>, seatSec: number, sec: number, slot: Slot): { parts: PayPart[]; sum: number; money: number } {
  const by = new Map<string, number>();
  for (const [seat, per] of Object.entries(jobs)) for (const [p, n] of Object.entries(per)) by.set(p, (by.get(p) ?? 0) + n * jobPay(seat, slot));
  for (const p of Object.keys(mistakes)) if (!by.has(p)) by.set(p, 0);
  const parts = [...by.entries()].map(([player, v]) => ({ player, pay: Math.max(0, Math.round(v - (mistakes[player] ?? 0) * MISTAKE_PAY)) }));
  const sum = parts.reduce((a, x) => a + x.pay, 0), played = sec > 0 ? seatSec / sec : 0;
  return { parts, sum, money: Math.round(sum * TEAM_SEATS / Math.max(1, played)) };
}
