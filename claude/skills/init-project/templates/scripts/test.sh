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
# npm test --silent

echo "No tests configured yet - edit scripts/test.sh"
