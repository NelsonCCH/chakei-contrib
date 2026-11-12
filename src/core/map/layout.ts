// The shop floor's map: a 45-degree hall plus Sims-style
// cutaway rooms, laid out in ART TILES (the art's tile, about 0.32 m: a booth table is 2.8 tiles deep), as
// the original prototype's room composer placed them. Pure data: no canvas, no DOM; ui/floor-map.ts draws it.
//
// Floor coordinates (u, v) in tiles: u along the right-hand back wall, v along the left-hand back wall, (0, 0) the back
// corner. A strip of rooms runs along the right-hand back wall (v < STRIP): kitchen, then each station room the level's
// `roles` open (燒味), the drinks bar, and the takeaway bay by the entrance. The hall (v > STRIP) holds the booths
// along the left-hand wall, the other tables in a grid, and by the entrance the cake case and the till. Outside the
// two front walls (u = W, v = D) runs a plain street: pavement, kerb, road. Waiting customers queue OUTSIDE, on the
// pavement along the front wall next to the entrance.

export const STRIP = 10.5;      // the rooms' depth from the right-hand back wall
export const WALL_T = 0.4;      // a wall's thickness
export const DOOR = 3.2;        // a doorway (about 1 m)
export const PAVE = 3.5, KERB = 0.35, ROAD = 7.0;   // the pavement along the shop front, the kerb, the road
export const WALL_TOP = 2.9;    // the back walls' height, x a booth back
export const STUB = 0.30;       // a cut-down wall's height, x a booth back
// spacing that keeps every pair of bubbles apart (tuned in the original prototype's room composer). The
// same aisles with less slack, so the fitted map draws larger: side 6 -> 5, between rows 5 -> 4.2, behind the
// partition 4 -> 3.4, between wall booths 1.6 -> 1.1, to the till 6 -> 5, the front floor 3 -> 2, behind the paying
// customer 4.5 -> 3.6 (HALL_TAIL). Walkable for a 0.5 m walker (tests/sim/map-path.test.js); the bubbles' own spacing
// is floor-map.ts spread, which keeps their 48 pt tap discs apart at any scale.
const SIDE_AISLE = 5.0, ROW_AISLE = 4.2, BACK_AISLE = 3.4, BOOTH_GAP = 1.1, COUNTER_AISLE = 5.0, FRONT_ROOM = 2.0, HALL_TAIL = 3.6;
export const QUEUE_GAP = 4.8;   // tiles between queueing parties' heads: their 48 pt tap targets clear each other
export const MEMBER_GAP = 1.3;  // tiles between the members of one queueing party
// furniture footprints (half extents along u, v), from set1/atlas/floor.json `foot`
export const FOOT = {
  booth_table: [2.398, 1.4], bench: [2.524, 1.124], square_table: [1.75, 1.75], stool: [0.459, 0.469],
  counter: [0.374, 3.4], cake_case: [0.345, 1.4], pass: [2.2, 0.635], bar: [2.5, 0.211], takeaway: [1.85, 0.404],
  roast_case: [3.3, 0.613], chop_table: [3.3, 1.359], roast_counter: [2.95, 1.011], wok_range: [4.4, 1.343],
  prep_counter: [1.028, 3], fridge: [1.5, 0.815],
  bar_back: [1.7, 0.187], takeaway_shelf: [2.346, 0.454], crate_stack: [0.85, 0.609],
} as const satisfies Record<string, readonly [number, number]>;
const WALL_GAP = 0.12;
const BOOTH_REACH = WALL_GAP + 2 * FOOT.bench[0];                          // how far a booth reaches into the hall (u)
const BOOTH_LEN = 2 * FOOT.bench[1] + 2 * FOOT.booth_table[1] + 2 * FOOT.bench[1] + 0.05;   // one booth along v
const SQ = FOOT.square_table[0] + 0.45 + FOOT.stool[1];                    // a square table's reach from its centre, stools in
const WALL_BOOTHS = 4;          // booths along the left-hand wall; any more stand in the hall grid

export type RoomKind = 'kitchen' | 'roast' | 'bar' | 'takeaway';
export const ROOM_W: Readonly<Record<RoomKind, number>> = { kitchen: 12.5, roast: 10.5, bar: 8.0, takeaway: 0 };
export const ROOM_ZH: Readonly<Record<RoomKind, string>> = { kitchen: '廚房', roast: '燒味', bar: '水吧', takeaway: '外賣' };
export interface Room { kind: RoomKind; u0: number; u1: number }
/** A part placed on the floor: the art manifest's part name, its floor point, mirrored or not, and its depth (u + v). */
export interface Placed { part: string; u: number; v: number; mirror?: boolean; z?: number }
export type Facing = '+v' | '+u' | '-v' | '-u';
/** One seat at a table: the floor point (u, v) the diner's hips sit over, which way they face, and whether the table
 *  is in front of them (far: the tabletop hides their legs) or they are in front of it (near: their back to us). */
