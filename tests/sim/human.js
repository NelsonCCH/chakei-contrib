// A human-speed player for the simulations. The sim bots (bots.js) decide what a player would press; this file
// decides WHEN, at a person's speed instead of the bots' "40% of frames" (about 24 presses a second).
//
// How it works: when the person is free, the station's bot is asked for its next press with the shop's hook table
// (CORE_HOOK) swapped for recorders, so nothing happens yet. The press is then paid for in time (below) and made for real
// when that time is up, on whatever the shop looks like by then, as a person's tap lands after they have decided and
// moved. An order slip is planned whole (the bot writes it from the customers' order, which does not change) and then
// written one press at a time. A bot that has nothing to press means the person is idle: they look again shortly.
//
// An extra seat (runner, roast, takeaway) is steered, not tapped: its bot makes small steps (a tilt, a stroke,
// a trace) on 40% of frames, about 24 a second; a person makes `stream` a second, with the same look-arounds (coarse).
//
// What a press costs (seconds; every time is drawn from a log-normal around the profile's median, sd `sd`):
//   decide  picking a new job (a group to seat, a table, a ticket, a meal, a line to strike, boiling the pot, dumping a
//           wrong cup): reaction / choice time `react` (Hick-Hyman with a few alternatives, plus KLM's mental step)
//   move    every press: finding and hitting the button on a phone (Fitts' law on a touch screen) `move`
//   search  a press among n buttons (the slip's menu, the ingredients, the stoves, the notes): `hick` x log2(n + 1)
//   read    reading the customers' order off a slip, per diner, before writing it (`read`); half of it for a ticket
//   math    the till: adding the bill (`mathLine` per line) before keying the total, working out the change (`mathChange`)
// and, around the presses:
//   look    every ~`lookEvery` s the person glances round the shop (queue, HUD, other screens) for `look` s
//   forget  after finishing a job, with chance `forget`, a lapse of `forgetSec` s before the next one
//   slip    a press misses (chance `slip`): it costs another move and a moment to notice, nothing in the shop changes
//   err     wrong item / wrong total / short cup that reaches the shop (the bots' own mistake paths), per decision point
// The numbers and their sources are in the comments below.
//
// 斬料 is cutting along dashed guides: the person presses at their own pace like any seat, and each cut lands
// off the guide by a Gaussian error of spread AIM_SKILL (the station's bot draws it).

/** The three people the calibration targets. `first`: their first shifts, reading everything. `mid`: knows the screens,
 *  still reads orders. `skilled`: fluent, the menu in their head. */
export const PROFILES = {
  first:   { name: 'first-timer', react: 1.0, move: .45, hick: .20, read: .9,  mathLine: 1.0, mathChange: 2.0, slip: .05,  err: .08,  lookEvery: 6,  look: .9, forget: .10, forgetSec: 2.5, poll: .45, stream: 5, sd: .3 },
  mid:     { name: 'mid',         react: .8,  move: .36, hick: .12, read: .6,  mathLine: .7,  mathChange: 1.4, slip: .03,  err: .04,  lookEvery: 8,  look: .6, forget: .05, forgetSec: 2,   poll: .35, stream: 8, sd: .25 },
  skilled: { name: 'skilled',     react: .6,  move: .28, hick: .06, read: .35, mathLine: .45, mathChange: .9,  slip: .015, err: .015, lookEvery: 10, look: .4, forget: .02, forgetSec: 1.5, poll: .25, stream: 11, sd: .2 },
};
export const PROFILE_IDS = Object.keys(PROFILES);
/** The hand at the 外賣 bench (makeHumanTake below). trace: the finger's speed along the knot as a share of the
 *  tier's par speed (par is "a careful hand"; the same curve law slows it in tight bends); aim: the finger's drift
 *  off the line, css px SD, smooth (a finger wanders, it does not jitter); drag: css px/s carrying an item or the bag.
 *  A finger steering along a drawn 12 mm channel on a phone runs about 50-150 mm/s (steering-law studies on touch
 *  screens); par speeds are 40-85 mm/s at 0.165 mm a css px, so a mid hand at 0.85 x par is a careful, not a fast, one. */
