# Architecture

## Module map

| Path | What it is |
| --- | --- |
| `src/entry.ts`, `src/entry-test.ts` | Page entry points. `entry-test.ts` adds `src/test-surface.ts` (page globals for the Playwright tests). |
| `src/core/` | The shop's rules, DOM-free: state `G` (`state.ts`), one step of the shop (`referee/`), recipes and prices (`rules/`), the four stations (`stations/`), bots (`bots/`), career and seats (`career/`), workload model (`work/`), map layout (`map/`), party nights (`party/`), co-op protocol (`proto/`), co-op referee / phone / replica / plugins (`coop/`), in-memory network for sims (`bus/`). Port and effect sink: `env.ts`, `fx.ts`; seeded random stream: `rng.ts`. |
| `src/ui/` | Drawing and input for the page: station screens, menus, career, decor, levels, tutorial, cloud save and sign-in (`cloud.ts`), the floor map (`floor-map.ts`), extra seats (`seat.ts`), party screens (`party/`), tasting mode (`taste.ts`). |
| `src/net/net.ts` | The page's side of co-op: WebSocket to the room, lobby, wiring of `core/coop` (`phoneJoin` / `phoneReceive` / `phoneFrame`). |
| `src/stations-next/<kind>/` | The newer stations (runner, roast, takeaway, deliver, clear, knots review): `core.ts` (pure), `bot.ts`, `ui.ts`, `page.ts` (standalone page). Contract: `contract.ts`. |
| `src/ptt/` | Push-to-talk voice: codec, mic, floor client, UI. Self-contained. |
| `src/permit/` | Mic and motion permission requests and picture guides. |
| `src/playtest/` | Preview-only 試玩 pace panel and timing log (mounted only when `/api/config` says `playtest`). |
| `src/ver/` | Build id and the "new version" banner. |
| `src/sw/sw.ts` | Service worker (network-first cache of GETs). |
| `src/types/`, `src/model.d.ts` | Global type declarations. |
| `worker/index.ts` | The Cloudflare Worker: `/api/*` (config, Google sign-in, saves, leaderboard, stats, playtest log) and the `Room` Durable Object (seats, referee, push-to-talk floor, party night). |
| `migrations/` | D1 schema. |
| `site/` | Static files served as Worker assets: `index.html`, `party.html`, `privacy.html`, `stations/*.html`, CSS, icons. Built JS is git-ignored. |
| `scripts/` | Build, test runner, calibration and solver scripts, remote smoke tests. |
| `tests/` | `tests/sim/` Node simulations, `tests/*.test.js` Playwright suites, `tests/helpers/`. |

## Data flow

- **Solo:** the page runs the core's referee locally in fixed 1/60 s steps; `src/ui` draws `G` and turns taps into
  calls on the core. Saves go to `localStorage`, and to D1 through `/api/save` when signed in.
- **Co-op:** the room's Durable Object (`worker/index.ts` `Room`) runs the referee from `worker/room-core.js` (a fresh
  copy of `src/core` per room, bundled by the build). Every phone, the owner's too, is a player: it runs its own
  station locally, sends results in envelopes (`core/proto/messages.ts`), keeps them in an outbox until acknowledged,
  and rewrites its replica of the shared shop from the referee's ticks and keyframes (`core/coop/phone.ts`,
  `replica.ts`). The computer covers any seat without a player (`core/coop/registry.ts`, plugins in
  `core/coop/plugins/`).
- **Extra seats** run in the game page; their screen is the station's own page in an iframe (`ui/seat.ts`,
  `stations-next/seat-link.ts`).

## Build

`npm run build` (`scripts/build.mjs`) writes, all git-ignored: `site/js/app.js` (test build, with source map and the
test surface), `site/stations/<kind>.js`, `site/party.js`, `site/sw.js`, `site/version.json`, `worker/index.js` and
`worker/room-core.js`. `npm run build:prod` builds the minified page without the test surface.

## Art atlas

The floor map can draw generated pixel art. The page loads it, relative to the site root, from
`site/art/floor.json` (the manifest: parts, pages, looks) and the page images it lists, with `.png` replaced by
`.webp` (currently `site/art/floor_0.webp`). Both are included. Without them the fetch fails and the map stays in code-drawn art (it retries every 30 s); the
two `tests/map-fit.test.js` cases that need the atlas then skip.

## Run locally

Requires Node 20.11+ (scripts use `import.meta.dirname`).

```sh
npm ci
npx playwright install chromium     # for the browser tests
cp .dev.vars.example .dev.vars      # set SESSION_SECRET
npm run db:local                    # apply migrations to the local D1
npm run dev                         # build, then wrangler dev on http://localhost:8787
```

Google sign-in needs `GOOGLE_CLIENT_ID` (wrangler.jsonc vars) and your origin allowed in Google Cloud; without it the
game runs with guest saves. Standalone station pages: `/stations/runner.html`, `roast.html`, `takeaway.html`,
`deliver.html`, `clear.html`, `knots.html`; party screens: `/party.html`.

## Test

```sh
npm run check                         # typecheck (4 programs) + lint + build
npm run sim                           # Node simulations (tests/sim), no browser
npm test                              # build, sims, then every browser suite (parallel, sized from free RAM)
node scripts/run-tests.mjs --jobs 1 solo-floor map-pan   # chosen browser files, one at a time
node scripts/run-tests.mjs --webkit coop-lobby            # on WebKit instead of Chromium
```

Browser tests are headless and muted; each file starts its own `wrangler dev` with a throwaway D1 / Durable Object
store and a test Google signing key. Run `npm run build` first when calling `run-tests.mjs` directly. Outputs
(screenshots, timings) go to `tests/out/`. `tests/live.test.js` runs only with `LIVE_URL` set (a deployed Worker), and
`tests/party-room.test.js` can target a deployed preview with `PREVIEW_URL`. Browser suites take a machine-wide lock in
the OS temp dir (`CHAKEI_TEST_LOCK=off` skips it).

## Deploy with your own Cloudflare account

```sh
npx wrangler login
npx wrangler d1 create chakei               # paste the printed database_id into wrangler.jsonc
npm run db:remote                           # apply migrations/ to the remote D1
npx wrangler secret put SESSION_SECRET      # a long random string
npm run deploy                              # check, production build, wrangler deploy
```

Then, optionally: set `GOOGLE_CLIENT_ID` in `wrangler.jsonc` (an OAuth Web client from Google Cloud, with the
Worker's origin as an authorised JavaScript origin), add `routes` for a custom domain, and update the `og:url` /
`og:image` placeholders in `site/index.html`. Apply new migrations with `npm run db:remote` before deploying a Worker
that needs them. A separate preview Worker (another `name`, its own D1, `PLAYTEST: "1"` in `vars`) can be deployed
from a copy of the config with `wrangler deploy -c <file>`.
