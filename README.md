# Readable Responses

Readability guidance and the `de-slopify` editing skill. The hook flags passages worth checking; the skill helps revise prose while preserving meaning, useful detail, and the author's voice.

Works with Claude Code and Codex CLI.

## Quickstart

### Claude Code

```bash
/plugin marketplace add NovusEdge/readable-responses
/plugin install readable-responses@readable-responses
```

Restart Claude Code. Use `/readable-responses:de-slopify` to review or edit text. Turn the plugin off with `/plugin disable readable-responses`.

Or from a checkout: `./install.py --local`.

### Codex CLI, as a plugin

From the Nimble Fox team marketplace, which is private to the `nimble-fox-ai` organization:

```bash
codex plugin marketplace add nimble-fox-ai/agent-plugins
codex plugin add readable-responses@nimble-fox
```

Or straight from this repository, whose `.codex-plugin/plugin.json` is the Codex manifest:

```bash
codex plugin marketplace add NovusEdge/readable-responses
codex plugin add readable-responses@readable-responses
```

Codex does not trust a plugin's hooks on install. Review and trust the `UserPromptSubmit` hook with `/hooks` in the CLI, or Codex skips it. The skill is available at once as `$readable-responses:de-slopify`.

What carries over:

| Part | Claude Code | Codex plugin |
|---|---|---|
| `skills/de-slopify` | yes | yes, same files, no copy |
| `hooks/hooks.json` | yes | yes, the same file; Codex sets `CLAUDE_PLUGIN_ROOT` for plugin hooks |
| `hooks/inject.js` | raw stdout | raw stdout, which Codex adds as developer context |
| agents, commands | none shipped | none shipped |

The plugin and `./install.py --codex` do not combine. The plugin replaces the installer: with both, the hook runs twice and the skill appears twice. If you move to the plugin, remove the installer's `UserPromptSubmit` entry from `CODEX_HOME/hooks.json` and its `CODEX_HOME/skills/de-slopify` link. The installer stays for Codex setups that cannot use plugin marketplaces.

The plugin reads limits from `CODEX_HOME/readable-responses.json` like the installer does. Codex's newer portable `plugin.json` (with `$schema`) is not used: codex-cli 0.153.4 loaded its skills but not its hooks.

### Codex CLI, with the installer

The installer copies the hook and bundled skill under `CODEX_HOME/readable-responses` and registers the hook:

```bash
git clone https://github.com/NovusEdge/readable-responses
./readable-responses/install.py --codex
```

`CODEX_HOME` defaults to `~/.codex`. Restart Codex and use `$de-slopify` to review or edit text. Remove this plugin's `UserPromptSubmit` entry from `CODEX_HOME/hooks.json` to disable the hook; the skill remains available independently.

The installer exposes the bundled skill through `CODEX_HOME/skills/de-slopify`. An existing personal skill there or in `~/.agents/skills` is preserved, and the installer prints the bundled copy's path for comparison. Later installs update a link managed by this installer.

The installer preserves every other hook in that file. Running it twice replaces the entry rather than adding a second one.

`install.py` needs Python 3 and the standard library only. The hook itself runs on Node.

## What it does

A `UserPromptSubmit` hook reads the transcript, takes the last assistant turn, and strips code and quotes from it. It then measures six things:

| Signal | Default threshold |
|------|---------------|
| wall of text | paragraph over 70 words |
| long sentence | sentence over 35 words |
| long list item | bullet or numbered item over 70 words |
| unbroken block | more than 6 prose lines with no break |
| buried lead | first sentence opens with an intent or setup phrase |
| prose table | 3 or more consecutive `Label: value` lines outside a list |

These are review thresholds, not output limits. A progress update can trigger the opener check, and a long sentence may be necessary to retain a condition. Findings quote the passage and its measured shape:

```
READABILITY REVIEW for your previous message:
  long sentence - 68 words (over 35) - "The deployment pipeline currently builds the container image on every push..."
```

