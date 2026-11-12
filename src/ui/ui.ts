// 畫面：樓面、門口、HUD 更新
// TypeScript port of the original game's ui.js, as an ES module: every
// top-level name is exported, none renamed.
import './waiter';   // load order: src/entry.ts
import { HOOK } from './hooks';
import { must, cash } from '../core/util';
import { $ } from './prefs';
import { TABLES, liveG, byId, atTable, occupied, curLevel, G, local, asSeat } from '../core/state';
import { seatProblem } from '../core/referee/customers';
import { feverClock, feverHeat } from '../core/referee/fever';
import { SLOTS, CFG } from '../core/data/menus';
import { renderTill } from './till';
import { renderBar, paintTickets } from './bar';
import { renderKitchen, paintKitchen } from './kitchen';
import { drawTill } from './till-art';
import { drawTableSprite, drawFloorIso, floorView, isoAnchors } from './floor-iso';
import { mapShop, mapFloatText } from './floor-map';
import { decorMode } from './decor';
import { dsEl } from './levels';

/* ===================== 畫面 ===================== */
// The JS appended the tables to #floor at load (rebuildTblEls below), so a missing #floor threw there too.
export const floor = must($('floor'), 'floor'), queueEl = $('queue');
export let tblEls: HTMLButtonElement[] = [];
export function rebuildTblEls(): void {
  tblEls.forEach(b => { b.remove(); });
  tblEls = TABLES.map((tb, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tbl ' + tb.kind; b.dataset.t = String(i);
    b.addEventListener('click', () => { HOOK.tapTable(i); });
    floor.appendChild(b); return b;
  });
}
rebuildTblEls();
floor.addEventListener('click', e => { if (e.target===floor) HOOK.deselect(); });
export const grpEls = new Map<number, HTMLButtonElement>();
// Never swap a control under a finger: put new markup into a container by patching the nodes already there (same tag at
// the same place keeps its node; only text and attributes change). A button replaced between finger down and finger up
// loses the tap (WebKit / iPhone makes no click once the pressed element has left the page), and the stations re-render
// on every change in the shop - on a co-op teammate's phone four times a second.
export const morphTpl = document.createElement('template');
export function morph(el: Element, html: string): void { morphTpl.innerHTML = html; morphKids(el, morphTpl.content); }
// A node is kept only while its data-* attributes (what a press on it does) stay the same: a press never lands on a
// different action than the one the finger went down on.
export const dataSig = (e: Element): string => [...e.attributes].filter(x => x.name.startsWith('data-')).map(x => x.name + '=' + x.value).join('&');
/** Patches the children of `b` (the new markup) into `a` (the live node). */
export function morphKids(a: Node, b: Node): void {
  const an = [...a.childNodes], bn = [...b.childNodes];
  bn.forEach((n, i) => {
    const o = an[i];
    // Same node type and name, and for elements the same data-* (an element's nodeType is 1 exactly when it is an Element).
    if (o && o.nodeType===n.nodeType && o.nodeName===n.nodeName && (!(n instanceof Element) || (o instanceof Element && dataSig(o)===dataSig(n)))){
      if (n instanceof Element && o instanceof Element){
        for (const { name } of [...o.attributes]) if (!n.hasAttribute(name)) o.removeAttribute(name);
        for (const { name, value } of n.attributes) if (o.getAttribute(name) !== value) o.setAttribute(name, value);
        morphKids(o, n);
      } else if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
    } else if (o) a.replaceChild(n, o); else a.appendChild(n);
  });
  for (let i = an.length - 1; i >= bn.length; i--) must(an[i], 'child node').remove();
}

