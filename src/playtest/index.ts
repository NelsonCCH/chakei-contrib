// The preview's 試玩 pace panel. Only when the Worker says so: GET /api/config answers
// `playtest: true` only on a Worker deployed with PLAYTEST="1" (a playtest preview; the shipped
// wrangler.jsonc does not set it), so production never mounts any of this. A small 試玩 button in the corner (over every
// screen, the seat view's iframe included) opens a sheet with one slider 1..10 per station (core/playtest/pace.ts),
// the value always shown, and 新手 / 熟手 / 有挑戰 buttons that record a mark (marks.ts) on this device; 匯出 copies the
// marks as plain text (and always shows them in a text box to copy by hand).
// Co-op: the host's phone (the referee) sets every station; a teammate's phone sets only its own seat's station, sent to
// the referee as a `pace` result (core/coop/results.ts), the other sliders shown but locked.
import { G, diff, slot, station } from '../core/state';
import { PORT } from '../core/env';
import { PACE_STATIONS, PACE_NAMES, PACE_BASE, paceOf, setPace, paceAll, paceK, flowStation, type PaceStation } from '../core/playtest/pace';
import { knobsNow } from '../core/playtest/apply';
import { submit } from '../core/coop/results';
import { phone } from '../core/coop/phone';
import { soloSeatOn } from '../core/career/xseat';
import { NET } from '../net/net';
import { CLOUD, cloudReady } from '../ui/cloud';
import { TASTE } from '../ui/taste';
import { setPtAllRoles, ptAllRolesOn } from '../ui/career';
import { buildMenus } from '../ui/main';
import { setFloorArt, floorArt, type FloorArt } from '../ui/floor-map';
// A new key, so a choice saved under the old three-way switch (ckf_pt_floorart) does not hide the new default
const PT_ART_KEY = 'ckf_pt_floorart2';
const ART_NEXT: Readonly<Record<FloorArt, FloorArt>> = { code: 'all', all: 'code' };
const ART_NAME: Readonly<Record<FloorArt, string>> = { all: '樓面畫風：新畫（撳轉舊畫）', code: '樓面畫風：舊畫（撳轉新畫）' };
const PT_ROLES_KEY = 'ckf_pt_allroles';
import { BANDS, BAND_NAMES, loadMarks, saveMarks, marksText, type Band, type Mark } from './marks';
import { ptLogStart, ptPace } from './log';
import { observeStart } from './observe';
import { BUILD_ID } from '../ver/stale';
import type { PtExtra } from '../core/playtest/hook';

const CSS = `
#ptBtn{position:fixed;z-index:70;left:calc(98px + env(safe-area-inset-left,0px));top:calc(8px + env(safe-area-inset-top,0px));
  font-family:var(--body,sans-serif);font-weight:900;font-size:12px;line-height:1;padding:6px 7px;background:#ffd25a;color:#0f1a16;border:2px solid #0f1a16;box-shadow:0 2px 0 #0f1a16;opacity:.8;cursor:pointer}
#ptBtn.on{background:#ff8a5a;opacity:1}
/* the co-op room: a slim upright tab in the 16 px left gutter, below the header, so it is never over the
   room's header (房號 / 派對夜), a button or the netbadge, wherever the room view is scrolled */
body:has(#coopView:not([hidden])) #ptBtn{left:calc(1px + env(safe-area-inset-left,0px));top:calc(64px + env(safe-area-inset-top,0px));
  writing-mode:vertical-rl;font-size:10px;letter-spacing:1px;padding:4px 1px;border-width:1px;box-shadow:none}
#ptPanel{position:fixed;z-index:71;left:0;right:0;bottom:0;max-height:64vh;overflow:auto;background:#fbf6e2;color:#0f1a16;border-top:3px solid #0f1a16;
  box-shadow:0 -4px 0 rgba(15,26,22,.35);padding:8px 10px calc(10px + env(safe-area-inset-bottom,0px));font-family:var(--body,sans-serif);-webkit-user-select:none;user-select:none}
#ptPanel[hidden]{display:none}
#ptPanel button{font-family:inherit;font-weight:900;color:#0f1a16;cursor:pointer;border:2px solid #0f1a16}
#ptPanel .pt-head{display:flex;align-items:center;gap:8px}
#ptPanel .pt-head b{font-size:16px;white-space:nowrap}
#ptPanel .pt-ctx{flex:1;font-size:11px;color:#58695f;line-height:1.3}
#ptPanel .pt-x{font-size:15px;width:32px;height:32px;background:#fff}
#ptPanel .pt-note{font-size:11px;color:#58695f;margin:2px 0 4px;line-height:1.35}
#ptPanel .pt-row{border:2px solid #0f1a16;background:#fff;padding:4px 8px 6px;margin:5px 0}
#ptPanel .pt-row.off{opacity:.55}
#ptPanel .pt-top{display:flex;align-items:center;gap:8px}
#ptPanel .pt-name{font-weight:900;font-size:14px;min-width:84px;white-space:nowrap}
#ptPanel .pt-name i{font-style:normal;font-size:10px;background:#235648;color:#fff;padding:1px 4px;margin-left:3px;vertical-align:2px}
#ptPanel input[type=range]{flex:1;min-width:0;height:26px;margin:0;accent-color:#a5372f}
#ptPanel .pt-val{font-family:var(--display,inherit);font-weight:900;font-size:22px;line-height:1;min-width:26px;text-align:right;font-variant-numeric:tabular-nums}
#ptPanel .pt-bands{display:flex;gap:6px;margin-top:2px}
#ptPanel .pt-bands button{flex:1;font-size:13px;line-height:1;padding:7px 0;background:#e3ede7}
#ptPanel .pt-bands button[data-band=skilled]{background:#f3e5b2}
#ptPanel .pt-bands button[data-band=challenge]{background:#f6c3b5}
#ptPanel .pt-bands button:active{transform:translateY(1px)}
#ptPanel .pt-last{font-size:11px;color:#235648;margin-top:3px;line-height:1.3}
#ptPanel .pt-last:empty{display:none}
#ptPanel .pt-more{width:100%;font-size:12px;padding:6px 0;background:#e3ede7;margin-top:2px}
#ptPanel .pt-foot{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
#ptPanel .pt-foot button{font-size:13px;line-height:1;padding:8px 10px;background:#ffd25a}
#ptPanel .pt-foot button.pt-weak{background:#fff}
#ptPanel textarea{box-sizing:border-box;width:100%;height:110px;margin-top:6px;font:11px/1.35 ui-monospace,monospace;-webkit-user-select:text;user-select:text;border:2px solid #0f1a16}
#ptPanel .pt-msg{font-size:12px;font-weight:900;color:#a5372f;margin-top:4px}
`;

