// 樓面 floor seats on the game page. A floor player plays the waiter's screens; over them, the job
// bar (#floorJobs) shows the floor's open bubbles a player picks up by hand: 傳菜 (a table's dishes at the pass), 執枱
// (a dirty table), 打包 (a bag ready to pack) and 送外賣 (a bag at the door). A tap claims the bubble (hidden at once,
// back if a teammate was first) and opens its mini-game (site/stations/<kind>.html?seat in #floorGame), fed with that
// one task by core/coop/plugins/floor.ts; 返樓面 lets it go. A bubble a teammate takes leaves this bar on the next tick.
// With the shop map on the open work is drawn on the map instead (ui/floor-map.ts: one
// counted bubble per station, 執 on the table), and this bar keeps only the current job and 返樓面.
import './seat';   // load order: src/entry.ts
import { mountStationFrame } from './seat';
import { must } from '../core/util';
import { G, liveG } from '../core/state';
import { toast } from '../core/fx';
import { $ } from './prefs';
import { stationOf } from '../core/coop/registry';
import { seatCommand } from '../core/coop/plugins/kit';
import { phone, noteInput, takeLost } from '../core/coop/phone';
import { isReferee } from '../core/coop/referee';
import { floorJob, floorJobStart, floorJobEnd, gameOf, type FloorGame } from '../core/coop/plugins/floor';
import { mapOn } from './floor-iso';
import { clearGameNow } from '../core/work/floor';

const GAME_NAME: Readonly<Record<FloorGame, string>> = { runner: '傳菜', takeaway: '打包', clear: '執枱', deliver: '送外賣' };
const num = (id: string): number => Number(id.slice(id.indexOf(':') + 1));

/** Does this phone play a floor seat in the shift now? */
export const onFloor = (): boolean => !!G && !!G.floor && G.running && G.roles.floor === 'me';

/** One bubble's label: what and where. */
function label(id: string): string {
  const S = liveG(), n = num(id), game = gameOf(id);
  if (!game) return id;
  if (game === 'runner') return `${GAME_NAME[game]} ${String(n)}號枱`;
  if (game === 'clear') return `${GAME_NAME[game]} ${String(n + 1)}號枱`;
  const no = S.floor?.out.find(o => o.gid === n)?.no ?? S.groups.find(g => g.id === n)?.no ?? n;
  return `${GAME_NAME[game]} #${String(no)}`;
}
/** The current job's label: one item as above, a station batch as its count. */
function jobLabel(ids: readonly string[]): string {
  const first = ids[0] ?? '', game = gameOf(first);
  if (ids.length < 2 || !game) return label(first);
  if (game === 'runner') return `${GAME_NAME[game]} ${ids.map(id => String(num(id))).join('、')}號枱`;
  return `${GAME_NAME[game]} ×${String(ids.length)}`;
}

// The host object the job's station page reads (seat-link.ts SeatHost), on window only while a job shows.
const mineNow = (k: string): boolean => !!G && G.running && !G.paused && floorJob()?.game === k;
const FLOOR_HOST = {
  state: (k: string): unknown => G && (k === 'runner' || k === 'takeaway' || k === 'clear' || k === 'deliver') ? stationOf(k)?.pick(liveG()) ?? null : null,
  send(k: string, c: unknown, t?: number): void { if (mineNow(k) && seatCommand(k, c, t) && phone() && !isReferee()) noteInput('waiter'); },
  mine: mineNow,
};

function els(): { bar: HTMLElement; game: HTMLElement } {
  let bar = $('floorJobs'), game = $('floorGame');
  if (!bar){
    bar = document.createElement('div'); bar.id = 'floorJobs'; bar.className = 'floorjobs'; bar.hidden = true;
    bar.setAttribute('aria-label', '樓面工作');
    must($('xStrip'), 'xStrip').after(bar);
    bar.addEventListener('click', e => {
      if (e.target instanceof Element && e.target.closest('#floorBack')){ floorJobEnd(); return; }
      const b = e.target instanceof Element ? e.target.closest('button[data-task]') : null;
      const id = b instanceof HTMLElement ? b.dataset.task : undefined;
      // no motion ask here (mid-play); the level's start tap or the lobby asked (main.ts, net.ts)
      if (id) floorJobStart(id);
    });
  }
  if (!game){
    game = document.createElement('div'); game.id = 'floorGame'; game.className = 'seatview floorgame'; game.hidden = true;
    must($('seatView'), 'seatView').after(game);
  }
  return { bar, game };
}

