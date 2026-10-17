#!/usr/bin/env bash
# Test suite for the agent kit itself (used by `kit test` and `kit merge`).
# Uses only a local fake HTTP server and temp folders: no real API calls.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test tests/*.mjs
