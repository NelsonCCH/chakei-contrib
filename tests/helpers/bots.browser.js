// Injected into the game page by tests/helpers/single.js. Plain global-scope JS (same scope as the game).
// Oracle: the rules written out again from the help text / rules, independent of rules.js price + key code.
// Bot:    plays a station through the REAL buttons (element.click() on the buttons a player taps).
(() => {
  const Q = s => document.querySelector(s);
  const SW = ['', '少甜', '走甜'];

  /* ======================= Oracle ======================= */
  const O = window.Oracle = {};
  const idOf = (list, key) => list.filter(d => key.includes(d.id)).sort((a, z) => z.id.length - a.id.length)[0];
  O.drinkKey = d => (d.cold ? '凍' : '熱') + d.d + SW[d.sweet | 0] + (d.cold && d.noice ? '走冰' : '');
  // what a table of persons wants, as a bag of keys
  O.keysOf = persons => {
    const out = [];
    for (const p of persons) {
      if (p.food) out.push('f' + p.food);
      if (p.set) out.push('s' + [p.set.id, p.set.noodle, p.set.egg, p.set.bread + (p.set.hongdai ? '烘底' : '') + (p.set.feibin ? '飛邊' : '')].join(' '));
      if (p.dish) out.push('d' + p.dish.id + ['炒底', '加底', '走青'].filter(f => p.dish[f]).join(''));
      out.push(O.drinkKey(p.drink));
    }
    return out;
  };
  O.isMeal = k => 'fsd'.includes(k[0]);
  O.mealPrice = k => {
    if (k[0] === 'f') return FOODS.find(f => k.slice(1).startsWith(f.id) && (k.slice(1) === f.id || k.slice(1) === f.id + ' 加頂帽')).p + (k.endsWith('加頂帽') ? 5 : 0);
    if (k[0] === 's') { const [id, noodle, , bread] = k.slice(1).split(' '); return SETS.find(s => s.id === id).p + (noodle === '公仔麵' ? 5 : 0) + (bread.includes('烘底') ? 2 : 0); }
    return DISHES.filter(x => k.startsWith('d' + x.id)).sort((a, z) => z.id.length - a.id.length)[0].p + (k.includes('加底') ? 6 : 0);
  };
  // every meal comes with one drink (in slip order); the cold surcharge is always paid; extra drinks are full price
  O.price = keys => {
    let free = keys.filter(O.isMeal).length, total = 0;
    for (const k of keys) {
      if (O.isMeal(k)) { total += O.mealPrice(k); continue; }
      const cold = k[0] === '凍' ? 3 : 0;
      if (free > 0) { free--; total += cold; } else total += idOf(DRINKS, k).p + cold;
    }
    return total;
  };
  O.bag = a => [...a].sort().join('|');
  O.correct = (wanted, slip) => O.bag(wanted) === O.bag(slip);
  // slip lines the customers never ordered: matched by kind of food/drink (hot/cold and extras do not matter here), the left-overs are disputed at the till
  const base = k => k[0] === 's' ? k.split(' ')[0] : k[0] === 'd' ? 'd' + DISHES.filter(x => k.startsWith('d' + x.id)).sort((a, z) => z.id.length - a.id.length)[0].id : k[0] === 'f' ? 'f' + (k.endsWith('加頂帽') ? k.slice(1, -4) : k.slice(1)) : 'k' + idOf(DRINKS, k).id;
  O.disputes = (ordered, slip) => { const pool = ordered.map(base), out = []; slip.forEach((k, i) => { const j = pool.indexOf(base(k)); if (j >= 0) pool.splice(j, 1); else out.push(i); }); return out; };
  O.expectPay = (items, slip) => { const d = O.disputes(items, slip); return O.price(slip.filter((k, i) => !d.includes(i))); };
  // drink recipe from the printed ticket text
  O.recipe = k => {
    const d = idOf(DRINKS, k), cold = k[0] === '凍', r = { cup: cold ? 'cold' : 'hot', ing: { ...RECIPE[d.id] } };
    if (cold) {
      r.ing.冰 = d.iced || !k.includes('走冰') ? 1 : 0;
      r.ing.糖水 = d.sw || k.includes('走甜') ? 0 : k.includes('少甜') ? 1 : 2;
    }
    for (const i of Object.keys(r.ing)) if (!r.ing[i]) delete r.ing[i];
    return r;
  };
  // plate tokens for a meal key (rules from the kitchen help text)
  O.tokens = k => {
    if (k[0] === 'f') { const hat = k.endsWith('加頂帽'), id = hat ? k.slice(1, -4) : k.slice(1); return [...LUNCH_R[id], ...(hat ? ['煎蛋'] : [])]; }
    if (k[0] === 's') {
      const [id, noodle, egg, bread] = k.slice(1).split(' ');
      const roll = bread.includes('餐包'), crisp = bread.includes('烘底');
      const t = [noodle, egg, SET_TOP[id], (roll ? '餐包' : '多士') + (crisp ? '烘底' : ''), bread.startsWith('奶油') ? '奶油' : '牛油'];
      if (bread.includes('飛邊')) t.push('飛邊');
      return t;
    }
    const d = DISHES.filter(x => k.startsWith('d' + x.id)).sort((a, z) => z.id.length - a.id.length)[0], n = k.includes('加底') ? 2 : 1, rice = x => Array(x).fill('飯');
    let t;
    if (['揚州炒飯', '鹹魚雞粒炒飯'].includes(d.id)) t = [`${d.id}·飯×${n}`];
    else if (d.id === '咖喱牛腩飯') t = ['咖喱牛腩', ...rice(n)];
    else if (d.id === '焗豬扒飯') t = ['焗豬扒飯', ...rice(n - 1)];
    else if (k.includes('炒底')) t = [`${d.id}·飯×${n}`];
    else t = [d.id, ...rice(n)];
    if (d.id !== '焗豬扒飯' && !k.includes('走青')) t.push('蔥');
    return t;
  };
  // tips: $1 / $2 / $3 / $5 from combo 3 / 6 / 9 / 12; inside the fever (旺場) times
  // 1 + (CFG.fever.tip - 1) x its heat (`heat`: 0 outside it, 1 at its climax), rounded
  O.tipFor = (c, heat) => Math.round((c < 3 ? 0 : c < 6 ? 1 : c < 9 ? 2 : c < 12 ? 3 : 5) * (1 + (CFG.fever.tip - 1) * (heat || 0)));

  /* ======================= Bot ======================= */
  const B = window.Bot = { clicks: 0, errors: [], unreachable: [], ev: [], violations: [], timer: null, opts: {}, orders: [], seen: {}, since: {} };
  B.reset = () => { B.used = {}; B.clicks = 0; B.errors = []; B.unreachable = []; B.ev = []; B.violations = []; B.orders = []; B.since = {}; B.opts = {}; };

  const reachable = el => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(x, y);
    return !!top && (el.contains(top) || top.contains(el));
  };
  function tap(target, why) {
    const el = typeof target === 'string' ? Q(target) : target;
    if (!el) { B.errors.push('missing: ' + (why || target)); return false; }
    if (el.disabled) { B.errors.push('disabled: ' + (why || target)); return false; }
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') { B.errors.push('hidden: ' + (why || target)); return false; }
    try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    if (!reachable(el)) B.unreachable.push(why || (typeof target === 'string' ? target : el.outerHTML.slice(0, 60)));
    el.click(); B.clicks++; return true;
  }
  B.tap = tap;
  B.tapPot = () => tapPot(); B.tapCell = (st, i) => tapCell(st, i, 'cell');
  // The pot (bar) and the cooking stations (kitchen) are tapped on the pixel canvas: a pointerdown at the spot, exactly where a finger lands
  function tapCanvas(cv, h, why, finder) {
    if (!h) { B.errors.push('no canvas hit: ' + why); return false; }
    const r = cv.getBoundingClientRect(); if (h.x + h.w > r.width + 1 || h.y + h.h > r.height + 1) return false;   // canvas not laid out yet: the hit areas are stale
    const x = r.left + h.x + h.w / 2, y = r.top + h.y + h.h / 2;
    const top = document.elementFromPoint(x, y);
    if (!top || !(top === cv || cv.contains(top))) B.unreachable.push(why + ' (canvas covered by ' + (top ? top.tagName + '#' + top.id + '.' + top.className + ' ' + JSON.stringify(top.getBoundingClientRect()) : 'nothing') + ' target ' + JSON.stringify([x, y]) + ' cv ' + JSON.stringify(r) + ')');
    else if (finder && finder(x, y) !== h) B.unreachable.push(why + ' (another hit area on top)');
    cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse' })); B.clicks++; return true;
  }
  const tapPot = () => tapCanvas(BSC.tv, BSC.hits.find(h => h.kind === 'pot'), 'pot', (x, y) => hitAt(BSC, { clientX: x, clientY: y }));
  const tapCell = (st, i, why) => tapCanvas(ktv, kHits.find(h => h.st === st && h.i === i), why, (x, y) => { const r = ktv.getBoundingClientRect(), px = x - r.left, py = y - r.top; return kHits.find(k => px >= k.x && px < k.x + k.w && py >= k.y && py < k.y + k.h); });

  /* ---- event wrappers: record what the game's own functions did, with the state delta ---- */
  const emit = e => { e.t = G ? G.t : 0; B.ev.push(e); };
  const wrap = (name, fn) => { const orig = window[name]; window[name] = function (...a) { return fn(orig, a); }; };
  const snap = () => ({ rev: G.revenue, tips: G.tips | 0, mis: G.mistakes, ang: G.angry, loss: G.loss, served: G.served, paid: G.paidCount, combo: G.combo | 0, t: G.t });
  const diff2 = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, b[k] - a[k]]));
  wrap('serve', (orig, [g]) => {
    const before = snap(), returned = (g.returns | 0), bad = g.meals.some(m => !m.ok) || g.drinks.some(d => !d.ok);
    const r = orig(g);
    emit({ type: 'serve', id: g.id, slip: [...(g.slip || [])], correct: g.result.correct, bad, returnsBefore: returned, state: g.state, d: diff2(before, snap()) });
    return r;
  });
  wrap('toPay', (orig, [g]) => {
    const before = snap(); const r = orig(g);
    emit({ type: 'toPay', id: g.id, expect: g.expect, slip: [...(g.slip || [])], items: [...g.items], d: diff2(before, snap()) });
    return r;
  });
  wrap('leave', (orig, [g, angry, why]) => {
    const before = snap(), st = g.state; const r = orig(g, angry, why);
    emit({ type: 'leave', id: g.id, state: st, angry: !!angry, until: g.until, max: g.max, d: diff2(before, snap()) });
    return r;
  });
  wrap('good', (orig, a) => {
    if (!G || !G.running) return orig(...a);
    const before = snap(); const r = orig(...a);
    emit({ type: 'good', combo: G.combo, fever: feverHeat(G.feverAt, G.t), d: diff2(before, snap()) });
    return r;
  });
  wrap('enqueue', (orig, [g]) => { const a = G.angry, n = G.groups.length; const r = orig(g); emit({ type: 'enqueue', id: g.id, overflow: G.groups.length === n, angry: G.angry - a, max: g.max, until: g.until, size: g.size, label: g.label, items: [...(g.items || [])] }); return r; });
  wrap('breakCombo', (orig, a) => { emit({ type: 'break', comboBefore: G.combo | 0 }); return orig(...a); });
  wrap('submitOrder', (orig, [g, keys, byMe]) => {
    const r = orig(g, keys, byMe);
    emit({ type: 'submit', id: g.id, byMe, correct: g.result.correct, slip: [...keys], items: [...g.items] });
    return r;
  });

  // kitchen: the plate at the moment 出餐 is pressed
  wrap('kitKey', (orig, [k]) => {
    if (k !== 'serve') return orig(k);
    const g = selOk(), key = g && g.meals[G.ksel.i].k, tokens = [...activePlate().tokens];
    const r = orig(k);
    if (key) emit({ type: 'plate', key, tokens, want: O.tokens(key), ok: O.bag(tokens) === O.bag(O.tokens(key)) });
    return r;
  });
  // till: what was typed, what the customer paid, what changed
  wrap('submitTotal', (orig, a) => {
    const c = G.cur, before = snap(), entry = G.entry, octo = c && c.octo, short = c && c.octoShort;
    const r = orig(...a);
    emit({ type: 'total', id: c && c.id, entry, expect: c && c.expect, octo, octoShort: short, charged: G.charged, step: G.step, d: diff2(before, snap()) });
    return r;
  });
  wrap('submitChange', (orig, a) => {
    const c = G.cur, before = snap(), give = G.give.reduce((x, y) => x + y, 0), paid = G.paid, charged = G.charged;
    const r = orig(...a);
    emit({ type: 'change', id: c && c.id, give, need: paid - charged, d: diff2(before, snap()) });
    return r;
  });
  wrap('finishCust', (orig, a) => {
    const c = G.cur, before = snap(), charged = G.charged, paid = G.paid;
    const r = orig(...a);
    emit({ type: 'cust', id: c.id, expect: c.expect, charged, paid, d: diff2(before, snap()) });
    return r;
  });

  // stop random arrivals and the regulars/celebrities, so a test controls who is in the shop
  B.quiet = () => { G.nextSpawn = Infinity; G.regPlan = []; };
  // a customer group of the given size at the door, optionally with a fixed order (persons) and fields (label, noShare ...)
  B.inject = (size, o = {}) => {
    const g = makeGroup(); g.size = size; Object.assign(g, { label: '測試客', noShare: false }, o.fields || {});
    if (o.persons) { g.persons = o.persons; g.lines = o.lines || o.persons.map(p => sayPerson(p) + '。'); } else { const od = genOrder(size); g.persons = od.persons; g.lines = od.lines; }
    g.items = itemsOf(g.persons); enqueue(g); bump(); return g.id;
  };
  // tickets for the bar/kitchen: one group per key, already ordered (as the computer waiter would do it)
  B.tickets = (keys, o = {}) => keys.map(k => {
    const id = B.inject(1, { persons: [{ food: null, set: null, dish: null, drink: { d: '奶茶', cold: false, sweet: 0, noice: false } }] }), g = byId(id);
    G.tables.forEach(t => { if (!G.groups.some(x => x.table === t.id)) t.dirty = 0; });   // nobody is going to clean for us
    const tb = G.tables.find(t => !seatProblem(g, t)); seat(g, tb); g.items = [k]; submitOrder(g, [k], false); return id;
  });
  // a customer who has just finished eating and is walking to the till with this slip (real toPay, so the game builds the bill lines and what they say)
  B.payer = (items, slip, o = {}) => {
    const id = B.inject(1), g = byId(id), tb = G.tables.find(t => !seatProblem(g, t)); seat(g, tb);
    g.size = 1; g.items = items; submitOrder(g, slip, false); g.state = 'eat'; toPay(g);
    const c = G.payQ[G.payQ.length - 1]; c.octo = !!o.octo; c.octoShort = !!o.octoShort; c.paySay = c.paySay.filter(l => !/八達通|拍卡/.test(l)); if (c.octo) c.paySay.push('八達通。');
    return c.id;
  };
  /* ---- waiter ---- */
  const tblBtn = i => `#floor .tbl[data-t="${i}"]`;
  const other = (list, cur) => list.find(x => x !== cur);
  // Writes one person onto the open sheet through the sheet's buttons
  function writePerson(p, sheet) {
    const add = (t, id) => tap(`#sheet [data-add="${t}"][data-id="${id}"]`, `add ${t} ${id}`);
    if (p.food) { const hat = p.food.includes('加頂帽'); add('f', hat ? p.food.replace(' 加頂帽', '') : p.food); if (hat) tap('#sheet [data-hat]', 'hat'); }
    if (p.set) {
      const s = p.set; add('s', s.id);
      if (s.noodle !== DEF.noodle) tap(`#sheet [data-opt="noodle"][data-v="${s.noodle}"]`, 'noodle');
      if (s.egg !== DEF.egg) tap(`#sheet [data-opt="egg"][data-v="${s.egg}"]`, 'egg');
      if (s.bread !== DEF.bread) tap(`#sheet [data-opt="bread"][data-v="${s.bread}"]`, 'bread');
      if (s.hongdai) tap('#sheet [data-flag="hongdai"]', 'hongdai');
      if (s.feibin) tap('#sheet [data-flag="feibin"]', 'feibin');
    }
    if (p.dish) { add('d', p.dish.id); for (const f of ['炒底', '加底', '走青']) if (p.dish[f]) tap(`#sheet [data-dflag="${f}"]`, f); }
    const d = p.drink; if (!d) return;
    add('k', d.d);
    if (d.cold && !isIced(d.d)) tap('#sheet [data-temp="cold"]', 'cold');
    if (d.sweet) tap(`#sheet [data-sweet="${d.sweet}"]`, 'sweet');
    if (d.noice) tap('#sheet [data-noice]', 'noice');
  }
  const clone = o => JSON.parse(JSON.stringify(o));
  // mutation of what the customers really asked for, to write a deliberately wrong slip. Returns the mutated persons + a name ('none' = could not apply)
  function mutate(persons, how) {
    const ps = clone(persons);
    if (how === 'omit') { const p = ps[ps.length - 1]; p.drink = null; if (!ps.some(q => q.food || q.set || q.dish || q.drink)) return { ps: persons, how: 'none' }; return { ps, how }; }
    if (how === 'extra') { ps.push({ food: null, set: null, dish: null, drink: { d: ps[0].drink.d === '奶茶' ? '檸茶' : '奶茶', cold: false, sweet: 0, noice: false } }); return { ps, how }; }
    if (how === 'drink') { const d = ps[0].drink; if (isIced(d.d) || isHot(d.d)) return { ps: persons, how: 'none' }; d.d = d.d === '奶茶' ? '檸茶' : '奶茶'; d.sweet = 0; d.noice = d.cold ? d.noice : false; return { ps, how }; }
    if (how === 'temp') { const p = ps.find(p => !isIced(p.drink.d) && !isHot(p.drink.d)); if (!p) return { ps: persons, how: 'none' }; p.drink.cold = !p.drink.cold; if (!p.drink.cold) { p.drink.sweet = 0; p.drink.noice = false; } return { ps, how }; }
    if (how === 'sweet') { const p = ps.find(p => p.drink.cold && !isSw(p.drink.d)); if (!p) return { ps: persons, how: 'none' }; p.drink.sweet = (p.drink.sweet | 0) === 1 ? 2 : 1; return { ps, how }; }
    return { ps, how: 'none' };
  }
  function writeSheet() {
    const g = byId(G.sheet.gid), mode = typeof B.opts.sheetMode === 'function' ? B.opts.sheetMode(g) : (B.opts.sheetMode || 'correct');
    const m = mutate(g.persons, mode);
    for (const p of m.ps) writePerson(p);
    if (tap('#sheet .send', 'send')) B.orders.push({ id: g.id, how: m.how, wanted: O.keysOf(g.persons), slip: [...g.slip || []], correct: g.result && g.result.correct });
  }
  function waiterTick() {
    if (G.sheet) return writeSheet();
    // 樓面: on a floor level a dirty table opens 執枱; play it through the station's own bot press, as a player would
    const job = typeof floorJob === 'function' ? floorJob() : null;
    if (job) { if (job.game === 'clear') clearBotPress(); return; }
    const gs = G.groups, sel = G.selected && byId(G.selected);
    if (sel && sel.state === 'queue') {
      const tb = G.tables.find(t => !seatProblem(sel, t)) || G.tables.find(t => seatProblem(sel, t) === 'dirty');
      if (tb) return tap(tblBtn(tb.id), 'seat table');
      return tap(grpEls.get(sel.id), 'deselect');
    }
    const ord = gs.filter(g => g.state === 'order').sort((a, z) => a.until - z.until)[0];
    if (ord) return tap(tblBtn(ord.table), 'order table');
    const q = gs.filter(g => g.state === 'queue').sort((a, z) => a.until - z.until);
    for (const g of q) { if (bestTable(g) || G.tables.some(t => seatProblem(g, t) === 'dirty')) return tap(grpEls.get(g.id), 'pick group'); }
    const dirty = G.tables.find(t => t.dirty);
    if (dirty) return tap(tblBtn(dirty.id), 'dirty table');
  }

  /* ---- bar ---- */
  // cup and bottles: buttons on the pad (desktop), or the drawn cups and bottles on the canvas (phone, 枱面版)
  const barItem = (k, why) => kitMode === 'counter' ? tapCanvas(BSC.tv, BSC.hits.find(h => (h.kind === 'cup' || h.kind === 'ing') && h.k === k), why, (x, y) => hitAt(BSC, { clientX: x, clientY: y })) : tap(`#barPad [data-b="${k}"]`, why);
  function barTick() {
    const p = G.pot;
    if (p.st === 'empty' || p.st === 'pull' || (p.st === 'ready' && p.level <= 3 && G.phase === 'open' && !B.opts.noRefill)) return tapPot();
    if (G.phase === 'prep') return;
    // the player picks the ticket: the bot taps the most urgent one on the rail once it is drawn, as a player would
    const tg = G.bench.target;
    if (!tg) { const n = nextTarget(null), el = n && Q(`[data-tk="${n.gid}:${n.i}"]`); return el ? tap(el, 'ticket') : undefined; }
    const g = byId(tg.gid); if (!g || g.state !== 'wait') return;
    const k = g.drinks[tg.i].k, r = O.recipe(k), b = G.bench;
    const S = B.sab && B.sab.pending ? B.sab : null, sab = S && S.pending;
    if (!(S && S.added) && b.cup && (b.cup !== r.cup || Object.keys(b.ing).some(i => (b.ing[i] | 0) > (r.ing[i] | 0)))) return tap('#barPad [data-b="dump"]', 'dump');
    if (!b.cup) { if (sab === 'cup') S.added = true; return barItem(sab === 'cup' ? (r.cup === 'hot' ? 'cold' : 'hot') : r.cup, 'cup'); }
    const keys = Object.keys(r.ing);
    for (const i of keys) {
      if (sab === 'miss' && i === keys[keys.length - 1]) continue;
      if ((b.ing[i] | 0) < r.ing[i]) {
        if (i === '茶' && (p.st !== 'ready' || p.level <= 0)) { if (p.st === 'ready' || p.st === 'empty') return tapPot(); return; }
        return barItem(i, 'ing ' + i);
      }
    }
    if (sab === 'extra' && !S.added) { const x = ING.find(i => i !== '茶' && !r.ing[i] && ingShown().includes(i)); S.added = true; return barItem(x, 'extra ing'); }
    if (S) { S.done.push({ id: g.id, i: tg.i, k, how: sab }); S.pending = null; S.added = false; }
    return tap('#barPad [data-b="serve"]', 'serve');
  }

  /* ---- kitchen ---- */
  const isInst = t => kitLayout().inst.includes(t);
  function route(t) {
    const lay = kitLayout().st;
    if (t.includes('·飯×')) { const [item, n] = t.split('·飯×'); return { st: 'wok', item, rice: +n }; }
    if (t.endsWith('烘底')) { const base = t.slice(0, -2); return { st: 'toaster', item: base, crisp: base === '多士' }; }
    for (const [st, items] of Object.entries(lay)) if (items.includes(t)) return { st, item: t, rice: 0 };
    return null;
  }
  // pad buttons (desktop) or the drawn bins, strainer and wok (phone, 枱面版)
  const kFind = (x, y) => { const r = ktv.getBoundingClientRect(), px = x - r.left, py = y - r.top; return kHits.find(k => px >= k.x && px < k.x + k.w && py >= k.y && py < k.y + k.h); };
  const kitItem = (key, why) => {
    if (kitMode !== 'counter') return tap(`#kitPad [data-k="${key}"]`, why);
    if (key === 'stir') return tapCanvas(ktv, kHits.find(h => h.st === 'wok'), why, kFind);   // tapping the wok that is not done yet is a stir
    if (key.startsWith('h:')) { const t = G.hold[+key.slice(2)] && G.hold[+key.slice(2)].tk; return tapCanvas(ktv, kHits.find(h => h.hold !== undefined && G.hold[h.hold] && G.hold[h.hold].tk === t), why, kFind); }
    if (key.startsWith('s:')) {   // start cooking: tap an empty stove; with several choices a pop-up lists them
      const [, st, item] = key.split(':'), idx = G.kit[st].findIndex(j => !j);
      if (idx < 0) { B.errors.push('no free stove for ' + why); return false; }
      if (!tapCanvas(ktv, kHits.find(h => h.st === st && h.i === idx), why, kFind)) return false;
      const pop = document.getElementById('kpop');
      if (!pop.hidden) { /* b.click() is a click with no press (detail 0), which the pop-up accepts like a keyboard one */ const b = pop.querySelector(`[data-pop="s:${st}:${item}:${idx}"]`); if (!b) { B.errors.push('pop-up has no ' + item); return false; } b.click(); }
      return true;
    }
    return tapCanvas(ktv, kHits.find(h => h.tray === key), why, kFind);
  };
  function kitTick() {
    // the player picks the dish: the bot taps the most urgent ticket on the rail once it is drawn, as a player would
    const g = selOk();
    if (!g) { const n = nextMeal(null), el = n && Q(`[data-mk="${n.gid}:${n.i}"]`); return el ? tap(el, 'ticket') : undefined; }
    const key = g.meals[G.ksel.i].k, P = activePlate(), lay = kitLayout();
    const need = [...O.tokens(key)];
    P.tokens.forEach(t => { const i = need.indexOf(t); if (i >= 0) need.splice(i, 1); });
    const S = B.sab && B.sab.pending ? B.sab : null, sab = S && S.pending;
    if (!need.length || (sab === 'short' && P.tokens.length >= 1 && need.length === 1)) {
      if (sab === 'extra' && !S.added) { S.added = true; return kitItem(`i:${lay.inst[0]}`, 'extra token'); }
      if (S) { S.done.push({ id: g.id, i: G.ksel.i, k: key, how: sab }); S.pending = null; S.added = false; }
      return tap('#kitView [data-k="serve"]', 'serve');
    }
    const rest = [...O.tokens(key)], surplus = [];
    for (const t of P.tokens) { const i = rest.indexOf(t); if (i >= 0) rest.splice(i, 1); else surplus.push(t); }
    if (surplus.length && !(S && S.added)) return tap('#kplate [data-k="dump"]', 'dump plate');
    const claimed = new Set();
    for (const t of need) {
      const hi = G.hold.findIndex(h => h.tk === t);
      if (hi >= 0) return kitMode === 'counter' ? kitItem('h:' + hi, 'hold ' + t) : tap(`#kplate [data-k="h:${hi}"]`, 'hold ' + t);
      if (isInst(t)) return kitItem(`i:${t}`, 'inst ' + t);
      const r = route(t); if (!r) { B.errors.push('no route for token ' + t); continue; }
      const slots = G.kit[r.st];
      let idx = slots.findIndex((j, i) => j && !claimed.has(r.st + i) && j.item === r.item && (r.st !== 'toaster' || true));
      if (idx < 0) {
        if (slots.every(Boolean)) {   // station full: bin a burnt thing if any
          const bi = slots.findIndex(j => j && slotState(r.st, j).cls === 'burnt'); if (bi >= 0) return tapCell(r.st, bi, 'bin burnt');
          continue;
        }
        return kitItem(`s:${r.st}:${r.item}`, 'start ' + r.item);
      }
      claimed.add(r.st + idx);
      const j = slots[idx], s = slotState(r.st, j);
      if (r.st === 'wok') {
        if (j.rice < r.rice) return kitItem('rice2wok', 'rice');
        if (j.stirs < CFG.stirs) return kitItem('stir', 'stir');
        return tapCell('wok', idx, 'take wok');
      }
      if (s.cls === 'burnt') return tapCell(r.st, idx, 'bin burnt');
      if (s.cls.startsWith('ready')) {
        if (r.st === 'toaster' && r.crisp && !j.crisp) return kitItem('s:toaster:多士', 'crisp');
        return tapCell(r.st, idx, 'take ' + r.item);
      }
    }
  }

  /* ---- till ---- */
  const NOTE_LIST = [100, 50, 20, 10, 5, 2, 1];
  function tillTick() {
    const c = G.cur; if (!c || G.board) return;
    const o = B.opts;
    if (G.step === 'total') {
      const lines = c.payLines;
      if (!o.noStrike) { const i = lines.findIndex(l => l.extra && !l.struck); if (i >= 0) return tap(`#cust [data-strike="${i}"]`, 'strike'); }
      const keys = lines.filter(l => !l.struck).map(l => l.k);
      let want = O.price(keys);
      const used = (B.used = B.used || {}), tk = c.id + ':t';
      let how = typeof o.tillMode === 'function' ? o.tillMode(c) : o.tillMode;
      if (used[tk] && how !== 'plus') how = undefined;   // a wrong total is tried once; after being sent back the bot does it right
      if (how === 'over') want += 1; if (how === 'under') want = Math.max(1, want - 1);
      if (how === 'plus') {   // key in the sum line by line with the + key
        const parts = []; let free = keys.filter(O.isMeal).length;
        for (const k of keys) { if (O.isMeal(k)) parts.push(O.mealPrice(k)); else { const cold = k[0] === '凍' ? 3 : 0; if (free > 0) { free--; parts.push(cold); } else parts.push(idOf(DRINKS, k).p + cold); } }
        const str = parts.filter(x => x > 0).join('+');
        if (G.entry === str) return tap('#pad [data-k="ok"]', 'ok');
        if (!str.startsWith(G.entry)) return tap('#pad [data-k="clr"]', 'clr');
        const ch = str[G.entry.length]; return tap(`#pad [data-k="${ch}"]`, 'key ' + ch);
      }
      const str = String(want);
      if (G.entry === str) { used[tk] = 1; return tap('#pad [data-k="ok"]', 'ok'); }
      if (!str.startsWith(G.entry)) return tap('#pad [data-k="clr"]', 'clr');
      return tap(`#pad [data-k="${str[G.entry.length]}"]`, 'digit');
    }
    // cash: give change
    const need = G.paid - G.charged, give = G.give.reduce((a, b) => a + b, 0);
    const used = (B.used = B.used || {}), ck = c.id + ':c';
    let how = typeof o.changeMode === 'function' ? o.changeMode(c) : o.changeMode;
    if (used[ck]) how = undefined;
    const target = how === 'short' ? need - 1 : how === 'over' ? need + 1 : need;
    if (give >= target || (how === 'short' && need <= 1)) { used[ck] = 1; return tap('#pad [data-k="ok"]', 'give ok'); }
    const n = NOTE_LIST.find(n => n <= target - give); return tap(`#pad [data-k="${n}"]`, 'note ' + n);
  }

  /* ---- invariants ---- */
  const GROUP_STATES = ['queue', 'think', 'order', 'wait', 'eat', 'pay'];
  B.check = () => {
    const v = [], bad = (m) => v.push(`t=${G.t.toFixed(1)} ${m}`);
    for (const k of ['revenue', 'loss', 'mistakes', 'angry', 'served', 'paidCount', 'cups', 'dishes', 't', 'rt'])
      if (!Number.isFinite(G[k])) bad(`G.${k} not finite: ${G[k]}`); else if (G[k] < 0) bad(`G.${k} negative: ${G[k]}`);
    for (const k of ['tips', 'combo', 'maxCombo']) if (G[k] !== undefined && (!Number.isFinite(G[k]) || G[k] < 0)) bad(`G.${k} bad: ${G[k]}`);
    if (!Number.isFinite(SHOP.bank) || SHOP.bank < 0) bad('SHOP.bank bad ' + SHOP.bank);
    if (!Number.isFinite(SHOP.stars) || SHOP.stars < 0) bad('SHOP.stars bad');
    if (G.pot.level < 0 || G.pot.level > potCap()) bad('pot level ' + G.pot.level);
    const ids = new Set();
    for (const g of [...G.groups, ...G.payQ]) {
      if (ids.has(g.id)) bad('duplicate group id ' + g.id); ids.add(g.id);
      if (!GROUP_STATES.includes(g.state) && !g.take) bad(`group ${g.id} bad state ${g.state}`);
      if (!(g.size >= 1)) bad(`group ${g.id} size ${g.size}`);
    }
    for (const g of G.groups) {
      if (g.take) continue;
      const seated = ['think', 'order', 'wait', 'eat'].includes(g.state);
      if (seated !== (g.table !== null && g.table !== undefined)) bad(`group ${g.id} ${g.state} table=${g.table}`);
      if (seated && !G.tables[g.table]) bad(`group ${g.id} table ${g.table} missing`);
      if (g.state === 'wait' && !(g.meals && g.drinks)) bad(`group ${g.id} wait without slip`);
      if (g.state === 'order' && g.taken) { /* waiting for the waiter to finish the slip: no timer */ }
      else if (['queue', 'think', 'order', 'eat'].includes(g.state) && G.t > g.until + .25) bad(`group ${g.id} ${g.state} overdue by ${(G.t - g.until).toFixed(2)}s`);
      if (g.state === 'wait') {
        if (g.meals.some(m => !m.done) && G.t > g.mealUntil + .25) bad(`group ${g.id} meal overdue`);
        if (g.drinks.some(d => !d.done) && G.t > g.drinkUntil + .25) bad(`group ${g.id} drink overdue`);
      }
    }
    for (const c of G.payQ) if (!(c.expect >= 0)) bad(`payQ expect ${c.expect}`); else if (G.t > c.until + .25) bad(`payQ customer overdue ${c.id}`);
    for (const tb of G.tables) {
      const occ = G.groups.filter(g => g.table === tb.id).reduce((a, g) => a + g.size, 0);
      if (tb.dirty < 0 || occ + tb.dirty > tb.cap) bad(`table ${tb.name} occ ${occ} dirty ${tb.dirty} cap ${tb.cap}`);
    }
    if (G.groups.filter(g => g.state === 'queue').length > CFG.queueMax + (G.qBonus || 0)) bad('queue over max');
    if (G.payQ.length > 40) bad('payQ ballooned ' + G.payQ.length);
    return v;
  };
  // per-group time spent in one state (waiter 'order' + taken with the sheet closed counts as parked)
  B.age = () => {
    for (const g of G.groups) { const s = B.since[g.id]; if (!s || s.state !== g.state) B.since[g.id] = { state: g.state, at: G.t }; }
    let worst = 0, who = null;
    for (const g of G.groups) { const a = G.t - B.since[g.id].at; if (!['eat'].includes(g.state) && a > worst) { worst = a; who = g.state; } }
    return { worst, who };
  };

  // money conservation (computer till): every bill that reached the till is either in revenue (minus tips), written off as loss, or still waiting
  B.ledger = () => {
    const bills = B.ev.filter(e => e.type === 'toPay').reduce((x, e) => x + e.expect, 0);
    const pending = G.payQ.reduce((x, c) => x + c.expect, 0) + (G.at && G.at.cur ? G.at.cur.expect : 0) + (G.cur ? G.cur.expect : 0);
    return { bills, net: G.revenue - (G.tips | 0), loss: G.loss, pending, missing: bills - G.loss - pending - (G.revenue - (G.tips | 0)) };
  };
  B.counts = () => { const c = {}; B.ev.forEach(e => { c[e.type] = (c[e.type] || 0) + 1; }); return c; };
  /* ---- monkey: a seeded random player that taps whatever is on screen (buttons, canvases, keys) ---- */
  B.monkey = seed => {
    let a = seed >>> 0;
    const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const SEL = ['#app button', '#sheet button', '#board button', '#pad button', '#barPad button', '#kitPad button', '#kplate button', '#krail button', '#rail button', '#queue button', '#floor button', '#cust button', '#pauseView button', '#boardWrap button', '#kpop button', '#toast'];
    const CANVAS = ['#ktv', '#bscene .txl', '#tscene .txl', '#fscene .txl'];
    const KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '=', 'Backspace', 'Enter', 'Escape', 'a'];
    const SKIP = new Set(['quitBtn', 'homeBtn', 'nextBtn', 'againBtn', 'shareBtn', 'endDecorBtn']);
    const seen = { button: 0, canvas: 0, key: 0 };
    const act = () => {
      if (!G.running) return;
      const r = rnd();
      if (r < .72) {
        const els = [...document.querySelectorAll(SEL.join(','))].filter(e => e.offsetParent !== null && !e.disabled && !SKIP.has(e.id) && e.id !== 'toast');
        if (els.length) { els[Math.floor(rnd() * els.length)].click(); seen.button++; }
      } else if (r < .9) {
        const cvs = CANVAS.map(s => document.querySelector(s)).filter(c => c && c.offsetParent !== null);
        if (cvs.length) { const c = cvs[Math.floor(rnd() * cvs.length)], b = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent('pointerdown', { clientX: b.left + rnd() * b.width, clientY: b.top + rnd() * b.height, bubbles: true, pointerType: 'mouse' })); seen.canvas++; }
      } else if (r < .96) {
        const k = KEYS[Math.floor(rnd() * KEYS.length)];
        dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); seen.key++;
      } else if (G.paused) { document.getElementById('resumeBtn').click(); }
      else { document.getElementById('pauseBtn').click(); }
    };
    act.seen = seen;
    return act;
  };
  /* ---- drivers ---- */
  const TICK = { waiter: waiterTick, bar: barTick, kitchen: kitTick, till: tillTick };
  B.tick = () => { if (!G || !G.running || G.paused) return; try { (B.who ? TICK[B.who] : TICK[G.station])(); } catch (e) { B.errors.push('bot threw: ' + e.message); } };
  // lock-step: same body as main.js loop(), but synchronous and with the bot acting between frames. paintEvery: bot acts after a repaint
  B.run = (sec, o = {}) => {
    const dt = o.dt || .05, n = Math.round(sec / dt), every = o.every || 3, bot = o.bot !== false, t0 = G.t, r0 = G.rt;
    const g0 = G;
    for (let i = 0; i < n * 20 && G.rt - r0 < sec - 1e-9 && G === g0 && G.running; i++) {   // sec is GAME seconds (rt): the shop slows while a slip is open on rookie
      if (!G.paused) update(dt * (G.sheet || G.board ? D().slow : 1));
      if (!G.running) break;
      tutTick(); careerTick(); juiceTick();
      if (!G.running) break;   // (the tutorial ends from tutTick and sets G.t to 180 whatever it was: nothing to check after that)
      if (i % every === 0) { paint(); if (bot) B.tick(); const hk = o.hook || B.hook; if (hk) hk(); }
      if (i % 40 === 0) { const v = B.check(); if (v.length) { B.violations.push(...v); if (B.violations.length > 30) break; } B.age(); }
    }
    paint();
    return { from: t0, to: G.t, running: G.running };
  };
  // real time loop: the game's own rAF loop runs (optionally faster); the bot ticks on a timer
  B.start = (opts = {}) => { B.stop(); B.opts = { ...B.opts, ...opts }; B.timer = setInterval(B.tick, opts.every || 40); B.chk = setInterval(() => { if (G && G.running && !G.paused) { const v = B.check(); if (v.length) B.violations.push(...v); B.age(); } }, 1500); };
  B.stop = () => { clearInterval(B.timer); clearInterval(B.chk); B.timer = B.chk = null; };
  B.scale = 1;
  const raf0 = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = f => raf0(t => f(t * B.scale));
  B.stats = () => ({ clicks: B.clicks, errors: B.errors.slice(0, 10), unreachable: [...new Set(B.unreachable)].slice(0, 10), violations: B.violations.slice(0, 10) });
})();
