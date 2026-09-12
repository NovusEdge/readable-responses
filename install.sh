#!/usr/bin/env bash
# readable-responses installer
# Usage: curl -fsSL https://raw.githubusercontent.com/NovusEdge/readable-responses/main/install.sh | bash
#        ./install.sh --local     # install from this checkout instead of GitHub

set -euo pipefail

REPO="NovusEdge/readable-responses"
MODE="${1:-remote}"

if ! command -v claude &> /dev/null; then
    echo "Error: the 'claude' CLI is not on PATH." >&2
    echo "Install Claude Code first: https://claude.com/claude-code" >&2
    exit 1
fi

if [ "$MODE" = "--local" ]; then
    SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
    SOURCE="$REPO"
fi

echo "Adding marketplace from $SOURCE ..."
# `add` fails when the marketplace is already registered. Grepping the list
# output instead ties the installer to a format that is not a contract.
claude plugin marketplace add "$SOURCE" --scope user 2>/dev/null \
    || claude plugin marketplace update readable-responses

echo "Installing plugin ..."
claude plugin uninstall readable-responses@readable-responses --scope user >/dev/null 2>&1 || true
claude plugin install readable-responses@readable-responses --scope user

cat <<'EOF'

Installed. Restart Claude Code.

  /plugin disable readable-responses    turn the hook off

Tune the thresholds in limits.json inside the installed plugin:

  ~/.claude/plugins/cache/readable-responses/readable-responses/*/limits.json
EOF
