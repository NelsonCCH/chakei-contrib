// Which browser the player is in, for the permission picture guides: each browser keeps its site permissions in
// a different place. From the user agent only (no feature probes): what matters is the browser's own menus.

export type BrowserKind = 'ios-safari' | 'ios-chrome' | 'android-chrome' | 'other';

export function browserKind(ua = navigator.userAgent, touch = navigator.maxTouchPoints): BrowserKind {
  // iPadOS asks for desktop pages: a "Macintosh" with a touch screen is an iPad
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
  if (ios) {
    if (/CriOS\//.test(ua)) return 'ios-chrome';
    // the other iOS browsers (Firefox, Edge, in-app views) have their own menus: the generic guide
    if (/FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(ua)) return 'other';
    return /Safari\//.test(ua) ? 'ios-safari' : 'other';
  }
  if (/Android/.test(ua) && /Chrome\//.test(ua) && !/EdgA|OPR|SamsungBrowser|Firefox|; wv\)/.test(ua)) return 'android-chrome';
  return 'other';
}
