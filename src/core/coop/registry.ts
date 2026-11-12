// The station registry: one entry per station kind, so the referee and the seat
// leases never name a station. An entry says how to take the station's private state out of the shift (`pick`, for a
// grant, a checkpoint or a hand-over), put it back (`put`), and what changes hands with the seat (`toComputer`,
// `toPlayer`). A RefereePlugin adds what the referee does for that kind: results it judges (`onResult`, e.g. a line
// made at that station) and a step of its own (`onStep`). The four shop stations are registered here; a new station
// (stations-next: runner, roast, takeaway) registers with one file (core/coop/plugins/<kind>.ts).
//
// The four shop stations keep their state in `G` (the per-phone view of the shift): the fields listed in PRIVATE are
// the station's, authoritative on the phone that drives the seat; every other field is the referee's (SharedState).
import type { Result, SeatId, StationBlob, StationKind } from '../proto/messages';
import { isObj } from '../proto/validate';
import { liveG, bump, byId, asSeat } from '../state';
import { CFG } from '../data/menus';
import { PORT } from '../env';
import { dropPaid } from './paid';

/** A station kind's state handling (the shop's four, and any station registered later). */
export interface StationModule {
  kind: StationKind;
  /** The format version of `pick`'s value; a hand-over of another version is refused. */
  v: number;
  /** The station's private state, as plain JSON. */
  pick(S: GameState): unknown;
  /** Puts a received state back (a grant, a hand-over); false = refused (malformed: the caller keeps what it has). */
  put(S: GameState, s: unknown): boolean;
  /** The computer takes the seat (on the referee): end what a player had half done that the computer cannot carry on. */
  toComputer?(S: GameState): void;
  /**
   * A player takes the seat (on the referee, before `pick`): give back what the computer held (its own jobs). What
   * the computer has begun it finishes here first, so the player is handed untouched work.
   */
  toPlayer?(S: GameState): void;
  /**
   * The station holds work begun on this phone (a plate on the board, a tray out on the floor, a bag
   * half packed). A player is only ever handed untouched work: after `toPlayer` and at a floor job's start this is false.
   */
  started?(): boolean;
  /** A new floor job starts the station's mini-game from zero (its state on this phone is made afresh). */
  restart?(): void;
  /** The station's own step on the phone that drives it (stations-next modules: the shop's four step in update). */
  step?(dt: number, driver: 'me' | 'computer'): void;
  /** Items waiting at this station, for the cover rule ("quiet with work waiting") and the director. */
  waiting(S: GameState): number;
}

/** What the referee does for a kind. */
export interface RefereePlugin {
  kind: StationKind;
  /** The order-line destination this station makes (`lineDone.dest`), if it makes lines. */
  lineDest?: string;
  /** Judges a result from this kind's seat that the shop's own judge does not know; false = refused. */
  onResult?(seat: SeatId, r: Result): boolean;
  /** A step of the referee for this kind (before the customers move). */
  onStep?(dt: number): void;
}

const STATIONS = new Map<StationKind, StationModule>();
const PLUGINS = new Map<StationKind, RefereePlugin>();
export function registerStation(m: StationModule, p?: RefereePlugin): void { STATIONS.set(m.kind, m); if (p) PLUGINS.set(p.kind, p); }
export const stationOf = (k: StationKind): StationModule | undefined => STATIONS.get(k);
export const pluginOf = (k: StationKind): RefereePlugin | undefined => PLUGINS.get(k);
export const pluginForDest = (dest: string): RefereePlugin | undefined => [...PLUGINS.values()].find(p => p.lineDest === dest);
export const kinds = (): StationKind[] => [...STATIONS.keys()];

/** A station state as it travels (grant, checkpoint, hand-over). */
export function blobOf(S: GameState, kind: StationKind): StationBlob | null {
  const m = STATIONS.get(kind); return m ? { kind, v: m.v, s: m.pick(S) } : null;
}
export function putBlob(S: GameState, b: StationBlob): boolean {
  const m = STATIONS.get(b.kind); return !!m && m.v === b.v && m.put(S, b.s);
}

// ---- the shop's four stations ----
const json = <T>(v: T): T => structuredClone(v);
const isDrafts = (x: unknown): x is DraftLine[] => Array.isArray(x) && x.every(l => isObj(l) && typeof l.t === 'string');
const has = (o: Record<string, unknown>, ks: readonly string[]): boolean => ks.every(k => k in o);
/** Copies the listed fields of a validated object into G (JSON-cloned, so the sender's object is never shared). */
function assign(S: GameState, o: Record<string, unknown>, ks: readonly string[]): void { for (const k of ks) Reflect.set(S, k, json(o[k])); }

/** Fields of `G` private to a station, per kind. */
export const PRIVATE_FIELDS: Readonly<Record<'waiter' | 'bar' | 'kitchen' | 'till', readonly string[]>> = {
  waiter: ['selected', 'sheet', 'aw', 'hintLemon'],
  bar: ['pot', 'ab', 'bench', 'cups'],
  kitchen: ['kit', 'plates', 'ksel', 'hold', 'pi', 'dishes', 'burnt'],
  till: ['cur', 'step', 'entry', 'give', 'charged', 'paid', 'nextCust', 'lastCust', 'at'],
};
/** Fields of `G` that are this phone's own (its screen), never shared. */
// scored / banked: whether this phone has counted its own stars and pay for the shift (each phone banks its own).
export const PHONE_FIELDS: readonly string[] = ['roles', 'station', 'board', 'ver', 'scored', 'banked', 'hostBoard'];

