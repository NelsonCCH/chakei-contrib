// 伙記位：帶位、落單
// TypeScript port of the original game's waiter.js, as an ES module: every
// top-level name is exported, none renamed.
import './prefs';   // load order: src/entry.ts
import { HOOK } from './hooks';
import { liveG, byId, tableAt, asSeat, G } from '../core/state';
import { toast, netActing, morph, paintBars } from './ui';
import { must } from '../core/util';
import { isIced, DISHES, isHot, isSw, NOODLES, EGGS, BREADS, DFLAGS, HAT_OK, HAT_P, SETS, FOODS, REG, DRINKS } from '../core/data/menus';
import { $ } from './prefs';
import { itemsOf, label } from '../core/rules/price';
import { OPEN } from '../core/rules/order';
import { LEVELS, closestIn } from './levels';
import { sauceOf, oneSayMs, keyOf } from '../core/stations/waiter';

export const tgl = (attrs: string, on: unknown, text: string, off?: unknown): string => `<button type="button" ${attrs} aria-pressed="${String(!!on)}" ${off ? 'disabled' : ''}>${text}</button>`;
export function optRow(name: string, key: 'noodle' | 'egg' | 'bread', list: string[], l: SetOrder): string {
  return `<div class="opt"><span>${name}</span><div class="mods">${list.map(v => tgl(`data-opt="${key}" data-v="${v}"`, l[key]===v, v)).join('')}</div></div>`;
}
export function modPanel(l: DraftLine | undefined): string {
  if (!l) return '<p class="hint">撳下面啲嘢食同飲品寫落張單。撳單上面一行可以返轉頭改。</p>';
  if (l.t==='k') return `<div class="mods">
      ${tgl('data-temp="hot"', !l.cold, '熱', isIced(l.d))}${tgl('data-temp="cold"', l.cold, '凍', isHot(l.d))}<span class="gap"></span>
      ${tgl('data-sweet="1"', l.sweet===1, '少甜', !l.cold || isSw(l.d))}${tgl('data-sweet="2"', l.sweet===2, '走甜', !l.cold || isSw(l.d))}${tgl('data-noice', l.cold && l.noice, '走冰', !l.cold || isIced(l.d))}</div>`;
  if (l.t==='s') return `${optRow('粉麵','noodle',NOODLES,l)}${optRow('蛋','egg',EGGS,l)}${optRow('包','bread',BREADS,l)}
      <div class="opt"><span>加</span><div class="mods">${tgl('data-flag="hongdai"', l.hongdai, '烘底 +$2', l.bread!=='餐包')}${tgl('data-flag="feibin"', l.feibin, '飛邊', l.bread==='餐包' && !l.hongdai)}</div></div>`;
  if (l.t==='d') return `<div class="mods">${DFLAGS.map(f => tgl(`data-dflag="${f}"`, l[f], f, f==='炒底' && !sauceOf(l.id))).join('')}</div>`;
  if (HAT_OK.includes(l.id)) return `<div class="mods">${tgl('data-hat', l.hat, `加頂帽（煎蛋）+$${HAT_P}`)}</div>`;
  return '<p class="hint">呢樣冇得改。</p>';
}
export function itemPanel(): string {
  const S = liveG();
  if (S.slot==='breakfast') return `<p class="sec-h">餐 · 全部跟通粉、煎蛋、牛油多士</p>
    <div class="btns sets">${OPEN(SETS, 's').map(x => `<button type="button" data-add="s" data-id="${x.id}">${x.id}<small>${x.top}</small></button>`).join('')}</div>`;
  if (S.slot==='dinner') return `<p class="sec-h">碟頭飯</p>
    <div class="btns dishes">${OPEN(DISHES, 'd').map(d => `<button type="button" data-add="d" data-id="${d.id}">${d.id.replace(/飯$/,'')}<small>${d.sauce ? '有汁' : '　'}</small></button>`).join('')}</div>`;
  return `<p class="sec-h">食</p>
    <div class="btns">${OPEN(FOODS, 'f').map(f => `<button type="button" data-add="f" data-id="${f.id}">${f.id}</button>`).join('')}</div>`;
}
export function renderSheet(): void {
  const S = liveG();
  const s = must(S.sheet, 'G.sheet'), g0 = byId(s.gid); if (!g0){ HOOK.closeSheet(); return; }
  const g = asSeat(g0), draft = must(g.draft, 'draft');
  const tb = tableAt(g.table), cur = draft[s.sel];
  const ans = (() => { try { return g.regular && g.repeat ? itemsOf(must(must(REG[g.regular], 'regular').persons[S.slot], 'regular order')).map(k => label(k)).join(' ＋ ') : ''; } catch { return ''; } })();
  const note = g.regular ? (g.repeat ? (g.peeked && ans ? `<span class="note">熟客${g.label}。翻咗熟客簿，照舊：<b>${ans}</b>（翻簿就唔計「記性好」）</span>` : `<span class="note">熟客${g.label}。佢上次叫過乜？${ans ? ' <button type="button" class="peek" data-peek="1">翻熟客簿</button>' : ''}</span>`) : `<span class="note">熟客${g.label}，記住佢叫乜，下次佢唔會再講。</span>`) : '';
  const sheet = must($('sheet'), 'sheet');
  const oldUl = sheet.querySelector('.slip ul'), keepTop = oldUl ? oldUl.scrollTop : 0, oldN = oldUl ? oldUl.children.length : 0;
  morph(sheet, `
    <div class="sh-head"><b>${tb.name}</b><span>${g.label} · ${g.size} 位</span><span class="mini"><i data-bar="${g.id}"></i></span></div>
    <div class="say">${(() => { const L = S.level && LEVELS[S.level], ms = L && L.oneSay ? oneSayMs(g, L) : 0, gone = ms && s.at && performance.now() - s.at > ms;
      return gone ? '<p class="gone">（客人講完就望住你，唔會講第二次）</p>' : g.lines.map(l => `<p>${l}</p>`).join('') + (ms ? `<i class="fadebar" style="--d:${ms / 1000}s;animation-delay:-${((performance.now() - (s.at ?? performance.now())) / 1000).toFixed(2)}s"></i>` : ''); })()}${note}</div>
    <div class="slip"><div class="slip-h"><span>單</span><small>${draft.length > 5 ? `共 ${draft.length} 行 · 上下碌睇晒` : '撳一行嚟改'}</small></div>
      <ul>${draft.length ? draft.map((l,i) => `<li class="${i===s.sel ? 'on' : ''}"><button type="button" data-pick="${i}" aria-pressed="${String(i===s.sel)}">${label(keyOf(l))}</button><button type="button" class="del" data-del="${i}" aria-label="刪除呢行">刪</button></li>`).join('') : '<li class="blank">未寫嘢</li>'}</ul></div>
    <div class="modbox"><p class="sec-h">${cur ? '改亮住嗰行' : '點寫'}</p>${modPanel(cur)}</div>
    ${itemPanel()}
    <p class="sec-h">飲 · 預設係熱，熱飲客人自己落糖</p>
    <div class="btns drinks">${OPEN(DRINKS, 'k').map(d => `<button type="button" data-add="k" data-id="${d.id}">${d.id}</button>`).join('')}</div>
    <div class="acts"><button type="button" class="later">收埋</button><button type="button" class="send">落單</button></div>`);
  // the fade bar's CSS animation starts when its node is made: a fresh node, so its (negative) delay counts from now
  const fb = sheet.querySelector('.fadebar'); if (fb) fb.replaceWith(fb.cloneNode());
  // 張單長過個框：可以上下碌；加咗新一行就碌去最底，揀咗邊行就確保睇到嗰行
  const ul = sheet.querySelector('.slip ul');
  if (ul){ ul.scrollTop = keepTop; const on = ul.querySelector('li.on');
    if (ul.children.length > oldN) ul.scrollTop = ul.scrollHeight;
    else if (on instanceof HTMLElement){ if (on.offsetTop < ul.scrollTop) ul.scrollTop = on.offsetTop; else if (on.offsetTop + on.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = on.offsetTop + on.offsetHeight - ul.clientHeight; } }
  paintBars();
}
// The page's half of core/stations/waiter.ts openSheet ('sheetOpen'): stamp when it opened, the 「凍檸」 hint, the one-say
// countdown, and show the sheet (a teammate's sheet shows on their phone, not here).
export function sheetOpened(gid: number, lemon: boolean): void {
  const S = liveG(), sh = must(S.sheet, 'G.sheet');
  if (lemon) setTimeout(() => { toast('「凍檸」即係凍檸茶'); }, 400);
  sh.at = performance.now();
  const L = S.level && LEVELS[S.level];
  if (L && L.oneSay && !netActing) setTimeout(() => { if (G && G.sheet && G.sheet.gid===gid) renderSheet(); }, oneSayMs(asSeat(must(byId(gid), 'group')), L) + 50);
  if (netActing) return;   // 隊友開嘅單，喺佢部機先顯示
  renderSheet(); must($('sheetWrap'), 'sheetWrap').hidden = false;
  const send = must($('sheet'), 'sheet').querySelector('.send');
  must(send instanceof HTMLElement ? send : null, '.send').focus({ preventScroll:true });
}
// The sheet changed ('sheet'): redraw it, or hide it once closed.
export function sheetChanged(open: boolean): void {
  if (netActing) return;
  if (open) renderSheet(); else must($('sheetWrap'), 'sheetWrap').hidden = true;
}
must($('sheet'), 'sheet').addEventListener('click', e => {
  const b = closestIn(e.target, 'button'); if (!b || !liveG().sheet) return;
  HOOK.sheetAct(Object.assign({}, b.dataset, { act: b.classList.contains('later') ? 'later' : b.classList.contains('send') ? 'send' : '' }));
});
must($('sheetWrap'), 'sheetWrap').addEventListener('click', e => { const t = e.target; if (t instanceof Element && t.id==='sheetWrap') HOOK.closeSheet(); });
