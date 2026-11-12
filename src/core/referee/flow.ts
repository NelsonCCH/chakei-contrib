// Walk-in queues, the hidden director and demand. For now this is the
// state and the hooks only: every value is the neutral value and every hook hands its input back unchanged, so a shift
// plays exactly as before. The referee owns this state (it is not in G, which stays the phone's view of the shift).

export interface DirectorState { on: boolean; budget: number; steered: number; total: number; load: Record<string, number> }
export interface FlowState {
  /** Per station: the group ids standing at that counter (walk-ins). Empty: no station takes walk-ins yet. */
  walkins: Record<string, number[]>;
  director: DirectorState;
  /** Spawn-rate multiplier from the number of player-driven seats; 1 when off. */
  demand: number;
}
/** A walk-in's way through the shop: where it orders, which stations make it, who packs it; it always pays at the till. */
export interface WalkinRoute { orderAt: string; make: string[]; pack: string | null; payAt: 'till' }

/** The director may steer at most this share of orders. */
export const DIRECTOR_CAP = 0.3;

export const parityFlow = (): FlowState => ({ walkins: {}, director: { on: false, budget: DIRECTOR_CAP, steered: 0, total: 0, load: {} }, demand: 1 });

let flow: FlowState = parityFlow();
export const flowState = (): FlowState => flow;
/** A new shift (or a new referee): back to the neutral values. */
export function flowReset(): void { flow = parityFlow(); }

/**
 * The director's hook, called for every new group (customers.ts makeGroup). Off (as it is now), it returns the group
 * untouched and draws nothing, so the customer stream is the same as without it. When built it may steer an order
 * toward an under-loaded seat while `steered / total` stays within DIRECTOR_CAP, drawing only from its own stream (a new parameter then).
 */
export function directorBias<T>(g: T): T {
  if (!flow.director.on) return g;
  flow.director.total++;
  return g;
}
/** The spawn gap scaled by demand (a rate multiplier, so the gap divides); 1 (off) leaves it exactly as it was. */
export const demandGap = (gap: number): number => flow.demand === 1 ? gap : gap / flow.demand;
