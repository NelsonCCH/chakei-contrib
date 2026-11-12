// Customers coming and going.
import { liveG, slot, D, me, bump, atTable, occupied, tableAt, G, byId } from '../state';
import { must } from '../util';
import { COLORS, REG, CFG, SLOTS, CELEBS } from '../data/menus';
import { clonePerson, sayPerson, randPerson, randSize, groupKind, genOrder, sigLine } from '../rules/order';
import { pickSure, rnd, pick, rng, type Rng } from '../rng';
import { PORT } from '../env';
import { CORE_HOOK } from '../hooks';
import { toast, say, floatAt, sfx } from '../fx';
import { itemsOf, isMeal, priceSlip, label, grade } from '../rules/price';
import { aiSlip } from '../bots/waiter';
import { directorBias, demandGap } from './flow';
import { patMul, flowGapMul } from '../playtest/pace';
import { feverGapMul } from './fever';
import { tallyMiss } from '../coop/tally';   // a party round's mistakes per person
import { workDine, workEnqueued, workSize, workGapK, runnerHeld } from './work';

/** `r`: the stream to draw from (the daily challenge passes its own, G.drng, so everyone gets the same customers). */
export function makeGroup(regKey?: string, date?: boolean, r: Rng = rng): SeatGroup {
  const S = liveG();
  const id = S.nextId++, color = must(COLORS[S.colorIx++ % COLORS.length], 'colour');
  let g: SeatGroup;
  if (regKey){
    const rg = must(REG[regKey], 'regular ' + regKey);
    g = { id, color, state:'queue', table:null, draft:null,
          size:1, label:rg.label, regular:regKey, repeat: rg.persist ? PORT.regVisits(regKey) > 0 : !!S.regSeen[regKey], persons: must(rg.persons[slot], 'order of ' + regKey).map(clonePerson),
          lines:[], items:[], max:0, until:0 };
    g.lines = g.repeat ? [pickSure(['照舊。','照舊，唔該。','老樣。'], r)] : ['唔該，' + sayPerson(must(g.persons[0], 'person'), r) + '。'];
    if (date){
      // 彩蛋：陳生帶咗個女伴嚟，佢照舊，女伴自己落單
      const her = randPerson(r);
      g.size = 2; g.noShare = true; g.date = true; g.label = rg.label + '同女伴';
      g.persons.push(her); g.lines.push('（女伴）我要' + sayPerson(her, r) + '。');
    }
  } else {
    const size = Math.min(workSize(r) ?? randSize(r), Math.max(...S.tables.map(tb => tb.cap)));   // 全舖最大嘅枱坐唔落就唔好嚟（街邊奶茶檔全部係二人枱）
    const kind = groupKind(size, r);
    const o = genOrder(size, r);
    g = { id, color, state:'queue', table:null, draft:null, size, ...kind, persons: o.persons, lines: o.lines, items:[], max:0, until:0 };
  }
  g.items = itemsOf(g.persons);
  if (!regKey) sigLine(g, r);
  g.max = CFG.queuePat * D().pat * PORT.setPat() * patMul('waiter'); g.until = S.t + g.max;
  workDine(g, r);   // the workload model: which diners take 燒味 (a shop with extra seats only)
  return directorBias(g);
}
export function enqueue(g: SeatGroup): void {
  const S = liveG();
  if (S.groups.filter(x => x.state==='queue').length >= CFG.queueMax + (S.qBonus || 0)){
    if (me('waiter')){ S.angry++; say('waiter', '門口排得太長，有客行咗去第二間'); }
    return;
  }
  S.groups.push(g); workEnqueued(g); bump();
}
// 唔係做伙記：等飲、等食、等埋單嘅耐性再長啲
export const SP = (): number => me('waiter') ? 1 : D().spat;
// 座位多過預設 20 個，客人嚟得密啲（最多快三成）
export function seatGap(): number { const s = liveG().tables.reduce((a, tb) => a + tb.cap, 0); return Math.max(D().seat, Math.min(1, 20 / s)); }
/**
 * Seen in play at 屋邨's 傳菜 seat: the shop's arrival curve (a slow start, a busy middle from 35 s to
 * 135 s, a slow end) left the runner 30 s with nothing on the pass, then a busy middle. With a person at the 傳菜 seat the
 * base gap is the curve's harmonic mean over the shift (the same expected number of groups) with a narrower jitter, so
 * tables, and their dishes, reach the pass at an even pace. The shop's four alone (solo, the default room) keep the curve.
 */
