// Types owned by src/levels.ts (global, type-only). They extend shared interfaces by declaration merging, so
// model.d.ts stays as rules.ts wrote it.

/** A table in a level's fixed shop: [kind, tx, ty, z]. z lifts it onto a loft (decor.js useFixedShop). */
type LayTable = [kind: string, tx: number, ty: number, z?: number];
/** A level's fixed shop (decor.js useFixedShop spreads it over the defaults; floor-iso.js reads the flags). */
interface LevelLay {
  size: number; tables: LayTable[]; wall: string; floor: string;
  gx?: number; gy?: number; door?: [number, number]; place?: string; signText?: string; awning?: string;
  fans?: [number, number][]; fold?: boolean | string; loft?: number[];
  bing?: boolean; silver?: boolean; walled?: boolean; dim?: boolean; lanfong?: boolean; dairy?: boolean;
  hangwan?: boolean; bakery?: boolean; halloween?: boolean;
}
/** A level's own kitchen: which station cooks what, the instant items, and extra slots per station. */
interface LevelKit {
  st: Record<string, string[]>; inst: string[]; instName?: string;
  n?: Partial<Record<keyof GameState['kit'], number>>;
}
interface Level {
  where: string; desc: string; lay: LevelLay; menu: string[]; gap: number; pat: number;
  /** Revenue for one, two and three stars. */
  stars: [number, number, number];
  era?: string; festTag?: string;
  /** [start month, day, end month, day]; the range may wrap over new year. */
  fest?: [number, number, number, number];
  hell?: boolean; burn?: number; oneSay?: number; kit?: LevelKit;
  clock?: { start: number; endTxt: string; label: string };
}
interface LevelCat { k: string; name: string; sub: string }

interface Shop {
  /** Best stars per level id. levels.ts sets it at load; decor.ts creates SHOP before that, so it is optional. */
  levels?: Record<string, number>;
  /** Day (todayStr) each level was last three-starred. */
  lv3day?: Record<string, string>;
  hellToast?: boolean;
}
interface GameState { goal?: string; goalN?: number }
