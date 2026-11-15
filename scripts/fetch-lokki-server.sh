#!/usr/bin/env bash
# Fetches Lokki's Python sync server (servers/python) into .lokki/, at the Lokki commit the copied sync package came
# from (vendor/lokki-sync/LOKKI_COMMIT), so the sync tests run against the server that matches it.
# Usage: scripts/fetch-lokki-server.sh      (then: npm run test:sync, npm run test:e2e; both need uv)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
commit="$(cat "$root/vendor/lokki-sync/LOKKI_COMMIT")"
dir="$root/.lokki"
if [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)" = "$commit" ]; then
  echo ".lokki is already at $commit"
  exit 0
fi
rm -rf "$dir"
git init -q "$dir"
git -C "$dir" sparse-checkout set servers/python
git -C "$dir" fetch -q --depth 1 https://github.com/joakimnordling/lokki.git "$commit"
git -C "$dir" checkout -q FETCH_HEAD
echo ".lokki/servers/python is Lokki's server at $commit"
