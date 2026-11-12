// The waiter's station: seating, the order sheet (no DOM).
import { liveG, byId, asSeat, atTable, bump, G } from '../state';
import { submit } from '../coop/results';
import { seatProblem } from '../referee/customers';
import { must, ownKey } from '../util';
import { DEF, isIced, DISHES, HAT_TXT, isHot, isSw } from '../data/menus';
import { setKey, dishKey, drinkKey } from '../rules/price';
import { CORE_HOOK } from '../hooks';
import { toast, emit } from '../fx';

/**
 * 樓面: on a floor shift several players share these screens, so a tap claims its task first (the group at the
 * door, the table's order) and a dirty table is cleared in the 執枱 mini-game. core/coop/plugins/floor.ts sets it.
 */
export interface FloorGate { want(id: string): boolean; drop(id: string): void; clear(table: number): boolean }
let gate: FloorGate | null = null;
export function setFloorGate(g: FloorGate | null): void { gate = g; }
const floorGate = (): FloorGate | null => G?.floor ? gate : null;

/* ===================== 伙記位：操作 ===================== */
export function tapTable(id: number): void {
  const S = liveG();
  if (!S.running || S.paused) return;
  const tb = S.tables[id];
  const sel = S.selected && byId(S.selected);
  if (sel && sel.state==='queue'){
    const why = seatProblem(asSeat(sel), must(tb, 'table ' + String(id)));
    if (!why){ submit('waiter', { k: 'seat', gid: sel.id, table: id }); return; }
    if (why==='dirty'){ if (floorGate()?.clear(id)) return; submit('waiter', { k: 'clean', table: id }); toast('執緊枱，再撳一下帶位'); return; }
    toast(why); emit({ k: 'shake', table: id }); return;
  }
  const want = atTable(id).filter(g => g.state==='order').sort((a,b) => a.until-b.until);
  if (want.length){ openSheet(asSeat(must(want[0], 'group'))); return; }
  if (must(tb, 'table ' + String(id)).dirty){ if (floorGate()?.clear(id)) return; submit('waiter', { k: 'clean', table: id }); return; }
  if (atTable(id).some(g => g.state==='think')) toast('客人睇緊餐牌，等陣');
  else if (!atTable(id).length) toast('撳門口啲客先，再撳枱帶位');
}
export function tapGroup(id: number): void {
  const S = liveG();
  if (!S.running || S.paused) return;
  const fg = floorGate();
  if (fg){
    if (S.selected !== null) fg.drop('seat:' + String(S.selected));
    if (S.selected !== id && !fg.want('seat:' + String(id))){ toast('隊友帶緊呢班客'); S.selected = null; bump(); return; }
  }
  S.selected = S.selected===id ? null : id; bump();
}
/* ---- 落單：先撳嘢食或飲品，張單多一行；再撳要求，改亮住嗰行 ---- */
export const newLine: Record<DraftKind, (id: string) => DraftLine> = {
  f: id => ({ t:'f', id }),
  s: id => ({ t:'s', id, ...DEF }),
  d: id => ({ t:'d', id, 炒底:false, 加底:false, 走青:false }),
  k: id => ({ t:'k', d:id, cold:isIced(id), sweet:0, noice:false }),
};
export const sauceOf = (id: string): boolean => must(DISHES.find(x => x.id===id), 'dish ' + id).sauce;
export function keyOf(l: DraftLine): string {
  if (l.t==='f') return 'f' + l.id + (l.hat ? HAT_TXT : '');
  if (l.t==='s') return setKey({ ...l, hongdai: l.bread==='餐包' && l.hongdai, feibin: (l.bread!=='餐包' || l.hongdai) && l.feibin });
  if (l.t==='d') return dishKey({ ...l, 炒底: l.炒底 && sauceOf(l.id) });
  return drinkKey(l);
}
// 火速奶公司：客人講嘢幾耐後消失。人越多越耐（一個人 oneSay 秒，每多一人加 2 秒），同埋有條紅線倒數
export const oneSayMs = (g: SeatGroup | null | undefined, L: Level): number => ((L.oneSay ?? NaN) + 2 * Math.max(0, ((g && g.lines) || []).length - 1)) * 1000;
// The page draws the sheet, times the 「凍檸」 hint and the one-say countdown, and stamps G.sheet.at ('sheetOpen').
export function openSheet(g: SeatGroup): void {
  const S = liveG();
  if (floorGate() && !floorGate()?.want('order:' + String(g.id))){ toast('隊友落緊呢枱單'); return; }
  // 第一次聽到「凍檸」：提一提即係凍檸茶
  let lemon = false;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- a group from a co-op snapshot (net.js) may come without lines
  if (!S.hintLemon && (g.lines || []).some(l => /凍檸(?!茶|水|樂|七|蜜)/.test(l))){ S.hintLemon = true; lemon = true; }
  g.draft = g.draft || [];
  submit('waiter', { k: 'slipOpen', gid: g.id, regSeen: !!(g.regular && !g.repeat) });   // taken, later = null: 開住張單時客人唔會因為等落單而嬲走；收埋咗就只係多等一陣（rules.js laterGrace）
  S.sheet = { gid:g.id, sel: g.draft.length - 1 };
  S.selected = null; bump();
  emit({ k: 'sheetOpen', gid: g.id, lemon });
}
// 未落單就閂（收埋、撳出面、Esc、暫停）：客人只係多等 laterGrace 秒，唔會永遠等落去
export function closeSheet(): void {
  if (G && G.sheet){ const g = byId(G.sheet.gid); if (g && g.state==='order'){ submit('waiter', { k: 'slipClose', gid: g.id }); floorGate()?.drop('order:' + String(g.id)); } }   // later = laterGrace
  if (G) G.sheet = null;
  emit({ k: 'sheet', open: false });
}
// 撳門口以外嘅地方：唔揀客
export function deselect(): void { if (G && G.selected){ floorGate()?.drop('seat:' + String(G.selected)); G.selected = null; bump(); } }
// 落單紙上面撳一下（d = 個掣嘅 data-*；act = later 收埋／send 落單）。抽出嚟係為咗組隊時傳俾老闆部機
export function sheetAct(ds: SheetDs): void {
  const S = liveG();
  if (!S.sheet) return;
  const s = S.sheet, g0 = byId(s.gid); if (!g0){ CORE_HOOK.closeSheet(); return; }
  const g = asSeat(g0), draft = must(g.draft, 'draft');
  const l = draft[s.sel];
  if (ds.add){ draft.push(must(ownKey(newLine, ds.add) ? newLine[ds.add] : undefined, 'line kind ' + ds.add)(must(ds.id, 'data-id'))); s.sel = draft.length - 1; }
  else if (ds.pick){ s.sel = Number(ds.pick); }
  else if (ds.peek){ g.peeked = true; }
  else if (ds.del){ const i = Number(ds.del); draft.splice(i, 1); if (s.sel > i || s.sel >= draft.length) s.sel--; }
  // The modifiers act on whatever line is lit, as the JS did (a field the line's kind lacks reads undefined).
  else if (l && ds.temp){ l.cold = (ds.temp==='cold' && !isHot(l.d ?? '')) || isIced(l.d ?? ''); if (!l.cold){ l.noice = false; l.sweet = 0; } }
  else if (l && ds.sweet){ l.sweet = isSw(l.d ?? '') ? 0 : l.sweet===Number(ds.sweet) ? 0 : Number(ds.sweet); }
  else if (l && 'noice' in ds){ l.noice = !l.noice && !isIced(l.d ?? ''); }
  else if (l && ds.opt){ Reflect.set(l, ds.opt, ds.v); if (l.bread!=='餐包') l.hongdai = false; if (l.bread==='餐包' && !l.hongdai) l.feibin = false; }
  else if (l && ds.flag){ Reflect.set(l, ds.flag, !Reflect.get(l, ds.flag)); if (l.bread==='餐包' && !l.hongdai) l.feibin = false; }
  else if (l && ds.dflag){ Reflect.set(l, ds.dflag, !Reflect.get(l, ds.dflag)); }
  else if (l && 'hat' in ds){ l.hat = !l.hat; }
  else if (ds.act==='later'){ CORE_HOOK.closeSheet(); return; }
  else if (ds.act==='send'){
    if (!draft.length){ toast('張單仲係空嘅'); return; }
    submit('waiter', { k: 'order', gid: g.id, keys: draft.map(x => keyOf(x)), peeked: !!g.peeked });
    CORE_HOOK.closeSheet(); return;
  }
  bump(); emit({ k: 'sheet', open: true });
}