export function statusHtml(g: Group): string {
  if (g.state==='think') return '<span class="st st-think">睇餐牌</span>';
  // A takeaway customer has no `taken` (reads undefined), as in the JS.
  if (g.state==='order') return !g.take && g.taken ? '<span class="st st-wait">寫緊單</span>' : `<span class="st st-order">落單！</span><span class="mini"><i data-bar="${g.id}"></i></span>`;
  if (g.state==='wait') return `<span class="st st-wait">${must(g.meals, 'meals').some(m => !m.done) ? '等食' : '等嘢飲'}</span>`;
  return '<span class="st st-eat">食緊</span>';
}
export function renderFloor(): void {
  const S = liveG();
  const sel = S.selected && byId(S.selected);
  S.tables.forEach(tb => {
    const gs = atTable(tb.id), occ = occupied(tb.id);
    let seats = '';
    gs.forEach(g => { seats += `<i class="seat on" style="--gc:${g.color}"></i>`.repeat(g.size); });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the JS builds this string and never reads it; kept as written
    seats += '<i class="seat dirty"></i>'.repeat(tb.dirty) + '<i class="seat"></i>'.repeat(Math.max(0, tb.cap - occ - tb.dirty));
    const rows = gs.map(g => `<span class="row"><span class="who" style="--gc:${g.color}">${g.label}</span>${statusHtml(g)}</span>`).join('')
      + (tb.dirty ? '<span class="row"><span class="st st-dirty">要執枱</span></span>' : '');
    const el = tblEls[tb.id]; if (!el) return;   // 關卡完咗、間舖已經換返
    morph(el, `<span class="tname">${tb.name}<small>${tb.cap} 位</small></span><canvas class="tsprite ${tb.cap===4 ? 'w4' : 'w2'}" aria-hidden="true"></canvas><span class="rows">${rows || '<span class="empty">空枱</span>'}</span>`);
    drawTableSprite(must(el.querySelector('canvas'), 'table sprite'), tb, gs);

    const fit = sel ? (seatProblem(asSeat(sel), tb)==='' || seatProblem(asSeat(sel), tb)==='dirty') : null;
    el.classList.toggle('fit', fit===true); el.classList.toggle('nofit', fit===false);
    el.setAttribute('aria-label', `${tb.name}，${tb.cap} 位，` + (gs.map(g => g.label + (g.state==='order' ? '要落單' : '')).join('、') || '空枱') + (tb.dirty ? '，要執枱' : ''));
  });
}
export function renderQueue(): void {
  const S = liveG(), qEl = must(queueEl, 'queue');
  const qs = S.groups.filter(g => g.state==='queue');
  for (const [id, el] of grpEls) if (!qs.some(g => g.id===id)){ el.remove(); grpEls.delete(id); }
  for (const g of qs){
    let el = grpEls.get(g.id);
    if (!el){
      el = document.createElement('button'); el.type = 'button'; el.className = 'grp';
      el.style.setProperty('--gc', g.color);
      el.addEventListener('click', () => { HOOK.tapGroup(g.id); });
      el.innerHTML = `<span class="dots">${'<i></i>'.repeat(g.size)}</span><span class="gl">${g.label}${g.regular ? '<em>熟客</em>' : ''}${g.noShare ? '<em>唔搭枱</em>' : ''}</span><span class="mini"><i data-bar="${g.id}"></i></span>`;
      el.setAttribute('aria-label', `${g.label}，${g.size} 位`);
      grpEls.set(g.id, el); qEl.appendChild(el);
    }
    el.classList.toggle('sel', S.selected===g.id);
  }
  let empty = qEl.querySelector('.noq');
  if (!qs.length && !empty){ const p = document.createElement('p'); p.className = 'noq'; p.textContent = '門口暫時冇人'; qEl.appendChild(p); empty = p; }
  if (qs.length && empty) empty.remove();
  const sel = S.selected && byId(S.selected);
  must($('doorTxt'), 'doorTxt').textContent = qs.length ? `門口 · ${qs.length} 枱客等緊` : '門口';
  must($('selTxt'), 'selTxt').textContent = sel ? `帶 ${sel.label}（${sel.size} 位）去邊張枱？` : '';
}
export function paintBars(): void {
  const S = liveG();
  document.querySelectorAll('[data-bar]').forEach(e => {
    const el = dsEl(e);
    const g = byId(Number(el.dataset.bar)); if (!g) return;
    const f = Math.max(0, Math.min(1, (g.until - S.t) / g.max));
    el.style.transform = `scaleX(${f})`; el.classList.toggle('low', f < .3);
  });
}
export function paintHud(): void {
  const S = liveG();
  const LC = curLevel()?.clock;   // 夜更等關卡自訂鐘數
  const m = (LC ? LC.start : SLOTS[S.slot].start) + Math.floor(Math.min(S.t, CFG.gameSec) / CFG.gameSec * 120);
  must($('clock'), 'clock').textContent = `${Math.floor(m/60) % 24}:${String(m%60).padStart(2,'0')}`;
  must($('clockLbl'), 'clockLbl').textContent = S.station==='decor' ? '裝修' : S.phase==='prep' ? '開舖前' : (LC && LC.label) || SLOTS[S.slot].name;
  must($('rev'), 'rev').textContent = cash(S.revenue); must($('mis'), 'mis').textContent = String(S.mistakes); must($('ang'), 'ang').textContent = String(S.angry);
  paintHeat(S);
}
let heatShown = '';
/** 旺場's heat bar in the HUD: shown while the fever runs, filled to its heat, from the shared clock (every phone alike). */
export function paintHeat(S: GameState): void {
  const el = $('heat'); if (!el) return;
  const on = S.running && feverClock(S.feverAt, S.t) !== null, h = on ? feverHeat(S.feverAt, S.t) : 0;
  if (el.hidden === on) el.hidden = !on;
  const v = h.toFixed(2);
  if (v !== heatShown){ heatShown = v; document.body.style.setProperty('--heat', v); document.body.classList.toggle('feverPeak', on && h >= 1); }
}
export let drawn = 0;
export function setDrawn(v: typeof drawn): void { drawn = v; }
// 省電：地板（等角畫面）唔使每個畫面都重畫。開工中 30 幀、主頁／暫停／收工 8 幀；狀態一變（G.ver）即刻畫。
export let floorNext = 0;
export function floorDue(dirty: boolean): boolean {
  const S = liveG();
  const now = performance.now();
  if (!dirty && now < floorNext) return false;
  const sv = $('startView'), live = S.running && !S.paused && (!sv || sv.hidden);
  floorNext = now + (live ? 33 : 125);
  return true;
}
export function paint(): void {
  const S = liveG();
  const dirty = S.ver !== drawn;
  if (S.ver !== drawn){ drawn = S.ver; if (S.station==='till') renderTill(); else if (S.station==='bar') renderBar(); else if (S.station==='kitchen') renderKitchen(); else { renderFloor(); renderQueue(); } }
  paintBars(); paintHud(); if (S.station==='bar') paintTickets(); if (S.station==='kitchen') paintKitchen(); if (S.station==='till') drawTill(performance.now()); if ((S.station==='waiter' || decorMode) && floorDue(dirty)) drawFloorIso(performance.now());
}

