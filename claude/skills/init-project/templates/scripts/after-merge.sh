#!/usr/bin/env bash
# Run by `kit merge` in the real project after a feature is merged: put the change live.
# Keep only what this project needs; delete the parts that don't apply.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
mkdir -p .kit

# --- Website build (only if the live site serves a built folder) --------------
# Build into .kit/ first and swap only if the build worked: the live site is never left empty.
# LIVE_DIR="client/build"
# echo "Building the website..."
# rm -rf .kit/build-new
# ( cd client && BUILD_PATH="../.kit/build-new" npm run build > ../.kit/after-merge-build.log 2>&1 ) \
#   || { tail -30 .kit/after-merge-build.log; echo "Website build failed: the live site was NOT changed."; exit 1; }
# rm -rf .kit/build-old
# [ -d "$LIVE_DIR" ] && mv "$LIVE_DIR" .kit/build-old
# mv .kit/build-new "$LIVE_DIR"

# --- Restart ------------------------------------------------------------------
# <restart command, e.g. pm2 restart my-app > /dev/null  or  systemctl restart my-app>

# --- Check it answers ---------------------------------------------------------
# sleep 3
# curl -s -o /dev/null -w "app %{http_code}\n" http://127.0.0.1:<port>/
