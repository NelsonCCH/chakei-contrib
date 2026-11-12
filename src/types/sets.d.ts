// Types owned by src/sets.ts (global, type-only).

/** A decoration set item: decor.js ITEMS gets these merged in; draw(x, y, now) paints it and returns its top height. */
interface SetItem extends ItemDef { draw: (x: number, y: number, now: number) => number }
/** A decoration set: owning every item turns on its effect (in the player's own shop only). */
interface DecorSet { name: string; items: string[]; fx: string; lantern: string; limited?: string }
interface Shop {
  /** Sets the player has already been congratulated on. */
  setsSeen?: string[];
}