export let toastTimer = 0;
export let netEvent: (ev: NetEvent) => void = () => {};
export function setNetEvent(v: typeof netEvent): void { netEvent = v; }
// netActing = 而家做緊邊個隊友嘅動作（見 net.js）；佢哋嘅提示傳返俾佢哋，唔喺自己度彈
export let netActing: string | null = null;
export function setNetActing(v: typeof netActing): void { netActing = v; }
export function toast(msg: string): void { if (netActing){ netEvent({ role: netActing, msg }); return; } const el = must($('toast'), 'toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, G && G.tut ? 4000 : 1800); }
// 只係俾自己睇嘅提示；隊友嘅就變成事件傳過去（見 net.js）
export function say(role: StationId, msg: string): void { if (local(role)) toast(msg); else if (liveG().roles[role]==='remote') netEvent({ role, msg }); }
/** `tid` may be null: the JS passed a group's table as it was; the floor view then finds no anchor and draws nothing. */
export function floatAt(tid: number | null, text: string, color: string): void {
  const S = liveG();
  if (S.roles.waiter!=='me'){ if (S.roles.waiter==='remote') netEvent({ role:'waiter', float:[tid, text, color] }); return; }
  if (netActing) return;
  let x: number, y: number;
  if (floorView==='iso'){ const a = tid === null ? undefined : isoAnchors[tid]; if (!a) return; x = a.x; y = a.y + 24; }
  else { const wrap = must($('fx'), 'fx').getBoundingClientRect(), r = must(tid === null ? undefined : tblEls[tid], 'table ' + String(tid)).getBoundingClientRect(); x = r.left - wrap.left + r.width / 2; y = r.top - wrap.top + r.height / 2; }
  const onMap = floorView==='iso' && mapShop(), shown = onMap ? mapFloatText(tid, text, color) : text;
  if (shown === null) return;
  const f = document.createElement('div'); f.className = 'float'; f.textContent = shown; f.style.color = color;
  f.style.left = `${x}px`; f.style.top = `${y}px`;
  if (onMap){
    // on the map a float is a chip over the table, above its painted name (at the name it turned both into a smudge)
    f.classList.add('onmap'); f.style.top = `${y - 24}px`;
    // the map keeps one float a table (a new one replaces it) and at most FLOAT_CAP at once, oldest out first
    for (const o of floats.filter(o => o.tid === tid)) dropFloat(o.el);
    while (floats.length >= FLOAT_CAP) dropFloat(must(floats[0], 'oldest float').el);
    floats.push({ tid, el: f });
  }
  must($('fx'), 'fx').appendChild(f); setTimeout(() => { dropFloat(f); }, 1150);
}
/** Floats on the map now, oldest first (capped, so a busy floor stays readable at 390x666). */
const FLOAT_CAP = 3, floats: { tid: number | null; el: HTMLElement }[] = [];
function dropFloat(el: HTMLElement): void { el.remove(); const i = floats.findIndex(o => o.el === el); if (i >= 0) floats.splice(i, 1); }
export function shake(tid: number): void {
  if (floorView==='iso'){ floatAt(tid, '✕', 'var(--red)'); return; }
  // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- reading offsetWidth forces the reflow that restarts the animation
  const el = must(tblEls[tid], 'table ' + String(tid)); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}
