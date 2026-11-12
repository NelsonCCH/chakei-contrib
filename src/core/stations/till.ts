// The till: total, change (no DOM).
import { must } from '../util';
import { liveG, bump, G, me, drivesHere } from '../state';
import { submit } from '../coop/results';
import { NOTES } from '../data/menus';
import { pickSure, rng } from '../rng';
import { CORE_HOOK } from '../hooks';
import { toast, emit } from '../fx';

export function cashNote(T: number): { paid: number; neat: boolean } {
  const notes: [number, number] | [number] = T <= 20 ? [20, 50] : T <= 50 ? [50, 100] : T <= 100 ? [100, 500] : T < 500 ? [Math.ceil(T/100)*100, 500] : [1000];
  let paid = rng() < .7 ? notes[0] : (notes[1] || notes[0]);
  let neat = false;
  if (rng() < .3 && T % 10 && paid - T >= 10){ paid += T % 10; neat = true; }
  return { paid, neat };
}
export function custSay(line: string): void { must(must(liveG().cur, 'G.cur').paySay, 'paySay').push(line); bump(); }
/** k: the key's data-k (undefined for a pad button without one, as the JS passed it on). */
export function tillKey(k: string | undefined): void {
  const S = liveG();
  if (!S.cur || !S.running || S.paused || S.board) return;
  if (S.step==='total'){
    // 數字鍵同時係計數機：撳「＋」可以一樣一樣加
    if (k==='back') S.entry = S.entry.slice(0, -1);
    else if (k==='clr') S.entry = '';
    else if (k==='+'){ if (/\d$/.test(S.entry)) S.entry += '+'; }
    else if (k==='ok'){ CORE_HOOK.submitTotal(); return; }
    else if (/^\d$/.test(String(k)) && S.entry.length < 30) S.entry = (S.entry + String(k)).replace(/(^|\+)0+(\d)/g, '$1$2');
  } else {
    if (k==='back') S.give.pop();
    else if (k==='ok'){ CORE_HOOK.submitChange(); return; }
    else if (NOTES.includes(Number(k))) S.give.push(Number(k));
  }
  emit({ k: 'pad' });
}
export const sumEntry = (s: string): number => s.split('+').filter(Boolean).reduce((a, b) => a + +b, 0);
export function submitTotal(): void {
  const S = liveG();
  const c = S.cur, v = sumEntry(S.entry);
  if (!S.entry){ toast('未打數'); return; }
  const cur = must(c, 'G.cur'), expect = cur.expect ?? NaN;
  if (v > expect){ submit('till', { k: 'tillMiss', cid: cur.id, loss: 0 }); S.entry = ''; custSay(pickSure(['做乜咁貴呀？計多次啦！','唔係咁多錢掛？'])); return; }
  if (v < expect){ submit('till', { k: 'tillMiss', cid: cur.id, loss: expect - v }); toast(`少收咗 $${expect - v}`); }
  S.charged = v;
  if (cur.octo && !cur.octoShort){ CORE_HOOK.finishCust('嘟！唔該。'); return; }
  if (cur.octo){ cur.octo = false; must(cur.paySay, 'paySay').push('嘟……咦，唔夠錢？俾現金啦。'); }
  const n = cashNote(v); S.paid = n.paid; S.step = 'cash'; S.give = [];
  custSay(n.neat ? `俾你 $${S.paid}，方便你找。` : `$${S.paid}，唔該。`);
}
export function submitChange(): void {
  const S = liveG();
  const need = S.paid - S.charged, give = S.give.reduce((a, b) => a + b, 0);
  if (give < need){ submit('till', { k: 'tillMiss', cid: must(S.cur, 'G.cur').id, loss: 0 }); custSay(`仲差 $${need - give} 呀！`); return; }
  if (give > need){ submit('till', { k: 'tillMiss', cid: must(S.cur, 'G.cur').id, loss: give - need }); toast(`多找咗 $${give - need}`); CORE_HOOK.finishCust('咦，多咗喎……（袋咗）'); return; }
  CORE_HOOK.finishCust(pickSure(['唔該！','多謝晒。','走喇，拜拜。']));
}
export function finishCust(line: string): void {
  const S = liveG();
  submit('till', { k: 'tillPaid', cid: must(S.cur, 'G.cur').id, charged: S.charged });   // revenue, paidCount, good()
  must(must(S.cur, 'G.cur').paySay, 'paySay').push(line); S.lastCust = S.cur;
  S.cur = null; S.entry = ''; S.give = []; S.nextCust = S.t + .8; bump();
}
/** The till's own step (where the till is driven: its player's phone, or the host on the old net path): the next customer in the pay queue comes to the counter. */
export function tillStep(): void {
  const S = liveG(), c = S.payQ[0];
  if (me('till') && drivesHere('till') && !S.cur && c && S.t >= S.nextCust){
    submit('till', { k: 'tillTake', cid: c.id });   // the referee takes them out of the pay queue
    S.cur = c; S.step = 'total'; S.entry = ''; S.give = []; bump();
  }
}
// 收銀：劃走客人話冇叫嘅嗰行
export function strikeLine(i: number): void { const S = liveG(); if (!S.cur) return; const l = must(S.cur.payLines, 'pay lines')[i]; if (l){ l.struck = !l.struck; bump(); } }
export function closeBoard(): void { if (G) G.board = false; emit({ k: 'boardClosed' }); }
