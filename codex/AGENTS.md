# Homelab agent kit - global rules for Codex

These rules come from the homelab agent kit (/opt/agent-kit) and apply when Codex
is used as the primary coding and orchestrating agent in this container.

## Talking to the owner
- The owner is not a developer. Use plain, short language. Avoid git jargon; if a
  technical word is unavoidable, explain it in a few words.
- Words to use: "work copy" (a git worktree), "save" (a git commit),
  "the real project" (the main project folder), "merge" (put a finished
  feature into the real project).

## Safety & workflow
- Read `AGENTS.md` in the project folder first and follow its rules strictly.
- Never read, print or edit a `.env` file. To see which settings exist, run
  `kit env-keys` (names only). To add a missing key placeholder, run
  `kit env-ensure KEY_NAME` and tell the owner to fill it in with `nano .env`.
- Save with `kit save "message"` inside a work copy (it refuses secrets and huge
  files) and test with `kit test` (`scripts/test.sh`).
- Never connect to a real/live database or real outside services from a work
  copy, and never delete or weaken tests to make them pass.

## Delegating to specialist models (`consult`)
- External API calls via `consult` (Anthropic, OpenAI, Google Gemini) are **off
  by default**. Never run `consult` unless the owner explicitly asks for a
  delegation or enables a session scope.
- When the owner asks for a single consultation (e.g. "Ask Gemini to review this
  change" or "Get a second opinion from an Anthropic model on this bug"):
  - Run `consult <review|investigate|tests|compare|ask> --authorized-once --orchestrator codex [options] --question "..."`
  - Pass `--provider anthropic|openai|gemini` and/or `--model <name>` if the
    owner specified one; otherwise omit them so `consult` picks from the
    configured, approved set.
  - Supply only relevant context: `--diff`, `--spec specs/<name>.md`,
    `--file path[:start-end]`, `--test-log`.
- When the owner enables or disables delegation for a session scope:
  - Enable: `consult scope enable --providers <list> --tasks <list> [--ttl 4h] [--max-calls 15]`
  - Status: `consult scope status`
  - Disable: `consult scope disable`
  - While an active scope covers the provider and task, `--authorized-once` is
    not required.
- You remain responsible for coordinating the work:
  1. Critically evaluate the external model's report against `AGENTS.md` and the
     real codebase before acting on it.
  2. Summarize the specialist's advice and your assessment for the owner.
  3. Apply any resulting code changes carefully and validate them with `kit test`.
- If `consult` reports `CONSULT UNAVAILABLE` (missing API key, timeout, or
  provider outage), report the failure to the owner in one plain sentence and
  continue the normal workflow without delegation.
