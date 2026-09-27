#!/usr/bin/env bash
# Homelab AI agent kit - one-time setup for an LXC container (Debian/Ubuntu).
#
#   git clone https://github.com/<you>/homelab-ai-agent-kit /opt/agent-kit
#   /opt/agent-kit/install.sh
#
# Safe to run again at any time (it only adds what is missing).
#   --quick       skip the software installs (used by `kit update`)
#   --uninstall   remove the kit's links and settings (keeps Claude Code, Codex, Node)
set -uo pipefail

KIT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
CONF_DIR="$HOME/.config/agent-kit"
QUICK=0; UNINSTALL=0
for a in "$@"; do case "$a" in --quick) QUICK=1;; --uninstall) UNINSTALL=1;; esac; done

G='\033[32m'; R='\033[31m'; Y='\033[33m'; B='\033[1m'; N='\033[0m'
step() { printf "\n${B}== %s${N}\n" "$*"; }
ok()   { printf "  ${G}[ok]${N} %s\n" "$*"; }
warn() { printf "  ${Y}[!]${N}  %s\n" "$*"; }
fail() { printf "  ${R}[FAILED]${N} %s\n" "$*"; FAILED=1; }
FAILED=0
IMPORT_LINE="@$KIT_DIR/claude/CLAUDE.md"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

# ------------------------------------------------------------- uninstall ---
if [ $UNINSTALL -eq 1 ]; then
  step "Removing the agent kit"
  for s in feature init-project; do
    [ -L "$CLAUDE_DIR/skills/$s" ] && rm "$CLAUDE_DIR/skills/$s" && ok "removed skill /$s"
  done
  for b in kit luna; do
    [ -L "/usr/local/bin/$b" ] && $SUDO rm "/usr/local/bin/$b" && ok "removed command $b"
  done
  if [ -f "$CLAUDE_DIR/CLAUDE.md" ]; then
    grep -vxF "$IMPORT_LINE" "$CLAUDE_DIR/CLAUDE.md" > "$CLAUDE_DIR/CLAUDE.md.tmp" && mv "$CLAUDE_DIR/CLAUDE.md.tmp" "$CLAUDE_DIR/CLAUDE.md"
    ok "removed kit rules from ~/.claude/CLAUDE.md"
  fi
  command -v node >/dev/null && node "$KIT_DIR/lib/merge-settings.mjs" "$KIT_DIR/claude/settings.json" "$CLAUDE_DIR/settings.json" --remove
  echo; echo "Done. Docs services (agent-kit-docs-*) were left running; remove with: systemctl disable --now agent-kit-docs-<name>"
  exit 0
fi

printf "${B}Homelab AI agent kit - installer${N}\nKit folder: %s\n" "$KIT_DIR"

# ------------------------------------------------------------ 1. basics ---
if [ $QUICK -eq 0 ]; then
  step "1/7 Basic tools (git, curl)"
  if command -v apt-get >/dev/null; then
    need=""; for p in git curl ca-certificates; do dpkg -s "$p" >/dev/null 2>&1 || need="$need $p"; done
    if [ -n "$need" ]; then
      $SUDO apt-get update -qq && $SUDO apt-get install -y -qq $need >/dev/null && ok "installed:$need" || fail "apt-get install$need"
    else ok "already installed"; fi
  else
    command -v git >/dev/null && command -v curl >/dev/null && ok "git and curl found" || fail "Please install git and curl (this installer only knows apt)."
  fi

  # ---------------------------------------------------------- 2. node ---
  step "2/7 Node.js (needed by Claude Code, Codex and the docs website)"
  major=0; command -v node >/dev/null && major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$major" -ge 20 ] 2>/dev/null; then ok "Node.js $(node -v) found"
  elif command -v apt-get >/dev/null; then
    echo "  Installing Node.js LTS from NodeSource..."
    if curl -fsSL https://deb.nodesource.com/setup_lts.x | $SUDO bash - >/tmp/agent-kit-node.log 2>&1 \
       && $SUDO apt-get install -y -qq nodejs >>/tmp/agent-kit-node.log 2>&1; then ok "Node.js $(node -v) installed"
    else fail "Node.js install failed (log: /tmp/agent-kit-node.log)"; fi
  else fail "Please install Node.js 20 or newer."; fi

  # --------------------------------------------------- 3. claude code ---
  step "3/7 Claude Code"
  export PATH="$HOME/.local/bin:$PATH"
  if command -v claude >/dev/null; then ok "Claude Code found ($(claude --version 2>/dev/null | head -n1))"
  else
    echo "  Installing Claude Code (official installer)..."
    if curl -fsSL https://claude.ai/install.sh | bash >/tmp/agent-kit-claude.log 2>&1 && command -v claude >/dev/null; then ok "Claude Code installed"
    elif command -v npm >/dev/null && $SUDO npm install -g @anthropic-ai/claude-code >>/tmp/agent-kit-claude.log 2>&1; then ok "Claude Code installed (npm)"
    else fail "Claude Code install failed (log: /tmp/agent-kit-claude.log)"; fi
  fi

  # --------------------------------------------------------- 4. codex ---
  step "4/7 Codex CLI (runs GPT-6 Luna)"
  if command -v codex >/dev/null; then ok "Codex found ($(codex --version 2>/dev/null | head -n1))"
  else
    echo "  Installing Codex CLI..."
    if command -v npm >/dev/null && $SUDO npm install -g @openai/codex >/tmp/agent-kit-codex.log 2>&1 && command -v codex >/dev/null; then ok "Codex installed (npm)"
    elif curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh >>/tmp/agent-kit-codex.log 2>&1 && command -v codex >/dev/null; then ok "Codex installed"
    else fail "Codex install failed (log: /tmp/agent-kit-codex.log)"; fi
  fi
