// The shop's judgement of what the stations did.
import { liveG, atTable, bump, me, D, tableAt, curLevel } from '../state';
import { rnd, pickSure, rng } from '../rng';
import { PORT } from '../env';
import { CORE_HOOK } from '../hooks';
import { toast, say, floatAt } from '../fx';
import { CFG, UP_TIP, SIG_SAY } from '../data/menus';
import { thinkF, isSig } from '../rules/order';
import { grade, isMeal, label, disputes, priceSlip, itemRecipeKey } from '../rules/price';
import { SP } from './customers';
import { must } from '../util';
import { orderPlaced } from './extras';
import { patMul } from '../playtest/pace';
import { tallyMiss } from '../coop/tally';   // a party round's mistakes per person
import { twistPat } from './twist';

export function seat(g: SeatGroup, tb: TableState): void {
  const S = liveG();
  const shared = atTable(tb.id).length > 0;
  g.state = 'think'; g.table = tb.id; g.until = S.t + rnd(...CFG.think) * thinkF(g); g.max = 1; g.seatAt = S.t;
  if (S.selected===g.id) S.selected = null;
  bump();
  if (me('waiter')) floatAt(tb.id, shared ? '搭枱' : '請坐', 'var(--ok)');
}
export function cleanTable(tb: TableState): void { tb.dirty = 0; if (me('waiter')) floatAt(tb.id, '執好', 'var(--ok)'); bump(); }
export function submitOrder(g: SeatGroup, keys: string[], byMe?: boolean): void {
  const S = liveG();
  const result = grade(g.items, keys);
  g.slip = keys; g.result = result; g.orderAt = S.t;   // the third star's timing of the waiter is the order result's (core/coop/results.ts)
  g.drinks = keys.filter(k => !isMeal(k)).map(k => ({ k, done:false, ok:true }));
  g.drinkMax = CFG.drinkPat * D().pat * SP() * PORT.setPat() * patMul('bar') * twistPat(g); g.drinkUntil = S.t + g.drinkMax;
  g.meals = keys.filter(isMeal).map((k, i) => ({ k, done:false, ok:true, doneAt: S.t + CFG.cook + i * 1.5 }));
  g.mealMax = CFG.foodPat * D().pat * SP() * PORT.setPat() * patMul('kitchen') * twistPat(g); g.mealUntil = S.t + g.mealMax;
  orderPlaced(g);
  if (byMe && g.regular && g.repeat){ if (result.correct){ if (!g.peeked) S.regHit++; } else S.regMiss++; }
  if (byMe && result.correct) CORE_HOOK.good();
  g.state = 'wait'; g.max = CFG.cook; g.until = S.t + g.max; bump();
  if (me('waiter')) floatAt(g.table, '落咗單', 'var(--amber)');
}
export function serve(g: SeatGroup): void {
  const S = liveG();
  // 整錯／沖錯：客人退返嚟要你整過，最多兩次，之後佢就照食照鬧
  const badM = must(g.meals, 'meals').filter(m => !m.ok), badD = must(g.drinks, 'drinks').filter(d => !d.ok);
  const tn = tableAt(g.table).name;
  if ((badM.length || badD.length) && ((g.returns ?? 0)|0) < 2){
    g.returns = ((g.returns ?? 0)|0) + 1;
    badM.forEach(m => { m.done = false; m.ok = true; m.redo = true; m.doneAt = S.t + 4; });
    badD.forEach(d => { d.done = false; d.ok = true; d.redo = true; });
    if (badM.length){
      g.mealUntil = Math.max(g.mealUntil ?? NaN, S.t + CFG.redoPat * D().pat * SP() * patMul('kitchen') * twistPat(g)); g.mealMax = Math.max(g.mealMax ?? NaN, g.mealUntil - S.t);
      if (me('kitchen')){ S.mistakes++; tallyMiss('kitchen'); say('kitchen', `${tn}：呢碟${label(must(badM[0], 'meal').k)}唔啱，要整過！`); }   // 張飛返咗上去，自己揀幾時整（唔再自動揀）
    }
    if (badD.length){
      g.drinkUntil = Math.max(g.drinkUntil ?? NaN, S.t + CFG.redoPat * D().pat * SP() * patMul('bar') * twistPat(g)); g.drinkMax = Math.max(g.drinkMax ?? NaN, g.drinkUntil - S.t);
      if (me('bar')){ S.mistakes++; tallyMiss('bar'); say('bar', `${tn}：呢杯${must(badD[0], 'drink').k}唔啱，要換過！`); }
    }
    if (me('waiter')) floatAt(g.table, badM.length ? '碟嘢要整過' : '杯嘢飲要換過', 'var(--red)');
    bump(); return;
  }
  const result = must(g.result, 'result');
  if (!result.correct && me('waiter')){ S.mistakes++; tallyMiss('waiter'); floatAt(g.table, result.complaint, 'var(--red)');
    // 記低邊張單落錯，收工畫面睇得返（客人講乜、你寫咗乜、應該係乜）
    S.errLog = S.errLog || []; S.errLog.push({ tb: tn, said: g.lines.join(''), wrote: (g.slip || []).map(k => label(k)), want: g.items.map(k => label(k)), say: result.complaint }); if (S.errLog.length > 12) S.errLog.shift(); }
  else if (badM.length || badD.length){
    if (badM.length && me('kitchen')){ S.mistakes++; tallyMiss('kitchen'); say('kitchen', `${tn}：呢碟${label(must(badM[0], 'meal').k)}唔啱喎！`); }
    if (badD.length && me('bar')){ S.mistakes++; tallyMiss('bar'); say('bar', `${tn}：呢杯${must(badD[0], 'drink').k}唔啱喎！`); }
    if (me('waiter')) floatAt(g.table, '啲嘢唔啱喎', 'var(--red)');
  }
  if (me('bar') && S.bench.target && S.bench.target.gid===g.id) S.bench.target = null;   // the player picks the next ticket
  if (me('kitchen') && S.ksel && S.ksel.gid===g.id) S.ksel = null;
  g.state = 'eat'; g.max = 1; g.until = S.t + rnd(...CFG.eat); bump();
}
// 食完：起身去收銀排隊，張枱留低碗碟
export function toPay(g: SeatGroup): void {
  const S = liveG();
  tableAt(g.table).dirty += g.size; S.served++; careerPaid(g); sigTip(g);
  if (me('waiter')) floatAt(g.table, '埋單', 'var(--mute)');
  const slip = g.slip || [], dis = disputes(g.items, slip);
  const expect = priceSlip(slip.filter((_k, i) => !dis.includes(i))).total;
  g.expect = expect;
  g.payLines = slip.map((k, i) => ({ k, struck:false, extra: dis.includes(i) }));
  const paySay = [g.date ? '（陳生）一齊計，我請。' : pickSure(['埋單，唔該。','幾多錢呀？','唔該埋單。','計數。'])];
  g.paySay = paySay;
  dis.forEach(i => paySay.push(`咦，我哋冇叫${label(must(slip[i], 'slip line'))}喎。`));
  const octo = rng() < .3;
  g.octo = octo; g.octoShort = octo && rng() < .2;
  if (octo) paySay.push(pickSure(['八達通。','我拍卡。']));
  g.tableName = tableAt(g.table).name;
  g.state = 'pay'; g.table = null; g.max = CFG.cashPat * D().pat * SP() * patMul('till') * twistPat(g); g.until = S.t + g.max;
  S.groups = S.groups.filter(x => x!==g);
  // 信徒之選：偶然有神秘客食完就唔見咗，枱面留低雙倍錢
  const ghostOn = (PORT.placeFx().ghost || PORT.setOn('spooky')) || curLevel()?.ghost;
  if (ghostOn && ((S.ghosts ?? 0)|0) < (S.level ? 3 : 2) && rng() < (S.level ? .1 : .07)){
    S.ghosts = ((S.ghosts ?? 0)|0) + 1; S.revenue += expect * 2; S.tips = ((S.tips ?? 0)|0) + expect;
    toast(`咦？${g.tableName}個客食完……人呢？枱面留低 $${expect * 2}，仲有陣香燭味……`);
  } else S.payQ.push(g);
  if (S.selected===g.id) S.selected = null;
  bump();
}
export function sigTip(g: SeatGroup): number {
  if (!PORT.inMyShop()) return 0;
  // inMyShop() was true, so a shift is running (G is set) from here on.
  const t = Math.min(30, g.items.reduce((a, k) => a + (UP_TIP[PORT.recipeLv(itemRecipeKey(k))] ?? NaN), 0));   // 一枱最多 $30
  if (t){ liveG().revenue += t; liveG().tips = ((liveG().tips ?? 0)|0) + t; }
  const k = g.items.find(isSig);
  if (k && !g.regular && liveG().t - (liveG().sigSaid ?? -99) > 15){ liveG().sigSaid = liveG().t; toast(`${g.label || '客人'}：${pickSure(SIG_SAY)(PORT.fancyName(itemRecipeKey(k)))}招牌菜貼士 $${t}`); }
  return t;
}
// 熟客、名人埋單：貼士入營業額（記數、多謝說話由舖頭嗰邊做：PORT.regPaid, ui/career.ts careerPaid）
export function careerPaid(g: SeatGroup): void {
  const tip = PORT.regPaid(g);
  if (tip){ const S = liveG(); S.revenue += tip; S.tips = ((S.tips ?? 0)|0) + tip; }
}