export interface Seat { u: number; v: number; face: Facing; near: boolean }
export interface MapTable {
  tid: number; kind: 'booth' | 'square'; u: number; v: number; wall: boolean;
  /** Seat order: as the game fills them (one member each). */
  seats: Seat[];
  /** The footprint quad (table + benches / stools), [u0, u1, v0, v1]: the tap target and the shadow. */
  box: [number, number, number, number];
}
/** Where a kind of bubble sits: the work's own spot in the shop. */
export type SpotKind = 'pass' | 'bag' | 'deliver' | 'roast' | 'till';
export interface Spot { kind: SpotKind; u: number; v: number; z: number; dir: Facing }
/** A staff member standing at their station. */
export interface Staff { look: string; u: number; v: number; face: Facing; behind?: string }
export interface MapLayout {
  key: string; W: number; D: number; rooms: Room[]; tables: MapTable[];
  /** Furniture and equipment that never move (drawn by depth with the tables and people). */
  parts: Placed[];
  /** Flat decor hung on the back walls: part, wall ('R' along u at v = 0, 'L' along v at u = 0), along, height (px). */
  walls: { part: string; wall: 'L' | 'R'; s: number; z: number }[];
  staff: Staff[];
  /** The entrance: a gap in the u = W front wall over v0..v1. */
  door: [number, number];
  /** The till column: cake case and counter along v from cv0, fronts +u. */
  till: { u: number; v0: number; v1: number; pay: [number, number] };
  spots: Spot[];
  /** The partition (v = STRIP) openings: intervals along u (doors, the pass, counters set into it). */
  gaps: [number, number][];
  /** Room name boards on the back wall: text over u0..u1. */
  signs: { text: string; u0: number; u1: number }[];
}

/** What the map needs to know about a level: its tables in the game's order, and the stations its `roles` open. */
export interface MapSpec { tables: readonly { kind: string }[]; roles: { runner?: number; roast?: number; takeaway?: number } }

const booth = (tid: number, u: number, v0: number, wall: boolean): MapTable => {
  const fb = v0 + FOOT.bench[1], tv = v0 + 2 * FOOT.bench[1] + FOOT.booth_table[1], nb = tv + FOOT.booth_table[1] + FOOT.bench[1];
  // two diners a bench, side by side along u: the far bench's first (they face the camera), then the near bench's
  const du = [-1.05, 1.05];
  const seats: Seat[] = [
    ...du.map(d => ({ u: u + d, v: fb + 0.1, face: '+v' as const, near: false })),
    ...du.map(d => ({ u: u + d, v: nb - 0.1, face: '-v' as const, near: true })),
  ];
  return { tid, kind: 'booth', u, v: tv, wall, seats, box: [u - FOOT.bench[0], u + FOOT.bench[0], v0, v0 + BOOTH_LEN] };
};
const square = (tid: number, u: number, v: number): MapTable => {
  // diners only on the two far sides, so the top hides their legs; a 2-seat table uses both
  const sit = FOOT.square_table[0] + 0.25;
  const seats: Seat[] = [{ u, v: v - sit, face: '+v', near: false }, { u: u - sit, v, face: '+u', near: false },
    { u: u + 0.9, v: v - sit, face: '+v', near: false }, { u: u - sit, v: v + 0.9, face: '+u', near: false }];
  return { tid, kind: 'square', u, v, wall: false, seats, box: [u - SQ, u + SQ, v - SQ, v + SQ] };
};

/** The rooms a level's roles open, in the strip's order from the back corner. */
export function roomsOf(roles: MapSpec['roles']): RoomKind[] {
  const out: RoomKind[] = ['kitchen'];
  if (roles.roast) out.push('roast');
  out.push('bar');
  if (roles.takeaway) out.push('takeaway');
  return out;
}