export const TAKE_HAND = {
  first: { trace: 0.7, aim: 6, drag: 260 },
  mid: { trace: 0.85, aim: 5, drag: 340 },
  skilled: { trace: 1.0, aim: 4, drag: 440 },
};
/** A person's aim at a cutting guide: one SD of where the finger lands, in the roast's logical px (1 logical px
 *  = 3 css px, about 0.5 mm on an iPhone). A finger's own imprecision on a touch screen is about 1.5 mm SD (Bi, Li and
 *  Zhai, FFitts law, CHI 2013): the first-timer; practice and a clear dashed line narrow it. */
export const AIM_SKILL = { first: 3.0, mid: 2.5, skilled: 2.0 };
export const profileOf = p => (typeof p === 'string' ? PROFILES[p] : p);

const TAPS = ['tapTable', 'tapGroup', 'sheetAct', 'barKey', 'pickLine', 'kitKey', 'pickPlate', 'assignMeal', 'tillKey', 'strikeLine', 'deselect', 'closeSheet'];
const DECIDE = new Set(['tapTable', 'tapGroup', 'pickLine', 'assignMeal', 'strikeLine', 'pickPlate']);
const DONE = new Set(['send', 'later', 'serve', 'ok']);   // a press that finishes a job (a lapse may follow)
const STOP = Symbol('stop');
const bits = n => Math.log2(n + 1);

/**
 * A person at one station. `press` is the bot's function for it (bots.js makeBots(C, rnd, profile.err)[station]), or for
 * an extra seat the station module's own bot press, which cannot be recorded: each call is then one streamed step (above).
 * `before` runs just before a press lands (co-op: C.noteInput(seat)).
 */