let marks: Mark[] = [];
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e;
};

/** The stations this phone's player holds now (roles 'me'). */
const mine = (): PaceStation[] => G ? PACE_STATIONS.filter(s => G?.roles[s] === 'me') : [];
const isTeammate = (): boolean => NET.role === 'client';
/** A teammate may move only its own seat's slider; the host and solo move all. */
const canSet = (st: PaceStation): boolean => !isTeammate() || mine().includes(st);
function modeNow(): string {
  const S = G; if (!S) return 'menu';
  const m = S.tut ? 'tutorial' : S.drng ? 'daily' : soloSeatOn() ? 'solo-seat' : NET.role || S.coop ? 'coop' : S.level ? 'level' : PORT.inMyShop() ? 'own-shop' : 'free';
  return S.running ? m : m + ' (not running)';
}
function contextNow(): Pick<Mark, 'mode' | 'level' | 'levelN' | 'levelName' | 'diff' | 'slot' | 'seat' | 'role' | 't'> {
  const S = G, lv = S?.level ? PORT.level(S.level) : undefined;
  return {
    mode: modeNow(), level: S?.level ?? null, levelN: lv ? lv.n : null, levelName: lv ? lv.name : null,
    diff, slot: S ? S.slot : slot, seat: mine().join('+') || station,
    role: NET.role === 'client' ? 'teammate' : NET.role === 'host' ? 'host' : 'solo', t: S ? S.t : 0,
  };
}
/** The timing log's shift row: the shift's context, every slider (p_<station>) and knob (k_<station>). */
function logContext(): PtExtra {
  const c = contextNow(), out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(c)) if (v !== null) out[k] = typeof v === 'number' ? Math.round(v * 10) / 10 : v;
  for (const [k, v] of Object.entries(paceAll())) out['p_' + k] = v;
  for (const [k, v] of Object.entries(knobsNow())) if (v !== null) out['k_' + k] = v;
  if (G?.extra?.length) out.extra = G.extra.join('+');
  return out;
}
function ctxLine(): string {
  const c = contextNow();
  return `${c.level ? `關卡 ${c.levelN !== null ? String(c.levelN) : ''} ${c.levelName ?? ''}` : c.mode} · ${c.diff} · ${c.slot} · ${c.role}`;
}

/**
 * The shift's next arrivals follow a moved slider at once (only where customers are made: solo and the host): the wait
 * to the next customer (the flow station's slider), 斬料 walk-in (燒味) or takeaway order (外賣) is rescaled.
 */
