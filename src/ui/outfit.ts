// 伙記仔：改名、換裝（用積蓄買帽、髮型、衫、褲）；喺開工畫面、立體樓面、食煙彩蛋見到
// TypeScript port of the original game's outfit.js, as an ES module: every
// top-level name is exported.
import './smoke';   // load order: src/entry.ts
import { must } from '../core/util';
import { $ } from './prefs';
import { toast } from './ui';
import { INK } from './kitchen';
import { SHOP, saveShop } from './decor';
import { esc } from './cloud';
import { HAT, HAIR, SK, SHIRT, PANTS, fig } from './smoke';

/* ===================== 衣櫃 ===================== */
export const WARDROBE: Wardrobe = {
  hat:   { name:'帽',   items:{ paper:{ name:'紙帽', p:0, col:'#ffffff' }, none:{ name:'冇帽', p:0 }, cap:{ name:'鴨舌帽', p:300, col:'#c8323c' }, band:{ name:'頭巾', p:400, col:'#2a8b67' } } },
  hair:  { name:'髮型', items:{ army:{ name:'陸軍裝', p:0, col:'#2b2b2b' }, mid:{ name:'中分', p:400, col:'#5a3a22' }, pomp:{ name:'飛機頭', p:500, col:'#2b2b2b' }, bald:{ name:'光頭', p:300, col:'#d9a87c' } } },
  top:   { name:'衫',   items:{ shirt:{ name:'白恤衫', p:0, col:'#fbfaf4' }, vest:{ name:'白背心', p:200, col:'#fbfaf4', vest:true }, jersey:{ name:'波衫', p:500, col:'#c8323c', dots:'#fbfaf4' }, hawaii:{ name:'夏威夷恤', p:600, col:'#3aa0c8', dots:'#ffd25a' } } },
  pants: { name:'褲',   items:{ black:{ name:'黑褲', p:0, col:'#2b3036' }, jeans:{ name:'牛仔褲', p:300, col:'#3d5a8a' }, shorts:{ name:'短褲', p:300, col:'#7a6a4a', short:true } } },
};
SHOP.outfit = { hat:'paper', hair:'army', top:'shirt', pants:'black', ...(SHOP.outfit || {}) };
SHOP.wardrobe = SHOP.wardrobe || [];
{ const dflt: Record<string, string> = { hat:'paper', hair:'army', top:'shirt', pants:'black' }; for (const s in dflt) if (!must(WARDROBE[s], 'wardrobe slot ' + s).items[String(SHOP.outfit[s])]) SHOP.outfit[s] = String(dflt[s]); }   // 壞存檔入面唔認得嘅衫
export const owns = (slot: string, k: string): boolean => !must(must(WARDROBE[slot], 'wardrobe slot ' + slot).items[k], 'wardrobe item ' + k).p || must(SHOP.wardrobe, 'SHOP.wardrobe').includes(slot + ':' + k);
export const myNick = (): string => SHOP.nick || '伙記仔';
export let tryOn: Record<string, string> | null = null; // 試身（未買）
export const wearing = (): Record<string, string> => ({ ...SHOP.outfit, ...(tryOn || {}) });

