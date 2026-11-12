// SimBus: the room and the network between phones, in memory and virtual time,
// for the simulations. It plays the Durable Object (relays a phone's message to the referee with `from` stamped, the
// referee's to every phone or to the one in `to`, refuses a phone message over 16 KB, keeps the last keyframe) and the
// links (latency, jitter, loss, duplicates, reorder, bursts, a link going down, a frozen phone). Seeded: the same seed
// gives the same run. Messages travel as JSON text, as on the real socket.
import { mulberry32 } from '../rng';
import { PHONE_MAX_BYTES } from '../proto/messages';

export interface LinkShape {
  /** One-way delay in ms, and its random spread (±). */
  lat: number; jitter: number;
  /** Chances per message: lost, delivered twice, held back while later ones pass. */
  loss: number; dup: number; reorder: number;
}
export const SHAPES: Readonly<Record<string, LinkShape>> = {
  clean: { lat: 0, jitter: 0, loss: 0, dup: 0, reorder: 0 },
  lan: { lat: 5, jitter: 2, loss: 0, dup: 0, reorder: 0 },
  '4g': { lat: 80, jitter: 40, loss: 0, dup: 0, reorder: 0 },
  bad: { lat: 200, jitter: 150, loss: .05, dup: .02, reorder: .05 },
};

export interface Endpoint { id: string; deliver(json: string, now: number): void }
interface Peer { ep: Endpoint; shape: LinkShape; down: boolean; frozen: boolean; holdUntil: number }
interface Msg { at: number; n: number; to: string; json: string }

export interface SimBusStats { sent: number; delivered: number; lost: number; dups: number; refused: number; maxPhoneBytes: number; maxKeyBytes: number; bytesByKind: Record<string, number> }

export function simBus(seed: number) {
  const r = mulberry32(seed >>> 0);
  const peers = new Map<string, Peer>();
  let q: Msg[] = [], now = 0, n = 0, ref = '';
  let lastKey: string | null = null;
  const fifo = new Map<string, number>();
  const stats: SimBusStats = { sent: 0, delivered: 0, lost: 0, dups: 0, refused: 0, maxPhoneBytes: 0, maxKeyBytes: 0, bytesByKind: {} };
  const delay = (p: Peer): number => Math.max(0, p.shape.lat + (r() * 2 - 1) * p.shape.jitter);

  function queue(from: Peer, to: Peer, json: string): void {
    if (from.down || to.down){ stats.lost++; return; }
    if (r() < from.shape.loss || r() < to.shape.loss){ stats.lost++; return; }
    let at = Math.max(now + delay(from) + delay(to), from.holdUntil, to.holdUntil);
    // a socket keeps order (jitter never reorders one link); the reorder fault holds one message while later ones pass
    const pair = from.ep.id + '>' + to.ep.id;
    if (r() < from.shape.reorder) at += 300 + r() * 700;
    else { at = Math.max(at, fifo.get(pair) ?? 0); fifo.set(pair, at); }
    q.push({ at, n: n++, to: to.ep.id, json });
    if (r() < from.shape.dup){ stats.dups++; q.push({ at: at + r() * 100, n: n++, to: to.ep.id, json }); }
  }
  const kindOf = (o: unknown): string => {
    if (typeof o !== 'object' || o === null) return '?';
    const b: unknown = Reflect.get(o, 'b');
    const k: unknown = typeof b === 'object' && b !== null ? Reflect.get(b, 'k') : undefined;
    return typeof k === 'string' ? k : '?';
  };

  return {
    stats,
    now: (): number => now,
    add(ep: Endpoint, shape: LinkShape = SHAPES.clean ?? { lat: 0, jitter: 0, loss: 0, dup: 0, reorder: 0 }): void { peers.set(ep.id, { ep, shape, down: false, frozen: false, holdUntil: 0 }); },
    remove(id: string): void { peers.delete(id); q = q.filter(m => m.to !== id); },
    setRef(id: string): void { ref = id; },
    ref: (): string => ref,
    shape(id: string, s: LinkShape): void { const p = peers.get(id); if (p) p.shape = s; },
    /** The link goes down (everything to and from it is lost) or comes back. */
    down(id: string, on: boolean): void { const p = peers.get(id); if (p) p.down = on; },
    /** The phone is frozen (iOS suspend): its socket stays open, messages to it wait until it thaws. */
    freeze(id: string, on: boolean): void { const p = peers.get(id); if (p) p.frozen = on; },
    frozen: (id: string): boolean => peers.get(id)?.frozen ?? false,
    /** Holds everything to and from this phone until `until` (a burst: then it all arrives at once). */
    burst(id: string, until: number): void { const p = peers.get(id); if (p) p.holdUntil = until; },
    lastKey: (): string | null => lastKey,
    /** A phone (or the referee) sends a message into the room. */
    send(from: string, json: string): void {
      const fp = peers.get(from); if (!fp) return;
      stats.sent++;
      let o: unknown;
      try { o = JSON.parse(json); } catch { stats.refused++; return; }
      const k = kindOf(o);
      stats.bytesByKind[k] = (stats.bytesByKind[k] ?? 0) + json.length;
      if (from === ref){
        if (k === 'keyframe'){ lastKey = json; stats.maxKeyBytes = Math.max(stats.maxKeyBytes, json.length); }
        const to: unknown = typeof o === 'object' && o !== null ? Reflect.get(o, 'to') : undefined;
        for (const p of peers.values()) if (p.ep.id !== from && (to === undefined || to === p.ep.id)) queue(fp, p, json);
        return;
      }
      stats.maxPhoneBytes = Math.max(stats.maxPhoneBytes, json.length);
      if (json.length > PHONE_MAX_BYTES){ stats.refused++; return; }
      // the room stamps the sender: never trusted from the message itself
      if (typeof o === 'object' && o !== null) Reflect.set(o, 'from', from);
      const rp = peers.get(ref); if (rp) queue(fp, rp, JSON.stringify(o));
    },
    /** Virtual time passes: everything due by then is delivered, in time order. */
    advance(ms: number): void {
      const end = now + ms;
      for (;;){
        q.sort((a, b) => a.at - b.at || a.n - b.n);
        const i = q.findIndex(m => !(peers.get(m.to)?.frozen ?? false));
        const m = i >= 0 ? q[i] : undefined;
        if (!m || m.at > end) break;
        q.splice(i, 1);
        now = Math.max(now, m.at);
        const p = peers.get(m.to);
        if (p){ stats.delivered++; p.ep.deliver(m.json, now); }
      }
      now = end;
    },
    pending: (): number => q.length,
  };
}
export type SimBus = ReturnType<typeof simBus>;
