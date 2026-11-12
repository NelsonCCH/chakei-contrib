// How long each seat stands idle (party nights): a co-op room (coop.js runCoop) with
// `n` players at the mid human profile (human.js) in the seats' pick order, the computer at the rest. A seat is idle while
// its station has nothing waiting (core/coop/registry.ts waiting(): the waiter's queue, orders to take and dirty tables,
// the bar's and the kitchen's open lines, the till's bills, 傳菜's pass and tray, the sink's pieces, the bags to pack, the
// roast orders), read every frame on the phone that drives it. A seat's longest idle is its longest such stretch from its
// first work to the bell. The time before a seat's first work (the shop opening) is not counted.
// Beside it, the real-work gap: the longest stretch in which the seat's phone sent no result to the room (a job
// done, a line made, a bill paid), from its first result to the bell: waiting work it could not act on counts here.
import { runCoop } from './coop.js';
import { freshCore } from './core.js';
import { LEVELS } from './levels.js';

const FOUR = ['waiter', 'bar', 'kitchen', 'till'];
const C0 = freshCore();

/** The seats in the order players take them: a party shop's (partySeats), else the four then the level's roles. */
export function seatOrder(mode, id) {
  return mode === 'party' ? C0.partySeats(id) : [...FOUR, ...C0.levelRoles(LEVELS[id])];
}

/**
 * One room: { idle: { seat: longest idle s }, gap: { seat: longest real-work gap s }, results: { seat: n }, seats, dir,
 * spd, report } for the seats the players hold. mode 'party': a party round in shop `id` (its lunch round's length);
 * 'level': a co-op shift on level `id`. `seats`: the players' seats (default: the first n of the pick order); `lazy`:
 * { seat: [from, to] } game seconds in which that seat's player does nothing (the "one player idle" guard); `each`: also
 * called every frame with runCoop's frame view; `floorOn`: a party round's switched-on 樓面 places.
 */
export function longestIdle({ mode, id, n, seed, profile = 'mid', lazy = null, seats: pick = null, each: also = null, floorOn = undefined }) {
  const all = seatOrder(mode, id), seats = pick ?? all.slice(0, n), extras = all.filter(s => !FOUR.includes(s) && !/^floor\d$/.test(s));
  const human = Object.fromEntries(seats.map((_, i) => [i, profile]));
  const idle = {}, first = {}, run = {}, gap = {}, lastRes = {}, results = {};
  let wrapped = null;
  const each = (o) => {
    const { t, phones, bus } = o;
    if (wrapped !== bus) {
      wrapped = bus; const send = bus.send.bind(bus);
      bus.send = (from, json) => {
        if (json.includes('"res"')) {
          const ph = phones.find(p => p.id === from), e = JSON.parse(json);
          if (ph && ph.seat && e.b && e.b.k === 'res') {
            const st = ph.seat, now = ph.C.G ? ph.C.G.t : 0;
            if (lastRes[st] !== undefined) gap[st] = Math.max(gap[st] ?? 0, now - lastRes[st]);
            lastRes[st] = now; results[st] = (results[st] ?? 0) + 1;
          }
        }
        return send(from, json);
      };
    }
    for (const ph of phones) {
      const st = ph.seat; if (!st || !ph.C.G.running) continue;
      // 樓面: its bubbles a person can act on now, and a job in hand
      const m = ph.C.stationOf(st), w = /^floor\d$/.test(st) ? ph.C.floorOpen(ph.C.G) + (ph.human?.busy?.() ? 1 : 0) : m ? m.waiting(ph.C.G) : 0;
      if (w > 0) {
        if (first[st] === undefined) first[st] = t;
        if (run[st] !== undefined) { idle[st] = Math.max(idle[st] ?? 0, t - run[st]); delete run[st]; }
      } else if (first[st] !== undefined && run[st] === undefined) run[st] = t;
    }
    if (also) also(o);
  };
  const sec = C0.ROUND_SEC.lunch;
  const lazyOf = lazy ? Object.fromEntries(Object.entries(lazy).map(([st, w]) => [seats.indexOf(st), w])) : undefined;
  const r = mode === 'party'
    ? runCoop({ seed, seats, slot: 'lunch', party: { shop: id, sec, round: 0, ...(floorOn === undefined ? {} : { floorOn }) }, extraSeats: extras, human, maxSec: sec + 20, shape: 'clean', each, lazy: lazyOf })
    : runCoop({ seed, seats, lv: id, slot: LEVELS[id].slot, extraSeats: extras, human, shape: 'clean', each, lazy: lazyOf });
  const end = r.S.t;
  for (const [st, a] of Object.entries(run)) idle[st] = Math.max(idle[st] ?? 0, end - a);   // a stretch open at the bell
  for (const [st, a] of Object.entries(lastRes)) gap[st] = Math.max(gap[st] ?? 0, end - a);
  for (const st of seats) if (first[st] !== undefined) idle[st] ??= 0;
  const G = r.room.C.G, copy = v => v ? JSON.parse(JSON.stringify(v)) : null;
  return { idle, gap, results, seats, errs: r.errs, dir: copy(G.dir), spd: copy(G.spd), floor: copy(G.floor?.stats), report: mode === 'party' ? copy(r.room.C.roomReport()) : null };
}
