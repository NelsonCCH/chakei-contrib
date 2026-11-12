// Push-to-talk on screen: a radio strip at the bottom of the game column, under the thumb. It takes
// its own row (the station above gives up ~50 px; its canvases follow their ResizeObservers), so it never covers a
// station control. The wide left part is the hold-to-talk button and says who is talking; the right part is the mute
// switch. Builds its own elements and style; the game only hands it the element to append to. In a room's lobby
// that is the lobby's full-screen overlay (any `.overlay`): there the strip is fixed to the bottom edge of the screen
// and the overlay scrolls its content clear of it.
import type { Btn } from './floor';
import type { Mic } from './audio';

export interface PttModel {
  shown: boolean;
  btn: Btn;
  mic: Mic;
  up: boolean;
  muted: boolean;
  /** Who talks now (left: whole seconds of the turn left). */
  holder: { name: string; mine: boolean; left: number } | null;
  /** Who was talking when the room refused us. */
  refusedName: string;
  /** The browser has blocked the site's mic for good: a press shows the picture guide, not a request. */
  blocked: boolean;
}

const CSS = `
.ptt{flex:none;display:flex;gap:8px;align-items:stretch;background:#235648;padding:6px max(16px,env(safe-area-inset-right,0px)) calc(6px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}
.ptt[hidden]{display:none}
.overlay>.ptt{position:fixed;z-index:1;left:0;right:0;bottom:0}
.overlay:has(>.ptt:not([hidden])){padding-bottom:calc(80px + env(safe-area-inset-bottom,0px))}
.ptt-btn{flex:1;min-width:0;height:44px;display:flex;align-items:center;gap:8px;padding:0 12px;border:3px solid #0f1a16;box-shadow:0 3px 0 #0f1a16;background:#fbf6e2;color:#0f1a16;font:inherit;text-align:left;cursor:pointer;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.ptt-btn i{flex:none;width:10px;height:10px;border-radius:50%;background:#c9c2a6;border:2px solid #0f1a16}
.ptt-btn b{font-size:15px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ptt-btn small{margin-left:auto;font-size:11px;font-weight:700;white-space:nowrap;opacity:.8}
.ptt-btn[data-st="talking"]{background:#c8323c;color:#fff;transform:translateY(2px);box-shadow:0 1px 0 #0f1a16}
.ptt-btn[data-st="talking"] i,.ptt-btn[data-st="other"] i{background:#ff5a5a;animation:pttDot .7s ease-in-out infinite alternate}
.ptt-btn[data-st="asking"]{background:#ffd25a}
.ptt-btn[data-st="other"],.ptt-btn[data-st="busy"]{background:#0f1a16;color:#fbf6e2}
.ptt-btn[data-st="slow"],.ptt-btn[data-st="limit"],.ptt-btn[data-st="lost"],.ptt-btn[data-st="link"],.ptt-btn[data-st="off"]{background:#58695f;color:#f4efd9}
.ptt-btn[data-st="nomic"]{background:#d9d2b8;color:#58695f}
.ptt-mute{flex:none;width:58px;height:44px;border:3px solid #0f1a16;box-shadow:0 3px 0 #0f1a16;background:#fbf6e2;color:#0f1a16;font:inherit;font-size:13px;font-weight:900;padding:0;cursor:pointer;touch-action:manipulation}
.ptt-mute[aria-pressed="true"]{background:#58695f;color:#f4efd9}
@keyframes pttDot{from{opacity:.35}to{opacity:1}}
.ptt-pop{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(20,32,27,.45);padding:16px}
.ptt-pop[hidden]{display:none}
.ptt-pop div{box-sizing:border-box;width:min(340px,100%);background:#fbf6e2;color:#0f1a16;border:3px solid #0f1a16;box-shadow:0 5px 0 #0f1a16;padding:16px;font-size:15px;line-height:1.55}
.ptt-pop b{display:block;font-size:17px;margin-bottom:6px}
.ptt-pop p{margin:0 0 6px}
.ptt-pop button{margin-top:8px;width:100%;font:inherit;font-weight:900;font-size:16px;padding:8px;border:2px solid #0f1a16;background:#235648;color:#fbf6e2;cursor:pointer}
`;

/** The strip's state and its two texts (main, and the small one on the right). */
function labels(m: PttModel): { st: string; big: string; small: string } {
  const h = m.holder;
  if (m.btn === 'talking') return { st: 'talking', big: '你講緊……', small: `剩 ${String(h ? h.left : 0)} 秒` };
  if (m.btn === 'asking') return { st: 'asking', big: m.mic === 'asking' ? '撳「允許」開咪' : '攞緊台……', small: '' };
  if (m.btn === 'busy') return { st: 'busy', big: `${m.refusedName || '佢'}講緊，等等`, small: '佢放手你就講得' };
  if (m.btn === 'slow') return { st: 'slow', big: '撳得太密', small: '停一停再撳' };
  if (m.btn === 'limit') return { st: 'limit', big: '夠鐘！', small: '放手再撳先講得' };
  if (m.btn === 'lost') return { st: 'lost', big: '冇咗台', small: '放手再撳' };
  if (m.btn === 'link') return { st: 'link', big: '斷咗線', small: '駁緊返' };
  if (!m.up) return { st: 'off', big: '斷咗線，駁緊返', small: '' };
  if (h && !h.mine) return { st: 'other', big: `${h.name}講緊${m.muted ? '（你靜咗音）' : '……'}`, small: '' };
  if (m.blocked) return { st: 'nomic', big: '瀏覽器封咗個咪', small: '撳我睇點開' };
  if (m.mic === 'denied') return { st: 'nomic', big: '冇開到咪', small: '再撳會再問' };
  if (m.mic === 'error') return { st: 'nomic', big: '咪高峰用唔到', small: '再撳試過' };
  if (m.mic === 'unsupported') return { st: 'nomic', big: '呢部機淨係聽得', small: '' };
  return { st: 'idle', big: '撳住講嘢', small: '對講機' };
}

