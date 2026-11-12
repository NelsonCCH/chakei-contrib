// Types owned by src/floor-iso.ts: the isometric floor (grid points, table positions, anchors) and the fixed-shop flags
// it draws.

interface IsoPt { x: number; y: number }
/** Tile width / height in pixels, grid size, wall height. decor.ts / sets.ts change GX, GY and WALL. */
interface IsoGrid { TW: number; TH: number; GX: number; GY: number; WALL: number }
/** A table on the floor: top on gx [tx, tx+1), gy [ty, ty+w); z = raised onto the mezzanine. */
interface TablePos { tx: number; ty: number; w: number; z?: number }
/** A seated group's head on the floor, where its bubble goes. */
interface IsoHead { x: number; y: number; g: Group }
/** Where a table was drawn this frame (text-canvas pixels): bubble anchor (x, y), name (nx, ny), its groups. */
interface IsoAnchor { x: number; y: number; gs: Group[]; tb: TableState; heads: IsoHead[]; nx: number; ny: number }
/** A text sign drawn one character at a time on the text canvas. */
interface IsoChar { ch: string; p: IsoPt }
/** [gx, gy, w, d, floors, face, style]: a block of flats around the shop (isoSlab). */
type SlabDef = [gx: number, gy: number, w: number, d: number, floors: number, face: 'L' | 'R', style?: string];
/** The ground around the shop for a district: paving (a / b), roads, and extras. */
interface GroundDef {
  a: string; b: string; road: string | null; line: string | null;
  zebra?: boolean; brick?: string; slabs?: SlabDef[]; court?: boolean; sea?: boolean; stalls?: boolean; props?: boolean;
}
interface Grounds { 'pl-town': GroundDef; 'pl-island': GroundDef; [place: string]: GroundDef }

/** The level flags floor-iso.ts draws (levels.ts LevelLay; useFixedShop copies them into fixedShop). */
interface FixedShop {
  door?: [number, number]; signText?: string; fans?: [number, number][]; fold?: boolean | string;
  /** [gx, gy, w, d, z] of the mezzanine. */
  loft?: number[];
  bing?: boolean; silver?: boolean; walled?: boolean; dim?: boolean; lanfong?: boolean; dairy?: boolean;
  hangwan?: boolean; bakery?: boolean; halloween?: boolean;
}
