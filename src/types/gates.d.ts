// Types owned by src/gates.ts (global, type-only).

/** An unlock gate: a system that opens with progress, announced once with a pop-up card. */
interface Gate { k: string; ok: () => boolean; need: string; title: string; text: string; go: () => void }
interface Shop {
  /** Gates already announced (or open when this save first met the gate system). */
  gates?: string[];
}
