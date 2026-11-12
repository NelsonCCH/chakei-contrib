// The playtest marks: the tester taps 新手 / 熟手 / 有挑戰 beside a station's slider to say "this value is this band".
// Each mark keeps enough of the shift to map it back to a level later: the station, the value, every slider, the mode,
// the level (id, number, name), the shop's difficulty, the time slot, the shift clock and the station's own knob. Kept
// on this device only (localStorage, MARKS_KEY); 匯出 turns them into plain text to paste into a report.
import { PACE_NAMES, type PaceStation } from '../core/playtest/pace';

export const MARKS_KEY = 'ckf-playtest-marks';
export type Band = 'rookie' | 'skilled' | 'challenge';
export const BAND_NAMES: Readonly<Record<Band, string>> = { rookie: '新手', skilled: '熟手', challenge: '有挑戰' };
export const BANDS: readonly Band[] = ['rookie', 'skilled', 'challenge'];

export interface Mark {
  /** ISO time the mark was made. */
  at: string;
  st: PaceStation; band: Band; v: number;
  /** free / own-shop / level / daily / tutorial / solo-seat / coop / menu (no shift running). */
  mode: string;
  /** Level id, number and name (null outside a level). */
  level: string | null; levelN: number | null; levelName: string | null;
  /** The shop's difficulty (rookie / pro / ace, or lv while a level is armed), the time slot, the player's station(s). */
  diff: string; slot: string; seat: string;
  /** solo / host / teammate. */
  role: string;
  /** Shift clock (s) when marked. */
  t: number;
  /** The station's own knob now (extra seats: their tier; null for the shop's four or a station not in the shift). */
  knob: string | null;
  /** Every slider when marked. */
  all: Record<string, number>;
}

export function loadMarks(): Mark[] {
  try {
    const x: unknown = JSON.parse(localStorage.getItem(MARKS_KEY) ?? '[]');
    return Array.isArray(x) ? x.filter((m): m is Mark => typeof m === 'object' && m !== null && 'st' in m && 'band' in m && 'v' in m) : [];
  } catch { return []; }
}
export function saveMarks(m: readonly Mark[]): boolean {
  try { localStorage.setItem(MARKS_KEY, JSON.stringify(m)); return true; } catch { return false; }
}

const pad = (n: number): string => String(n).padStart(2, '0');
function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** One readable line per mark, then the same marks as one JSON line for scripts. */
export function marksText(marks: readonly Mark[]): string {
  const head = `chakei 試玩記號 · ${String(marks.length)} 個 · 5 = 今日設定 (slider 1-10, x1.15 per step)`;
  const lines = marks.map((m, i) => {
    const lv = m.level ? `關卡 ${m.levelN !== null ? String(m.levelN) : '?'} ${m.levelName ?? ''} (${m.level})` : '冇關卡';
    const others = Object.entries(m.all).filter(([k, v]) => k !== m.st && v !== 5).map(([k, v]) => `${k}=${String(v)}`).join(' ');
    return `${String(i + 1)}. ${when(m.at)} | ${PACE_NAMES[m.st]} (${m.st}) | ${BAND_NAMES[m.band]} | 值 ${String(m.v)} | ${lv} | 難度 ${m.diff} | ${m.slot} | 模式 ${m.mode} | ${m.role} @ ${m.seat} | ${String(Math.round(m.t))}s`
      + (m.knob ? ` | knob ${m.knob}` : '') + (others ? ` | 其他 ${others}` : '');
  });
  return [head, ...lines, '', 'JSON ' + JSON.stringify(marks)].join('\n');
}
