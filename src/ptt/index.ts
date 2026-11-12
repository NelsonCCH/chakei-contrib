// Push-to-talk walkie-talkie channel for co-op rooms. The narrow seam to the rest of the game:
//   pttBind(link, hud)  when a room's transport is wired (src/net.ts wireTransport); pttUnbind() when leaving it;
//   pttIn(msg | frame)  every floor / floorNo message and binary audio frame the room sends;
//   pttLink(up)         the link went up or down.
// The room Durable Object owns the floor (worker/index.ts); floor.ts is this phone's side of it, audio.ts the sound,
// ui.ts the button. Nothing here imports the game, so it does not depend on how the shop is split between core and page.
import { FloorClient, type Fx, type Btn } from './floor';
import { PttAudio, AUDIO_STATS, type Mic } from './audio';
import { PttUi, micHelp } from './ui';
import { micBlocked, micOutcome, onMicPermit } from './permit';
import { MicCard } from './card';
import { roomAudioSession, setPttVoice } from './sfx';
import { showPermitGuide, hidePermitGuide } from '../permit/guide';

const TICK_MS = 200;
const MUTE_KEY = 'ckf-ptt-mute';

/** What the tests read (src/test-surface.ts puts it on window): the floor as this phone sees it, and the counters. */
export const PTT: {
  bound: boolean;
  /** the button's state, who holds the floor (player id) and our own turn (0 = not talking) */
  btn: Btn; holder: string | null; turn: number;
  mic: Mic; muted: boolean;
  /** the browser has blocked the site's mic for good: presses show the picture guide, never a request */
  blocked: boolean;
  stats: typeof AUDIO_STATS;
  /** every turn this phone talked in, with when it started and ended (performance.now()) */
  log: { turn: number; start: number; end: number }[];
} = { bound: false, btn: 'idle', holder: null, turn: 0, mic: 'none', muted: false, blocked: false, stats: AUDIO_STATS, log: [] };

let link: PttLink | null = null, hud: PttHud | null = null, floor: FloorClient | null = null, ui: PttUi | null = null, timer = 0;
const audio = new PttAudio();
let up = false;
/** The strip takes room at the bottom of the screen: it must appear in the same frame as the co-op shift screen,
 * never a tick later, or the station's buttons move up under a finger already pressing them (press.test.js). */
let frame = 0, wasShown = false;
function watchShown(): void {
  frame = requestAnimationFrame(watchShown);
  // The strip moves with the screen it belongs to (the room's lobby, then the shift's game column), same frame
  if (hud && ui) ui.mount(hud.mount() || document.body);
  const s = !!hud && hud.shown();
  if (s !== wasShown) {
    wasShown = s;
    // a lobby guide (mic or motion) never stays over the station when the shift begins: the station plays without it
    if (s) hidePermitGuide();
    render();
  }
}

function readMute(): boolean { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } }

function apply(fx: Fx[]): void {
  for (const f of fx) {
    if ('send' in f) { if (link && up) link.send(f.send); }
    else if ('mic' in f) void mic();
    else if ('stream' in f) {
      const turn = f.stream;
      PTT.log.push({ turn, start: performance.now(), end: 0 });
      audio.startStream(turn, b => { if (link && up) link.send(b); });
    } else if ('stop' in f) {
      audio.stopStream();
      const last = PTT.log[PTT.log.length - 1];
      if (last && !last.end) last.end = performance.now();
    } else audio.beep(f.beep, f.own);
  }
  render();
}

/**
 * Opens the mic for a press (the request, if not granted yet: the player's own action). A refusal gives the floor
 * back: a "no" to the prompt shows on the strip (the next press asks again); a block for good brings the picture guide.
 */
async function mic(): Promise<void> {
  const t0 = performance.now();
  const st = await audio.openMic();
  if (st === 'on') micOutcome(true, t0);
  else if (st === 'denied') micOutcome(false, t0, 'NotAllowedError');
  if (st === 'on' || !floor || !ui) { render(); return; }
  ui.forget();
  apply(floor.release());
  if (micBlocked()) showPermitGuide('mic');
  else if (st !== 'denied') { const [title, ...lines] = micHelp(st); ui.popup(title, lines); }
}

function press(): void {
  if (!floor || !ui) return;
  audio.unlock();
  // blocked for good: a request would fail again without a prompt; the picture guide says where to allow it
  if (audio.mic !== 'on' && micBlocked()) { showPermitGuide('mic'); return; }
  if (audio.mic === 'unsupported') { const [title, ...lines] = micHelp('unsupported'); ui.popup(title, lines); return; }
  apply(floor.press());
}

function release(): void { if (floor) apply(floor.release()); }

