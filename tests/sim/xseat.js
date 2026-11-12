// A solo shift at an extra seat in memory: the shop's rules with the page's loop replaced by a fake
// clock, the four shop stations on the computer, the player at 傳菜 runner, 燒味 roast or 外賣 takeaway pressing
// through the station module's own bot (as tests/sim/coop.js does for a phone at an extra seat), on `pace` of the frames,
// or at a person's speed with `human` (tests/sim/human.js), optionally on one of the game's levels (`lv`).
import { freshCore, simPort, mulberry32 } from './core.js';
import { installLevel } from './levels.js';
import { makeHuman, makeHumanTake, AIM_SKILL, profileOf, PROFILES } from './human.js';
import { buildSync } from 'esbuild';
import { join } from 'node:path';

// the 外賣 station's own exports (its bot's plan, the tie path), for the person at the bench (human.js makeHumanTake)
const TK_CODE = buildSync({ entryPoints: [join(import.meta.dirname, '..', '..', 'src', 'stations-next', 'takeaway', 'index.ts')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false, logLevel: 'error' }).outputFiles[0].text;
export const TK = await import('data:text/javascript;base64,' + Buffer.from(TK_CODE).toString('base64'));

const PRESS = { roast: 'roastBotPress', runner: 'runnerBotPress', takeaway: 'takeawayBotPress' };
const STATE = { roast: 'roastState', runner: 'runnerState', takeaway: 'takeawayState' };

/** o: { seed, kind, slot = 'lunch', diff = 'pro', pace = .4 (share of frames the player acts on; 0 = never),
 *       human (a human.js profile; replaces pace), lv (a level id; replaces slot and diff) } */
export function runSeat(o) {
  const C = freshCore(), port = simPort(C);
  if (o.setup) o.setup(C);   // before anything runs (a workload spec to try, as tests/sim/shift.js)
  C.setRng(C.mulberry32(o.seed)); C.setPort(port);
  C.setStation('waiter'); C.setSlot(o.slot ?? 'lunch'); C.setDiff(o.diff ?? 'pro');
  const lvSet = o.lv ? installLevel(C, port, o.lv) : null;
  C.newGame(); C.resetClock();
  if (lvSet) lvSet();
  C.soloSeatStart(o.kind, 0);
  const G = C.G, rnd = mulberry32(o.seed ^ 0x5EA7), press = C[PRESS[o.kind]];
  // 燒味: the person's aim at a guide
  const aimOf = h => AIM_SKILL[typeof h === 'string' ? h : Object.keys(PROFILES).find(k => PROFILES[k] === profileOf(h))] ?? AIM_SKILL.mid;
  if (o.kind === 'roast') C.roastBotSkill(o.human ? (o.aim ?? aimOf(o.human)) : null);
  // 外賣 has its own hand: the coarse streamed model traced the knot at 5-7x par
  const take = o.human && o.kind === 'takeaway' ? makeHumanTake(mulberry32(o.seed * 131 + 1), o.human, TK) : null;
  const human = o.human && !take ? makeHuman(C, mulberry32(o.seed * 131 + 1), o.human, () => press(), { extra: true }) : null;
  const errs = [], fx = {};
  let now = 0, frames = 0, ends = 0, notMine = 0;
  for (; frames < 60 * 400; frames++) {
    if (G.running && !G.paused) C.advance(1 / 60, h => C.coopStep(h), () => C.G.running && !C.G.paused);
    C.coopFrame(now);
    if (G.running && G.roles[o.kind] !== 'me') notMine++;
    if (take) { const s = G.running && !G.paused ? C.takeawayState() : null, c = s ? take.next(s) : null; if (c) C.takeawayCommand(c); }
    else if (human) human.tick(now / 1000, G.running && !G.paused);
    else if (G.running && rnd() < (o.pace ?? .4)) press();
    if (o.each && G.running) o.each(C, 1 / 60);   // a per-frame probe (scripts/workload-calibrate.mjs)
    for (const e of C.drainFx()) { fx[e.k] = (fx[e.k] || 0) + 1; if (e.k === 'end') ends++; }
    now += 1000 / 60;
    if (!G.running && ends) break;
  }
  if (G.running) errs.push(`the shift never ended (t=${G.t.toFixed(1)})`);
  if (ends !== 1) errs.push(`'end' emitted ${ends} times`);
  if (notMine) errs.push(`the player lost the seat for ${notMine} frames`);
  return { C, G, errs, fx, st: C[STATE[o.kind]](), revenue: G.revenue, served: G.served, hand: take ? take.stats : human?.stats ?? null };
}