function rescale(st: PaceStation, was: number, now: number): void {
  const S = G; if (!S || !S.running || isTeammate() || was === now) return;
  const k = paceK(was) / paceK(now);
  if (st === flowStation() && S.nextSpawn > S.t) S.nextSpawn = S.t + (S.nextSpawn - S.t) * k;
  if (st === 'roast' && S.nextRoast != null && S.nextRoast > S.t) S.nextRoast = S.t + (S.nextRoast - S.t) * k;
  if (st === 'takeaway' && S.nextPack != null && S.nextPack > S.t) S.nextPack = S.t + (S.nextPack - S.t) * k;
}
/** Moves one slider (the panel's input, or tests): here at once, and to the referee from a teammate's own seat. */
export function playtestSet(st: PaceStation, v: number): void {
  if (!canSet(st)) return;
  const was = setPace(st, v), now = paceOf(st);
  rescale(st, was, now);
  if (was !== now) ptPace(st, now);   // the timing log
  if (isTeammate() && phone() && G) submit(st, { k: 'pace', st, v: now });
  refreshBtn();
}
export function playtestMark(st: PaceStation, band: Band): Mark {
  const k = knobsNow();
  const m: Mark = { at: new Date().toISOString(), st, band, v: paceOf(st), ...contextNow(), knob: k[st] ?? null, all: { ...paceAll() } };
  marks.push(m); saveMarks(marks);
  return m;
}
export const playtestMarks = (): readonly Mark[] => marks;
export const playtestText = (): string => marksText(marks);

let btn: HTMLButtonElement | null = null, panel: HTMLDivElement | null = null;
const refreshBtn = (): void => { btn?.classList.toggle('on', PACE_STATIONS.some(s => paceOf(s) !== PACE_BASE)); };

/** A station of the shift on screen now (a role, or an extra seat). */
const inShift = (s: PaceStation): boolean => !!G && (G.roles[s] !== undefined || !!G.extra?.some(x => x === s));
/** Row order: this phone's station(s) first, then the shift's other stations, then the rest. */
function order(): PaceStation[] {
  const me = mine();
  return [...me, ...PACE_STATIONS.filter(s => !me.includes(s) && inShift(s)), ...PACE_STATIONS.filter(s => !me.includes(s) && !inShift(s))];
}
function row(st: PaceStation): HTMLDivElement {
  const r = el('div', 'pt-row'); r.dataset.st = st;
  const top = el('div', 'pt-top'), name = el('div', 'pt-name', PACE_NAMES[st]);
  if (mine().includes(st)) name.append(el('i', '', '你'));
  const input = el('input'); input.type = 'range'; input.min = '1'; input.max = '10'; input.step = '1'; input.value = String(paceOf(st));
  input.setAttribute('aria-label', PACE_NAMES[st] + ' 難度');
  const val = el('b', 'pt-val', String(paceOf(st)));
  const last = el('div', 'pt-last');
  const ok = canSet(st);
  input.disabled = !ok; if (!ok){ r.classList.add('off'); last.textContent = '老闆部機設定'; }
  input.oninput = (): void => { playtestSet(st, Number(input.value)); val.textContent = String(paceOf(st)); };
  top.append(name, input, val);
  const bands = el('div', 'pt-bands');
  for (const b of BANDS){
    const k = el('button', '', BAND_NAMES[b]); k.type = 'button'; k.dataset.band = b;
    k.onclick = (): void => { const m = playtestMark(st, b); last.textContent = `已記：${BAND_NAMES[b]} @ ${String(m.v)}（${ctxLine()}）`; foot(); };
    bands.append(k);
  }
  r.append(top, bands, last);
  return r;
}
let footEl: HTMLDivElement | null = null;
function foot(): void {
  const f = footEl; if (!f) return;
  const ex = f.querySelector<HTMLButtonElement>('[data-pt=export]'); if (ex) ex.textContent = `匯出（${String(marks.length)}）`;
}
async function exportMarks(out: HTMLDivElement): Promise<void> {
  const text = playtestText();
  out.hidden = false;
  const ta = out.querySelector('textarea'), msg = out.querySelector('.pt-msg');
  if (ta){ ta.value = text; ta.focus(); ta.select(); ta.scrollTop = 0; }
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch { /* no clipboard (http, iOS without a gesture): the box below */ }
  if (msg) msg.textContent = copied ? `已複製 ${String(marks.length)} 個記號，貼俾我哋就得。` : '複製唔到：喺下面個框長按，全選，複製。';
}
function render(): void {
  const p = panel; if (!p) return;
  p.replaceChildren();
  const head = el('div', 'pt-head');
  const x = el('button', 'pt-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', '收起'); x.onclick = (): void => { p.hidden = true; };
  head.append(el('b', '', '試玩難度'), el('span', 'pt-ctx', ctxLine()), x);
  p.append(head, el('p', 'pt-note', '5 = 今日設定；拉完即刻生效（新客人起計）。覺得啱就撳新手／熟手／有挑戰記低。'));
  const list = order(), here = list.filter(inShift), rest = list.filter(st => !here.includes(st));
  for (const st of here) p.append(row(st));
  if (rest.length){
    const more = el('button', 'pt-more', `其他崗位（${rest.map(st => PACE_NAMES[st]).join('、')}）`); more.type = 'button';
    more.onclick = (): void => { more.replaceWith(...rest.map(row)); };
    p.append(more);
  }
  const f = el('div', 'pt-foot'); footEl = f;
  const out = el('div'); out.hidden = true; out.append(el('div', 'pt-msg'), el('textarea'));
  const ex = el('button', '', ''); ex.type = 'button'; ex.dataset.pt = 'export'; ex.onclick = (): void => { void exportMarks(out); };
  const rs = el('button', 'pt-weak', '全部還原 5'); rs.type = 'button';
  rs.onclick = (): void => { for (const s of PACE_STATIONS) playtestSet(s, PACE_BASE); render(); };
  const cl = el('button', 'pt-weak', '清除記號'); cl.type = 'button';
  cl.onclick = (): void => { if (!marks.length || !confirm(`清除 ${String(marks.length)} 個記號？（清咗就冇，記得先匯出）`)) return; marks = []; saveMarks(marks); foot(); };
  // One switch for every level, role, seat and lesson (derived, never written to the save)
  const ar = el('button', 'pt-weak', ptAllRolesOn() ? '關卡同崗位：全開（撳返跟進度）' : '關卡同崗位：跟進度（撳全開）'); ar.type = 'button'; ar.dataset.pt = 'allopen';
  ar.onclick = (): void => { const on = !ptAllRolesOn(); setPtAllRoles(on); try { localStorage.setItem(PT_ROLES_KEY, on ? '1' : '0'); } catch { /* private mode */ } buildMenus(); render(); };
  // The shop map's generated art (新畫, the default everywhere) or the code-drawn art (舊畫)
  const fa = el('button', 'pt-weak', ART_NAME[floorArt()]); fa.type = 'button'; fa.dataset.pt = 'floorart';
  fa.onclick = (): void => { const m = ART_NEXT[floorArt()]; setFloorArt(m); try { localStorage.setItem(PT_ART_KEY, m); } catch { /* private mode */ } render(); };
  f.append(ex, rs, cl, ar, fa); p.append(f, out); foot();
  const ver = el('p', 'pt-note', `版本 ${BUILD_ID}`); ver.dataset.pt = 'build'; p.append(ver);   // which build this page runs
}
export function playtestOpen(): void { if (!panel) return; render(); panel.hidden = false; }

