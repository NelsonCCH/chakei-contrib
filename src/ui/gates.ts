// 逐步解鎖：新手唔會一入嚟見晒十幾樣系統（好似網遊咁跟進度慢慢開）
// 流程：僱員培訓 → 第 1 關屋邨茶記 → 做完第一更開「我的茶餐廳」→ 新人開熟客簿、每日挑戰、似水流年 → 熟手開地產舖、評級、其餘關卡
// 解鎖條件睇總星數／進度，所以舊玩家自動開返晒；第一次載入唔會彈卡
// TypeScript port of the original game's gates.js, as an ES module: every
// top-level name is exported, none renamed.
import './dex';   // load order: src/entry.ts
import { $ } from './prefs';
import { must } from '../core/util';
import { setStation, station } from '../core/state';
import { toast } from './ui';
import { SHOP, openDecor, saveShop } from './decor';
import { sfx } from './juice';
import { branches, openBranches } from './market';
import { rankIx, renderCareer, roleOpenNow, ptAllRolesOn, floorLessonNow } from './career';
import { FLOOR_INTRO, FLOOR_LESSONS } from '../core/work/roles';
import { SEAT_NAMES } from './seat';
import { EXTRA_KINDS } from '../core/referee/extras';
import { setLvTab, openLevels, closestIn, lvGet, armLevel, dsEl } from './levels';
import { dexCount, openDex } from './dex';
import { armTut, openTraining } from './tutorial';
import { trackOnce } from './stats';
import { homeStep, start, saveSet, buildMenus } from './main';

