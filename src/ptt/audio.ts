// Push-to-talk audio: the microphone to 8 kHz mu-law frames while this phone holds the floor, the
// other talker's frames to the speaker through a small jitter buffer and a radio-band filter, and the radio beeps.
// Web Audio only (no MediaRecorder, no WebRTC): works the same on iOS Safari 15+ and Chrome, frames decode on their own.
import { Downsampler, FRAME_SAMPLES, packFrame, parseFrame, upsample } from './codec';
import type { Beep } from './floor';
import { sfxLevel, reviveGameAudio, micSessionStart, micSessionEnd } from './sfx';

/** none: never asked (or closed after a pause); asking: the permission prompt is up; error: in use / failed. */
export type Mic = 'none' | 'asking' | 'on' | 'denied' | 'unsupported' | 'error';

/** Playback starts this far ahead (absorbs network jitter); a queue longer than MAX_QUEUE_S drops frames to catch up. */
const PREBUFFER_S = 0.12, MAX_QUEUE_S = 0.6;
/** The mic stays open this long after a turn (quick back-and-forth needs no re-open), then closes (iOS shows it on). */
const MIC_IDLE_MS = 8000;

/** The capture worklet: collects 1024 samples, posts them to the page. Loaded from a Blob (no extra file to cache). */
const WORKLET = "class P extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(1024);this.n=0}process(i){const c=i[0]&&i[0][0];if(c){for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===1024){this.port.postMessage(this.b);this.b=new Float32Array(1024);this.n=0}}}return true}}registerProcessor('ckf-ptt-cap',P)";

/**
 * Counters the tests read: frames sent, received, scheduled to play, and dropped as too late; radio sounds asked for
 * (by kind) and actually scheduled (`sfx`: not when the game's sound is off or audio has not started).
 */
const asked: Record<Beep, number> = { key: 0, roger: 0, limit: 0, busy: 0 };
/** `revive`: times this phone told the page's sound to come back after the mic. */
export const AUDIO_STATS = { sent: 0, rx: 0, played: 0, late: 0, sfx: 0, asked, revive: 0 };

/** A radio sound as tones and noise bursts. Levels are at the game's level 1; the game plays effects at 0.5. */
type Part =
  | { tone: number; to?: number; at: number; dur: number; vol: number; wave?: OscillatorType }
  | { noise: number; q: number; at: number; dur: number; vol: number; cut?: boolean };
/**
 * key: the key-up as a turn starts (~170 ms): a squelch burst, then 1100 -> 1650 Hz, the roger read backwards,
 * at its level (RMS within 1 dB, same tone peak). roger: the end-of-turn beep, then the squelch tail closing (~340 ms).
 */
const SOUNDS: Record<Beep, Part[]> = {
  key: [
    { noise: 1800, q: 0.6, at: 0, dur: 0.07, vol: 0.09, cut: true },   // squelch head: the static opens, then snaps shut
    { tone: 1100, at: 0.075, dur: 0.04, vol: 0.17 },
    { tone: 1650, at: 0.125, dur: 0.045, vol: 0.17 },
  ],
  roger: [
    { tone: 1650, at: 0, dur: 0.05, vol: 0.18 },
    { tone: 1100, at: 0.06, dur: 0.07, vol: 0.18 },
    { noise: 1800, q: 0.6, at: 0.14, dur: 0.2, vol: 0.09, cut: true },   // squelch tail: static, then the gate snaps shut
  ],
  limit: [{ tone: 700, at: 0, dur: 0.09, vol: 0.24 }, { tone: 700, at: 0.14, dur: 0.09, vol: 0.24 }, { tone: 700, at: 0.28, dur: 0.2, vol: 0.24 }],
  busy: [{ tone: 330, at: 0, dur: 0.12, vol: 0.1, wave: 'square' }, { tone: 260, at: 0.15, dur: 0.16, vol: 0.1, wave: 'square' }],
};
/**
 * The other talker's voice chain: a fixed lift (`pre`, +8 dB), a gentle compressor that levels quiet and
 * loud talkers (dB, seconds; its automatic make-up gain adds ~11 dB below the threshold), and a limiter whose ceiling
 * keeps every peak of a real voice under -1 dBFS. Gentle on purpose: a harder ratio lifted the room's hiss between
 * words up to the voice's level (measured).
 */
