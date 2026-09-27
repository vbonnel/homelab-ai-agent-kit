# AGENTS.md - rules for every AI working on this project

Read by Claude Code and by GPT-6 Luna (Codex). Keep it short and true.

## What this project is
<1-3 plain sentences.>
More background: <links to the owner's notes, e.g. 1_PROJECT_BRIEF.md, 2_MAINTENANCE.md>

## Where things are
- `<folder or file>` - <what it is>
- Code map: `<codebase.md>` <how to refresh it, e.g. `npx ai-digest`, or "none">
- Docs website source: `docs/src/content/docs/`
- Feature plans: `specs/`

## How to run the tests
Run `scripts/test.sh` from the project root. It must pass before anything is merged.
How tests stay safe: <e.g. "they use a throwaway SQLite file in .kit/, set in
scripts/test.sh" or "external APIs are mocked">.
<If there are few or no real tests yet: "Each /feature adds tests for what it builds.">

## Safety rules (never break these)
- Never connect to the real database: <where it is, e.g. "PostgreSQL in LXC 'db' (DB_HOST)">.
- Never run these (they send, upload, deliver or change live data):
  - `<script>` - <what it does>
- Never read, print or edit `.env` (secrets). Work copies get a safe `.env`
  made from `.env.workcopy`.
- Never install packages without the owner's OK. If you need one, say so.
- Don't commit, push or change branches: the architect (Claude) does that.

## How the app runs for real
<e.g. "systemd service `fablab-web` runs webapp/server.js on port 3000",
"cron runs scripts/fetch.sh every hour", or "run manually with ...">
Restart after a change: `<command>` <or "not needed">

## Applying database changes
<How the database structure is changed, e.g. "SQL files in database/migrations/,
applied with ...". Always ask the owner first and back up first: `<backup command>`.>

## Conventions
- <language and style notes, e.g. "Python 3.11, black formatting, plain
  functions, no new frameworks without asking">
