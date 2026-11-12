// 輪流做／一腳踢：一個人做晒成間舖。輪流做：每 45 秒自動轉位，四個位都做一轉；
// 一腳踢：上面一排位，邊度多嘢做就撳去邊，你唔喺嗰個位電腦幫手頂住。The rules of a hand-over are core's (core/career/solo.ts);
// this module draws the tab bar with each station's load, switches the screen, and runs the 輪流做 clock.
import './wire';   // load order: src/entry.ts
import { $ } from './prefs';
import { must, ownKey } from '../core/util';
import { G, liveG, station } from '../core/state';
import { STATIONS } from '../core/data/menus';
import { switchStation, rotateDue, rotateLeft, stationLoad, SOLO_ORDER, type SoloMode } from '../core/career/solo';
import { SHOP } from './decor';
import { setDrawn, toast } from './ui';
import { closePop } from './kitchen';
import { iconImg } from './icons';
import { NET } from '../net/net';
import { showStation } from './main';

export const SOLO_NAME: Record<SoloMode, { name: string; desc: string }> = {
  one: { name: '一個位', desc: '淨係做揀咗嗰個位' },
  rotate: { name: '輪流做', desc: '每 45 秒轉位，四個位都做' },
  all: { name: '一腳踢', desc: '自己揀轉位，電腦頂其餘' },
};
/** The solo mode saved on the pre-shift screen ('one' for anything unknown, e.g. an old save). */
export const soloMode = (): SoloMode => SHOP.solo === 'rotate' || SHOP.solo === 'all' ? SHOP.solo : 'one';
/** The solo modes run in the player's own shop only: not in the tutorial, a level, the daily challenge or co-op. */
export const soloAllowed = (): boolean => { const S = liveG(); return !S.tut && !S.level && !S.daily && !S.coop && !NET.role; };

const bar = (): HTMLElement => must($('soloTabs'), 'soloTabs');
let drawnKey = '';
/** At the start of a shift (ui/main.ts start): a solo shift gets its tab bar, any other hides it. */
export function soloBegin(): void {
  const S = liveG(), m = soloMode();
  // a new seat is always one seat
  if (m !== 'one' && soloAllowed() && !S.xseat){ S.solo = m; S.soloFrom = ownKey(STATIONS, S.station) ? S.station : station; }
  drawnKey = ''; bar().hidden = !S.solo; soloFrame();
}
/** The player moves to station `st` (a tab, or the 輪流做 clock). */
export function soloGo(st: StationId, why?: string): void {
  if (!G || !G.solo || !G.running || !switchStation(st)) return;
  closePop(); showStation(st); setDrawn(0); drawnKey = ''; soloFrame();
  toast(why || `轉去${STATIONS[st].name}`);
}
/** Every frame (ui/main.ts loop): the 輪流做 clock, then the tabs when anything on them changed. */
export function soloFrame(): void {
  if (!G || !G.solo){ if (!bar().hidden) bar().hidden = true; return; }
  if (!G.running){ bar().hidden = true; return; }
  const S = G;
  if (S.solo === 'rotate' && S.soloFrom){
    const due = rotateDue(S.soloFrom, S.t);
    if (due !== S.station) soloGo(due, `輪更！轉去${STATIONS[due].name}`);
  }
  const loads = SOLO_ORDER.map(st => ({ st, ...stationLoad(st) })), left = Math.ceil(rotateLeft(S.t));
  const key = loads.map(l => `${l.st}${String(l.n)}${l.hot ? 'h' : ''}`).join() + S.station + (S.solo === 'rotate' ? String(left) : '');
  if (key === drawnKey) return;
  drawnKey = key;
  const next = S.solo === 'rotate' && S.soloFrom ? rotateDue(S.soloFrom, S.t + rotateLeft(S.t) + .01) : null;
  bar().innerHTML = loads.map(l => {
    const on = l.st === S.station, lock = S.solo === 'rotate';
    return `<button type="button" data-solo="${l.st}" aria-pressed="${String(on)}"${lock && !on ? ' disabled' : ''} class="${l.hot ? 'hot' : ''}">`
      + `${iconImg('ui', l.st)}<b>${STATIONS[l.st].name}</b>${l.n ? `<i class="badge" aria-label="${String(l.n)} 樣等緊">${String(l.n)}</i>` : ''}`
      + `${on ? '' : '<small>電腦頂住</small>'}</button>`;
  }).join('') + (next ? `<span class="rotnext">${String(left)} 秒後轉去${STATIONS[next].name}</span>` : '');
}
must($('soloTabs'), 'soloTabs').addEventListener('click', e => {
  const b = e.target instanceof Element ? e.target.closest('button[data-solo]') : null;
  if (!(b instanceof HTMLButtonElement) || b.disabled || !G || G.solo !== 'all') return;
  const st = b.dataset.solo ?? '';
  if (ownKey(STATIONS, st)) soloGo(st);
});
