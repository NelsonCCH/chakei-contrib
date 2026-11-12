// Party screens: one pure render per phase of the night, from the night's state and
// the local player's id. A screen reads the night and turns presses into PartyEvents; it decides nothing: the night
// refuses whatever it does not allow, and mountParty shows the refusal. Every rule a screen relies on is written on that
// screen (nothing to remember).
import { PARTY_SHOPS, ROUND_NAME, SHOP_LADDER, TWIST_TEXT, TWISTS, isPartyFloor } from '../../core/party/config';
import { closeCard } from '../../core/party/close';
import { endCard, myColumn } from '../../core/party/endcard';
import { allReady, counted, floorOff, mustReady, voters } from '../../core/party/night';
import { lastText } from '../../core/party/wager';
import type { NightConfig, NightState, PartyEvent } from '../../core/party/types';
import {
  drawBig, drawButton, drawHead, drawCards, drawChip, drawChips, drawColumn, drawColumns, drawCountdown, drawFold, drawHeading, drawKicker, drawLadder,
  drawFloorSlot, drawNote, drawPanel, drawPeople, drawPerson, drawSeatTile, drawSeats, drawSeg, drawShopTile, drawShops, drawSign, drawStat, drawStats, drawTill,
  drawTimerText, drawToggle, drawToggles, drawVerdict, drawWagerCard, drawWait, h,
} from './draw';
import type { Me } from './view';
import { meOf, money, nameOf, presentOf, roundLabel, roundRent, seatName, seatsOf, shopName, signed } from './view';

export interface Screen {
  /** Which screen (data-screen on the root, for the tests). */
  id: string;
  where: string;
  what: string;
  bank: number | null;
  body: HTMLElement;
  act: HTMLElement[];
}
interface Ctx { s: NightState; me: Me; act: (ev: PartyEvent) => void }

/** The screen for this phone now. */
export function screenFor(s: NightState, id: string, act: (ev: PartyEvent) => void): Screen {
  const c: Ctx = { s, me: meOf(s, id), act };
  if (!c.me.present && s.phase !== 'done') return awayScreen(c);
  switch (s.phase) {
    case 'lobby': return lobbyScreen(c);
    case 'round': return roundScreen(c);
    case 'vote': return voteScreen(c);
    case 'ready': case 'countdown': return readyScreen(c);
    case 'endcard': return endScreen(c);
    case 'close': return closeScreen(c);
    case 'done': return doneScreen(c);
  }
}

/** Drops the absent pieces of a list. */
const only = (xs: (HTMLElement | null)[]): HTMLElement[] => xs.filter((x): x is HTMLElement => x !== null);
/** The 搏盡 twist's words (the end card carries it as a plain string). */
const twistText = (t: string): string => { const k = TWISTS.find(x => x === t); return k ? TWIST_TEXT[k] : t; };
const col = (...kids: (HTMLElement | null)[]): HTMLElement => h('div', { cls: 'pty-col' }, ...kids);
const frame = (c: Ctx, id: string, what: string, body: HTMLElement, act: HTMLElement[]): Screen =>
  ({ id, where: c.s.phase === 'lobby' || c.s.phase === 'close' || c.s.phase === 'done' ? shopName(c.s) : roundLabel(c.s), what, bank: c.s.bank, body, act });
const roundName = (s: NightState): string => { const k = s.schedule[s.round]?.kind; return k ? ROUND_NAME[k] : ''; };
const hostName = (s: NightState): string => s.host ? nameOf(s, s.host) : '老闆';

/**
 * The seats as tiles: who drives each; a tap sits on a free seat or stands up from your own (any time). In the
 * ready check each seat also shows ready or not (a computer seat counts as ready).
 */
