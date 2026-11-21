# YouTube+

A personal YouTube toolkit Chrome extension (MV3): TL;DR summaries on thumbnails, an Add to queue that can go into a playlist (so it survives tabs and devices), and player tweaks. Design of what is built: [docs/design.md](docs/design.md); plans and progress: [docs/plans.md](docs/plans.md).

## Develop

```sh
npm install      # also patches WXT (scripts/patch-wxt.mjs) and generates types
npm run dev      # dev build with reload
npm run build    # production build in .output/chrome-mv3
npm test         # unit tests (Vitest)
npm run typecheck
npm run icons    # re-rasterize the icon from docs/icon-drafts/c2*.svg
```

Load it: chrome://extensions → Developer mode → Load unpacked → `.output/chrome-mv3`. Then refresh any YouTube tabs that were already open.

## Layout

- `src/core/` — settings, log, self-check framework, storage usage, page checks
- `src/features/player/` — miniplayer controls and drag, sticky player, back to top
- `src/features/queue/` — native queue or a playlist, chosen per channel: Add to queue takeover and relabel (MAIN-world script), top-bar play button and remove-after-watching (isolated controller), clear all / remove watched
- `src/features/tldr/` — Gemini web client, job queue, cache (service worker) and thumbnail icons + tooltip (content script)
- `src/entrypoints/` — background, options page, content scripts

Pure logic (`*.ts` next to a `*.test.ts`) is unit-tested; everything touching YouTube or Gemini is checked by the self-check on the settings page and by hand.

`scripts/patch-wxt.mjs` works around a WXT bug: it builds a RegExp from the entrypoint path without escaping it, and the `++` in this directory's name breaks the build.
