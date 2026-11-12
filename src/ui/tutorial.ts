// 說明頁同教學關
// TypeScript port of the original game's tutorial.js, as an ES module: every
// top-level name is exported, none renamed.
import './gates';   // load order: src/entry.ts
import { HOOK } from './hooks';
import { must, ownKey } from '../core/util';
import { STATIONS, DIFFS, NOTES, ING } from '../core/data/menus';
import { $ } from './prefs';
import { station, diff, setDiff, slot, setSlot, setStation, liveG, activePlate, byId, G } from '../core/state';
import { makeGroup, seatProblem } from '../core/referee/customers';
import { clonePerson, sayPerson } from '../core/rules/order';
import { itemsOf, foodId } from '../core/rules/price';
import { pullsNeed, recipeOf, kitRecipe } from '../core/rules/recipes';
import { slotState, selOk, kitLayout } from '../core/stations/kitchen';
import { kitMode, ktv, kHits, KPOP } from './kitchen';
import { BSC } from './bar-art';
import { iconImg } from './icons';
import { FSC } from './floor-iso';
import { SHOP, fixedShop, useFixedShop, saveShop } from './decor';
import { L, bossSay, roleOpenNow, floorLessonNow } from './career';
import { closestIn, stationOf, stDef } from './levels';
import { trackOnce, track } from './stats';
import { saveSet, buildMenus, start, endGame } from './main';
import { SEAT_NAMES } from './seat';
import { EXTRA_KINDS, isExtraKind } from '../core/referee/extras';
import { xTutTick, X_SHORT, fTutTick, FLOOR_NAMES, F_SHORT } from './xseat';
import { FLOOR_LESSONS, isFloorLesson, type FloorLesson } from '../core/work/roles';
import { seatName } from '../net/net';