/** The whole map of a level (deterministic: the same spec gives the same map). */
export function mapLayout(spec: MapSpec): MapLayout {
  const rooms0 = roomsOf(spec.roles), take = rooms0.includes('takeaway');
  // tables: the first WALL_BOOTHS booths along the left-hand wall, everything else into the hall grid
  const idx = spec.tables.map((t, i) => ({ i, booth: t.kind === 'booth' }));
  const wallB = idx.filter(t => t.booth).slice(0, WALL_BOOTHS), rest = idx.filter(t => !wallB.includes(t));
  const rows = Math.max(2, Math.min(3, rest.length)), cols = Math.max(1, Math.ceil(rest.length / rows));
  const v0 = STRIP + WALL_T / 2;
  const uCol = (c: number): number => BOOTH_REACH + SIDE_AISLE + SQ + c * (2 * SQ + ROW_AISLE);
  const vRow = (r: number): number => v0 + BACK_AISLE + SQ + r * (2 * SQ + ROW_AISLE);
  const tables: MapTable[] = [];
  wallB.forEach((t, k) => { tables.push(booth(t.i, WALL_GAP + FOOT.bench[0], v0 + 0.6 + k * (BOOTH_LEN + BOOTH_GAP), true)); });
  // the grid fills column by column from the booths' side, so the hall's free side stays by the till
  rest.forEach((t, n) => {
    const c = Math.floor(n / rows), r = n % rows, u = uCol(c), v = vRow(r);
    tables.push(t.booth ? booth(t.i, u, v - BOOTH_LEN / 2, false) : square(t.i, u, v));
  });
  tables.sort((a, b) => a.tid - b.tid);
  const lastU = uCol(cols - 1) + SQ;
  // the till column: cake case then counter along v, fronts +u
  const ctrA = FOOT.counter[0], cu = lastU + COUNTER_AISLE + ctrA;
  const hallW = cu + ctrA + HALL_TAIL;
  const fixed = rooms0.reduce((a, r) => a + ROOM_W[r], 0);
  const rooms: Room[] = [];
  let ru = 0;
  for (const r of rooms0){ const w = ROOM_W[r] || Math.max(hallW - fixed, 8.0); rooms.push({ kind: r, u0: ru, u1: ru + w }); ru += w; }
  const W = Math.max(hallW, ru);
  const colLen = 2 * (FOOT.cake_case[1] + FOOT.counter[1]) + 0.25;
  const cv0 = v0 + (take ? 6.5 : 2.5), cv1 = cv0 + colLen;
  const door: [number, number] = [cv1 + 1.0, cv1 + 1.0 + 2 * DOOR];
  const wallEnd = wallB.length ? v0 + 0.6 + wallB.length * (BOOTH_LEN + BOOTH_GAP) - BOOTH_GAP : 0;
  const gridEnd = rest.length ? vRow(rows - 1) + SQ : 0;
  const D = Math.max(wallEnd, gridEnd, door[1]) + FRONT_ROOM;
  const parts: Placed[] = [], walls: MapLayout['walls'] = [], staff: Staff[] = [], spots: Spot[] = [], gaps: [number, number][] = [];
  const signs: MapLayout['signs'] = [];
  for (const rm of rooms){
    const { u0, u1 } = rm, mid = (u0 + u1) / 2;
    if (rm.kind === 'kitchen'){
      const ru2 = u0 + 6.2;
      parts.push({ part: 'wok_range', u: ru2, v: 0.25 + FOOT.wok_range[1] });
      parts.push({ part: 'hood', u: ru2, v: 0.3, z: 0 });
      parts.push({ part: 'prep_counter', u: 0.25 + FOOT.prep_counter[0], v: 2.4 + FOOT.prep_counter[1] });
      parts.push({ part: 'stock_pot', u: u1 - 1.6, v: 1.6 });
      parts.push({ part: 'crates', u: 1.3, v: STRIP - 1.3 });
      walls.push({ part: 'utensil_rail', wall: 'R', s: ru2 + 2.6, z: 120 }, { part: 'wall_fan', wall: 'L', s: 1.4, z: 175 });
      staff.push({ look: 'wok_cook', u: ru2, v: 0.25 + 2 * FOOT.wok_range[1] + 0.9, face: '-v' });
      const pu = u1 - 4.2;
      parts.push({ part: 'pass', u: pu, v: STRIP });
      gaps.push([pu - FOOT.pass[0], pu + FOOT.pass[0]], [u0 + 2.0, u0 + 2.0 + DOOR]);
      spots.push({ kind: 'pass', u: pu, v: STRIP + 0.6, z: 80, dir: '+v' });
      signs.push({ text: '廚房', u0: u0 + 1.5, u1: u0 + 5.0 });
    } else if (rm.kind === 'roast'){
      const cu2 = u0 + 4.0;
      parts.push({ part: 'roast_counter', u: mid + 0.6, v: 0.25 + FOOT.roast_counter[1] });
      walls.push({ part: 'meat_rail', wall: 'R', s: mid - 2.4, z: 130 });
      parts.push({ part: 'chop_table', u: cu2, v: STRIP - 3.6 });
      parts.push({ part: 'roast_case', u: cu2, v: STRIP - 0.15 });
      staff.push({ look: 'roast_cook', u: cu2 + 0.4, v: STRIP - 2.0, face: '+v', behind: 'roast_case' });
      gaps.push([cu2 - FOOT.roast_case[0], cu2 + FOOT.roast_case[0]], [u1 - 1.0 - DOOR, u1 - 1.0]);
      spots.push({ kind: 'roast', u: cu2, v: STRIP + 0.8, z: 175, dir: '+v' });
      signs.push({ text: '燒味', u0: u0 + 3.2, u1: u0 + 6.6 });
    } else if (rm.kind === 'bar'){
      const bu = u0 + 3.2;
      parts.push({ part: 'bar', u: bu, v: STRIP });
      parts.push({ part: 'fridge', u: u1 - 0.5 - FOOT.fridge[0], v: 0.25 + FOOT.fridge[1] });
      parts.push({ part: 'bar_back', u: u0 + 2.4, v: 0.25 + FOOT.bar_back[1] + 0.3 });
      parts.push({ part: 'urns', u: u0 + 1.6, v: 0.6, z: 80 });
      walls.push({ part: 'jar_shelf', wall: 'R', s: u0 + 2.6, z: 145 });
      staff.push({ look: 'barman', u: bu + 0.4, v: STRIP - 1.5, face: '+v', behind: 'bar' });
      gaps.push([bu - FOOT.bar[0], bu + FOOT.bar[0]], [u1 - 1.0 - DOOR, u1 - 1.0]);
      signs.push({ text: '水吧', u0: u0 + 3.6, u1: u0 + 6.9 });
    } else {
      const tu = u0 + 1.4 + FOOT.takeaway[0];
      parts.push({ part: 'takeaway', u: tu, v: STRIP });
      parts.push({ part: 'takeaway_shelf', u: Math.min(u0 + 1.0 + FOOT.takeaway_shelf[0], u1 - 0.5 - FOOT.takeaway_shelf[0]), v: 0.25 + FOOT.takeaway_shelf[1] });
      parts.push({ part: 'bag_pile', u: u1 - 2.0, v: 0.25 + 2 * FOOT.takeaway_shelf[1] + 1.4 });
      staff.push({ look: 'cashier', u: tu, v: STRIP - 1.4, face: '+v', behind: 'takeaway' });
      gaps.push([tu - FOOT.takeaway[0], tu + FOOT.takeaway[0]], [u1 - 1.0 - DOOR, u1 - 1.0]);
      spots.push({ kind: 'bag', u: tu, v: STRIP + 0.4, z: 120, dir: '+v' });
      signs.push({ text: '外賣', u0: u0 + 2.0, u1: u0 + 5.3 });
    }
  }
  // the till: cake case, then the counter, fronts +u; the cashier behind it, the paying customer in front
  parts.push({ part: 'cake_case', u: cu, v: cv0 + FOOT.cake_case[1] });
  const vc = cv0 + 2 * FOOT.cake_case[1] + 0.25 + FOOT.counter[1];
  parts.push({ part: 'counter', u: cu, v: vc });
  staff.push({ look: 'cashier', u: cu - 1.5, v: vc, face: '+u', behind: 'counter' });
  // 送外賣's rider exit: just outside the entrance, on the pavement (the bubble faces the street)
  spots.push({ kind: 'deliver', u: W + 1.2, v: door[0] - 1.6, z: 0, dir: '+u' });
  const key = [rooms0.join('+'), ...spec.tables.map(t => t.kind)].join(',');
  return { key, W, D, rooms, tables, parts, walls, staff, door, till: { u: cu, v0: cv0, v1: cv1, pay: [cu + 2.2, vc] }, spots, gaps, signs };
}

