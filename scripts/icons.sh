#!/usr/bin/env bash
# Rasterize the chosen icon (d, docs/design.md §2) into the PNG sizes Chrome wants.
# Every size scales the same drawing, which fills the full width of the square.
set -euo pipefail
cd "$(dirname "$0")/.."
out=public/icon
mkdir -p "$out"
for s in 16 32 48 128; do
  convert -background none -density 1536 docs/icon-drafts/d.svg -resize ${s}x${s} "$out/$s.png"
done
ls -l "$out"
