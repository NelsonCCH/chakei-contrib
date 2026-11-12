// 熟練度：每個位記低最高營業額、最長連擊、做咗幾多更；做啱嘅次數累積升稱號
// TypeScript port of the original game's mastery.js, as an ES module: every
// top-level name is exported, none renamed.
import './career';   // load order: src/entry.ts




import { must } from '../core/util';
import { G } from '../core/state';
import { $ } from './prefs';
import { toast } from './ui';
import { SHOP, saveShop } from './decor';
import { sfx } from './juice';
import { seatName, dsEl } from './levels';
import { shiftMeasure, measureName, measureTxt } from '../core/career/targets';


/* ===================== 稱號 ===================== */
// n = 呢個位累積做啱幾多次（落啱單、出啱碟、沖啱杯、收啱錢）
export const MASTER: Record<string, [number, string][]> = {
  waiter:  [ [0,'見習伙記'], [60,'落單快手'], [200,'樓面一哥'], [500,'茶記活字典'], [1000,'傳說樓面'] ],
  kitchen: [ [0,'打荷'], [60,'煮麵佬'], [200,'鑊氣王'], [500,'大廚'], [1000,'傳說廚神'] ],
  bar:     [ [0,'沖茶學徒'], [60,'撞茶能手'], [200,'沖奶茶師傅'], [500,'絲襪奶茶宗師'], [1000,'傳說水吧'] ],
  till:    [ [0,'收銀學徒'], [60,'心算達人'], [200,'找錢快槍手'], [500,'人肉計數機'], [1000,'傳說收銀'] ],
  // the new seats: 上啱枱、洗好一件、斬好一碟、交啱一袋都算做啱
  runner:  [ [0,'見習傳菜'], [60,'穩手托盤'], [200,'飛毛腿'], [500,'出餐口一哥'], [1000,'傳說傳菜'] ],
  roast:   [ [0,'斬料學徒'], [60,'刀仔快手'], [200,'燒味師傅'], [500,'斬料宗師'], [1000,'傳說燒味'] ],
  takeaway:[ [0,'外賣學徒'], [60,'執袋快手'], [200,'綁袋能手'], [500,'外賣一哥'], [1000,'傳說外賣'] ],
};
SHOP.mastery = SHOP.mastery || {};
export const mRec = (st: string): MasteryRec => (must(SHOP.mastery, 'SHOP.mastery')[st] = must(SHOP.mastery, 'SHOP.mastery')[st] || { n:0, shifts:0, rev:0, combo:0, three:0 });
export function mTitle(st: string, n = mRec(st).n): { name: string; next: [number, string] | undefined; i: number } {
  const L = must(MASTER[st], 'titles of ' + st); let i = 0; L.forEach(([need], k) => { if (n >= need) i = k; });
  return { name: must(L[i], 'title')[1], next: L[i + 1], i };
}
/* ===================== 收工：記紀錄 ===================== */
// 教學關唔計；組隊計自己個位
export function masteryEnd(stars: number): void {
  if (!G || G.tut || G.mastered) return; G.mastered = true;   // every seat has titles
  const st = G.xseat ?? G.station, r = mRec(st), before = mTitle(st), news: string[] = [];
  // the seat's own measure (洗碗分, 燒味收入, 外賣收入, else the takings): the record and the picker read it (shiftMeasure)
  const rev = G.coop ? G.revenue : shiftMeasure(G);
  r.n += (G.goods ?? 0)|0; r.shifts++;
  if (stars===3) r.three++;
  if (rev > r.rev){ if (r.rev) news.push(`最高${measureName(G.coop ? undefined : G.xseat)} ${measureTxt(G.coop ? undefined : G.xseat, rev)}`); r.rev = rev; }
  if (((G.maxCombo ?? 0)|0) > r.combo){ if (r.combo) news.push(`最長連擊 ${String(G.maxCombo)}`); r.combo = (G.maxCombo ?? 0)|0; }
  saveShop();
  const after = mTitle(st);
  const up = after.i > before.i;
  const M = must(MASTER[st], 'titles of ' + st), cur = must(M[after.i], 'title');
  must($('result'), 'result').insertAdjacentHTML('beforeend', `<div class="wide mastery"><span>${seatName(st)}熟練度</span>
    <b>${after.name}</b>
    <i style="--p:${after.next ? Math.round((r.n - cur[0]) / (after.next[0] - cur[0]) * 100) : 100}%"></i>
    <span>${after.next ? `做啱 ${r.n}／${after.next[0]} 升「${after.next[1]}」` : `做啱 ${r.n} 次，已經係最高稱號`}</span>
    ${news.length ? `<em>新紀錄！${news.join('、')}</em>` : ''}</div>`);
  if (up){ toast(`升咗稱號：${after.name}！`); sfx.fanfare(); }
}
// 開工畫面：揀位個掣寫住你嘅稱號
export function masteryMenu(): void {
  document.querySelectorAll('#stSeg button').forEach(b => {
    const st = String(dsEl(b).dataset.st); if (!MASTER[st]) return;
    const r = mRec(st), t = mTitle(st);
    const mt = b.querySelector('.mt'); if (!mt) return;
    mt.innerHTML = `${t.name}${r.shifts ? ` · ${measureTxt(st, r.rev)}` : ''}`;
  });
}
