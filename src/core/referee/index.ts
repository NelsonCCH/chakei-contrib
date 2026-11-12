// One step of the shop.
import { kitAuto } from '../stations/kitchen';
import { liveG, bump, me, curLevel, tableAt, D, drivesHere } from '../state';
import { tillStep } from '../stations/till';
import { updatePot, potAutoBoil } from '../stations/bar';
import { CFG } from '../data/menus';
import { celebGroup, makeGroup, spawnGap, makeTake } from './customers';
import { rnd, rng, streamOf } from '../rng';
import { CORE_HOOK } from '../hooks';
import { toast, say, emit } from '../fx';
import { must } from '../util';
import { aiWaiter } from '../bots/waiter';
import { aiBar } from '../bots/bar';
import { feverTick, easeTick, noteBad } from './score';
import { extrasStep, viaStep, delivered, passFull, lineMade } from './extras';
import { patMul } from '../playtest/pace';
import { seatAngry, seatsClose } from './seatscore';
import { workUnpaid } from './work';
import { twistTick, twistPat } from './twist';
import { floorStep } from '../work/floor';
import { dirOn, dirGap, dirStep } from '../party/director';
import { feverGapMul } from './fever';

export function update(dt: number): void {
  // The stations' own steps run where the station is driven: a teammate's phone runs its own (core/coop/phone.ts).
  if (drivesHere('kitchen')) kitAuto();
  const S = liveG();
  S.rt += dt; if (drivesHere('bar')) updatePot();
  if (S.phase==='prep'){
    // 開舖前冇人郁過個茶壺：師傅幫手煲好頭一壺; a teammate's bar does both on its phone (the potReady result)
    if (drivesHere('bar')){ potAutoBoil(); if (S.pot.st==='ready'){ S.phase = 'open'; toast('開門！'); bump(); } }
    return;
  }
  S.t += dt; const t = S.t;
  if (t >= CFG.gameSec && !S.tut){ endShift(); return; } // 教學關冇時限
  // a new mistake is noticed on the step, not the frame: the easing it starts then wears off the same at any frame rate
  // the fever: its start drawn from the daily stream on a daily challenge, so everyone gets the same one
  feverTick(S.drng ? streamOf(S.drng) : rng); twistTick(rng); noteBad(); easeTick(dt);
  for (;;){
    const r = S.regPlan[0];
    if (!r || !(t >= r.at)) break;
    S.regPlan.shift();
    const rg = r.celeb ? celebGroup(r.celeb) : makeGroup(r.key, r.date);
    CORE_HOOK.enqueue(rg); CORE_HOOK.careerArrive(rg);
    if (r.date && me('waiter')) say('waiter', S.groups.some(g => g.regular==='cheung') ? '張太望咗陳生同佢個女伴一眼……' : '陳生今日唔係一個人嚟……');
  }
  if (t >= S.nextSpawn){
    // 每日挑戰：出客用當日種子，人人一樣
    const g = makeGroup(undefined, undefined, S.drng ? streamOf(S.drng) : rng);
    CORE_HOOK.enqueue(g);
    // a party round: the director's door, the next group after this one's waiter seconds at the waiter's pace
    S.nextSpawn = t + (dirOn() ? dirGap(g, feverGapMul(S, t)) : spawnGap(t, S.drng ? streamOf(S.drng) : rng));
  }
  const LV = curLevel();
  if (LV && LV.takeaway && !S.extra?.includes('takeaway')){   // a level with the 外賣 role takes its takeaway customers from the workload model
    if (S.nextTake==null) S.nextTake = t + 5;
    if (t >= S.nextTake){
      if (S.groups.filter(g => g.take).length < 5){ const tk = makeTake(); if (tk) S.groups.push(tk); bump(); }
      else if (me('bar')){ S.angry++; say('bar', '檔口排到出馬路，有人唔等喇'); }
      S.nextTake = t + LV.takeaway * rnd(.7, 1.3) * (me('bar') ? 1 : 1.2);
    }
  }
  extrasStep();
  dirStep(dt);   // a party round: every seat's own work (core/party/director.ts)
  floorStep();   // 樓面: the floor's tasks, claims and the computer's floor workers
  for (const g of [...S.groups]){
    if (g.take){
      if (g.via){ viaStep(g); continue; }
      if (g.drinks.every(d => d.done) && g.meals.every(m => m.done)) CORE_HOOK.takeDone(g);   // the party director's takeaway meals too
      else if (t >= g.drinkUntil){ if (me('bar')){ S.angry++; say('bar', '外賣客等唔切，走咗'); } CORE_HOOK.leave(g, false); }
      continue;
    }
    if (g.state==='order' && g.taken){
      // 張單收埋咗（冇人開住）：等 laterGrace 秒，之後張單放返出嚟（枱頭再閃「落」），耐性由停低嗰度繼續減；寫咗嘅嘢留低
      if (g.later != null && !(S.sheet && S.sheet.gid===g.id)){ g.later -= dt; if (g.later <= 0){ g.taken = false; g.later = null; bump(); } }
      if (g.taken) g.until += dt;
    }
    if (g.state==='wait'){
      const meals = must(g.meals, 'meals'), drinks = must(g.drinks, 'drinks');
      // the extra seats (extras.ts): a full pass holds the cook back
      if (!me('kitchen')) meals.forEach(m => {
        if (m.done || !(t >= (m.doneAt ?? NaN)) || passFull()) return;
        m.done = true; m.ok = rng() >= CFG.aiKitErr; lineMade(g, 'kitchen', m); bump();
      });
      // a line counts once it is at the table (the same as done, unless a runner seat carries it from the pass)
      const roast = g.roast ?? [];
      const foodLate = (meals.some(m => !delivered(m)) || roast.some(m => !delivered(m))) && t >= (g.mealUntil ?? NaN), drinkLate = drinks.some(d => !delivered(d)) && t >= (g.drinkUntil ?? NaN);
      if (meals.every(delivered) && drinks.every(delivered) && roast.every(delivered)) CORE_HOOK.serve(g);
      else if (foodLate || drinkLate){
        // the kitchen's walk-out only while one of its meals is not made (without a pass or a roast seat that is every late table)
        if (foodLate && meals.some(m => !m.done) && me('kitchen')){ S.angry++; say('kitchen', `${tableAt(g.table).name}等食等到嬲，走咗`); }
        if (drinkLate && me('bar')){ S.angry++; say('bar', `${tableAt(g.table).name}等嘢飲等到嬲，走咗`); }
        // the new seats that kept the food: a dish made and still on the pass (傳菜), a roast dish not made (燒味)
        if (foodLate && [...meals, ...roast].some(m => m.passT !== undefined)) seatAngry('runner');
        if (foodLate && roast.some(m => !m.done)) seatAngry('roast');
        tableAt(g.table).dirty += g.size; CORE_HOOK.leave(g, false);
      }
      continue;
    }
    if (t < g.until) continue;
    if (g.state==='queue') CORE_HOOK.leave(g, true, `${g.label}等唔到位，走咗`);
    else if (g.state==='think'){ g.state = 'order'; g.max = CFG.orderPat * D().pat * patMul('waiter') * twistPat(g); g.until = t + g.max; bump(); }
    else if (g.state==='order') CORE_HOOK.leave(g, true);
    else if (g.state==='eat') CORE_HOOK.toPay(g);
  }
  for (const c of [...S.payQ]) if (t >= c.until){
    S.payQ = S.payQ.filter(x => x!==c); S.loss += c.expect ?? NaN; workUnpaid(c.id);
    if (me('till')){ S.angry++; say('till', `${c.label}等唔切，走數！`); }
    bump();
  }
  aiWaiter(); aiBar(); CORE_HOOK.aiTill();
  tillStep();
}

/** The shift is over: the state half of the page's endGame (ui/main.ts), which shows the end card when 'end' is emitted. */
export function endShift(): void {
  const S = liveG();
  seatsClose();   // bags left standing at the bell
  S.running = false; S.t = CFG.gameSec; CORE_HOOK.closeSheet(); CORE_HOOK.closeBoard(); bump();
  emit({ k: 'end' });
}