export const RUNNER_BASE = CFG.gameSec / (100 / 6 + (CFG.gameSec - 100) / 8.5), RUNNER_JIT = 0.6;
// G.ease：手忙腳亂就自動疏啲客，順手就密返啲（見 juice.js）; the fever's heat brings them closer (fever.ts; it took
// over from the old rush wave)
export function spawnGap(t: number, r: Rng = rng): number { const S = liveG(); return demandGap(PORT.setBoost() * seatGap() * (S.ease || 1) * feverGapMul(S, t) * (me('waiter') ? 1 : D().sgap) * (runnerHeld(S) ? RUNNER_BASE + rnd(-RUNNER_JIT, RUNNER_JIT, r) : (t > 35 && t < 135 ? 6 : 8.5) + rnd(-1.5, 1.5, r)) * D().gap * (SLOTS[S.slot].gap || 1) * (me('bar') ? CFG.barGap : me('kitchen') ? CFG.kitGap : me('till') ? CFG.tillGap : 1) * flowGapMul() * workGapK()); }
export function seatProblem(g: Group, tb: TableState): string {
  const others = atTable(tb.id);
  if (g.noShare && others.length) return '情侶唔想搭枱';
  if (others.some(o => o.noShare)) return '呢枱有對情侶，唔好打擾人';
  const free = tb.cap - occupied(tb.id) - tb.dirty;
  if (free < g.size) return tb.dirty && free + tb.dirty >= g.size ? 'dirty' : `位唔夠，${tb.name}得返 ${Math.max(0,free)} 個位`;
  return '';
}
export function leave(g: Group, angry: boolean, why?: string): void {
  const S = liveG();
  S.groups = S.groups.filter(x => x!==g);
  if (S.selected===g.id) S.selected = null;
  if (S.sheet && S.sheet.gid===g.id){ CORE_HOOK.closeSheet(); toast(`${g.label}等唔切你落單，走咗`); }
  else if (why && me('waiter')) say('waiter', why);
  if (angry && me('waiter')){ S.angry++; if (g.table!==null) floatAt(g.table, '嬲走！', 'var(--red)'); }
  bump();
}
// 外賣客（布袋奶茶檔）：喺門口奶茶檔排隊買嘢飲，唔使坐、唔經伙記同收銀，水吧沖好即刻收錢
export const tName = (g: Group): string => g.take ? '外賣' : tableAt(g.table).name;
export function makeTake(): TakeGroup | null {
  const g = makeGroup(), ks = g.items.filter(k => !isMeal(k));
  if (!ks.length) return null;
  const drinkMax = CFG.drinkPat * D().pat * SP() * 1.1 * patMul('bar'), drinkUntil = liveG().t + drinkMax;
  return { id:g.id, color:g.color, label:'外賣客', size:1, take:true, state:'wait', table:null, items:ks, slip:ks, result:{ correct:true },
    drinks: ks.slice(0, 2).map(k => ({ k, done:false, ok:true })), meals:[], drinkMax, drinkUntil, until: drinkUntil, max: drinkMax, orderAt: liveG().t };
}
export function takeDone(g: TakeGroup): void {
  const S = liveG();
  S.groups = S.groups.filter(x => x!==g);
  const bad = g.drinks.filter(d => !d.ok), pay = priceSlip([...g.drinks, ...g.meals].map(d => d.k)).total;   // a party director's takeaway meal is paid here too
  S.revenue += pay; S.paidCount++; S.served++;
  if (me('bar')){ if (bad.length){ S.mistakes++; tallyMiss('bar'); say('bar', `外賣客：呢杯${label(must(bad[0], 'drink').k)}唔啱喎！（照俾錢）`); } else toast(`外賣收 $${pay}`); }
  if (me('bar') && S.bench.target && S.bench.target.gid===g.id) S.bench.target = null;   // the player picks the next ticket
  bump();
}
export function celebGroup(key: string): SeatGroup {
  let g: SeatGroup; do g = makeGroup(); while (g.size > 2);
  Object.assign(g, { label:'戴黑超嘅客', celeb:key, noShare:true });
  return g;
}
// 熟客入門：講佢嘅故事（每次講下一段: the page tells it, PORT.regArrive）
export function careerArrive(g: SeatGroup): void {
  PORT.regArrive(g);
  // 名人：六成機會俾人認出，門口即刻排長龍
  if (g.celeb && rng() < .6) liveG().rush = { at: liveG().t + 6, gid: g.id, celeb: g.celeb, left: 4 + Math.floor(rng() * 3), next: 0 };
}
// 粉絲潮：名人俾人認出之後，每兩秒半嚟一枱粉絲；門口暫時排得多啲
export function careerTick(): void {
  const R = G && G.running && !G.paused && G.rush; if (!R || liveG().t < R.at) return;
  const S = liveG();
  if (!R.started){
    R.started = true; S.qBonus = 5;
    const cg = byId(R.gid); if (cg) cg.label = must(CELEBS[R.celeb], 'celebrity').name; bump();
    toast(`有人認出咗戴黑超嗰位係${must(CELEBS[R.celeb], 'celebrity').name}！門口即刻排長龍！`); sfx.fanfare();
  }
  if (R.left > 0 && S.t >= R.next){
    let f: SeatGroup; do f = makeGroup(); while (f.size > 3);
    Object.assign(f, { label: pick(['粉絲', '兩個粉絲', '追星族', '粉絲團']), noShare:false });
    f.max *= 1.4; f.until = S.t + f.max;
    CORE_HOOK.enqueue(f); R.left--; R.next = S.t + 2.5;
  }
  if (R.left <= 0 && !S.groups.some(x => x.state==='queue')){ S.qBonus = 0; S.rush = null; }
}
// 收銀開工時，已經有幾枱客食緊，好快就嚟埋單（ui/main.ts start 開工時叫）
export function tillWarmup(): void {
  if (!me('till')) return;
  const S = liveG();
  [0, 1, 4].forEach((tid, i) => {
    let g: SeatGroup; do g = makeGroup(); while (g.size > must(S.tables[tid], 'table ' + String(tid)).cap);
    S.groups.push(g); g.table = tid; g.slip = aiSlip(g); g.result = grade(g.items, g.slip);
    g.state = 'eat'; g.max = 1; g.until = 1.5 + i * 4;
  });
}