export function makeHuman(C, rnd, profile, press, { extra = false, before = null, tag = null } = {}) {
  const P = profileOf(profile), H = C.CORE_HOOK;
  // by: busy seconds per task key when `tag(press)` names one (scripts/workload-calibrate.mjs)
  const st = { taps: 0, decisions: 0, idle: 0, look: 0, lapse: 0, slips: 0, busy: 0, by: {} };
  let nextAt = 0, pending = null, queue = [], nextLook = 0, lastNow = 0;
  const gauss = () => { const u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const draw = m => m * Math.exp(P.sd * gauss());
  const seen = new Set();   // till bills already added up / change already worked out

  /** The bot's next press(es), recorded, not made. A slip being written comes back whole. */
  function plan() {
    if (extra) return [{ fn: 'press', args: [] }];
    const out = [], G = C.G, whole = !!G.sheet, saved = {};
    for (const k of TAPS) { saved[k] = H[k]; H[k] = (...args) => { out.push({ fn: k, args }); if (!whole) throw STOP; }; }
    try { press(); } catch (e) { if (e !== STOP) throw e; } finally { Object.assign(H, saved); }
    if (out.length && whole) { const g = C.byId(G.sheet.gid); out[0].read = (g ? g.persons.length : 1) * P.read; for (const x of out) x.gid = G.sheet.gid; }
    return out;
  }
  /** Seconds before tap `x` lands. */
  function cost(x) {
    const G = C.G, a = x.args[0];
    // an extra seat's bot steers in small steps (a tilt, a stroke, a trace): a person streams them at `stream` a second
    if (x.fn === 'press') return draw(1 / P.stream);
    let s = draw(P.move);
    if (DECIDE.has(x.fn)) { s += draw(P.react); st.decisions++; if (x.fn === 'pickLine' || x.fn === 'assignMeal') s += draw(P.read) * .5; }
    else if (x.fn === 'sheetAct') s += a && a.add ? draw(P.hick) * bits(12) : a && a.act ? 0 : draw(P.hick) * bits(3);
    else if (x.fn === 'barKey') s += a === 'pot' || a === 'dump' ? draw(P.react) : a === 'serve' ? 0 : a === 'hot' || a === 'cold' ? draw(P.hick) * bits(2) : draw(P.hick) * bits(8);
    else if (x.fn === 'kitKey') s += a === 'dump' ? draw(P.react) : a === 'serve' ? 0 : draw(P.hick) * bits(10);
    else if (x.fn === 'tillKey') {
      const c = G.cur;
      if (G.step === 'total') {
        if (c && !seen.has(c.id + 't')) { seen.add(c.id + 't'); s += draw(P.mathLine) * c.payLines.filter(l => !l.struck).length + draw(P.react); st.decisions++; }
        s += a === 'ok' || a === 'clr' ? 0 : draw(P.hick) * .3 * bits(10);
      } else {
        if (c && !seen.has(c.id + 'c')) { seen.add(c.id + 'c'); s += draw(P.mathChange); }
        s += a === 'ok' ? 0 : draw(P.hick) * bits(7);
      }
    }
    if (x.read) s += draw(x.read);
    if (rnd() < P.slip) { s += draw(P.move) + draw(.5); st.slips++; }
    return s;
  }
  function land(x) {
    // the slip being written closed under the pen (the group left, a teammate's keyframe): drop the rest of it
    if (x.gid !== undefined && (!C.G.sheet || C.G.sheet.gid !== x.gid)) { queue = []; return 0; }
    if (before) before();
    st.taps++;
    if (x.fn === 'press') press(); else H[x.fn](...x.args);
    if (DONE.has(x.fn === 'sheetAct' ? x.args[0] && x.args[0].act : x.args[0]) && rnd() < P.forget) { const d = draw(P.forgetSec); st.lapse += d; return d; }
    return 0;
  }
  /** Call every frame with the person's clock (real seconds); `active`: the person may act now (shift running, own seat). */
  function tick(now, active = true) {
    if (!active) { pending = null; queue = []; nextAt = Math.max(nextAt, now); lastNow = now; return; }
    if (pending && now >= nextAt) { const late = land(pending); pending = null; st.busy += 0; if (late) { nextAt = now + late; lastNow = now; return; } }
    if (pending || now < nextAt) { lastNow = now; return; }
    if (!nextLook) nextLook = now + draw(P.lookEvery);
    if (!queue.length && now >= nextLook) { const d = draw(P.look); st.look += d; nextAt = now + d; nextLook = now + d + draw(P.lookEvery); return; }
    if (!queue.length) queue = plan();
    if (!queue.length) { const d = draw(P.poll); st.idle += d; nextAt = now + d; return; }
    pending = queue.shift();
    const c = cost(pending), k = tag ? tag(pending) : null;
    if (k) st.by[k] = (st.by[k] || 0) + c;
    st.busy += c; nextAt = now + c; lastNow = now;
  }
  return { tick, stats: st, profile: P };
}

/**
 * A person at the 外賣 bench, replacing the coarse streamed model for this seat. The coarse model streamed the
 * station bot's steps at `stream` a second, but the bot's trace steps are sized for 40 a second (bot.ts BOT.move
 * 0.025 s), so the finger crept along the knot at about a fifth of the bot's speed: ties at 5-7x par. Here the
 * station's bot only decides WHAT comes next (bot.ts plan: which item to drag, which tray to tap, 綁袋, the hand-over) and
 * the person pays for each gesture in time, then makes it on whatever the bench looks like by then:
 *   read    a new slip: react + read per item + half a read for the people count and the red note
 *   item    find and reach an item on the counter (react / 2 + move), carry it to the bag at TAKE_HAND.drag px/s
 *   extras  a tray: Hick over the five trays + a move; the same tray again is a quick re-tap (0.25 s)
 *   tieBtn  綁袋: a move
 *   start   find the knot's 起 and put the finger down: react + move
 *   trace   along the knot at TAKE_HAND.trace x the tier's par speed, slowed in tight bends by par's own curve law, the
 *           finger drifting `aim` px off the line (smooth); off the line: notice (react / 2), back to the glowing head
 *   hand    pick up the tied bag (react / 2 + move), drag it to the customer at the door
 * with look-arounds and a lapse after a bag now and then, as the main model. T: the takeaway station's exports
 * (src/stations-next/takeaway/index.ts). next(s) -> command | null, once a frame, on the station's clock.
 */
export function makeHumanTake(rnd, profile, T) {
  const P = profileOf(profile), id = typeof profile === 'string' ? profile : Object.keys(PROFILES).find(k => PROFILES[k] === P);
  const K = TAKE_HAND[id] ?? TAKE_HAND.mid;
  const gauss = () => { const u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const draw = m => m * Math.exp(P.sd * gauss());
  const st = { by: { read: 0, item: 0, extras: 0, tieBtn: 0, start: 0, trace: 0, off: 0, hand: 0, look: 0, lapse: 0, idle: 0 }, bags: 0, offs: 0 };
  const rng = { next: rnd };
  let hold = 0, lastT = 0, queue = [], lastNo = -1, lastTray = null, nextLook = null, handed = 0, tie = null;
  const cmd = (s, k, x, y) => ({ k, x: x / s.view.S, y: y / s.view.S, cx: x, cy: y, ms: s.t * 1000 });   // from css px
  const wait = (s, d, k) => { st.by[k] += d; hold = s.t + d; return null; };

  function trace(s, dt) {
    const Tt = s.tie;
    if (s.t < Tt.readyAt) return null;
    if (!tie || tie.key !== Tt.startT) { tie = { key: Tt.startT, ti: 0, ax: 0, ay: 0, off: false }; return wait(s, draw(P.react) + draw(P.move), 'start'); }
    const a = 0.94, b = Math.sqrt(1 - a * a) * K.aim;
    tie.ax = a * tie.ax + b * gauss(); tie.ay = a * tie.ay + b * gauss();
    const pt = (k, i) => { const q = T.tieAt(Tt, Math.round(i)); return cmd(s, k, q[0] + tie.ax, q[1] + tie.ay); };
    if (!s.f.down) { tie.ti = Tt.i; return pt('down', tie.ti); }
    if (!Tt.on) {
      if (!tie.off) { tie.off = true; st.offs++; return wait(s, draw(P.react) * 0.5, 'off'); }
      tie.off = false; tie.ti = Tt.i; tie.ax = tie.ay = 0; return pt('move', tie.ti);
    }
    tie.off = false;
    const path = T.tiePath(Tt), v = T.knotSpeed(Tt.tier) * K.trace, acc = v * v / T.TUNE.par.rFull, i0 = Math.round(tie.ti);
    let r = 1e9; for (let i = i0; i < Math.min(Tt.n, i0 + 6); i++) r = Math.min(r, path.info.rad[i] ?? 1e9);
    // the eye stays on the glowing head: the finger never runs more than a few samples ahead of it
    tie.ti = Math.min(Tt.n - 1, Tt.i + 8, tie.ti + Math.min(v, Math.sqrt(acc * r)) * dt / T.TUNE.trace.step);
    st.by.trace += dt;
    return pt('move', tie.ti);
  }

  function next(s) {
    if (s.over) return null;
    const now = s.t, dt = Math.max(0, now - lastT); lastT = now;
    if (s.results.length > handed) { handed = s.results.length; st.bags++; if (rnd() < P.forget) { const d = draw(P.forgetSec); st.by.lapse += d; hold = Math.max(hold, now + d); } }
    if (now < hold) return null;
    if (queue.length) { if (now < queue[0].at) return null; const c = queue.shift().cmd; return 'ms' in c ? { ...c, ms: now * 1000 } : c; }
    if (s.phase === 'tie' && s.tie) return trace(s, dt);
    if (s.f.down) return cmd(s, 'up', s.f.x, s.f.y);
    if (s.phase !== 'pack' && s.phase !== 'hand') return null;
    const steps = T.plan(s, rng);
    if (!steps.length) return wait(s, draw(P.poll), 'idle');
    if (nextLook === null) nextLook = now + draw(P.lookEvery);
    if (now >= nextLook) { const d = draw(P.look); nextLook = now + d + draw(P.lookEvery); return wait(s, d, 'look'); }
    const L = T.LY(s), d0 = steps[0].cmd, a = T.active(s);
    let kind, c = 0, dur = 0, read = 0;
    if (s.phase === 'hand') kind = 'hand';
    else if (steps.length > 2) kind = 'item';
    else kind = T.inR(L.tieBtn, d0.x, d0.y, 2) ? 'tieBtn' : 'extras';
    if (a && a.no !== lastNo) { lastNo = a.no; read = draw(P.react) + draw(P.read) * (a.items.length + 0.5); st.by.read += read; }
    if (kind === 'item' || kind === 'hand') {
      const e = steps[steps.length - 1].cmd;
      c += draw(P.react) * 0.5 + draw(P.move); dur = Math.max(0.15, Math.hypot(e.cx - d0.cx, e.cy - d0.cy) / K.drag);
    } else if (kind === 'extras') {
      const tray = T.EXK.find(k => T.inR(T.trayRect(L, k), d0.x, d0.y)) ?? 'undo';
      c += tray === lastTray ? draw(0.25) : draw(P.hick) * bits(5) + draw(P.move); lastTray = tray;
    } else c += draw(P.move);
    if (kind !== 'extras') lastTray = null;
    if (rnd() < P.slip) c += draw(P.move) + draw(.5);
    st.by[kind] += c + dur;
    const gapOf = steps.length > 2 ? dur / (steps.length - 1) : 0.08;
    queue = steps.map((x, i) => ({ cmd: x.cmd, at: now + read + c + i * gapOf }));
    return null;
  }
  return { next, stats: st, profile: P };
}
