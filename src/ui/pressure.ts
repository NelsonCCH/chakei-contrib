// 硬核模式：自己揀開，預設關。開咗之後自己間舖每更交定額開支（租、人工、雜費；淨係計做咗嘅更，
// 唔會因為冇開遊戲而扣錢）；連續蝕本有警告、業主信；連續蝕三更而又欠租，業主收舖：搬去細啲嘅舖重新嚟過，星、食譜、裝修款式
// 全部保留，師傅俾 $500 重新開舖；之後賺錢做滿 5 更，業主肯租返舊舖（東山再起）。組隊冇呢樣嘢。
// The numbers are core/career/pressure.ts; this module owns the save fields (hard, press, lost), the shop floor change and
// the screens. Normal mode: a lost target's stake can take the bank below zero; 師傅 covers it (the bank stops at $0).
import './solo';   // load order: src/entry.ts
import { PRESS, settleShift, cleanPress, PRESS0, type PressState } from '../core/career/pressure';
import { SHOP, saveShop, TDEF, applyShopWhenIdle, SIZES, PLACES } from './decor';
import { shiftCostsNow, hardShift, ownsPlace } from './market';
import { toast } from './ui';
import { sfx } from './juice';
import { renderTargetBox } from './target';

export const press = (): PressState => cleanPress(SHOP.press ?? PRESS0);
let bank0 = 0, hardNow = false;
/** At the end of a shift, before any money is booked (ui/main.ts showEnd): remember the savings and the mode. */
export function pressMark(): void { bank0 = SHOP.bank; hardNow = hardShift(); }

/** After the shift's money is booked (ui/decor.ts bankRevenue): rent owing, the warning streak, the shop lost or won back. */
export function pressSettle(): string {
  if (!hardNow){
    // a missed target's stake bigger than the savings: 師傅 covers it, the bank never shows a minus
    if (SHOP.bank < 0){ const cover = -SHOP.bank; SHOP.bank = 0; saveShop(); return `<div class="wide pressw"><span>師傅幫你墊咗</span><b>$${String(cover)}</b><span>積蓄唔夠蝕，今次當學費</span></div>`; }
    return '';
  }
  hardNow = false;
  const net = SHOP.bank - bank0, p0 = press(), r = settleShift(SHOP.bank, net, p0, !!SHOP.lost);
  SHOP.bank = r.bank; SHOP.press = r.press;
  const out: string[] = [];
  if (r.owed) out.push(`<div class="wide pressw warn"><span>積蓄唔夠交數</span><b>欠租 $${String(r.press.debt)}</b><span>之後賺到錢會先還欠租</span></div>`);
  if (r.repaid) out.push(`<div class="wide pressw"><span>還欠租</span><b>−$${String(r.repaid)}</b><span>${r.press.debt ? `仲欠 $${String(r.press.debt)}` : '還清喇'}</span></div>`);
  if (r.fail){ foreclose(); out.push(`<div class="wide pressw fail"><span>業主收舖！</span><b>重新嚟過</b><span>連續蝕咗 ${String(PRESS.failAt)} 更又交唔起租。搬去細啲嘅舖：星、食譜、裝修款式全部保留，師傅俾 $${String(PRESS.restart)} 你重新開舖。賺錢做滿 ${String(PRESS.comeback)} 更，業主肯租返舊舖俾你。</span></div>`);
    setTimeout(() => { toast('業主收舖！搬去細啲嘅舖重新嚟過'); sfx.broke(); }, 600); }
  else if (r.stage === 2) out.push(`<div class="wide pressw warn"><span>業主警告信</span><b>連續蝕咗 ${String(r.press.red)} 更</b><span>${r.press.debt ? '下更再蝕本，業主就收舖' : `再蝕本而又交唔起租，業主就收舖（積蓄 $${String(SHOP.bank)}）`}</span></div>`);
  else if (r.stage === 1) out.push(`<div class="wide pressw warn"><span>蝕本更</span><b>−$${String(-net)}</b><span>連續蝕 ${String(PRESS.letterAt)} 更業主會寄警告信</span></div>`);
  if (!r.fail && SHOP.lost && r.press.back >= PRESS.comeback){ winBack(); out.push(`<div class="wide pressw back"><span>東山再起！</span><b>舊舖返嚟喇</b><span>業主見你做得好，租返舊舖俾你：枱、擺設、地段都返晒嚟</span></div>`);
    setTimeout(() => { toast('東山再起！業主租返舊舖俾你'); sfx.fanfare(); }, 600); }
  else if (!r.fail && SHOP.lost) out.push(`<div class="wide pressw"><span>東山再起</span><b>${String(r.press.back)}/${String(PRESS.comeback)} 更</b><span>賺錢做滿 ${String(PRESS.comeback)} 更，業主肯租返舊舖</span></div>`);
  saveShop();
  return out.join('');
}

