// Party screens: every visual piece, as named draw functions in one place. Each returns a
// plain DOM element styled by style.ts; the screens (screens.ts) only arrange them. Code-drawn: no images.
import { tierName } from '../../core/party/config';
import { TITLES } from '../../core/party/config';
import type { Card, ShopPace } from '../../core/party/types';
import type { EndColumn } from '../../core/party/endcard';
import type { CloseCard } from '../../core/party/close';
import { money, signed } from './view';

type Kid = Node | string | null | undefined | false;
export interface Attrs {
  cls?: string;
  /** data-* attributes (the tests find elements by them). */
  data?: Record<string, string>;
  pressed?: boolean;
  disabled?: boolean;
  label?: string;
  style?: Record<string, string>;
  on?: () => void;
}

/** One element: tag, attributes, children (strings become text; null / false are skipped). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, a: Attrs | null = null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (a) {
    if (a.cls) el.className = a.cls;
    for (const [k, v] of Object.entries(a.data ?? {})) el.dataset[k] = v;
    if (a.pressed !== undefined) el.setAttribute('aria-pressed', String(a.pressed));
    if (a.label) el.setAttribute('aria-label', a.label);
    for (const [k, v] of Object.entries(a.style ?? {})) el.style.setProperty(k, v);
    if (el instanceof HTMLButtonElement) { el.type = 'button'; el.disabled = a.disabled ?? false; }
    const on = a.on;
    if (on) el.addEventListener('click', () => { on(); });
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}

// ---------------------------------------------------------------- frame

/** The wall strip: where in the night (round, phase) and the team's shared till (red below $0: 欠租). */
export function drawTopBar(where: string, what: string, bank: number | null): HTMLElement {
  return h('div', { cls: 'pty-top' },
    h('div', { cls: 'pty-where' }, h('b', { data: { t: 'where' } }, where), h('span', { data: { t: 'what' } }, what)),
    bank === null ? null : h('div', { cls: 'pty-bank' + (bank < 0 ? ' owe' : '') }, bank < 0 ? '錢箱 · 欠租' : '錢箱', h('b', { data: { t: 'bank' } }, money(bank))));
}
/** The shared till against this round's rent (vote, ready, round screens): what the team is playing for together. */
export function drawTill(bank: number, rent: number): HTMLElement {
  const short = bank + 0 < rent;
  return h('div', { cls: 'pty-till' + (bank < 0 ? ' owe' : short ? ' tight' : ''), data: { t: 'till' } },
    h('div', null, h('small', null, '錢箱（大家一齊）'), h('b', { data: { t: 'tillBank' } }, money(bank))),
    h('div', null, h('small', null, '今更收工交租'), h('b', { data: { t: 'rent' } }, money(rent))),
    h('p', null, bank < 0 ? '欠緊租：收舖前要返到 $0 以上，唔係就執笠' : '人工 + 目標 − 租 = 錢箱；收舖時錢箱少過 $0 就執笠'));
}
/** Who this phone is: name, seat, 老闆. */
export function drawMeLine(name: string, seat: string | null, host: boolean): HTMLElement {
  return h('div', { cls: 'pty-meline', data: { t: 'me' } }, '你：', h('b', null, name), seat ? h('span', { cls: 'pty-badge dark' }, seat) : h('span', { cls: 'pty-badge' }, '睇戲'),
    host ? h('span', { cls: 'pty-badge red', data: { t: 'host' } }, '老闆') : null);
}
/** The phase's clock, drawn full; mountParty shrinks it in place every frame (no re-render). */
export function drawTimerBar(): HTMLElement {
  return h('div', { cls: 'pty-tbar', data: { timerbar: '' } }, h('i'));
}
/** A timer's number, filled in place by mountParty. */
export function drawTimerText(cls = ''): HTMLElement {
  return h('span', { cls, data: { timer: '' } });
}

// ---------------------------------------------------------------- type and buttons

/** A screen's heading with its line under it and the phase's seconds on the right. */
export function drawHead(title: string, sub: HTMLElement | null): HTMLElement {
  return h('div', { cls: 'pty-head' }, h('div', { cls: 'pty-head-main' }, drawHeading(title, 'title'), sub), h('div', { cls: 'pty-big pty-secs' }, drawTimerText()));
}
export const drawKicker =(text: string): HTMLElement => h('p', { cls: 'pty-kicker' }, text);
export const drawHeading = (text: string, t?: string): HTMLElement => h('h2', { cls: 'pty-h', data: t ? { t } : {} }, text);
export const drawNote = (t: string | null, ...kids: Kid[]): HTMLElement => h('p', { cls: 'pty-note', data: t ? { t } : {} }, ...kids);
/** The shop's 招牌: cream board, red letters (the game's .sign). */
export const drawSign = (text: string, sub?: string): HTMLElement => h('h1', { cls: 'pty-sign', data: { t: 'sign' } }, text, sub ? h('small', null, sub) : null);

