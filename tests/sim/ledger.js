// The simulations' referee: watches a shift through the rules' own hook table (core/hooks.ts CORE_HOOK, the path every
// caller takes) and checks after every step and every player action that the shop's books stay straight:
// - every customer group has exactly one ending (left, took their takeaway, paid at the till, paid the computer cashier,
//   walked out without paying, vanished as a ghost) or is still in the shop when the shift ends; none comes back;
// - money adds up: revenue minus tips only grows by payments (what the till charged, what the computer cashier took, a
//   takeaway's price, a ghost's money); tips only grow where tips are paid, by the amounts the rules promise; every bill
//   that reached the till is paid in full (charged + short-changed), walked out on, or still waiting; loss is exactly
//   what was written off;
// - no order line is lost or done twice: a group's lines are its slip, in order, for good; a line turns done once per
//   time it is made (again only after the customer sent it back); a bar or kitchen played by a person counts one cup or
//   dish per line made;
// - combo, fever, the good-deed count, paid and served counts agree with what happened; counters never go down;
// - no NaN anywhere in the state.
// A broken rule is reported with the game time it happened at (the first 20 are kept).

export function makeLedger(C) {
  const H = C.CORE_HOOK, G = () => C.G;
  const errs = [];
  const said = new Set();   // each broken rule once, where it first broke
  const bad = m => { if (errs.length < 20 && !said.has(m)) { said.add(m); errs.push(`t=${G() ? G().t.toFixed(2) : '?'} ${m}`); } };
  const nonTip = () => G().revenue - (G().tips | 0);
  const present = () => { const S = G(); return new Set([...S.groups, ...S.payQ, S.cur, S.at.cur].filter(Boolean).map(g => g.id)); };
  const wrap = (name, fn) => { const orig = H[name]; H[name] = (...a) => fn(orig, a); };
  // The fever's heat now, worked out here from CFG.fever on its own (not core/referee/fever.ts): the curve's points
  // stretched to CFG.fever.sec, straight lines between them, 0 outside [feverAt, feverAt + sec).
  const heatOf = S => {
    const F = C.CFG.fever, x = S.t - S.feverAt;
    if (S.feverAt == null || !(x >= 0 && x < F.sec)) return 0;
    const pts = F.curve.map(([s, h]) => [s * F.sec / F.curve[F.curve.length - 1][0], h]);
    const j = pts.findIndex(p => p[0] >= x), a = pts[j - 1], b = pts[j];
    return !a ? b[1] : a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
  };

  const ending = new Map(), seen = new Set();
  const counts = { good: 0, toPay: 0, took: 0, paid: 0, aipaid: 0, walkout: 0, ghost: 0, left: 0 };
  const end = (id, why) => { if (ending.has(id)) bad(`group ${id} ended twice: ${ending.get(id)} then ${why}`); ending.set(id, why); counts[why]++; };
  // Money the rules made inside the calls watched below; outside them revenue and tips must not move.
  let paidIn = 0, tipsIn = 0, bills = 0, settled = 0, walkedOut = 0, writtenOff = 0, maxCombo = 0;
  const short = new Map();   // customer id -> what the till under-charged (written off)
  let depth = 0;   // a watched call inside another (a good deed inside finishCust) is counted by the outer one
  const watch = (orig, a, check) => {
    const S = G(), p0 = nonTip(), t0 = S.tips | 0;
    depth++;
    let r;
    try { r = orig(...a); } finally { depth--; }
    const dp = nonTip() - p0, dt = (S.tips | 0) - t0;
    if (!depth) { paidIn += dp; tipsIn += dt; }
    check(dp, dt);
    return r;
  };

  wrap('leave', (orig, [g, ...rest]) => { const r = orig(g, ...rest); end(g.id, 'left'); return r; });
  wrap('takeDone', (orig, [g]) => watch(orig, [g], (dp, dt) => {
    const price = C.priceSlip(g.drinks.map(d => d.k)).total;
    if (dp !== price || dt) bad(`takeaway ${g.id} paid ${dp} (+${dt} tips) for ${price}`);
    end(g.id, 'took');
  }));
  wrap('toPay', (orig, [g]) => {
    const ghosts = G().ghosts | 0; counts.toPay++;
    return watch(orig, [g], (dp, dt) => {
      if ((G().ghosts | 0) > ghosts) { if (dp !== g.expect || dt < g.expect) bad(`ghost ${g.id} left ${dp} + ${dt} tips for a bill of ${g.expect}`); end(g.id, 'ghost'); return; }
      if (dp) bad(`group ${g.id} paid ${dp} outside tips on getting up`);
      if (!G().payQ.includes(g)) bad(`group ${g.id} got up but is not queued at the till`);
      bills += g.expect;
    });
  });
  wrap('aiTill', (orig, a) => {
    const S = G(), cur = S.at.cur, loss0 = S.loss;
    return watch(orig, a, (dp, dt) => {
      if (dt || S.loss !== loss0) bad('the computer cashier made tips or lost money');
      if (cur && S.at.cur !== cur) { if (dp !== cur.expect) bad(`computer cashier took ${dp} for a bill of ${cur.expect}`); settled += cur.expect; end(cur.id, 'aipaid'); }
      else if (dp) bad(`computer cashier took ${dp} with nobody paying`);
    });
  });
  // An octopus card that pays in full ends the customer (finishCust) inside submitTotal, so an under-charge written off
  // by that same submitTotal must already count as short there: `totalling` holds the open call's customer and loss.
  let totalling = null, octoShort = 0;
  wrap('submitTotal', (orig, a) => {
    const S = G(), c = S.cur, loss0 = S.loss;
    totalling = c ? { id: c.id, loss0 } : null;
    let r;
    try { r = orig(...a); } finally { totalling = null; }
    if (c && S.loss !== loss0) short.set(c.id, (short.get(c.id) || 0) + S.loss - loss0);
    writtenOff += S.loss - loss0;
    return r;
  });
  wrap('submitChange', (orig, a) => { const S = G(), loss0 = S.loss; const r = orig(...a); writtenOff += S.loss - loss0; return r; });
  wrap('finishCust', (orig, a) => {
    const S = G(), c = S.cur, charged = S.charged;
    return watch(orig, a, dp => {
      const sh = (short.get(c.id) || 0) + (totalling && totalling.id === c.id ? S.loss - totalling.loss0 : 0);
      if (totalling && totalling.id === c.id && S.loss > totalling.loss0) octoShort++;
      if (dp !== charged) bad(`the till took ${dp}, charged ${charged}`);
      if (charged + sh !== c.expect) bad(`customer ${c.id}: charged ${charged} + short ${sh} is not the bill ${c.expect}`);
      settled += charged + sh; end(c.id, 'paid');
    });
  });
  wrap('good', (orig, a) => {
    const S = G(); if (!S || !S.running) return orig(...a);
    let broke = false;
    const ob = H.breakCombo; H.breakCombo = (...b) => { broke = true; return ob(...b); };
    const c0 = S.combo | 0, g0 = S.goods | 0;
    try {
      return watch(orig, a, (dp, dt) => {
        counts.good++;
        if (dp) bad('a good deed took money outside tips');
        if ((S.combo | 0) !== (broke ? 1 : c0 + 1)) bad(`combo ${c0} -> ${S.combo} on a good deed`);
        if ((S.goods | 0) !== g0 + 1) bad('a good deed not counted');
        const tip = Math.round(C.tipFor(S.combo) * (1 + (C.CFG.fever.tip - 1) * heatOf(S)));
        if (dt !== tip) bad(`combo ${S.combo}: tip ${dt}, the rules say ${tip}`);
        maxCombo = Math.max(maxCombo, S.combo);
      });
    } finally { H.breakCombo = ob; }
  });
  wrap('breakCombo', (orig, a) => { const r = orig(...a); if ((G().combo | 0) !== 0) bad('combo left after a break'); return r; });
  // A step: customers at the till who ran out of patience walk out, and their bill is written off.
  wrap('update', (orig, a) => {
    const S = G(), q = S.payQ.slice(), loss0 = S.loss;
    const r = orig(...a);
    const now = present();
    let owed = 0;
    for (const c of q) if (!now.has(c.id) && !ending.has(c.id)) { end(c.id, 'walkout'); owed += c.expect; }
    walkedOut += owed; writtenOff += owed;
    if (S.loss - loss0 !== owed) bad(`loss grew ${S.loss - loss0} in a step, walk-outs owed ${owed}`);
    return r;
  });

  // Each group's lines (its slip) and how often each line was made.
  const lines = new Map();
  const keysOf = g => [...g.drinks.map(d => 'k' + d.k), ...g.meals.map(m => 'm' + m.k)];
  wrap('submitOrder', (orig, [g, keys, byMe]) => {
    const r = orig(g, keys, byMe);
    const want = [...keys.filter(k => !C.isMeal(k)).map(k => 'k' + k), ...keys.filter(k => C.isMeal(k)).map(k => 'm' + k)];
    if (keysOf(g).join('|') !== want.join('|')) bad(`group ${g.id}: lines ${keysOf(g)} are not its slip ${keys}`);
    lines.set(g.id, { keys: keysOf(g), done: [...g.drinks, ...g.meals].map(x => x.done), made: [...g.drinks, ...g.meals].map(() => 0), returns: 0 });
    return r;
  });

  const NUMS = ['revenue', 'loss', 'mistakes', 'angry', 'served', 'paidCount', 'cups', 'dishes', 'goods', 'regHit', 'regMiss', 'tips', 'combo', 'maxCombo', 'fevers'];
  const UP = ['mistakes', 'angry', 'served', 'paidCount', 'cups', 'dishes', 'goods', 'tips', 'maxCombo', 'fevers'];
  let prev = null, prevNums = null, cups = 0, dishes = 0;
  /** After a step or a player's action: everything above, plus what must hold at any moment. */
  function check() {
    const S = G(); if (!S) return;
    const now = present();
    for (const id of now) { if (ending.has(id)) bad(`group ${id} is back after its ending (${ending.get(id)})`); seen.add(id); }
    if (prev) for (const id of prev) if (!now.has(id) && !ending.has(id)) bad(`group ${id} vanished without an ending`);
    prev = now;
    // money
    if (nonTip() !== paidIn) bad(`revenue without tips is ${nonTip()}, payments made ${paidIn}`);
    if ((S.tips | 0) !== tipsIn) bad(`tips are ${S.tips | 0}, tips paid ${tipsIn}`);
    if (S.loss !== writtenOff) bad(`loss ${S.loss}, written off ${writtenOff}`);
    const waiting = S.payQ.reduce((x, c) => x + c.expect, 0) + (S.at.cur ? S.at.cur.expect : 0) + (S.cur ? S.cur.expect : 0);
    if (bills !== settled + walkedOut + waiting) bad(`bills ${bills} != paid ${settled} + walked out ${walkedOut} + waiting ${waiting}`);
    // counters
    for (const k of NUMS) { const v = S[k]; if (v !== undefined && (!Number.isFinite(v) || v < 0)) bad(`G.${k} = ${v}`); }
    if (prevNums) for (const k of UP) if ((S[k] | 0) < (prevNums[k] | 0)) bad(`G.${k} went down ${prevNums[k]} -> ${S[k]}`);
    prevNums = Object.fromEntries(NUMS.map(k => [k, S[k]]));
    if (S.paidCount !== counts.paid + counts.aipaid + counts.took) bad(`paidCount ${S.paidCount}: paid ${counts.paid} + computer ${counts.aipaid} + takeaway ${counts.took}`);
    if (S.served !== counts.toPay + counts.took) bad(`served ${S.served}: got up ${counts.toPay} + takeaway ${counts.took}`);
    if ((S.goods | 0) !== counts.good) bad(`goods ${S.goods}, good deeds ${counts.good}`);
    // the shift's one fever: on exactly while the clock is in [feverAt, feverAt + sec), never more than one, and
    // whole inside the middle half of a shift long enough for it
    const F = C.CFG.fever, inFever = S.feverAt != null && S.t >= S.feverAt && S.t < S.feverAt + F.sec;
    if (S.running && !!S.fever !== inFever) bad(`fever ${!!S.fever} at t=${S.t} with feverAt ${S.feverAt}`);
    if ((S.fevers | 0) > 1) bad(`${S.fevers} fevers in one shift`);
    const lo = C.CFG.gameSec * F.from, hi = C.CFG.gameSec * F.to - F.sec;
    if (S.feverAt != null && hi >= lo && !(S.feverAt >= lo - 1e-9 && S.feverAt <= hi + 1e-9)) bad(`fever at ${S.feverAt}, outside the middle half [${lo}, ${hi}]`);
    if ((S.maxCombo | 0) !== maxCombo) bad(`maxCombo ${S.maxCombo}, longest seen ${maxCombo}`);
    // lines
    for (const g of [...S.groups, ...S.payQ, S.cur, S.at.cur].filter(Boolean)) {
      // a takeaway customer's drinks are its lines from the moment it queues (no slip is written for it)
      if (g.take && !lines.has(g.id)) lines.set(g.id, { keys: keysOf(g), done: g.drinks.map(() => false), made: g.drinks.map(() => 0), returns: 0 });
      const L = lines.get(g.id); if (!L || !g.drinks) continue;
      if (keysOf(g).join('|') !== L.keys.join('|')) bad(`group ${g.id}: lines changed ${L.keys} -> ${keysOf(g)}`);
      const all = [...g.drinks, ...g.meals], ret = g.returns | 0;
      all.forEach((x, i) => {
        // cups and dishes count what the player made: a line done while the computer had the station is the computer's (solo modes switch mid-shift)
        if (x.done && !L.done[i]) { L.made[i]++; if (i < g.drinks.length) { if (C.me('bar')) cups++; } else if (C.me('kitchen')) dishes++; }
        if (!x.done && L.done[i] && !(x.redo && ret > L.returns)) bad(`group ${g.id} line ${i} undone without being sent back`);
        if (L.made[i] > 1 + ret) bad(`group ${g.id} line ${i} made ${L.made[i]} times, sent back ${ret} times`);
        L.done[i] = x.done;
      });
      L.returns = ret;
      if (['eat', 'pay'].includes(g.state) && all.some(x => !x.done)) bad(`group ${g.id} ${g.state} with lines not done`);
    }
    if (C.me('bar') && S.cups !== cups) bad(`cups ${S.cups}, drink lines made ${cups}`);
    if (C.me('kitchen') && S.dishes !== dishes) bad(`dishes ${S.dishes}, meal lines made ${dishes}`);
    // no NaN anywhere (a walk over the whole state: every 30th check, and at the end)
    if (++checks % 30 === 0) noNaN(S, 'G');
  }
  let checks = 0;
  function noNaN(v, path) {
    if (typeof v === 'number') { if (Number.isNaN(v)) bad(`NaN at ${path}`); return; }
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) noNaN(v[i], path + '[' + i + ']'); return; }
    for (const k in v) noNaN(v[k], path + '.' + k);
  }

  /** At the shift's end: the last check, every group accounted for, and a summary. */
  function finish() {
    check(); noNaN(G(), 'G');
    const S = G(), now = present();
    for (const id of seen) if (!ending.has(id) && !now.has(id)) bad(`group ${id} has no ending`);
    return { errs, counts, octoShort, groups: seen.size, ended: ending.size, open: now.size, revenue: S.revenue, tips: S.tips | 0, loss: S.loss, mistakes: S.mistakes, angry: S.angry, maxCombo };
  }
  return { check, finish, errs };
}
