#!/usr/bin/env bash
# Rasterize the chosen icon (a16, docs/design.md §2) into the PNG sizes Chrome wants.
# Every size scales the same 16-grid drawing, so the toolbar icon (16/32 px) is pixel-aligned.
set -euo pipefail
cd "$(dirname "$0")/.."
out=public/icon
mkdir -p "$out"
for s in 16 32 48 128; do
  convert -background none -density 1536 docs/icon-drafts/a16.svg -resize ${s}x${s} "$out/$s.png"
done
ls -l "$out"
