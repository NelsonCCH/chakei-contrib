// Shared game types (global, type-only). They describe the objects the game already builds; the shapes follow the
// original JS exactly. Fields other scripts add are optional here until
// those scripts are converted and the field gets a proper owner.

type Slot = 'breakfast' | 'lunch' | 'dinner';
type StationId = 'waiter' | 'kitchen' | 'bar' | 'till';
/** The extra stations a co-op room can open: 傳菜 runner, 燒味 roast, 外賣 takeaway. */
type ExtraKind = 'runner' | 'roast' | 'takeaway';
/** 'me' = this phone plays it, 'remote' = a teammate plays it, 'ai' = the computer fills in. */
type Role = 'me' | 'ai' | 'remote';
type DishFlag = '炒底' | '加底' | '走青';
/** 樓面: the floor's seats floor1..3 (2-3 players share the role); `floor` is the role as this phone sees it (any of them). */
type FloorSeatId = 'floor' | 'floor1' | 'floor2' | 'floor3';
/** A floor task's kind (core/work/load.ts claimable tasks): seat a party, take an order, carry food, clear, bag, deliver. */
type FloorKind = 'seat' | 'order' | 'carry' | 'clear' | 'bag' | 'deliver';
/** One open floor task (core/work/floor.ts). `by`: the player (or '#cpu:<seat>') holding the claim; null = open. Times are
 *  the referee's game clock: `at` appeared, `free` became open (the computer's cover delay counts from here), `ct` claimed,
 *  `seen` the claimer last said it is still on it (a claim not touched for CLAIM_IDLE_S times out). */
interface FloorTask { id: string; k: FloorKind; at: number; by: string | null; free: number; ct: number; seen: number }
/** A bagged order waiting for (or on) a 送外賣 run: `cold` = game time its food goes cold; `rider` while on a run. */
interface FloorOut { gid: number; no: number; cold: number; items: number; rider: string | null; /** bags in its run while on one (for the tip bonus) */ run?: number }
/** The floor's shared state: plain JSON, in every keyframe. */
interface FloorShared {
  tasks: FloorTask[]; out: FloorOut[];
  /** Players out on a 送外賣 run: the game time they left. */
  away: Record<string, number>;
  /** The computer's floor workers, one per floor seat it drives: the task it is on and when it finishes. */
  bots: Record<string, { task: string | null; until: number }>;
  stats: { claims: number; lost: number; expired: number; cpu: number; drops: number; cold: number };
  /** The floor budget's running remainder per task kind (core/work/floor.ts floorStep). */
  acc?: Partial<Record<FloorKind, number>>;
}

interface MenuItem { id: string; p: number }
interface DrinkDef extends MenuItem { iced?: boolean; hot?: boolean; sw?: boolean }
interface SetDef extends MenuItem { top: string }
interface DishDef extends MenuItem { sauce: boolean }

interface DrinkOrder { d: string; cold: boolean; sweet: number; noice: boolean }
interface SetOrder { id: string; noodle: string; egg: string; bread: string; hongdai: boolean; feibin: boolean }
interface DishOrder { id: string; 炒底: boolean; 加底: boolean; 走青: boolean }
/** One customer's order. Lunch uses `food`, breakfast `set`, dinner `dish`; a regular's breakfast has no `food` key. */
interface Person { food?: string | null; set?: SetOrder | null; dish?: DishOrder | null; drink: DrinkOrder }

interface SlotDef { name: string; desc: string; start: number; endTxt: string; gap?: number }
interface Difficulty {
  name: string; desc?: string; slow: number; pat: number; gap: number;
  sgap: number; spat: number; burn: number; seat: number;
}
interface StationDef { name: string; desc: string }
interface Regular {
  label: string;
  /** career.js adds regulars whose orders cover only some time slots. */
  persons: Partial<Record<Slot, Person[]>>;
  persist?: boolean; rank?: number; story?: string[]; enter?: string; who?: string;
}

interface Grade { correct: boolean; complaint?: string }
/** One drink or meal on a ticket, as the bar / kitchen sees it. */
interface OrderLine {
  k: string; done: boolean; ok: boolean; redo?: boolean; doneAt?: number;
  /** With a runner seat: made and waiting on the pass since this time; deleted when the runner carries it. */
  passT?: number; stale?: boolean;
  /** The party director: this line's work was counted for its seat (1) and on the pass (2). */
  dn?: number;
}
interface PayLine { k: string; struck: boolean; extra: boolean }
/** Points at line `i` of group `gid`'s drinks (bar) or meals (kitchen). */
interface LineRef { gid: number; i: number }
/** A random stream as plain data (core/rng.ts drawState): mulberry32's one word of state. */
interface RngState { a: number }
/** What the computer waiter is doing (core/bots/waiter.ts): data, so the shift state is plain JSON. */
type AwJob = { kind: 'order'; gid: number } | { kind: 'seat'; gid: number; table: number } | { kind: 'clean'; table: number };

