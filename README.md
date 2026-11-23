# YouTube+

A personal YouTube toolkit Chrome extension (MV3):

- **TL;DR** — an icon on every thumbnail; click it for key points written by Gemini (via the signed-in Gemini web app, no API key).
- **Queue** — optionally use one of your playlists as the queue: Add to queue goes into it, a top-bar button plays it, watched videos are removed. It lives in your YouTube account, so it survives tabs and devices.
- **Player** — miniplayer controls, drag and minimize; the watch-page player shrinks to a small window when you scroll; back-to-top; single-video loop; pop the player out to a desktop window (Document PiP).
- **Comment danmaku** — comments float over the video at the moment they talk about.

Each feature has its own switch. Everything uses the Google account already signed in to the browser.

## Docs

The docs are in Chinese and follow the devflow layout — start at [AGENTS.md](AGENTS.md):

- [docs/VISION.md](docs/VISION.md) — goals, non-goals, constraints
- [docs/SPEC.md](docs/SPEC.md) — features (`F-xx`) and acceptance criteria, split into [docs/specs/](docs/specs/); also maps the old `§n` section numbers still used in code comments
- [docs/TASKS.md](docs/TASKS.md) — status board
- [docs/DECISIONS.md](docs/DECISIONS.md) — decision log
- [docs/PRIVACY.md](docs/PRIVACY.md) — private data register

## Develop

```sh
npm install      # also patches WXT (scripts/patch-wxt.mjs) and generates types
npm run dev      # dev build with reload
npm run build    # production build in .output/chrome-mv3
npm test         # unit and controller tests (Vitest)
npm run typecheck
npm run e2e:login && npm run test:e2e   # end-to-end on real YouTube (Playwright, signed-in profile)
npm run icons    # re-rasterize the icon from docs/icon-drafts/d.svg
```

Load it: chrome://extensions → Developer mode → Load unpacked → `.output/chrome-mv3`. Then refresh any YouTube tabs that were already open.

## Layout

- `src/core/` — settings, log, self-check, storage usage, page notifications, language
- `src/features/tldr/` — Gemini web client, job queue, cache (service worker); thumbnail icons and tooltip (content script)
- `src/features/queue/` — native queue or a playlist: Add to queue takeover (MAIN-world script), top-bar play button, remove after watching, list tools
- `src/features/player/` — miniplayer controls, drag and minimize, small window on scroll, back to top, loop, pop-out
- `src/features/danmaku/` — comment fetching, timing, card / flying / side-panel views
- `src/entrypoints/` — background, options page, content scripts
- `tests/unit/` — Vitest; `tests/e2e/` — Playwright on real YouTube
- `scripts/danmaku/` — measurement scripts for comment danmaku

`scripts/patch-wxt.mjs` works around a WXT bug: it builds a RegExp from the entrypoint path without escaping it, and the `+` in this directory's name breaks the build.
