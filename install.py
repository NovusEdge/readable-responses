#!/usr/bin/env python3
"""Install readable-responses for Claude Code or Codex CLI.

    ./install.py              register the marketplace from GitHub (Claude Code)
    ./install.py --local      register it from this checkout instead
    ./install.py --codex      copy the hook under CODEX_HOME and register it
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = "NovusEdge/readable-responses"
HERE = Path(__file__).resolve().parent


def codex_home() -> Path:
    override = os.environ.get("CODEX_HOME")
    return Path(override) if override else Path.home() / ".codex"


def install_codex() -> int:
    if not shutil.which("node"):
        print("Error: 'node' is not on PATH.", file=sys.stderr)
        return 1
    source = HERE / "hooks"
    if not source.is_dir():
        print(f"Error: no hooks directory next to {__file__}.", file=sys.stderr)
        print(f"Clone the repository first: git clone https://github.com/{REPO}", file=sys.stderr)
        return 1

    home = codex_home()
    target = home / "readable-responses"
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    shutil.copytree(source, target / "hooks")
    shutil.copy2(HERE / "limits.json", target / "limits.json")

    config_path = home / "hooks.json"
    config = {}
    if config_path.exists():
        try:
            config = json.loads(config_path.read_text())
        except json.JSONDecodeError:
            # Overwriting a hand-edited config would cost the user their other hooks.
            print(f"Error: {config_path} is not valid JSON. Fix it and run this again.", file=sys.stderr)
            return 1

    hook = target / "hooks" / "inject.js"
    entry = {
        "hooks": [
            {
                "type": "command",
                "command": f'node {json.dumps(str(hook))} --codex',
                "timeout": 5,
                "statusMessage": "Checking readability",
            }
        ]
    }
    hooks = config.setdefault("hooks", {})
    others = [
        group
        for group in hooks.get("UserPromptSubmit", [])
        if "readable-responses" not in json.dumps(group)
    ]
    hooks["UserPromptSubmit"] = others + [entry]
    config_path.write_text(json.dumps(config, indent=2) + "\n")

    print(f"Installed to {target} and registered in {config_path}.")
    print()
    print("Restart Codex. Remove the UserPromptSubmit entry from that file to turn it off.")
    print("Tune the thresholds in ~/.codex/readable-responses.json.")
    return 0


def install_claude(local: bool) -> int:
    if not shutil.which("claude"):
        print("Error: the 'claude' CLI is not on PATH.", file=sys.stderr)
        print("Install Claude Code first: https://claude.com/claude-code", file=sys.stderr)
        return 1

    source = str(HERE) if local else REPO
    print(f"Adding marketplace from {source} ...")
    # `add` fails when the marketplace is already registered. Grepping the list
    # output instead ties the installer to a format that is not a contract.
    added = subprocess.run(
        ["claude", "plugin", "marketplace", "add", source, "--scope", "user"],
        capture_output=True,
    )
    if added.returncode != 0:
        subprocess.run(["claude", "plugin", "marketplace", "update", "readable-responses"], check=True)

    print("Installing plugin ...")
    plugin = "readable-responses@readable-responses"
    subprocess.run(["claude", "plugin", "uninstall", plugin, "--scope", "user"], capture_output=True)
    subprocess.run(["claude", "plugin", "install", plugin, "--scope", "user"], check=True)

    print()
    print("Installed. Restart Claude Code.")
    print()
    print("  /plugin disable readable-responses    turn the hook off")
    print()
    print("Tune the thresholds in ~/.claude/readable-responses.json, or per project")
    print("in .readable-responses.json at the repository root.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex", action="store_true", help="install for Codex CLI")
    parser.add_argument("--local", action="store_true", help="install from this checkout")
    args = parser.parse_args()
    return install_codex() if args.codex else install_claude(args.local)


if __name__ == "__main__":
    sys.exit(main())