/** The pop-up text for a mic that could not be opened (a block for good gets the picture guide instead). */
export function micHelp(mic: Mic): [title: string, ...lines: string[]] {
  if (mic === 'unsupported') return ['呢部機講唔到嘢', '搵唔到咪高峰，或者個瀏覽器唔支援。朋友講嘢你照聽到。'];
  return ['咪高峰用唔到', '可能講緊電話或者另一個 app 用緊咪。收咗線再撳過。'];
}

export class PttUi {
  readonly root: HTMLDivElement;
  readonly btn: HTMLButtonElement;
  readonly mute: HTMLButtonElement;
  readonly pop: HTMLDivElement;
  private last = '';
  /** Forget the pressing pointer (the turn was given back without a pointer event: page hidden, mic refused). */
  readonly forget: () => void;

  constructor(on: { press: () => void; release: () => void; mute: () => void }) {
    if (!document.getElementById('pttCss')) {
      const s = document.createElement('style');
      s.id = 'pttCss'; s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.root = document.createElement('div');
    this.root.className = 'ptt'; this.root.id = 'ptt'; this.root.hidden = true;
    this.btn = document.createElement('button');
    this.btn.type = 'button'; this.btn.className = 'ptt-btn'; this.btn.id = 'pttBtn';
    this.btn.setAttribute('aria-live', 'polite');
    this.mute = document.createElement('button');
    this.mute.type = 'button'; this.mute.className = 'ptt-mute'; this.mute.id = 'pttMute';
    this.root.append(this.btn, this.mute);
    this.pop = document.createElement('div');
    this.pop.className = 'ptt-pop'; this.pop.id = 'pttPop'; this.pop.hidden = true; this.pop.setAttribute('role', 'dialog');
    document.body.append(this.pop);

    // The finger: down takes the floor, every way it can leave gives it back. Only the pointer that pressed counts, so a
    // second finger working the station does not end the turn.
    let pid: number | null = null;
    this.forget = () => { pid = null; };
    this.btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (pid !== null) return;
      pid = e.pointerId;
      try { this.btn.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      on.press();
    });
    const up = (e: PointerEvent): void => { if (e.pointerId !== pid) return; pid = null; on.release(); };
    this.btn.addEventListener('pointerup', up);
    this.btn.addEventListener('pointercancel', up);
    this.btn.addEventListener('lostpointercapture', up);
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', up, true);
    this.btn.addEventListener('contextmenu', e => { e.preventDefault(); });
    // keyboard: hold Space or Enter on the focused button
    this.btn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && pid === null) { e.preventDefault(); pid = -1; on.press(); } });
    this.btn.addEventListener('keyup', e => { if ((e.key === ' ' || e.key === 'Enter') && pid === -1) { e.preventDefault(); pid = null; on.release(); } });
    this.btn.addEventListener('blur', () => { if (pid === -1) { pid = null; on.release(); } });
    this.mute.addEventListener('click', () => { on.mute(); });
    this.pop.addEventListener('click', e => { if (e.target === this.pop || (e.target instanceof HTMLElement && e.target.id === 'pttPopOk')) this.pop.hidden = true; });
  }

  /** Puts the strip at the end of `parent` (the game column), once. */
  mount(parent: HTMLElement): void { if (this.root.parentElement !== parent) parent.appendChild(this.root); }

  render(m: PttModel): void {
    const l = labels(m);
    const key = [m.shown, l.st, l.big, l.small, m.muted].join('|');
    if (key === this.last) return;
    this.last = key;
    this.root.hidden = !m.shown;
    this.btn.dataset.st = l.st;
    this.btn.setAttribute('aria-label', `對講機：${l.big}${l.small ? '，' + l.small : ''}`);
    this.btn.replaceChildren(document.createElement('i'), Object.assign(document.createElement('b'), { textContent: l.big }),
      ...(l.small ? [Object.assign(document.createElement('small'), { textContent: l.small })] : []));
    this.mute.textContent = m.muted ? '靜音' : '有聲';
    this.mute.setAttribute('aria-pressed', String(m.muted));
    this.mute.setAttribute('aria-label', m.muted ? '對講機靜咗音，撳嚟開返' : '對講機有聲，撳嚟靜音');
  }

  popup(title: string, lines: string[]): void {
    const card = document.createElement('div');
    card.append(Object.assign(document.createElement('b'), { textContent: title }), ...lines.map(t => Object.assign(document.createElement('p'), { textContent: t })),
      Object.assign(document.createElement('button'), { type: 'button', id: 'pttPopOk', textContent: '知道' }));
    this.pop.replaceChildren(card);
    this.pop.hidden = false;
  }
}