export interface BtnOpts { alt?: boolean; pressed?: boolean; disabled?: boolean; sub?: string; t?: string }
/** The big ink-bordered button of the action bar (開工, 下一步, 好, 再開一日 ...). */
export function drawButton(label: string, on: () => void, o: BtnOpts = {}): HTMLButtonElement {
  return h('button', { cls: 'pty-btn' + (o.alt ? ' alt' : ''), on, ...(o.pressed !== undefined ? { pressed: o.pressed } : {}), disabled: o.disabled ?? false, data: o.t ? { t: o.t } : {} },
    h('span', null, label), o.sub ? h('small', null, o.sub) : null);
}
/** The action bar's "waiting for someone" line in place of a button. */
export const drawWait = (text: string): HTMLElement => h('div', { cls: 'pty-wait', data: { t: 'wait' } }, text);

/** A row of choices, one lit (lobby settings). Read-only for everyone but the host. */
export function drawSeg<V extends string | number | boolean>(title: string, t: string, opts: readonly { v: V; label: string }[], value: V, pick: ((v: V) => void) | null): HTMLElement {
  return h('div', { cls: 'pty-set' }, drawKicker(title),
    h('div', { cls: 'pty-seg', data: { t } }, ...opts.map(o => h('button', { pressed: o.v === value, disabled: pick === null, data: { v: String(o.v) }, on: pick ? () => { pick(o.v); } : undefined }, o.label))));
}

/** A person's name chip (votes, taps, the room). */
export function drawChip(name: string, o: { me?: boolean; off?: boolean; badge?: string } = {}): HTMLElement {
  return h('span', { cls: 'pty-chip' + (o.me ? ' mine' : '') + (o.off ? ' off' : ''), data: { name, ...(o.off ? { off: '' } : {}) } }, h('span', null, name), o.badge ? h('span', { cls: 'pty-badge red' }, o.badge) : null);
}
export const drawChips = (t: string, chips: HTMLElement[]): HTMLElement => h('div', { cls: 'pty-chips', data: { t } }, ...chips);

// ---------------------------------------------------------------- seats

export interface SeatLook { seat: string; title: string; holder: string | null; mine: boolean; ready: boolean | null; off?: boolean }
/** A station seat: its name, who drives it (or 電腦; 熄咗 for a switched-off 樓面 place), what a tap does, and (in the ready check) a tick when ready. */
export function drawSeatTile(x: SeatLook, on: (() => void) | null): HTMLButtonElement {
  const off = x.off === true && x.holder === null;
  const hint = on !== null && x.mine ? '再撳企返起身' : on !== null && x.holder === null ? '撳呢度坐低' : null;
  return h('button', { cls: 'pty-seat' + (x.mine ? ' mine' : '') + (x.holder === null ? ' cpu' : '') + (off ? ' off' : ''), data: { seat: x.seat, ...(x.ready === null ? {} : { ready: String(x.ready) }) }, disabled: on === null, on: on ?? undefined },
    h('b', null, x.title), h('span', { data: { t: 'holder' } }, x.holder ?? (off ? '熄咗' : '電腦')),
    x.ready === null ? null : h('i', { cls: 'rdy' + (x.ready ? ' on' : ''), data: { t: 'rdy' } }, x.ready ? '✓ 準備好' : '未準備'),
    hint ? h('em', { data: { t: 'hint' } }, hint) : null);
}
export const drawSeats = (tiles: HTMLElement[]): HTMLElement => h('div', { cls: 'pty-seats', data: { t: 'seats' } }, ...tiles);
/**
 * A 樓面 place's tile with its switch in the tile's corner: 熄位 on a computer place, 開位 on a
 * switched-off one; `sw` null: no switch (a player sits there, or a round is on); `sw.on` null: shown but locked.
 */
export function drawFloorSlot(seat: string, tile: HTMLButtonElement, sw: { off: boolean; on: (() => void) | null } | null): HTMLElement {
  return h('div', { cls: 'pty-slot', data: { slot: seat } }, tile,
    sw ? h('button', { cls: 'pty-slotsw' + (sw.off ? ' off' : ''), data: { t: 'slotsw', v: sw.off ? 'on' : 'off' }, disabled: sw.on === null, on: sw.on ?? undefined }, sw.off ? '開位' : '熄位') : null);
}

