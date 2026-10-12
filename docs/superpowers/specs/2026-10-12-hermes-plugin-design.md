# Hermes Agent plugin for readable-responses

Date: 2026-10-12. Status: approved design, awaiting spec review.

## Goal

readable-responses works in Hermes Agent (Nous Research) as it does in Claude Code: each prompt carries the guidance block, and the previous reply gets the readability review. A user installs it with `hermes plugins install NovusEdge/readable-responses --enable`.

Success means a Hermes session shows the guidance and, after a reply that trips a limit, the `READABILITY REVIEW` block on the next prompt, with the same wording and thresholds as Claude Code. The Claude Code and Codex hooks are unchanged.

## Behavior

The Claude Code UserPromptSubmit hook maps to Hermes's `pre_llm_call`. On every prompt it returns `{"context": …}` holding `DIRECTIVE`, followed by the review of the last assistant message in `conversation_history` when that message has findings. Findings are capped at `LIMITS.maxReported` and use the same lines as `inject.js`:

```
READABILITY REVIEW for your previous message:
  <rule> - <detail> - "<text>"
Inspect these passages in context. …
```

The guidance stays per prompt, not in the system prompt, because restating it each turn is the existing design. `pre_llm_call` context rides the user message, so it does not disturb Hermes's prompt cache.

## Structure

```
hooks/check.js              + --json CLI mode
hooks/inject.js             unchanged
.hermes-plugin/plugin.yaml  manifest: hook pre_llm_call
.hermes-plugin/__init__.py  register(ctx); stdlib only
.hermes-plugin/test_plugin.py
```

The plugin lives in `.hermes-plugin/`, the layout Hermes discovers for obra/superpowers. Nothing goes at the repo root: Hermes treats a root `plugin.json` as a portable Agent Plugin manifest and refuses the install when it lacks the Agent Plugins schema.

### `check.js --json`

`node hooks/check.js --json` reads `{"assistant": str}` on stdin and writes `{"directive": str, "findings": [{"rule", "detail", "text"}]}`. The assistant text goes through the same prosify step as `previousProse`: curt's `prosify` when `loadCurt()` finds curt, the built-in `fallbackProsify` otherwise. An absent or empty `assistant` returns the directive and no findings. Exit 0 on success, non-zero on unparseable input. The CLI runs only under `require.main === module`, and the exports stay as they are.

Returning the directive from Node keeps one copy of its text and of the limit values interpolated into it.

### Limits

`loadLimits()` gains one source, `~/.hermes/readable-responses.json`, read after the Codex and Claude files and before the project file. A Hermes user can then tune limits without touching another host's config. The project file still resolves from `CLAUDE_PROJECT_DIR` or the working directory, and the plugin runs `node` in Hermes's working directory.

## Failure handling

No failure blocks a prompt.

- `node` resolves from `PATH`, then `~/.hermes/node/bin/node`. If neither exists, the plugin logs one warning and returns nothing.
- The call has a 2 second timeout. Timeout, non-zero exit or bad JSON fall back to the last directive the plugin received this process, with no review, and one debug log line.

## Testing

- `tests/run.js`: `--json` returns the same findings as the in-process `check(previousProse(...))` on the existing cases, under the same empty `HOME`, plus one case that reads `~/.hermes/readable-responses.json`.
- `.hermes-plugin/test_plugin.py` (stdlib `unittest`, fake `ctx` that records registrations): the guidance on a first turn with no history, a review after a long-paragraph reply, no review after a clean reply, node missing, and node timing out.
- End to end, once by hand: install from a `file://` clone, ask for a long answer with `hermes -z`, and confirm the review in `~/.hermes/logs/agent.log` on the next turn.

## Rejected

- A Python port of `check.js`: a second implementation of the shape checks and of curt's prosify.
- Writing a Claude-format transcript and running `inject.js` unchanged: ties Hermes to Claude Code's transcript format.
- Moving `DIRECTIVE` into a Hermes system-prompt section: cheaper, but changes the per-turn restatement the hook relies on.

## Out of scope

Changes to limits or detection rules, Codex behavior, other agents, and publishing to the Hermes plugin catalog.
