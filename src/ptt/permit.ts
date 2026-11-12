// The walkie-talkie's microphone permission. The game makes the real getUserMedia request on
// every entry: the tap that creates or joins a co-op room (or the first tap in the lobby when the room came back by
// itself after a reload), and again on a talk press while the mic is still not granted (the player's own action). A
// "no" or a dismissed prompt is never remembered across visits: the next entry asks again. Only when the browser has
// blocked the site for good (it refuses without showing its prompt, and no page can make it ask) does the player get a
// picture guide for their browser (src/permit/guide.ts) instead of a request.
import { micSessionStart, micSessionEnd } from './sfx';

/** The browser's answer as the Permissions API gives it ('unknown': no API, or it does not know 'microphone'). */
let perm: PermissionState | 'unknown' = 'unknown';
/** getUserMedia succeeded on this page load. */
let session = false;
/** The last refusal came without a prompt (blocked for good), as the request timed it; a grant clears it. */
let refusedQuietly = false;
const subs: (() => void)[] = [];

/** A refusal faster than this came without a prompt on screen: the browser had already decided. */
export const NO_PROMPT_MS = 250;

function changed(): void { for (const f of subs) f(); }
/** `f` runs whenever the mic's state changes (a request answered, the browser's permission changed). */
export function onMicPermit(f: () => void): void { subs.push(f); }

export function micGranted(): boolean { return session || perm === 'granted'; }
/** The browser has blocked the site's mic for good: asking would only fail again, so the guide shows instead. */
export function micBlocked(): boolean { return !micGranted() && (perm === 'denied' || refusedQuietly); }

export function micSupported(): boolean {
  return 'mediaDevices' in navigator && typeof navigator.mediaDevices.getUserMedia === 'function';
}

/**
 * Records the outcome of a getUserMedia call made at `t0` (performance.now()): here (the lobby) or in audio.ts (a talk
 * press). A NotAllowedError that came back without a prompt, or with the Permissions API saying denied, is a block.
 */
export function micOutcome(ok: boolean, t0: number, errName = ''): void {
  if (ok) { session = true; refusedQuietly = false; }
  else if (errName === 'NotAllowedError' || errName === 'SecurityError') refusedQuietly = performance.now() - t0 < NO_PROMPT_MS;
  changed();
}

/**
 * The real permission request (call it inside a tap's handler: iOS prompts only from a gesture). Opens the mic once and
 * closes it at once: nothing is recorded here, and iOS would show its mic light all through the lobby.
 */
export function micRequest(): Promise<'granted' | 'denied' | 'blocked' | 'error' | 'unsupported'> {
  if (!micSupported()) return Promise.resolve('unsupported');
  const t0 = performance.now();
  // The request is a capture like a talk turn: play-and-record for it, the room's playback session once its
  // tracks are stopped. Without this, iOS stayed at the quieter voice-chat level from the room's first tap until the
  // first talk turn switched to playback, so the game sounded much louder after talking.
  micSessionStart();
  return navigator.mediaDevices.getUserMedia({ audio: true })
    .then((s): 'granted' => { for (const t of s.getTracks()) t.stop(); micSessionEnd(); micOutcome(true, t0); return 'granted'; })
    .catch((e: unknown): 'denied' | 'blocked' | 'error' | 'unsupported' => {
      micSessionEnd();
      const n = e instanceof DOMException ? e.name : '';
      micOutcome(false, t0, n);
      if (n === 'NotAllowedError' || n === 'SecurityError') return micBlocked() ? 'blocked' : 'denied';
      return n === 'NotFoundError' || n === 'OverconstrainedError' ? 'unsupported' : 'error';
    });
}

/** Reads the Permissions API once at load and follows its changes (a player allowing the site in the browser's menu). */
function watchPerm(): void {
  // older Safari has no Permissions API at all; one that does not know 'microphone' throws or rejects
  if (!('permissions' in navigator)) return;
  let q: Promise<PermissionStatus>;
  try { q = navigator.permissions.query({ name: 'microphone' }); } catch { return; }
  q.then(st => {
    perm = st.state;
    changed();
    st.addEventListener('change', () => { perm = st.state; if (perm === 'granted') refusedQuietly = false; changed(); });
  }).catch(() => { /* this browser does not know 'microphone': the requests' timing decides */ });
}
watchPerm();
