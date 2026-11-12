// The page's one script: scripts/build.mjs bundles this into site/js/app.js.
// Load order. The original game loaded 31 classic scripts one after another (taste, rules, ai, waiter, ui, till,
// bar, kitchen, pixel, bar-art, till-art, icons, floor-iso, decor, sets, juice, menu, market, career, mastery, levels,
// dex, gates, tutorial, cloud, stats, smoke, outfit, net, share, main), and their top-level code (reading the save,
// fixing up SHOP, adding listeners) depends on that order. An ES module runs after the modules it imports, so each
// module's FIRST import is the module before it in that list (`import './ui/rules';` at the top of ai.ts). Importing the
// last one (main) then runs every module in exactly the old order: whenever a module is reached, all later ones are
// already waiting on the import stack and all earlier ones have run. scripts/build.mjs checks the bundle's order
// against this chain on every build.
import './ui/main';
import { playtestBoot } from './playtest/index';
import { staleBoot } from './ver/stale';

// The preview's 試玩 pace panel: mounts only when the Worker's /api/config says playtest (a Worker with PLAYTEST=1, the playtest preview).
void playtestBoot();
staleBoot();   // a newer build served offers a one-tap reload