fi

# ------------------------------------------------------- 5. commands -----
step "5/7 Commands: kit, luna"
chmod +x "$KIT_DIR/bin/"* "$KIT_DIR/install.sh" 2>/dev/null
for b in kit luna; do
  $SUDO ln -sfn "$KIT_DIR/bin/$b" "/usr/local/bin/$b" && ok "$b -> /usr/local/bin/$b" || fail "could not link $b"
done
# make ~/.local/bin (where Claude Code / Codex may live) available in every shell
if [ -w /etc/profile.d ] || [ -n "$SUDO" ]; then
  echo 'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH";; esac' | $SUDO tee /etc/profile.d/agent-kit.sh >/dev/null
fi
grep -qs 'agent-kit.sh' "$HOME/.bashrc" || echo '[ -f /etc/profile.d/agent-kit.sh ] && . /etc/profile.d/agent-kit.sh' >> "$HOME/.bashrc"
for b in claude codex; do
  if ! command -v "$b" >/dev/null 2>&1 && [ -x "$HOME/.local/bin/$b" ]; then $SUDO ln -sfn "$HOME/.local/bin/$b" "/usr/local/bin/$b"; fi
done

# ----------------------------------------------- 6. claude config -------
step "6/7 Claude Code setup: skills, rules, permissions"
mkdir -p "$CLAUDE_DIR/skills" "$CONF_DIR"
for s in feature init-project; do
  target="$CLAUDE_DIR/skills/$s"
  if [ -e "$target" ] && [ ! -L "$target" ]; then mv "$target" "$target.bak-$(date +%s)"; warn "moved your old '$s' skill aside"; fi
  ln -sfn "$KIT_DIR/claude/skills/$s" "$target" && ok "skill /$s"
done
touch "$CLAUDE_DIR/CLAUDE.md"
if grep -qxF "$IMPORT_LINE" "$CLAUDE_DIR/CLAUDE.md"; then ok "global rules already linked in ~/.claude/CLAUDE.md"
else
  { echo "$IMPORT_LINE"; echo; cat "$CLAUDE_DIR/CLAUDE.md"; } > "$CLAUDE_DIR/CLAUDE.md.tmp" && mv "$CLAUDE_DIR/CLAUDE.md.tmp" "$CLAUDE_DIR/CLAUDE.md"
  ok "global rules linked in ~/.claude/CLAUDE.md"
fi
if command -v node >/dev/null; then
  node "$KIT_DIR/lib/merge-settings.mjs" "$KIT_DIR/claude/settings.json" "$CLAUDE_DIR/settings.json" >/dev/null \
    && ok "permissions merged into ~/.claude/settings.json (backup: settings.json.bak-agent-kit)" || fail "could not merge settings"
else fail "node missing: cannot merge settings"; fi

if [ ! -f "$CONF_DIR/config" ]; then
  cat > "$CONF_DIR/config" <<'EOF'
# Homelab agent kit - settings for this container
LUNA_MODEL=gpt-6-luna
LUNA_EFFORT_BUILD=high
LUNA_EFFORT_REVIEW=high
LUNA_EFFORT_DOCS=medium
# on = Codex runs Luna in its own sandbox; off = no extra sandbox (the container is the boundary)
LUNA_SANDBOX=auto
DOCS_PORT=4321
EOF
  ok "created $CONF_DIR/config"
fi
if grep -q '^LUNA_SANDBOX=auto' "$CONF_DIR/config" && command -v codex >/dev/null; then
  if timeout 20 codex sandbox linux -- /bin/true >/dev/null 2>&1 || timeout 20 codex sandbox linux /bin/true >/dev/null 2>&1; then
    sed -i 's/^LUNA_SANDBOX=auto/LUNA_SANDBOX=on/' "$CONF_DIR/config"; ok "Codex sandbox works in this container (LUNA_SANDBOX=on)"
  else
    sed -i 's/^LUNA_SANDBOX=auto/LUNA_SANDBOX=off/' "$CONF_DIR/config"
    warn "Codex's own sandbox does not work in this container -> LUNA_SANDBOX=off (Luna still only works inside work copies)"
  fi
fi

# ----------------------------------------------------- 7. git identity ---
step "7/7 Git identity (a name on each saved version)"
if git config --global user.name >/dev/null && git config --global user.email >/dev/null; then
  ok "$(git config --global user.name) <$(git config --global user.email)>"
else
  def_name="$(hostname)"; def_mail="root@$(hostname)"
  if [ -t 0 ]; then
    read -rp "  Your name for saved versions [$def_name]: " n; read -rp "  Your email [$def_mail]: " m
  fi
  git config --global user.name "${n:-$def_name}"; git config --global user.email "${m:-$def_mail}"
  ok "set to $(git config --global user.name) <$(git config --global user.email)>"
fi
git config --global init.defaultBranch main >/dev/null 2>&1

# ------------------------------------------------------------ summary ---
echo
if [ $FAILED -eq 0 ]; then printf "${G}${B}Installation complete.${N}\n"; else printf "${R}${B}Some steps failed (see [FAILED] above). Fix them and run this script again.${N}\n"; fi
cat <<EOF

Next steps:
  1. Log in to Claude once:        claude      (follow the link, then type /exit)
  2. Go to your project:           cd /opt/<your-project>
  3. Start Claude there:           claude
  4. Prepare the project (once):   /init-project
  5. Put your OpenAI key in the project's .env (nano .env):  OPENAI_API_KEY=sk-...
  6. Then, for anything you want:  /feature <what you want, in plain words>

Check everything any time:  kit doctor        Update the kit:  kit update
(Open a new terminal, or run 'source /etc/profile.d/agent-kit.sh', so the new commands are found.)
EOF
exit $FAILED
