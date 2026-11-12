// The party night playtest page (site/party.html, bundled by scripts/build.mjs into site/party.js): a whole night on one
// screen, against the real night (partySeam) with up to 8 fake players. A tester clicks through it as any of them; the
// round itself is the stand-in (standin.ts) until the referee runs real shifts. Not linked from the game.
//
// URL: ?seed=1 (the night's seed), ?n=4 (players at the start, 0-8), ?names=a,b,... (their names), ?auto=0 (the others
// do not act on their own), ?clock=0 (no running clock: only 跳 moves time), ?speed=1.
// The test build also puts a handle on window.__party for the Playwright tests; the production build does not.
import { PARTY_MAX_PLAYERS } from '../../core/party/config';
import { counted, mustReady, voters } from '../../core/party/night';
import { partySeam } from '../../core/party/seam';
import type { PartyEvent, PartyOut, RoundPlan } from '../../core/party/types';
import { h } from './draw';
import { mountParty } from './mount';
import { DriveLog, fakeMove, rng, standinReport } from './standin';
import type { Luck } from './standin';
import { remaining } from './view';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? v : d; };
const seed = num('seed', 1), r = rng(seed ^ 0x5eed);
const NAMES = ['阿明', '細妹', '肥仔', 'Ken', '歐陽小美', '阿 Sir', '高佬', '司徒長長名字'];
const given = (q.get('names') ?? '').split(',').map(x => x.trim()).filter(Boolean);
const fakes = Array.from({ length: PARTY_MAX_PLAYERS }, (_, i) => ({ id: `f${String(i + 1)}`, name: given[i] ?? NAMES[i] ?? `玩家${String(i + 1)}` }));
let auto = q.get('auto') !== '0', running = q.get('clock') !== '0', speed = num('speed', 1), luck: Luck = 'auto';
let view = fakes[0]?.id ?? 'f1';

const seam = partySeam(seed);
let plan: RoundPlan | null = null, roundT = 0, log: DriveLog | null = null;

/** The referee's part of what the night answers: start a round, hand seats over. */
function handle(out: PartyOut[]): PartyOut[] {
  for (const o of out) {
    if (o.k === 'roundStart') { plan = o.plan; roundT = 0; log = new DriveLog(o.plan.seats, 0); }
    else if (o.k === 'drive') log?.drive(o.seat, o.player, roundT);
  }
  return out;
}
const send = (ev: PartyEvent): PartyOut[] => handle(seam.input(ev));

function endRound(): void {
  if (!plan || seam.night().phase !== 'round') return;
  const p = plan;
  plan = null;
  handle(seam.roundResult(standinReport(p, log?.end(Math.max(roundT, 1)) ?? {}, luck, r)));
  log = null;
}
/** dt game seconds: the night's screens, the stand-in round, and the fake players. */
function step(dt: number): void {
  handle(seam.tick(dt));
  if (seam.night().phase === 'round' && plan) { roundT += dt; if (roundT >= plan.sec) endRound(); }
  if (auto) { const ev = fakeMove(seam.night(), fakes.map(f => f.id), view, r); if (ev) send(ev); }
  ui.update();
  drawRig();
}
/**
 * 跳 (a playtest shortcut, not a rule of the night): everyone the screen waits for does the plain thing now (votes 穩陣,
 * taps 下一步, taps 我準備好 and the boss taps 開工), then the screen's own clock runs out (a round ends with the
 * stand-in's result). The phone being looked at is included: 跳 is the whole table moving on.
 */
function skip(): void {
  let s = seam.night();
  if (s.phase === 'endcard') for (const p of counted(s)) if (!s.taps.includes(p.id)) send({ k: 'next', player: p.id });
  if (s.phase === 'vote' && s.wager) for (const p of voters(s)) if (s.wager.votes[p.id] === undefined) send({ k: 'vote', player: p.id, card: 0 });
  if (s.phase === 'ready') {
    for (const p of mustReady(s)) if (!s.taps.includes(p.id)) send({ k: 'ready', player: p.id, on: true });
    if (s.host !== null) send({ k: 'start', player: s.host });
  }
  s = seam.night();
  if (s.phase === 'round') { roundT = plan?.sec ?? roundT; endRound(); }
  else if (remaining(s) !== null) {
    // Small steps until the screen changes: one big tick would carry its leftover into the next screens (a vote that
    // closes early would run on through the countdown).
    const at = `${s.phase}/${String(s.round)}`;
    for (let i = 0; i < 1000 && `${seam.night().phase}/${String(seam.night().round)}` === at; i++) handle(seam.tick(.05));
  }
  ui.update();
  drawRig();
}

