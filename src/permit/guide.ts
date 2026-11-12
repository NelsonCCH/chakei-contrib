// The permission picture guide: shown only when the browser has blocked the site for good (it will not ask again,
// and no page can make it). Two or three steps for the player's own browser, each a small code-drawn picture of the
// browser's screen with the place to tap ringed, and one line of Cantonese. The steps follow the browsers' official
// help pages (sources and dates). Menu labels are drawn as the help pages print them (English);
// the line under each picture says what to look for.
import { browserKind, type BrowserKind } from './browser';

export type PermitKind = 'mic' | 'motion';

/* ===================== art: the step pictures (SVG; units = the picture's box, 240 wide, each as tall as it needs) ===================== */
const W = 240;
const C = { ink: '#0f1a16', paper: '#fbf6e2', bar: '#e9e4cf', page: '#ffffff', mute: '#7d8a82', ring: '#c8323c', on: '#2a8b67', hi: '#ffd25a', set: '#f1f1f3' };
const n = (v: number): string => String(v);

/** One step's picture: a phone screen `h` tall with `body` drawn on it. */
const svg = (h: number, body: string, bg: string = C.page): string =>
  `<svg viewBox="0 0 ${n(W)} ${n(h)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><rect x="1" y="1" width="${n(W - 2)}" height="${n(h - 2)}" rx="10" fill="${bg}" stroke="${C.ink}" stroke-width="2"/>${body}</svg>`;
const txt = (x: number, y: number, s: string, size = 11, fill = C.ink, anchor = 'start', weight = 400): string =>
  `<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}" fill="${fill}" text-anchor="${anchor}" font-weight="${n(weight)}" font-family="system-ui,sans-serif">${s}</text>`;
