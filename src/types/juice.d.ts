// Types owned by src/juice.ts: combo and tips on the shift state, the Web Audio sound effects and the music.

/** Fields good() / breakCombo() keep on the shift state (combo, tips and fever; `ease`, `fever`, `tips` are in model.d.ts). */
interface GameState {
  combo?: number; maxCombo?: number; goods?: number; fevers?: number;
  /** Game time (G.t) the shift's one fever starts (core/referee/fever.ts); null: no fever (the tutorial); unset until the first open step. */
  feverAt?: number | null;
}

interface Window {
  /** Old Safari's prefixed AudioContext (juice.ts audio() falls back to it). */
  webkitAudioContext?: typeof AudioContext;
}

/** tone(): `at` = seconds from now, or `when` = an absolute AudioContext time; `to` = glide to this pitch; `dest` = a node other than the master gain. */
interface ToneOpts {
  type?: OscillatorType; vol?: number; at?: number; to?: number | null; attack?: number; when?: number | null; dest?: AudioNode | null;
}
/** noiseHit(): filtered noise. `at` is accepted but ignored (sfx.stir passes it; noiseHit has no such option). */
interface NoiseOpts {
  type?: BiquadFilterType; freq?: number; to?: number | null; q?: number; vol?: number; when?: number | null; attack?: number; at?: number;
}

type BgmKey = 'main' | 'old' | 'spooky' | 'hell';
/**
 * A music track: two 32-step lead parts (MIDI notes, null = rest), four bass notes (one per bar), waveforms and
 * volumes of lead (lw / lv) and bass (bw / bv), the bass's fifth, a tempo factor, hats on or off, the bass every
 * `every` steps (4 when missing), and an `extra` voice called on every step.
 */
interface BgmTrack {
  lead: (number | null)[][]; bass: number[]; lw: OscillatorType; lv: number; bw: OscillatorType; bv: number; fifth: number; tempo: number;
  hat?: boolean; every?: number; extra?: (i: number, when: number, step: number, dest: AudioNode | null) => void;
}
