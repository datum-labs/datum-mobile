#!/bin/sh
# Regenerates the bitmap assets in ./assets from Datum brand sources that live
# in sibling repositories. Run from the repo root:
#
#   DATUM_ROOT=../ sh scripts/build-assets.sh
#
# Requires ImageMagick 7 (`magick`) and `cwebp`. The outputs are committed, so
# this only needs re-running when the source artwork changes.
set -eu

ROOT="${DATUM_ROOT:-..}"
HERO="$ROOT/datum.net/src/static/assets/images/hero-home-illustration.png"
SCENES="$ROOT/cloud-portal/public/images"
OUT="assets"

NAVY="#0c1d31"
MOSS="#e6f59e"

mkdir -p "$OUT/brand" "$OUT/icon/datum.icon/Assets" "$OUT/splash" "$OUT/images/scenes"

# The Datum "D" mark (path from datum.net/public/favicon.svg, 39x39 viewBox).
MARK_PATH='M14.6552 6.48499e-05C14.1027 6.48499e-05 13.6522 0.449142 13.6522 1.00306C13.6522 1.55697 13.6522 10.8035 13.6522 10.8035C13.6522 11.356 14.1013 11.7816 14.6552 11.7816L19.4145 11.8065C21.3808 11.8065 23.2536 12.5743 24.6887 13.9669C26.1323 15.3694 26.9384 17.2209 26.961 19.183C26.9837 21.1933 26.2173 23.0859 24.8049 24.5139C23.3925 25.9419 21.5083 26.7281 19.4995 26.7281H19.4145C17.4524 26.7055 15.6009 25.8994 14.1984 24.4558C12.8058 23.0222 12.0159 21.1479 12.0159 19.1816V14.3664C12.0159 13.8139 11.5889 13.4179 11.035 13.4179H1.23737C0.684872 13.4179 0.234375 13.8125 0.234375 14.3664V24.1668C0.234375 24.7193 0.683455 25.1994 1.23737 25.1994H8.9709C10.0107 25.1994 10.6808 25.184 11.2333 25.2591C11.9671 25.3582 12.4587 25.5679 12.8299 25.9376C13.201 26.3074 13.4093 26.8004 13.5085 27.5342C13.5835 28.0881 13.6522 28.7568 13.6522 29.798V37.5301C13.6522 38.0826 14.0468 38.6172 14.6007 38.6172H19.5009C21.701 38.6172 23.8614 38.1634 25.9226 37.4352C33.6051 34.7195 38.7674 27.418 38.7674 19.2666C38.7674 11.1152 33.6051 3.81371 25.9226 1.09797C23.8614 0.369812 21.701 6.48499e-05 19.5009 6.48499e-05H14.6566H14.6552Z'

cat > "$OUT/brand/datum-mark.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="39" height="39" viewBox="0 0 39 39"><path d="$MARK_PATH" fill="$MOSS"/></svg>
SVG

# Icon Composer layer: the mark on a 1024 canvas at ~52% so the glass layer
# keeps a comfortable margin inside the squircle.
cat > "$OUT/icon/datum.icon/Assets/datum-mark.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><g transform="translate(512 512) scale(13.6) translate(-19.5 -19.3)"><path d="$MARK_PATH" fill="$MOSS"/></g></svg>
SVG

# Flat 1024px icon (used where the .icon bundle can't be, e.g. expo export metadata).
magick -size 1024x1024 "xc:$NAVY" \
  \( -background none -density 1200 "$OUT/icon/datum.icon/Assets/datum-mark.svg" -resize 1024x1024 \) \
  -gravity center -composite -alpha off "$OUT/icon/icon-1024.png"

# Native splash image: the mark alone, transparent, drawn at 100pt (@3x = 300px).
magick -background none -density 2400 "$OUT/brand/datum-mark.svg" -resize 300x300 "$OUT/splash/splash-mark.png"

# Mark used by the JS splash before the wordmark animates in (@2x/@3x).
magick -background none -density 2400 "$OUT/brand/datum-mark.svg" -resize 192x192 "$OUT/brand/datum-mark@2x.png"
magick -background none -density 2400 "$OUT/brand/datum-mark.svg" -resize 288x288 "$OUT/brand/datum-mark@3x.png"
magick -background none -density 2400 "$OUT/brand/datum-mark.svg" -resize 96x96 "$OUT/brand/datum-mark.png"

# Portrait crop of the hero illustration: the two right-hand figures, the beam
# and the pink peaks, with the navy sky above for the title. Source is 3506x2430.
magick "$HERO" -crop 1300x2430+880+0 +repage -background "$NAVY" -flatten \
  -resize 1290x -strip -quality 80 -sampling-factor 4:2:0 -interlace JPEG "$OUT/images/hero-portrait@3x.jpg"
magick "$OUT/images/hero-portrait@3x.jpg" -resize 860x -strip -quality 78 "$OUT/images/hero-portrait@2x.jpg"

# Empty-state scenes: cap the width and re-encode losslessly-ish as PNG8 where
# the palette survives it; the two large scenes are downscaled.
for i in 1 2 3 4 5 6 7 8 9 10; do
  src="$SCENES/scene-$i.png"
  magick "$src" -resize '720x720>' -strip -define png:compression-level=9 "$OUT/images/scenes/scene-$i.png"
done
