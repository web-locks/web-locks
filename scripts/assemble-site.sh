#!/usr/bin/env bash
# Assemble the GitHub Pages tree into ./site from already-built app output.
# Run `vp run -r build` first. Usage: scripts/assemble-site.sh
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

for d in apps/website/dist apps/react-example/dist apps/core-example/dist; do
  [ -f "$d/index.html" ] || { echo "missing build output: $d (run 'vp run -r build')" >&2; exit 1; }
done

rm -rf site
mkdir -p site/react site/vanilla
cp -R apps/website/dist/. site/
cp -R apps/react-example/dist/. site/react/
cp -R apps/core-example/dist/. site/vanilla/
: > site/.nojekyll

echo "Assembled site/:"
find site -maxdepth 2 -not -path 'site/assets/*' | sort
