// Types owned by src/career.ts: shift goals, the daily challenge, regulars and celebrities.

/** A boss goal for one shift. `n` is undefined only for a difficulty with no target (as in the JS). */
interface Goal {
  n: () => number | undefined;
  txt: (n: number | undefined) => string;
  ok: (n: number | undefined) => boolean;
}
/** The daily challenge: the same station, time slot and goal for everyone today. */
interface DailyChallenge { station: string; slot: string; goal: string; prize: number }
/** Today's regular (the same for everyone) and the time slot they come in. */
interface TodayReg { key: string; slot: Slot }
/** A fan rush after a celebrity is recognised (careerTick). */
interface Rush { at: number; gid: number; celeb: string; left: number; next: number; started?: boolean }
interface Celeb { name: string; line: string }

/** Fields career.ts adds to the shift state. */
interface GameState {
  goal?: string; goalN?: number | undefined;
  /** This shift is the daily challenge. */
  daily?: boolean;
  rush?: Rush | null;
  /** careerEnd already ran for this shift. */
  scored?: boolean;
}
