// Types owned by src/outfit.ts: the waiter's wardrobe (the save's SHOP.outfit / SHOP.wardrobe are in types/decor.d.ts).

/** A piece of clothing: price, colour (a hat may have none: 冇帽), and the shape flags dress() reads. */
interface WardItem { name: string; p: number; col?: string; vest?: boolean; dots?: string; short?: boolean }
interface WardItemC extends WardItem { col: string }
interface WardGroup<T extends WardItem = WardItem> { name: string; items: Record<string, T> }
/** The four slots. Other keys (from data-ws attributes or for-in) may be missing. */
interface Wardrobe {
  hat: WardGroup; hair: WardGroup<WardItemC>; top: WardGroup<WardItemC>; pants: WardGroup<WardItemC>;
  [slot: string]: WardGroup;
}