type GroupState = 'queue' | 'think' | 'order' | 'wait' | 'eat' | 'pay';
interface GroupBase {
  id: number; color: string; label: string; size: number; state: GroupState; table: number | null;
  items: string[]; max: number; until: number;
  // Seated groups only; optional here so code walking every group can test them.
  regular?: string; celeb?: string; noShare?: boolean;
  /** The 搏盡 mishaps (core/referee/twist.ts): the 食評家 (half patience) and the 八人大枱 groups. */
  critic?: boolean; big?: boolean;
  // Set when the order is sent (seated groups) or at creation (takeaway).
  slip?: string[]; result?: Grade; drinks?: OrderLine[]; meals?: OrderLine[];
  drinkMax?: number; drinkUntil?: number; mealMax?: number; mealUntil?: number;
  /** Game time it sat down / its order was sent (or the takeaway arrived): the third star's timings (core/referee/speed.ts). */
  seatAt?: number; orderAt?: number;
  /** With a roast seat: roast dishes (MENU names of the roast station) this group ordered at the counter. */
  roast?: OrderLine[];
  /** The party director: this bill / bag was counted for its seat. */
  dn?: number;
}
/** A group that comes through the door, sits, orders, eats and pays. */
interface SeatGroup extends GroupBase {
  take?: undefined; via?: undefined; no?: undefined;
  /** The waiter's slip being written (waiter.js). */
  draft: DraftLine[] | null;
  persons: Person[]; lines: string[];
  /** Always from grade(), so it always has a complaint ('' when correct). */
  result?: { correct: boolean; complaint: string };
  repeat?: boolean; date?: boolean;
  peeked?: boolean; taken?: boolean; later?: number | null; returns?: number;
  // Set when the group gets up to pay (toPay).
  expect?: number; payLines?: PayLine[]; paySay?: string[]; octo?: boolean; octoShort?: boolean; tableName?: string;
  /** Workload model (core/referee/work.ts): the group's prep lines by seat, and the 燒味 dishes its diners will
   *  order at the roast counter once the order goes in. */
  wl?: { bar: number; kitchen: number; roast: number }; roastPlan?: string[];
  /** A takeaway order's bill at the till: the order number; the order is made once this is paid. */
  takeNo?: number;
}
/** A takeaway customer at the street tea stall (levels with `takeaway`): drinks only, served by the bar. */
interface TakeGroup extends GroupBase {
  take: true; slip: string[]; result: Grade; drinks: OrderLine[]; meals: OrderLine[]; drinkMax: number; drinkUntil: number;
  /** An extra station's customer: a 斬料 walk-in at the roast counter, or a takeaway order to pack. Absent: the tea stall. */
  via?: 'roast' | 'pack'; no?: number;
  /** Workload model: the order was paid at the till before it was made (`packed` then books only the tip); it
   *  goes out with a delivery (送外賣) rather than being collected. */
  prepaid?: boolean; deliver?: boolean;
}
type Group = SeatGroup | TakeGroup;
/** A takeaway order waiting for its bill to be paid: what to make and bag once it is. */
interface WorkBill { no: number; keys: string[]; roast: string[]; deliver: boolean }
/** The workload model's shared state (core/referee/work.ts): plain JSON, so it travels in keyframes and saves. */
interface WorkShared {
  /** Prep seconds booked per prep seat: the order-mix generator's memory. */
  acc: { bar: number; kitchen: number; roast: number };
  /** Seconds of work (the mid profile's) booked per seat, and per task kind [count, seconds]. */
  load: Record<string, number>; tasks: Record<string, [number, number]>;
  nextTake: number | null; nextChop: number | null;
  /** Takeaway bills in the pay queue: the bill's id -> its order's group id (called off if the bill runs). */
  bills: Record<string, number>;
  takes: number; chops: number;
}

interface Table { name: string; cap: number; kind: string }
interface TableState extends Table { id: number; dirty: number }
/** A regular's or a celebrity's planned visit this shift (career.js planVisitors). */
interface Visit { key?: string; at: number; date?: boolean; celeb?: string; today?: boolean }
interface ErrEntry { tb: string; said: string; wrote: string[]; want: string[]; say: string | undefined }
/** A job in a stove slot; kitchen.ts (types/kitchen.d.ts) adds the rest. A wok job has no ready time. */
interface KitJob { item: string; ready?: number }
interface HoldItem { tk: string; t: number }

