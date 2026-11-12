// The bar: tea pot, cup, ingredients (no DOM).
import { liveG, bump, byId } from '../state';
import { submit } from '../coop/results';
import { CFG, ING } from '../data/menus';
import { pullsNeed } from '../rules/recipes';
import { must } from '../util';
import { PORT } from '../env';
import { toast, sfx, say } from '../fx';

export function updatePot(): void {
  const S = liveG();
  const p = S.pot;
  if (p.st==='boil' && S.rt >= p.until){ p.st = 'steep'; p.until = S.rt + CFG.steepSec; bump(); }
  else if (p.st==='steep' && S.rt >= p.until){ p.st = 'pull'; p.pulls = 0; bump(); }
}
/**
 * 開舖前冇人郁過個茶壺（例如水吧部機冇人理）：師傅幫手煲好頭一壺，唔好成間舖等住. Runs where the bar is
 * driven (the pot is the bar's own state): the referee's step for its own or the computer's bar, a teammate's phone for theirs.
 */
export function potAutoBoil(): void {
  const S = liveG();
  if (S.phase==='prep' && S.pot.st==='empty' && S.rt >= CFG.barOpenSec){ S.pot.st = 'ready'; S.pot.level = PORT.potCap(); S.pot.pulls = 0; say('bar', '冇人煲茶膽，師傅幫你煲咗頭一壺'); }
}
export function potAction(): void {
  const S = liveG();
  const p = S.pot;
  if (p.st==='pull'){
    sfx.pull();
    if (++p.pulls >= pullsNeed()){ p.st = 'ready'; p.level = PORT.potCap(); toast('茶膽撞好，有茶喇'); }
    bump(); return;
  }
  if (p.st==='boil' || p.st==='steep') return;
  if (p.level >= PORT.potCap()){ toast('茶壺仲係滿嘅'); return; }
  p.st = 'boil'; p.level = 0; p.until = S.rt + CFG.boilSec; sfx.pour(); bump();
}
/* ---- 水吧操作 ---- */
export function benchReset(): void { const S = liveG(); S.bench.cup = null; S.bench.ing = {}; }
export function pickLine(gid: number, i: number): void {
  const g = byId(gid); if (!g || g.state!=='wait' || must(must(g.drinks, 'drinks')[i], 'drink line').done) return;
  liveG().bench.target = { gid, i }; bump();
}
export function nextTarget(g: Group | null): LineRef | null {
  const i = g ? must(g.drinks, 'drinks').findIndex(d => !d.done) : -1;
  if (g && i >= 0) return { gid:g.id, i };
  const o = liveG().groups.filter(x => x.state==='wait' && must(x.drinks, 'drinks').some(d => !d.done)).sort((a, z) => (a.drinkUntil ?? NaN) - (z.drinkUntil ?? NaN))[0];
  return o ? { gid:o.id, i:must(o.drinks, 'drinks').findIndex(d => !d.done) } : null;
}
/** k: the button's data-b (undefined for a button without one, as the JS passed it on). */
export function barKey(k: string | undefined): void {
  const S = liveG();
  if (!S.running || S.paused || S.board) return;
  if (k==='pot'){ potAction(); return; }
  if (S.phase==='prep'){ toast('煲好茶膽先開門'); return; }
  const b = S.bench;
  if (k==='hot' || k==='cold'){
    if (b.cup && Object.keys(b.ing).length){ toast('杯入面有嘢，倒咗佢先'); return; }
    b.cup = k; sfx.cup(); bump(); return;
  }
  if (k==='dump'){ benchReset(); bump(); return; }
  if (k==='serve'){
    const tg = b.target, g = tg && byId(tg.gid);
    if (!tg || !g || g.state!=='wait'){ toast('撳上面張飛揀做邊杯'); return; }
    if (!b.cup){ toast('未揀杯'); return; }
    must(must(g.drinks, 'drinks')[tg.i], 'drink line');   // drinks skip the runner's pass; no rack to wait on
    // done, ok = cupMatches, good / breakCombo: the referee's (core/coop/results.ts)
    submit('bar', { k: 'lineDone', gid: g.id, dest: 'bar', i: tg.i, made: { t: 'cup', cup: b.cup, ing: { ...b.ing } } }); S.cups++;
    sfx.ding(); benchReset(); b.target = null; bump();   // 下一杯自己揀
    return;
  }
  if (k === undefined || !ING.includes(k)) return;
  if (!b.cup){ toast('揀熱杯定凍杯先'); return; }
  if (k==='茶'){
    if (S.pot.st!=='ready' || S.pot.level <= 0){ toast(S.pot.st==='ready' || S.pot.st==='empty' ? '茶壺冇茶，煲過先' : '茶膽未煲好'); return; }
    S.pot.level--;
  }
  b.ing[k] = Math.min(3, ((b.ing[k] ?? 0)|0) + 1); if (k==='冰') sfx.ice(); else if (k==='檸檬') sfx.cup(); else sfx.pour(); bump();
}