/** Any way the page can stop being under the finger: give the turn back now (the room's nets catch the rest). */
function away(): void { if (floor && floor.pressed) { if (ui) ui.forget(); release(); } }
/** Hidden: give the turn back. Back in view: the page's sound comes back if the mic or iOS stopped it. */
function onHidden(): void { if (document.visibilityState === 'hidden') away(); else if (link) audio.revive(); }
let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  addEventListener('blur', away);
  addEventListener('pagehide', away);
  document.addEventListener('visibilitychange', onHidden);
  // iOS starts audio only from a gesture: every tap on the page may be the one that lets the other talker be heard
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) addEventListener(ev, () => { if (link) audio.unlock(); }, true);
}

function render(): void {
  if (!floor || !ui || !hud) return;
  const h = floor.holder, now = performance.now();
  // A voice is on air while we talk, or while a teammate we can hear (strip not muted) holds the floor
  setPttVoice(floor.turn > 0 || (!!h && h.id !== floor.me && !audio.muted));
  PTT.btn = floor.btn(); PTT.holder = h ? h.id : null; PTT.turn = floor.turn; PTT.mic = audio.mic; PTT.muted = audio.muted;
  PTT.blocked = audio.mic !== 'on' && micBlocked();
  ui.render({
    blocked: PTT.blocked,
    shown: hud.shown(), btn: floor.btn(), mic: audio.mic, up, muted: audio.muted,
    holder: h ? { name: h.name, mine: h.id === floor.me, left: Math.max(0, Math.ceil((h.until - now) / 1000)) } : null,
    refusedName: floor.refused ? floor.refused.name : '',
  });
}

export function pttBind(l: PttLink, h: PttHud): void {
  pttUnbind();
  link = l; hud = h; up = l.up();
  roomAudioSession();   // one session (playback) for the whole room visit, before any mic: a turn never changes the level
  floor = new FloorClient(l.id, h.name);
  audio.muted = readMute();
  ui = ui || new PttUi({
    press, release,
    mute: () => {
      audio.muted = !audio.muted;
      try { localStorage.setItem(MUTE_KEY, audio.muted ? '1' : '0'); } catch { /* storage blocked: this session only */ }
      if (link && up) link.send({ t: 'pttMute', on: audio.muted });
      render();
    },
  });
  ui.mount(h.mount() || document.body);
  listen();
  if (up && audio.muted) l.send({ t: 'pttMute', on: true });
  PTT.bound = true;
  timer = setInterval(() => { if (floor) apply(floor.tick(performance.now())); }, TICK_MS);
  wasShown = h.shown(); frame = requestAnimationFrame(watchShown);
  render();
}

// the strip follows the mic's clearance (a grant in the browser's lock menu during the shift unblocks it)
onMicPermit(() => { render(); });

let card: MicCard | null = null;
const theCard = (): MicCard => (card = card || new MicCard());
/**
 * The co-op lobby's mic row, one element the lobby appends after each re-render (online rooms only: the
 * walkie-talkie exists only there). `fresh`: a new room visit (nothing asked in it yet).
 */
export function pttLobbyCard(fresh: boolean): HTMLElement {
  const c = theCard();
  if (fresh) c.reset(); else c.render();
  return c.el;
}
/**
 * The real mic request for this room visit: call it inside the tap that creates or joins a room, or any tap in
 * the lobby (only the first one of a visit asks). `fresh`: this tap starts a new visit.
 */
export function pttAskMic(fresh = false): void {
  const c = theCard();
  if (fresh) c.reset();
  c.ask();
}

export function pttUnbind(): void {
  if (floor) { if (ui) ui.forget(); apply(floor.release()); }
  clearInterval(timer); cancelAnimationFrame(frame); wasShown = false;
  audio.stopStream();
  audio.closeMic();
  link = null; floor = null; up = false;
  setPttVoice(false);
  PTT.bound = false; PTT.holder = null; PTT.turn = 0; PTT.btn = 'idle';
  if (ui) ui.render({ blocked: PTT.blocked, shown: false, btn: 'idle', mic: audio.mic, up: false, muted: audio.muted, holder: null, refusedName: '' });
}

export function pttIn(m: PttIn | ArrayBuffer): void {
  if (!floor) return;
  if (m instanceof ArrayBuffer) { audio.play(m); return; }
  const prev = floor.holder;
  apply(m.t === 'floor' ? floor.floor(m, performance.now()) : floor.no(m, performance.now()));
  // Another talker's turn ended: the page's sound comes back (our own turn's end does it in audio.stopStream)
  if (m.t === 'floor' && !m.holder && prev && prev.id !== floor.me) audio.revive();
}

export function pttLink(isUp: boolean): void {
  if (!floor || isUp === up) return;
  up = isUp;
  // back up: tell the room our mute switch again (a new socket starts unmuted)
  if (up && link && audio.muted) link.send({ t: 'pttMute', on: true });
  apply(up ? [] : floor.linkDown());
}
