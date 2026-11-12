// Entry of the standalone 送外賣 page (site/stations/deliver.html, bundled by scripts/build.mjs into
// site/stations/deliver.js) so the station can be played on a phone on its own, outside the shop.
// The test build also puts a small handle on window.__st for the Playwright tests; the production build does not.
import { synthSound } from '../sound';
import { DELIVER_SOUNDS, mountDeliver } from './ui';
import { deliver } from './core';
import { seatLink } from '../seat-link';

// as a seat of the shop (?seat) the game page runs the station and this page draws it
const screen = mountDeliver(synthSound(DELIVER_SOUNDS), seatLink('deliver', (x: unknown) => deliver.validate(x)) ?? undefined);
if (STATION_TEST) {
  Reflect.set(window, '__st', { get s() { return screen.state; }, mod: deliver, screen });
}