// ---------------------------------------------------------------- the wager

const TIER_COLOUR: Record<string, string> = { safe: 'var(--t-safe)', bet: 'var(--t-bet)', allin: 'var(--t-allin)' };
export interface CardLook { ix: number; card: Card; voters: HTMLElement[]; mine: boolean; chosen: boolean; token: boolean; lastText: string | null }
/** One of the three target cards: tier strip, the words, what it pays, last round, the voters' chips. */
export function drawWagerCard(x: CardLook, on: (() => void) | null): HTMLButtonElement {
  const mult = x.token ? 2 : 1, c = x.card;
  return h('button', { cls: 'pty-card' + (x.chosen ? ' won' : ''), pressed: x.mine, disabled: on === null, data: { card: String(x.ix), tier: c.tier }, style: { '--tc': TIER_COLOUR[c.tier] ?? 'var(--t-safe)' }, on: on ?? undefined },
    h('div', { cls: 'tier' }, h('b', null, tierName(c.tier)), h('span', { data: { t: 'pay' } }, `中 ${signed(c.win * mult)} · 唔中 ${c.lose ? signed(-c.lose * mult) : '$0'}`)),
    h('div', { cls: 'txt', data: { t: 'text' } }, c.text, mult > 1 ? h('span', { cls: 'x2' }, ` ×${String(mult)}`) : null),
    x.lastText ? h('div', { cls: 'last', data: { t: 'last' } }, x.lastText) : null,
    c.tier === 'allin' ? h('div', { cls: 'warn' }, '搏盡：今更會有意外') : null,
    drawChips('voters', x.voters));
}
export const drawCards = (cards: HTMLElement[]): HTMLElement => h('div', { cls: 'pty-cards', data: { t: 'cards' } }, ...cards);

/** A switch tile: 孤注一擲. */
export function drawToggle(t: string, title: string, sub: string, on: boolean, press: (() => void) | null): HTMLButtonElement {
  // each " · " phrase stays whole (a line never breaks inside 唔中 −$100)
  const parts = sub.split(' · ').flatMap((x, i) => [i ? ' · ' : null, h('i', null, x)]);
  return h('button', { cls: 'pty-tog', pressed: on, disabled: press === null, data: { t }, on: press ?? undefined }, h('b', null, title), h('span', null, ...parts));
}
export const drawToggles = (kids: HTMLElement[]): HTMLElement => h('div', { cls: 'pty-toggles' }, ...kids);

// ---------------------------------------------------------------- results

