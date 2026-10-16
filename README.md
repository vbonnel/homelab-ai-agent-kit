# Homelab AI agent kit

One command to build software using AI in your SWE projects :

```
/feature <what you want, in plain words>
```

- **Claude Opus** (the architect) plans the change with you, then checks the result.
- **GPT-6 Luna** (through the Codex CLI) writes the code, reviews it and updates the docs.
- **Specialist delegation (`consult`)**: whenever you ask or authorize it, your
  primary agent (Claude Code or Codex) can delegate read-only reviews, bug
  investigations, test suggestions, or approach comparisons to **Anthropic**,
  **OpenAI**, or **Google Gemini** models.
- Everything happens in a separate **work copy** of your project. The real
  project changes only when you say yes to the merge.
- Each project gets a **docs website** at `http://<container-IP>:4321`, updated
  after every merge.

---

## 1. Install in your project

```bash
git clone https://github.com/<your-github-name>/homelab-ai-agent-kit /opt/agent-kit
bash /opt/agent-kit/install.sh
```

It installs Node.js, Claude Code and the Codex CLI, and connects the kit to
Claude. It is safe to run again. Then:

```bash
source /etc/profile.d/agent-kit.sh   # or open a new terminal
claude                               # log in once (follow the link), then type /exit
```

The first time Claude starts, it may ask whether to allow the kit's rules file
(`/opt/agent-kit/claude/CLAUDE.md`). Say yes.

## 3. Prepare a project (once per project)

```bash
cd /opt/your-project-folder     # your project folder
claude
/init-project
```

Claude looks at the project, makes sure secrets and data can never be saved in
git, writes the project rules (`AGENTS.md`), a test script, safe settings for
work copies, and the docs website. It shows you everything before saving.

Then put your OpenAI key in the project's `.env` file:

```bash
nano /opt/your-project-folder/.env
# add the line:  OPENAI_API_KEY=sk-...
```

Tip: in the OpenAI dashboard, create one key per container with a monthly
spending limit. If a key leaks, you only revoke the key.

**New project from scratch?** `mkdir /opt/myapp && cd /opt/myapp && claude`,
then `/init-project a small to-do web app in Python`.

## 4. Every day

```
/feature add a weekly summary email of new projects
/feature the search page crashes when the title is empty
/feature continue            (picks up where you left off)
```

What happens:

| Step | Who | What |
|---|---|---|
| Plan | Claude Opus | reads the code, writes `specs/<name>.md`, asks **"OK?"** |
| Build | GPT-6 Luna | writes the code and tests in the work copy |
| Test | script | `scripts/test.sh` must pass |
| Review | GPT-6 Luna | checks the work against the plan (read-only) |
| | | build / test / review repeats up to 3 times |
| Docs | GPT-6 Luna | updates the docs website pages |
| Check | Claude Opus | final check against the plan |
| Merge | you | Claude shows a yes/no prompt; yes = it goes into the real project |

To undo a merged feature, just say: **"undo the last feature"**.

## 5. Ask a specialist model (`consult`, opt-in only)

Whether you are working in **Claude Code** or **Codex**, external specialist
calls **never happen by default**. You control when they run:

- **One-off request** (at any point in a session):
  - *"Ask Gemini to review this change"*
  - *"Get a second opinion from an Anthropic model on this bug"*
  - *"Ask OpenAI gpt-5 to suggest edge-case tests for `auth.py`"*
  - *"Compare two ways to cache this query using Gemini"*
  - Or in Claude Code: `/consult gemini review`
- **Enable for a session scope** (so the primary agent can consult automatically
  within your limits during the session):
  - *"Enable Gemini code reviews and bug investigations for this session"*
  - *"Disable external delegation"*

How it works:
- You can name the provider (`anthropic`, `openai`, `gemini`) and model, or let
  the primary agent pick from your configured, approved list.
- Specialist models are **read-only**: they receive only the selected files,
  diff, spec, or test log (with `.env` files blocked and secret patterns
  redacted) and return advice or proposed code. They never get shell or write
  access.
- Your primary agent evaluates the specialist's response against `AGENTS.md` and
  the real code, summarizes what it agrees or disagrees with, and validates any
  accepted changes with `kit test`.
- If an external provider is unavailable or out of credit, the primary agent
  reports the error in one line and continues normally without delegation.

Where to put specialist API keys (values are never read into chat or committed):
- Per project in `.env`: `ANTHROPIC_API_KEY=...`, `OPENAI_API_KEY=...`, `GEMINI_API_KEY=...`
- Or once per container in `~/.config/agent-kit/secrets.env` (`chmod 600`;
  project `.env` keys take priority).

## 6. Keep the kit up to date (preserves local settings & keys)

Change the kit on GitHub, then in each container:

```bash
kit update
```

What `kit update` does safely in existing containers:
- Pulls the latest kit code (`git pull --ff-only`) and runs `install.sh --quick`.
- Links any new commands (`consult`) and skills (`/consult`, `~/.codex/AGENTS.md`).
- **Preserves your `~/.config/agent-kit/config`**: keeps all your existing
  `LUNA_*`, `DOCS_PORT`, and `CONSULT_*` values, and only appends newly added
  default settings if they are missing.
