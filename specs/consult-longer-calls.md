# Longer consult calls (10-minute time limit, bigger answers)

Status: planning
Size: small
Database change: no
New settings (.env keys): none (existing kit settings get new defaults)
Restart needed after merge: no

## Goal
Models that think for a long time (gemini-4-argon, OpenAI reasoning models) must
have room to finish. Raise the default time limit for a `consult` call from
2 minutes to 10 minutes, and the default answer size from 4,096 to 16,384 tokens.
Containers that still use the old defaults get the new ones on the next kit update;
values the owner changed by hand are kept.

## Not doing
- The other Gemini fixes (showing why a reply is empty, gemini-4-argon price,
  per-provider timeouts, thinking level). Separate feature if wanted.
- Changing the cost limits (CONSULT_MAX_COST_CALL_USD, CONSULT_MAX_COST_DAILY_USD).
- Streaming answers.

## Changes
- `lib/consult.mjs` (CRLF line endings: keep them)
  - `DEFAULT_CONFIG`: `CONSULT_TIMEOUT_SECS` '120' -> '600',
    `CONSULT_MAX_OUTPUT_TOKENS` '4096' -> '16384'. Same fallbacks in `runCli`
    (`|| 120` -> `|| 600`, `|| 4096` -> `|| 16384`).
  - New helper `postJson(url, headers, body, timeoutSecs)` built on `node:https`
    / `node:http` (chosen from the URL). Returns `{ ok, status, text }`.
    Reason: Node's built-in `fetch` gives up on its own after 300 s while waiting for
    the reply headers (undici `headersTimeout`), so a 600 s limit would silently be
    300 s. The helper has no hidden limit: it sets Content-Length, collects the body,
    and destroys the request after `timeoutSecs` with the error
    "No answer within <N>s (CONSULT_TIMEOUT_SECS)."
  - `callAnthropic`, `callOpenAI`, `callGemini` use `postJson` instead of `fetch`.
    Request URLs, headers and bodies stay the same; HTTP errors are still reported
    as `HTTP <status>: <redacted start of body>`.
  - Header comment: no longer says "native HTTPS fetch".
- `install.sh`
  - New-config template and `ensure_conf` defaults: 600 and 16384.
  - Existing config: like the existing model clean-up lines, replace
    `CONSULT_TIMEOUT_SECS=120` with `600` and `CONSULT_MAX_OUTPUT_TOKENS=4096` with
    `16384` only when the line is exactly the old default. Any other value is kept.
- `README.md`: settings block shows 600 and 16384, plus one short note that the
  output limit also raises the worst-case cost estimate checked against
  CONSULT_MAX_COST_CALL_USD.
- `scripts/test.sh` (new): runs `node --test tests/*.mjs` from the kit folder, so
  `kit test` and `kit merge` work for the kit itself.

## Tests to add or update
All tests use the existing local fake HTTP server; no real API calls.
- Test 3 (existing): additionally check the request bodies carry the default output
  limit 16384 (`max_tokens`, `max_completion_tokens`,
  `generationConfig.maxOutputTokens`).
- Test 5 (existing slow endpoint, `CONSULT_TIMEOUT_SECS=1`): still exits 4; also
  check the run log says "No answer within 1s (CONSULT_TIMEOUT_SECS)".
- Test 6 (existing install check): a config without the keys now gets
  `CONSULT_TIMEOUT_SECS=600` and `CONSULT_MAX_OUTPUT_TOKENS=16384` (updated default).
- New test: install.sh --quick on a config with the old defaults (120 / 4096) bumps
  them to 600 / 16384; a config with custom values (300 / 8000) keeps them.
- New test: `consult models` with no limits in the config reports `timeout=600s`.
- Manual check (scratchpad, not in the suite because it takes 6 minutes): a local
  server that answers after 360 s; old `fetch` fails at ~300 s, `postJson` with a
  600 s limit gets the answer.

## Acceptance checks
- [ ] With no limits set, consult waits up to 600 s and asks for up to 16384 output tokens.
- [ ] A reply that takes 6 minutes arrives (manual local check), instead of failing at 5 minutes.
- [ ] Timeout message names the setting: "No answer within <N>s (CONSULT_TIMEOUT_SECS)".
- [ ] Kit update bumps exactly-old-default values (120, 4096) and keeps custom ones.
- [ ] Requests to all three providers keep the same URL, headers and body shape.
- [ ] lib/consult.mjs still has CRLF line endings only.
- [ ] `scripts/test.sh` passes

## Implementation notes
- Worst-case cost estimate per call = input estimate + 16384 output tokens at the
  model's price. With the $0.50 per-call limit this still fits a full-size prompt
  (30k tokens) for gemini-4-argon at the default $3/$15 guess (~$0.34) and for
  gemini-2.5-pro (~$0.20). Very expensive models (e.g. claude-opus at $15/$75) were
  already blocked for large prompts and stay blocked.
- The owner pays for tokens actually used; the output limit is only a ceiling.
