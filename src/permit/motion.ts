// Motion permission for the 傳菜 tilt control. The game asks on every entry, from the tap that enters: taking the
// 傳菜 seat in a co-op room, starting a solo 傳菜 shift or lesson. iOS asks only from a gesture
// (DeviceOrientationEvent.requestPermission); Chrome on Android never asks but can have Motion sensors blocked for the
// site. A picture guide shows only when the browser has blocked the site for good.
//
// The API the runner's control code reads (its own page in an iframe, or this page):
//   motionPermit()   'granted' | 'denied' | 'prompt' | 'unavailable', what is known now (no prompt);
//   motionRequest()  the real request; call it inside a tap's handler. Resolves to granted / denied / unavailable.
//   showPermitGuide('motion')  (./guide) the picture guide, if the runner wants to offer it again.
// The answer is kept for this tab in sessionStorage KEY, which a same-origin iframe shares; never across visits.
//   motionAsk() asks only while the answer is unknown. Called before play starts
//                    (the level / lesson start tap, the room's lobby, the standalone page's 開工), never mid-play.
import { showPermitGuide } from './guide';
import { browserKind } from './browser';

export type MotionState = 'granted' | 'denied' | 'prompt' | 'unavailable';
const KEY = 'ckf-motion';
/** A refusal faster than this came without a prompt on screen: the browser had already decided (blocked for good). */
const NO_PROMPT_MS = 250;

function save(s: MotionState): void { try { sessionStorage.setItem(KEY, s); } catch { /* storage blocked: this page only */ } last = s; }
let last: MotionState | null = null;
function saved(): MotionState | null {
  if (last) return last;
  let v: string | null = null;
  try { v = sessionStorage.getItem(KEY); } catch { /* storage blocked */ }
  return v === 'granted' || v === 'denied' || v === 'prompt' || v === 'unavailable' ? v : null;
}

const isPermFn = (f: unknown): f is () => Promise<unknown> => typeof f === 'function';
/** iOS 13+: the request function on DeviceOrientationEvent (one grant covers motion too), or null elsewhere. */
function iosRequest(): (() => Promise<unknown>) | null {
  // only on iOS: newer Chrome has the function too, and a desktop without sensors answers 'denied' there (not a block)
  if (!('DeviceOrientationEvent' in window) || !browserKind().startsWith('ios-')) return null;
  const f: unknown = Reflect.get(DeviceOrientationEvent, 'requestPermission');
  return isPermFn(f) ? f : null;
}

/**
 * A phone that may have motion sensors without iOS's request function: Android. A desktop (or a headless test browser)
 * has the event type but no sensor: 'unavailable', which never shows a guide or blocks anything (the finger plays).
 */
const android = (): boolean => /Android/.test(navigator.userAgent);

export function motionPermit(): MotionState {
  if (!('DeviceOrientationEvent' in window)) return 'unavailable';
  const s = saved();
  if (s) return s;
  // without iOS's request function there is nothing to ask: allowed on Android unless the site's sensors were blocked
  return iosRequest() ? 'prompt' : android() ? 'granted' : 'unavailable';
}

/** Chrome's Permissions API knows 'accelerometer' (lib.dom does not list it: Reflect keeps the type honest). */
async function chromeSensorsBlocked(): Promise<boolean> {
  if (!('permissions' in navigator)) return false;
  try {
    const query = navigator.permissions.query.bind(navigator.permissions);
    const st: unknown = await Reflect.apply(query, undefined, [{ name: 'accelerometer' }]);
    return st instanceof PermissionStatus && st.state === 'denied';
  } catch { return false; }
}

let guided = false;
/**
 * Inside a tap's handler. A refusal the browser made on its own (no prompt) is 'denied' for good; with `guide` (the
 * co-op lobby, before any station is on screen) it also shows the picture guide, once per page load. Never over a
 * station the player can still play by finger: a solo start passes false, and the runner can offer the guide itself.
 */
export function motionRequest(guide = true): Promise<'granted' | 'denied' | 'unavailable'> {
  if (!('DeviceOrientationEvent' in window)) { save('unavailable'); return Promise.resolve('unavailable'); }
  const req = iosRequest();
  const blocked = (): 'denied' => {
    save('denied');
    if (guide && !guided) { guided = true; showPermitGuide('motion'); }
    return 'denied';
  };
  if (!req) {
    if (!android()) { save('unavailable'); return Promise.resolve('unavailable'); }
    return chromeSensorsBlocked().then(b => { if (b) return blocked(); save('granted'); return 'granted'; });
  }
  const t0 = performance.now();
  let p: Promise<unknown>;
  try { p = req.call(DeviceOrientationEvent); } catch { p = Promise.resolve('denied'); }
  return p.then(r => r, () => 'denied').then((r): 'granted' | 'denied' => {
    if (r === 'granted') { save('granted'); return 'granted'; }
    if (performance.now() - t0 < NO_PROMPT_MS) return blocked();
    save('denied');   // a "no" to the prompt is kept for the tab: the finger plays, no prompt each trip
    return 'denied';
  });
}

/**
 * The one ask every 傳菜 entry uses: inside a tap, ask only while nothing is known yet ('prompt'), so a
 * grant or a "no" is asked once per tab; everything else answers at once with what is known. Never blocks play: the
 * runner plays by finger until a motion reading arrives.
 */
export function motionAsk(guide = false): Promise<MotionState> {
  const s = motionPermit();
  return s === 'prompt' ? motionRequest(guide) : Promise.resolve(s);
}

const CTL_KEY = 'ckf-runner-ctl';
/** The 傳菜 control the runner screen uses now ('tilt' once a motion reading drives it, else 'thumb'), for help text. */
export function runnerControl(): 'tilt' | 'thumb' {
  try { return sessionStorage.getItem(CTL_KEY) === 'tilt' ? 'tilt' : 'thumb'; } catch { return 'thumb'; }
}
export function setRunnerControl(c: 'tilt' | 'thumb'): void { try { sessionStorage.setItem(CTL_KEY, c); } catch { /* storage blocked */ } }
