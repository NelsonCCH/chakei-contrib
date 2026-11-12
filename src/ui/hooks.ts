// Functions that other code replaces at run time.
// In the classic-script build every top-level function was a page global, and three kinds of code swapped some of them
// on window so that every caller ran the replacement:
// - net.ts wrapped a co-op teammate's taps (NET_ACTS) to send them to the host; a teammate now plays its
//   station here and sends results (core/coop), so nothing is wrapped for co-op any more;
// - taste.ts wraps careerArrive (forceFans);
// - the tests wrap the shop's lifecycle functions to watch them (tests/helpers/bots.browser.js, journey.browser.js,
//   press.test.js, which also counts closeBoard), re-introduce bugs through
//   them (journey-single's self-test: toPay, update, aiTill) and replace syncDown (ui-cloud.test.js).
// A module binding cannot be swapped from outside, so every call of these functions goes through this table instead
// (`HOOK.serve(g)`), and a replacement is seen by every caller exactly as before. The test surface maps the old global
// names onto these entries (src/test-surface.ts).
// The shop's own entries live in core/hooks.ts (CORE_HOOK), which the rules call; this table IS that object
// with the page's two entries added (setPause, syncDown), so a replacement made here reaches the rules too.
import { CORE_HOOK } from '../core/hooks';
import { syncDown } from './cloud';
import { setPause } from './main';

export const HOOK = Object.assign(CORE_HOOK, { setPause, syncDown });
