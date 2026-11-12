// Types owned by src/taste.ts (global, type-only).

type TasteBase = 'fresh' | 'trained' | 'pro' | 'boss';
/** A preset save for one taste course (written to localStorage as the shop; decor.js sanitizes it on load). */
interface TasteSave {
  nick?: string; tutDone?: Record<string, number>; skipTut?: boolean; shifts?: number; stars?: number; servedTotal?: number;
  bank?: number; gates?: string[]; levels?: Record<string, number>; ingStart?: boolean; ing?: Record<string, number>;
  regs?: Record<string, number>; lvst?: Record<string, Record<string, number>>; own?: string[]; place?: string;
  celebs?: Record<string, number>; mort?: Record<string, number>; mortDay?: string; crateNext?: number; branchAt?: number;
  streak?: { n: number; last: string }; dayRev?: number;
}
/** One course of the taste menu. */
interface TasteItem { id: string; name: string; note: string; base: TasteBase; shop?: (s: TasteSave) => TasteSave; go: () => void }
interface TasteGroup { g: string; items: TasteItem[] }
interface TasteCourse extends TasteItem { group: string }
interface Window {
  /** For the tests (tests/taste.test.js). */
  TASTE_API?: { COURSES: TasteGroup[]; FLAT: TasteCourse[]; order: (id: string) => void; openMenu: () => void };
}
