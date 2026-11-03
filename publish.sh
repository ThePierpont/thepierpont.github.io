#!/bin/sh
# Publishes your edits to https://pierpont.blog (live about a minute later).
# Run from this folder:  sh publish.sh
set -e
cd "$(dirname "$0")"
git pull --rebase --autostash -q   # picks up the hourly Letterboxd updates first
git add -A
if git diff --cached --quiet; then
  echo "Nothing new to publish."
  exit 0
fi
# New version number on the page's files, so browsers fetch the update instead of a cached copy.
sed -i '' -E "s/\?v=[0-9]+\"/?v=$(date +%s)\"/g" index.html house.html
git add index.html house.html
git commit -q -m "Update site"
git push -q
echo "Published. Live at https://pierpont.blog in about a minute."
