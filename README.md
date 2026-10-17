# Homelab AI agent kit

One command to build software using AI in your SWE projects:

```
/feature <what you want, in plain words>
```

- **Model-agnostic builders**: Use your preferred agent—**Claude Code**, **Codex**, or **Gemini CLI**—to architect, write code, run tests, and update documentation directly in an isolated work copy.
- **Specialist delegation (`consult`)**: Whenever you ask or authorize it, your
  primary agent can delegate read-only reviews, bug investigations, test suggestions, or approach comparisons to **Anthropic**, **OpenAI**, or **Google Gemini** models via direct API calls.
- Everything happens in a separate **work copy** of your project. The real
  project changes only when you say yes to the merge.
- Each project gets a **docs website** at `http://<container-IP>:4321`, updated
  after every merge.

---

## 1. Install in your container

```bash
git clone https://github.com/<your-github-name>/homelab-ai-agent-kit /opt/agent-kit
bash /opt/agent-kit/install.sh
```

It installs basic tools, connects the kit, and links helper commands (`kit`, `consult`).
Then reload your environment:

```bash
source /etc/profile.d/agent-kit.sh   # or open a new terminal
```

---

## 2. Configure API keys (per container)

When you import the kit to a new container, generate dedicated API keys with spending limits for each provider you plan to use with `consult`:

```bash
nano ~/.config/agent-kit/secrets.env
```

Add your keys (chmod 600, never committed):
```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

You can define default models and budget limits in `~/.config/agent-kit/config`:
```bash
nano ~/.config/agent-kit/config
```

---

## 3. Prepare a project (once per project)

```bash
cd /opt/your-project-folder     # your project folder
claude                         # or your builder CLI
/init-project
```

The agent inspects the project, makes sure secrets and data can never be saved in
git, writes the project rules (`AGENTS.md`), a test script (`scripts/test.sh`), safe settings for
work copies (`.env.workcopy`), and the docs website. It shows you everything before saving.

**New project from scratch?** `mkdir /opt/myapp && cd /opt/myapp && claude`,
then `/init-project a small to-do web app in Python`.

---

## 4. Every day

```
/feature add a weekly summary email of new projects
/feature the search page crashes when the title is empty
/feature continue            (picks up where you left off)
```

What happens:

| Step | Who | What |
|---|---|---|
| Plan | Builder Agent | reads the code, writes `specs/<name>.md`, asks **"OK?"** |
| Build & Test | Builder Agent | writes code + tests in work copy, loops until `scripts/test.sh` passes |
| Docs | Builder Agent | updates docs website pages in `docs/src/content/docs/` |
| Check | Builder Agent | final diff and acceptance verification against the plan |
| Merge | You | interactive yes/no prompt; yes = merges into the real project |

To undo a merged feature, just say: **"undo the last feature"**.

---

## 5. Ask a specialist model (`consult`, opt-in only)

External specialist calls **never happen by default**. You control when they run:

- **One-off request** (at any point in a session):
  - *"Ask Gemini to review this change"*
  - *"Get a second opinion from an Anthropic model on this bug"*
  - *"Ask OpenAI gpt-5 to suggest edge-case tests for `auth.py`"*
  - *"Compare two ways to cache this query using Gemini"*
  - Or directly: `/consult gemini review`
- **Enable for a session scope** (so the primary agent can consult automatically
  within your limits during the session):
  - *"Enable Gemini code reviews and bug investigations for this session"*
  - *"Disable external delegation"*

How it works:
- You can name the provider (`anthropic`, `openai`, `gemini`) and model, or let
  the primary agent pick from your configured, approved list.
- Specialist models are **read-only**: they receive only the selected files,
  diff, spec, or test log (with `.env` files blocked and secret patterns
  redacted) and return advice or proposed code via HTTPS API calls. They never get shell or write access.
- Your primary agent evaluates the specialist's response against `AGENTS.md` and
  the real code, summarizes what it agrees or disagrees with, and validates any
  accepted changes with `kit test`.

---

## 6. Keep the kit up to date

```bash
kit update
```

What `kit update` does safely in existing containers:
- Pulls the latest kit code (`git pull --ff-only`) and runs `install.sh --quick`.
- Links any new commands and skills.
- **Preserves your `~/.config/agent-kit/config`** and appends newly added default settings.
- **Preserves your credentials**: never overwrites `~/.config/agent-kit/secrets.env` or project `.env` files.

---

## Useful commands

| Command | What it does |
|---|---|
| `kit doctor` | checks that everything is installed and configured |
| `kit version` | shows installed kit version |
| `kit status` | lists work copies in progress |
| `consult models` | shows configured delegation providers, approved models, and key status |
| `consult scope status` | shows whether session delegation is active or off |
| `consult usage` | shows token and estimated cost usage for specialist calls |
| `kit docs url` | shows the docs website address |
| `kit docs update ["msg"]` | rebuilds docs website after manual edits and saves |
| `kit update` | updates the kit from GitHub (preserves config and secrets) |

---

## What's in this kit

```
install.sh                  one-time setup and safe updater (--quick, --uninstall)
bin/kit                     helper commands (work copies, save, test, merge, docs)
bin/consult                 delegates read-only tasks to Anthropic, OpenAI, or Gemini APIs
prompts/                    prompts for consult (review, investigate, tests, compare, ask)
claude/CLAUDE.md            global rules for Claude (linked into ~/.claude/CLAUDE.md)
claude/settings.json        permissions for Claude (merged into ~/.claude/settings.json)
claude/skills/feature/      the /feature command
claude/skills/consult/      the /consult command for specialist delegation
claude/skills/init-project/ the /init-project command + project templates
codex/AGENTS.md             global rules for Codex (linked into ~/.codex/AGENTS.md)
templates/docs/             the standard docs website (Starlight, Mermaid diagrams)
lib/                        helpers (consult.mjs, docs web server, settings merge)
```

## Settings (per container)

`~/.config/agent-kit/config`:

```ini
DOCS_PORT=4321

# Specialist delegation (consult) - opt-in only
CONSULT_PROVIDERS=anthropic,openai,gemini
CONSULT_DEFAULT_PROVIDER=gemini
CONSULT_MODEL_ANTHROPIC=             # e.g. claude-sonnet-4-5
CONSULT_MODEL_OPENAI=                # e.g. gpt-5
CONSULT_MODEL_GEMINI=                # e.g. gemini-2.5-pro
CONSULT_ALLOWED_MODELS=              # optional allowlist (leave empty to allow any model)
CONSULT_TIMEOUT_SECS=600             # 10 minutes: room for models that think for a long time
CONSULT_MAX_INPUT_BYTES=120000
CONSULT_MAX_OUTPUT_TOKENS=16384
CONSULT_MAX_COST_CALL_USD=0.50
CONSULT_MAX_COST_DAILY_USD=5.00
CONSULT_MAX_CALLS_SESSION=15
```

Before each call, consult checks a worst-case cost (prompt + `CONSULT_MAX_OUTPUT_TOKENS`
answer) against `CONSULT_MAX_COST_CALL_USD`, so raising the output limit can block
calls to expensive models. You only pay for the tokens actually used.

## Troubleshooting

- **`kit: command not found`**: `source /etc/profile.d/agent-kit.sh`, or run
  `bash /opt/agent-kit/install.sh` again.
- **Something looks wrong**: `kit doctor`.
- **Docs website not showing**: `kit docs build`, then `kit docs service`.
- **Remove the kit**: `bash /opt/agent-kit/install.sh --uninstall`.