/** A fingertip touching (x, y), coming from below right (or below left, for a target at the right edge). */
function drawFinger(x: number, y: number, fromLeft = false): string {
  const d = fromLeft ? `M${n(x - 2)} ${n(y + 2)} l-13 14 a5 5 0 0 0 7 7 l13 -14 z` : `M${n(x + 2)} ${n(y + 2)} l13 14 a5 5 0 0 1 -7 7 l-13 -14 z`;
  return `<path d="${d}" fill="${C.paper}" stroke="${C.ink}" stroke-width="2"/>`;
}
/** A red ring round a small target to tap, and the finger on it. */
function drawTap(x: number, y: number, r = 11, fromLeft = false): string {
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="none" stroke="${C.ring}" stroke-width="3"/>` + drawFinger(x + (fromLeft ? -r * 0.7 : r * 0.7), y + r * 0.7, fromLeft);
}
/** A red box round a wide target (a choice, a row), and the finger on its right end. */
function drawTapBox(x: number, y: number, w: number, h: number): string {
  return `<rect x="${n(x - 3)}" y="${n(y - 3)}" width="${n(w + 6)}" height="${n(h + 6)}" rx="6" fill="none" stroke="${C.ring}" stroke-width="3"/>` + drawFinger(x + w - 10, y + h - 2);
}
/** The browser's top: the address field, an icon left of it and (Chrome on Android) the three-dot menu right of it. */
function drawAddressBar(left: 'lock' | 'tune' | 'mic' | 'page' | 'none', dots: boolean): string {
  const y = 8;
  let s = `<rect x="10" y="${n(y)}" width="${n(dots ? 194 : 220)}" height="24" rx="12" fill="${C.bar}"/>` + txt(dots ? 112 : 124, y + 16, 'chakei…', 10, C.mute, 'middle');
  if (left !== 'none') s += drawBarIcon(left, 24, y + 12);
  if (dots) for (const dy of [6, 12, 18]) s += `<circle cx="222" cy="${n(y + dy)}" r="2.2" fill="${C.ink}"/>`;
  return s;
}
const BAR_Y = 20, DOTS_X = 222;
function drawBarIcon(k: 'lock' | 'tune' | 'mic' | 'page', x: number, y: number): string {
  if (k === 'lock') return `<rect x="${n(x - 5)}" y="${n(y - 2)}" width="10" height="8" rx="1" fill="${C.ink}"/><path d="M${n(x - 3)} ${n(y - 2)} v-3 a3 3 0 0 1 6 0 v3" fill="none" stroke="${C.ink}" stroke-width="2"/>`;
  if (k === 'tune') return `<path d="M${n(x - 6)} ${n(y - 3)} h12 M${n(x - 6)} ${n(y + 3)} h12" stroke="${C.ink}" stroke-width="2"/><circle cx="${n(x - 2)}" cy="${n(y - 3)}" r="2.5" fill="${C.bar}" stroke="${C.ink}" stroke-width="2"/><circle cx="${n(x + 2)}" cy="${n(y + 3)}" r="2.5" fill="${C.bar}" stroke="${C.ink}" stroke-width="2"/>`;
  if (k === 'mic') return `<rect x="${n(x - 3)}" y="${n(y - 7)}" width="6" height="10" rx="3" fill="${C.ink}"/><path d="M${n(x - 6)} ${n(y)} a6 6 0 0 0 12 0 M${n(x)} ${n(y + 6)} v3" fill="none" stroke="${C.ink}" stroke-width="2"/>`;
  // Safari's Page Menu button, drawn as a page with lines (its exact glyph changes between iOS versions)
  return `<rect x="${n(x - 5)}" y="${n(y - 7)}" width="10" height="13" rx="1.5" fill="none" stroke="${C.ink}" stroke-width="2"/><path d="M${n(x - 2)} ${n(y - 3)} h4 M${n(x - 2)} ${n(y)} h4 M${n(x - 2)} ${n(y + 3)} h4" stroke="${C.ink}" stroke-width="1.5"/>`;
}
/** A menu dropped from the bar, one row picked (yellow) and boxed. Height used: rows * 22 + 10. */
function drawMenu(rows: string[], pick: number, top = 38, x = 60, w = 170): string {
  let s = `<rect x="${n(x)}" y="${n(top)}" width="${n(w)}" height="${n(rows.length * 22 + 6)}" rx="6" fill="${C.paper}" stroke="${C.ink}" stroke-width="2"/>`;
  rows.forEach((r, i) => {
    const y = top + 3 + i * 22;
    if (i === pick) s += `<rect x="${n(x + 3)}" y="${n(y)}" width="${n(w - 6)}" height="20" rx="4" fill="${C.hi}"/>`;
    s += txt(x + 12, y + 14, r, 11, i === pick ? C.ink : C.mute, 'start', i === pick ? 700 : 400);
  });
  return s + drawTapBox(x + 3, top + 3 + pick * 22, w - 6, 20);
}
/** A settings row, its choice (or, value null, a switch) on the right as it must end up. Height used: 44. */
function drawSetting(label: string, value: string | null, top = 40): string {
  const s = `<rect x="14" y="${n(top)}" width="212" height="34" rx="6" fill="${C.paper}" stroke="${C.ink}" stroke-width="2"/>` + txt(26, top + 22, label, 12, C.ink, 'start', 700);
  if (value === null) return s + drawSwitch(186, top + 17) + drawTapBox(168, top + 7, 36, 20);
  return s + `<rect x="150" y="${n(top + 7)}" width="66" height="20" rx="4" fill="${C.hi}"/>` + txt(183, top + 21, value, 11, C.ink, 'middle', 700) + drawTapBox(150, top + 7, 66, 20);
}
function drawSwitch(cx: number, cy: number): string {
  return `<rect x="${n(cx - 17)}" y="${n(cy - 9)}" width="34" height="18" rx="9" fill="${C.on}"/><circle cx="${n(cx + 8)}" cy="${n(cy)}" r="7" fill="#fff"/>`;
}
/** The phone's Settings app: a path of rows; the last one is a switch turned on. Height used: 36 + rows * 24. */
function drawSettingsApp(path: string[]): string {
  let s = `<circle cx="24" cy="20" r="9" fill="${C.mute}"/><circle cx="24" cy="20" r="3.5" fill="${C.set}"/>` + txt(40, 24, 'Settings', 12, C.ink, 'start', 700);
  path.forEach((p, i) => {
    const y = 36 + i * 24, last = i === path.length - 1;
    s += `<rect x="14" y="${n(y)}" width="212" height="20" rx="4" fill="${last ? C.hi : '#fff'}"/>` + txt(24, y + 14, p, 11, C.ink, 'start', last ? 700 : 400);
    s += last ? drawSwitch(204, y + 10) + drawTapBox(185, y + 1, 38, 18) : txt(216, y + 14, '›', 12, C.mute, 'end');
  });
  return s;
}
/** A browser tab being closed, its ✕ ringed. Height used: 90. */
function drawCloseTab(): string {
  return `<rect x="50" y="14" width="140" height="66" rx="8" fill="${C.page}" stroke="${C.ink}" stroke-width="2"/>` + txt(62, 32, 'chakei', 11, C.ink, 'start', 700)
    + `<circle cx="176" cy="28" r="8" fill="${C.bar}"/>` + txt(176, 32, '✕', 10, C.ink, 'middle', 700) + drawTap(176, 28, 10);
}
/** The browser's own question, Allow boxed. Height used: 104. */
function drawAllowPrompt(): string {
  return `<rect x="30" y="40" width="180" height="56" rx="10" fill="${C.paper}" stroke="${C.ink}" stroke-width="2"/>` + txt(120, 58, 'chakei… would like to access motion', 9, C.ink, 'middle')
    + `<rect x="40" y="68" width="76" height="20" rx="4" fill="${C.bar}"/>` + txt(78, 82, 'Cancel', 10, C.mute, 'middle')
    + `<rect x="124" y="68" width="76" height="20" rx="4" fill="${C.hi}"/>` + txt(162, 82, 'Allow', 11, C.ink, 'middle', 700) + drawTapBox(124, 68, 76, 20);
}

/* ===================== the guides ===================== */
interface Step { pic: string; line: string }
type Guide = { title: string; steps: Step[]; after: string };

/** Chrome on Android (support.google.com/chrome/answer/114662): More, Site controls, Permissions, the permission. */
function androidChrome(perm: string, permZh: string): Step[] {
  return [
    { pic: svg(42, drawAddressBar('tune', true) + drawTap(DOTS_X, BAR_Y, 11, true)), line: '撳網址右邊嗰三粒點' },
    { pic: svg(110, drawAddressBar('tune', true) + drawMenu(['New tab', 'Site controls', 'Settings'], 1)), line: '揀「Site controls」（網站控制項），再揀「Permissions」（權限）' },
    { pic: svg(84, drawAddressBar('tune', true) + drawSetting(perm, 'Allow')), line: `「${perm}」（${permZh}）揀允許` },
  ];
}
function guideFor(kind: PermitKind, b: BrowserKind): Guide {
  if (kind === 'mic') {
    const title = '個瀏覽器封咗呢個網站用咪';
    const after = '改好之後撳「重新載入」。';
    if (b === 'android-chrome') return { title, after, steps: androidChrome('Microphone', '咪高峰') };
    // Chrome on iPhone (support.google.com/chrome/answer/2693767, iOS): the mic icon left of the address bar, Permissions
    if (b === 'ios-chrome') return { title, after, steps: [
      { pic: svg(42, drawAddressBar('mic', false) + drawTap(24, BAR_Y)), line: '撳網址左邊個咪高峰圖示' },
      { pic: svg(84, drawAddressBar('mic', false) + drawSetting('Permissions', null)), line: '打開「Permissions」個掣' },
      { pic: svg(110, drawSettingsApp(['Apps', 'Chrome', 'Microphone']), C.set), line: '冇咪圖示？去 iPhone「設定」› Apps › Chrome，打開 Microphone' },
    ] };
    // Safari (support.apple.com/guide/iphone/iphb01fc3c85): Page Menu button, Website Settings, Microphone
    if (b === 'ios-safari') return { title, after, steps: [
      { pic: svg(42, drawAddressBar('page', false) + drawTap(24, BAR_Y)), line: '撳網址欄左邊個掣（頁面選單）' },
      { pic: svg(76, drawAddressBar('page', false) + drawMenu(['Website Settings'], 0)), line: '揀「Website Settings」（網站設定）' },
      { pic: svg(84, drawAddressBar('page', false) + drawSetting('Microphone', 'Allow')), line: '「Microphone」（咪高峰）揀 Allow 或者 Ask' },
    ] };
    return { title, after, steps: [
      { pic: svg(42, drawAddressBar('lock', false) + drawTap(24, BAR_Y)), line: '撳網址左邊個圖示（鎖或者設定）' },
      { pic: svg(84, drawAddressBar('lock', false) + drawSetting('Microphone', 'Allow')), line: '咪高峰揀「允許」' },
    ] };
  }
  const title = '個瀏覽器封咗動作感應';
  if (b === 'android-chrome') return { title, after: '改好之後撳「重新載入」。', steps: androidChrome('Motion sensors', '動作感應器') };
  // iOS (Safari and Chrome are both WebKit): no official page found for undoing a motion refusal (unverified)
  if (b === 'ios-safari' || b === 'ios-chrome') return { title, after: '唔想搞？用手指玩都得。', steps: [
    { pic: svg(90, drawCloseTab(), '#e6e6ea'), line: '閂咗呢個分頁' },
    { pic: svg(104, drawAddressBar('none', false) + drawAllowPrompt()), line: '再開遊戲，佢問「動作與方向」嗰陣撳 Allow（允許）' },
  ] };
  return { title, after: '改好之後撳「重新載入」；唔想搞，用手指玩都得。', steps: [
    { pic: svg(42, drawAddressBar('lock', false) + drawTap(24, BAR_Y)), line: '撳網址左邊個圖示（鎖或者設定）' },
    { pic: svg(84, drawAddressBar('lock', false) + drawSetting('Motion sensors', 'Allow')), line: '動作感應揀「允許」' },
  ] };
}


/* ===================== the pop-up ===================== */
const CSS = `
.pguide{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(20,32,27,.55);padding:12px}
.pguide[hidden]{display:none}
.pguide>div{box-sizing:border-box;width:min(380px,100%);max-height:100%;overflow:auto;background:#fbf6e2;color:#0f1a16;border:3px solid #0f1a16;box-shadow:0 5px 0 #0f1a16;padding:14px}
.pguide h3{margin:0 0 8px;font-size:17px}
.pguide ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.pguide li{display:flex;flex-direction:column;gap:4px}
.pguide li b{font-size:14px;line-height:1.4}
.pguide li b i{font-style:normal;display:inline-block;min-width:1.5em;height:1.5em;line-height:1.5em;text-align:center;background:#0f1a16;color:#ffd25a;border-radius:50%;margin-right:6px}
.pguide svg{display:block;width:100%;height:auto}
.pguide p{margin:10px 0 0;font-size:13px}
.pguide .row{display:flex;gap:8px;margin-top:10px}
.pguide button{flex:1;font:inherit;font-weight:900;font-size:15px;padding:9px;border:2px solid #0f1a16;box-shadow:0 3px 0 #0f1a16;background:#fbf6e2;color:#0f1a16;cursor:pointer}
.pguide button.go{background:#235648;color:#fbf6e2}
`;
let pop: HTMLDivElement | null = null;

/** Shows the picture guide for `kind` on this browser (or `b`: the tests draw every browser's). */
export function showPermitGuide(kind: PermitKind, b: BrowserKind = browserKind()): void {
  if (!document.getElementById('pguideCss')) {
    const s = document.createElement('style');
    s.id = 'pguideCss'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  if (!pop) {
    pop = document.createElement('div');
    pop.className = 'pguide'; pop.id = 'permitGuide'; pop.setAttribute('role', 'dialog');
    pop.addEventListener('click', e => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || !pop) return;
      if (t.id === 'pguideReload') location.reload();
      else if (t === pop || t.id === 'pguideOk') pop.hidden = true;
    });
    document.body.append(pop);
  }
  const g = guideFor(kind, b);
  const card = document.createElement('div');
  const ol = document.createElement('ol');
  g.steps.forEach((s, i) => {
    const li = document.createElement('li');
    const b2 = document.createElement('b');
    b2.append(Object.assign(document.createElement('i'), { textContent: String(i + 1) }), s.line);
    const pic = document.createElement('div');
    pic.innerHTML = s.pic;   // our own drawing (no player text in it)
    li.append(b2, pic);
    ol.append(li);
  });
  const row = document.createElement('div');
  row.className = 'row';
  row.append(Object.assign(document.createElement('button'), { type: 'button', id: 'pguideOk', textContent: '知道' }),
    Object.assign(document.createElement('button'), { type: 'button', id: 'pguideReload', className: 'go', textContent: '重新載入' }));
  card.append(Object.assign(document.createElement('h3'), { textContent: g.title }), ol, Object.assign(document.createElement('p'), { textContent: g.after }), row);
  pop.dataset.kind = kind; pop.dataset.browser = b;
  pop.replaceChildren(card);
  pop.hidden = false;
}
export function hidePermitGuide(): void { if (pop) pop.hidden = true; }