The accompanying guidance asks the agent to inspect the passage in context and change only what improves clarity. It does not require a rewrite, a shorter answer, or a response to the notice. The user's requested format takes precedence.

`prose table` catches the hand-rolled shape only, three or more labelled lines in a row. A comparison spread across flowing sentences goes unreported. That miss is deliberate, because the broader heuristic fires on ordinary prose.

## Writing guidance and de-slopify

Lead with the answer when it is known; a progress update can state the next action. Write connected prose with enough explanation for the reader. Use lists for parallel items or steps, and tables when shared fields help a comparison. Neither is required by the number of items.

When editing, preserve facts, qualifications, examples, opinions, jokes, and rhythm. Remove empty promotion, staged revelations, honesty narration, and repeated conclusions while keeping real corrections and the evidence behind them. Do not invent experiences or stronger claims to make text sound more natural.

The bundled [de-slopify skill](skills/de-slopify/SKILL.md) adds guidance for technical documentation, blogs, and portfolio pages. Ask for a review to get findings or a rewrite to change the text. It ships under this plugin's release version, with no separate version counter.

## Tuning

`limits.json` ships the defaults. Override them per project or per user:

| File | Scope |
|------|-------|
| `.readable-responses.json` in `CLAUDE_PROJECT_DIR`, or the current directory | this repository |
| `~/.claude/readable-responses.json` | every project, Claude Code |
| `CODEX_HOME/readable-responses.json` | Codex user settings |
| `limits.json` in the plugin | the shipped defaults |

The project file wins, followed by Claude user settings, Codex user settings, and the defaults. A file may set one key and inherit the rest:

```json
{ "paragraphWords": 50 }
```

`maxReported` caps how many findings one report lists.

Editing `limits.json` in an installed plugin does not survive an update, because the plugin lives in the marketplace cache. A malformed override is ignored and the defaults apply, since a config error must never block a prompt.

The injected guidance quotes the resolved numbers used by the checker. Changing a threshold changes when a passage is flagged; it does not set a mandatory length for future replies.

## How the two hosts differ

The checker is shared. Only the edges differ:

| | Claude Code | Codex CLI |
|---|---|---|
| config | plugin `hooks.json` | `~/.codex/hooks.json` |
| hook output | raw stdout | `hookSpecificOutput.additionalContext` JSON |
| transcript entry | `message.content[].text` | `payload.content[].output_text` |

`hooks/inject.js` takes `--codex` to switch the output format. The flag is explicit because the two hosts send overlapping stdin fields, so sniffing the payload would guess.

## It composes with curt

The detector checks shape. [Curt](https://github.com/NovusEdge/curt) supplies additional prose and code lint signals; Readable Responses does not duplicate its word patterns. Both tools give contextual guidance rather than treating a lint match as proof of bad writing.

Run both. When curt is installed, this plugin reuses its `lastTurn` and `prosify` exports instead of parsing the transcript itself. Curt reads the Claude Code schema only, so a Codex rollout falls through to the built-in reader.

## Why no PostToolUse tier

Curt registers `PostToolUse` to catch bad prose mid-turn, next to the tool result. That tier is wrong for a shape checker.

The message that carries the prose arrives after the last tool call. `PostToolUse` sees only the short preambles between tools, where a 70-word paragraph is rare. The tier would cost session state for deduplication and report almost nothing.

## Tests

```bash
node tests/run.js
```

No network and no agent session. The suite writes synthetic transcript JSONL in both schemas, runs the hook as a subprocess, and asserts its output.

It covers the detectors, advisory output, config precedence, the `--codex` envelope, repeated installation, bundled skill discovery, and preservation of personal skills and other hooks.

The failure cases are a missing `transcript_path`, malformed stdin, a malformed config file, and a message that is all code fences.

`HOME` points at an empty directory for most cases, which forces the built-in transcript reader. One case runs against the real `HOME` and skips when curt is absent.

## Releases

See [CHANGELOG.md](CHANGELOG.md). Tags and GitHub releases version the hook and bundled skill together.

## License

MIT. See [LICENSE](LICENSE).
