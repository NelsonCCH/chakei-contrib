// mountParty: the one entry the co-op lobby calls to put the party night's between-round screens on a phone
// It draws the night as this player sees it and sends their presses through the seam:
//
//   const ui = mountParty(el, seam, myPlayerId);
//   ...whenever the night changes (a tick, a broadcast): ui.update();
//   ui.destroy();
//
// `seam` needs only `input` and `night`: on the referee's own phone that is the PartySeam itself; on any other phone
// it is a small adapter whose `input` sends the event to the referee and whose `night` returns the last broadcast.
// Refusals that come back ('reject') show as a short toast. The screens decide nothing (screens.ts).
import type { NightState, PartyEvent, PartyOut, PlayerId } from '../../core/party/types';
import { drawMeLine, drawTimerBar, drawToast, drawTopBar, h } from './draw';
import { screenFor } from './screens';
import { PARTY_CSS } from './style';
import { meOf, phaseLimit, rejectText, remaining, seatName } from './view';

export interface PartyLink {
  input(ev: PartyEvent): PartyOut[] | undefined;
  night(): NightState;
}
export interface PartyMount {
  readonly root: HTMLElement;
  /** Re-draws if anything on screen changed (cheap to call every frame: the clock is updated in place). */
  update(): void;
  /** Shows another player's phone (the playtest page's player switcher). */
  setMe(id: PlayerId): void;
  destroy(): void;
}
export interface PartyOpts {
  /** Everything the seam answered to this phone's inputs (the playtest page feeds the referee's part of it). */
  onOut?: (out: PartyOut[]) => void;
}

/** The party unit from the measured width of the element (not the window: half-width and portrait screens). */
export function layoutOf(width: number): { lay: 'narrow' | 'phone' | 'wide'; pu: number } {
  const lay = width < 370 ? 'narrow' : width < 640 ? 'phone' : 'wide';
  const pu = lay === 'wide' ? Math.min(18, Math.max(16, width / 56)) : Math.min(17, Math.max(14, width / 24));
  return { lay, pu: Math.round(pu * 10) / 10 };
}

function injectCss(doc: Document): void {
  if (doc.getElementById('pty-css')) return;
  const st = doc.createElement('style');
  st.id = 'pty-css';
  st.textContent = PARTY_CSS;
  doc.head.append(st);
}

/** Puts the party screens in `el` for player `me`. */
export function mountParty(el: HTMLElement, seam: PartyLink, me: PlayerId, opts: PartyOpts = {}): PartyMount {
  injectCss(el.ownerDocument);
  let id = me, key = '', pressing = false, dirty = false, toastT = 0;
  const root = h('div', { cls: 'pty', data: { me: id } });
  const toast = drawToast();
  el.replaceChildren(root);

  const send = (ev: PartyEvent): void => {
    const out = seam.input(ev) ?? [];
    const no = out.find((o): o is Extract<PartyOut, { k: 'reject' }> => o.k === 'reject');
    if (no) showToast(rejectText(no.why));
    opts.onOut?.(out);
    update();
  };
  function showToast(text: string): void {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastT);
    toastT = window.setTimeout(() => { toast.hidden = true; }, 2400);
  }

  /** What is on screen, without the clock: a re-draw happens only when this changes. */
  const keyOf = (s: NightState): string => JSON.stringify([id, s.phase, s.round, s.cfg, s.host, s.players, s.seats, s.floorOff ?? [], s.bank, s.tokenUsed, s.wager, s.taps, s.climbed, s.history.length, s.nights]);

  function render(s: NightState): void {
    const sc = screenFor(s, id, send), m = meOf(s, id);
    root.dataset['screen'] = sc.id;
    root.dataset['phase'] = s.phase;
    root.dataset['me'] = id;
    root.replaceChildren(
      drawTopBar(sc.where, sc.what, sc.bank),
      drawMeLine(m.p?.name ?? id, m.seat ? seatName(m.seat) : null, m.host),
      drawTimerBar(),
      h('div', { cls: 'pty-body', data: { t: 'body' } }, sc.body),
      h('div', { cls: 'pty-act', data: { t: 'act' } }, ...sc.act),
      toast,
    );
  }
  /** The clock, in place: the bar, the seconds, the countdown's 3-2-1. */
  function clock(s: NightState): void {
    const lim = phaseLimit(s), left = remaining(s);
    const bar = root.querySelector<HTMLElement>('[data-timerbar]');
    if (bar) {
      bar.hidden = lim === null;
      bar.classList.toggle('low', left !== null && left <= 5);
      const fill = bar.firstElementChild;
      if (fill instanceof HTMLElement) fill.style.transform = `scaleX(${lim && left !== null ? String(Math.max(0, Math.min(1, left / lim))) : '0'})`;
    }
    for (const t of root.querySelectorAll<HTMLElement>('[data-timer]')) {
      const secs = left === null ? '' : String(Math.ceil(left - 1e-6));
      t.textContent = t.dataset['timer'] === 'count' ? (left !== null && left > 1e-6 ? secs : '開門！') : secs;
    }
  }
  function update(): void {
    const s = seam.night(), k = keyOf(s);
    if (k !== key) {
      // A press in progress keeps its button: re-draw after the finger lifts (press.test.js's rule for the shop).
      if (pressing) dirty = true;
      else { key = k; render(s); }
    }
    clock(s);
  }
  const down = (): void => { pressing = true; };
  const up = (): void => { pressing = false; if (dirty) { dirty = false; window.setTimeout(update, 0); } };
  root.addEventListener('pointerdown', down);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);

  const fit = (): void => {
    const L = layoutOf(el.clientWidth || window.innerWidth);
    root.dataset['lay'] = L.lay;
    root.style.setProperty('--pu', `${String(L.pu)}px`);
  };
  const ro = new ResizeObserver(fit);
  ro.observe(el);
  fit();
  update();

  return {
    root,
    update,
    setMe(next: PlayerId) { id = next; key = ''; update(); },
    destroy() {
      ro.disconnect();
      clearTimeout(toastT);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      root.remove();
    },
  };
}
