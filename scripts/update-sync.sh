#!/usr/bin/env bash
# Copy Lokki's sync package (packages/sync) into vendor/lokki-sync, pinned to one Lokki commit.
# Usage: scripts/update-sync.sh [commit-or-branch]   (default: main)
set -euo pipefail
ref="${1:-main}"
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" fetch -q --depth 1 https://github.com/joakimnordling/lokki.git "$ref"
git -C "$tmp" checkout -q FETCH_HEAD
commit="$(git -C "$tmp" rev-parse HEAD)"
rm -rf "$root/vendor/lokki-sync"
mkdir -p "$root/vendor"
cp -R "$tmp/packages/sync" "$root/vendor/lokki-sync"
cp "$tmp/LICENSE" "$root/vendor/lokki-sync/LICENSE"
printf '%s\n' "$commit" > "$root/vendor/lokki-sync/LOKKI_COMMIT"
echo "vendor/lokki-sync is now Lokki's packages/sync at $commit"
echo "Check that its dependencies (vendor/lokki-sync/package.json) match package.json."
