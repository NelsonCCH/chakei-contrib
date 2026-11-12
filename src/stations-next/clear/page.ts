// Entry of the standalone 執枱 page (site/stations/clear.html, bundled by scripts/build.mjs into site/stations/clear.js)
// so the station can be played on a phone on its own, outside the shop.
// The test build also puts a small handle on window.__st for the Playwright tests; the production build does not.
import { synthSound } from '../sound';
import { CLEAR_SOUNDS, mountClear } from './ui';
import { clear } from './core';
import { seatLink } from '../seat-link';

// as a seat of the shop (?seat) the game page runs the station and this page draws it
const screen = mountClear(synthSound(CLEAR_SOUNDS), seatLink('clear', (x: unknown) => clear.validate(x)) ?? undefined);
if (STATION_TEST) {
  Reflect.set(window, '__st', { get s() { return screen.state; }, mod: clear, screen });
}
