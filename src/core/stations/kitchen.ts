// The kitchen: stoves, plates, hot-hold (no DOM).
import { must, ownKey } from '../util';
import { submit } from '../coop/results';
import { KIT, SLOT_KIT, NO_BURN, CFG } from '../data/menus';
import { liveG, curLevel, G, netNow, bump, D, activePlate, byId } from '../state';
import { kitRecipe } from '../rules/recipes';
import { PORT } from '../env';
import { toast, sfx } from '../fx';
import { passRefused } from '../referee/extras';
import { patMul } from '../playtest/pace';

/** KIT[st] for a stove name the game keeps as a plain string (keys, hit boxes); the JS dereferenced it unchecked. */
export const kitDefOf = (st: string): KitDef => must(ownKey(KIT, st) ? KIT[st] : undefined, 'stove ' + st);
/** G.kit[st], likewise. */
export const kitSlotsOf = (st: string | null): (KitJob | null)[] => { const K = liveG().kit; return must(ownKey(K, st) ? K[st] : undefined, 'stove ' + String(st)); };
// 關卡可以有自己嘅廚房（例如冰室冇明火）
export const kitLayout = (): LevelKit => curLevel()?.kit || (G && G.slot==='lunch' && !G.tut ? (PORT.lunchKit() ?? SLOT_KIT[liveG().slot]) : SLOT_KIT[liveG().slot]);
export function kitStart(st: string, item: string, pref?: string): void {
  const slots = kitSlotsOf(st), K = kitDefOf(st), t = netNow();   // (a teammate's tap: the time on its phone, net.ts)
  if (st==='toaster'){
    const j = slots[0];
    if (j && j.item==='多士' && item==='多士' && t >= (j.ready ?? NaN) && !j.crisp){ j.crisp = true; j.start = t; j.ready = t + (K.time[item] ?? NaN); bump(); return; }
  }
  const i = pref != null && slots[Number(pref)]===null ? Number(pref) : slots.findIndex(s => !s);
  if (i < 0){ toast(`${K.name}滿咗，攞咗啲嘢出嚟先`); return; }
  slots[i] = st==='wok' ? { item, stirs:0, rice:0 } : { item, start:t, ready: t + (K.time[item] ?? NaN), burnAt: K.burn==null ? NO_BURN : t + (K.time[item] ?? NaN) + K.burn * D().burn * patMul('kitchen') };
  if (st==='pan' || st==='wok') sfx.sizzle(); else if (st==='pot') sfx.blup(); else sfx.cup();
  bump();
}
export function kitTake(st: string, i: number): void {
  const S = liveG();
  const j = kitSlotsOf(st)[i]; if (!j) return;
  const t = netNow(), P = activePlate();   // (a teammate's tap: judged by the time on its phone, net.ts)
  if (st==='wok'){
    if ((j.stirs ?? NaN) < CFG.stirs){ toast(`未炒好，再炒 ${CFG.stirs - (j.stirs ?? NaN)} 下`); return; }
    must(P, 'active plate').tokens.push(j.rice ? `${j.item}·飯×${j.rice}` : j.item);
  } else {
    if (t < (j.ready ?? NaN)){ toast('未熟呀'); return; }
    if (t > (j.burnAt ?? NaN)){ kitSlotsOf(st)[i] = null; S.burnt = ((S.burnt ?? 0)|0) + 1; toast(`${j.item}燶咗，倒咗佢`); bump(); return; }
    const tk = st==='toaster' ? (j.item==='餐包' || j.crisp ? j.item + '烘底' : j.item) : j.item;
    must(P, 'active plate').tokens.push(tk);
  }
  kitSlotsOf(st)[i] = null; sfx.plate(); bump();
}
/** Every item in the hot-hold is still good (the JS took the item as an argument and ignored it). */
export const holdFresh = (): boolean => true;
// 煲定先：煲熟咗嘅麵自動撈起放撈籬（唔會燶），碟要用就自動攞
export function kitAuto(): void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- kit / hold may be missing on a G from an older peer's snapshot (net.js)
  if (!G || !G.kit || !G.hold) return;
  const S = G;
  let moved = false;
  for (const [i, j] of S.kit.pot.entries()){ if (j && S.t >= (j.ready ?? NaN) && S.hold.length < CFG.holdN){ S.hold.push({ tk:j.item, t:S.t }); S.kit.pot[i] = null; moved = true; } }
  if (moved){ S.plates.forEach(pullHold); bump(); }
}
// 揀咗飛：保溫盤有啱用嘅，自動放上碟
export function pullHold(P: GameState['plates'][number] | undefined): void {
  const S = liveG();
  const sel = S.ksel, g = sel && byId(sel.gid);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- hold may be missing on a G from an older peer's snapshot (net.js)
  if (!sel || !g || !S.hold || !S.hold.length) return;
  const hold = S.hold;
  const have = [...must(P, 'plate').tokens];
  kitRecipe(must(must(g.meals, 'meals')[sel.i], 'meal line').k).forEach(n => {
    const hi = have.indexOf(n); if (hi >= 0){ have.splice(hi, 1); return; }
    const j = hold.findIndex(h => h.tk===n && holdFresh());
    if (j >= 0){ must(P, 'plate').tokens.push(n); hold.splice(j, 1); }
  });
}
// 張飛上面永遠得一樣揀咗（G.ksel）：同一枱下一碟先，冇就最趕嗰枱第一碟
export function nextMeal(g: Group | null): LineRef | null {
  const free = (x: Group): number => must(x.meals, 'meals').findIndex(m => !m.done);
  if (g && free(g) >= 0) return { gid:g.id, i:free(g) };
  const o = liveG().groups.filter(x => x.state==='wait' && free(x) >= 0).sort((a, z) => (a.mealUntil ?? NaN) - (z.mealUntil ?? NaN))[0];
  return o ? { gid:o.id, i:free(o) } : null;
}
export function pickPlate(k: number): void { liveG().pi = k; bump(); }
export function assignMeal(gid: number, i: number): void { liveG().ksel = { gid, i }; pullHold(activePlate()); bump(); }
export const selOk = (): Group | null => { const S = liveG(), sel = S.ksel, g = sel && byId(sel.gid); return sel && g && g.state==='wait' && must(g.meals, 'meals')[sel.i] && !must(must(g.meals, 'meals')[sel.i], 'meal line').done ? g : null; };
/** k: the button's data-k (undefined for a button without one, as the JS passed it on). */
export function kitKey(k: string | undefined): void {
  const S = liveG();
  if (!S.running || S.paused || S.board) return;
  const P = activePlate(), w = S.kit.wok[0];
  if (k==='stir'){ if (!w){ toast('個鑊冇嘢'); return; } w.stirs = Math.min(CFG.stirs, (w.stirs ?? NaN) + 1); w.lastStir = S.t * 1000; sfx.stir(); bump(); return; }
  if (k==='rice2wok'){ if (!w){ toast('個鑊冇嘢'); return; } w.rice = Math.min(2, (w.rice ?? NaN) + 1); bump(); return; }
  if (k==='dump'){ must(P, 'active plate').tokens = []; bump(); return; }
  if (k==='serve'){
    const g = selOk();
    if (!g){ toast(nextMeal(null) ? '撳上面張飛揀做邊碟' : '暫時冇飛'); return; }
    const plate = must(P, 'active plate');
    if (!plate.tokens.length){ toast('隻碟仲係空嘅'); return; }
    const i = must(S.ksel, 'G.ksel').i;
    // the extra seats: a full pass waits for the runner
    if (!g.take && passRefused('kitchen')) return;
    // done, ok = sameBag, good / breakCombo: the referee's (core/coop/results.ts)
    submit('kitchen', { k: 'lineDone', gid: g.id, dest: 'kitchen', i, made: { t: 'plate', tokens: [...plate.tokens] } }); S.dishes++;
    sfx.ding(); plate.tokens = []; S.ksel = null; pullHold(plate); bump(); return;   // 下一碟自己揀
  }
  const kk = must(k, 'kitchen key');
  if (kk.startsWith('h:')){
    const i = +kk.slice(2), h = S.hold[i]; if (!h) return;
    S.hold.splice(i, 1);
    must(P, 'active plate').tokens.push(h.tk);
    bump(); return;
  }
  if (kk.startsWith('i:')){ must(P, 'active plate').tokens.push(kk.slice(2)); sfx.plate(); bump(); return; }
  // A key the game draws always has the stove and the item (`s:pot:通粉[:slot]`, `t:pot:0`).
  if (kk.startsWith('s:')){ const [, st, item, pref] = kk.split(':'); kitStart(must(st, 'stove in ' + kk), must(item, 'item in ' + kk), pref); return; }
  if (kk.startsWith('t:')){ const [, st, i] = kk.split(':'); kitTake(must(st, 'stove in ' + kk), Number(i)); return; }
}
export function slotState(st: string, j: KitJob | null): { cls: string; txt: string; f: number } {
  if (!j) return { cls:'', txt:'空', f:0 };
  if (st==='wok') return (j.stirs ?? NaN) >= CFG.stirs ? { cls:'ready', txt:'炒好', f:1 } : { cls:'cook', txt:`炒 ${String(j.stirs)}/${CFG.stirs}`, f: (j.stirs ?? NaN) / CFG.stirs };
  const t = liveG().t, ready = j.ready ?? NaN, burnAt = j.burnAt ?? NaN, start = j.start ?? NaN;
  if (t > burnAt) return { cls:'burnt', txt:'燶咗', f:1 };
  if (t >= ready) return { cls: burnAt - t < 1.5 ? 'ready warn' : 'ready', txt:'得', f:1 };
  return { cls:'cook', txt:`${Math.ceil(ready - t)}`, f: (t - start) / (ready - start) };
}
// 爐頭選單：喺撳嗰個爐頭旁邊彈出，張飛要用嘅料亮黃色
export function kNeed(): string[] {
  const P = activePlate(), g = selOk(); if (!g) return [];
  const need = [...kitRecipe(must(must(g.meals, 'meals')[must(liveG().ksel, 'G.ksel').i], 'meal line').k)]; must(P, 'active plate').tokens.forEach(t => { const i = need.indexOf(t); if (i >= 0) need.splice(i, 1); });
  return need;
}