/** The role gates' cards: the role, the main level that brings it, what the seat does. */
const ROLE_GATES: [ExtraKind, string, string][] = [
  ['runner', 'central', '由出餐口碌托盤送餸上枱'],
  ['takeaway', 'mongkok', '照單執外賣袋，綁好袋交俾客'],   // 第 3 關
  ['roast', 'newyear', '斬燒味上碟，跟虛線一刀一件'],
];
export const firstShiftDone =(): boolean => ((SHOP.shifts ?? 0)|0) > 0 || ((SHOP.stars ?? 0)|0) > 0 || ((SHOP.servedTotal ?? 0)|0) > 0 || Object.keys(SHOP.levels || {}).length > 0 || Object.keys(SHOP.lvst || {}).length > 0;
export const GATES: Gate[] = [
  { k:'shop',   ok: () => firstShiftDone(), need:'做完第一更先開',
    title:'你都想有自己間舖？', text:'老闆話：「做得唔錯！」<b>我的茶餐廳</b>開咗：自己揀位揀更、賺錢裝修、交學費學新菜。雪櫃仲有一份新手食材包。', go: () => { homeStep('shop'); } },
  { k:'rookie', ok: () => rankIx() >= 1, need:'升到新人開',
    title:'升咗新人！', text:'開咗：<b>熟客簿</b>、<b>每日挑戰</b>（全港同一批客）、<b>返工日數</b>，同埋「似水流年」關卡（五六十年代冰室、街邊大牌檔）。', go: () => { setLvTab('era'); openLevels(); } },
  { k:'dex',    ok: () => rankIx() >= 1 && dexCount().n >= 2, need:'升到新人、玩過兩關開',
    title:'茶餐廳圖鑑', text:'每關一張卡，介紹嗰關致敬嘅茶記原型。玩一次開卡，三星睇完整介紹，每個位都三星變金卡。', go: () => { openDex(); } },
  { k:'pro',    ok: () => rankIx() >= 2, need:'升到熟手開',
    title:'升咗熟手！', text:'開咗：<b>地產舖</b>（搬舖、供舖做業主）、<b>茶記評級</b>、<b>廚房第二隻碟</b>，同埋「老街舊舖」「茶記傳奇」關卡。', go: () => { homeStep('shop'); openDecor('grow'); } },
  { k:'branch', ok: () => typeof branches==='function' && branches().length > 0, need:'',
    title:'第一間分店', text:'分店每個鐘自動賺錢（星多、評級高賺多啲），最多儲 8 個鐘，記得返嚟主畫面撳「收數」。', go: () => { openBranches(); } },
  // the new roles come one at a time along the main ladder (core/work/roles.ts ROLE_INTRO); each card opens the
  // role's lesson (員工培訓) the first time the player reaches the level that brings it
  // (the texts are getters: the level and seat names are read when a card shows, not while the modules load)
  // the 試玩 panel's "all roles open" (preview only) opens seats without the ladder's gate card
  ...ROLE_GATES.map(([k, id, what]): Gate => ({ k:'x_' + k, ok: () => !ptAllRolesOn() && roleOpenNow(k), need:'',
    get title(){ return `新位：${SEAT_NAMES[k]}`; },
    get text(){ return `第 ${String(lvGet(id).n)} 關「${lvGet(id).name}」開始有<b>${SEAT_NAMES[k]}</b>：${what}。去「員工培訓」學一課（學識獎 $300），之後有${SEAT_NAMES[k]}嘅關卡同自己間舖都揀得呢個位。`; },
    go: () => { openTraining(); } })),
  // a 樓面 task with its own lesson gets a 新工作 card where it first joins the floor
  // (core/work/roles.ts FLOOR_INTRO); live only, like the role cards
  { k:'x_clear', ok: () => !ptAllRolesOn() && floorLessonNow('clear'), need:'',
    title:'新工作：執枱', get text(){ return `第 ${String(FLOOR_INTRO.clear)} 關「${lvGet('central').name}」開始，樓面多咗<b>執枱</b>：客走咗撳枱頭頂個「執」，數住將碟、碗、杯收走，撳多咗成張枱打回頭。去「員工培訓」學一課（學識獎 $300）。`; },
    go: () => { openTraining(); } },
  { k:'x_deliver', ok: () => !ptAllRolesOn() && floorLessonNow('deliver'), need:'',
    title:'新工作：送外賣', get text(){ return `第 ${String(FLOOR_INTRO.deliver)} 關「${lvGet('typhoon').name}」開始，有啲外賣單係<b>送外賣</b>：袋綁好擺喺門口，樓面撳門口外面個「送」，踩單車送上門（一轉最多三袋），凍咗就冇貼士。去「員工培訓」學一課（學識獎 $300）。`; },
    go: () => { openTraining(); } },
];
export const gateOk = (k: string | undefined): boolean => { const g = GATES.find(x => x.k===k); return !g || g.ok(); };
export const gateNeed = (k: string | undefined): string => GATES.find(x => x.k===k)?.need || '';
// 關卡分類幾時開
export const CAT_GATE: Record<string, string> = { era:'rookie', old:'pro', classic:'pro' };
export const catOpen = (k: string): boolean => ptAllRolesOn() || gateOk(CAT_GATE[k]);   // preview: every tab
// 舊玩家（或者雲端載入）：照而家進度當睇過晒，唔彈卡
export function gateInit(): void {
  if (!SHOP.gates){ SHOP.gates = GATES.filter(g => g.ok()).map(g => g.k); }
  // a save that learned a new seat before the role gates keeps it and needs no card for it
  for (const k of [...EXTRA_KINDS, ...FLOOR_LESSONS]) if ((SHOP.tutDone || {})[k] && !SHOP.gates.includes('x_' + k)) SHOP.gates.push('x_' + k);
}
gateInit();

