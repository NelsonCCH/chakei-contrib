// The extra seats on the game page: 傳菜 runner, 燒味 roast and 外賣 takeaway. The station
// runs here (core/coop/plugins/<kind>.ts, stepped by coopStep while this phone holds the seat); its screen is the
// station's own page (site/stations/<kind>.html?seat) in an iframe of #seatView, which draws the state this page hands
// it and sends the player's taps back (src/stations-next/seat-link.ts). While the computer covers the seat a button
// over the screen takes it back. #xStrip shows every phone in a room with extras how full the pass is and how many
// clean cups and plates are left, which is what slows the bar and the kitchen.
import './outfit';   // load order: src/entry.ts
import { must, ownKey } from '../core/util';
import { G, liveG } from '../core/state';
import { $ } from './prefs';
import { stationOf } from '../core/coop/registry';
import { seatCommand } from '../core/coop/plugins/kit';
import { noteInput, claim, phone } from '../core/coop/phone';
import { isReferee, referee, setDriver } from '../core/coop/referee';
import { isExtraKind, extrasView } from '../core/referee/extras';
import { isFloorTask } from '../core/work/roles';
import { STATIONS } from '../core/data/menus';
import { PT } from '../core/playtest/hook';

export const SEAT_NAMES: Readonly<Record<ExtraKind, string>> = { runner: '傳菜', roast: '燒味', takeaway: '外賣' };

/** Does this phone drive extra seat `k` now (a shift running, not paused)? */
const mine = (k: string): boolean => isExtraKind(k) && !!G && G.running && !G.paused && G.roles[k] === 'me';
// The host object the seat's page reads (seat-link.ts SeatHost): state, commands (checked by the plugin), whose seat.
// It is on window, and the iframe exists, only while a seat is shown: the page adds nothing global otherwise.
const SEAT_HOST = {
  state: (k: string): unknown => isExtraKind(k) && G ? stationOf(k)?.pick(liveG()) ?? null : null,
  send(k: string, c: unknown, t?: number): void {
    if (!mine(k)) return;
    // PLAYTEST LOG: on the preview the timing log watches each command (core/playtest/hook.ts); else unchanged
    const run = (): boolean => seatCommand(k, c, t), ok = PT.seat ? PT.seat(k, c, run) : run();
    if (ok && phone() && !isReferee()) noteInput(k);
  },
  mine,
};

/**
 * A station page's iframe for a seat or a floor job, put first in `box`. It stays
 * transparent and untouchable until the page has run and drawn: a fresh iframe first paints its HTML as written (the
 * standalone page's start card: the "lesson card" flash) and then whatever its first state read gives, so it shows
 * only after its load event and two more frames (the page's own rAF loop runs in the same rendering steps as this
 * page's, so by then it has drawn its first frame). Until then the box shows its plain wall. `data-ready`: shown.
 */
export function mountStationFrame(box: HTMLElement, id: string, title: string, src: string): HTMLIFrameElement {
  const f = document.createElement('iframe');
  f.id = id; f.title = title; f.className = 'stloading';
  f.addEventListener('load', () => { requestAnimationFrame(() => { requestAnimationFrame(() => { f.classList.remove('stloading'); f.dataset.ready = '1'; }); }); }, { once: true });
  f.src = src;
  box.prepend(f);
  return f;
}

let shown: ExtraKind | '' = '', me = '';
/** Shows extra seat `k`'s screen in place of the shop stations' ('' hides it). `id`: this phone's player id. */
export function showSeat(k: ExtraKind | '', id = me): void {
  me = id;
  const v = must($('seatView'), 'seatView'), old = $('seatFrame');
  if (k){
    for (const el of ['floorWrap', 'doorWrap', 'till', 'pad', 'barView', 'barPad', 'kitView', 'kitPad']) must($(el), el).hidden = true;
    Reflect.set(window, '__chakeiSeat', SEAT_HOST);
    if (shown !== k || !old){
      old?.remove();
      mountStationFrame(v, 'seatFrame', '你個位', `stations/${k}.html?seat`);
    }
  } else { old?.remove(); Reflect.deleteProperty(window, '__chakeiSeat'); }
  shown = k; v.hidden = !k; v.dataset.kind = k;
  seatFrame();
}
/** Every frame in a room: the cover button over a seat the computer drives, and the pass / clean stock strip. */
export function seatFrame(): void {
  const b = $('seatCover');
  if (b) {
    const role = shown && G && G.running ? G.roles[shown] : undefined;
    b.hidden = role === undefined || role === 'me';
    b.textContent = role === 'ai' ? '電腦代班中 — 撳一下接返' : '隊友做緊呢個位';
    b.classList.toggle('off', role !== 'ai');
  }
  drawExtrasStrip();
}
/** Takes extra seat `shown` back from the computer (the cover button). */
function reclaim(): void {
  if (!shown || !G || G.roles[shown] !== 'ai') return;
  if (isReferee()){ if (referee()) setDriver(shown, { type: 'player', player: me }, 'claim'); }
  else if (phone()) claim(shown);
}
must($('seatCover'), 'seatCover').addEventListener('click', reclaim);

