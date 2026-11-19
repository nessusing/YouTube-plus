#!/usr/bin/env bash
# Rasterize the chosen icon (C2, docs/design.md §2) into the PNG sizes Chrome wants.
# 16 px uses the hand-tuned C2' drawing; the rest scale the full drawing.
set -euo pipefail
cd "$(dirname "$0")/.."
out=public/icon
mkdir -p "$out"
convert -background none -density 384 docs/icon-drafts/c2-16.svg -resize 16x16 "$out/16.png"
for s in 32 48 128; do
  convert -background none -density 384 docs/icon-drafts/c2.svg -resize ${s}x${s} "$out/$s.png"
done
ls -l "$out"
