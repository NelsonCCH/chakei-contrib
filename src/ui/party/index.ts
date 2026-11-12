// Party mode's phone screens. The co-op lobby needs only this:
//
//   import { mountParty } from './party';
//   const ui = mountParty(el, seam, myPlayerId);   // seam: { input(ev), night() }: the PartySeam, or a network adapter
//   ui.update();                                    // after each tick / broadcast
//
// Files: view.ts (pure reads of the night), draw.ts (every visual, named), style.ts (the one style sheet), screens.ts
// (one render per phase), mount.ts (mountParty), standin.ts + page.ts (the playtest page site/party.html only).
export { mountParty, layoutOf } from './mount';
export type { PartyLink, PartyMount, PartyOpts } from './mount';