// 將伙記仔個公仔（POSES 入面嘅格仔）換成而家著緊嘅衫
// (o.<slot> is String()ed where it indexes: the JS indexed with it as is, and a missing slot reads items['undefined'].)
export function dress(parts: readonly FigPart[]): FigPart[] {
  const o = wearing(), hat = WARDROBE.hat.items[String(o.hat)], hair = WARDROBE.hair.items[String(o.hair)], top = WARDROBE.top.items[String(o.top)], pants = WARDROBE.pants.items[String(o.pants)];
  const out: FigPart[] = [];
  for (const r of parts){
    const [x, y, w, h, col, det] = r;
    if (col===HAT){
      const hc = must(hat, 'hat ' + String(o.hat)).col;
      if (!hc) continue;
      if (o.hat==='band') out.push([x, y + 1, w, 1, hc, det]);
      else { out.push([x, y, w, h, hc, det]); if (o.hat==='cap') out.push([x + w, y + h - 1, 2, 1, hc, 1]); }
    } else if (col===HAIR){
      out.push([x, y, w, h, must(hair, 'hair ' + String(o.hair)).col, det]);
      if (o.hair==='pomp' && w >= 6) out.push([x + 1, y - 2, w - 1, 2, must(hair, 'hair').col, det]);
      if (o.hair==='mid' && w >= 6) out.push([x + Math.floor(w / 2), y, 1, 1, SK, 1]);
    } else if (col===SHIRT){
      const arm = w <= 3, tp = must(top, 'top ' + String(o.top));
      out.push([x, y, w, h, tp.vest && arm ? SK : tp.col, det]);
      const dots = tp.dots;
      if (dots && !arm && w >= 6) for (let i = 0; i < 4; i++) out.push([x + 1 + (i * 3) % (w - 1), y + 2 + i * 3, 1, 1, dots, 1]);
    } else if (col===PANTS){
      const pt = must(pants, 'pants ' + String(o.pants));
      if (pt.short && h >= 6){ const hh = Math.ceil(h / 2); out.push([x, y, w, hh, pt.col, det]); out.push([x, y + hh, w, h - hh, SK, det]); }
      else out.push([x, y, w, h, pt.col, det]);
    } else out.push(r);
  }
  return out;
}

/* ===================== 開工畫面：我嘅伙記仔 ===================== */
// 企喺度、拎住托盤（俾開工畫面同立體樓面用）
export const WAITER_STAND: FigPart[] = [
  [4,24,3,12,PANTS],[7,24,3,12,PANTS],[3,35,4,1,'#111',1],[7,35,4,1,'#111',1],
  [3,13,8,12,SHIRT],[3,19,8,1,'#c8323c',1],
  [4,5,7,8,SK],[4,4,7,3,HAIR],[4,4,2,6,HAIR],[4,2,6,2,HAT],
  [9,8,1,1,INK,1],[9,11,2,1,'#c07060',1],
  [9,14,3,6,SHIRT],[11,18,4,2,SK],[10,17,6,1,'#b7c1c8',1],
];
export function drawMe(cv: Element | null): void {
  if (!cv) return;
  // The JS called cv.getContext() here, which threw on an element that is not a canvas.
  if (!(cv instanceof HTMLCanvasElement)) throw new TypeError('chakei: drawMe needs a canvas');
  const c = must(cv.getContext('2d'), 'canvas 2d context'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, cv.width, cv.height);
  fig(c, Math.round(cv.width / 2 - 8), cv.height - 2, dress(WAITER_STAND));
}
export function renderMe(): void {
  const el = $('me'); if (!el) return;
  el.innerHTML = `<canvas width="24" height="40" class="mecv" aria-hidden="true"></canvas>
    <span class="who"><small>伙記仔</small><b>${esc(myNick())}</b></span>
    <button type="button" id="nickBtn">改名</button><button type="button" id="wardBtn">換裝</button>`;
  drawMe(el.querySelector('canvas'));
}
must($('me'), 'me').addEventListener('click', e => {
  // The JS called e.target.closest() here, which threw on a target that is not an element.
  const tg = e.target; if (!(tg instanceof Element)) throw new TypeError('chakei: click target is not an element');
  const b = tg.closest('button'); if (!b) return;
  if (b.id==='nickBtn'){
    must(must($('me'), 'me').querySelector('.who'), '#me .who').innerHTML = `<input id="nickIn" maxlength="10" value="${esc(myNick())}" aria-label="伙記仔個名（排行榜都用）">`;
    b.id = 'nickSave'; b.textContent = '存'; must($('nickIn'), 'nickIn').focus();
    // The JS called select() / read .value on #nickIn, which only an <input> has.
    const ni = $('nickIn'); if (!(ni instanceof HTMLInputElement)) throw new TypeError('chakei: #nickIn is not an input'); ni.select();
  } else if (b.id==='nickSave'){
    const ni = $('nickIn'); if (!(ni instanceof HTMLInputElement)) throw new TypeError('chakei: #nickIn is not an input');
    const v = ni.value.trim().slice(0, 10); if (v){ SHOP.nick = v; saveShop(); }
    renderMe();
  } else if (b.id==='wardBtn') openWardrobe();
});

