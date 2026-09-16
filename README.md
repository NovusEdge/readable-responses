# Readable Responses

Makes coding agents write replies you can actually read. It checks the shape of the previous turn and names what broke.

Works with Claude Code and Codex CLI.

## Quickstart

### Claude Code

```bash
/plugin marketplace add NovusEdge/readable-responses
/plugin install readable-responses@readable-responses
```

Restart Claude Code. Turn it off with `/plugin disable readable-responses`.

Or from a checkout: `./install.py --local`.

### Codex CLI

Codex has no plugin marketplace, so the installer copies the hook under `~/.codex` and registers it:

```bash
git clone https://github.com/NovusEdge/readable-responses
./readable-responses/install.py --codex
```

Restart Codex. Turn it off by removing the `UserPromptSubmit` entry from `~/.codex/hooks.json`.

The installer preserves every other hook in that file. Running it twice replaces the entry rather than adding a second one.

`install.py` needs Python 3 and the standard library only. The hook itself runs on Node.

## What it does

A `UserPromptSubmit` hook reads the transcript, takes the last assistant turn, and strips code and quotes from it. It then measures six things:

| Rule | Default limit |
|------|---------------|
| wall of text | paragraph over 70 words |
| long sentence | sentence over 35 words |
| long list item | bullet or numbered item over 70 words |
| unbroken block | 6 prose lines with no break |
| buried lead | first sentence opens with a preamble |
| prose table | 3 or more consecutive `Label: value` lines outside a list |

Findings go back into the model's context as named violations, each with the text that triggered it:

```
READABILITY VIOLATED in your previous message:
  long sentence - 68 words (over 35) - "The deployment pipeline currently builds the container image on every push..."
Rewrite that shape in every reply from now on. Do not acknowledge this notice.
```

Every rule in the injected directive has a check behind it. A rule with no check is advice, and the model ignores advice.

`prose table` catches the hand-rolled shape only, three or more labelled lines in a row. A comparison spread across flowing sentences goes unreported. That miss is deliberate, because the broader heuristic fires on ordinary prose.

## Why it quotes the text

A standing reminder competes with everything else in the context window and loses. "Write shorter paragraphs" is advice the model already agrees with and still ignores.

A quote is evidence. It points at text the model wrote thirty seconds ago and names the rule it broke. The earlier version of this hook emitted one constant sentence per turn and changed nothing.

## Tuning

`limits.json` ships the defaults. Override them per project or per user:

| File | Scope |
|------|-------|
| `.readable-responses.json` in `CLAUDE_PROJECT_DIR` | this repository |
| `~/.claude/readable-responses.json` | every project, Claude Code |
| `~/.codex/readable-responses.json` | every project, Codex |
| `limits.json` in the plugin | the shipped defaults |

The project file wins over the two user files, and all three win over the defaults. A file may set one key and inherit the rest:

```json
{ "paragraphWords": 50 }
```

`maxReported` caps how many violations one report lists. Four is enough to steer a rewrite. Twenty reads as a log dump.

Editing `limits.json` in an installed plugin does not survive an update, because the plugin lives in the marketplace cache. A malformed override is ignored and the defaults apply, since a config error must never block a prompt.

The injected directive quotes the resolved numbers. A change reaches the model and the checker together, so the model never works to a threshold the checker no longer enforces. Restart the agent to pick up an edit.

## How the two hosts differ

The checker is shared. Only the edges differ:

| | Claude Code | Codex CLI |
|---|---|---|
| config | plugin `hooks.json` | `~/.codex/hooks.json` |
| hook output | raw stdout | `hookSpecificOutput.additionalContext` JSON |
| transcript entry | `message.content[].text` | `payload.content[].output_text` |

`hooks/inject.js` takes `--codex` to switch the output format. The flag is explicit because the two hosts send overlapping stdin fields, so sniffing the payload would guess.

## It composes with curt

This plugin checks shape only. Word choice, sycophancy, and cadence belong to [curt](https://github.com/NovusEdge/curt), and duplicating its sets here would give you two reports for one fault.

Run both. When curt is installed, this plugin reuses its `lastTurn` and `prosify` exports instead of parsing the transcript itself. Curt reads the Claude Code schema only, so a Codex rollout falls through to the built-in reader.

## Why no PostToolUse tier

Curt registers `PostToolUse` to catch bad prose mid-turn, next to the tool result. That tier is wrong for a shape checker.

The message that carries the prose arrives after the last tool call. `PostToolUse` sees only the short preambles between tools, where a 70-word paragraph is rare. The tier would cost session state for deduplication and report almost nothing.

## Tests

```bash
node tests/run.js
```

No network and no agent session. The suite writes synthetic transcript JSONL in both schemas, runs the hook as a subprocess, and asserts its output.

It covers one case per rule and both sides of the two heuristic rules. It also covers config precedence, the `--codex` envelope, and the Codex install merge.

The failure cases are a missing `transcript_path`, malformed stdin, a malformed config file, and a message that is all code fences.

`HOME` points at an empty directory for most cases, which forces the built-in transcript reader. One case runs against the real `HOME` and skips when curt is absent.

## License

MIT. See [LICENSE](LICENSE).