function seatTiles(c: Ctx, showReady = false): HTMLElement {
  const { s, me } = c;
  const floor = seatsOf(s).filter(isPartyFloor);
  return drawSeats(seatsOf(s).map(seat => {
    const holder = s.seats[seat] ?? null;
    const tile = drawSeatTile({
      seat, title: isPartyFloor(seat) ? floorTitle(seat) : seatName(seat), holder: holder === null ? null : nameOf(s, holder) + (holder === me.id ? '（你）' : ''), mine: holder === me.id,
      ready: showReady ? holder === null || s.taps.includes(holder) : null, off: floorOff(s).includes(seat),
    }, me.present && (holder === null || holder === me.id) ? () => { c.act({ k: 'seat', player: me.id, seat }); } : null);
    return isPartyFloor(seat) ? floorSlot(c, seat, floor, tile) : tile;
  }));
}
/** 樓面's places as the lobby names them: 樓面1, 樓面2. */
const floorTitle = (seat: string): string => seatName(seat) + seat.replace(/\D/g, '');
/**
 * A 樓面 place: its own tile, a player's, the computer's (電腦) or switched off
 * (熄咗: nobody works it and the floor's load is budgeted per switched-on place). Beside a free place's tile, its switch
 * (熄位 / 開位), between rounds and in the lobby; the last place on stays on.
 */
function floorSlot(c: Ctx, seat: string, floor: string[], tile: HTMLButtonElement): HTMLElement {
  const { s, me } = c, off = floorOff(s), isOff = off.includes(seat), free = (s.seats[seat] ?? null) === null;
  const onCount = floor.filter(k => !off.includes(k)).length;
  const can = me.present && free && s.phase !== 'round' && s.phase !== 'close' && (isOff || onCount > 1);
  return drawFloorSlot(seat, tile, free && s.phase !== 'round' && s.phase !== 'close' ? { off: isOff, on: can ? () => { c.act({ k: 'slot', player: me.id, seat, on: isOff }); } : null } : null);
}
/** On 樓面 with a teammate: 「（同 X 一齊）」, else nothing. */
const floorMate = (s: NightState, seat: string, id: string): string => {
  if (!isPartyFloor(seat)) return '';
  const mate = Object.entries(s.seats).find(([k, p]) => isPartyFloor(k) && p !== null && p !== id)?.[1];
  return mate ? `（同${nameOf(s, mate)}一齊）` : '';
};
const seatRule = (): HTMLElement => drawKicker('撳空位坐低 · 再撳自己個位企返起身 · 冇人坐嘅位電腦做 · 樓面熄咗嘅位冇人幫手');
const roomChips = (c: Ctx): HTMLElement => drawChips('room', presentOf(c.s).map(p => drawChip(p.name, { me: p.id === c.me.id, ...(p.id === c.s.host ? { badge: '老闆' } : {}) })));
/** The till against the round's rent, on every screen of a round. */
const till = (s: NightState): HTMLElement | null => { const r = roundRent(s); return r === null ? null : drawTill(s.bank, r); };

// ---------------------------------------------------------------- lobby

function lobbyScreen(c: Ctx): Screen {
  const { s, me } = c, host = me.host;
  const set = <K extends keyof NightConfig>(k: K) => host ? (v: NightConfig[K]): void => { c.act({ k: 'setup', player: me.id, cfg: { [k]: v } }); } : null;
  const n = s.schedule.length, pickShop = set('shop');
  const shops = drawShops(SHOP_LADDER.map((id, i) => {
    const sh = PARTY_SHOPS[id];
    const tip = s.climbed === SHOP_LADDER[i - 1] && id === s.cfg.shop ? '升舖！' : null;
    return drawShopTile({ id, name: sh.name, where: sh.where, for: sh.for, pace: sh.pace, rung: i + 1, on: id === s.cfg.shop, tip }, pickShop ? () => { pickShop(id); } : null);
  }));
  const body = col(
    drawSign(shopName(s), `${s.cfg.days === 1 ? '一日' : '兩日'} · ${String(n)} 更`),
    s.climbed ? drawNote('climbed', h('b', null, '升舖！'), `上晚喺${PARTY_SHOPS[s.climbed].name}做到排隊名店，今晚搬嚟${shopName(s)}`) : null,
    drawKicker(`房入面 ${String(presentOf(s).length)}/8 人`),
    seatRule(),
    seatTiles(c),
    roomChips(c),
    drawNote('tillRule', h('b', null, '錢箱大家一齊：'), `開舖有 ${money(s.bank)}，每更收工交租。收舖時錢箱少過 $0 就執笠；夠錢就睇做到咩名號。`),
    h('div', { cls: 'pty-stack', data: { t: 'setup' } },
      drawKicker(host ? '你係老闆：今晚點玩' : `今晚點玩（${hostName(s)}話事）`),
      h('div', { cls: 'pty-set' }, drawKicker('舖頭：細舖慢、大舖快；做到排隊名店下一晚升舖'), shops),
      drawSeg('幾耐', 'days', [{ v: 1, label: '一日（約半粒鐘）' }, { v: 2, label: '兩日（約一粒鐘）' }] as const, s.cfg.days, set('days')),
      drawSeg('邊個揀目標', 'chooser', [{ v: 'vote', label: '大家投票' }, { v: 'host', label: '老闆話事' }] as const, s.cfg.chooser, set('chooser'))),
  );
  const act = [host ? drawButton('開工', () => { c.act({ k: 'start', player: me.id }); }, { sub: `共 ${String(n)} 更`, t: 'start' }) : drawWait(`等${hostName(s)}開工`)];
  return frame(c, 'lobby', '開舖前', body, act);
}

