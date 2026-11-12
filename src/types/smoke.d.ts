// Types owned by src/smoke.ts: the pixel figures (also dressed by outfit.ts) and the smoke-break easter eggs.

/** One rectangle of a figure in its 16x36 box: [x, y, w, h, colour, detail]. A truthy detail is drawn without outline. */
type FigPart = [x: number, y: number, w: number, h: number, col: string, det?: number];
type PoseId = 'leanUp' | 'sitBow' | 'chef' | 'squat';
type SmokeEndId = 'boss' | 'cat' | 'fridge' | 'light' | 'rain';

/** The running smoke break (`smk`): which event plays and how far it got. Empty ({}) before the first break. */
interface SmokeState {
  t0?: number; ev?: string | null; toast?: boolean; catX?: number; again?: string | undefined;
  l1?: boolean; l2?: boolean; ch?: number; walking?: boolean; carry?: boolean; called?: boolean; gone?: boolean;
  fridge?: boolean; dy?: number; chefX?: number; lit?: boolean; both?: boolean; yell?: boolean; wet?: boolean; ashAt?: number;
}
/** A smoke-break spot: `tip` = where the cigarette's tip is, `chefX` = where the chef stops, `smoke` = puff RGB. */
interface SmokeScene {
  id: string; name: string; line: string; tip: [number, number]; chefX?: number; smoke?: string;
  draw: (c: CanvasRenderingContext2D, t: number, st: SmokeState) => void;
}
interface SmokePuff { x: number; y: number; born: number; dx: number }
interface SmokeAsh { x: number; y: number; v: number }
