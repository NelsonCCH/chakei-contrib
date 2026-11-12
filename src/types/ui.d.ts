// Types owned by src/ui.ts.
/** A hint or floating text for a teammate's station, queued by the host (net.js) and shown on that teammate's phone. */
interface NetEvent { role: string; msg?: string; float?: [number | null, string, string] }
