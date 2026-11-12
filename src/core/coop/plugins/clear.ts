// 執枱 on the floor: a dirty table claimed from the 樓面 job bar is cleared in the station
// (src/stations-next/clear, fed mode): the floor plugin (plugins/floor.ts) names the table this phone works on, this
// plugin lays it out (its mess from the shift's table, core/work/floor.ts messOf) and sends `cleared` when the last
// piece is off. A table that stops being dirty meanwhile (a teammate, the computer) is taken off the station.
import { clear, init, TIER_MAX, type ClearState, type ClearResult, type ClearCmd } from '../../../stations-next/clear/core';
import { registerStation } from '../registry';
import { submit } from '../results';
import { liveG } from '../../state';
import { PORT } from '../../env';
import { levelTier } from '../../work/roles';
import { messOf } from '../../work/floor';
import { ctxOf, dk, store, registerSeatCommand, obj } from './kit';

/** The level's 執枱 tier: its 傳菜 tier (the floor's own ramp), else 1. */
function tier(): number {
  const lv = liveG().level, L = lv ? PORT.level(lv) : undefined;
  return Math.min(TIER_MAX, Math.max(1, levelTier(L ?? liveG().party, 'runner') ?? 1));
}
const st = store<ClearState>(() => init({ difficulty: dk(), seed: liveG().nextId * 7919, players: 1, selfFeed: false, tier: tier() }));
export const clearState = (): ClearState | null => st.peek();
const ctx = (byPlayer: boolean): ReturnType<typeof ctxOf> => ctxOf('clear', byPlayer);

/** The table (index) the floor job clears now, or null. */
let want: number | null = null;
/**
 * Names the table the floor job clears. A new table is laid at once and the last table's 「執好」 stamp hold is cut
 * short: before, the screen opened on the last table and its stamp until the next step
 * synced the station and the hold ran out (up to TUNE.gap), a stale frame.
 */
export function clearFor(table: number | null): void {
  const fresh = table !== null && table !== want;
  want = table;
  if (!fresh) return;
  const s = st.get(); sync(s);
  if (s.hold > 0) clear.command(s, { t: 'next' }, ctx(false));
}

function sync(s: ClearState): void {
  const S = liveG();
  for (const tb of [...s.tables]) if (tb.table !== want || !S.tables[tb.table]?.dirty) clear.onEvent(s, { kind: 'cancel', table: tb.table }, ctx(false));
  const tb = want !== null ? S.tables[want] : undefined;
  if (tb && tb.dirty > 0 && !s.tables.some(x => x.table === tb.id)) clear.onEvent(s, { kind: 'table', table: tb.id, name: `${String(tb.id + 1)}號枱`, items: messOf(tb) }, ctx(false));
}
function report(out: ClearResult[]): void {
  for (const r of out) if (r.kind === 'cleared') submit('clear', { k: 'cleared', table: r.table, secs: Math.round(r.secs * 10) / 10, resets: r.resets });
}
export function clearCommand(cmd: ClearCmd): void { const s = st.get(); sync(s); report(clear.command(s, cmd, ctx(true))); }

registerStation({
  kind: 'clear', v: 1,
  pick: () => st.get(),
  put: (_S, s) => { if (!clear.validate(s)) return false; st.set(structuredClone(s)); return true; },
  // each 執枱 job starts from zero (a table this phone half cleared and let go is laid afresh)
  restart: () => { st.reset(); want = null; },
  waiting: () => clear.status(st.get(), ctx(false)).waiting,
  step: (dt, driver) => {
    const s = st.get(); sync(s);
    if (driver === 'computer'){ const c = clear.bot.next(s, ctx(false)); if (c) report(clear.command(s, c, ctx(false))); }
    report(clear.step(s, dt, ctx(driver === 'me')));
  },
});
registerSeatCommand('clear', c => {
  if (!obj(c)) return false;
  if (c.t === 'tap' && (c.k === 'plate' || c.k === 'bowl' || c.k === 'cup')){ clearCommand({ t: 'tap', k: c.k }); return true; }
  if (c.t === 'next'){ clearCommand({ t: 'next' }); return true; }
  return false;
});
export function clearBotPress(): void { const c = clear.bot.next(st.get(), ctx(true)); if (c) clearCommand(c); }
