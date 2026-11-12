// The lobby's one-line mic row. The tap that creates or joins a room makes the real request
// (net.ts calls pttAskMic inside it), so most players never see more than the browser's own prompt and a short
// confirmation. One element, kept across the lobby's re-renders (the lobby appends it after each one). Modes:
//   tap      the room came back by itself (a reload): no tap has asked yet; one button (any tap in the lobby asks too)
//   asking   the browser's prompt is up;  ok: just granted (a short confirmation)
//   denied   the player said no this time: the next talk press asks again (a line, no button)
//   blocked  the browser has blocked the site for good: a line and 點開？ (the picture guide)
//   none     no mic on this device;  error: in use elsewhere, 再試;  hidden: granted, or nothing to say
import { micBlocked, micGranted, micRequest, micSupported, onMicPermit } from './permit';
import { showPermitGuide } from '../permit/guide';

type Mode = 'tap' | 'asking' | 'ok' | 'denied' | 'blocked' | 'none' | 'error' | 'hidden';

const CSS = `
.miccard{background:#fbf6e2;color:#0f1a16;border:3px solid #0f1a16;box-shadow:0 3px 0 #0f1a16;padding:6px 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.miccard[hidden]{display:none}
.miccard span{flex:1;min-width:8em;font-size:14px;font-weight:700}
.miccard button{font:inherit;font-weight:900;font-size:14px;padding:6px 12px;border:2px solid #0f1a16;box-shadow:0 3px 0 #0f1a16;background:#c8323c;color:#fff;cursor:pointer}
.miccard[data-mode="ok"]{background:#d6ead8}
.miccard[data-mode="blocked"],.miccard[data-mode="none"],.miccard[data-mode="denied"]{background:#e9e2c8}
`;

export class MicCard {
  readonly el: HTMLDivElement;
  private last = '';
  private asking = false;
  /** this room visit: a tap has asked already; the last answer ('' = none yet) */
  private asked = false;
  private result: '' | 'ok' | 'denied' | 'error' = '';

  constructor() {
    if (!document.getElementById('micCardCss')) {
      const s = document.createElement('style');
      s.id = 'micCardCss'; s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.el = document.createElement('div');
    this.el.className = 'miccard'; this.el.id = 'micCard'; this.el.hidden = true;
    this.el.setAttribute('aria-live', 'polite');
    this.el.addEventListener('click', e => {
      const b = e.target instanceof Element ? e.target.closest('button') : null;
      if (!b) return;
      e.stopPropagation();   // the lobby's own click handler has nothing to do with these buttons
      if (b.id === 'micAsk') this.ask(true);
      else if (b.id === 'micHow') showPermitGuide('mic');
    });
    onMicPermit(() => { this.render(); });
  }

  /** A new room visit: nothing asked yet. */
  reset(): void { this.asked = false; this.result = ''; this.render(); }

  /**
   * The real request, inside a tap's handler (iOS prompts only from a gesture). Once per room visit unless `again` (the
   * row's own button). Blocked for good: the picture guide instead of a request that would fail again.
   */
  ask(again = false): void {
    if (this.asking || micGranted() || (this.asked && !again)) { this.render(); return; }
    this.asked = true;
    if (!micSupported()) { this.render(); return; }
    if (micBlocked()) { this.render(); showPermitGuide('mic'); return; }
    this.asking = true; this.result = '';
    const p = micRequest();
    this.render();
    void p.then(r => {
      this.asking = false;
      this.result = r === 'granted' ? 'ok' : r === 'denied' ? 'denied' : r === 'error' ? 'error' : '';
      this.render();
      if (r === 'blocked') showPermitGuide('mic');
    });
  }

  private pick(): Mode {
    if (this.asking) return 'asking';
    if (this.result === 'ok') return 'ok';
    if (!micSupported()) return 'none';
    if (micGranted()) return 'hidden';
    if (micBlocked()) return 'blocked';
    if (this.result === 'denied') return 'denied';
    if (this.result === 'error') return 'error';
    return this.asked ? 'hidden' : 'tap';
  }

  render(): void {
    const m = this.pick();
    if (m === this.last) return;
    this.last = m;
    this.el.dataset.mode = m;
    this.el.hidden = m === 'hidden';
    const line = (s: string): HTMLSpanElement => Object.assign(document.createElement('span'), { textContent: s });
    const btn = (id: string, s: string): HTMLButtonElement => Object.assign(document.createElement('button'), { type: 'button', id, textContent: s });
    if (m === 'tap') this.el.replaceChildren(line('對講機要用咪'), btn('micAsk', '開咪'));
    else if (m === 'asking') this.el.replaceChildren(line('撳「允許」開咪……'));
    else if (m === 'ok') this.el.replaceChildren(line('咪開咗：開工撳住底部個掣講嘢'));
    else if (m === 'denied') this.el.replaceChildren(line('冇開咪：開工撳住對講機會再問'));
    else if (m === 'blocked') this.el.replaceChildren(line('瀏覽器封咗個咪：開工淨係聽得'), btn('micHow', '點開？'));
    else if (m === 'error') this.el.replaceChildren(line('咪高峰用唔到（可能另一個 app 用緊）'), btn('micAsk', '再試'));
    else if (m === 'none') this.el.replaceChildren(line('呢部機冇得用咪：開工淨係聽得'));
    else this.el.replaceChildren();
  }
}
