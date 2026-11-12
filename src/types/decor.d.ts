// Types owned by src/decor.ts: the save `SHOP` (every field any script reads or writes) and the decor catalogue.
// The save comes from localStorage or the cloud, so it is untrusted at runtime: sanitizeShop() checks the types of the
// fields it lists and the rest is taken as the JS takes it (it is not yet validated at the boundary).

type LookKind = 'wall' | 'floor' | 'sign' | 'awning' | 'place';
/** What every look (wall, floor, sign, awning, place) has; `unlock` = a level that must have 3 stars first. */
interface LookDef { name: string; p: number; chip: string; unlock?: string }
interface WallDef extends LookDef {
  r: string; l: string; r1: string; r2: string; l1: string; l2: string;
  tile?: boolean; plain?: boolean; dado?: boolean; stripe?: boolean;
}
interface FloorDef extends LookDef { a: string; b: string; dot?: boolean; fine?: boolean }
interface SignDef extends LookDef { bg: string; fg: string; neon?: boolean }
interface AwningDef extends LookDef { a?: string; b?: string }
/** A district. `fx` is the shown effect; reg/bonus/tip/flow/pat/ghost are the effect itself (sets.js placeFx). */
interface PlaceDef extends LookDef, PlaceFx { road?: string; fx: string; noLine?: boolean }
/** placeFx() returns a PlaceDef (or {}); careerEnd reads `bonus`, which model.d.ts's PlaceFx does not list. */
interface PlaceFx { bonus?: number }

interface SizeDef { name: string; gx: number; gy: number; p: number }
interface TableKindDef { name: string; cap: number; w: number; p: number; chip: string }
/** A decor item. Set items (sets.js) add `draw` (returns the top height) and `star` (stars needed to buy). */
interface ItemDef {
  name: string; p: number; w: number; d: number; chip: string;
  draw?: (x: number, y: number, now: number) => number; star?: number;
}
/** [kind, tx, ty, z?]: a table in a fixed layout (z = on the mezzanine). */
type TableDef = [kind: string, tx: number, ty: number, z?: number];
/** A level's or the tutorial's fixed shop (useFixedShop). */
interface FixedShop {
  size: number; tables: TableDef[]; wall: string; floor: string;
  gx?: number; gy?: number; sign?: string; awning?: string; place?: string;
}
interface TilePos { tx: number; ty: number }
interface Rect { x0: number; x1: number; y0: number; y1: number }
/** What the decorator has picked up: table i or item i. */
interface DecorSel { t: 'table' | 'item'; i: number }

interface ShopTable { kind: string; tx: number; ty: number }
interface ShopItem { type: string; tx: number; ty: number; rot?: boolean }
interface ShopEggs { boss?: boolean; date?: boolean; smoke?: string[]; smokeEnd?: string[]; her?: number }

/**
 * The save. The first block is the starting shop (decor.js), always present: a loaded save only overrides those
 * fields after sanitizeShop() checked their types. Every other field may be missing in an old save; most are filled
 * by a later script at load (`SHOP.x = SHOP.x || ...`) and by cloud.js normalizeShop, so they are optional here.
 */
interface Shop {
  bank: number; wall: string; floor: string; sign: string; awning: string; place: string; own: string[];
  size: number; day: number; dayRev: number; tables: ShopTable[]; items: ShopItem[];
  /** Last saved (saveShop), ms. */
  t?: number;
  // main.js / outfit.js
  name?: string; nick?: string; outfit?: Record<string, string>; wardrobe?: string[];
  // career.js
  stars?: number; regs?: Record<string, number>; celebs?: Record<string, number>; eggs?: ShopEggs;
  /** Day (todayStr) the daily challenge was won. */
  daily?: string; streak?: { n: number; last: string }; shifts?: number; tried?: Record<string, number>;
  regToday?: string;
  // market.js
  ing?: Record<string, number>; ingStart?: boolean; buyDay?: string; buyN?: number; rlv?: Record<string, number>;
  /** When the next market crate can be claimed, ms. */
  crateNext?: number;
  off?: string[]; servedTotal?: number; pickDay?: string; pick?: string | null;
  mort?: Record<string, number>; mortDay?: string;
  /** Best stars per level per station. Entries may be missing (the JS guards each one). */
  lvst?: Record<string, Record<string, number> | undefined>;
  /** Branch income counted from here, ms. */
  branchAt?: number;
  // menu.js (levels, tutorial, gates, dex, mastery and sets declare their own fields in src/types/<name>.d.ts)
  recipes?: string[];
}
/** A save after sanitizeShop(): any Shop field, plus `pos` from the oldest saves (table positions only). */
interface ShopSave extends Partial<Shop> { pos?: TilePos[] }

/** Fields decor.ts adds to the shift state. */
interface GameState {
  /** The shift's takings went into SHOP.bank (bankRevenue). */
  banked?: boolean;
}
