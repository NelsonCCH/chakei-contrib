// Types owned by src/dex.ts (global, type-only).

/** A dex card: the kind of shop a level pays tribute to. sig is a menu key for the card's picture. */
interface DexEntry { type: string; age: string; sig: string; look: string[]; fact: string }
interface Shop {
  /** Card tier per level id (0-3) as last announced. */
  dex?: Record<string, number>;
  dexNew?: boolean;
}