let mounted = false;
/** Mounts the corner button and the panel (once). */
export function playtestMount(): void {
  if (mounted) return; mounted = true;
  marks = loadMarks();
  ptLogStart(logContext, observeStart());   // the preview records how fast the player plays (log.ts)
  // New roles are gated along the ladder; the playtester can open them all here (default on, the preview is for trying
  // things), and the same switch opens every level, tab, seat and lesson
  let all = true; try { all = localStorage.getItem(PT_ROLES_KEY) !== '0'; } catch { /* private mode */ }
  setPtAllRoles(all); if (all) buildMenus();
  let art: string | null = null; try { art = localStorage.getItem(PT_ART_KEY); } catch { /* private mode */ }
  if (art === 'code') setFloorArt('code');
  const st = el('style'); st.textContent = CSS; document.head.append(st);
  btn = el('button', '', '試玩'); btn.id = 'ptBtn'; btn.type = 'button'; btn.title = '試玩難度（淨係預覽版有）';
  panel = el('div'); panel.id = 'ptPanel'; panel.hidden = true;
  btn.onclick = (): void => { if (panel?.hidden) playtestOpen(); else if (panel) panel.hidden = true; };
  document.body.append(btn, panel);
  refreshBtn();
}
/** The entry's call: mounts the panel only when this deployment's /api/config says `playtest` (the preview Worker). */
export async function playtestBoot(): Promise<void> {
  await cloudReady;
  let on = CLOUD.cfg?.playtest === true;
  // tasting mode skips the cloud (cloud.ts): ask the Worker here; a page with no Worker (file://, the lab) never shows it
  if (!CLOUD.cfg && TASTE && /^https?:$/.test(location.protocol)){
    try { const j: unknown = await (await fetch('/api/config')).json(); on = typeof j === 'object' && j !== null && Reflect.get(j, 'playtest') === true; } catch { on = false; }
  }
  if (on) playtestMount();
}
