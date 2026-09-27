---
name: init-project
description: Prepare a project folder for the homelab AI workflow (/feature) - an existing project or a brand-new one. Sets up git safety, AGENTS.md, the test script, safe work-copy settings and the docs website. Run once per project.
argument-hint: "(new project only) what you want to build, in plain words"
model: opus
disable-model-invocation: true
---

# /init-project

Extra info from the owner: **$ARGUMENTS**

Prepare the current folder so `/feature` can work on it safely. The owner is
not a developer: short, plain messages. Templates are in
`${CLAUDE_SKILL_DIR}/templates/`.

Principles:
- **Never delete or move the owner's files.** Keep existing notes (briefs,
  maintenance notes, code maps such as codebase.md) where they are and link to
  them from AGENTS.md and the docs.
- **Never read `.env`.** Use `kit env-keys` to see setting names.
- Change nothing about how the app runs. No code restructuring. Things worth
  improving go into a "Follow-ups" list in your final message.
- One confirmation from the owner before the final save (Step 8). Ask earlier
  only when something is truly unclear (e.g. "is `database/` code or data?").

## Step 1 - Look around (read-only)
1. `pwd`, list files (including hidden), `git status` (is it a git project?
   any saved versions?), `git remote -v`.
2. Read the owner's existing notes: README, *BRIEF*, *MAINTENANCE*, codebase.md
   or other code maps, package.json, requirements*.txt / pyproject.toml,
   scripts/, `.gitignore`, `.aidigestignore`.
3. `kit env-keys` to learn which settings exist (names only).
4. Find how the app runs for real: `systemctl list-units --type=service --all
   --no-pager | grep -i <folder name or app words>`, `crontab -l`, and files
   under /etc/systemd/system that mention this folder (use grep -l).
5. Find the database: which setting names point to it (DATABASE_URL, DB_HOST,
   *.db files...). Is it a file in this folder or a server in another container?
6. Find existing tests (tests/, test_*.py, *.test.js, "test" in package.json).
7. Find scripts that send email, deliver, upload, publish, deploy or change live
   data. These become the "never run" list.

New, empty folder: skip what doesn't apply; use the owner's description for
the planned stack.

## Step 2 - Git safety first
1. No git yet: `git init -b main`.
2. Make sure `.gitignore` covers secrets, data and installed tools. Merge in
   the lines from `${CLAUDE_SKILL_DIR}/templates/gitignore-additions.txt` that are missing,
   plus project-specific ones: database files, data/, backups/, logs/, uploads,
   generated reports, venv/, node_modules/. When unsure whether a folder is
   code or data (e.g. `database/` could hold schema code or the live data),
   look inside; ask the owner only if still unclear.
3. Check nothing secret is already saved in git:
   `git ls-files | grep -Ei '(^|/)\.env$|\.(db|sqlite|sqlite3|pem|key)$|backup'`.
   If something shows up, tell the owner plainly and propose
   `git rm --cached <file>` (keeps the file on disk, only stops tracking it).
4. If `.aidigestignore` exists, add `.claude/`, `.kit/`, `docs/node_modules/`,
   `docs/dist/`, `docs/.astro/` to it if missing (keeps the code map clean).
5. `git config user.name` / `user.email` must be set (install.sh does it; if
   not, tell the owner to re-run /opt/agent-kit/install.sh).

## Step 3 - AGENTS.md (rules for every AI)
Create `AGENTS.md` from `${CLAUDE_SKILL_DIR}/templates/AGENTS.md` and fill every section
with real, verified facts from Step 1. Keep it short (under ~80 lines). If an
AGENTS.md already exists, keep its content and add the missing sections.

Then `CLAUDE.md`: if missing, copy `${CLAUDE_SKILL_DIR}/templates/CLAUDE.md`. If it exists,
add the line `@AGENTS.md` at the very top (keep everything else).

## Step 4 - The test script
Create `scripts/test.sh` from `${CLAUDE_SKILL_DIR}/templates/scripts/test.sh`
(`chmod +x`). If the project already has a `scripts/test.sh` for something
else, ask the owner before replacing it. Fill in the real commands:
- Python: use the project's venv through `$MAIN` (e.g. `"$MAIN/venv/bin/python"
  -m pytest -q`), since work copies have no venv of their own.
- Node: `npm test` or the right script; node_modules is found automatically.
- **It must never touch the real database or send anything.** Before the test
  commands, export safe values for every database/service setting found in
  Step 1 (they override .env): a throwaway SQLite file under `$ROOT/.kit/`, a
  test database name, empty API keys, etc.
- No tests yet: add a minimal smoke check that is still meaningful (e.g.
  `python -m compileall -q .` excluding venv, `node --check` on entry files,
  importing the main modules) and write in AGENTS.md that each /feature adds
  real tests for what it builds.
- If needed test tools are missing (pytest...), say so and ask before installing.
Run `kit test` once. It must pass. If you are not 100% sure it is safe to run
(could touch real data), show the owner the script and ask first.

## Step 5 - Safe settings for work copies
Create `.env.workcopy`: the same setting NAMES as `.env` (from `kit env-keys`),
with safe, non-secret values only: database settings pointing to a throwaway
test database, outside-service keys and passwords left empty, email/upload
features disabled if there is a switch. No real secret may ever go in this
file. It is saved in git (`!.env.workcopy` in .gitignore) and copied into each
work copy as its `.env`, so work copies can never reach the real data.

Then `kit env-ensure OPENAI_API_KEY` (adds an empty line to the real `.env`
only if missing; the owner fills it in).

## Step 6 - Docs website
1. `kit docs init "<Project name>"` (creates `docs/` with the standard pages;
   takes a few minutes). If `docs/` already exists for something else, write
   `DOCS_DIR=site-docs` into `.agentkit` first, and use that name.
2. Fill the five pages in `docs/src/content/docs/` from what you learned:
   `index.md` (Context: what it is, status, links to the owner's notes),
   `getting-started.md` (how to run it, settings by NAME only),
   `how-it-works.md` (tech stack, components, data flow, database tables,
   which containers are involved), `operations.md` (start/stop/restart,
   backups and restore, logs, troubleshooting - reuse the owner's
   maintenance notes), `changelog.md` (one first line: set up the AI workflow).
   Plain language, short.
3. `kit docs build`, then `kit docs service` (asks permission: it installs a
   small always-on service). Note the address it prints.

## Step 7 - Optional after-merge step
If the app runs as a service that must be restarted to pick up code changes,
ask the owner once: "Restart <service> automatically after each merge?" If
yes, create `scripts/after-merge.sh` (chmod +x) with that restart command
only. If no, write the restart command in AGENTS.md.

## Step 8 - Save
1. `git status` and show the owner a short list of what was added or changed,
   in plain words (not a diff).
2. AskUserQuestion: "Save this setup into the project?" -> "Save" / "Let me
   check first".
3. `kit save --main "Set up homelab AI workflow (agent kit)"` (the owner
   confirms the prompt). If the project had no saved version yet, this is its
   first one.

## Step 9 - Tell the owner (short)
- Done. The docs website address.
- If the OpenAI key is empty: "Put your OpenAI key in .env: `nano .env`,
  line `OPENAI_API_KEY=sk-...` (tip: one key per container, with a monthly
  spending limit)". Never ask for it in chat.
- How to start: `/feature <what you want>`.
- Follow-ups (only if any): 1-5 short bullets.
