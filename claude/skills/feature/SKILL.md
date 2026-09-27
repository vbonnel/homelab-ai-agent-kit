---
name: feature
description: The one command for any change to a project - new feature, fix, tweak, or "continue". Plans with the owner, has GPT-6 Luna build, test and review it in a separate work copy, updates the docs, then merges when the owner says yes. Use for ANY change to a project's code, docs or config, even small ones.
argument-hint: "<what you want, in plain words> | continue"
model: opus
---

# /feature

Request from the owner: **$ARGUMENTS**

You are the architect (Claude Opus). GPT-6 Luna (the `luna` command) builds,
reviews and writes docs. You plan, decide, check and talk to the owner. The
owner is not a developer: short plain messages, no git jargon.

## Ground rules
- The owner answers **two questions** per feature: "Here's the plan. OK?" and
  the merge prompt. Ask anything else only if you are truly blocked or a
  decision can't be undone.
- Standing instruction: all work happens in a worktree ("work copy") made by
  `kit start`, entered with the **EnterWorktree** tool and left with the
  **ExitWorktree** tool (action `keep`). Never edit files of the real project.
- Save progress with `kit save "..."` (never ask "should I commit?").
- Keep the `Status:` line of `specs/<name>.md` current and saved, so
  `/feature continue` can pick up anywhere.
- Post one short line per step so the owner can follow, e.g.
  "Plan ready", "Luna is building (round 1)...", "Tests passed", "Review passed".
- Long commands (`luna ...`, `kit test`, `kit merge`) can take many minutes:
  run them with the Bash `timeout` set to 3600000.
- Never weaken or delete tests. Never read `.env`. Never touch a real database
  or real outside services (see AGENTS.md).

## Step 0 - Where are we?
1. Run `kit status`.
2. If the request is `continue` (or empty):
   - no work copy: say there is nothing to continue and ask what they want;
   - one: use it; several: ask which one (AskUserQuestion).
   - Enter it with EnterWorktree (`path` from kit status), read
     `specs/<name>.md`, and resume at the step its `Status:` line shows.
3. New request while other work copies exist: mention them in one line
   ("'x' is still waiting - /feature continue resumes it") and carry on.
4. The project must have `AGENTS.md` and `scripts/test.sh`. If not, tell the
   owner to run `/init-project` first and stop.

## Step 1 - Work copy
1. Choose a short name: 2-4 words, lowercase, dashes (`weekly-schedule`).
2. Run `kit start <name>`.
   - Exit code 10 means the real project has unsaved changes that the work copy
     would not include. List them in plain words and ask (AskUserQuestion):
     "Save them into the project first (recommended)" -> `kit save --main
     "Save changes made before <name>"`, then `kit start <name>` again;
     or "Continue without them" -> `kit start <name> --anyway`.
3. EnterWorktree with the `path` printed after `WORKCOPY:`.

## Step 2 - Plan (you)
1. Understand the request and the code: AGENTS.md (already loaded), the code
   map it points to, and the relevant files. Use an Explore subagent for wide
   searches.
2. Size it: **small** (a fix or tweak, a few files, no database change) or
   **normal**.
3. Write `specs/<name>.md` from `${CLAUDE_SKILL_DIR}/spec-template.md`.
   Small: only the header, Goal, Changes and Acceptance checks. The spec is for
   Luna, who knows nothing else: exact files, functions, behaviour, edge cases,
   tests to add, and how tests avoid the real database (per AGENTS.md).
4. `kit save "plan: <name>"`.
5. Show the owner a plain summary (at most 10 lines): what will change, what
   they will notice, and any risk (database change, new setting in .env,
   restart needed). Do not paste the spec.
6. AskUserQuestion "Here's the plan. OK?" with options
   "Go ahead" / "Change something" / "Cancel".
   - Change: update the spec, save, ask again.
   - Cancel: ExitWorktree (keep), then `kit discard <name>`; confirm in one line.
7. Set `Status: approved`, `kit save "plan approved: <name>"`.

## Step 3 - Build, test, review (at most 3 rounds)
For round r = 1, 2, 3:
1. `Status: building (round r)`. Run `luna build <name>` (round 1) or
   `luna build <name> --notes .kit/fix-notes.md` (later rounds). Read its report.
2. `kit save "build: <name> (round r)"`.
3. `kit test`. If it FAILED: write `.kit/fix-notes.md` (the failing tests, the
   error, and your diagnosis: which file, what to change) and go to the next
   round. Skip the review.
4. `Status: reviewing (round r)`, save. Run `luna review <name>`.
   - `VERDICT: PASS`: leave the loop.
   - `VERDICT: CHANGES`: judge each issue yourself. Drop wrong ones and
     nitpicks. If none are left, leave the loop. Otherwise write the real ones
     to `.kit/fix-notes.md` (numbered: file, problem, expected fix) and go to
     the next round.

After 3 rounds, if it is still not done: fix small, clear leftovers yourself
(then `kit test` and `kit save`). If it is bigger, tell the owner plainly what
is stuck and ask: keep trying, keep it for later (`Status: paused`), or throw
it away. Never merge with failing tests.

## Step 4 - Docs
If the project has a docs website (`docs/`, or `DOCS_DIR` in `.agentkit`):
`Status: docs`, run `luna docs <name>`, check its report. Undo any change it
made outside the docs folder (`git checkout -- <file>`). `kit save "docs: <name>"`.

## Step 5 - Final check (you)
1. `kit diff --stat`, then `kit diff` and read the important parts.
2. Tick every acceptance check in the spec against the code and tests. Fix a
   small gap yourself (then `kit test`, `kit save`), or do one more Luna round.
3. If AGENTS.md says how to refresh the code map (e.g. codebase.md), do it now.
4. `Status: ready to merge`, `kit save "ready: <name>"`.

## Step 6 - Merge
1. Tell the owner, in at most 12 plain lines: what changed, how it was checked
   (tests passed, review passed), anything they must do after (database
   change, new .env setting, restart), and that it can be undone.
2. ExitWorktree with action `keep`.
3. Run `kit merge <name>`. Claude Code shows the owner a yes/no prompt: that
   IS the merge question. Don't ask it a second time.
   - Owner says no: ask (AskUserQuestion) "Keep it for later" / "Change
     something" / "Throw it away". Change -> EnterWorktree (path) and go back
     to Step 2 or 3. Throw away -> `kit discard <name>`.
   - Exit 3 (the real project changed in the same places): EnterWorktree,
     run `git merge <target branch from .kit/target-branch>`, resolve the
     conflicts keeping both intentions, `kit test`, `kit save`, ExitWorktree
     (keep), `kit merge <name>` again.
   - Exit 4 (tests fail) or 6 (docs error): EnterWorktree, fix it (one Luna
     round or yourself), save, retry.
   - Exit 7 (real project has unsaved changes): tell the owner and offer
     `kit save --main "..."`, then retry.
4. After a successful merge:
   - Database change in the spec: explain it in one or two lines, then ask
     before applying it, following "Applying database changes" in AGENTS.md.
   - New settings: tell the owner the exact key names to add with `nano .env`.
   - Restart needed and no `scripts/after-merge.sh`: tell the owner the
     restart command from AGENTS.md and offer to run it.
5. End with one short message: done, the docs link (`kit docs url`), and
   "to undo, say: undo the last feature".

## Undo (when the owner asks)
Find the merge with `git log --merges --oneline -n 5` in the real project,
confirm which one in one line, then run `git revert -m 1 <hash>` (asks
permission) and `kit docs build`.