/* ===================== 換裝頁 ===================== */
export function openWardrobe(): void {
  const o = wearing();
  must($('book'), 'book').innerHTML = `<div class="sh-head"><b>換裝</b><span>${esc(myNick())} · 積蓄 $${SHOP.bank}</span></div>
    <canvas width="40" height="44" class="wardcv" aria-label="伙記仔而家嘅樣"></canvas>
    ${Object.entries(WARDROBE).map(([slot, g]) => `<h3>${g.name}</h3><div class="dchips">${Object.entries(g.items).map(([k, it]) => {
      const own = owns(slot, k), on = o[slot]===k, tag = own ? (must(SHOP.outfit, 'SHOP.outfit')[slot]===k ? '著緊' : '有') : on ? `買 $${it.p}` : `$${it.p}`;
      return `<button type="button" class="dchip${on ? ' on' : ''}${!own && on ? ' buy' : ''}" data-ws="${slot}" data-wk="${k}"><i style="background:${it.col || '#cfc6a8'}"></i><b>${it.name}</b><span>${tag}</span></button>`;
    }).join('')}</div>`).join('')}
    <p class="hint">撳一下試身，撳多下買。</p>
    <button type="button" class="big" id="bookClose">返回</button>`;
  drawMe(must($('book'), 'book').querySelector('.wardcv'));
  must($('bookView'), 'bookView').hidden = false;
}
must($('book'), 'book').addEventListener('click', e => {
  // The JS called e.target.closest() here, which threw on a target that is not an element.
  const tg = e.target; if (!(tg instanceof Element)) throw new TypeError('chakei: click target is not an element');
  const b = tg.closest('button[data-ws]'); if (!b) return;
  // The JS read b.dataset; the selector matches only HTML <button>s, which always have one.
  if (!(b instanceof HTMLElement)) throw new TypeError('chakei: wardrobe button is not an HTML element');
  // openWardrobe() writes data-ws and data-wk on every button; the JS threw a little later (in owns) on a missing one.
  const slot = must(b.dataset.ws, 'data-ws'), k = must(b.dataset.wk, 'data-wk'), it = must(WARDROBE[slot], 'wardrobe slot ' + slot).items[k];
  if (owns(slot, k)){ must(SHOP.outfit, 'SHOP.outfit')[slot] = k; if (tryOn) Reflect.deleteProperty(tryOn, slot); saveShop(); }
  else if (tryOn && tryOn[slot]===k){
    if (SHOP.bank < must(it, 'wardrobe item').p){ toast(`唔夠錢，仲差 $${must(it, 'wardrobe item').p - SHOP.bank}`); return; }
    SHOP.bank -= must(it, 'wardrobe item').p; must(SHOP.wardrobe, 'SHOP.wardrobe').push(slot + ':' + k); must(SHOP.outfit, 'SHOP.outfit')[slot] = k; Reflect.deleteProperty(tryOn, slot); saveShop(); toast(`買咗${must(it, 'wardrobe item').name}`);
  } else tryOn = { ...(tryOn || {}), [slot]: k };
  openWardrobe(); renderMe();
});
// 收埋換裝頁：未買嘅試身唔算
must($('bookView'), 'bookView').addEventListener('click', e => { const tg = e.target; if (tg instanceof Element && (tg.id==='bookClose' || tg.id==='bookView')){ tryOn = null; renderMe(); } });
