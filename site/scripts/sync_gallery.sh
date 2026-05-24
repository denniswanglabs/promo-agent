#!/bin/bash
# Copy any new gallery MP4s from sample-run/gallery into site/public/gallery
SRC=~/Desktop/Projects/Hackathons/promo-agent/sample-run/gallery
DST=~/Desktop/Projects/Hackathons/promo-agent/site/public/gallery
mkdir -p "$DST"
for f in "$SRC"/*.mp4; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  if [ ! -f "$DST/$name" ] || [ "$f" -nt "$DST/$name" ]; then
    cp "$f" "$DST/$name"
    echo "synced: $name ($(du -h "$DST/$name" | cut -f1))"
  fi
done