- **Preserves your credentials**: never overwrites `~/.config/agent-kit/secrets.env`
  or any project's `.env`.
- **Preserves your `~/.claude/settings.json`**: merges kit permission rules while
  keeping your custom rules and saving a backup (`settings.json.bak-agent-kit`).

## Useful commands

| Command | What it does |
|---|---|
| `kit doctor` | checks that everything is installed and configured |
| `kit status` | lists work copies in progress |
| `consult models` | shows configured delegation providers, approved models, and key status |
| `consult scope status` | shows whether session delegation is active or off |
| `consult usage` | shows token and estimated cost usage for specialist calls |
| `kit docs url` | shows the docs website address |
| `kit docs update ["msg"]` | after editing docs pages by hand: rebuilds the docs website and saves only the docs folder (message made from the page titles if you give none) |
| `kit update` | updates the kit from GitHub (preserves config and secrets) |

## What's in this kit

```
install.sh                  one-time setup and safe updater (--quick, --uninstall)
bin/kit                     helper commands (work copies, save, test, merge, docs)
bin/luna                    runs GPT-6 Luna through the Codex CLI
bin/consult                 delegates read-only tasks to Anthropic, OpenAI, or Gemini
prompts/                    prompts for Luna (build, review, docs) and consult (review, investigate, tests, compare, ask)
claude/CLAUDE.md            global rules for Claude (linked into ~/.claude/CLAUDE.md)
claude/settings.json        what Claude may do without asking (merged into ~/.claude/settings.json)
claude/skills/feature/      the /feature command
claude/skills/consult/      the /consult command for specialist delegation
claude/skills/init-project/ the /init-project command + project templates
codex/AGENTS.md             global rules for Codex (linked into ~/.codex/AGENTS.md)
templates/docs/             the standard docs website (Starlight, Mermaid diagrams)
lib/                        helpers (consult.mjs, docs web server, settings merge)
```

What `/init-project` adds to each project:

```
AGENTS.md          rules for every AI (tests, what never to run, where things are)
CLAUDE.md          one line that loads AGENTS.md
scripts/test.sh    the one test command
.env.workcopy      safe settings for work copies (no secrets, no real database)
specs/             one plan per feature (your history)
docs/              the docs website source
```

## Safety, in plain words

- Work copies never see your real `.env`: they get `.env.workcopy`, which has
  no secrets and points to a throwaway test database.
- Claude never reads `.env`, and `kit save` refuses to put secrets, database
  files or huge files into git.
- Claude asks before: merging, installing packages, changing a real database,
  pushing to GitHub. It never touches other containers.
- Your database and `.env` are not in git on purpose, so keep your usual
  backups of them.

## Settings (per container)

`~/.config/agent-kit/config`:

```
LUNA_MODEL=gpt-6-luna        # model used for build / review / docs
LUNA_EFFORT_BUILD=medium     # none | low | medium | high | xhigh | max
LUNA_EFFORT_REVIEW=medium
LUNA_EFFORT_DOCS=medium
LUNA_SANDBOX=on              # set by install.sh: on, or off if Codex's sandbox can't run in this container
DOCS_PORT=4321

# Specialist delegation (consult) - opt-in only
CONSULT_PROVIDERS=anthropic,openai,gemini
CONSULT_DEFAULT_PROVIDER=gemini
CONSULT_MODEL_ANTHROPIC=claude-sonnet-4-5
CONSULT_MODEL_OPENAI=gpt-5
CONSULT_MODEL_GEMINI=gemini-2.5-pro
CONSULT_ALLOWED_MODELS=claude-sonnet-4-5,claude-opus-4-5,claude-3-7-sonnet-latest,claude-3-5-haiku-latest,gpt-5,gpt-5-mini,gpt-6-luna,gpt-4.1,gpt-4.1-mini,o3,o4-mini,gemini-2.5-pro,gemini-2.5-flash
CONSULT_TIMEOUT_SECS=120
CONSULT_MAX_INPUT_BYTES=120000
CONSULT_MAX_OUTPUT_TOKENS=4096
CONSULT_MAX_COST_CALL_USD=0.50
CONSULT_MAX_COST_DAILY_USD=5.00
CONSULT_MAX_CALLS_SESSION=15
```

## Troubleshooting

- **`kit: command not found`**: `source /etc/profile.d/agent-kit.sh`, or run
  `bash /opt/agent-kit/install.sh` again.
- **Something looks wrong**: `kit doctor`.
- **Luna failed**: the full log is in the work copy, `.kit/runs/`. Most common
  causes are a missing or empty `OPENAI_API_KEY`, or no spending credit left.
- **Docs website not showing**: `kit docs build`, then `kit docs service`.
- **Remove the kit**: `bash /opt/agent-kit/install.sh --uninstall` (keeps
  Claude Code, Codex and your projects).