const VOICE = { pre: 2.5, comp: { threshold: -24, knee: 12, ratio: 4, attack: 0.003, release: 0.15 }, lim: { threshold: -6, release: 0.1 } } as const;
/** How long the mic's frames are dropped after our own chirp starts (its length plus capture latency): never sent. */
const KEY_QUIET_MS = 230;

export class PttAudio {
  ctx: AudioContext | null = null;
  mic: Mic = 'none';
  muted = false;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private down: Downsampler | null = null;
  private readonly acc = new Float32Array(FRAME_SAMPLES);
  private accN = 0;
  private turn = 0;
  private seq = 0;
  private sink: ((b: ArrayBuffer) => void) | null = null;
  private idleT = 0;
  private opening: Promise<Mic> | null = null;
  private workletLoaded = false;
  private playTurn = -1;
  private nextT = 0;
  private out: AudioNode | null = null;
  private noise: AudioBuffer | null = null;
  /** performance.now() until which captured audio is dropped (our own chirp must not go out in the voice). */
  private quietUntil = 0;
  /** Our context has run once (a gesture unlocked it): from then on it may be resumed without one. */
  private ran = false;
  /** We hold the room's play-and-record session for our talk mic (sfx.ts micSessionStart). */
  private sessionOpen = false;

  context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const C = typeof window.AudioContext === 'function' ? window.AudioContext : window.webkitAudioContext;
    if (!C) return null;
    try { this.ctx = new C(); } catch { return null; }
    // A context that ran and then stopped by itself (iOS: 'interrupted' or 'suspended' as the mic moves the
    // audio route) is resumed once things settle; a refused resume leaves it for the next revive or tap
    const c = this.ctx;
    c.addEventListener('statechange', () => {
      if (c.state === 'running') this.ran = true;
      else if (this.ran && c.state !== 'closed') setTimeout(() => { this.resumeOwn(); }, 300);
    });
    return this.ctx;
  }
  private resumeOwn(): void {
    const c = this.ctx;
    if (c && c.state === 'running') this.ran = true;
    if (c && this.ran && c.state !== 'running' && c.state !== 'closed' && document.visibilityState === 'visible') c.resume().catch(() => { /* still interrupted: the next revive */ });
  }

  /**
   * The mic may have moved the audio route (iOS play-and-record) and stopped the page's sound: resume our
   * context and tell the game's sound (and the seat screens' frames) to come back. After every turn, own or remote,
   * the mic closing, and the page coming back into view.
   */
  revive(): void {
    AUDIO_STATS.revive++;
    this.resumeOwn();
    reviveGameAudio();
  }

  /** From a user gesture: iOS starts audio only from one (and leaves it 'interrupted' after a phone call). */
  unlock(): void {
    const c = this.context();
    if (c && c.state !== 'running') c.resume().catch(() => { /* not a gesture the browser accepts: the next one */ });
  }

  /** Opens the microphone (asks for permission the first time). Resolves to the mic state. */
  openMic(): Promise<Mic> {
    clearTimeout(this.idleT);
    if (this.mic === 'on' && this.stream && this.stream.getAudioTracks().some(t => t.readyState === 'live')) return Promise.resolve(this.mic);
    if (this.opening) return this.opening;
    const ctx = this.context();
    // no mediaDevices: an old browser, or a page not on https (the API only exists in secure contexts)
    if (!ctx || !('mediaDevices' in navigator) || typeof navigator.mediaDevices.getUserMedia !== 'function') { this.mic = 'unsupported'; return Promise.resolve(this.mic); }
    this.mic = 'asking';
    // Play-and-record only while the mic is open; closeMic hands the session back to the room's 'playback'
    if (!this.sessionOpen) { this.sessionOpen = true; micSessionStart(); }
    const p = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
      .then(async (s): Promise<Mic> => {
        this.drop();
        this.stream = s;
        await this.wire(ctx, s);
        this.mic = 'on';
        return this.mic;
      })
      .catch((e: unknown): Mic => {
        const n = e instanceof DOMException ? e.name : '';
        this.closeMic();
        this.mic = n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'unsupported' : 'error';
        return this.mic;
      })
      .finally(() => { this.opening = null; });
    this.opening = p;
    return p;
  }

  private async wire(ctx: AudioContext, s: MediaStream): Promise<void> {
    const src = ctx.createMediaStreamSource(s), zero = ctx.createGain();
    zero.gain.value = 0;
    zero.connect(ctx.destination);   // a capture node only runs while something pulls on it
    this.down = new Downsampler(ctx.sampleRate);
    let node: AudioNode | null = null;
    if ('audioWorklet' in ctx && typeof AudioWorkletNode === 'function') {
      try {
        if (!this.workletLoaded) {
          const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
          try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
          this.workletLoaded = true;
        }
        const w = new AudioWorkletNode(ctx, 'ckf-ptt-cap');
        w.port.onmessage = (e: MessageEvent<unknown>) => { if (e.data instanceof Float32Array) this.capture(e.data); };
        node = w;
      } catch { node = null; }
    }
    if (!node) {
      // A worklet that would not load (a blocked Blob URL, an engine bug): the deprecated ScriptProcessor, which still runs
      // on every iOS Safari and Chrome. It is the only fallback that needs no extra file, so the deprecation is accepted.
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- fallback only, see above
      const sp = ctx.createScriptProcessor(2048, 1, 1);
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- fallback only, see above
      sp.onaudioprocess = e => { this.capture(e.inputBuffer.getChannelData(0)); };
      node = sp;
    }
    src.connect(node);
    node.connect(zero);
    this.nodes = [src, node, zero];
  }

  private capture(chunk: Float32Array): void {
    if (!this.down) return;
    const s = this.down.push(chunk);
    const sink = this.sink;
    if (!sink) return;   // not our turn: nothing kept (the key beep tells the talker when to start)
    if (performance.now() < this.quietUntil) return;   // our chirp is playing: the speaker would be in the voice
    for (const x of s) {
      this.acc[this.accN++] = x;
      if (this.accN === FRAME_SAMPLES) { sink(packFrame(this.turn, this.seq++, this.acc)); AUDIO_STATS.sent++; this.accN = 0; }
    }
  }

  /** Our turn started: frames from now on go to `sink`, tagged with `turn`. */
  startStream(turn: number, sink: (b: ArrayBuffer) => void): void {
    clearTimeout(this.idleT);
    this.turn = turn; this.seq = 0; this.accN = 0; this.sink = sink;
  }

  /** Our turn ended: the part-frame left goes out, then nothing more; the mic closes after a pause. */
  stopStream(): void {
    const sink = this.sink;
    if (sink && this.accN > 0) { sink(packFrame(this.turn, this.seq++, this.acc.slice(0, this.accN))); AUDIO_STATS.sent++; }
    const was = sink !== null;
    this.sink = null; this.accN = 0;
    clearTimeout(this.idleT);
    // When the hold window ends the mic closes and the page's sound is brought back (closeMic)
    this.idleT = setTimeout(() => { if (!this.sink) this.closeMic(); }, MIC_IDLE_MS);
    if (was) this.revive();   // our turn is over: the game's sound comes back now (ducked until the mic closes)
  }

  /**
   * Closes the mic for good: every track stopped, so iOS can leave play-and-record, the audio session set back
   * to 'playback' where Safari has one, and the page's sound told to come back.
   */
  closeMic(): void {
    const had = this.stream !== null || this.mic === 'asking';
    this.drop();
    if (this.sessionOpen) { this.sessionOpen = false; micSessionEnd(); }
    if (had) this.revive();
  }

  /** Disconnects the capture graph and stops every mic track. */
  private drop(): void {
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* not connected */ } }
    this.nodes = [];
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null; this.down = null;
    if (this.mic === 'on') this.mic = 'none';
  }

  /** A frame from the talker: played after the ones before it, PREBUFFER_S behind at the start of a turn. */
  play(buf: ArrayBuffer): void {
    AUDIO_STATS.rx++;
    const ctx = this.ctx;
    if (this.muted || !ctx || ctx.state !== 'running') return;
    const f = parseFrame(buf);
    if (!f) return;
    const data = upsample(f.samples, ctx.sampleRate), ab = ctx.createBuffer(1, data.length, ctx.sampleRate);
    ab.getChannelData(0).set(data);
    const now = ctx.currentTime;
    if (f.turn !== this.playTurn || this.nextT < now + 0.01) { this.playTurn = f.turn; this.nextT = now + PREBUFFER_S; }
    if (this.nextT - now > MAX_QUEUE_S) { AUDIO_STATS.late++; return; }
    const s = ctx.createBufferSource();
    s.buffer = ab;
    s.connect(this.output(ctx));
    s.start(this.nextT);
    this.nextT += ab.duration;
    AUDIO_STATS.played++;
  }

  private output(ctx: AudioContext): AudioNode {
    if (!this.out) this.out = voiceChain(ctx, ctx.destination);
    return this.out;
  }

  /**
   * A radio sound, synthesised, at the game's sound level (silent when the game's sound is off). `own`: the
   * chirp of our own turn starting, so the mic's frames are dropped while it plays.
   */
  beep(kind: Beep, own = false): void {
    AUDIO_STATS.asked[kind]++;
    const ctx = this.ctx, lv = sfxLevel();
    if (!ctx || ctx.state !== 'running' || !(lv > 0)) return;
    if (own && kind === 'key') this.quietUntil = performance.now() + KEY_QUIET_MS;
    if (!this.noise || this.noise.sampleRate !== ctx.sampleRate) this.noise = noiseBuffer(ctx);
    playSound(ctx, ctx.destination, kind, ctx.currentTime + 0.01, lv, this.noise);
    AUDIO_STATS.sfx++;
  }
}