/* ===================== 說明頁 ===================== */
export let helpSt: string | undefined = 'waiter';
export const HOW: Record<string, string> = { waiter:'howWaiter', kitchen:'howKit', bar:'howBar', till:'howTill', runner:'howRunner', roast:'howRoast', takeaway:'howTake', all:'howAll' };
// 每項嘅小圖：[種類, 名]（見 icons.js）
export const HOW_PIC: Record<string, [string, string]> = {
  帶位:['how','seat'], 落單:['ui','waiter'], 泡泡:['how','bubble'], 早市:['tok','多士'], 晚市:['tok','番茄牛肉飯'],
  睇飛:['how','slip'], 沖:['ui','bar'], 茶壺:['ing','茶'],
  開火:['tok','公仔麵'], 上碟:['tok','煎蛋'], 出餐:['how','serve'],
  計數:['ui','till'], 找錢:['how','coins'], 執手尾:['how','strike'], 跟餐:['how','set'],
  星星:['how','star'], 老闆目標:['how','combo'], 做法:['how','rank'], 關卡:['ui','till'], 供舖:['how','agent'], 硬核:['how','coins'], 升職:['how','rank'],
};
// 一行圖解：圖 ＋ 圖 → 結果
export const hIco = (k: string, n: string): string => iconImg(k, n), hArr = '<i class="fa">→</i>', hPlus = '<i class="fa">＋</i>', hChip = (t: string, bg: string, fg = '#0f1a16'): string => `<b class="hc" style="background:${bg};color:${fg}">${t}</b>`;
export const HOW_FLOW: Record<string, () => string> = {
  帶位: () => `${hIco('how', 'seat')}${hChip('卡位 4 人', '#c84e44', '#fff')}${hChip('細枱 2 人', '#a77c4c', '#fff')}`,
  泡泡: () => ([['落', '#c8323c', '#fff'], ['睇', '#e6f1ec'], ['寫', '#ffd25a'], ['等', '#ffd25a'], ['飲', '#9fd3ff'], ['食', '#7be08f'], ['執', '#fbfaf4']] satisfies [string, string, string?][]).map(([t, b, f]) => hChip(t, b, f)).join(''),
  沖: () => `${hChip('熱杯', '#e6ecef')}${hPlus}${hIco('ing', '淡奶')}${hPlus}${hIco('ing', '茶')}${hArr}${hChip('熱奶茶', '#c48a5a', '#fff')}<i class="br"></i>${hChip('凍杯', '#bfe3ff')}${hPlus}${hIco('ing', '淡奶')}${hPlus}${hIco('ing', '茶')}${hPlus}${hIco('ing', '冰')}${hPlus}${hIco('ing', '糖水')}×2${hArr}${hChip('凍奶茶', '#9fd3ff')}`,
  茶壺: () => `${hChip('煲', '#ff8a3a', '#fff')}${hArr}${hChip('焗', '#e9a21a')}${hArr}${hChip('撞茶 ×' + String(pullsNeed()), '#c48a5a', '#fff')}${hArr}${hIco('ing', '茶')}`,
  開火: () => `${hIco('tok', '公仔麵')}${hArr}${hChip('煲 計時', '#5d6870', '#fff')}${hArr}${hChip('得', '#7be08f')}${hArr}${hIco('how', 'serve')}`,
  上碟: () => `${hChip('得', '#7be08f')}${hChip('快啲攞', '#ffd25a')}${hChip('遲咗會燶', '#2b2420', '#fff')}`,
  計數: () => `${hIco('how', 'slip')}${hArr}${hChip('撳數字', '#fbfaf4')}${hArr}${hChip('收', '#c8323c', '#fff')}${hArr}${hIco('how', 'coins')}`,
  關卡: () => `${hChip('營業額', '#7be08f')}${hArr}${hChip('★ 第一條線', '#ffd25a')}${hChip('★★', '#ffd25a')}${hChip('★★★', '#ffd25a')}${hArr}${hChip('開下一關', '#c8323c', '#fff')}`,
  星星: () => `${hChip('★ 嬲走 ≤ 3', '#ffd25a')}${hChip('★★ 做到目標', '#ffd25a')}${hChip('★★★ 冇乜出錯', '#ffd25a')}`,
};
export let howDone = false;
export function decorateHelp(): void {
  if (howDone) return; howDone = true;
  document.querySelectorAll('#helpView .howto dt').forEach(dt => {
    const k = must(dt.textContent, 'dt text').trim(), pic = HOW_PIC[k];
    if (pic) dt.insertAdjacentHTML('afterbegin', iconImg(pic[0], pic[1]));
    const flow = HOW_FLOW[k];
    if (flow) must(dt.nextElementSibling, 'dd after ' + k).insertAdjacentHTML('beforeend', `<span class="hflow">${flow()}</span>`);
  });
}
export function renderHelp(): void {
  decorateHelp();
  const tabs: [string, { name: string }][] = [...Object.entries(STATIONS), ...EXTRA_KINDS.filter(roleOpenNow).map((k): [string, { name: string }] => [k, { name: SEAT_NAMES[k] }]), ['all', { name:'通用' }]];
  must($('helpTabs'), 'helpTabs').innerHTML = tabs.map(([k, d]) => `<button type="button" data-h="${k}" aria-pressed="${String(k===helpSt)}">${iconImg(k==='all' ? 'how' : 'ui', k==='all' ? 'star' : k)}<b>${d.name}</b></button>`).join('');
  Object.entries(HOW).forEach(([k, id]) => { must($(id), id).hidden = k!==helpSt; });
}
must($('helpBtn'), 'helpBtn').onclick = () => { helpSt = G && G.running && G.xseat ? G.xseat : station; renderHelp(); must($('helpView'), 'helpView').hidden = false; must($('helpClose'), 'helpClose').focus(); };
must($('helpTabs'), 'helpTabs').addEventListener('click', e => { const b = closestIn(e.target, 'button'); if (b){ helpSt = b.dataset.h; renderHelp(); } });
// e.target.id: an element's id; any other target has no id (undefined), as in the JS.
must($('helpView'), 'helpView').addEventListener('click', e => { const id = e.target instanceof Element ? e.target.id : undefined; if (id==='helpClose' || id==='helpView') must($('helpView'), 'helpView').hidden = true; });

