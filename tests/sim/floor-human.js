// A person at a 樓面 seat for runCoop: the floor's bubbles are shared by everyone on the floor
// (core/work/floor.ts), each taken with a claim. When free, the person looks at the open bubbles every `poll` s, takes the
// oldest (a 「傳」 or 「包」 station tap takes what one tap takes: stationPick + floorTakeMany, the claim path the page uses),
// works it for the load table's mid seconds for it (core/work/load.ts LOAD, drawn log-normal at the profile's sd, plus a
// decision), then sends the result that completes it, as tests/sim/floor.js's floor brain does. A 送外賣 run rides for
// its LOAD seconds and comes back. While a job is held the claim is kept alive (setWorking), so a slow job never times out.
import { profileOf } from './human.js';

export function makeFloorHuman(C, rnd, profile, seat) {
  const P = profileOf(profile), st = { jobs: 0, busy: 0, sec: 0, by: {} };
  let job = null, lookAt = 0;
  const gauss = () => { const u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const draw = m => m * Math.exp(P.sd * gauss());
  C.setWorking(() => job ? (job.ids ?? [job.id]) : []);
  const G = () => C.G;
  const open = () => (G().floor?.tasks ?? []).filter(x => x.by === null).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const num = id => Number(id.slice(id.indexOf(':') + 1));
  const sl = () => G().slot ?? 'lunch';
  function secOf(id, n) {
    const k = id.split(':')[0], g = C.byId(num(id));
    if (k === 'seat') return C.taskSec('seat');
    if (k === 'order') return C.taskSec('order', g && g.size ? g.size : 2, sl());
    if (k === 'carry') return C.taskSec('carry');
    if (k === 'clear') return C.taskSec('clear', 4, sl());
    if (k === 'bag') return C.taskSec('bag', g && g.items ? g.items.length : 2, sl()) * n;
    return C.taskSec('deliver', Math.max(0, n - 1));
  }
  function take() {
    // a party with no table free to seat them is not a job yet (a person looks for a table and sees none)
    const ok = y => { if (!y.id.startsWith('seat:')) return true; const g = C.byId(num(y.id)); return !!g && !g.take && g.state === 'queue' && !!C.bestTable(g); };
    const x = open().find(ok); if (!x) return false;
    const k = x.id.split(':')[0];
    let ids;
    if (k === 'carry' || k === 'bag' || k === 'deliver') ids = C.floorTakeMany(C.stationPick(k));
    else ids = C.taskWant(x.id) ? [x.id] : [];
    if (!ids.length) return false;
    const s = draw(secOf(ids[0], ids.length));   // LOAD's mid seconds are measured whole jobs (the decision inside)
    job = { id: ids[0], ids, k, until: G().t + s, phase: k === 'deliver' ? 'go' : null, sec: s };
    if (k === 'deliver') job.until = G().t + draw(P.react);
    st.busy += s;
    return true;
  }
  function finish() {
    const j = job, g0 = G();
    if (j.k === 'deliver') {
      if (j.phase === 'go') { C.submit(seat, { k: 'ride', gids: j.ids.map(num) }); job = { ...j, phase: 'out', until: g0.t + draw(secOf(j.id, j.ids.length)) }; return; }
      for (const id of j.ids) C.submit(seat, { k: 'dropped', gid: num(id) });
      C.submit(seat, { k: 'back' });
    } else for (const id of j.ids) {
      const n = num(id), mine = g0.floor?.tasks.find(x => x.id === id)?.by === C.phone()?.me;
      if (!mine) continue;   // lost it meanwhile (a teammate's earlier claim, a timeout)
      if (j.k === 'seat') { const g = C.byId(n); const tb = g && !g.take && g.state === 'queue' ? C.bestTable(g) : null; if (tb) C.submit(seat, { k: 'seat', gid: n, table: tb.id }); }
      else if (j.k === 'order') { const g = C.byId(n); if (g && !g.take && g.state === 'order') C.submit(seat, { k: 'order', gid: n, keys: [...g.items], peeked: false }); }
      else if (j.k === 'carry') {
        const refs = [];
        for (const g of g0.groups) if (!g.take && g.table === n - 1) for (const x of C.linesOf(g)) if (x.l.passT !== undefined) refs.push({ gid: g.id, dest: x.dest, i: x.i });
        if (refs.length) C.submit(seat, { k: 'carried', refs, table: n });
      }
      else if (j.k === 'clear') C.submit(seat, { k: 'cleared', table: n, secs: 3, resets: 0 });
      else if (j.k === 'bag') C.submit(seat, { k: 'packed', gid: n, stars: 3, tip: 2 });
    }
    for (const id of j.ids) C.taskDrop(id);
    st.jobs++; st.sec += j.sec; st.by[j.k] = (st.by[j.k] ?? 0) + 1; job = null;
  }
  /** One frame (game time from the phone's own clock). `on`: the person plays now. */
  function tick(_now, on) {
    const t = G().t;
    if (!on) return;
    if (job) { if (t >= job.until) finish(); return; }
    if (t < lookAt) return;
    if (!take()) lookAt = t + draw(P.poll);
  }
  return { tick, stats: st, profile: P, busy: () => job !== null };
}
