// Types owned by src/pixel.ts: the pixel scenes (a low-res canvas under a sharp text canvas) and customer looks.

/** A tappable box drawn this frame; the optional fields say what it is (table, item, ingredient, stove slot, tray). */
interface SceneHit {
  x: number; y: number; w: number; h: number;
  tid?: number; iid?: number; kind?: string; k?: string; st?: string; i?: number; tray?: string; plate?: number;
  /** bar-art: a label `name` drawn at (lx, ly) on the text canvas. */
  lx?: number; ly?: number; name?: string;
}
/**
 * makeScene(): a pixel canvas `cv` (context `x`) under a text canvas `tv` (context `t`, which takes the taps), drawn
 * at scale S. The contexts are what getContext('2d') returned; beginScene() dereferences them each frame.
 */
interface Scene {
  wrap: HTMLElement; cv: HTMLCanvasElement; tv: HTMLCanvasElement;
  x: CanvasRenderingContext2D | null; t: CanvasRenderingContext2D | null;
  W: number; H: number; S: number; LW: number; LH: number; dpr: number; key: string; hits: SceneHit[];
}
/** A customer's look, derived from the group label (lookOf). */
interface Look { uniform?: boolean; hair?: string; perm?: boolean; hat?: string; long?: boolean }
