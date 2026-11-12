// The computer at the bar.
import { rng } from '../rng';
import { me, liveG, bump } from '../state';
import { CFG } from '../data/menus';
import { must } from '../util';
import { lineMade } from '../referee/extras';

export function aiBar(): void {
  if (me('bar')) return;
  const S = liveG();
  const b = S.ab;
  // 客走咗（等到嬲）：唔好再沖佢嗰杯，去做下一杯
  // The drink being made, as a line reference (plain data); null once its group has gone.
  const line = (r: LineRef): OrderLine | undefined => S.groups.find(g => g.id===r.gid)?.drinks?.[r.i];
  const cur0 = b.cur && line(b.cur);
  if (!cur0) b.cur = null;
  if (cur0 && S.t >= b.until){
    const g0 = b.cur ? S.groups.find(g => g.id===b.cur?.gid) : undefined;
    cur0.done = true; cur0.ok = rng() >= CFG.aiBarErr; if (g0) lineMade(g0, 'bar', cur0); b.cur = null; bump();
  }
  if (b.cur) return;
  const g = S.groups.filter(g => g.state==='wait' && must(g.drinks, 'drinks').some(d => !d.done)).sort((a, z) => (a.drinkUntil ?? NaN) - (z.drinkUntil ?? NaN))[0];
  if (g){
    const i = must(g.drinks, 'drinks').findIndex(d => !d.done);
    b.cur = i >= 0 ? { gid: g.id, i } : null; b.until = S.t + 2.2 * CFG.aiPace;
  }
}
