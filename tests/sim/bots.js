// Players for the simulations: one per station, pressing the same commands the page's buttons call (the CORE_HOOK
// entries and key handlers: tapTable / tapGroup / sheetAct, barKey / pickLine, kitKey / assignMeal, tillKey / strikeLine),
// adapted from tests/helpers/bots.browser.js. Each one mostly plays right and sometimes errs on purpose (a wrong slip, a
// wrong drink, a short plate, a wrong total or wrong change) so the mistake paths run too. `rnd` is the bot's own stream.

export function makeBots(C, rnd, errRate = .06) {
  const H = C.CORE_HOOK, S = () => C.G;
  const oops = () => rnd() < errRate;

  /* ---- waiter: seat, take the order on the sheet, clean ---- */
  function writePerson(p) {
    const act = ds => H.sheetAct(ds);
    if (p.food) { const hat = p.food.includes(C.HAT_TXT); act({ add: 'f', id: hat ? p.food.replace(C.HAT_TXT, '') : p.food }); if (hat) act({ hat: '' }); }
    if (p.set) {
      const s = p.set; act({ add: 's', id: s.id });
      if (s.noodle !== C.DEF.noodle) act({ opt: 'noodle', v: s.noodle });
      if (s.egg !== C.DEF.egg) act({ opt: 'egg', v: s.egg });
      if (s.bread !== C.DEF.bread) act({ opt: 'bread', v: s.bread });
      if (s.hongdai) act({ flag: 'hongdai' });
      if (s.feibin) act({ flag: 'feibin' });
    }
    if (p.dish) { act({ add: 'd', id: p.dish.id }); for (const f of C.DFLAGS) if (p.dish[f]) act({ dflag: f }); }
    const d = p.drink;
    act({ add: 'k', id: d.d });
    if (d.cold && !C.isIced(d.d)) act({ temp: 'cold' });
    if (d.sweet) act({ sweet: String(d.sweet) });
    if (d.noice) act({ noice: '' });
  }
  function waiter() {
    const G = S();
    if (G.sheet) {
      const g = C.byId(G.sheet.gid);
      if (!g) return;
      for (const p of g.persons) writePerson(p);
      if (oops()) H.sheetAct(rnd() < .5 ? { add: 'k', id: C.DRINKS[0].id } : { del: '0' });   // a wrong slip
      if (rnd() < .05) { H.sheetAct({ act: 'later' }); return; }   // put it away for later
      H.sheetAct({ act: 'send' });
      return;
    }
    const sel = G.selected != null ? C.byId(G.selected) : null;
    if (sel && sel.state === 'queue') {
      const tb = G.tables.find(t => !C.seatProblem(sel, t)) || G.tables.find(t => C.seatProblem(sel, t) === 'dirty');
      return tb ? H.tapTable(tb.id) : H.tapGroup(sel.id);
    }
    const ord = G.groups.filter(g => g.state === 'order').sort((a, z) => a.until - z.until)[0];
    if (ord) return H.tapTable(ord.table);
    for (const g of G.groups.filter(g => g.state === 'queue').sort((a, z) => a.until - z.until))
      if (C.bestTable(g) || G.tables.some(t => C.seatProblem(g, t) === 'dirty')) return H.tapGroup(g.id);
    const dirty = G.tables.find(t => t.dirty);
    if (dirty) H.tapTable(dirty.id);
  }

  /* ---- bar: tea pot, cup, ingredients, serve ---- */
  function bar() {
    const G = S(), p = G.pot;
    if (p.st === 'empty' || p.st === 'pull' || (p.st === 'ready' && p.level <= 3 && G.phase === 'open')) return H.barKey('pot');
    if (G.phase === 'prep') return;
    let tg = G.bench.target, g = tg && C.byId(tg.gid);
    if (!tg || !g || g.state !== 'wait' || g.drinks[tg.i].done) {
      const n = C.nextTarget(null); if (!n) return;
      H.pickLine(n.gid, n.i); tg = G.bench.target; g = C.byId(tg.gid);
    }
    const r = C.recipeOf(g.drinks[tg.i].k), b = G.bench;
    if (b.cup && (b.cup !== r.cup || C.ING.some(i => (b.ing[i] | 0) > r[i]))) return H.barKey('dump');
    if (!b.cup) return H.barKey(r.cup);
    for (const i of C.ING) if ((b.ing[i] | 0) < r[i]) {
      if (i === '茶' && (p.st !== 'ready' || p.level <= 0)) return p.st === 'ready' || p.st === 'empty' ? H.barKey('pot') : undefined;
      if (oops()) return H.barKey('serve');   // serves it short
      return H.barKey(i);
    }
    H.barKey('serve');
  }

  /* ---- kitchen: stoves, plate, serve ---- */
  function route(t) {
    const lay = C.kitLayout().st;
    if (t.includes('·飯×')) { const [item, n] = t.split('·飯×'); return { st: 'wok', item, rice: +n }; }
    if (t.endsWith('烘底')) { const base = t.slice(0, -2); return { st: 'toaster', item: base, crisp: base === '多士' }; }
    for (const [st, items] of Object.entries(lay)) if (items.includes(t)) return { st, item: t, rice: 0 };
    return null;
  }
  function kitchen() {
    const G = S();
    if (!C.selOk()) { const n = C.nextMeal(null); if (!n) return; H.assignMeal(n.gid, n.i); if (!C.selOk()) return; }
    const g = C.selOk(), key = g.meals[G.ksel.i].k, P = C.activePlate(), lay = C.kitLayout();
    const want = C.kitRecipe(key), need = [...want];
    P.tokens.forEach(t => { const i = need.indexOf(t); if (i >= 0) need.splice(i, 1); });
    if (!need.length || (need.length === 1 && P.tokens.length && oops())) return H.kitKey('serve');
    const rest = [...want];
    if (P.tokens.some(t => { const i = rest.indexOf(t); if (i >= 0) { rest.splice(i, 1); return false; } return true; })) return H.kitKey('dump');
    const claimed = new Set();
    for (const t of need) {
      const hi = G.hold.findIndex(h => h.tk === t);
      if (hi >= 0) return H.kitKey('h:' + hi);
      if (lay.inst.includes(t)) return H.kitKey('i:' + t);
      const r = route(t); if (!r) continue;   // a token this kitchen cannot make (a level's own kitchen): the meal runs late
      const slots = G.kit[r.st];
      const idx = slots.findIndex((j, i) => j && !claimed.has(r.st + i) && j.item === r.item);
      if (idx < 0) {
        if (slots.every(Boolean)) { const bi = slots.findIndex(j => j && C.slotState(r.st, j).cls === 'burnt'); if (bi >= 0) return H.kitKey(`t:${r.st}:${bi}`); continue; }
        return H.kitKey(`s:${r.st}:${r.item}`);
      }
      claimed.add(r.st + idx);
      const j = slots[idx], s = C.slotState(r.st, j);
      if (r.st === 'wok') {
        if (j.rice < r.rice) return H.kitKey('rice2wok');
        if (j.stirs < C.CFG.stirs) return H.kitKey('stir');
        return H.kitKey(`t:wok:${idx}`);
      }
      if (s.cls === 'burnt') return H.kitKey(`t:${r.st}:${idx}`);
      if (s.cls.startsWith('ready')) {
        if (r.st === 'toaster' && r.crisp && !j.crisp) return H.kitKey('s:toaster:多士');
        return H.kitKey(`t:${r.st}:${idx}`);
      }
    }
  }

  /* ---- till: strike what they never ordered, key in the total, give change ---- */
  const tried = new Set();
  function till() {
    const G = S(), c = G.cur; if (!c || G.board) return;
    if (G.step === 'total') {
      const i = c.payLines.findIndex(l => l.extra && !l.struck);
      if (i >= 0) return H.strikeLine(i);
      let want = C.priceSlip(c.payLines.filter(l => !l.struck).map(l => l.k)).total;
      if (!tried.has(c.id + 't') && oops()) want += rnd() < .5 ? 1 : -1;   // a wrong total, once
      const str = String(Math.max(1, want));
      if (G.entry === str) { tried.add(c.id + 't'); return H.tillKey('ok'); }
      if (!str.startsWith(G.entry)) return H.tillKey('clr');
      return H.tillKey(str[G.entry.length]);
    }
    const need = G.paid - G.charged, give = G.give.reduce((a, b) => a + b, 0);
    const target = !tried.has(c.id + 'c') && oops() ? need + (rnd() < .5 ? 1 : -1) : need;
    if (give >= target) { tried.add(c.id + 'c'); return H.tillKey('ok'); }
    const n = C.NOTES.find(n => n <= target - give);
    H.tillKey(n ? String(n) : 'ok');
  }

  return { waiter, bar, kitchen, till };
}
