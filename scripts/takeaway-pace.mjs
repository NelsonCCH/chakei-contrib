// Measures the 外賣 seat's pace per step at a person's speed: a solo shift at the takeaway seat
// (tests/sim/xseat.js runSeat, the computer on the shop's four) played by the human model (tests/sim/human.js), on the
// levels with the 外賣 role and free play. Every frame of the shift is put in one bucket by what the seat is doing:
//   items   dragging the slip's food and drinks into the bag (one of them is on the counter, or in the finger)
//   extras  the trays: cutlery, napkins, straws, sugar, syrup (also while an item is still being made)
//   wait    the slip is in turn, its extras are in, its next item is still being made (the kitchen / bar, not the player)
//   tieBtn  everything is in: pressing 綁袋
//   tie     tracing the knot (the 0.35 s intro included)
//   fx      the knot's finish (fixed 1.21 s: hand, cinch, hold)
//   hand    dragging the tied bag to the customer at the door
//   idle    no slip open
// and prints seconds per bag for each, the bags handed over and the orders the shift brought, per level x profile.
// The "work" column is every bucket but wait and idle: a person's seconds per bag, the load table's `bag` (load.ts).
//   node scripts/takeaway-pace.mjs [--seeds 6] [--levels airport,typhoon,latenight,free] [--profiles first,mid,skilled]
import { runSeat } from '../tests/sim/xseat.js';
import { PROFILE_IDS } from '../tests/sim/human.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const seeds = Number(arg('seeds', 6)), levels = arg('levels', 'airport,typhoon,latenight,free').split(','), profiles = arg('profiles', PROFILE_IDS.join(',')).split(',');
const BUCKETS = ['items', 'wait', 'extras', 'tieBtn', 'tie', 'fx', 'hand', 'idle'];
const WORK = ['items', 'extras', 'tieBtn', 'tie', 'fx', 'hand'];

function need(o) {
  const d = o.items.filter(i => i.kind === 'drink');
  return { cut: o.people, nap: o.people, str: d.filter(i => !i.hot).length, sug: d.filter(i => i.hot && i.mod !== '走甜').length, syr: o.items.filter(i => i.syrup).length };
}
function bucket(s) {
  if (s.phase === 'tie') return 'tie';
  if (s.phase === 'fx') return 'fx';
  if (s.phase === 'hand') return 'hand';
  const a = s.orders.find(o => !o.done);
  if (!a) return 'idle';
  const ids = new Set(a.items.filter(i => !i.packed).map(i => i.id));
  if (s.drag?.kind === 'item' || s.counter.some(c => c && ids.has(c.id))) return 'items';
  const n = need(a);
  if (Object.keys(n).some(k => s.bag.ex[k] !== n[k])) return 'extras';   // the trays, also while an item is being made
  return ids.size ? 'wait' : 'tieBtn';
}

export function measure(lv, profile, seed) {
  const sec = Object.fromEntries(BUCKETS.map(b => [b, 0])), seen = new Set();
  let ties = 0, par = 0, items = 0;
  const each = (C, dt) => { const s = C.takeawayState(); if (!s) return; sec[bucket(s)] += dt; for (const o of s.orders) seen.add(o.gid); };
  const r = runSeat({ seed, kind: 'takeaway', human: profile, ...(lv === 'free' ? { diff: 'pro', slot: 'lunch' } : { lv }), each });
  const s = r.st;
  for (const t of s.ties) { ties += t.time; par += t.par; }
  for (const o of s.orders) if (o.done) items += o.items.length;
  return { sec, read: r.hand?.by?.read ?? 0, offs: r.hand?.offs ?? 0, bags: s.results.length, offered: seen.size, items, tieTime: ties, tiePar: par, nTies: s.ties.length, knot: s.knot, err: r.errs.join('; ') || null };
}

const f1 = v => v.toFixed(1);
console.log(`| level | profile | knot tier | bags / offered | items a bag | ${BUCKETS.join(' | ')} | work s a bag | tie / par | capacity (bags in 180 s of work) | of which read the slip | offs a tie |`);
console.log(`|---|---|---|---|---|${BUCKETS.map(() => '---').join('|')}|---|---|---|---|---|`);
for (const lv of levels) for (const p of profiles) {
  const rs = Array.from({ length: seeds }, (_, i) => measure(lv, p, 3000 + i * 37));
  const bad = rs.filter(x => x.err); if (bad.length) console.log('ERRORS', bad.map(x => x.err));
  const bags = rs.reduce((a, x) => a + x.bags, 0), per = b => rs.reduce((a, x) => a + x.sec[b], 0) / Math.max(1, bags);
  const work = WORK.reduce((a, b) => a + per(b), 0), tie = rs.reduce((a, x) => a + x.tieTime, 0), par = rs.reduce((a, x) => a + x.tiePar, 0);
  console.log(`| ${lv} | ${p} | ${rs[0].knot} | ${f1(bags / seeds)} / ${f1(rs.reduce((a, x) => a + x.offered, 0) / seeds)} | ${f1(rs.reduce((a, x) => a + x.items, 0) / Math.max(1, bags))} | ${BUCKETS.map(b => f1(per(b))).join(' | ')} | ${f1(work)} | ${f1(tie / Math.max(1, rs.reduce((a, x) => a + x.nTies, 0)))} / ${f1(par / Math.max(1, rs.reduce((a, x) => a + x.nTies, 0)))} | ${f1(180 / Math.max(0.1, work))} | ${f1(rs.reduce((a, x) => a + x.read, 0) / Math.max(1, bags))} | ${f1(rs.reduce((a, x) => a + x.offs, 0) / Math.max(1, rs.reduce((a, x) => a + x.nTies, 0)))} |`);
}
