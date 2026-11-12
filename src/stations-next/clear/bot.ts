// 執枱 computer driver (cover and tests). Stateless: every call reads the state and answers with a tap, or nothing yet.
// It counts correctly and taps at a human pace: a look at the table first (react + per-item scan time), then one tap
// per `perTap` s, kind by kind (all plates, then bowls, then cups). `skill` < 1 makes it slip now and then: when it has
// just taken the last of a kind it may tap that kind once more (one tap too many), so the reset path is exercised.
// The slip roll uses ctx.rng, so a run stays seeded.
import type { StationCtx } from '../contract';
import type { ClearCmd, ClearState, Kind } from './core';

export interface ClearBotOpts {
  /** s before the first tap on a table (a look), plus `scan` s per dish on it. */
  react: number; scan: number;
  /** s between taps. */
  perTap: number;
  /** 1 = never slips; 0 = slips at every change of kind. */
  skill: number;
}
export const BOT_DEFAULT: ClearBotOpts = { react: 0.9, scan: 0.06, perTap: 0.38, skill: 1 };
const ORDER: readonly Kind[] = ['plate', 'bowl', 'cup'];

export function makeClearBot(opts: Partial<ClearBotOpts> = {}): (s: ClearState, ctx: StationCtx) => ClearCmd | null {
  const o: ClearBotOpts = { ...BOT_DEFAULT, ...opts };
  return (s: ClearState, ctx: StationCtx): ClearCmd | null => {
    const tb = s.tables[0];
    if (!tb || s.hold > 0 || s.pen > 0) return null;
    const n = tb.items.length;
    if (s.t < s.upAt + o.react + o.scan * n) return null;
    if (s.lastK !== null && s.t < s.tapT + o.perTap) return null;
    const left: Record<Kind, number> = { plate: 0, bowl: 0, cup: 0 };
    for (const it of tb.items) if (it.goneAt === null) left[it.k]++;
    if (s.lastK !== null && left[s.lastK] === 0 && o.skill < 1 && ctx.rng.next() < (1 - o.skill)) return { t: 'tap', k: s.lastK };
    const k = ORDER.find(x => left[x] > 0);
    return k ? { t: 'tap', k } : null;
  };
}
export const clearBot = makeClearBot();
