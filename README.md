# Readable Responses

Claude Code plugin that makes replies readable. It checks the shape of the previous turn and names what broke.

## What it does

A `UserPromptSubmit` hook reads the transcript, takes the last assistant turn, and strips code and quotes from it. It then measures three things:

| Rule | Default limit |
|------|---------------|
| wall of text | paragraph over 70 words |
| long sentence | sentence over 35 words |
| unbroken block | 6 prose lines with no break |

Findings go back into the model's context as named violations, each with the text that triggered it:

```
READABILITY VIOLATED in your previous message:
  long sentence - 68 words (over 35) - "The deployment pipeline currently builds the container image on every push..."
Rewrite that shape in every reply from now on. Do not acknowledge this notice.
```

## Why it quotes the text

A standing reminder competes with everything else in the context window and loses. "Write shorter paragraphs" is advice the model already agrees with and still ignores.

A quote is evidence. It points at text the model wrote thirty seconds ago and names the rule it broke. The earlier version of this hook emitted one constant sentence per turn and changed nothing.

## Install

```bash
/plugin marketplace add NovusEdge/readable-responses
/plugin install readable-responses@readable-responses
```

Or from a local checkout:

```bash
./install.sh --local
```

Restart Claude Code after installing. Turn it off with `/plugin disable readable-responses`.

## Tuning

Edit `limits.json` at the repo root:

```json
{
  "paragraphWords": 70,
  "sentenceWords": 35,
  "blockLines": 6,
  "maxReported": 4
}
```

The injected directive quotes these numbers. A change reaches the model and the checker together, so the model never works to a threshold the checker no longer enforces. Restart Claude Code to pick up an edit.

`maxReported` caps how many violations one report lists. Four is enough to steer a rewrite; twenty reads as a log dump.

## It composes with curt

This plugin checks shape only. Word choice, sycophancy, and cadence belong to [curt](https://github.com/NovusEdge/curt), and duplicating its sets here would give you two reports for one fault.

Run both. When curt is installed, this plugin reuses its `lastTurn` and `prosify` exports instead of parsing the transcript itself. Without curt it falls back to its own reader, so it works standalone.

## Why no PostToolUse tier

Curt registers `PostToolUse` to catch bad prose mid-turn, next to the tool result. That tier is wrong for a shape checker.

The message that carries the prose arrives after the last tool call. `PostToolUse` sees only the short preambles between tools, where a 70-word paragraph is rare. The tier would cost session state for deduplication and report almost nothing.

## Tests

```bash
node tests/run.js
```

No network and no Claude session. The suite writes synthetic transcript JSONL, runs the hook as a subprocess, and asserts its output. It covers a violating paragraph, a clean message, a missing `transcript_path`, malformed stdin, and a message that is all code fences.

`HOME` points at an empty directory for most cases, which forces the built-in transcript reader. One case runs against the real `HOME` and skips when curt is absent.

## License

MIT. See [LICENSE](LICENSE).
