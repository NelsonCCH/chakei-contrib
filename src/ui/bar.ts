// 水吧位：配方、茶壺、操作、飛架
// TypeScript port of the original game's bar.js, as an ES module: every
// top-level name is exported, none renamed.
import './till';   // load order: src/entry.ts
import { HOOK } from './hooks';
import { DRINKS, ING, RECIPE } from '../core/data/menus';
import { must } from '../core/util';
import { liveG, me, byId, G } from '../core/state';
import { $ } from './prefs';
import { tName } from '../core/referee/customers';
import { label } from '../core/rules/price';
import { morph } from './ui';
import { cheatHtml, kModeBtn, kitMode, setKitMode } from './kitchen';
import { drawBar } from './bar-art';
import { iconImg } from './icons';
import { potCap } from './sets';
import { OPEN } from '../core/rules/order';
import { sigMark } from './market';
import { dsEl, closestIn } from './levels';
import { pullsNeed, recipeOf, ingShown } from '../core/rules/recipes';

export function potHtml(): string {
  const S = liveG();
  const p = S.pot, left = Math.max(0, Math.ceil(p.until - S.rt));
  const label = p.st==='boil' ? `煲緊 ${left}` : p.st==='steep' ? `焗緊 ${left}` : p.st==='pull' ? `撞茶 ${p.pulls}/${pullsNeed()}` : '煲茶';
  return `<div class="potinfo"><b>茶壺</b><span class="mini potbar"><i style="transform:scaleX(${p.st==='ready' ? p.level / potCap() : 0})"></i></span><span>${p.st==='ready' ? `${p.level} 杯` : p.st==='empty' ? '冇茶' : '煲緊'}</span></div>
    <button type="button" class="potbtn ${p.st==='pull' ? 'hot' : ''}" data-b="pot" ${p.st==='boil' || p.st==='steep' ? 'disabled' : ''}>${label}</button>`;
}
// 飛架：每張飛保留住，只改有變嘅，唔會因為新飛而跳返去頭
export function syncRail(box: HTMLElement, list: RailItem[], emptyTxt: string): void {
  const keep = new Set(list.map(x => String(x.key)));
  [...box.children].forEach(el => { const d = dsEl(el); if (!d.dataset.key || !keep.has(d.dataset.key)) el.remove(); });
  let prev: HTMLElement | null = null;
  list.forEach(({ key, color, h, cls }) => {
    const found = box.querySelector(`:scope > [data-key="${key}"]`);
    let el: HTMLElement;
    if (found instanceof HTMLElement) el = found;
    else { el = document.createElement('div'); el.dataset.key = String(key); el.style.setProperty('--gc', color); }
    el.className = 'ticket' + (cls ? ' ' + cls : '');
    if (el._h !== h){ morph(el, h); el._h = h; }
    const want = prev ? prev.nextSibling : box.firstChild;
    if (want !== el) box.insertBefore(el, want);
    prev = el;
  });
  if (!list.length){ const n = document.createElement('p'); n.className = 'noq'; n.textContent = emptyTxt; box.appendChild(n); }
}
export function renderBar(): void {
  const S = liveG();
  // a ticket leaves the rail once all its drinks are made, even if the table still waits for its food
  const tks = S.groups.filter(g => g.state==='wait' && must(g.drinks, 'drinks').some(d => !d.done)).sort((a, z) => (a.drinkUntil ?? NaN) - (z.drinkUntil ?? NaN));
  // 下一杯沖乜由自己揀（唔再自動揀最急嗰杯）；揀咗嗰杯已經做完或者客走咗就放低
  { const t0 = S.bench.target, tg0 = t0 && byId(t0.gid);
    if (me('bar') && t0 && (!tg0 || tg0.state!=='wait' || must(must(tg0.drinks, 'drinks')[t0.i], 'drink line').done)) S.bench.target = null; }
  const tg = S.bench.target;
  syncRail(must($('rail'), 'rail'), tks.map(g => ({ key: g.id, color: g.color, h: `
      <div class="tk-h"><b>${tName(g)}</b><span class="mini"><i data-dbar="${g.id}"></i></span></div>
      ${must(g.drinks, 'drinks').map((d, i) => `<button type="button" class="tk-l ${d.done ? 'done' : ''} ${tg && tg.gid===g.id && tg.i===i ? 'on' : ''}" data-tk="${g.id}:${i}" ${d.done ? 'disabled' : ''}>${d.done ? '✓ ' : d.redo ? '<em>換</em> ' : ''}${label(d.k)}${typeof sigMark==='function' ? sigMark(d.k) : ''}</button>`).join('')}
    ` })), S.phase==='prep' ? '開舖前，先煲一煲茶膽' : '暫時冇飛');
  const g = tg && byId(tg.gid), b = S.bench;
  const cupN = { hot:'熱杯', cold:'凍杯' };
  morph(must($('bench'), 'bench'), `<div class="target">${tg && g && g.state==='wait' ? `做緊 <b>${label(must(must(g.drinks, 'drinks')[tg.i], 'drink line').k)}</b> · ${tName(g)}` : '撳張飛揀做邊杯'}</div>
    ${tg && g && g.state==='wait' ? (() => { const r = recipeOf(must(must(g.drinks, 'drinks')[tg.i], 'drink line').k);
        const need = [cupN[r.cup], ...ING.flatMap(i => Array<string>(Number(r[i])).fill(i))], have = [...(b.cup ? [cupN[b.cup]] : []), ...ING.flatMap(i => Array<string>((b.ing[i] ?? 0)|0).fill(i))];
        return cheatHtml(need, have); })() : ''}`);
  const modeBtn = kModeBtn('mode');
  // 枱面版：杯同材料喺畫面上直接撳，下面淨係倒、出、沖法
  if (kitMode==='counter'){ morph(must($('barPad'), 'barPad'), `<div class="keys four"><button type="button" class="ing" data-b="recipe">沖法</button>${modeBtn}
      <button type="button" data-b="dump" class="bk">倒咗佢</button><button type="button" data-b="serve" class="go">出</button></div>`); return; }
  morph(must($('barPad'), 'barPad'), `<div class="keys four">
      <button type="button" data-b="hot" aria-pressed="${String(b.cup==='hot')}">熱杯</button><button type="button" data-b="cold" aria-pressed="${String(b.cup==='cold')}">凍杯</button>
      <button type="button" data-b="dump" class="bk">倒咗佢</button><button type="button" data-b="serve" class="go">出</button>
      ${ingShown().map(i => `<button type="button" data-b="${i}" class="ing icon">${iconImg('ing', i)}<span>${i}</span></button>`).join('')}
      <button type="button" class="ing" data-b="recipe">沖法</button>${modeBtn}
    </div>`);
}
export function paintTickets(): void {
  const S = liveG();
  document.querySelectorAll('[data-dbar]').forEach(e => {
    const el = dsEl(e);
    const g = byId(Number(el.dataset.dbar)); if (!g) return;
    const f = Math.max(0, Math.min(1, ((g.drinkUntil ?? NaN) - S.t) / (g.drinkMax ?? NaN)));
    el.style.transform = `scaleX(${f})`; el.classList.toggle('low', f < .3);
  });
  drawBar(performance.now());
}
must($('barView'), 'barView').addEventListener('click', e => {
  const b = closestIn(e.target, 'button'); if (!b) return;
  if (b.dataset.tk){ const [gid, i] = b.dataset.tk.split(':').map(Number); HOOK.pickLine(gid ?? NaN, i ?? NaN); return; }
  if (b.dataset.b) HOOK.barKey(b.dataset.b);
});
must($('barPad'), 'barPad').addEventListener('click', e => {
  const b = closestIn(e.target, 'button'); if (!b) return;
  if ('km' in b.dataset){ setKitMode(kitMode==='counter' ? 'pad' : 'counter'); return; }
  if (b.dataset.b==='recipe'){ openRecipe(); return; }
  HOOK.barKey(b.dataset.b);
});
export function openRecipe(): void {
  if (!G || !G.running) return;
  G.board = true;
  must($('board'), 'board').innerHTML = `<div class="sh-head"><b>沖法</b><span>水吧</span></div>
    <table class="board">${Object.entries(RECIPE).filter(([d]) => OPEN(DRINKS, 'k').some(x => x.id===d)).map(([d, r]) => `<tr><td>${d}</td><td>${Object.keys(r).join(' ＋ ')}</td></tr>`).join('')}</table>
    <p class="hint">熱飲：用熱杯，唔落糖，客人自己落。</p>
    <p class="hint">凍飲：用凍杯，落一下冰（走冰就唔落），糖水兩下（少甜一下，走甜唔落）。</p>
    ${OPEN(DRINKS, 'k').some(d => d.iced) ? '<p class="hint">紅豆冰一定係凍：凍杯 ＋ 紅豆 ＋ 淡奶 ＋ 冰 ＋ 糖水，唔可以走冰。</p>' : ''}
    ${OPEN(DRINKS, 'k').some(d => d.sw) ? '<p class="hint">茶走、啡走：用煉奶代淡奶，本身已經甜，凍都唔落糖水。</p>' : ''}
    <p class="hint">茶壺冇茶就要煲：煲，焗，再撞茶 ${pullsNeed()} 下。煲緊嗰陣冇茶倒。</p>
    <button type="button" class="big" id="boardClose">返回</button>`;
  must($('boardWrap'), 'boardWrap').hidden = false; must($('boardClose'), 'boardClose').focus();
}