// ---------------------------------------------------------------- the round (the station takes the screen in the game)

function chosenCard(s: NightState): HTMLElement | null {
  const w = s.wager, card = w && w.chosen !== null ? w.cards[w.chosen] ?? null : null;
  return card && w ? drawCards([drawWagerCard({ ix: w.chosen ?? 0, card, voters: [], mine: false, chosen: true, token: w.tokenOn, lastText: null }, null)]) : null;
}

function roundScreen(c: Ctx): Screen {
  const { s, me } = c, w = s.wager;
  const body = col(
    drawSign(`${roundName(s)}開工`),
    h('div', { cls: 'pty-big', data: { t: 'clock' } }, drawTimerText(), h('small', { cls: 'pty-note' }, ' 秒')),
    drawNote('me-seat', me.seat ? `你做：${seatName(me.seat)}${floorMate(s, me.seat, me.id)}` : '你睇緊戲'),
    chosenCard(s),
    w?.twist ? drawNote('twist', '意外：', h('b', null, TWIST_TEXT[w.twist])) : null,
    till(s),
    seatRule(),
    seatTiles(c),
  );
  return frame(c, 'round', '開工中', body, []);
}

// ---------------------------------------------------------------- the vote

function voteScreen(c: Ctx): Screen {
  const { s, me } = c, w = s.wager;
  if (!w) return frame(c, 'vote', '揀目標', col(drawNote(null, '派緊卡…')), []);
  const hostPicks = s.cfg.chooser === 'host', canVote = !hostPicks || me.host;
  const mineIx = w.votes[me.id], counting = new Set(counted(s).map(p => p.id));
  const cards = w.cards.map((card, ix) => drawWagerCard({
    ix, card, mine: mineIx === ix, chosen: false, token: false, lastText: card.last === null ? null : lastText(card.metric, card.last),
    voters: presentOf(s).filter(p => w.votes[p.id] === ix).map(p => drawChip(p.name, { me: p.id === me.id, ...(!counting.has(p.id) ? { badge: '街坊' } : {}) })),
  }, canVote ? () => { c.act({ k: 'vote', player: me.id, card: mineIx === ix ? null : ix }); } : null));
  const wantToken = w.token.includes(me.id), tokenWho = w.token.map(id => nameOf(s, id));
  const toggles = me.seat === null ? null : drawToggles([
    drawToggle('token', '孤注一擲', s.tokenUsed ? '今晚已經用咗' : `成晚一次：張卡輸贏 ×2 · 過半數坐低嘅人想用就用${tokenWho.length ? ` · 想用：${tokenWho.join('、')}` : ''}`, wantToken,
      s.tokenUsed ? null : () => { c.act({ k: 'token', player: me.id, on: !wantToken }); }),
  ]);
  const v = voters(s), waiting = v.filter(p => w.votes[p.id] === undefined), window = w.allAt !== null;
  const rule = hostPicks ? `今晚${hostName(s)}話事：揀咗之後有 5 秒可以改` : '唔使趕：等齊大家投先計 · 投齊之後 5 秒內仲可以改 · 多數話事 · 打和就老闆揀嗰張（老闆冇揀就穩陣啲嗰張）';
  const body = col(
    drawHead(`揀${roundName(s)}目標`, drawNote('rule', rule)),
    till(s),
    drawCards(cards),
    toggles,
    waiting.length ? h('div', { cls: 'pty-set' }, drawKicker('等緊佢哋投'), drawChips('waiting', waiting.map(p => drawChip(p.name, { me: p.id === me.id })))) : null,
    seatRule(),
    seatTiles(c),
  );
  const status = window ? '人齊！' : `${String(v.length - waiting.length)}/${String(v.length)} 人投咗`;
  const act = [drawWait(canVote ? `${status}${window ? ' · 5 秒後定案，仲可以改' : mineIx === undefined ? ' · 撳張卡投' : ' · 再撳取消'}` : `${status} · 等${hostName(s)}揀`)];
  return frame(c, 'vote', '揀目標', body, act);
}