let stripKey = '';
/** Does this phone offer the seat switch buttons in a room (net.ts: the owner's phone)? Solo seats always do. */
let switcher = (): boolean => false;
export function setSeatSwitcher(f: () => boolean): void { switcher = f; }
/** The 樓面 floor seats of this shift (floor1..n stand for 伙記, 傳菜 and 外賣 on a level with those roles). */
const floorIds = (): string[] => G ? Object.keys(G.roles).filter(k => /^floor\d+$/.test(k)) : [];
const roleOf = (k: string): unknown => G ? Reflect.get(G.roles, k) : undefined;
/** The seat this phone drives now: the extra seat shown, its floor seat, or its shop station ('' none). */
export function seatIdNow(): string {
  if (shown) return shown;
  const f = floorIds().find(k => roleOf(k) === 'me'); if (f) return f;
  return G && ownKey(STATIONS, G.station) && roleOf(G.station) === 'me' ? G.station : '';
}
/** Where 返做 takes this phone: on a 樓面 level a floor seat the computer runs, else its own station when the
 *  computer runs it; null when there is none to take (a teammate holds it). */
export function homeSeat(): string | null {
  if (!G) return null;
  // the floor only for a player whose seat is 樓面 (a floor level runs the floor under any seat)
  if (G.floor && (G.station === 'waiter' || !ownKey(STATIONS, G.station))) return floorIds().find(k => roleOf(k) === 'ai') ?? null;
  return ownKey(STATIONS, G.station) && roleOf(G.station) === 'ai' ? G.station : null;
}
/** What the strip calls this phone's seat: 樓面 for a floor seat, the shop station or the extra seat ('' none). */
export const mySeatNow = (): string => { const s = seatIdNow(); return /^floor\d+$/.test(s) ? 'floor' : s; };
/** The name of a seat as the strip and its toasts say it (a floor seat, and 伙記's, is 樓面). */
export const seatLabel = (k: string): string => isExtraKind(k) ? SEAT_NAMES[k] : k === 'floor' || k === 'waiter' || /^floor\d+$/.test(k) ? '樓面' : ownKey(STATIONS, k) ? STATIONS[k].name : k;
/**
 * One role on the strip: roles only, 樓面, the shop's three and the roles of their own
 * (燒味 ...), never a 樓面 task (傳菜, 外賣, 送外賣, 執枱 are entered from the map's bubbles). `n`: the players on it (* up to two on 樓面 in a party room); `mine`: this phone's; `sw`: what a press on it does ('' 返做 this phone's home seat,
 * a seat id 換做 there, null nothing).
 */
export interface StripRole { role: string; label: string; n: number; mine: boolean; sw: string | null }
const held = (k: string): number => { const r = roleOf(k); return r === 'me' || r === 'remote' ? 1 : 0; };
/** The strip's roles now: this phone's role, then those it may move to (the host's phone or a solo referee). */
export function stripRoles(): StripRole[] {
  if (!G || !G.running) return [];
  const out: StripRole[] = [], at = mySeatNow();
  if (at){
    const floor = at === 'floor' || at === 'waiter', n = floor && G.floor ? floorIds().reduce((a, k) => a + held(k), 0) : 1;
    out.push({ role: floor ? 'floor' : at, label: seatLabel(at), n: Math.max(1, n), mine: true, sw: null });
  }
  if (isReferee() || switcher()){
    // every role of its own the computer runs (the level's, a room's 加位, any on the preview's all-roles switch)
    for (const k of G.extra ?? []) if (!isFloorTask(k) && k !== shown && roleOf(k) === 'ai') out.push({ role: k, label: SEAT_NAMES[k], n: 0, mine: false, sw: k });
    const home = shown ? homeSeat() : null;
    if (home) out.push({ role: /^floor\d+$/.test(home) ? 'floor' : home, label: seatLabel(home), n: 0, mine: false, sw: '' });
  }
  return out;
}
/**
 * The strip under the HUD in a room with extra seats: which seat this phone holds and 出餐口 n/6 (the clean
 * racks are not on the strip: they gate no station); on the host's phone, a button to move to an extra seat the computer runs, and from there back to its station.
 */
export function drawExtrasStrip(): void {
  const el = $('xStrip'); if (!el) return;
  // a 樓面 shift without extra stations (屋邨) still says whose seat this is: 你做樓面
  const x = G && G.running && (G.extra || G.floor) ? extrasView() : null;
  const parts: string[] = [], rs = x ? stripRoles() : [];
  // roles only; two on 樓面 read ×2
  for (const r of rs) if (r.mine) parts.push(`<b class="you">你做${r.label}${r.n > 1 ? ` ×${String(r.n)}` : ''}</b>`);
  if (x && x.pass !== null) parts.push(`<b class="${x.pass >= x.cap ? 'full' : ''}">出餐口 ${String(x.pass)}/${String(x.cap)}</b>`);
  for (const r of rs) if (r.sw !== null) parts.push(`<button type="button" data-sw="${r.sw}">${r.sw ? '換做' : '返做'}${r.label}</button>`);
  const key = parts.join('');
  if (key === stripKey) return;
  stripKey = key; el.innerHTML = key; el.hidden = !key;
}
