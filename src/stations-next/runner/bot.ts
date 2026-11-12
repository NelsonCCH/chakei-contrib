// 傳菜 runner computer driver (cover and tests). Stateless: every call reads the state and answers with the tilt a
// steady human would hold right now, or a pick at the pass after a short look at the tables. It steers along the
// floor plan's route (maze.ts lookahead, the prototype's own bot helper), keeps under the speed where a knock hurts, and
// brakes into the pocket below the sink speed. Honest: one table per trip by default,
// never clever about loads. The original prototype had no bot of its own; this one is new.
import type { StationCtx } from '../contract';
import type { RunnerCmd, RunnerState } from './core';
import { TUNE, at, layoutFor, lookahead, routeFrom } from './maze';

export interface RunnerBotOpts { load: number; look: number; cruise: number; gain: number }
export const BOT_DEFAULT: RunnerBotOpts = { load: 1, look: 0.6, cruise: 2.2, gain: 3 };

function avail(s: RunnerState): number {
  if (s.selfFeed) return Math.min(3, TUNE.orders - s.run.done - s.run.failed);
  const t: number[] = []; for (const w of s.pass) if (!t.includes(w.table)) t.push(w.table);
  return Math.min(3, t.length);
}
const level = (s: RunnerState): RunnerCmd | null => s.in.x === 0 && s.in.y === 0 ? null : { t: 'tilt', x: 0, y: 0 };

export function makeRunnerBot(opts: Partial<RunnerBotOpts> = {}): (s: RunnerState, ctx: StationCtx) => RunnerCmd | null {
  const o: RunnerBotOpts = { ...BOT_DEFAULT, ...opts };
  return (s: RunnerState): RunnerCmd | null => {
    if (s.st === 'pick') {
      const n = avail(s);
      if (n < 1 || s.trip.stT < o.look) return level(s);
      return { t: 'pick', n: Math.min(n, o.load) };
    }
    if (s.st !== 'play') return level(s);
    const L = layoutFor(s.trip.seed, s.dk), trip = s.trip, b = trip.ball, d = TUNE.diff[s.dk];
    // against a wall the ball's own route node can be blocked (routeFrom 1e9): rank by straight distance then, and
    // lookahead starts from the nearest open node
    let ti = -1, best = Infinity;
    for (const x of trip.orders) {
      if (x.done) continue;
      const h0 = at(L.targets, x.ti).hole, r0 = routeFrom(L, b.x, b.y, x.ti), r = r0 < 1e9 ? r0 : 1e6 + Math.hypot(h0.x - b.x, h0.y - b.y);
      if (r < best) { best = r; ti = x.ti; }
    }
    if (best >= 1e6) best -= 1e6;
    if (ti < 0) return level(s);
    const h = at(L.targets, ti).hole, dh = Math.hypot(h.x - b.x, h.y - b.y);
    const wp = dh < h.r + 0.25 ? h : lookahead(L, b.x, b.y, 14, ti, 0.12);
    const dx = wp.x - b.x, dy = wp.y - b.y, dw = Math.hypot(dx, dy) || 1e-6, ux = dx / dw, uy = dy / dw;
    const left = trip.orders.filter(x => !x.done).length, m = at(TUNE.mass, Math.max(0, left - 1));
    const brake = 0.45 * TUNE.acc / m;
    let vDes = Math.min(o.cruise, 0.45 * d.capV + Math.sqrt(2 * brake * Math.max(0, Math.min(best, dh + 0.5) - 0.25)));
    vDes = Math.min(vDes, 0.7 + 1.4 * dw);          // ease off before a turn (the waypoint is the corner)
    if (dh < h.r) vDes = Math.min(vDes, 0.45 * d.capV);
    const damp = trip.wet ? TUNE.wet.damp : TUNE.damp, roll = trip.wet ? TUNE.wet.roll : TUNE.roll;
    const vx = ux * vDes, vy = uy * vDes, ax = o.gain * (vx - b.vx), ay = o.gain * (vy - b.vy), sp = Math.hypot(b.vx, b.vy) || 1;
    let tx = (m * ax + damp * b.vx + roll * b.vx / sp) / TUNE.acc, ty = (m * ay + damp * b.vy + roll * b.vy / sp) / TUNE.acc;
    const tm = Math.hypot(tx, ty); if (tm > 1) { tx /= tm; ty /= tm; }
    return { t: 'tilt', x: tx, y: ty };
  };
}
export const runnerBot = makeRunnerBot();