// ---------------------------------------------------------------- the ready check and the countdown

function readyScreen(c: Ctx): Screen {
  const { s, me } = c, w = s.wager, counting = s.phase === 'countdown';
  const need = mustReady(s), notReady = need.filter(p => !s.taps.includes(p.id)), all = allReady(s), ready = s.taps.includes(me.id);
  const tags = only([w?.tokenOn ? drawChip('孤注一擲 ×2') : null, w?.twist ? drawChip(`意外：${TWIST_TEXT[w.twist]}`) : null]);
  const body = col(
    drawHead(`${roundName(s)}：準備開工`, drawNote('rule', '慢慢嚟：坐低嘅人全部撳「我準備好」，老闆先開得工；電腦做嘅位當準備好。倒數時有人撳「未準備好」就停低。')),
    counting ? h('div', { cls: 'pty-count' }, drawCountdown()) : null,
    chosenCard(s),
    tags.length ? drawChips('tags', tags) : null,
    till(s),
    notReady.length ? h('div', { cls: 'pty-set' }, drawKicker('等緊'), drawChips('notReady', notReady.map(p => drawChip(p.name, { me: p.id === me.id })))) : null,
    seatRule(),
    seatTiles(c, true),
  );
  const act = only([
    me.seat !== null ? drawButton(ready ? '未準備好' : '我準備好', () => { c.act({ k: 'ready', player: me.id, on: !ready }); }, { alt: ready, pressed: ready, t: 'ready', sub: ready ? '撳返轉頭就唔準備' : '睇完數就撳' }) : null,
    me.host && !counting ? drawButton('開工', () => { c.act({ k: 'start', player: me.id }); }, { disabled: !all, t: 'go', sub: all ? '5 秒倒數' : `等緊 ${String(notReady.length)} 個人` }) : null,
    !me.host && me.seat === null ? drawWait(counting ? '就開門喇' : all ? `等${hostName(s)}開工` : `等緊 ${String(notReady.length)} 個人準備`) : null,
    me.host && counting && me.seat === null ? drawWait('倒數緊') : null,
  ]);
  return frame(c, s.phase, counting ? '倒數' : '準備', body, act);
}

// ---------------------------------------------------------------- end card

function endScreen(c: Ctx): Screen {
  const { s, me } = c, card = endCard(s);
  if (!card) return frame(c, 'endcard', '結算', col(drawNote(null, '計緊數…')), []);
  const t = card.team, mine = myColumn(card, s, me.id), tapped = s.taps.includes(me.id), myPay = t.pays.find(p => p.player === me.id)?.pay;
  const sub = [t.card ? t.card.tierName : '', t.token ? '孤注一擲 ×2' : '', t.twist ? `意外：${twistText(t.twist)}` : ''].filter(Boolean).join(' · ');
  const cols = [...card.columns].sort((a, b) => Number(b.seat === mine?.seat) - Number(a.seat === mine?.seat));
  const c0 = counted(s), done = c0.filter(p => s.taps.includes(p.id)).length;
  const body = col(
    drawHead(`${card.name}完`, drawKicker(card.last ? '大家撳「收舖」就睇結果' : '唔使趕：大家撳「下一步」先去揀下一更目標')),
    drawPanel('team',
      drawVerdict(t.met, t.card ? t.card.text : '今更冇卡', sub, t.card ? t.cardDelta : null),
      t.card?.last ? drawNote(null, t.card.last) : null,
      drawStats(only([
        drawStat('takings', '今更人工', signed(t.takings), 'up'),   // the seats' own work, not the till's takings
        myPay === undefined ? null : drawStat('mypay', '你做到', money(myPay), 'up'),
        t.sales === null ? null : drawStat('sales', '收銀機', money(Math.round(t.sales))),
        drawStat('rent', '交租', signed(-t.rent), 'down'),
        drawStat('bankline', '錢箱', `${money(t.bankBefore)} → ${money(t.bank)}`, t.bank < 0 ? 'down wide' : 'gold wide'),
        drawStat('combo', '最高連擊', String(t.maxCombo)),
        drawStat('fevers', '旺場', `${String(t.fevers)} 次`),
      ])),
      t.bank < 0 ? drawNote('owe', h('b', null, '欠租！'), card.last ? '收舖時錢箱少過 $0：間舖要執笠' : '收舖前錢箱要返到 $0 以上，唔係就執笠') : null),
    drawKicker('各個位（每個位自己計星）'),
    drawColumns(cols.map(x => drawColumn(x, x.seat === mine?.seat))),
    card.last ? null : drawKicker('下一更想換位？'),
    card.last ? null : seatRule(),
    card.last ? null : seatTiles(c),
  );
  const act = [drawButton(card.last ? '收舖' : '下一步', () => { c.act({ k: 'next', player: me.id }); }, { pressed: tapped, disabled: tapped, sub: `${String(done)}/${String(c0.length)} 人撳咗`, t: 'next' })];
  return frame(c, 'endcard', '結算', body, act);
}

