// The test build's one script (npm run build, which npm test runs first): the game exactly as src/entry.ts loads it,
// then the test surface, which puts the names the Playwright tests use back on the page (src/test-surface.ts).
import './ui/main';
import './test-surface';
import { playtestBoot } from './playtest/index';
import { staleBoot } from './ver/stale';

void playtestBoot();   // the preview's 試玩 panel, as src/entry.ts
staleBoot();   // the newer-build reload offer, as src/entry.ts
