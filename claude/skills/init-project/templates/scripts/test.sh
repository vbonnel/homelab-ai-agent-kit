#!/usr/bin/env bash
# The ONE test command for this project. /feature runs it before anything is merged.
#   - exit 0 when everything is fine, non-zero otherwise
#   - must NEVER touch the real database or send anything anywhere
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"                                        # this checkout (real project or work copy)
MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"   # the real project (has venv/, node_modules/)
cd "$ROOT"; export ROOT MAIN
mkdir -p .kit

# --- Safe settings for tests (these override anything in .env) ---------------
# export DATABASE_URL="sqlite:///$ROOT/.kit/test.db"
# export DB_HOST="127.0.0.1"; export DB_NAME="app_test"
# export SMTP_HOST=""; export S3_ENDPOINT=""; export SOME_API_KEY=""

# --- Python -------------------------------------------------------------------
# PY="$MAIN/venv/bin/python"
# "$PY" -m pytest -q

# --- Node ---------------------------------------------------------------------
# Work copies have no node_modules of their own: borrow the real project's.
# for d in . client server; do
#   if [ ! -e "$ROOT/$d/node_modules" ] && [ -d "$MAIN/$d/node_modules" ]; then
#     ln -s "$MAIN/$d/node_modules" "$ROOT/$d/node_modules"
#   fi
# done
# npm test --silent
#
# Test build: build into .kit/ (thrown away), NEVER into the folder the live site serves.
# rm -rf "$ROOT/.kit/test-build"
# ( cd client && BUILD_PATH="$ROOT/.kit/test-build" npm run build > "$ROOT/.kit/test-build.log" 2>&1 ) \
#   || { tail -40 "$ROOT/.kit/test-build.log"; echo "Build FAILED (full log: .kit/test-build.log)"; exit 1; }
# rm -rf "$ROOT/.kit/test-build"

echo "No tests configured yet - edit scripts/test.sh"