/** The landlord takes the shop back: one size smaller (or the starting floor), the starting six tables, the cheapest
 *  district unless the player owns this one. Stars, recipes, owned looks, regulars and levels stay. Applied between shifts. */
export function foreclose(): void {
  if (!SHOP.lost) SHOP.lost = { size: SHOP.size, tables: SHOP.tables.map(t => ({ ...t })), items: SHOP.items.map(q => ({ ...q })), place: SHOP.place };
  SHOP.size = Math.max(0, SHOP.size - 1);
  SHOP.tables = TDEF.map(([kind, tx, ty]) => ({ kind, tx, ty }));
  SHOP.items = [];
  if (!ownsPlace(SHOP.place)) SHOP.place = 'pl-town';
  applyShopWhenIdle();
}
/** 東山再起: the old shop comes back (its size, tables, items and district); anything bought since is kept. */
export function winBack(): void {
  const L = SHOP.lost; if (!L) return;
  const extraItems = SHOP.items;
  SHOP.size = Math.max(SHOP.size, L.size);
  if (SHOP.tables.length <= L.tables.length) SHOP.tables = L.tables;
  SHOP.items = [...L.items, ...extraItems];
  if (L.place && PLACES[L.place] && SHOP.own.includes(L.place)) SHOP.place = L.place;
  SHOP.lost = null; SHOP.press = { ...press(), back: 0 };
  applyShopWhenIdle();
}

/* ===================== 開工前：硬核模式掣同狀態 ===================== */
export function pressBoxHtml(): string {
  if (!SHOP.hard) return `<button type="button" id="hardBtn" aria-pressed="false"><b>硬核模式：關</b><span>開咗就每更交定額租、人工、雜費；連續蝕本有業主信，欠租再蝕會收舖（星、食譜、款式保留，可以東山再起）</span></button>`;
  const p = press(), lines: string[] = [];
  if (p.red) lines.push(`連續蝕本 ${String(p.red)} 更`);
  if (p.debt) lines.push(`欠租 $${String(p.debt)}`);
  if (SHOP.lost) lines.push(`東山再起 ${String(p.back)}/${String(PRESS.comeback)}：賺錢做滿 ${String(PRESS.comeback)} 更，業主租返${SIZES[SHOP.lost.size]?.name ?? ''}俾你`);
  return `<button type="button" id="hardBtn" aria-pressed="true"><b>硬核模式：開</b><span>${costLine()}${lines.length ? '<br>' + lines.join(' · ') : ''}</span></button>`;
}
/** This shop's fixed costs for one shift in the mode chosen on the pre-shift screen (as the end card will charge them). */
export function costLine(): string {
  const solo = SHOP.solo === 'rotate' || SHOP.solo === 'all', c = shiftCostsNow(solo);
  return `每更開支 $${String(c.total)}：租 $${String(c.rent)} · 人工 $${String(c.wages)}${solo ? '（半薪）' : ''} · 雜費 $${String(c.upkeep)}`;
}
document.addEventListener('click', e => {
  if (!(e.target instanceof Element) || !e.target.closest('#hardBtn')) return;
  SHOP.hard = !SHOP.hard;
  // switching it off forgives the streak and rent owing (the shop size stays as it is; a lost shop can still be won back by switching it on again)
  if (!SHOP.hard) SHOP.press = { ...press(), red: 0, debt: 0 };
  saveShop(); toast(SHOP.hard ? '硬核模式開咗：每更要交租、人工、雜費' : '硬核模式關咗'); renderTargetBox();
});
