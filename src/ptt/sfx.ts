// The game's sound setting as the walkie-talkie's radio sounds see it. The game's sound layer
// (src/ui/juice.ts) registers its level here; src/ptt reads it before every chirp / roger / squelch, so the 聲 switch
// silences them like every other effect. The other talker's voice is not under it: that has the strip's own mute.
// No imports, so the sound layer can load it without pulling in the rest of src/ptt.

/** Until the game registers its setting (a page without the game's sound layer): the game's default level. */
let level: () => number = () => 0.5;

/** The game's sound layer: `fn` returns the effects' level now, 0 when the game's sound is off. */
export function pttSoundLevel(fn: () => number): void { level = fn; }

/** The radio sounds' level now (0 = silent). */
export const sfxLevel = (): number => level();

/**
 * A voice is on the walkie-talkie now (our own turn, or a teammate's we can hear). src/ptt sets it from the
 * floor; the game's sound layer listens and ducks its music (src/ptt/duck.ts).
 */
let voiceOn = false;
let voiceFn: (on: boolean) => void = () => { /* no sound layer on this page */ };
/** The game's sound layer: `fn` runs on every change, and once now with the current state. */
export function onPttVoice(fn: (on: boolean) => void): void { voiceFn = fn; fn(voiceOn); }
/** The walkie-talkie: a voice started or ended (repeats of the same state are ignored). */
export function setPttVoice(on: boolean): void { if (on === voiceOn) return; voiceOn = on; voiceFn(on); }
export const pttVoice = (): boolean => voiceOn;

/**
 * After a talk turn the page's other sound must come back by itself. The walkie-talkie fires this event on
 * the page's window and on every same-origin frame's window (the extra seats' screens are iframes with their own
 * AudioContext) whenever the mic may have moved the audio route: a turn ending (ours or another talker's), the mic
 * closing after its hold window, the page coming back into view. Every sound owner listens and resumes its context.
 */
export const AUDIO_REVIVE = 'ckf-audio-revive';

/** Tells the page and its frames to bring their sound back (see AUDIO_REVIVE). */
export function reviveGameAudio(): void {
  const wins: Window[] = [window];
  for (const f of Array.from(document.querySelectorAll('iframe'))) if (f.contentWindow) wins.push(f.contentWindow);
  for (const w of wins) { try { w.dispatchEvent(new Event(AUDIO_REVIVE)); } catch { /* a frame of another origin */ } }
}

/** iOS Safari 16.4+ (navigator.audioSession): 'play-and-record' while the mic is open, 'playback' after. */
function setAudioSession(type: 'playback' | 'play-and-record'): void {
  try {
    const as: unknown = Reflect.get(navigator, 'audioSession');
    if (typeof as === 'object' && as !== null && 'type' in as) Reflect.set(as, 'type', type);
  } catch { /* not supported: other browsers choose the route themselves */ }
}

/**
 * One audio session for the whole room visit, so a talk turn never changes the game's level. 'playback' (the
 * phone's media volume, the loudspeaker) from the moment the walkie-talkie is bound, 'play-and-record' only while a
 * getUserMedia stream of ours is open (the talk mic, or the lobby's permission request), 'playback' again when the last
 * one closes. Counted, so the lobby request ending never switches the session under an open talk mic.
 */
let micStreams = 0;
/** A getUserMedia call is about to be made (its stream will be ended with micSessionEnd, granted or not). */
export function micSessionStart(): void { micStreams++; setAudioSession('play-and-record'); }
/** Our stream (or the failed request) is over: back to the room's playback session when it was the last one. */
export function micSessionEnd(): void {
  micStreams = Math.max(0, micStreams - 1);
  if (micStreams === 0) { setAudioSession('playback'); reviveGameAudio(); }
}
/** Entering a room: the playback session from the start (before any mic), so the level before a turn is the level after. */
export function roomAudioSession(): void { if (micStreams === 0) setAudioSession('playback'); }