// ---------------------------------------------------------------- 收舖

function closeScreen(c: Ctx): Screen {
  const { s, me } = c, cc = closeCard(s);
  const people = [...cc.people].sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id));
  const body = col(
    drawSign(cc.shop, '收舖'),
    drawKicker('收舖錢箱'),
    drawBig('final', money(cc.bank), cc.bank < 0),
    cc.prevBank !== null ? drawNote('prev', `上次 ${money(cc.prevBank)} → 今晚 ${money(cc.bank)}`) : null,
    cc.folded ? drawFold(cc.bank) : null,
    drawHeading(`今晚係：${cc.title}`, 'title'),
    !cc.folded && cc.nextTitle ? drawNote('next', `再多 ${money(cc.nextTitle.short)} 就係「${cc.nextTitle.title}」`) : null,
    cc.folded ? null : drawLadder(cc.titleIx),
    drawNote('climb', cc.nextShop ? `做到排隊名店或以上：再開一日就升舖去${cc.nextShop}` : cc.folded ? '再開一日：同一間舖再嚟過' : '做到排隊名店或以上，下一晚先可以升舖'),
    drawNote('cards', `目標中咗 ${String(cc.cardsWon)} 張 · 唔中 ${String(cc.cardsLost)} 張 · 做咗 ${String(cc.rounds)} 更`),
    drawKicker('今晚嘅獎'),
    people.length ? drawPeople(people.map(p => drawPerson(p, p.id === me.id))) : drawNote(null, '今晚冇人做夠一更'),
  );
  const act = me.host
    ? [drawButton('散水', () => { c.act({ k: 'bye', player: me.id }); }, { alt: true, t: 'bye' }), drawButton('再開一日', () => { c.act({ k: 'again', player: me.id }); }, { t: 'again', ...(cc.nextShop ? { sub: `升舖：${cc.nextShop}` } : {}) })]
    : [drawWait(`等${hostName(s)}：再開一日定散水`)];
  return frame(c, 'close', '收舖', body, act);
}

function doneScreen(c: Ctx): Screen {
  const cc = closeCard(c.s);
  const body = col(drawSign('散水', cc.shop), drawBig('final', money(cc.bank), cc.bank < 0), drawHeading(`今晚係：${cc.title}`, 'title'), drawNote(null, '多謝幫襯，下次再嚟！'));
  return frame(c, 'done', '散水', body, []);
}

// ---------------------------------------------------------------- not in the room

function awayScreen(c: Ctx): Screen {
  const { s, me } = c, name = me.p?.name ?? me.id;
  const body = col(drawSign(shopName(s)), drawHeading(me.p ? '你走開咗' : '未入房', 'title'),
    drawNote(null, me.p ? '你個位由電腦頂住，返嚟如果個位仲係電腦做就還返俾你。' : '入房之後撳個位坐低，或者坐喺度睇戲。'), roomChips(c));
  return frame(c, 'away', me.p ? '走開咗' : '未入房', body, [drawButton(me.p ? '返嚟' : '入房', () => { c.act({ k: 'join', player: me.id, name }); }, { t: 'join' })]);
}
