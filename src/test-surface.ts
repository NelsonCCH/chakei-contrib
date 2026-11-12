// The test surface (test build only: src/entry-test.ts; the production build, src/entry.ts, leaves it out).
// In the original game every top-level name of the 31 classic scripts was a page global, and the Playwright tests and their
// in-page helpers (tests/helpers/*.browser.js) read, call, assign and wrap those globals through page.evaluate:
// `G.running`, `start()`, `station = 'bar'`, `window.serve = wrapper`. The modules keep those names as exports; this file
// defines each one on globalThis again as a live accessor:
// - read: the module binding's current value (a module namespace is live), so `G` is always today's G;
// - write: a `let` another module or a test assigns goes through its owner's setter (SETTERS below); a function in the
//   HOOK table (src/hooks.ts) is replaced there, so every caller runs the replacement exactly as with the old global;
//   any other name throws, so a test that starts assigning something new fails loudly instead of silently.
import * as cUtil from './core/util';
import * as cRng from './core/rng';
import * as cFx from './core/fx';
import * as cEnv from './core/env';
import * as cMenus from './core/data/menus';
import * as cState from './core/state';
import * as cPrice from './core/rules/price';
import * as cOrder from './core/rules/order';
import * as cRecipes from './core/rules/recipes';
import * as cCustomers from './core/referee/customers';
import * as cJudge from './core/referee/judge';
import * as cScore from './core/referee/score';
import * as cFever from './core/referee/fever';
import * as cReferee from './core/referee/index';
import * as cClock from './core/referee/clock';
import * as cSpeed from './core/referee/speed';
import * as cWaiter from './core/stations/waiter';
import * as cBar from './core/stations/bar';
import * as cKitchen from './core/stations/kitchen';
import * as cTill from './core/stations/till';
import * as cBotWaiter from './core/bots/waiter';
import * as cBotBar from './core/bots/bar';
import * as cBotTill from './core/bots/till';
import * as cTargets from './core/career/targets';
import * as cPressure from './core/career/pressure';
import * as cSolo from './core/career/solo';
import * as cCoopRef from './core/coop/referee';
import * as cCoopPhone from './core/coop/phone';
import * as cCoop from './core/coop/index';
import * as cCoopResults from './core/coop/results';
import * as cXseat from './core/career/xseat';
import * as cPace from './core/playtest/pace';
import * as playtest from './playtest/index';
import * as ptLog from './playtest/log';
import * as cPlugRoast from './core/coop/plugins/roast';
import * as cPlugRunner from './core/coop/plugins/runner';
import * as cPlugTake from './core/coop/plugins/takeaway';
import * as cPlugFloor from './core/coop/plugins/floor';
import * as cPlugClear from './core/coop/plugins/clear';
import * as cPlugDeliver from './core/coop/plugins/deliver';
import * as taste from './ui/taste';
import * as prefs from './ui/prefs';
import * as waiter from './ui/waiter';
import * as ui from './ui/ui';
import * as till from './ui/till';
import * as bar from './ui/bar';
import * as kitchen from './ui/kitchen';
import * as pixel from './ui/pixel';
import * as barArt from './ui/bar-art';
import * as tillArt from './ui/till-art';
import * as icons from './ui/icons';
import * as floorIso from './ui/floor-iso';
import * as floorMap from './ui/floor-map';
import * as cWorkFloor from './core/work/floor';
import * as decor from './ui/decor';
import * as sets from './ui/sets';
import * as juice from './ui/juice';
import * as menu from './ui/menu';
import * as market from './ui/market';
import * as career from './ui/career';
import * as mastery from './ui/mastery';
import * as levels from './ui/levels';
import * as dex from './ui/dex';
import * as gates from './ui/gates';
import * as tutorial from './ui/tutorial';
import * as cloud from './ui/cloud';
import * as stats from './ui/stats';
import * as smoke from './ui/smoke';
import * as outfit from './ui/outfit';
import * as net from './net/net';
import * as share from './ui/share';
import * as wire from './ui/wire';
import * as solo from './ui/solo';
import * as pressure from './ui/pressure';
import * as target from './ui/target';
import * as main from './ui/main';
import * as xseat from './ui/xseat';
import * as seat from './ui/seat';
import * as floorJobs from './ui/floor-jobs';
import * as hooks from './ui/hooks';
import * as ptt from './ptt/index';
import * as permitGuide from './permit/guide';
import * as permitMotion from './permit/motion';
import * as permitBrowser from './permit/browser';
import * as verStale from './ver/stale';
import { HOOK } from './ui/hooks';

// Core first: where a page module exports the same name (toast, say, floatAt, sfx: core's emit the effect, the page's
// play it), the page's wins, as the tests mean the page's.
const MODULES = [cUtil, cRng, cFx, cEnv, cMenus, cState, cPrice, cOrder, cRecipes, cCustomers, cJudge, cScore, cFever, cReferee, cClock, cSpeed, cWaiter, cBar,
  cKitchen, cTill, cBotWaiter, cBotBar, cBotTill, cTargets, cPressure, cSolo, cCoopRef, cCoopPhone, cCoop, cCoopResults, cXseat, cPace, playtest, ptLog, cPlugRoast, cPlugRunner, cPlugTake, cPlugClear, cPlugDeliver, cPlugFloor, taste, prefs, waiter, ui, till, bar, kitchen, pixel, barArt, tillArt, icons, floorIso, floorMap, cWorkFloor, decor, sets, juice, menu, market,
  career, mastery, levels, dex, gates, tutorial, cloud, stats, smoke, outfit, net, share, wire, solo, pressure, target, main, xseat, seat, floorJobs, hooks, ptt, permitGuide, permitMotion, permitBrowser, verStale];

/** The assignable `let`s: those other modules assign (through these same setters) and those the tests assign. */
const SETTERS: Record<string, (v: never) => void> = {
  G: cState.setG, station: cState.setStation, slot: cState.setSlot, diff: cState.setDiff, TABLES: cState.setTABLES,
  netEvent: ui.setNetEvent, netActing: ui.setNetActing, drawn: ui.setDrawn, PX: pixel.setPX,
  TPOS: floorIso.setTPOS, isoO: floorIso.setIsoO, isoFlip: floorIso.setIsoFlip, SHOP: decor.setSHOP, decorMode: decor.setDecorMode,
  dailyArmed: career.setDailyArmed, lvTab: levels.setLvTab, last: main.setLast,
  cloudSynced: cloud.setCloudSynced, syncLast: cloud.setSyncLast, syncBusy: cloud.setSyncBusy, pushT: cloud.setPushT,
};

function expose(name: string, get: () => unknown, set: (v: unknown) => void): void {
  const own = Object.getOwnPropertyDescriptor(globalThis, name);
  if (own && !own.configurable) throw new Error(`test surface: ${name} is a fixed global of the page and cannot be exposed`);
  Object.defineProperty(globalThis, name, { configurable: true, get, set });
}
const readOnly = (name: string) => (): void => { throw new TypeError(`test surface: ${name} cannot be assigned (add a setter to src/test-surface.ts)`); };

for (const name of Object.keys(HOOK)) expose(name, (): unknown => Reflect.get(HOOK, name), v => { Reflect.set(HOOK, name, v); });
for (const ns of MODULES) for (const name of Object.keys(ns)) {
  if (name in HOOK) continue;
  const setter = SETTERS[name];
  expose(name, (): unknown => Reflect.get(ns, name), setter ? (v): void => { Reflect.apply(setter, undefined, [v]); } : readOnly(name));
}
