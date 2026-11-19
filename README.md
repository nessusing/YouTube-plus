# yt++

A personal YouTube toolkit Chrome extension (MV3): TL;DR summaries on thumbnails, a queue that survives tabs and devices, and player tweaks. Design: [docs/design.md](docs/design.md).

## Develop

```sh
npm install      # also patches WXT (scripts/patch-wxt.mjs) and generates types
npm run dev      # dev build with reload
npm run build    # production build in .output/chrome-mv3
npm test         # unit tests (Vitest)
npm run typecheck
npm run icons    # re-rasterize the icon from docs/icon-drafts/c2*.svg
```

Load it: chrome://extensions → Developer mode → Load unpacked → `.output/chrome-mv3`.

`scripts/patch-wxt.mjs` works around a WXT bug: it builds a RegExp from the entrypoint path without escaping it, and the `++` in this directory's name breaks the build.