/* ===================== 教學關 ===================== */
// 好慢、好有耐性、冇熟客名人；上面一條提示跟住你做緊乜變；做完三枱客就完
Object.defineProperty(DIFFS, 'tut', { enumerable:false, value:
  { name:'教學', desc:'', slow:0, pat:5, gap:3.2, sgap:1, spat:1.5, burn:4, seat:1 } satisfies Difficulty });
export const TUT_N = 3;
export let tutArmed = false, tutPrevDiff: string | null = null, tutEl: HTMLElement | null = null;
SHOP.tutDone = SHOP.tutDone || {};
export let tutPrevSlot: Slot | null = null;
/** The extra seat the armed lesson is for, '' for the shop's four (set by the training list). */
export let tutX: ExtraKind | '' = '';
/** The 樓面 task the armed lesson is for (執枱, 送外賣), '' otherwise (set by the training list; one shot). */
export let tutF: FloorLesson | '' = '';
export function armTut(): void {
  tutArmed = true; if (diff!=='tut') tutPrevDiff = diff; setDiff('tut');
  if (!fixedShop){ tutPrevSlot = slot; setSlot('lunch'); useFixedShop(true); }
}
// 三枱固定嘅客：由淺入深（一個人 → 兩個人 → 有走冰少甜）
export const TUT_GROUPS: { label: string; persons: Person[] }[] = [
  { label:'阿伯', persons:[L('餐蛋麵', '奶茶', false)] },
  { label:'兩個同事', persons:[L('火腿通粉', '檸茶', true), L('西多士', '奶茶', false)] },
  { label:'OL', persons:[L('菠蘿油', '檸茶', true, 1, true)] },
];
export function tutGroup(i: number): SeatGroup {
  const d0 = TUT_GROUPS[i], g = makeGroup(), d = must(d0, 'tutorial group ' + String(i));
  Object.assign(g, { size: d.persons.length, label: d.label, noShare:false, persons: d.persons.map(clonePerson) });
  g.lines = g.persons.map((p, k) => (k ? '我要' : '唔該，') + sayPerson(p) + '。');
  g.items = itemsOf(g.persons);
  return g;
}
// 僱員培訓：揀學邊個位（四個位都有培訓，學識咗打剔）
export function openTraining(): void {
  const row = (k: string, name: string): string => `<button type="button" data-train="${k}" class="${must(SHOP.tutDone, 'SHOP.tutDone')[k] ? 'done' : ''}">${iconImg('ui', k)}<b>${name}</b><span>${must(SHOP.tutDone, 'SHOP.tutDone')[k] ? '✓ 學識咗' : '未學 · 獎 $300'}</span></button>`;
  // a new seat's lesson appears once the main ladder reaches the level that brings the role
  const xs = EXTRA_KINDS.filter(roleOpenNow);
  // a 樓面 task's own lesson (執枱, 送外賣) appears once the ladder reaches the level where it joins the floor
  const fs = FLOOR_LESSONS.filter(floorLessonNow);
  must($('book'), 'book').innerHTML = `<div class="sh-head"><b>僱員培訓</b><span>四個位都要學，每個位學識獎 $300</span></div>
    <div class="trainlist">${Object.entries(STATIONS).map(([k, d]) => row(k, d.name)).join('')}</div>
    ${xs.length ? `<p class="diffh">新位：學識咗先揀得嚟做有呢個位嘅關卡同自己間舖（${xs.map(k => `${SEAT_NAMES[k]}＝${X_SHORT[k]}`).join('、')}）</p>
    <div class="trainlist" id="trainX">${xs.map(k => row(k, SEAT_NAMES[k])).join('')}</div>` : ''}
    ${fs.length ? `<p class="diffh">樓面工作：每樣分開學（伙記＝帶位落單；${fs.map(k => `${FLOOR_NAMES[k]}＝${F_SHORT[k]}`).join('、')}）</p>
    <div class="trainlist" id="trainF">${fs.map(k => row(k, FLOOR_NAMES[k])).join('')}</div>` : ''}
    <p class="hint">跟住黃色提示同紅色箭嘴做，啲客好有耐性。老闆講嘢撳一下先會收。</p>
    <button type="button" class="big alt" id="bookClose">返回</button>`;
  must($('bookView'), 'bookView').hidden = false;
}
must($('book'), 'book').addEventListener('click', e => {
  const b = closestIn(e.target, 'button[data-train]'); if (!b) return;
  const t = b.dataset.train;
  tutF = '';
  if (isExtraKind(t)) tutX = t;   // a new seat's lesson: the shop's station underneath stays as it is
  else if (isFloorLesson(t)){ tutX = ''; tutF = t; setStation('waiter'); saveSet('ckf-station', station); buildMenus(); }   // a 樓面 task: played from 伙記's floor
  else { tutX = ''; setStation(stationOf(t)); saveSet('ckf-station', station); buildMenus(); }
  must($('bookView'), 'bookView').hidden = true; armTut(); start();
});
must($('tutBtn'), 'tutBtn').onclick = openTraining;
// 第一次開：主畫面頂有張黃色卡，叫你先做僱員培訓（可以跳過）
must($('newbieGo'), 'newbieGo').onclick = openTraining;
must($('newbieSkip'), 'newbieSkip').onclick = () => { SHOP.skipTut = true; saveShop(); must($('newbie'), 'newbie').hidden = true; if (typeof trackOnce==='function') trackOnce('tut_skip'); };
// careerStart 嗰陣叫：係教學就唔要目標、熟客、名人
export function tutBegin(): boolean {
  if (!tutArmed) return false;
  const S = liveG();
  tutArmed = false; S.tut = true; S.regPlan = []; S.goal = 'calm'; S.goalN = 0; S.tutNext = 0; S.tutAt = 1.5; S.nextSpawn = Infinity;
  if (tutF && !tutX){ S.tutF = tutF; S.tutAt = 1; }   // one shot: the next lesson armed elsewhere (首次開工) is the waiter's
  tutF = '';
  document.body.classList.add('tut');
  bossSay(`教學關：${tutX ? SEAT_NAMES[tutX] : S.tutF ? FLOOR_NAMES[S.tutF] : stDef(S.station).name}。跟住上面黃色嘅提示做，唔使驚，${S.tutF ? '慢慢嚟' : '啲客好有耐性'}。`);
  return true;
}
export function tutStop(): void {
  document.body.classList.remove('tut'); if (tutEl) tutEl.hidden = true; if (tutArrowEl) tutArrowEl.hidden = true;
  if (tutPrevDiff){ setDiff(tutPrevDiff); tutPrevDiff = null; }
  if (fixedShop){ useFixedShop(false); if (tutPrevSlot){ setSlot(tutPrevSlot); tutPrevSlot = null; } }
}
// 收工（教學完）
export function tutEnd(): void {
  const S = liveG();
  const k = S.xseat ?? S.tutF ?? S.station, name = S.tutF ? FLOOR_NAMES[S.tutF] : seatName(k);
  const first = !must(SHOP.tutDone, 'SHOP.tutDone')[k], prize = first ? 300 : 0;
  must(SHOP.tutDone, 'SHOP.tutDone')[k] = true; SHOP.bank += prize; saveShop();
  if (typeof trackOnce==='function'){ trackOnce('tut_done'); track('tut_' + k); }
  must($('endSign'), 'endSign').textContent = '學識喇';
  must($('boss'), 'boss').innerHTML = `<small>老闆講</small>${name}你識做喇。${prize ? `呢度 ${prize} 利是，` : ''}${S.xseat ? `而家關卡同自己間舖都揀得${name}做。` : S.tutF ? `做樓面嗰陣見到${name}嘅泡泡就撳得。` : '正式開工啦！'}`;
  must($('result'), 'result').insertAdjacentHTML('afterbegin', `<div class="wide stars"><span>僱員培訓 · ${name}</span><b>✓</b><span>${prize ? `第一次完成，獎 $${prize}` : '已經學過'}</span></div>`);
  tutStop();
}
export function tutLine(): string {
  const S = liveG(), gs = S.groups, st = S.station;
  if (st==='waiter'){
    if (S.sheet) return '聽客人講乜：先撳嘢食或飲品，再撳走青、凍、少甜呢啲要求。寫完撳「落單」。';
    const dirty = S.tables.find(t => t.dirty && !gs.some(g => g.table===t.id));
    if (S.selected) return '② 揀咗客：撳綠色閃住嘅枱帶佢坐。';
    if (gs.some(g => g.state==='order' && (g.take || !g.taken))) return '④ 枱上面閃紅色「落」：撳張枱幫佢落單。';
    if (gs.some(g => g.state==='order' && !g.take && g.taken)) return '⑥ 張單未落（頭頂「寫」）：撳返張枱開返張單，寫完撳「落單」。';   // 開咗單又閂返：唔好顯示「等緊客人」
    if (gs.some(g => g.state==='queue')) return '① 撳下面門口排緊隊嘅客，揀佢。';
    if (dirty) return '⑤ 客走咗留低碗碟：撳嗰張枱執枱，執咗先坐得人。';
    if (gs.some(g => g.state==='think')) return '③ 客人睇緊餐牌（頭頂「睇」），等一陣佢就會叫你。';
    if (gs.some(g => g.state==='wait' || g.state==='eat')) return '廚房同水吧整緊、客人食緊。食完會自己去埋單。';
    return '等緊客人入嚟……';
  }
  if (st==='bar'){
    const p = S.pot, b = S.bench;
    if (p.st==='empty') return '① 開舖前：撳左邊個茶膽煲茶。';
    if (p.st==='boil' || p.st==='steep') return `② ${p.st==='boil' ? '煲緊' : '焗緊'}茶，等一陣。`;
    if (p.st==='pull') return `③ 撳茶膽撞茶（${p.pulls}/${pullsNeed()}）。`;
    const tk = gs.some(g => g.state==='wait' && g.drinks && g.drinks.some(d => !d.done));
    if (!tk) return '有茶喇！等伙記落單，飛會掛喺上面。';
    if (!b.target) return '④ 撳上面張飛其中一杯，揀做嗰杯。';
    if (!b.cup) return '⑤ 睇清楚張飛：熱飲揀「熱杯」，凍飲揀「凍杯」。';
    return '⑥ 跟住落料：熱飲唔落糖；凍飲落冰同糖水（走冰、少甜、走甜跟住改）。唔記得撳「沖法」。落齊撳「出」。';
  }
  if (st==='kitchen'){
    const pl = activePlate(), any = gs.some(g => g.state==='wait' && g.meals && g.meals.some(m => !m.done));
    const ready = Object.entries(S.kit).some(([k, arr]) => arr.some(j => j && slotState(k, j).cls.startsWith('ready')));
    if (!any) return '等伙記落單，飛會貼喺爐頭上面。';
    if (!selOk()) return '① 撳上面張飛其中一碟，揀做嗰碟（揀咗會變黃色）。';
    if (ready) return '③ 爐具寫「得」：撳佢攞嘢上碟。太遲會燶！';
    if (!must(pl, 'active plate').tokens.length && !Object.values(S.kit).some(a => a.some(Boolean))) return '② 睇隻碟淡淡哋嘅料：撳空嘅爐頭揀煮乜（粉麵、蛋、多士）；粉紅色嘅配料撳就上碟。唔識撳「做法」。';
    return '④ 貓紙全部打剔就撳「出餐」。未齊就繼續煮、繼續放。';
  }
  if (st==='till'){
    if (!S.cur) return '等客人食完嚟埋單……';
    if (S.step==='total') return '① 睇張單計總數：打數字再撳「收」。可以用「＋」一樣一樣加，右上有價錢牌。';
    return '② 客人俾咗錢：撳錢箱啲錢找返佢，再撳「找錢」。';
  }
  return '';
}
/* ---- 培訓箭嘴：每一步指住要撳嘅位（DOM 掣或者畫布上面嘅嘢） ---- */
// offsetParent exists on HTML elements only; on any other element the JS read undefined (which is !== null).
export const vis = (el: Element | null | undefined): number | boolean | null | undefined => el && (el instanceof HTMLElement ? el.offsetParent : undefined) !== null && el.getClientRects().length;
export const elPt = (el: Element | null | undefined): { x: number; y: number } | null => { if (!vis(el)) return null; const r = must(el, 'element').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 4 }; };
export const hitPt = (cv: HTMLElement, h: SceneHit | undefined): { x: number; y: number } | null => { if (!h || !vis(cv)) return null; const r = cv.getBoundingClientRect(); return { x: r.left + h.x + h.w / 2, y: r.top + h.y + h.h * .4 }; };
export const tq = (s: string): Element | null => document.querySelector(s);
export function tableTarget(tid: number | null): { x: number; y: number } | null {
  if (vis(FSC.tv)) return hitPt(FSC.tv, FSC.hits.find(h => h.tid===tid));
  // NodeList[null] is undefined in the JS too.
  return elPt(tid === null ? undefined : document.querySelectorAll('#floor .tbl')[tid]);
}
// 張單應該寫成點：每個客先嘢食後飲品
export function wantLines(g: SeatGroup): WantLine[] {
  const out: WantLine[] = [];
  // The JS tested `if (p.drink)` before the second push: every Person has a drink, so the checker drops the dead branch.
  g.persons.forEach(p => { if (p.food) out.push({ t:'f', id: foodId(p.food) }); out.push({ t:'k', d:p.drink.d, cold:p.drink.cold, sweet:p.drink.sweet|0, noice:p.drink.noice }); });
  return out;
}
/** The waiter's slip lines (waiter.js, still JS, keeps G's draft untyped): every line is an object with a kind `t`. */
export const isSlipLine = (x: unknown): x is SlipLineView => typeof x === 'object' && x !== null && 't' in x;
export function tutTarget(): { x: number; y: number } | null {
  const S = liveG(), st = S.station, gs = S.groups;
  if (S.xseat || S.tutF) return null;
  if (st==='waiter'){
    if (S.sheet){
      const g = byId(S.sheet.gid); if (!g) return null;
      if (g.take) throw new TypeError('chakei: a slip is open on a takeaway customer');
      const want = wantLines(g), d: unknown = g.draft;
      if (!Array.isArray(d)) throw new TypeError('chakei: the slip being written is not a list');
      const lines: readonly unknown[] = d;
      for (let i = 0; i < lines.length && i < want.length; i++){
        const w = must(want[i], 'wanted line'), l = lines[i]; if (!isSlipLine(l)) throw new TypeError('chakei: slip line is not an object');
        if (w.t!=='k' || l.t!=='k') continue;
        if (S.sheet.sel!==i && (l.cold!==w.cold || (Number(l.sweet)|0)!==w.sweet || !!l.noice!==w.noice)) return elPt(tq(`#sheet [data-pick="${i}"]`));
        if (l.cold!==w.cold) return elPt(tq(`#sheet [data-temp="${w.cold ? 'cold' : 'hot'}"]`));
        if ((Number(l.sweet)|0)!==w.sweet) return elPt(tq(`#sheet [data-sweet="${String(w.sweet || l.sweet)}"]`));
        if (!!l.noice!==w.noice) return elPt(tq('#sheet [data-noice]'));
      }
      if (lines.length < want.length){ const w = must(want[lines.length], 'wanted line'); return elPt(tq(`#sheet [data-add="${w.t}"][data-id="${w.t==='k' ? w.d : w.id}"]`)); }
      return elPt(tq('#sheet .send'));
    }
    const sel = S.selected && byId(S.selected);
    if (sel && sel.state==='queue'){
      if (sel.take) throw new TypeError('chakei: a takeaway customer is selected');
      const tb = S.tables.find(t => ['', 'dirty'].includes(seatProblem(sel, t))); return tb ? tableTarget(tb.id) : null;
    }
    const og = gs.find(g => g.state==='order' && (g.take || !g.taken)) || gs.find(g => g.state==='order' && !g.take && g.taken); if (og) return tableTarget(og.table);
    if (gs.some(g => g.state==='queue')) return elPt(tq('.grp'));
    const dirty = S.tables.find(t => t.dirty && !gs.some(g => g.table===t.id)); if (dirty) return tableTarget(dirty.id);
    return null;
  }
  const counter = typeof kitMode!=='undefined' && kitMode==='counter';
  if (st==='bar'){
    const p = S.pot, b = S.bench;
    const barHit = (kind: string, k?: string): { x: number; y: number } | null => counter ? hitPt(BSC.tv, BSC.hits.find(h => h.kind===kind && (k===undefined || h.k===k))) : elPt(tq(`#barPad [data-b="${kind==='pot' ? 'pot' : String(k)}"]`));
    if (p.st==='empty' || p.st==='pull') return counter ? barHit('pot') : elPt(tq('[data-b="pot"]'));
    const g = b.target && byId(b.target.gid); if (!g || g.state!=='wait') return elPt(tq('#rail .tk-l:not(.done)'));
    const r = recipeOf(must(must(g.drinks, 'drinks')[must(b.target, 'bar target').i], 'drink line').k);
    if (!b.cup) return barHit('cup', r.cup);
    // Every ingredient in a recipe is a count (recipeOf sets them all); NaN stands for the JS comparing with a missing one.
    const miss = ING.find(i => { const need = r[i]; return ((b.ing[i] ?? 0)|0) < (typeof need === 'number' ? need : NaN); });
    if (miss) return barHit('ing', miss);
    return elPt(tq('#barPad [data-b="serve"]'));
  }
  if (st==='kitchen'){
    const P = activePlate(), g = selOk();
    if (!g) return elPt(tq('#krail .tk-l:not(.done)'));
    const need = [...kitRecipe(must(must(g.meals, 'meals')[must(S.ksel, 'kitchen selection').i], 'meal line').k)]; must(P, 'active plate').tokens.forEach(t => { const i = need.indexOf(t); if (i >= 0) need.splice(i, 1); });
    if (!need.length) return elPt(tq('#kitPad [data-k="serve"]'));
    const lay = kitLayout();
    for (const t of need){
      for (const [s, arr] of Object.entries(S.kit)) for (let i = 0; i < arr.length; i++){ const j = arr[i];
        if (j && t.startsWith(j.item)){ if (slotState(s, j).cls.startsWith('ready')) return counter ? hitPt(ktv, kHits.find(h => h.st===s && h.i===i)) : elPt(tq(`#kitPad [data-k="t:${s}:${i}"]`)); return null; } }
      const sKey = Object.entries(lay.st).map(([s, items]) => items.find(it => t.startsWith(it)) ? `s:${s}:${String(items.find(it => t.startsWith(it)))}` : null).find(Boolean);
      const key = sKey || `i:${t}`;
      // 新版廚房：要煮嘅先撳個空爐頭（彈選單），選單開咗就指住要揀嗰樣
      if (counter && KPOP && sKey){
        if (vis($('kpop'))){ const pb = tq(`#kpop [data-pop^="${sKey}"]`); if (pb) return elPt(pb); }
        const s0 = sKey.split(':')[1], ei = must(s0 !== undefined && ownKey(S.kit, s0) ? S.kit[s0] : undefined, 'kitchen station ' + String(s0)).findIndex(x => !x);
        if (ei >= 0) return hitPt(ktv, kHits.find(h => h.st===s0 && h.i===ei));
        continue;
      }
      const pt = counter ? hitPt(ktv, kHits.find(h => h.tray===key)) : elPt(tq(`#kitPad [data-k="${key}"]`));
      if (pt) return pt;
    }
    return null;
  }
  if (st==='till' && S.cur){
    if (S.step==='total'){
      const want = String(S.cur.expect), e = S.entry;
      if (e===want) return elPt(tq('#till [data-k="ok"], [data-k="ok"]'));
      if (!want.startsWith(e)) return elPt(tq('[data-k="clr"]'));
      return elPt(tq(`[data-k="${String(want[e.length])}"]`));
    }
    const left = S.paid - S.charged - S.give.reduce((a, b) => a + b, 0);
    if (left <= 0) return elPt(tq('[data-k="ok"]'));
    return elPt(tq(`[data-k="${String(NOTES.find(n => n <= left))}"]`));
  }
  return null;
}
export let tutArrowEl: HTMLElement | null = null;
export function tutArrow(): void {
  if (!tutArrowEl){ tutArrowEl = document.createElement('div'); tutArrowEl.id = 'tutArrow'; document.body.appendChild(tutArrowEl); }
  let pt: { x: number; y: number } | null; try { pt = G && G.tut && G.running && !G.paused ? tutTarget() : null; } catch { pt = null; }
  tutArrowEl.hidden = !pt;
  if (pt){ tutArrowEl.style.left = String(Math.round(pt.x)) + 'px'; tutArrowEl.style.top = String(Math.round(Math.max(56, pt.y))) + 'px'; }
}
export function tutTick(): void {
  tutArrow();
  if (!G || !G.tut || !G.running) return;
  const S = G;
  // 提示條擺喺 HUD 下面（唔再浮喺上面遮住張飛）
  if (!tutEl){ tutEl = document.createElement('div'); tutEl.id = 'tutHint'; tutEl.setAttribute('aria-live', 'polite'); must(document.querySelector('#app .hud'), '#app .hud').after(tutEl); }
  if (S.xseat){ xTutTick(S, tutEl); return; }
  if (S.tutF){ fTutTick(S, tutEl); return; }   // a 樓面 task's own lesson
  const done = S.station==='till' ? S.paidCount : S.served;
  const txt = `${tutLine()}<small>教學 · ${Math.min(done, TUT_N)}/${TUT_N} 枱客</small>`;
  if (tutEl.innerHTML !== txt) tutEl.innerHTML = txt;
  tutEl.hidden = false;
  if (done >= TUT_N){ endGame(); return; }
  // 同一時間最多兩枱客；少過就快啲嚟多枱（入咗門未埋單都計）
  const active = S.groups.length + S.payQ.length + (S.cur ? 1 : 0);
  if ((S.tutNext ?? NaN) < TUT_GROUPS.length && active < 2 && S.t >= (S.tutAt ?? NaN) && S.phase==='open'){
    const n = S.tutNext ?? NaN; S.tutNext = n + 1;
    HOOK.enqueue(tutGroup(n)); S.tutAt = S.t + 4;
  }
  // 三枱固定嘅客都嚟完，仲未夠數（例如有客走咗），就照平時咁嚟
  if ((S.tutNext ?? NaN) >= TUT_GROUPS.length && S.nextSpawn===Infinity) S.nextSpawn = S.t + 6;
}