/** The waiter's slips are written on the groups (g.draft, read by the page and the tests): they travel with the waiter. */
function drafts(S: GameState): Record<string, DraftLine[]> {
  const out: Record<string, DraftLine[]> = {};
  for (const g of S.groups) if (!g.take && g.draft) out[String(g.id)] = json(g.draft);
  return out;
}
registerStation({
  kind: 'waiter', v: 1,
  pick: S => ({ selected: S.selected, sheet: S.sheet, aw: S.aw, hintLemon: S.hintLemon ?? false, drafts: drafts(S) }),
  put: (S, s) => {
    if (!isObj(s) || !has(s, ['selected', 'sheet', 'aw', 'drafts']) || !isObj(s.drafts) || !isObj(s.aw)) return false;
    assign(S, s, ['selected', 'sheet', 'aw']); S.hintLemon = s.hintLemon === true;
    const d = s.drafts;
    for (const g of S.groups) if (!g.take){ const x = d[String(g.id)]; g.draft = isDrafts(x) ? json(x) : g.draft ?? null; }
    return true;
  },
  toComputer: S => {
    // a slip the player had open is put away (the group waits laterGrace more seconds); the computer picks it up
    if (S.sheet){ const g = byId(S.sheet.gid); if (g && !g.take && g.state === 'order') g.later = CFG.laterGrace; }
    S.sheet = null; S.selected = null; S.aw = { job: null, until: 0 };
  },
  toPlayer: S => {
    // the computer had picked an order up (taken) but not written it: it goes back to the floor for the player
    if (S.aw.job && S.aw.job.kind === 'order'){ const g = byId(S.aw.job.gid); if (g && !g.take && g.state === 'order') asSeat(g).taken = false; }
    S.aw = { job: null, until: 0 };
  },
  waiting: S => S.groups.filter(g => g.state === 'queue' || (g.state === 'order' && !g.take && !asSeat(g).taken)).length + S.tables.filter(t => t.dirty).length,
});
registerStation({
  kind: 'bar', v: 1,
  pick: S => ({ pot: S.pot, ab: S.ab, bench: S.bench, cups: S.cups }),
  put: (S, s) => { if (!isObj(s) || !has(s, PRIVATE_FIELDS.bar) || !isObj(s.pot) || !isObj(s.bench)) return false; assign(S, s, PRIVATE_FIELDS.bar); return true; },
  // the computer does not work the tea pot: a bar it takes in prep opens the shop with a full pot (as solo handOver does)
  toComputer: S => { S.ab = { cur: null, until: 0 }; if (S.phase === 'prep'){ S.phase = 'open'; S.pot = { level: PORT.potCap(), st: 'ready', until: 0, pulls: 0 }; bump(); } },
  toPlayer: S => { S.ab = { cur: null, until: 0 }; },
  waiting: S => S.groups.reduce((a, g) => a + (g.state === 'wait' && g.drinks ? g.drinks.filter(d => !d.done).length : 0), 0),
}, { kind: 'bar', lineDest: 'bar' });
registerStation({
  kind: 'kitchen', v: 1,
  pick: S => ({ kit: S.kit, plates: S.plates, ksel: S.ksel, hold: S.hold, pi: S.pi, dishes: S.dishes, burnt: S.burnt ?? 0 }),
  put: (S, s) => { if (!isObj(s) || !has(s, PRIVATE_FIELDS.kitchen) || !isObj(s.kit) || !Array.isArray(s.plates)) return false; assign(S, s, PRIVATE_FIELDS.kitchen); return true; },
  toComputer: S => {
    // what the player had not finished, the computer cooks from now on (as the hand-over always did)
    for (const g of S.groups) for (const m of g.meals ?? []) if (!m.done) m.doneAt = Math.max(m.doneAt ?? 0, S.t + 3);
  },
  waiting: S => S.groups.reduce((a, g) => a + (g.state === 'wait' && g.meals ? g.meals.filter(m => !m.done).length : 0), 0),
}, { kind: 'kitchen', lineDest: 'kitchen' });
registerStation({
  kind: 'till', v: 1,
  pick: S => ({ cur: S.cur, step: S.step, entry: S.entry, give: S.give, charged: S.charged, paid: S.paid, nextCust: S.nextCust, lastCust: S.lastCust, at: S.at }),
  // a state from a checkpoint or a hand-over may still hold a customer who has paid since: let them go
  put: (S, s) => { if (!isObj(s) || !has(s, PRIVATE_FIELDS.till) || !isObj(s.at) || !Array.isArray(s.give)) return false; assign(S, s, PRIVATE_FIELDS.till); dropPaid(S); return true; },
  toComputer: S => {
    dropPaid(S);
    // the customer the player was serving goes back to the head of the queue (the computer serves them next)
    if (S.cur){ S.payQ.unshift(S.cur); S.cur = null; }
    S.step = 'total'; S.entry = ''; S.give = [];
  },
  toPlayer: S => {
    dropPaid(S);
    if (S.at.cur){ S.payQ.unshift(S.at.cur); S.at = { cur: null, until: 0 }; }
    S.nextCust = S.t;
  },
  waiting: S => S.payQ.length + (S.cur ? 1 : 0),
});

/** The station that `bump()`s a change after a put (the page redraws on `ver`). */
export function touched(): void { bump(); }
/** For the tests: every registered kind's state of the live shift. */
export const stationStates = (): Record<string, StationBlob | null> => Object.fromEntries(kinds().map(k => [k, blobOf(liveG(), k)]));
