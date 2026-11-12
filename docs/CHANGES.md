# What this version changes

Compared with the original JavaScript game (classic scripts in `site/js/`, a Firebase backend, co-op run from the host's
phone). Game content, levels, menus, the four stations and the career loop are carried over; the list below is what is
new or different.

## Code base

- **Strict TypeScript rewrite.** Every original `site/js/*.js` file is now a module under `src/` (`strict`,
  `noUncheckedIndexedAccess`, lint with typescript-eslint strict + type-checked, no `any` / `as` / `!` / ts-ignore).
  esbuild bundles it into one classic script, `site/js/app.js`; the module load order of the original scripts is kept
  and checked at build time (`src/entry.ts`, `scripts/build.mjs`).
- **Rules split from drawing.** `src/core/` holds the shop's rules: no DOM, no timers, no `Date` / `Math.random`.
  Time comes from the shift clock, randomness from a seeded stream (`core/rng.ts`), effects go out through `core/fx.ts`
  and the save through `core/env.ts`. The same core runs in the page, in the Node simulations and inside the Worker.
- **Fixed-step clock** for the rules (`core/referee/clock.ts`), so a shift plays the same at any frame rate.

## Backend

- **Cloudflare Worker + D1 + Durable Objects** instead of Firebase: one Worker serves the static site and `/api/*`
  (Google ID-token sign-in verified server-side, HMAC session tokens, cloud saves with compare-and-set versions, daily
  leaderboard, anonymous counters). `worker/index.ts`, `migrations/`.
- **Room referee in a Durable Object.** Each co-op room is a Durable Object that runs the shift's referee itself (the
  same `src/core` code, bundled into `worker/room-core.js`). No phone is special: anyone can lock the screen or leave
  and the shift goes on; the owner only sets up the lobby and starts shifts.

## Co-op and party networking

- **Protocol** (`core/proto/`): typed envelopes, every inbound message validated; phones send results, never taps.
- **Delivery guarantees:** per-player sequence numbers, an outbox resent until acknowledged, idempotent apply on the
  referee, 4 Hz ticks and periodic **keyframes** of the shared shop (a reconnecting phone gets the last keyframe at
  once; compressed snapshots when the phone supports them). Phones predict their own station locally and replay
  unacknowledged results over each keyframe.
- **Seats and leases** with epochs: the computer covers any empty or dropped seat and hands it back; mid-shift seat
  switches; ping-based detection of silent (half-open) sockets.
- **Party mode** (`core/party/`, `ui/party/`): a night of rounds as one shop day, with a vote, ready check, shared
  till, wagers and twists, late joiners and leavers, and host hand-over. A **party director** gives every seat its own
  work along the night's curve so no seat waits on another.
- **Stale build detection** (`src/ver/`): a page from an older build offers a one-tap reload.

## Voice

- **Push-to-talk walkie-talkie** for co-op rooms (`src/ptt/`): 8 kHz G.711 mu-law frames over the room's WebSocket;
  the room owns the floor (one talker at a time, time-limited); music ducks while anyone talks; iOS audio-session
  handling; picture guides for mic and motion permissions (`src/permit/`).

## New roles and mini games

Each new station has a DOM-free core, a bot, a screen and its own standalone page (`src/stations-next/<kind>/`,
`site/stations/<kind>.html`); in the shop it runs as a referee plugin (`core/coop/plugins/<kind>.ts`).

- **樓面 (floor)**: the waiter's work becomes one role, shared by up to 2 players (樓面1 / 樓面2, each a player, the
  computer or switched off): seating, order-taking, 傳菜, 執枱, takeaway bagging and 送外賣, each a task with a stable
  id, entered by tapping its bubble on the map; the referee owns claims (`core/work/floor.ts`). Its load is budgeted as
  one person's work per switched-on slot.
- **傳菜 (runner)**: a tilt / finger-steered tray maze from the pass to the tables.
- **燒味 (roast)**: pick, chop and plate roast meats to the ticket.
- **外賣 (takeaway)**: pack the bag to the slip, then trace a generated knot to tie it (100-knot library in tiers).
- **送外賣 (deliver)**: ride the bags out on the road.
- **執枱 (clear)**: count-and-tap table clearing.
- New seats are gated along the level ladder with a common difficulty tier per role (`core/work/roles.ts`).

## Balance and level design

- **Workload model** (`core/work/load.ts`, `spec.ts`, `mix.ts`): each task's cost in a person's seconds, measured with
  the simulations' human player model; levels are specified as workload and solved so each seat is about equally busy
  (`scripts/workload-solve.mjs`). A hidden director hook can steer orders between seats.
- Star lines, revenue targets and third-star speed lines re-measured with the human model
  (`scripts/human-pace.mjs`, `xseat-calibrate.mjs`, `party-calibrate.mjs`).

## Shop map

- The waiter's floor is an isometric **map** of the hall and cut-away rooms (`core/map/layout.ts`, `ui/floor-map.ts`):
  one-finger pan, off-screen bubble markers, queue on the pavement, bubbles where the work is. It draws in code art, or
  from the generated art atlas in `site/art/` (`floor.json` manifest + `floor_0.webp`).

## Generated art

- `art/`: the shipped floor art: the atlas page (`art/atlas/`, lossless PNG, 105 parts) and every source part
  (`art/parts/`). The game ships a 99-part manifest and a WebP copy of the same page in `site/art/`.
- `pipeline/` and [ART_PIPELINE.md](ART_PIPELINE.md): how the art is made and extended: GPT Image masked edits on a
  flat magenta key stage with a style board of approved parts, key-colour cut and gates, a measured style gate, code
  shadows, and the atlas export the game reads.

## Tests and tooling

- **Node simulations** (`tests/sim/`, `npm run sim`): seeded in-memory shifts, a simulated network bus with latency,
  loss, reordering and frozen phones, co-op and party fuzzing, a human player model.
- **Playwright browser suites** (`tests/*.test.js`, `npm test`): headless and muted, each file with its own local
  `wrangler dev` (own D1 and Durable Object storage) and a test Google key; parallel by free RAM.
- **Build and deploy** scripts (`scripts/build.mjs`, `npm run check`, `npm run deploy`), a test build with a test
  surface and a minified production build without it.
- **Playtest preview tools** (only on a Worker with `PLAYTEST="1"`): a 試玩 pace panel with per-station sliders, marks,
  and a timing log to D1 (`src/playtest/`, `scripts/playtest-log.mjs`) for calibrating the human model.
- **Tasting mode** (`?taste`, developer key): a menu of preset saves that opens every mode and screen in turn without
  touching the real save, cloud or stats.
