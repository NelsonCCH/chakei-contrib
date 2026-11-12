// 收銀位：操作同畫面
// TypeScript port of the original game's till.js, as an ES module: every
// top-level name is exported, none renamed.
import './ui';   // load order: src/entry.ts
import { HOOK } from './hooks';
import { must } from '../core/util';
import { liveG, G } from '../core/state';
import { $ } from './prefs';
import { priceSlip, label } from '../core/rules/price';
import { SETS, DISHES, FOODS, CFG, GADAI, HAT_OK, HAT_P, SLOTS, DRINKS, NOTES } from '../core/data/menus';
import { morph } from './ui';
import { OPEN } from '../core/rules/order';
import { menuOpen } from './menu';
import { closestIn } from './levels';
import { sumEntry } from '../core/stations/till';

export function renderTill(): void {
  const S = liveG();
  const c = S.cur, keepTop = must($('cust'), 'cust').scrollTop;   // 重畫唔好將捲動打返原形（長單睇唔到底）
  if (!c){
    const l = S.lastCust;
    morph(must($('cust'), 'cust'), l ? `<div class="say"><p>${String(must(l.paySay, 'paySay')[must(l.paySay, 'paySay').length-1])}</p></div><p class="idle">下一位……</p>` : '<p class="idle">等緊客人食完埋單……</p>');
  } else {
    const payLines = must(c.payLines, 'pay lines');
    const live = priceSlip(payLines.filter(l => !l.struck).map(l => l.k)).lines;
    let j = 0;
    const rows = payLines.map((l, i) => {
      const p = l.struck ? null : live[j++];
      // 每個難度都睇到價錢同標籤（唔考記性）
      const tag = p ? `<span class="pr">${p.tag ? p.tag + ' ' : ''}$${p.price}</span>` : '';
      return `<li class="${l.struck ? 'struck' : ''}"><button type="button" data-strike="${i}">${label(l.k)}${tag}</button></li>`;
    }).join('');
    morph(must($('cust'), 'cust'), `
      <div class="sh-head"><b>${String(c.tableName)}</b><span>${c.label} · ${c.size} 位</span><span class="paytag">${c.octo ? '八達通' : '現金'}</span></div>
      <div class="say">${must(c.paySay, 'paySay').slice(-3).map(l => `<p>${l}</p>`).join('')}</div>
      <div class="slip"><div class="slip-h"><span>單</span><small>伙記寫嘅 · 撳一行可以劃走</small></div><ul>${rows}</ul></div>
      ${S.step==='cash' ? `<div class="paid">收 $${S.charged}\u3000客人俾咗 <b>$${S.paid}</b></div>` : ''}`);
  }
  must($('cust'), 'cust').scrollTop = keepTop;
  renderPad();
}
export function renderPad(): void {
  const S = liveG();
  const c = S.cur, off = c ? '' : 'disabled';
  if (!c || S.step==='total'){
    const expr = S.entry.includes('+') ? `<small class="expr">${S.entry.replace(/\+/g, ' ＋ ')} =</small>` : '';
    morph(must($('pad'), 'pad'), `<div class="disp"><span>${c ? '總數' : '等緊客'}</span><span class="dsum">${expr}<b>$${sumEntry(S.entry)}</b></span></div>
      <div class="keys four">${['7','8','9','back','4','5','6','+','1','2','3','clr','0','ok'].map(k =>
        `<button type="button" data-k="${k}" class="${k==='ok' ? 'go wide' : k==='0' ? 'wide' : k==='back' || k==='clr' ? 'bk' : k==='+' ? 'plus' : ''}" ${off}>${k==='back' ? '⌫' : k==='clr' ? '清' : k==='+' ? '＋' : k==='ok' ? (c && c.octo ? '拍卡' : '收') : k}</button>`).join('')}</div>`);
  } else {
    const give = S.give.reduce((a, b) => a + b, 0);
    morph(must($('pad'), 'pad'), `<div class="disp"><span>找緊</span><b>$${give}</b></div>
      <div class="keys cash">${NOTES.map(n => `<button type="button" data-k="${n}" class="${n >= 10 ? 'note' : 'coin'}">$${n}</button>`).join('')}<button type="button" data-k="back" class="bk">撤回</button><button type="button" data-k="ok" class="go">找錢</button></div>`);
  }
}
must($('pad'), 'pad').addEventListener('click', e => { const b = closestIn(e.target, 'button'); if (b) HOOK.tillKey(b.dataset.k); });
must($('cust'), 'cust').addEventListener('click', e => {
  const b = closestIn(e.target, '[data-strike]'); if (b) HOOK.strikeLine(Number(b.dataset.strike));
});
export function boardHtml(): string {
  const S = liveG();
  const rows: [string, number][] = S.slot==='breakfast' ? OPEN(SETS, 's').map(x => [`${x.id}（${x.top}）`, x.p]) : S.slot==='dinner' ? OPEN(DISHES, 'd').map(x => [x.id, x.p]) : OPEN(FOODS, 'f').map(x => [x.id, x.p]);
  const extras: [string, number][] = [['凍飲', CFG.coldExtra]];
  if (S.slot==='breakfast') extras.push(['轉公仔麵', CFG.dingExtra], ['烘底（餐包）', CFG.hongExtra]);
  if (S.slot==='dinner') extras.push(['加底', GADAI]);
  if (HAT_OK.some(f => menuOpen('f:' + f))) extras.push(['加頂帽（煎蛋）', HAT_P]);
  return `<div class="sh-head"><b>價錢牌</b><span>${SLOTS[S.slot].name}</span></div>
    <p class="hint">每個餐跟一杯熱飲${S.slot==='breakfast' ? '，揀咩粉麵、蛋、包都同價' : ''}</p>
    <table class="board">${rows.map(([n, p]) => `<tr><td>${n}</td><td>$${p}</td></tr>`).join('')}</table>
    <p class="hint">加錢</p>
    <table class="board">${extras.map(([n, p]) => `<tr><td>${n}</td><td>+$${p}</td></tr>`).join('')}</table>
    <p class="hint">單叫飲品（飲品多過餐，多出嚟嗰幾杯）</p>
    <table class="board">${OPEN(DRINKS, 'k').map(d => `<tr><td>${d.id}</td><td>$${d.p}</td></tr>`).join('')}</table>
    <button type="button" class="big" id="boardClose">返回</button>`;
}
export function openBoard(): void { if (!G || !G.running) return; G.board = true; morph(must($('board'), 'board'), boardHtml()); must($('boardWrap'), 'boardWrap').hidden = false; must($('boardClose'), 'boardClose').focus(); }
must($('boardBtn'), 'boardBtn').onclick = openBoard;
must($('boardWrap'), 'boardWrap').addEventListener('click', e => { const t = e.target; if (t instanceof Element && (t.id==='boardWrap' || t.id==='boardClose')) HOOK.closeBoard(); });