let barKey = '', shown = '';   // shown: the job page's key ('runner#3'), '' none
/** Every frame (net.ts netFrame, main.ts's solo seat): the job bar, the job's mini-game, refused claims. */
export function floorFrame(): void {
  const on = onFloor();
  if (!on && !barKey && !shown) return;
  const { bar, game } = els();
  const lost = takeLost();
  if (lost.length) toast(`隊友搶先咗：${lost.length > 1 ? jobLabel(lost) : label(lost[0] ?? '')}`);
  const j = on ? floorJob() : null;
  // the bar: the open bubbles (and the one this player is on)
  let key = '';
  if (on && G?.floor){
    const parts: string[] = [];
    const open = G.floor.tasks.filter(x => x.by === null), door = open.filter(x => x.k === 'seat').length, slips = open.filter(x => x.k === 'order').length;
    if (door || slips) parts.push(`<span class="fjhint">${door ? `門口 ${String(door)} 班` : ''}${door && slips ? '・' : ''}${slips ? `落單 ${String(slips)} 枱` : ''}</span>`);
    // 返樓面 lets the job go (not out on the road: the run ends at the shop)
    if (j && j.game !== 'deliver') parts.push('<button type="button" class="fjback" id="floorBack">返樓面</button>');
    if (j) parts.push(`<button type="button" class="fj on ${j.game}" data-task="${j.id}" aria-pressed="true">${jobLabel(j.ids)}</button>`);
    // with the shop map on, the open work is its bubbles on the map; the bar is the fallback
    // (a dirty table is a 執枱 bubble only once 執枱 has joined the floor; before, the table's own one-tap clean)
    if (!mapOn()) for (const x of open) if (gameOf(x.id) && (x.k !== 'clear' || clearGameNow()) && !j?.ids.includes(x.id)) parts.push(`<button type="button" class="fj ${gameOf(x.id) ?? ''}" data-task="${x.id}">${label(x.id)}</button>`);
    key = parts.join('');
  }
  if (key !== barKey){ barKey = key; bar.innerHTML = key; bar.hidden = !key; }
  // the job's mini-game over the waiter's screens
  // one page per job (keyed by the job's serial, so a new tap is a fresh page),
  // and none without a job; the floor and the door stay hidden under it whoever re-showed them (showStation, clientBegin)
  const want: FloorGame | '' = j ? j.game : '', wantKey = j ? `${j.game}#${String(j.n)}` : '';
  if (wantKey !== shown){
    shown = wantKey;
    game.querySelector('iframe')?.remove();
    for (const el of ['floorWrap', 'doorWrap']) must($(el), el).hidden = !!want;
    if (want){
      Reflect.set(window, '__chakeiSeat', FLOOR_HOST);
      mountStationFrame(game, 'floorFrame', GAME_NAME[want], `stations/${want}.html?seat`);
    } else if (Reflect.get(window, '__chakeiSeat') === FLOOR_HOST) Reflect.deleteProperty(window, '__chakeiSeat');
    game.hidden = !want; game.dataset.kind = want;
  } else if (want) for (const el of ['floorWrap', 'doorWrap']){ const e = must($(el), el); if (!e.hidden) e.hidden = true; }
}
/**
 * A new shift on this page (main.ts start): no job bar and no job page left from the last shift.
 * A shift left while a job showed (唔做喇 mid-run) stops the solo referee, which also stops floorFrame, so the
 * old 送外賣 page and its 「送外賣 ×2」 button stayed in the page and showed under the next shift's floor.
 */
export function floorReset(): void {
  const bar = $('floorJobs'), game = $('floorGame');
  game?.querySelector('iframe')?.remove();
  if (game){ game.hidden = true; game.dataset.kind = ''; }
  if (bar){ bar.innerHTML = ''; bar.hidden = true; }
  if (Reflect.get(window, '__chakeiSeat') === FLOOR_HOST) Reflect.deleteProperty(window, '__chakeiSeat');
  barKey = ''; shown = '';
}
