// 成績卡／災難卡：收工後出一張直度像素圖卡，可以直接分享去 Threads、IG
// TypeScript port of the original game's share.js, as an ES module: every
// top-level name is exported, none renamed.
import '../net/net';   // load order: src/entry.ts
import { liveG, G } from '../core/state';
import { must, cash } from '../core/util';
import { SLOTS } from '../core/data/menus';
import { $ } from './prefs';
import { toast } from './ui';
import { P, bx, el } from './kitchen';
import { PX, setPX } from './pixel';
import { SHOP } from './decor';
import { LEVELS, lvTag, stDef, curLine, lvStarsNow } from './levels';
import { track } from './stats';
import { fig } from './smoke';
import { dress, WAITER_STAND } from './outfit';
import { lastEnd, shopName } from './main';
import { shiftMeasure } from '../core/career/targets';

/* ===================== 成績卡 ===================== */
export const CARD_W = 180, CARD_H = 240, CARD_S = 6;   // 像素格 180×240，放大六倍 = 1080×1440
// 正式網址先印網址上卡
export const shareHost = (): boolean => location.protocol==='https:' && !/^localhost|^127\./.test(location.hostname);
/** A random entry; undefined for an empty list (the JS did not check). */
export const pickOne = <T>(a: readonly T[]): T | undefined => a[Math.floor(Math.random() * a.length)];
export function cardStats(): CardStats {
  const S = liveG();
  const L = S.level && LEVELS[S.level], burnt = (S.burnt ?? 0)|0, angry = S.angry|0, mistakes = S.mistakes|0;
  const stars = L ? lvStarsNow() : null;
  const disaster = angry >= 4 || mistakes >= 5 || burnt >= 4 || (L && shiftMeasure(S) < curLine()[0] / 3);
  let title, line;
  if (disaster){
    title = '災難現場';
    line = pickOne([
      burnt >= 4 && `今日燶咗 ${burnt} 碟，阿姐叫你聽日唔使返。`,
      angry >= 4 && `走咗 ${angry} 枱客，隔籬茶記多謝你幫襯。`,
      mistakes >= 5 && `錯咗 ${mistakes} 次，成間舖都想同你絕交。`,
      '老闆睇完賬簿，默默點咗支煙。',
    ].filter((x): x is string => Boolean(x)));
  } else if (L && L.hell && stars===3){ title = '茶記戰神'; line = '地獄午市都頂得順，你係傳說。'; }
  else {
    title = lastEnd ? lastEnd.sign : '收工';
    line = ((S.maxCombo ?? 0)|0) >= 20 ? `連擊 ${String(S.maxCombo)} 下，快過外賣仔。`
      : mistakes===0 && angry===0 ? '碟碟都啱，客客都笑，阿姐都讚。'
      : pickOne(['今日又捱過一更，飲杯奶茶先。', '手腳唔錯，聽日繼續。', '茶記人，茶記魂。']);
  }
  return { L, stars, disaster, title, line, burnt, angry, mistakes };
}
export function drawCard(): { cv: HTMLCanvasElement; st: CardStats } {
  const S = liveG();
  const cv = document.createElement('canvas'); cv.width = CARD_W * CARD_S; cv.height = CARD_H * CARD_S;
  const c = must(cv.getContext('2d'), 'card 2d context'), st = cardStats(), keep = PX;
  const bg = st.disaster ? '#5a1414' : '#1b2a24', tile = st.disaster ? ['#6e1c1c', '#7a2424'] : ['#2a8b67', '#22704f'];
  c.setTransform(CARD_S, 0, 0, CARD_S, 0, 0); setPX(c);
  try {
    P(0, 0, CARD_W, CARD_H, bg);
    // 紙皮石框
    for (let x = 0; x < CARD_W; x += 4) for (const y of [0, 4, CARD_H - 8, CARD_H - 4]) P(x, y, 3, 3, String(tile[(x / 4 + y) % 2]));
    for (let y = 8; y < CARD_H - 8; y += 4) for (const x of [0, 4, CARD_W - 8, CARD_W - 4]) P(x, y, 3, 3, String(tile[(y / 4 + x) % 2]));
    // 招牌
    bx(14, 14, CARD_W - 28, 26, '#7a1f1f', '#a5372f', '#5a1414');
    // 收據紙
    bx(18, 62, CARD_W - 36, 118, '#fbf6e2', '#ffffff', '#e8dcc0');
    for (let x = 20; x < CARD_W - 20; x += 6) P(x, 179, 3, 2, bg);
    // 伙記仔（或者燶咗嘅碟）
    if (st.disaster){ el(146, 205, 16, 6, '#fbfaf4'); el(146, 204, 10, 4, '#2a2420', null); for (let k = 0; k < 4; k++) P(140 + k * 4, 188 - k * 2, 2, 2, '#8a8f94'); }
    fig(c, 132, 228, dress(WAITER_STAND));
  } finally { setPX(keep); }
  // 字（高解像）
  c.setTransform(1, 0, 0, 1, 0, 0);
  const T = (txt: string, x: number, y: number, size: number, col: string, w = 900, al: CanvasTextAlign = 'center', font = '"Noto Sans HK", sans-serif'): void => { c.font = `${w} ${size}px ${font}`; c.fillStyle = col; c.textAlign = al; c.textBaseline = 'middle'; c.fillText(txt, x, y); };
  const X = (v: number): number => v * CARD_S;
  T('香城茶餐廳', X(90), X(27), 66, '#ffe9a8', 900, 'center', '"Noto Serif HK", serif');
  const where = st.L ? `${lvTag(st.L)} · ${st.L.name}` : `${shopName()} · 第 ${SHOP.day} 日 · ${SLOTS[S.slot].name}`;
  T(where, X(90), X(51), 34, '#e6f1ec', 700);
  T(st.title, X(90), X(78), 84, st.disaster ? '#c8323c' : '#0f1a16');
  if (st.stars != null) T('★'.repeat(st.stars) + '☆'.repeat(3 - st.stars), X(90), X(97), 56, '#e9a21a');
  const rows = [['營業額', cash(S.revenue)], ['最長連擊', `${(S.maxCombo ?? 0)|0}`], ['走單', `${st.angry} 枱`], ['出錯', `${st.mistakes} 次`]];
  if (S.station==='kitchen') rows.push(['燶咗', `${st.burnt} 碟`]);
  rows.forEach(([k, v], i) => { const y = X(st.stars != null ? 111 : 103) + i * 58;
    T(String(k), X(26), y, 40, '#5a6a62', 700, 'left'); T(String(v), X(154), y, 46, '#0f1a16', 900, 'right'); });
  T(`${stDef(S.station).name}位${S.coop ? ' · 組隊' : ''}`, X(90), X(172), 28, '#7a5a3a', 700);
  // 評語
  c.font = '700 36px "Noto Sans HK", sans-serif'; c.fillStyle = '#ffffff'; c.textAlign = 'left'; c.textBaseline = 'top';
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- the JS splits the line into code points; kept as written
  const words = [...must(st.line, 'card line')], lines = [''];
  words.forEach(ch => { if (c.measureText(String(lines[lines.length - 1]) + ch).width > X(112)) lines.push(''); lines[lines.length - 1] = String(lines[lines.length - 1]) + ch; });
  lines.slice(0, 3).forEach((ln, i) => { c.fillText(ln, X(14), X(190) + i * 46); });
  T(shareHost() ? location.hostname : '撳嚟挑戰我 · 香城茶餐廳', X(14), X(228), 26, '#9fd0b8', 700, 'left');
  return { cv, st };
}
export function openShareCard(): void {
  if (!G) return;
  if (typeof track==='function') track('share');
  const { cv, st } = drawCard(), url = cv.toDataURL('image/png');
  must($('book'), 'book').innerHTML = `<div class="sh-head"><b>${st.disaster ? '災難卡' : '成績卡'}</b><span>長撳張圖都可以儲存</span></div>
    <img class="sharecard" src="${url}" alt="${st.title}：${String(st.line)}">
    <button type="button" class="big" id="shareGo">分享</button>
    <button type="button" class="big alt" id="shareSave">下載圖片</button>
    <button type="button" class="big alt" id="bookClose">返回</button>`;
  must($('bookView'), 'bookView').hidden = false;
  const site = shareHost() ? ' ' + location.origin + '/' : '';
  const text = `${st.title}！${String(st.line)} #香城茶餐廳${site}`;
  // The JS passed an async callback straight to toBlob; this runs the same body (synchronously up to its first await).
  must($('shareGo'), 'shareGo').onclick = () => { cv.toBlob(b => { void (async () => {
    // A null blob (canvas too big) became the text "null" in the JS too.
    const f = new File([b ?? String(b)], 'chakei.png', { type:'image/png' });
    try {
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files:[f] })) await navigator.share({ files:[f], text });
      else { await navigator.clipboard.writeText(text); toast('呢部機唔支援直接分享，下載張圖再貼啦（文字已經複製）'); }
    } catch { /* share cancelled or not allowed */ }
  })(); }); };
  must($('shareSave'), 'shareSave').onclick = () => { const a = document.createElement('a'); a.href = url; a.download = 'chakei.png'; a.click(); };
}
must($('shareBtn'), 'shareBtn').onclick = openShareCard;
