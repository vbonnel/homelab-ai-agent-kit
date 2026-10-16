---
name: consult
description: Delegate a read-only specialist task (code review, bug investigation, test suggestions, or approach comparison) to an external model via Anthropic, OpenAI, or Google Gemini APIs when requested or authorized by the owner.
argument-hint: "[provider/model] <review | investigate | tests | compare | ask | scope ...>"
---

# /consult

Request from the owner: **$ARGUMENTS**

You remain the primary orchestrating agent. External models invoked through `consult` act strictly as read-only specialist assistants—they have no shell access and never edit files directly.

## Ground rules
1. **Opt-in only**: Never call `consult` unless the owner explicitly requested this delegation (pass `--authorized-once`) or enabled a session scope (`consult scope enable ...`).
2. **Scope management**:
   - If the owner asks to enable delegation for the session (e.g. "enable Gemini reviews for this session" or `/consult scope enable ...`), run:
     `consult scope enable --providers <list> --tasks <list> [--ttl 4h] [--max-calls 15]`
   - If the owner asks to turn delegation off, run:
     `consult scope disable`
3. **Provider & model choice**:
   - If the owner names a provider (`anthropic`, `openai`, `gemini`) or model (`gemini-2.5-pro`, `claude-sonnet-4-5`, `gpt-5`), pass `--provider <name>` and/or `--model <model>`.
   - If the owner does not specify one (e.g. "get a second opinion on this bug"), pass `--orchestrator claude` so `consult` automatically picks an approved external provider with a configured key.
4. **Minimal, safe context**:
   - Never pass `.env` or secret files (`consult` blocks them and scrubs secret patterns).
   - Select only the relevant files (`--file path/to/file` or `--file path/to/file:start-end`), diff (`--diff`), spec (`--spec specs/<name>.md`), or test log (`--test-log`).
5. **Graceful fallback**:
   - If `consult` exits with `CONSULT UNAVAILABLE` (missing key, timeout, API error, or rate limit), tell the owner in one plain sentence and continue your normal workflow without delegation.
6. **Evaluate & validate**:
   - Read the specialist report critically. Verify every file path, function, and claim against the real codebase and `AGENTS.md`.
   - Summarize for the owner in plain words: what the specialist suggested, what you agree or disagree with, and what action (if any) you recommend.
   - Any code changes must still happen inside a work copy and pass `kit test`.
