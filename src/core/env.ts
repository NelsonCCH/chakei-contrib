// What the shop's rules read from the player's progress. The save (SHOP: bought sets, the district, recipe
// levels, the menu, regulars' visits, rank) and the level catalogue live in the page's modules (src/ui/), which load and
// save them; core/ never touches them. It asks through this port instead, which the page installs at load
// (src/ui/wire.ts). The defaults are a fresh player in a plain shop: every menu item open, no bonuses, no regulars' history,
// no levels. Simulations install their own.

export interface ShopPort {
  /** The level with this id (ui/levels.ts LEVELS). */
  level(id: string): Level | undefined;
  /** A menu item ('f:西多士', 'k:奶茶') is on today's menu (ui/menu.ts menuOpen). */
  menuOpen(key: string): boolean;
  /** This shift runs in the player's own shop (not a level, the tutorial or a fixed shop): signature dishes count there. */
  inMyShop(): boolean;
  /** A recipe's level, 1..3 (ui/market.ts rLv). */
  recipeLv(key: string): number;
  /** The name customers use for a recipe (ui/market.ts fancyName). */
  fancyName(key: string): string | undefined;
  /** Bought sets and the district (ui/sets.ts): patience, tip and customer-flow factors, the tea pot's size. */
  setPat(): number; setTip(): number; setBoost(): number; potCap(): number;
  placeFx(): PlaceFx; setOn(k: string): boolean;
  /** The player's rank (ui/career.ts rankIx). */
  rankIx(): number;
  /** How often a regular has come (SHOP.regs). */
  regVisits(key: string): number;
  /** A regular comes in: tells the next part of their story (ui/career.ts careerArrive's message). */
  regArrive(g: SeatGroup): void;
  /** A regular or a celebrity paid: the save's bookkeeping and the thank-you (ui/career.ts careerPaid); returns the tip. */
  regPaid(g: SeatGroup): number;
  /** The kitchen of the player's own shop at lunch (ui/menu.ts shopLunchKit), or null for the time slot's own. */
  lunchKit(): LevelKit | null;
}

export const DEFAULT_PORT: ShopPort = {
  level: () => undefined, menuOpen: () => true, inMyShop: () => false, recipeLv: () => 1, fancyName: k => k.split(':')[1],
  setPat: () => 1, setTip: () => 1, setBoost: () => 1, potCap: () => 16, placeFx: () => ({}), setOn: () => false,
  rankIx: () => 0, regVisits: () => 0, regArrive: () => undefined, regPaid: () => 0, lunchKit: () => null,
};
export let PORT: ShopPort = DEFAULT_PORT;
export function setPort(v: ShopPort): void { PORT = v; }
