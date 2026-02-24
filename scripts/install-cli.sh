#!/usr/bin/env bash
set -euo pipefail

REPO="p2p-lanes/edgeos-monorepo"
BRANCH="main"
INSTALL_DIR="$HOME/.edgeos/cli"
SKILL_DIR="$HOME/.claude/commands"

echo "=== EdgeOS CLI Installer ==="
echo ""

# 1. Check/install bun
if ! command -v bun &>/dev/null; then
  echo "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  echo ""
fi

echo "Using bun: $(which bun)"

# 2. Clone or update the repo (sparse checkout — cli/ only)
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only
else
  echo "Downloading CLI..."
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  git init -q
  git remote add origin "https://github.com/$REPO.git"
  git config core.sparseCheckout true
  echo "cli/" > .git/info/sparse-checkout
  git pull --depth=1 origin "$BRANCH" -q
fi

# 3. Install dependencies and link binary
echo "Installing dependencies..."
cd "$INSTALL_DIR/cli"
bun install --frozen-lockfile 2>/dev/null || bun install
bun link

echo ""

# 4. Install Claude Code skill
echo "Installing /edgeos skill for Claude Code..."
mkdir -p "$SKILL_DIR"
cp "$INSTALL_DIR/cli/edgeos.md" "$SKILL_DIR/edgeos.md"

echo ""
echo "=== Installation complete ==="
echo ""
echo "  CLI:    $(which edgeos 2>/dev/null || echo '$HOME/.bun/bin/edgeos')"
echo "  Skill:  $SKILL_DIR/edgeos.md"
echo ""
echo "Next steps:"
echo "  1. Run: edgeos login"
echo "  2. In Claude Code, use: /edgeos <your request>"
echo ""
