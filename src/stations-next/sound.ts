// The small sound interface the new station screens play through (contract rule: the screen owns sound, the core
// only names cues). Off by default, as in the original prototypes: nothing is created until the player turns it on with the
// 聲 button, and nothing plays while the page is hidden or the switch is off (so tests and a muted page stay silent).

export interface StationSound {
  /** Plays a named effect (ignored when muted). `arg` is an effect's optional number (a streak, a pitch step). */
  play(name: string, arg?: number): void;
  /** Turns sound on or off from a user gesture; returns the new state. */
  toggle(): boolean;
  readonly on: boolean;
}
export interface Synth {
  tone(f: number, dur: number, type?: OscillatorType, vol?: number, f2?: number, delay?: number): void;
  noise(dur: number, vol?: number, freq?: number, delay?: number): void;
}
export type Recipes = Record<string, (s: Synth, arg: number) => void>;

/** WebAudio square/sine blips and filtered noise: the prototypes' tone() and noise(), behind the interface. */
export function synthSound(recipes: Recipes): StationSound {
  let ac: AudioContext | null = null, on = false;
  const live = (): AudioContext | null => on && ac && !document.hidden ? ac : null;
  const synth: Synth = {
    tone(f, dur, type = 'square', vol = 0.04, f2 = 0, delay = 0) {
      const a = live(); if (!a) return;
      const t0 = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    },
    noise(dur, vol = 0.05, freq = 1200, delay = 0) {
      const a = live(); if (!a) return;
      const n = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t0 = a.currentTime + delay;
      s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol; s.connect(f).connect(g).connect(a.destination); s.start(t0);
    },
  };
  return {
    get on() { return on; },
    play(name, arg = 0) { const r = recipes[name]; if (r && live()) r(synth, arg); },
    toggle() {
      on = !on;
      if (on) { try { ac = ac ?? new AudioContext(); void ac.resume(); } catch { on = false; } }
      return on;
    },
  };
}
