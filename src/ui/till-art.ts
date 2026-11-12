// 收銀像素畫
// TypeScript port of the original game's till-art.js, as an ES module: every
// top-level name is exported.
import './bar-art';   // load order: src/entry.ts
import { G, byId, liveG } from '../core/state';
import { must } from '../core/util';
import { sumEntry } from '../core/stations/till';
import { P, INK, bx } from './kitchen';
import { makeScene, beginScene, lookOf, chipT } from './pixel';
import { wallHi } from './bar-art';

/* ===================== 收銀像素畫（高像素） ===================== */
export const TSC = makeScene('tscene');
// 企住嘅客（16×34 格）
export function personHi(x: number, y: number, col: string, lk: Look = {}): void {
  const hair = lk.hair || '#2b2b2b';
  P(x + 3, y, 10, 12, INK); P(x + 4, y + 3, 8, 8, '#f0c8a0'); P(x + 4, y + 1, 8, 3, hair); P(x + 4, y + 3, 1, 3, hair);
  if (lk.long){ P(x + 4, y + 3, 1, 8, hair); P(x + 11, y + 3, 1, 8, hair); }
  if (lk.perm){ P(x + 3, y + 2, 1, 5, hair); P(x + 12, y + 2, 1, 5, hair); }
  if (lk.hat){ P(x + 3, y, 10, 4, lk.hat); P(x + 2, y + 4, 12, 1, lk.hat); }
  P(x + 6, y + 6, 1, 2, INK); P(x + 9, y + 6, 1, 2, INK); P(x + 7, y + 9, 2, 1, '#c07060');
  bx(x + 1, y + 12, 14, 13, lk.uniform ? '#f4f1e8' : col); if (lk.uniform){ P(x + 7, y + 14, 2, 10, '#2a3f7a'); P(x + 1, y + 23, 14, 2, col); } P(x + 2, y + 13, 12, 2, 'rgba(255,255,255,.25)'); P(x + 7, y + 13, 2, 3, '#ffffff');
  bx(x - 1, y + 13, 3, 9, col); bx(x + 14, y + 13, 3, 9, col); P(x - 1, y + 21, 3, 2, '#f0c8a0'); P(x + 14, y + 21, 3, 2, '#f0c8a0');
  bx(x + 3, y + 24, 5, 10, '#2b3036'); bx(x + 8, y + 24, 5, 10, '#2b3036');
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- main.js calls every station drawer with the frame time; the till art does not animate
export function drawTill(_now: number): void {
  if (!G || G.station!=='till') return;
  const sc = TSC, S = Math.max(1.4, Math.min(3, Math.min(sc.W / 210, sc.H / 70)));
  beginScene(sc, S); const LW = sc.LW, LH = sc.LH, t = must(sc.t, 'till text context');
  wallHi(LW, LH);
  const cy = LH - 14;
  bx(-1, cy, LW + 2, LH - cy + 1, '#c9b47a', '#e8d8a0', null);
  // 收銀機
  const rx = LW - 66, ry = cy - 44;
  bx(rx, ry + 16, 60, 28, '#c8323c', '#e05a5a', '#9a2028');
  for (let r = 0; r < 2; r++) for (let k = 0; k < 6; k++) bx(rx + 5 + k * 9, ry + 22 + r * 9, 8, 7, '#f4efd9', '#ffffff');
  bx(rx + 8, ry, 44, 17, '#2b3036'); P(rx + 10, ry + 2, 40, 13, '#123b2a');
  bx(rx - 4, cy - 3, 68, 4, '#8a8f93', '#c9d1d6');
  // 客：而家嗰位企喺收銀機前面，後面排隊
  const q = [G.cur, ...G.payQ].filter((c): c is SeatGroup => Boolean(c)).slice(0, 7);
  q.forEach((c, k) => {
    const x = rx - 30 - k * 26, y = cy - 36 + (k ? 1 : 0);
    if (x < 2) return;
    const lg: { label?: string } = byId(c.id) || {};
    personHi(x, y, c.color, lookOf(lg.label));
    if (k){ const g = byId(c.id); if (g){ const f = Math.max(0, Math.min(1, (g.until - liveG().t) / g.max)); bx(x - 1, y - 7, 18, 4, '#2b3a33'); P(x, y - 6, Math.max(1, Math.round(16 * f)), 2, f < .3 ? '#ff5a5a' : '#7be08f'); } }
  });
  const v = G.cur ? (G.step==='cash' ? G.give.reduce((a, b) => a + b, 0) : sumEntry(G.entry)) : 0;
  t.font = '700 16px ui-monospace, "SFMono-Regular", monospace'; t.fillStyle = '#7bff9a'; t.textAlign = 'right'; t.textBaseline = 'middle';
  t.fillText(`$${v}`, (rx + 48) * S, (ry + 8.5) * S);
  if (G.cur) chipT(t, (rx - 22) * S, (cy - 46) * S, G.cur.octo ? '八達通' : '現金', '#e6f1ec', INK, 11);
  if (!q.length){ t.font = '700 12px "Noto Sans HK", sans-serif'; t.fillStyle = '#5b6d65'; t.textAlign = 'center'; t.fillText('冇人排隊埋單', (LW / 2 - 30) * S, (cy - 18) * S); }
}