/** ★★☆ on a station's own line. */
export function drawStars(n: number): HTMLElement {
  const k = Math.max(0, Math.min(3, Math.round(n)));
  return h('span', { cls: 'pty-stars', label: `${String(k)} 粒星`, data: { stars: String(k) } }, '★'.repeat(k), h('i', null, '★'.repeat(3 - k)));
}
/** A number box (takings, bank, combo ...). tone: up / down / gold. */
export function drawStat(t: string, label: string, value: string, tone = ''): HTMLElement {
  return h('div', { cls: 'pty-stat' + (tone ? ' ' + tone : ''), data: { t } }, label, h('b', null, value));
}
export const drawStats = (kids: HTMLElement[]): HTMLElement => h('div', { cls: 'pty-stats' }, ...kids);
export const drawPanel = (t: string, ...kids: Kid[]): HTMLElement => h('section', { cls: 'pty-panel', data: { t } }, ...kids);
/** The card's verdict: a stamp (中 / 唔中 / 冇卡), the card's words and the money. */
export function drawVerdict(met: boolean | null, text: string, sub: string, delta: number | null): HTMLElement {
  const stamp = met === null ? ['none', '試'] : met ? ['met', '中'] : ['miss', '唔中'];
  return h('div', { cls: 'pty-verdict', data: { t: 'verdict', met: String(met) } },
    h('div', { cls: 'pty-stamp ' + (stamp[0] ?? '') }, stamp[1] ?? ''),
    h('div', { cls: 'v-main' }, h('div', { cls: 'txt' }, text), h('div', { cls: 'sub' }, sub)),
    delta === null ? null : h('div', { cls: 'amt ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : ''), data: { t: 'delta' } }, signed(delta)));
}
/** One station's column on the end card: name, who worked it, stars, its own measures, best moment. */
export function drawColumn(c: EndColumn, mine: boolean): HTMLElement {
  const fmt = (v: number): string => Number.isInteger(v) ? String(v) : v.toFixed(1);
  return h('article', { cls: 'pty-stn' + (mine ? ' mine' : ''), data: { col: c.seat } },
    h('h3', null, h('span', null, c.title), drawStars(c.stars)),
    h('div', { cls: 'pty-who', data: { t: 'who' } }, c.names.join('、')),
    c.measures.length ? h('dl', null, ...c.measures.flatMap(m => [h('dt', null, m.label), h('dd', null, fmt(m.value))])) : null,
    c.best ? h('div', { cls: 'best' }, `「${c.best}」`) : null);
}
export const drawColumns = (kids: HTMLElement[]): HTMLElement => h('div', { cls: 'pty-cols', data: { t: 'cols' } }, ...kids);

// ---------------------------------------------------------------- 收舖

/** The 執笠 stamp at 收舖: the till ended below $0, so the shop folds (no title tonight). */
export function drawFold(bank: number): HTMLElement {
  return h('div', { cls: 'pty-fold', data: { t: 'fold' } }, h('div', { cls: 'pty-stamp miss' }, '執笠'),
    h('p', null, `錢箱收舖時係 ${money(bank)}：交唔起租，間舖要執笠。下一晚再嚟過！`));
}

/** How busy a shop is, as two rows of dots (客流: more dots = more customers; 耐性: fewer dots = less patience). */
export function drawPace(p: ShopPace): HTMLElement {
  const dots = (n: number, label: string, t: string): HTMLElement => h('span', { cls: 'pace', data: { t, n: String(n) } }, label, h('b', null, '●'.repeat(n)), h('i', null, '●'.repeat(5 - n)));
  const flow = Math.max(1, Math.min(5, Math.round(1 + (1.2 - p.gap) / .16))), calm = Math.max(1, Math.min(5, Math.round(1 + (p.pat - .7) / .15)));
  return h('span', { cls: 'pty-pace' }, dots(flow, '客流', 'flow'), dots(calm, '耐性', 'calm'));
}
export interface ShopLook { id: string; name: string; where: string; for: string; pace: ShopPace; rung: number; on: boolean; tip: string | null }
/** One shop on the lobby's ladder: rung number, name, where, who it is for, its pace. */
export function drawShopTile(x: ShopLook, pick: (() => void) | null): HTMLButtonElement {
  return h('button', { cls: 'pty-shop', pressed: x.on, disabled: pick === null, data: { v: x.id }, on: pick ?? undefined },
    h('span', { cls: 'rung' }, String(x.rung)),
    h('span', { cls: 'nm' }, h('b', null, x.name), h('small', null, `${x.where} · ${x.for}`)),
    drawPace(x.pace), x.tip ? h('em', null, x.tip) : null);
}
export const drawShops = (kids: HTMLElement[]): HTMLElement => h('div', { cls: 'pty-shops', data: { t: 'shop' } }, ...kids);

/** The title ladder, lowest at the bottom; the night's title lit. */
export function drawLadder(ix: number): HTMLElement {
  return h('ol', { cls: 'pty-ladder', data: { t: 'ladder' } }, ...TITLES.map((t, i) => h('li', { cls: i === ix ? 'here' : i < ix ? 'lit' : '', data: { rung: String(i) } }, h('span', null, t), i === ix ? h('span', { cls: 'pty-badge dark' }, '今晚') : null)));
}
/** One person's awards at 收舖. */
export function drawPerson(p: CloseCard['people'][number], mine: boolean): HTMLElement {
  return h('article', { cls: 'pty-person' + (mine ? ' mine' : ''), data: { person: p.id } },
    h('h3', null, h('span', null, p.name), h('small', null, `做咗 ${String(p.rounds)} 更`)),
    ...p.awards.map(a => h('div', { cls: 'pty-award', data: { award: a.key } }, h('b', null, a.name), h('span', null, a.why))));
}
export const drawPeople = (kids: HTMLElement[]): HTMLElement => h('div', { cls: 'pty-people', data: { t: 'people' } }, ...kids);
export const drawBig = (t: string, text: string, owe = false): HTMLElement => h('div', { cls: 'pty-big' + (owe ? ' owe' : ''), data: { t } }, text);

// ---------------------------------------------------------------- countdown and toast

/** The countdown's big number on a 招牌 board (filled in place: 3, 2, 1, 開門！). */
export const drawCountdown = (): HTMLElement => h('div', { cls: 'num', data: { timer: 'count' } });
export const drawToast = (): HTMLElement => { const el = h('div', { cls: 'pty-toast', data: { t: 'toast' } }); el.hidden = true; return el; };
