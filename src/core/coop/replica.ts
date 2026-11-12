// The shared shift as it travels: `G` is each phone's view of the shift.
// Its shared fields (customers, tables, the pay queue, money, score, the clock) are the referee's; a teammate's phone
// holds a replica of them, rewritten from each keyframe. The station fields (core/coop/registry.ts PRIVATE_FIELDS) and
// the phone's own fields (roles, the station shown, the board, the redraw counter) never travel in a keyframe.
// The replica is updated in place (the same `G` object), so code holding G (juice.ts noteBad, the page) keeps working
// on a teammate's phone.
import { PRIVATE_FIELDS, PHONE_FIELDS } from './registry';

const NOT_SHARED = new Set<string>([...PHONE_FIELDS, ...Object.values(PRIVATE_FIELDS).flat()]);
export const isSharedField = (k: string): boolean => !NOT_SHARED.has(k);

/** Plain JSON of the shared fields of a shift (the slips being written stay with the waiter's phone). */
export function sharedOf(S: GameState): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(S)) if (isSharedField(k) && v !== undefined) o[k] = v;
  o.groups = S.groups.map(g => g.take ? g : { ...g, draft: null });
  const out: unknown = JSON.parse(JSON.stringify(o));
  return typeof out === 'object' && out !== null && !Array.isArray(out) ? Object.fromEntries(Object.entries(out)) : {};
}

/** Rewrites the shared fields of `S` in place from a keyframe's `shared`; this phone's slips (g.draft) are kept. */
export function applyShared(S: GameState, shared: Record<string, unknown>): void {
  const drafts = new Map<number, DraftLine[] | null | undefined>();
  for (const g of S.groups) if (!g.take) drafts.set(g.id, g.draft);
  for (const k of Object.keys(S)) if (isSharedField(k) && !(k in shared)) Reflect.deleteProperty(S, k);
  for (const [k, v] of Object.entries(shared)) if (isSharedField(k)) Reflect.set(S, k, structuredClone(v));
  for (const g of S.groups) if (!g.take) g.draft = drafts.get(g.id) ?? null;
}
