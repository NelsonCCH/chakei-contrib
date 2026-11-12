// The knot library's review page: site/stations/knots.html, linked from nowhere in the game. All 100 knots
// of the 外賣 station by tier, each drawn as the game fits it on a 390 x 844 phone, with its family and the metrics the
// tiers are graded on, so a reviewer can flag a knot that sits in the wrong tier (tier and pattern number identify it).
// Built by scripts/build.mjs into site/stations/knots.js.
import { KNOT_PATTERNS, KNOT_TIERS, KNOT_TUNE, knotDef, knotPts, layout, tieRect, type Pt } from '../takeaway/index';
import type { Rect } from '../takeaway/path';
import type { Difficulty } from '../contract';
import { knotMetrics } from '../takeaway/knot-metrics';
import { KNOT_FAM_NAME } from '../takeaway/knots-shapes';

const REF: Rect = tieRect(layout(130, 260), 3);
const DIFF_NAME: Readonly<Record<Difficulty, string>> = { rookie: '新人', pro: '熟手', ace: '阿姐' }, DIFFS: readonly Difficulty[] = ['rookie', 'pro', 'ace'];
const root = document.getElementById('lib');
if (!root) throw new Error('#lib missing');

function draw(cv: HTMLCanvasElement, pts: readonly Pt[], s: number) {
  const x = cv.getContext('2d'); if (!x) return;
  x.lineCap = 'round'; x.lineJoin = 'round';
  const line = (w: number, c: string) => { x.beginPath(); pts.forEach((p, i) => { if (i) x.lineTo(p[0] * s, p[1] * s); else x.moveTo(p[0] * s, p[1] * s); }); x.lineWidth = w; x.strokeStyle = c; x.stroke(); };
  line(5, '#1c2924'); line(2.5, '#e0424c');
  const a = pts[0], b = pts[pts.length - 1];
  if (a) { x.fillStyle = '#1c2924'; x.beginPath(); x.arc(a[0] * s, a[1] * s, 6, 0, 7); x.fill(); x.fillStyle = '#7be08f'; x.beginPath(); x.arc(a[0] * s, a[1] * s, 4.5, 0, 7); x.fill(); }
  if (b) { x.fillStyle = '#1c2924'; x.fillRect(b[0] * s - 4, b[1] * s - 4, 8, 8); x.fillStyle = '#ffd25a'; x.fillRect(b[0] * s - 2.5, b[1] * s - 2.5, 5, 5); }
}

const box: Rect = { x: 6, y: 6, w: REF.w, h: REF.h }, cssW = 150, s = cssW / (REF.w + 12), dpr = Math.min(2, window.devicePixelRatio || 1);
for (let t = 1; t <= KNOT_TIERS; t++) {
  const who = DIFFS.filter(d => KNOT_TUNE.base[d] === t).map(d => DIFF_NAME[d]);
  const sec = document.createElement('section'), scores: number[] = [];
  sec.innerHTML = `<h2>第 ${t} 級 <small>綁線寬 ${KNOT_TUNE.band[t - 1] ?? '?'} px · 標準速度 ${KNOT_TUNE.parSpeed[t - 1] ?? '?'} px/s${who.length ? ` · 試玩掣 5 嘅${who.join('、')}` : ''}</small></h2><div class="grid"></div>`;
  const grid = sec.querySelector('.grid');
  for (let p = 0; p < KNOT_PATTERNS; p++) {
    const k = knotDef(t, p), m = knotMetrics(knotPts(k, REF), REF); scores.push(m.score);
    const card = document.createElement('div'); card.className = 'card';
    const cv = document.createElement('canvas'); cv.width = Math.round(cssW * dpr); cv.height = Math.round((REF.h + 12) * s * dpr); cv.style.width = `${cssW}px`; cv.style.height = `${Math.round((REF.h + 12) * s)}px`;
    cv.getContext('2d')?.scale(dpr, dpr);
    draw(cv, knotPts(k, box), s);
    const info = document.createElement('div'); info.className = 'info';
    info.innerHTML = `<b>${t}-${p}</b> ${k.name} <span class="fam">${KNOT_FAM_NAME[k.fam] ?? k.fam}</span><br>長 ${Math.round(m.len)} px（×${m.lenK.toFixed(1)}）· 轉 ${m.turn.toFixed(1)} 圈<br>交叉 ${m.crossings} · 角 ${m.corners} · <b>複雜 ${m.score.toFixed(2)}</b>`;
    card.append(cv, info); grid?.append(card);
  }
  const h = sec.querySelector('small');
  const fams = new Set(Array.from({ length: KNOT_PATTERNS }, (_, p) => knotDef(t, p).fam));
  if (h) h.textContent += ` · 複雜度 ${Math.min(...scores).toFixed(2)}–${Math.max(...scores).toFixed(2)} · ${fams.size} 類`;
  root.append(sec);
}
