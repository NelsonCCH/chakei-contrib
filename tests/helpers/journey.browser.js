// Injected into the game page (after bots.browser.js when the oracle is wanted). The "journey" auditor: follows every
// customer group through the whole restaurant, across all four stations, and checks that the shop as a whole makes
// sense - not just that each button works.
//
// It wraps the game's own lifecycle functions (enqueue, seat, submitOrder, serve, toPay, leave, takeDone, finishCust,
// cleanTable, tillKey) and diffs the state before and after every update() to catch what happens inline there (think ->
// order, the computer bar / kitchen / till, walk-outs at the till), and takes a teammate's till results from the
// referee (onRefEvent). Nothing is written onto G or the groups (the host
// sends G to teammates), the journal lives in window.J.
//
// J.audit() returns violations, each one telling the group's story so a failure reads like what happened in the shop.
(() => {
  if (window.J) return;
  const J = window.J = {};
  const R = .3;   // tolerance in game seconds (one update can run past a deadline by a frame)
  J.reset = () => {
    J.G = G; J.g = new Map(); J.v = []; J.on = true; J.remoteTill = new Map(); J.taking = null;
    J.money = { paid: 0, ai: 0, take: 0, ghost: 0, walk: 0, tillLoss: 0, paidN: 0, servedN: 0 };
    J.dirty = G ? G.tables.map(tb => tb.dirty) : [];
    // groups already in the shop when the journal starts (the till's head start: three tables already eating)
    if (G) for (const g of G.groups) { const r = rec(g); r.state = g.state; r.lines = [...(g.slip || [])]; r.frozen = lineState(g); step(r, `already ${g.state} at ${G.tables[g.table] ? G.tables[g.table].name : '?'} when the shift opened`); }
    J.rev0 = G ? G.revenue : 0; J.tips0 = G ? G.tips | 0 : 0; J.loss0 = G ? G.loss : 0; J.paid0 = G ? G.paidCount : 0; J.served0 = G ? G.served : 0;
  };
  // a new shift (newGame made a new G) starts a new journal
  const fresh = () => { if (J.G !== G) J.reset(); return J.on; };
  const T = () => (G ? G.t : 0).toFixed(1);
  const rec = g => {
    let r = J.g.get(g.id);
    if (!r || r.obj !== g) {
      // the till hands a customer object around (G.cur, G.at.cur): same id, same object; a takeaway reuses a made-but-never-seated id
      if (r && r.obj !== g && !r.ghostId) r.obj = g;
      else if (!r) { r = { id: g.id, obj: g, label: g.label, size: g.size, take: !!g.take, steps: [], ends: [], state: null, lines: null, made: {}, frozen: null, table: null }; J.g.set(g.id, r); }
    }
    return r;
  };
  const step = (r, what) => { r.steps.push(T() + ' ' + what); if (r.steps.length > 40) r.steps.splice(1, 1); };
  const story = r => `#${r.id} ${r.label || ''}(${r.size}人${r.take ? ' 外賣' : ''}): ${r.steps.join(' -> ')}`;
  const bad = (r, rule, msg) => { if (J.v.length < 60) J.v.push(`[${rule}] ${msg}${r ? ' | ' + story(r) : ''}`); };
  const lineState = g => [...(g.drinks || []).map(d => 'd' + (d.done ? 1 : 0)), ...(g.meals || []).map(m => 'm' + (m.done ? 1 : 0))].join('');
  const end = (r, how) => {
    r.ends.push(how); step(r, 'END ' + how);
    if (r.ends.length > 1) bad(r, 'one-ending', `group has ${r.ends.length} endings: ${r.ends.join(', ')}`);
    r.frozen = lineState(r.obj);
  };
  // (a customer at a teammate's till is in that phone's state, not the host's: J.remoteTill, from the referee's results)
  const liveSet = () => new Set([...G.groups, ...G.payQ, G.cur, G.at && G.at.cur, ...J.remoteTill.values()].filter(Boolean));

  /* ---------- per-group scan: state changes and lines made ---------- */
  function scanGroup(g, where) {
    const r = rec(g);
    if (r.frozen != null) {
      // served (eating, paying) or gone: its drinks and meals may not change any more
      const now = lineState(g);
      if (now !== r.frozen) { bad(r, 'made-for-gone', `${where}: a drink/meal ticket of a group that was already served or gone changed (${r.frozen} -> ${now}; 1 = made)`); r.frozen = now; }
      if (r.ends.length) return;
    }
    if (r.state !== g.state) {
      if (r.state === 'think' && g.state === 'order') step(r, 'ready to order');
      else if (r.state !== null) bad(r, 'legal-order', `${where}: state jumped ${r.state} -> ${g.state} with no game step`);
      r.state = g.state;
    }
    if (g.state === 'wait' || g.take) {
      const ls = [...(g.drinks || []).map((d, i) => ['d', i, d]), ...(g.meals || []).map((m, i) => ['m', i, m])];
      for (const [k, i, x] of ls) {
        const key = k + i, was = r.made[key];
        if (x.done && !was) {
          r.made[key] = { t: G.t, n: (r.made[key + 'n'] | 0) + 1 }; r.made[key + 'n'] = r.made[key].n;
          step(r, `${k === 'd' ? 'drink' : 'meal'} ${x.k} made${x.ok ? '' : ' WRONG'}`);
          if (!r.lines || !r.lines.includes(x.k)) bad(r, 'made-matches-slip', `${x.k} was made but is not on the slip`);
          const until = k === 'd' ? g.drinkUntil : g.mealUntil;
          if (!g.take && G.t > until + R) bad(r, 'patience', `${x.k} made at ${T()} after the customer's patience ran out at ${until.toFixed(1)}`);
        } else if (!x.done && was) { delete r.made[key]; }
      }
    }
  }
  function scanAll(where) {
    for (const g of G.groups) {
      const r = J.g.get(g.id);
      if (!r || r.obj !== g) {
        if (g.take) { const n = rec(g); n.state = 'wait'; n.lines = [...g.drinks.map(d => d.k)]; step(n, 'takeaway at the stall'); }
        else { const n = rec(g); bad(n, 'arrival', `${where}: group appeared in the shop without coming through the door`); n.state = g.state; }
      }
      scanGroup(g, where);
    }
    for (const r of J.g.values()) if (r.frozen != null && !G.groups.includes(r.obj)) scanGroup(r.obj, where);
    // tables: dirty seats only from customers who sat there and left, cleared only by cleaning
    G.tables.forEach((tb, i) => {
      if (tb.dirty !== J.dirty[i]) { bad(null, 'tables', `${where} t=${T()}: ${tb.name} has ${tb.dirty} dirty seats, but the customers who left it account for ${J.dirty[i]}`); J.dirty[i] = tb.dirty; }
      const occ = G.groups.filter(g => g.table === tb.id).reduce((a, g) => a + g.size, 0);
      if (occ + tb.dirty > tb.cap) bad(null, 'tables', `t=${T()}: ${tb.name} holds ${occ} people + ${tb.dirty} dirty seats > ${tb.cap} seats`);
    });
  }

  /* ---------- wrappers ---------- */
  const wrap = (name, fn) => { const orig = window[name]; if (typeof orig !== 'function') return; window[name] = function (...a) { if (!G || !fresh()) return orig.apply(this, a); return fn(orig, a, this); }; };

  wrap('enqueue', (orig, [g]) => {
    const r = orig(g);
    const n = rec(g); n.label = g.label; n.size = g.size;
    if (G.groups.includes(g)) { n.state = 'queue'; step(n, 'came in, queues at the door'); }
    else end(n, 'turned away (door queue full)');
    return r;
  });
  wrap('seat', (orig, [g, tb]) => {
    const r = rec(g); scanGroup(g, 'seat');
    if (g.state !== 'queue') bad(r, 'legal-order', `seated while ${g.state}`);
    const occ = G.groups.filter(x => x.table === tb.id).reduce((a, x) => a + x.size, 0);
    if (tb.cap - occ - tb.dirty < g.size) bad(r, 'tables', `seated at ${tb.name} with ${tb.cap - occ - tb.dirty} clean seats for ${g.size} people`);
    const out = orig(g, tb);
    r.state = g.state; r.table = tb.id; step(r, `seated at ${tb.name}`);
    return out;
  });
  wrap('submitOrder', (orig, [g, keys, byMe]) => {
    const r = rec(g); scanGroup(g, 'submitOrder');
    if (g.state !== 'order') bad(r, 'legal-order', `order written while ${g.state}`);
    if (r.ends.length || !G.groups.includes(g)) bad(r, 'legal-order', 'order written for a group that is not in the shop');
    const out = orig(g, keys, byMe);
    r.state = g.state; r.lines = [...g.slip];
    const bag = a => [...a].sort().join('|');
    if (bag([...g.drinks.map(d => d.k), ...g.meals.map(m => m.k)]) !== bag(g.slip)) bad(r, 'made-matches-slip', `tickets ${bag([...g.drinks.map(d => d.k), ...g.meals.map(m => m.k)])} differ from the slip ${bag(g.slip)}`);
    step(r, `slip written (${g.slip.length} lines${g.result.correct ? '' : ', WRONG: ' + g.result.complaint})`);
    return out;
  });
  wrap('serve', (orig, [g]) => {
    const r = rec(g); scanGroup(g, 'serve');
    if (g.state !== 'wait') bad(r, 'legal-order', `served while ${g.state}`);
    if (!r.lines) bad(r, 'legal-order', 'served with no order');
    if (![...g.drinks, ...g.meals].every(x => x.done)) bad(r, 'legal-order', 'served before every drink and meal was made');
    const out = orig(g);
    if (g.state === 'wait') {
      step(r, `sent back (redo ${g.returns})`);
      if ((g.returns | 0) > 2) bad(r, 'redo', `sent back ${g.returns} times (max 2)`);
      for (const k of Object.keys(r.made)) if (!k.endsWith('n')) { const [t, i] = [k[0], +k.slice(1)]; const x = t === 'd' ? g.drinks[i] : g.meals[i]; if (x && !x.done) delete r.made[k]; }
    } else { r.state = g.state; r.frozen = lineState(g); step(r, 'served, eating'); }
    return out;
  });
  wrap('toPay', (orig, [g]) => {
    const r = rec(g); scanGroup(g, 'toPay');
    if (g.state !== 'eat') bad(r, 'legal-order', `went to pay while ${g.state}`);
    const tb = g.table, rev0 = G.revenue, tips0 = G.tips | 0;
    const out = orig(g);
    J.dirty[tb] += g.size; J.money.servedN++;
    // the bill: the slip minus lines the customer never asked for, priced independently by the test oracle when present
    const slip = g.slip || [], dis = disputes(g.items, slip), keep = slip.filter((k, i) => !dis.includes(i));
    const want = window.Oracle ? Oracle.price(keep) : priceSlip(keep).total;
    if (g.expect !== want) bad(r, 'money', `bill $${g.expect} but the slip (minus ${dis.length} line(s) not ordered) prices at $${want}`);
    r.bill = g.expect;
    if (!G.payQ.includes(g)) {
      const net = (G.revenue - rev0) - ((G.tips | 0) - tips0);
      J.money.ghost += net; end(r, `vanished leaving money on the table (ghost, $${net})`);
      if (net !== g.expect) bad(r, 'money', `ghost left $${net} net, bill was $${g.expect}`);
    } else { r.state = 'pay'; step(r, `ate, queues at the till ($${g.expect})`); }
    return out;
  });
  wrap('leave', (orig, [g, angry, why]) => {
    const r = rec(g); scanGroup(g, 'leave');
    const st = g.state, tb = g.table;
    // a group leaving from a table while waiting for food or drink: the game marks its seats dirty just before calling leave
    if (st === 'wait' && !g.take && tb !== null && tb !== undefined) J.dirty[tb] += g.size;
    const out = orig(g, angry, why);
    const how = g.take ? 'takeaway customer gave up waiting' : st === 'queue' ? 'left the door queue (no seat in time)' : st === 'order' ? 'gave up waiting to order' : st === 'wait' ? 'left angry waiting for food/drink' : 'left while ' + st;
    if (!g.take && !['queue', 'order', 'wait'].includes(st)) bad(r, 'legal-order', `left while ${st} - no reason a customer leaves then`);
    end(r, how);
    return out;
  });
  wrap('takeDone', (orig, [g]) => {
    const r = rec(g); scanGroup(g, 'takeDone');
    if (!g.drinks.every(d => d.done)) bad(r, 'legal-order', 'takeaway paid before its drinks were made');
    const rev0 = G.revenue;
    const out = orig(g);
    const pay = window.Oracle ? Oracle.price(g.drinks.map(d => d.k)) : priceSlip(g.drinks.map(d => d.k)).total;
    if (G.revenue - rev0 !== pay) bad(r, 'money', `takeaway paid $${G.revenue - rev0}, its drinks price at $${pay}`);
    J.money.take += G.revenue - rev0; J.money.paidN++; J.money.servedN++;
    end(r, `takeaway paid $${G.revenue - rev0}`);
    return out;
  });
  wrap('cleanTable', (orig, [tb]) => { const out = orig(tb); J.dirty[tb.id] = 0; return out; });
  wrap('tillKey', (orig, a) => {
    const loss0 = G.loss, out = orig(...a);
    if (G.loss !== loss0) J.money.tillLoss += G.loss - loss0;
    return out;
  });
  wrap('finishCust', (orig, a) => {
    const c = G.cur, charged = G.charged;
    const r = c && rec(c);
    if (r) { scanGroup(c, 'finishCust'); if (r.state !== 'pay') bad(r, 'legal-order', `paid at the till while ${r.state}`); if (charged > c.expect) bad(r, 'money', `charged $${charged} for a $${c.expect} bill`); }
    const out = orig(...a);
    J.money.paid += charged; J.money.paidN++;
    if (r) end(r, `paid $${charged} at the till`);
    return out;
  });

  /* ---------- a teammate's till ---------- */
  // The till is the phone's own that plays it: the host's referee only gets its results (tillTake, tillMiss,
  // tillPaid), seen here through the test surface's onRefEvent (before and after each is applied).
  if (typeof onRefEvent === 'function') onRefEvent(e => {
    if (!G || !fresh()) return;
    const x = e.r;
    if (e.ok === null) { if (x.k === 'tillTake') J.taking = G.payQ.find(c => c.id === x.cid) || null; return; }
    if (!e.ok) return;
    if (x.k === 'tillTake' && J.taking) {
      const c = J.taking, r = rec(c); J.taking = null; J.remoteTill.set(c.id, c);
      if (r.state !== 'pay') bad(r, 'legal-order', `at a teammate's till while ${r.state}`); else step(r, 'at a teammate\'s till');
    }
    if (x.k === 'tillMiss') J.money.tillLoss += x.loss;
    if (x.k === 'tillPaid') {
      const c = J.remoteTill.get(x.cid), r = c && rec(c);
      J.remoteTill.delete(x.cid); J.money.paid += x.charged; J.money.paidN++;
      if (r) { if (x.charged > c.expect) bad(r, 'money', `charged $${x.charged} for a $${c.expect} bill`); end(r, `paid $${x.charged} at a teammate's till`); }
      else bad(null, 'money', `a teammate's till was paid $${x.charged} for customer ${x.cid}, who never came to it`);
    }
  });
  // a teammate's till handed to the computer gives its customer back to the pay queue (as a new object, same id)
  const tillBack = () => { for (const id of [...J.remoteTill.keys()]) if (G.payQ.some(c => c.id === id) || (G.at && G.at.cur && G.at.cur.id === id)) J.remoteTill.delete(id); };

  /* ---------- update: catch what happens inline ---------- */
  let pre = null;
  wrap('update', (orig, a) => {
    scanAll('before update');
    tillBack();
    pre = { payQ: [...G.payQ], at: G.at && G.at.cur, cur: G.cur, loss: G.loss, rev: G.revenue, tips: G.tips | 0 };
    const out = orig(...a);
    if (!G) return out;
    const live = liveSet();
    // the computer cashier finished a customer
    if (pre.at && G.at.cur !== pre.at && !G.payQ.includes(pre.at)) {
      const r = rec(pre.at); J.money.ai += pre.at.expect; J.money.paidN++;
      if (r.state !== 'pay') bad(r, 'legal-order', `computer till took money while ${r.state}`);
      end(r, `paid $${pre.at.expect} at the computer till`);
    }
    // customers who were waiting at the till and are now gone without paying: walked out (走數)
    for (const c of pre.payQ) {
      if (live.has(c)) continue;
      const r = rec(c); if (r.ends.length) continue;
      J.money.walk += c.expect; end(r, `walked out of the till queue without paying ($${c.expect})`);
    }
    // the human till called the next customer
    if (G.cur && G.cur !== pre.cur) { const r = rec(G.cur); if (r.state !== 'pay' || G.groups.includes(G.cur)) bad(r, 'legal-order', `at the till while ${r.state}`); else step(r, 'at the till'); }
    if (G.at && G.at.cur && G.at.cur !== pre.at) { const r = rec(G.at.cur); if (r.state !== 'pay') bad(r, 'legal-order', `at the computer till while ${r.state}`); }
    if (G.loss - pre.loss && G.loss - pre.loss !== pre.payQ.filter(c => !live.has(c)).reduce((x, c) => x + c.expect, 0)) bad(null, 'money', `t=${T()} loss rose by ${G.loss - pre.loss} inside update, walk-outs account for ${pre.payQ.filter(c => !live.has(c)).reduce((x, c) => x + c.expect, 0)}`);
    scanAll('after update');
    return out;
  });

  /* ---------- pointers and the rails on screen (call after a paint) ---------- */
  J.screen = () => {
    if (!G || !fresh()) return [];
    const out = [], live = new Set(G.groups), say = m => out.push(`[screen] t=${T()} ${m}`);
    if (G.sheet && !(live.has(byId(G.sheet.gid)) && ['order', 'think'].includes(byId(G.sheet.gid).state))) say(`the order sheet is open for group ${G.sheet.gid} which is ${byId(G.sheet.gid) ? byId(G.sheet.gid).state : 'gone'}`);
    if (G.cur && (G.groups.includes(G.cur) || G.cur.state !== 'pay')) say(`till customer ${G.cur.id} is ${G.cur.state}`);
    if (G.selected != null && !G.groups.some(g => g.id === G.selected)) say(`waiter has selected group ${G.selected} which is gone`);
    const vis = id => { const e = document.getElementById(id); return e && e.offsetParent !== null; };
    if (vis('rail')) for (const el of document.querySelectorAll('#rail > [data-key]')) { const g = G.groups.find(x => String(x.id) === el.dataset.key); if (!g || g.state !== 'wait') say(`bar rail shows a ticket for group ${el.dataset.key} which is ${g ? g.state : 'gone'}`); }
    if (vis('krail')) for (const el of document.querySelectorAll('#krail > [data-key]')) { const [gid, i] = el.dataset.key.split('-').map(Number); const g = G.groups.find(x => x.id === gid); if (!g || g.state !== 'wait' || !g.meals[i] || g.meals[i].done) say(`kitchen rail shows meal ${el.dataset.key} which is ${g ? (g.meals[i] && g.meals[i].done ? 'already made' : g.state) : 'gone'}`); }
    if (local('bar') && G.bench.target) { const g = byId(G.bench.target.gid); if (!g || g.state !== 'wait' || g.drinks[G.bench.target.i].done) say(`bar is aiming at drink ${JSON.stringify(G.bench.target)} which is ${g ? 'done/not waiting' : 'gone'}`); }
    if (local('kitchen') && G.ksel && !selOk()) say(`kitchen has meal ${JSON.stringify(G.ksel)} selected which is done or gone`);
    if (J.v.length < 60) J.v.push(...out);
    return out;
  };

  /* ---------- the end-of-shift audit ---------- */
  J.audit = () => {
    if (!G || J.G !== G) return ['[audit] no journal for this shift (J.reset() after start())'];
    scanAll('audit'); tillBack();
    const v = [...J.v], live = liveSet();
    for (const r of J.g.values()) {
      if (!r.ends.length && !live.has(r.obj)) v.push(`[one-ending] group vanished without an ending | ${story(r)}`);
    }
    const m = J.money, net = (G.revenue - J.rev0) - ((G.tips | 0) - J.tips0);
    const bills = m.paid + m.ai + m.take + m.ghost;
    if (net !== bills) v.push(`[money] revenue minus tips is $${net}, but customers paid $${bills} (till $${m.paid}, computer till $${m.ai}, takeaway $${m.take}, ghosts $${m.ghost})`);
    if (G.loss - J.loss0 !== m.walk + m.tillLoss) v.push(`[money] loss is $${G.loss - J.loss0}, walk-outs $${m.walk} + till miscounts $${m.tillLoss}`);
    if (G.paidCount - J.paid0 !== m.paidN) v.push(`[money] paidCount rose by ${G.paidCount - J.paid0}, ${m.paidN} customers paid`);
    if (G.served - J.served0 !== m.servedN) v.push(`[money] served rose by ${G.served - J.served0}, ${m.servedN} groups finished eating or took away`);
    return v;
  };
  J.stories = () => [...J.g.values()].map(story);
  // what happened, by ending (for reports)
  J.summary = () => {
    const c = {};
    for (const r of J.g.values()) { const k = r.ends.length ? r.ends[0].replace(/\$\d+/g, '$').replace(/\(\$\)/, '') : 'still in the shop at close'; c[k] = (c[k] || 0) + 1; }
    return { groups: J.g.size, endings: c, money: { ...J.money } };
  };
  J.reset();
})();