/**
 * The other talker's voice: radio band (300-3400 Hz) so it sounds like a walkie-talkie, then lift, compressor and
 * limiter (VOICE) so voices are clear and as loud as each other without clipping. Returns the chain's input (exported
 * so its level can be measured offline).
 */
export function voiceChain(ctx: BaseAudioContext, dest: AudioNode): AudioNode {
  const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), pre = ctx.createGain(), comp = ctx.createDynamicsCompressor();
  const lim = ctx.createDynamicsCompressor(), V = VOICE;
  hp.type = 'highpass'; hp.frequency.value = 300;
  lp.type = 'lowpass'; lp.frequency.value = 3400;
  pre.gain.value = V.pre;
  comp.threshold.value = V.comp.threshold; comp.knee.value = V.comp.knee; comp.ratio.value = V.comp.ratio;
  comp.attack.value = V.comp.attack; comp.release.value = V.comp.release;
  lim.threshold.value = V.lim.threshold; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = V.lim.release;
  hp.connect(lp); lp.connect(pre); pre.connect(comp); comp.connect(lim); lim.connect(dest);
  return hp;
}

/** 0.4 s of white noise for the radio sounds' clicks and squelch. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.4), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** Schedules radio sound `kind` at time `t0` and level `lv` into `dest` (exported so its level can be measured offline). */
export function playSound(ctx: BaseAudioContext, dest: AudioNode, kind: Beep, t0: number, lv: number, noise: AudioBuffer): void {
  for (const p of SOUNDS[kind]) {
    const g = ctx.createGain(), a = t0 + p.at, e = a + p.dur, v = p.vol * lv;
    g.gain.setValueAtTime(0, a);
    g.gain.linearRampToValueAtTime(v, a + 0.004);
    let src: AudioScheduledSourceNode;
    if ('tone' in p) {
      const o = ctx.createOscillator();
      o.type = p.wave || 'sine';
      o.frequency.setValueAtTime(p.tone, a);
      if (p.to) o.frequency.linearRampToValueAtTime(p.to, e);
      g.gain.setValueAtTime(v, e - 0.01);
      o.connect(g);
      src = o;
    } else {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter();
      s.buffer = noise;
      f.type = 'bandpass'; f.frequency.value = p.noise; f.Q.value = p.q;
      // a squelch burst fades a little, then the gate shuts at once; a click just decays
      g.gain.linearRampToValueAtTime(p.cut ? v * 0.6 : 0.0001, p.cut ? e - 0.008 : e);
      s.connect(f); f.connect(g);
      src = s;
    }
    g.gain.linearRampToValueAtTime(0, e);
    g.connect(dest);
    src.start(a); src.stop(e + 0.02);
  }
}
