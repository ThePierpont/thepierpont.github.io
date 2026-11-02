#!/bin/sh
# Publishes your edits to https://thepierpont.github.io (live about a minute later).
# Run from this folder:  sh publish.sh
set -e
cd "$(dirname "$0")"
git pull --rebase --autostash -q   # picks up the hourly Letterboxd updates first
git add -A
if git diff --cached --quiet; then
  echo "Nothing new to publish."
  exit 0
fi
git commit -q -m "Update site"
git push -q
echo "Published. Live at https://thepierpont.github.io in about a minute."
