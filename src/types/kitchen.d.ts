// Types owned by src/kitchen.ts (global, type-only).

type KitSt = keyof GameState['kit'];
/** A stove: its name, how many slots, the cooking time per item and how long until a ready item burns (null = never). */
interface KitDef { name: string; n: number; time: Record<string, number>; burn: number | null }
/**
 * What kitchen.ts puts in a stove slot (G.kit). A timed job has start / ready / burnAt (a toaster's 多士 may be toasted a
 * second time: crisp); a wok job has stirs / rice / lastStir and no times. model.d.ts lists the fields every job shares.
 */
interface KitJob { start?: number; burnAt?: number; crisp?: boolean; stirs?: number; rice?: number; lastStir?: number }
/** A tray of ingredients on the counter view: `k` is the key it sends (kitKey), `st` the stove it cooks on (if any). */
interface KitTray { k: string; st?: string; tk: string; txt: string; cook?: boolean }
interface KitCell { st: KitSt; i: number; j: KitJob | null }
interface CounterGroup { row: number; c0: number; n: number; per: number; items: KitTray[] }
/** The counter view's layout: trays under the stoves, the fridge row and the extra height they need. */
interface CounterPlan { groups: CounterGroup[]; stripH: number[]; inst: KitTray[]; fc: number; fridgeH: number; extra: number }
/** The kitchen's hit boxes also mark the hot-hold (`hold` = index into G.hold). */
interface SceneHit { hold?: number }
interface GameState {
  /** Dishes burnt this shift. */
  burnt?: number;
}
