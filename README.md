# Homelab AI agent kit

One command to build software with AI in your homelab containers:

```
/feature <what you want, in plain words>
```

- **Claude Opus** (the architect) plans the change with you, then checks the result.
- **GPT-6 Luna** (through the Codex CLI) writes the code, reviews it and updates the docs.
- Everything happens in a separate **work copy** of your project. The real
  project changes only when you say yes to the merge. Every change can be undone.
- Each project gets a **docs website** at `http://<container-IP>:4321`, updated
  after every merge.

You answer two questions per feature: **"Here's the plan. OK?"** and **"Merge?"**

---

## 1. Put the kit on GitHub (once)

1. On github.com: **New repository** -> name `homelab-ai-agent-kit` -> **Public**
   (the kit contains no secrets) -> Create.
2. Click **uploading an existing file**, drag in all the files and folders
   of this kit, then **Commit changes**.

(Private also works, but then each container needs a GitHub login to download it.)

## 2. Install in a container (once per container)

Log in to the container as root and run:

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
cd /opt/fablab-aggregator      # your project folder
claude
/init-project
```

Claude looks at the project, makes sure secrets and data can never be saved in
git, writes the project rules (`AGENTS.md`), a test script, safe settings for
work copies, and the docs website. It shows you everything before saving.

Then put your OpenAI key in the project's `.env` file:

```bash
nano /opt/fablab-aggregator/.env
# add the line:  OPENAI_API_KEY=sk-...
```

Tip: in the OpenAI dashboard, make one key per container with a monthly
spending limit. If a key leaks, you only revoke that one. If your app already
uses `OPENAI_API_KEY` for itself and you want Luna to use a different key, add
`LUNA_OPENAI_API_KEY=sk-...` instead.

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

## 5. Keep the kit up to date

Change the kit on GitHub, then in each container:

```bash
kit update
```

## Useful commands

| Command | What it does |
|---|---|
| `kit doctor` | checks that everything is installed and configured |
| `kit status` | lists work copies in progress |
| `kit docs url` | shows the docs website address |
| `kit update` | updates the kit from GitHub |

## What's in this kit

```
install.sh                  one-time setup (also: --uninstall)
bin/kit                     helper commands (work copies, save, test, merge, docs)
bin/luna                    runs GPT-6 Luna through the Codex CLI
prompts/                    what Luna is told: build.md, review.md, docs.md
claude/CLAUDE.md            global rules for Claude (linked into ~/.claude/CLAUDE.md)
claude/settings.json        what Claude may do without asking (merged into ~/.claude/settings.json)
claude/skills/feature/      the /feature command
claude/skills/init-project/ the /init-project command + project templates
templates/docs/             the standard docs website (Starlight)
lib/                        small helpers (docs web server, settings merge)
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
LUNA_EFFORT_BUILD=high       # none | low | medium | high | xhigh | max
LUNA_EFFORT_REVIEW=high
LUNA_EFFORT_DOCS=medium
LUNA_SANDBOX=on              # set by install.sh: on, or off if Codex's sandbox can't run in this container
DOCS_PORT=4321
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
