// Push-to-talk audio codec: 8 kHz G.711 mu-law in 80 ms frames, sent as binary WebSocket messages
// through the room. Pure functions and one small resampler: no DOM, no imports (tests load this file directly).
// Frame layout (worker/index.ts checks it): byte 0 = AUDIO_MAGIC, bytes 1-4 = turn (uint32 LE), bytes 5-6 = frame
// number (uint16 LE), then FRAME_SAMPLES mu-law bytes.

export const RATE = 8000;
export const FRAME_SAMPLES = 640;               // 80 ms at 8 kHz
export const FRAME_MS = FRAME_SAMPLES / RATE * 1000;
export const AUDIO_MAGIC = 0xa1;
export const HEAD = 7;

const BIAS = 0x84, CLIP = 32635;

/** One sample (-1..1) to a mu-law byte (ITU-T G.711). */
export function muEncode(x: number): number {
  let s = Math.round(Math.max(-1, Math.min(1, x)) * 32767);
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1) { /* find the segment */ }
  const mant = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}

/** A mu-law byte back to a sample (-1..1). */
export function muDecode(u: number): number {
  const v = ~u & 0xff, sign = v & 0x80, exp = (v >> 4) & 7, mant = v & 0x0f;
  const s = (((mant << 3) + BIAS) << exp) - BIAS;
  return (sign ? -s : s) / 32768;
}

/** A frame: header + mu-law samples. */
export function packFrame(turn: number, seq: number, samples: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(HEAD + samples.length), v = new DataView(buf), b = new Uint8Array(buf);
  v.setUint8(0, AUDIO_MAGIC); v.setUint32(1, turn >>> 0, true); v.setUint16(5, seq & 0xffff, true);
  for (let i = 0; i < samples.length; i++) b[HEAD + i] = muEncode(samples[i] ?? 0);
  return buf;
}

/** A frame from the room: its turn, number and samples (8 kHz), or null if it is not one. */
export function parseFrame(buf: ArrayBuffer): { turn: number; seq: number; samples: Float32Array } | null {
  if (buf.byteLength <= HEAD) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== AUDIO_MAGIC) return null;
  const b = new Uint8Array(buf, HEAD), samples = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) samples[i] = muDecode(b[i] ?? 0xff);
  return { turn: v.getUint32(1, true), seq: v.getUint16(5, true), samples };
}

/**
 * Microphone rate (44.1 / 48 kHz) down to 8 kHz, chunk by chunk with state carried across chunks: two one-pole
 * low-passes at ~3.4 kHz (anti-alias; voice has little above it) and linear interpolation at the output times.
 */
export class Downsampler {
  private readonly step: number;
  private readonly a: number;
  private y1 = 0;
  private y2 = 0;
  private prev = 0;
  /** Position of the next output sample, in input samples, counted from the start of the next chunk. */
  private pos = 0;
  constructor(inRate: number) {
    this.step = inRate / RATE;
    this.a = 1 - Math.exp(-2 * Math.PI * 3400 / inRate);
  }
  /** Feeds one chunk; returns the 8 kHz samples it completes. */
  push(input: Float32Array): Float32Array {
    const f = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      this.y1 += this.a * ((input[i] ?? 0) - this.y1);
      this.y2 += this.a * (this.y1 - this.y2);
      f[i] = this.y2;
    }
    const out: number[] = [];
    // output at input position p (relative to this chunk): between sample floor(p) and floor(p)+1; index -1 is prev
    while (this.pos < input.length - 1 + 1e-9) {
      const i = Math.floor(this.pos), t = this.pos - i;
      const s0 = i < 0 ? this.prev : f[i] ?? 0, s1 = f[i + 1] ?? f[i] ?? 0;
      out.push(s0 + (s1 - s0) * t);
      this.pos += this.step;
    }
    this.prev = f[input.length - 1] ?? this.prev;
    this.pos -= input.length;
    return Float32Array.from(out);
  }
}

/** 8 kHz samples up to the playback rate (linear interpolation; one frame at a time). */
export function upsample(s: Float32Array, outRate: number): Float32Array {
  const n = Math.max(1, Math.round(s.length * outRate / RATE)), out = new Float32Array(n), r = RATE / outRate;
  for (let j = 0; j < n; j++) {
    const p = j * r, i = Math.floor(p), t = p - i, a = s[i] ?? 0, b = s[i + 1] ?? a;
    out[j] = a + (b - a) * t;
  }
  return out;
}
