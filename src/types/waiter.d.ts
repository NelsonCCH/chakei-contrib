// Types owned by src/waiter.ts (global, type-only).

type DraftKind = 'f' | 's' | 'd' | 'k';
/**
 * Every field a slip line may carry. The modifier buttons (sheetAct) write to whatever line is lit without checking its
 * kind, as the JS did, so a line can pick up fields of another kind; keyOf reads only its own kind's fields.
 */
interface DraftFields {
  id?: string; d?: string; cold?: boolean; sweet?: number; noice?: boolean;
  noodle?: string; egg?: string; bread?: string; hongdai?: boolean; feibin?: boolean;
  炒底?: boolean; 加底?: boolean; 走青?: boolean; hat?: boolean;
}
/** One line of the waiter's slip being written: a food, a breakfast set, a dinner dish or a drink. */
type DraftLine =
  | (DraftFields & { t: 'f'; id: string })
  | (DraftFields & SetOrder & { t: 's' })
  | (DraftFields & DishOrder & { t: 'd' })
  | (DraftFields & DrinkOrder & { t: 'k' });
/** A press on the order sheet: the button's data-* plus `act` (later / send). Also arrives from a teammate (net.js). */
type SheetDs = Record<string, string | undefined>;

interface GameState {
  /** The 「凍檸」 hint was shown this shift. */
  hintLemon?: boolean;
}
