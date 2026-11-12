// 送外賣 riders for the traffic guard: a person reading the road, at a profile's speed.
//
// The rider sees a row of traffic once its front is within TUNE.reach.view m of the bike (what the smallest phone screen
// shows), decides on it after a reaction time, and then taps toward the open lane nearest to the lane it is in, one tap per
// tap gap. It never leaves its lane while a vehicle of the row it is passing is beside it: it waits until the bike is
// past that row (plus a timing slack: a planned tap still lands a moment late). The gear thumb is separate: it taps
// 加速 whenever the cooldown allows, up to its gear cap.
//
// `skilled` with `exact: true` is the guard's rider: react and tap gap are the human model's skilled medians (human.js
// PROFILES.skilled: react, 1 / stream), every time exactly that, and it never looks away. The generator promises such a
// rider never crashes at any gear, tier or bag load. A profile rider (`exact: false`) draws each time log-normally
// around the profile's median (sd), looks away every ~lookEvery s for `look` s (rows that come into view meanwhile are
// noticed only when it looks back), so its success rate is a measurement, not a promise.
import { PROFILES } from './human.js';

/** Groups the station's vehicles into rows (vehicles of a row share their front edge; all traffic moves together). */
export function rowsOf(cars) {
  const rows = [];
  // fronts within 1 cm are one row (float drift); rows are at least TUNE.reach.minGap apart
  for (const c of [...cars].sort((a, b) => (a.y - a.len / 2) - (b.y - b.len / 2))) {
    const front = c.y - c.len / 2, last = rows.at(-1);
    if (last && front - last.front < 0.01) { last.cars.push(c); last.rear = Math.max(last.rear, front + c.len); last.key = last.cars.map(x => x.id).sort((a, b) => a - b).join(','); }
    else rows.push({ key: String(c.id), front, rear: front + c.len, cars: [c] });
  }
  return rows;
}
/** Lanes a row may hold: a vehicle's lane, the lane it is moving to, and the lane it plans to change to. */
export const blockedOf = r => new Set(r.cars.flatMap(c => [c.lane, c.to, ...(c.plan >= 0 ? [c.plan] : []), Math.round(c.x)]));

/**
 * A rider for core `M` (the station module's exports). profile: a PROFILES id; gear: its gear cap; exact: the guard's
 * fixed skilled timing; rnd: () => [0, 1) for the draws; view: metres the screen shows ahead (default TUNE.reach.view;
 * a measurement may give a screen that shows less).
 */
export function makeRider(M, { profile = 'skilled', gear = M.TOP, exact = false, rnd = Math.random, view = M.TUNE.reach.view } = {}) {
  const P = PROFILES[profile], R = { view };
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const draw = m => (exact ? m : m * Math.exp(P.sd * gauss()));
  const tapGap = () => draw(1 / P.stream);
  const ready = new Map();                    // row key -> time the rider has decided on it
  let clearT = 0, lastTap = -1, passed = new Set(), nextLook = exact ? Infinity : draw(P.lookEvery), lookEnd = -1, slack = tapGap();
  return (s, t) => {
    if (s.st !== 'ride' || !s.run) return null;
    if (t >= nextLook) { lookEnd = t + draw(P.look); nextLook = lookEnd + draw(P.lookEvery); }
    const away = t < lookEnd, front = s.pos + M.TUNE.riderLen / 2, back = s.pos - M.TUNE.riderLen / 2;
    const rows = rowsOf(s.cars);
    for (const r of rows) {
      if (!ready.has(r.key) && !away && r.front <= s.pos + R.view) ready.set(r.key, t + draw(P.react));
      if (r.rear <= back && !r.cars.some(c => passed.has(c.id))) { for (const c of r.cars) passed.add(c.id); clearT = t; slack = tapGap(); }   // by vehicle: a row loses its rear vehicles behind the bike
    }
    const beside = rows.some(r => r.front < front && r.rear > back);
    const next = rows.find(r => r.front >= front);
    if (!beside && next && (ready.get(next.key) ?? Infinity) <= t && t >= clearT + slack && t >= lastTap + 1 / P.stream) {
      const blocked = blockedOf(next), free = [0, 1, 2].filter(L => !blocked.has(L));
      if (free.length && !free.includes(s.lane)) {
        const to = free.reduce((a, b) => (Math.abs(b - s.lane) < Math.abs(a - s.lane) ? b : a));
        lastTap = t;
        return { t: 'lane', d: to > s.lane ? 1 : -1 };
      }
    }
    if (s.gear < gear && s.gearCd <= 0) return { t: 'gear' };
    return null;
  };
}

/**
 * Rides one lab run of `bags` orders on `tier` with `rider` (makeRider), stepping the core at its own inner step.
 * Returns { crashes, secs, fast, out, drops, rows } (out: every result) (rows: every row the road made, in road order, for the generator checks).
 */
export function rideRun(M, { tier, bags, seed, rider, rng, ctxFor, maxT = 400 }) {
  const s = M.init({ difficulty: 'pro', seed, players: 1, tier });
  const seen = new Map();
  let t = 0, shift = 0;
  M.deliver.command(s, { t: 'start', n: bags }, ctxFor(0, rng));
  const out = [];
  while (t < maxT && s.st !== 'home') {
    const ctx = ctxFor(t, rng);
    const c = rider(s, t); if (c) out.push(...M.deliver.command(s, c, ctx));
    out.push(...M.deliver.step(s, M.DT, ctx));
    t += M.DT; shift += M.TUNE.vTraffic * M.DT;
    // every vehicle as it was made (y back on the road's own frame: traffic moves together, so rows keep their shape)
    for (const v of s.cars) if (!seen.has(v.id)) seen.set(v.id, { id: v.id, k: v.k, len: v.len, lane: v.lane, plan: v.plan, y: v.y - shift, x: v.x, to: v.to });
  }
  const back = out.find(r => r.kind === 'back');
  return {
    crashes: out.filter(r => r.kind === 'crash').length, secs: back ? back.secs : Infinity,
    out, drops: out.filter(r => r.kind === 'dropped'), fast: out.filter(r => r.kind === 'dropped' && r.fast).length, rows: rowsOf([...seen.values()]),
  };
}
