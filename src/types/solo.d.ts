// Types for the career / solo-mode features (mortgage, target, 硬核模式, solo modes): fields they add to the shift and the save.

/** Fields the solo modes and the chosen target add to the shift state. */
interface GameState {
  /** 輪流做 ('rotate') or 一腳踢 ('all'): the player works every station (core/career/solo.ts). */
  solo?: 'rotate' | 'all';
  /** The station a 輪流做 shift started on. */
  soloFrom?: StationId;
  /** The chosen target's tier (core/career/targets.ts); missing = the random boss goal (co-op, levels). */
  tier?: 'safe' | 'bet' | 'allin';
}

/** Fields the features add to the save. */
interface Shop {
  /** The target chosen last (pre-shift screen). */
  target?: { metric: string; tier: string };
  /** The solo mode chosen last: 'one', 'rotate' or 'all'. */
  solo?: string;
  /** 硬核模式: fixed costs per shift, warnings, and the shop can be lost. Off by default. */
  hard?: boolean;
  /** The pressure state (core/career/pressure.ts PressState). */
  press?: { red: number; debt: number; fails: number; back: number };
  /** The shop as it was before the landlord took it back, waiting to be won back (東山再起). */
  lost?: { size: number; tables: ShopTable[]; items: ShopItem[]; place?: string } | null;
}