/** The first free seat for a fake newcomer, never 樓面's second place (a player takes it by tapping 樓面). */
const firstFree = (seats: Record<string, string | null>): string | undefined => Object.keys(seats).find(k => seats[k] === null && k !== 'floor2');
/** A fake player in or out of the room; in the lobby a newcomer sits in the first free seat. */
function toggle(id: string): void {
  const s = seam.night(), p = s.players.find(x => x.id === id), f = fakes.find(x => x.id === id);
  if (p?.present) send({ k: 'leave', player: id });
  else {
    send({ k: 'join', player: id, name: f?.name ?? id });
    const n = seam.night(), free = firstFree(n.seats);
    if (n.phase === 'lobby' && free !== undefined && n.players.find(x => x.id === id)?.seat === null) send({ k: 'seat', player: id, seat: free });
  }
  ui.update();
  drawRig();
}

// ---------------------------------------------------------------- the rig (playtest controls, not game art)

const rig = document.getElementById('rig') ?? document.body;
const phone = document.getElementById('phone') ?? document.body;
function seg<V extends string | number>(id: string, opts: readonly [V, string][], cur: V, pick: (v: V) => void): HTMLElement {
  return h('span', { cls: 'rseg', data: { r: id } }, ...opts.map(([v, label]) => h('button', { pressed: v === cur, data: { v: String(v) }, on: () => { pick(v); drawRig(); } }, label)));
}
let rigKey = '';
const rigInfo = (): string => { const s = seam.night(); return `${s.phase} · ${s.phase === 'round' && plan ? `${String(Math.floor(roundT))}/${String(plan.sec)}s` : `${s.phaseT.toFixed(0)}s`}`; };
/** The rig: re-built only when what it shows changes (a button is never replaced under a finger); the clock in place. */
function drawRig(): void {
  const s = seam.night(), key = JSON.stringify([view, auto, running, speed, luck, s.host, s.players.map(p => [p.id, p.present])]);
  if (key === rigKey) { const info = rig.querySelector('[data-r="info"]'); if (info) info.textContent = rigInfo(); return; }
  rigKey = key;
  rig.replaceChildren(
    h('div', { cls: 'rrow', data: { r: 'players' } }, ...fakes.map(f => {
      const p = s.players.find(x => x.id === f.id), here = p?.present ?? false;
      return h('span', { cls: 'rp' + (here ? ' in' : '') + (view === f.id ? ' view' : ''), data: { p: f.id } },
        h('button', { cls: 'rv', data: { p: f.id }, on: () => { view = f.id; ui.setMe(f.id); drawRig(); } }, f.name + (s.host === f.id ? '·老闆' : '')),
        h('button', { cls: 'rin', data: { p: f.id }, label: here ? '走' : '入', on: () => { toggle(f.id); } }, here ? '走' : '入'));
    })),
    h('div', { cls: 'rrow' },
      h('button', { cls: 'rb', pressed: auto, data: { r: 'auto' }, on: () => { auto = !auto; drawRig(); } }, '其他人自動'),
      h('button', { cls: 'rb', pressed: running, data: { r: 'clock' }, on: () => { running = !running; drawRig(); } }, '時鐘'),
      seg('speed', [[1, 'x1'], [4, 'x4'], [20, 'x20']], speed, v => { speed = v; }),
      seg<Luck>('luck', [['auto', '隨機'], ['good', '爆單'], ['bad', '災難']], luck, v => { luck = v; }),
      h('button', { cls: 'rb', data: { r: 'skip' }, on: skip }, '跳 ⏭'),
      h('span', { cls: 'rinfo', data: { r: 'info' } }, rigInfo())),
  );
}

// ---------------------------------------------------------------- start

const n0 = Math.max(0, Math.min(PARTY_MAX_PLAYERS, Math.round(num('n', 4))));
for (const f of fakes.slice(0, n0)) {
  send({ k: 'join', player: f.id, name: f.name });
  const s = seam.night(), free = firstFree(s.seats);
  if (free !== undefined) send({ k: 'seat', player: f.id, seat: free });
}
const ui = mountParty(phone, { input: ev => { const out = send(ev); drawRig(); return out; }, night: () => seam.night() }, view);
drawRig();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(.25, Math.max(0, (now - last) / 1000)) * speed;
  last = now;
  if (running && dt > 0) step(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (STATION_TEST) {
  Reflect.set(window, '__party', {
    seam, ui, fakes, step, skip, endRound, toggle,
    night: () => seam.night(),
    get plan() { return plan; },
    get view() { return view; },
    setLuck(v: Luck) { luck = v; drawRig(); },
    setAuto(v: boolean) { auto = v; drawRig(); },
    setClock(v: boolean) { running = v; drawRig(); },
  });
}
