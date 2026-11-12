// Types owned by src/bar.ts (global, type-only).

/** recipeOf(k): the cup and how many of each ingredient in ING a drink key needs (every ING key is a number). */
interface DrinkRecipe { cup: 'hot' | 'cold'; [ing: string]: number | string }
/** One ticket on a rail (syncRail): bar tickets and kitchen chips. `h` is the ticket's inner markup. */
interface RailItem { key: number | string; color: string; h: string; cls?: string }
interface HTMLElement {
  /** syncRail: the markup last morphed into this ticket, so an unchanged ticket is left alone. */
  _h?: string;
}