/**
 * Where the waiting queue's parties stand: OUTSIDE, on the pavement along the u = W front wall,
 * starting next to the entrance and growing toward the front corner, then round it along the v = D front. `sizes`: each
 * party's head count, in queue order. Returns each member's floor point, party by party (the first member leads).
 */
export function queueSpots(lay: MapLayout, sizes: readonly number[]): [number, number][][] {
  const lineU = lay.W + PAVE * 0.5, lineV = lay.D + PAVE * 0.5;
  // the path: down the u = W pavement from the door's front edge to the corner, then along v = D toward u = 0
  const leg1 = lineV - (lay.door[1] + 0.8), total = leg1 + lineU;
  const at = (s: number): [number, number] => s <= leg1 ? [lineU, lay.door[1] + 0.8 + s] : [lineU - (s - leg1), lineV];
  const out: [number, number][][] = [];
  let s = 0.6;
  for (const n of sizes){
    const pts: [number, number][] = [];
    for (let k = 0; k < n; k++) pts.push(at(Math.min(total, s + k * MEMBER_GAP)));
    out.push(pts);
    s += Math.max(QUEUE_GAP, n * MEMBER_GAP + 1.4);
  }
  return out;
}

/** Is the floor point outside the building's walls (on the street side)? */
export const outside = (lay: MapLayout, u: number, v: number): boolean => u > lay.W || v > lay.D;
