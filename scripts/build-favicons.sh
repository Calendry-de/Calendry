#!/usr/bin/env bash
# Regenerates the raster icons from public/favicon.svg.
#
# Committing binaries without the command that made them is how an icon set
# drifts from the mark it is supposed to be: the next change to the logo
# updates the SVG, nobody can reproduce the PNGs, and the tab keeps showing the
# old one. Run this after any change to public/favicon.svg.
#
#   bash scripts/build-favicons.sh
#
# Needs rsvg-convert (librsvg) and ImageMagick.
#
# The rasters differ from the SVG in one deliberate way: they are drawn on an
# OPAQUE light tile, inset, rather than transparent. Two reasons, and both are
# format limits rather than taste —
#
#   * `prefers-color-scheme` does not exist in ICO or PNG, so a transparent
#     dark-ink mark would vanish against a dark tab strip with no way to adapt.
#     The tile supplies the light ground the mark was drawn on.
#   * iOS composites apple-touch-icon over WHITE and applies its own rounding,
#     so a transparent icon there is not an option at all.
#
# The tile is $surface0 from the app's light palette. How far the mark is inset
# into it varies by size, and deliberately: at 16px every pixel of the C's
# counter counts and the tile's own margin is the first thing worth spending,
# while a 180px app tile with the same fill would look cramped against every
# other icon on a home screen.
#
# A separate, simplified 16px drawing was tried and rejected — one with the
# middle agenda row dropped and the strokes fattened. Rendered side by side it
# was not measurably clearer than the real mark at this fill, and it would have
# made the logo two drawings that must be changed together, which is the
# duplicate-definition drift this repo has been bitten by repeatedly. The mark
# already carries its optical compensation where it belongs: in the stroke
# weights.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found" >&2; exit 1; }
command -v magick >/dev/null || { echo "ImageMagick (magick) not found" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

TILE='#F7F7FA'

# Percentage of the tile the mark occupies, by size. See the note above.
inset_for() {
    if   [ "$1" -le 32 ];  then echo 94
    elif [ "$1" -le 64 ];  then echo 88
    else                        echo 76
    fi
}

render() { # size -> tiled png
    local size=$1 out=$2
    local inner=$(( size * $(inset_for "$size") / 100 ))
    rsvg-convert -w "$inner" -h "$inner" public/favicon.svg -o "$tmp/mark-$size.png"
    magick -size "${size}x${size}" "xc:${TILE}" \
        "$tmp/mark-$size.png" -gravity center -composite \
        "$out"
}

for s in 16 32 48 64; do render "$s" "$tmp/ico-$s.png"; done
magick "$tmp/ico-16.png" "$tmp/ico-32.png" "$tmp/ico-48.png" "$tmp/ico-64.png" public/favicon.ico

# Rounded, because iOS masks it anyway and every other surface that shows a
# 180px icon presents it as an app tile.
render 180 "$tmp/touch.png"
magick "$tmp/touch.png" \
    \( -size 180x180 xc:none -draw "roundrectangle 0,0,179,179,34,34" \) \
    -alpha set -compose DstIn -composite \
    public/apple-touch-icon.png

echo "wrote public/favicon.ico public/apple-touch-icon.png"
magick identify public/favicon.ico public/apple-touch-icon.png
