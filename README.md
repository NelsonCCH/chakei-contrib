# 香城茶餐廳 (chakei)

A Hong Kong cha chaan teng phone game in Cantonese: work the floor, the drinks bar, the kitchen and the till, solo or
in co-op rooms with friends, with extra roles (傳菜, 燒味, 外賣, 送外賣, 執枱), a career ladder and party nights. This is
a strict TypeScript version of the original JavaScript game, served by one Cloudflare Worker (static site + API) with
D1 for saves and a Durable Object per co-op room running the shift's referee.

## Quick start

```sh
npm ci
cp .dev.vars.example .dev.vars   # set SESSION_SECRET
npm run db:local                 # local D1
npm run dev                      # http://localhost:8787
npm run check && npm run sim     # typecheck + lint + build, then the Node simulations
```

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module map, data flow, running, testing, deploying to your own
  Cloudflare account.
- [docs/CHANGES.md](docs/CHANGES.md): what this version adds or changes compared with the original JavaScript game.
- [NOTICE.md](NOTICE.md): what belongs to the original game and what this repository adds.
- [docs/ART_PIPELINE.md](docs/ART_PIPELINE.md): the generated floor art (`art/`, `site/art/`) and the pipeline that
  makes it (`pipeline/`).