/** The whole shop during a shift (`G`). Built by newGame() in rules.ts. */
interface GameState {
  slot: Slot; station: string; /** Partial: the home-screen backdrop (showBackdrop) sets only waiter and till. */
  roles: Partial<Record<StationId | ExtraKind | FloorSeatId, Role>>;
  phase: 'prep' | 'open'; rt: number; cups: number;
  pot: { level: number; st: string; until: number; pulls: number };
  ab: { cur: LineRef | null; until: number };
  bench: { target: LineRef | null; cup: 'hot' | 'cold' | null; ing: Record<string, number> };
  kit: { pot: (KitJob | null)[]; pan: (KitJob | null)[]; toaster: (KitJob | null)[]; oven: (KitJob | null)[]; wok: (KitJob | null)[] };
  plates: { target: unknown; tokens: string[] }[];
  ksel: LineRef | null; hold: HoldItem[]; pi: number; dishes: number;
  t: number; running: boolean; paused: boolean; groups: Group[]; payQ: SeatGroup[]; tables: TableState[];
  nextSpawn: number; nextId: number; colorIx: number;
  revenue: number; loss: number; angry: number; mistakes: number; served: number; paidCount: number;
  regHit: number; regMiss: number; regSeen: Record<string, boolean>; regPlan: Visit[];
  selected: number | null; ver: number; sheet: { gid: number; sel: number; at?: number } | null; board: boolean;
  aw: { job: AwJob | null; until: number };
  at: { cur: SeatGroup | null; until: number };
  cur: SeatGroup | null; step: string; entry: string; give: number[]; charged: number; paid: number; nextCust: number;
  /** The customer the till served last (till.ts). */
  lastCust: SeatGroup | null;
  // Added by other scripts during a shift.
  level?: string | null; tut?: boolean;
  /** A 樓面 task's own lesson (執枱 or 送外賣), set with `tut`. */
  tutF?: 'clear' | 'deliver'; drng?: RngState; nextTake?: number | null; qBonus?: number;
  ease?: number; fever?: boolean; errLog?: ErrEntry[]; ghosts?: number; tips?: number;
  /** The third star's timings (core/referee/speed.ts): per own station [jobs, seconds]; when the bill at the till arrived. */
  spd?: Partial<Record<StationId | ExtraKind, [number, number]>>; billAt?: number;
  /** The extra stations of this shift (co-op room setting); absent = the shop's four only. */
  /** Co-op only (core/coop/paid.ts): the ids of the bills already paid this shift, so none is paid twice. */
  paidIds?: number[];
  /** A party night's round played in a room (core/coop/room.ts): its shop, length and the night's round index. */
  /** `roles`: the party shop's extra stations and tiers, read by the stations as a level's `roles`. */
  party?: { shop: string; sec: number; round: number; twist: string | null; roles?: Partial<Record<ExtraKind, number>>; floorOn?: number };
  /** The 搏盡 mishap (core/referee/twist.ts): when it strikes (game s, drawn on the first open step), and whether it has. */
  twistAt?: number; twistHit?: boolean;
  extra?: ExtraKind[]; pass?: PassStats; nextRoast?: number; nextPack?: number; packNo?: number;
  /** Solo at an extra seat: the one the player plays; the shop's four are the computer's. Absent otherwise. */
  xseat?: ExtraKind;
  /** The workload model in a shop with extra seats (core/referee/work.ts). Absent otherwise. */
  work?: WorkShared;
  /** 樓面 (core/work/floor.ts): the floor role shared by 2-3 players, its open tasks and claims. Absent: the old seats. */
  floor?: FloorShared;
  /** The party director (core/party/director.ts): a party round's per-seat pace and tallies. Absent otherwise. */
  dir?: DirShared;
}
/** The party director's shared state: per seat its adaptation , work credit cr (mid seconds), seconds
 *  quiet q, jobs it made and lines its helper did, work offered per tenth of the round off; the time each dirty table
 *  was first seen dirty. */
interface DirShared {
  a: Record<string, number>; cr: Record<string, number>; q: Record<string, number>;
  made: Record<string, number>; help: Record<string, number>; off: Record<string, number[]>; dirty: Record<string, number>;
}
/** The pass with a runner seat: lines that went stale waiting, lines carried, taps refused because it was full. */
interface PassStats { stale: number; carried: number; full: number }
type Rack = 'hot' | 'cold' | 'plate' | 'bowl';

/** Fields of a level (levels.js) that converted code reads. */
interface Level {
  n: number; name: string; slot: Slot;
  favorDrink?: string; foodP?: number; favor?: string; costume?: boolean; nightLabels?: string[];
  /** Cumulative chances of a 1-, 2- and 3-person group; the rest are 4. */
  sizes?: [number, number, number];
  /** Mean seconds between takeaway customers. */
  takeaway?: number; ghost?: boolean; pulls?: number;
  /** The extra stations this level has, each with its tier 1..8 (core/work/roles.ts); absent: the four only. */
  roles?: Partial<Record<ExtraKind, number>>;}
interface PlaceFx { ghost?: boolean; pat?: number; tip?: number; flow?: number; reg?: boolean }
