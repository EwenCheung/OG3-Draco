#!/bin/bash
# Regenerate every app icon size from one square source image.
# Usage:  tools/make_icons.sh [path/to/square-image.png]
# Default source: assets/brand/icon-source.png
# Uses sips, which ships with macOS — nothing to install.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-assets/brand/icon-source.png}"

[ -f "$SRC" ] || { echo "No source image at $SRC"; echo "Drop a square PNG there (512px or bigger) and run this again."; exit 1; }

for size in 192 512; do
  sips -s format png -z $size $size "$SRC" --out "assets/brand/icon-$size.png" >/dev/null
  echo "  assets/brand/icon-$size.png"
done
sips -s format png -z 180 180 "$SRC" --out assets/brand/apple-touch-icon.png >/dev/null
echo "  assets/brand/apple-touch-icon.png"
echo "Done. Icons updated — nothing else to edit."