// 個掣未開：變暗、上鎖、寫幾時開；撳就話佢知
export function gateBtn(id: string, k: string, label: string): void {
  const b = $(id); if (!b) return;
  const open = gateOk(k); b.classList.toggle('gated', !open); b.dataset.gate = open ? '' : k;
  if (!open) b.innerHTML = `🔒 ${label}<span>${gateNeed(k)}</span>`;
  else if (b.innerHTML.startsWith('🔒')) b.textContent = label;
}
document.addEventListener('click', e => {
  const b = closestIn(e.target, '[data-gate]'); if (!b || !b.dataset.gate) return;
  e.stopImmediatePropagation(); e.preventDefault(); toast(gateNeed(b.dataset.gate));
}, true);
export function gateRender(): void {
  gateInit();
  const shopOpen = gateOk('shop');
  const sb = must($('shopBtn'), 'shopBtn'); sb.classList.toggle('gated', !shopOpen); sb.dataset.gate = shopOpen ? '' : 'shop';
  must(sb.querySelector('span'), 'shopBtn span').textContent = shopOpen ? '揀位、揀更，賺錢裝修擴舖' : '🔒 做完第一更（關卡都得）先開';
  gateBtn('bookBtn', 'rookie', '熟客簿'); gateBtn('dexBtn', 'dex', '茶餐廳圖鑑'); gateBtn('estateBtn', 'pro', '地產舖');
  // 新手提示：未培訓 → 去培訓；培訓完未返過工 → 去第一關
  const nb = $('newbie'), trained = Object.keys(SHOP.tutDone || {}).length > 0 || SHOP.skipTut;
  // 完全新玩家：主頁淨係得一個「開工」，其餘等做完第一更先開
  const first = !trained && !firstShiftDone() && !ptAllRolesOn();   // preview with everything open: the full home
  must(document.querySelector('#startView .home'), '#startView .home').classList.toggle('first', first); must($('firstCard'), 'firstCard').hidden = !first;
  if (first) must(nb, 'newbie').hidden = true;
  if (trained && !firstShiftDone()){
    must(nb, 'newbie').hidden = false;
    must(nb, 'newbie').innerHTML = `<p><b>下一步：第一關「${lvGet('estate').name}」</b>公屋樓下嘅街坊茶記，客人有耐性。做完一更，老闆就畀你開自己間舖！</p><span><button type="button" id="firstLvGo">去第一關</button></span>`;
  }
  setTimeout(gatePop, 400);
}
document.addEventListener('click', e => { if (closestIn(e.target, '#firstLvGo')){ armLevel('estate'); start(); } });
// 完全新玩家：開工 = 跟師傅學伙記；識玩 = 直接去第一關
must($('firstGo'), 'firstGo').onclick = () => { setStation('waiter'); saveSet('ckf-station', station); buildMenus(); armTut(); start(); };
must($('firstSkip'), 'firstSkip').onclick = () => { SHOP.skipTut = true; saveShop(); if (typeof trackOnce==='function') trackOnce('tut_skip'); armLevel('estate'); start(); };
// 「去睇吓」帶咗玩家去主頁另一版（例如自己間舖）：佢未離開嗰版，下一張卡唔好彈出嚟遮住佢
export let gateHold: string | undefined = '';
export const homeNow = (): string | undefined => dsEl(must(document.querySelector('.home'), '.home')).dataset.step;
// 返主選單（或者做完一更返嚟）：放返下一張卡出嚟
export function gateFree(): void { gateHold = ''; setTimeout(gatePop, 400); }
// 新開嘅系統：返到主畫面先彈黃卡，一次一張
export function gatePop(): void {
  // the 試玩 panel's "everything open" (preview only): no gate card at all; nothing is marked seen, so the cards
  // still come once the switch is off
  if (ptAllRolesOn()) return;
  if (must($('startView'), 'startView').hidden || !must($('bookView'), 'bookView').hidden || $('gatePop') || (gateHold && homeNow() === gateHold)) return;
  const g = GATES.find(x => x.ok() && !must(SHOP.gates, 'SHOP.gates').includes(x.k)); if (!g) return;
  must(SHOP.gates, 'SHOP.gates').push(g.k); saveShop();
  const d = document.createElement('div'); d.id = 'gatePop'; d.className = 'overlay';
  d.innerHTML = `<div class="card gatecard" role="dialog" aria-label="${g.title}"><p class="kicker">新嘢解鎖</p><h2>${g.title}</h2><p>${g.text}</p>
    <span><button type="button" class="big" id="gateGo">去睇吓</button><button type="button" class="big alt" id="gateLater">遲啲</button></span></div>`;
  document.body.appendChild(d); sfx.fanfare();
  const close = (): void => { d.remove(); renderCareer(); };
  // same rule as the kitchen pop-up: the card appears 400 ms after the home screen draws, possibly under a finger
  // already pressing 開工 or 自己間舖, and the click at finger up must not land on 去睇吓 / 遲啲. A button acts only if
  // the press began on the card; a keyboard click (detail 0) has no press and is accepted.
  let down = false;
  must(d.querySelector('.gatecard'), '.gatecard').addEventListener('pointerdown', () => { down = true; });
  const pressed = (e: MouseEvent): boolean => { const ok = down || e.detail === 0; down = false; return ok; };
  must($('gateLater'), 'gateLater').onclick = e => { if (pressed(e)) close(); };
  must($('gateGo'), 'gateGo').onclick = e => { if (!pressed(e)) return; d.remove(); const s0 = homeNow(); g.go(); gateHold = homeNow() !== s0 ? homeNow() : ''; setTimeout(() => { const sv = $('startView'); if (sv && !sv.hidden) renderCareer(); }, 50); };
}
