// Is the phone held sideways? A station page shown as a seat runs in an iframe of the
// game page (seat-link.ts), and that iframe's own innerWidth / innerHeight / orientation media query describe the
// panel, not the phone: a panel in the lower half of a portrait phone (390 x ~300) reads as "landscape" and paused the
// 送外賣 run with 「打直部電話先」 while the phone was upright. So the guard reads the top page's viewport (same origin;
// visualViewport where present: what is really on screen in iPhone Chrome), and trusts screen.orientation's type when
// the browser reports one.

/** The viewport of the page the player sees: the top window's when this page is a same-origin frame. */
function topView(): { w: number; h: number } {
  let win: Window = window;
  try { if (window.top && window.top !== window && window.top.innerWidth > 0) win = window.top; } catch { /* cross-origin: our own */ }
  const vv = win.visualViewport;
  return vv && vv.width > 0 && vv.height > 0 ? { w: vv.width, h: vv.height } : { w: win.innerWidth, h: win.innerHeight };
}
/** True when the phone is in landscape (the page's viewport wider than tall, and the screen not reporting portrait). */
export function phoneLandscape(): boolean {
  const { w, h } = topView();
  if (!(w > h)) return false;
  const type = typeof screen !== 'undefined' && 'orientation' in screen ? screen.orientation.type : undefined;   // iOS before 16.4 has none
  return !type || type.startsWith('landscape');
}
