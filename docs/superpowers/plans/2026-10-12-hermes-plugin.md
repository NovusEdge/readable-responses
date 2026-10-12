# Hermes Agent Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** readable-responses gives Hermes Agent the same per-prompt guidance and previous-reply readability review it gives Claude Code.

**Architecture:** `hooks/check.js` gains a `--json` CLI that turns assistant text into `{directive, findings}`. A stdlib-only Python plugin in `.hermes-plugin/` registers Hermes's `pre_llm_call` hook, pulls the previous turn's assistant prose out of `conversation_history`, runs the CLI with `node`, and formats the result with the same wording as `hooks/inject.js`.

**Tech Stack:** Node (no dependencies), Python 3.12+ stdlib (`subprocess`, `json`, `unittest`), Hermes Agent plugin API.

**Spec:** `docs/superpowers/specs/2026-10-12-hermes-plugin-design.md`

## Global Constraints

- Python in `.hermes-plugin/` uses the standard library only.
- No `plugin.json` or `plugin.yaml` at the repo root. The Hermes manifest is `.hermes-plugin/plugin.yaml`.
- `hooks/inject.js`, `hooks/hooks.json` and the Codex path stay unchanged.
- Every `node` call has a 2 second timeout.
- No failure blocks a prompt: the hook returns `None` or the last directive, never raises.
- Report wording matches `hooks/inject.js` exactly: `READABILITY REVIEW for your previous message:`, the `  <rule> - <detail> - "<text>"` lines, and the closing `Inspect these passages…` sentence.
- Commits use `git commit -s` and carry no `Co-Authored-By` trailer.

## Review Focus

1. An assistant message whose `content` is a list of parts (`[{"type": "text", "text": …}]`), not a string, still gets reviewed.
2. A previous turn split across several assistant messages with `tool` messages between them is reviewed as one text, as `previousProse` does for Claude transcripts.
3. An assistant message that carries only `tool_calls` with `content: None` is skipped, not treated as empty prose that ends the turn.
4. The first prompt of a session, with no assistant message in history, gets the directive and no review.
5. `node` printing something that is not JSON (a deprecation warning on stdout, say) falls back to the last directive instead of injecting nothing.

Each of these has a test in Task 2 or Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `hooks/check.js` (modify) | `--json` CLI; `~/.hermes/readable-responses.json` limits source; curt lookup under `~/.hermes/plugins/curt` |
| `tests/run.js` (modify) | CLI and Hermes limits cases |
| `.hermes-plugin/plugin.yaml` (create) | Hermes manifest |
| `.hermes-plugin/node_runner.py` (create) | Find `node`, run a script with `--json`, return parsed JSON or `None` |
| `.hermes-plugin/history.py` (create) | Hermes `conversation_history` → previous turn's user and assistant text |
| `.hermes-plugin/__init__.py` (create) | `pre_llm_call` hook, report formatting, `register(ctx)` |
| `.hermes-plugin/test_plugin.py` (create) | Python tests, loading the plugin the way Hermes does |
| `README.md`, `CHANGELOG.md`, `limits.json` (modify) | Hermes install, host table, config sources |

---

### Task 1: `check.js --json` and the Hermes config source

**Files:**
- Modify: `hooks/check.js` (`loadLimits` sources around line 19, `loadCurt` candidates around line 57, append the CLI after `module.exports`)
- Test: `tests/run.js`

**Interfaces:**
- Produces: `node hooks/check.js --json` reads `{"assistant": string}` on stdin and writes one line of JSON, `{"directive": string, "findings": [{"rule": string, "detail": string, "text": string}]}`, with findings capped at `LIMITS.maxReported`. Exit 0. Unparseable stdin exits 2 with no output. Empty stdin or a missing/blank `assistant` gives `findings: []`.

- [ ] **Step 1: Write the failing tests**

In `tests/run.js`, add after the `HOOK` constant:

```js
const CHECK = path.join(__dirname, '..', 'hooks', 'check.js');

function runJson(stdin, { home = EMPTY_HOME, projectDir = EMPTY_HOME } = {}) {
  return execFileSync('node', [CHECK, '--json'], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: projectDir },
  });
}

function hermesHome(name, limits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `readable-responses-${name}-`));
  fs.mkdirSync(path.join(dir, '.hermes'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.hermes', 'readable-responses.json'), JSON.stringify(limits));
  return dir;
}
```

Add these cases before the final `fs.rmSync(TMP, …)`:

```js
{
  const { DIRECTIVE, LIMITS, check, previousProse } = require('../hooks/check.js');
  const out = JSON.parse(runJson(JSON.stringify({ assistant: WALL })));
  assert('--json returns the directive', out.directive === DIRECTIVE, JSON.stringify(out));
  assert('--json reports wall of text', out.findings.some(f => f.rule === 'wall of text'), JSON.stringify(out));
  const file = transcript('jsonparity', turn('why is the bill high', WALL));
  const expected = check(previousProse(file)).slice(0, LIMITS.maxReported);
  assert(
    '--json matches the transcript path',
    JSON.stringify(out.findings) === JSON.stringify(expected),
    `${JSON.stringify(out.findings)}\n${JSON.stringify(expected)}`
  );
}

{
  const out = JSON.parse(runJson(JSON.stringify({ assistant: CLEAN })));
  assert('--json clean text has no findings', out.findings.length === 0, JSON.stringify(out));
  const empty = JSON.parse(runJson(''));
  assert('--json empty stdin gives the directive only', empty.findings.length === 0 && empty.directive.startsWith('READABLE RESPONSE GUIDANCE.'), JSON.stringify(empty));
  const fenced = JSON.parse(runJson(JSON.stringify({ assistant: FENCED })));
  assert('--json ignores code fences', fenced.findings.length === 0, JSON.stringify(fenced));
}

{
  let status = 0;
  try {
    runJson('not json at all {{{');
  } catch (error) {
    status = error.status;
  }
  assert('--json malformed stdin exits 2', status === 2, String(status));
}

{
  const home = hermesHome('hermeshome', { paragraphWords: 11 });
  const out = JSON.parse(runJson(JSON.stringify({ assistant: CLEAN }), { home }));
  assert('hermes config is read', out.directive.includes('paragraphs over 11 words'), out.directive);
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'readable-responses.json'), JSON.stringify({ paragraphWords: 12 }));
  const both = JSON.parse(runJson(JSON.stringify({ assistant: CLEAN }), { home }));
  assert('hermes config beats claude config', both.directive.includes('paragraphs over 11 words'), both.directive);
  const project = configDir('hermesproject', { projectConfig: { paragraphWords: 9 } });
  const withProject = JSON.parse(runJson(JSON.stringify({ assistant: CLEAN }), { home, projectDir: project }));
  assert('project config beats hermes config', withProject.directive.includes('paragraphs over 9 words'), withProject.directive);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/run.js`
Expected: the new `--json` cases FAIL (the CLI does not exist, so `JSON.parse` throws or the exit status is 0), and every existing case still prints `ok`.

- [ ] **Step 3: Implement**

In `loadLimits()`, change `sources` to put the Hermes file after the Claude file and before the project file:

```js
  const sources = [
    path.join(codexHome, 'readable-responses.json'),
    path.join(process.env.HOME || '', '.claude', 'readable-responses.json'),
    path.join(process.env.HOME || '', '.hermes', 'readable-responses.json'),
    path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.readable-responses.json'),
  ];
```

In `loadCurt()`, add the Hermes install location as the last candidate:

```js
  const candidates = [
    path.join(process.env.HOME || '', '.claude/plugins/marketplaces/curt/hooks/check.js'),
    path.join(process.env.HOME || '', '.claude/plugins/marketplaces/anti-slop/hooks/check.js'),
    path.join(process.env.HOME || '', '.hermes/plugins/curt/hooks/check.js'),
  ];
```

Append after `module.exports = …;`:

```js
// Hermes runs this file directly: {"assistant": text} on stdin, the guidance
// and the findings for that text as one JSON line on stdout. Hermes hands over
// message text, not a transcript, so previousProse's readers do not apply.
if (require.main === module && process.argv.includes('--json')) {
  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    stdin += chunk;
  });
  process.stdin.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(stdin || '{}');
    } catch {
      process.exitCode = 2;
      return;
    }
    const assistant = String((payload && payload.assistant) || '');
    let findings = [];
    if (assistant.trim()) {
      const curt = loadCurt();
      const prose = curt ? curt.prosify(assistant) : fallbackProsify(assistant);
      findings = check(prose).slice(0, LIMITS.maxReported);
    }
    process.stdout.write(JSON.stringify({ directive: DIRECTIVE, findings }) + '\n');
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/run.js`
Expected: every case `ok`, last line `all passed`.

- [ ] **Step 5: Commit**

```bash
git add hooks/check.js tests/run.js
git commit -s -m "feat(check): JSON CLI and a Hermes limits source" -m "node hooks/check.js --json takes assistant text on stdin and prints the guidance and findings as JSON, for hosts that pass message text instead of a transcript. ~/.hermes/readable-responses.json sits between the Claude and project config, and curt is found under ~/.hermes/plugins as well."
```

---

### Task 2: Node runner and history reader

**Files:**
- Create: `.hermes-plugin/node_runner.py`
- Create: `.hermes-plugin/history.py`
- Create: `.hermes-plugin/test_plugin.py`

**Interfaces:**
- Consumes: the Task 1 CLI contract.
- Produces:
  - `node_runner.TIMEOUT_S: float = 2.0`
  - `node_runner.find_node() -> str | None`
  - `node_runner.run_json(script: pathlib.Path, payload: dict) -> object | None` — parsed stdout, or `None` on missing node, timeout, non-zero exit or bad JSON.
  - `history.text_of(message: dict) -> str`
  - `history.previous_turn(messages: list[dict]) -> tuple[str, str]` — `(user_text, assistant_text)` of the last completed turn; `("", "")` when there is none.

- [ ] **Step 1: Write the failing tests**

Create `.hermes-plugin/test_plugin.py`:

```python
"""Tests for the Hermes plugin. Run: python3 .hermes-plugin/test_plugin.py"""

import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
REPO = HERE.parent


def load_plugin():
    # Hermes imports a plugin as a package rooted at its directory; doing the
    # same here makes the relative imports in __init__.py resolve.
    name = "readable_responses_under_test"
    spec = importlib.util.spec_from_file_location(
        name, HERE / "__init__.py", submodule_search_locations=[str(HERE)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


PLUGIN = load_plugin()
history = sys.modules["readable_responses_under_test.history"]
node_runner = sys.modules["readable_responses_under_test.node_runner"]

WALL = " ".join([
    "The deployment pipeline currently builds the container image on every push to any branch,",
    "which means the registry fills with images nobody will ever pull, and the build minutes are",
    "spent on branches that get deleted within the hour, so the sensible change is to build only",
    "on the default branch and on tags, then let a scheduled job prune anything older than thirty",
    "days from the registry, because the storage cost is the part of the bill that grows without",
    "anyone noticing it until the quarter closes and somebody asks where the money went.",
])
CLEAN = ("The build runs on every branch. That fills the registry with images nobody pulls.\n\n"
         "Build on the default branch and on tags. Prune images older than thirty days.")


def user(text):
    return {"role": "user", "content": text}


def assistant(text, tool_calls=None):
    message = {"role": "assistant", "content": text}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return message


def tool(text):
    return {"role": "tool", "tool_call_id": "call_1", "content": text}


class IsolatedHome(unittest.TestCase):
    """check.js reads limits from HOME and the project dir; point both at an empty dir."""

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="rr-hermes-home-")
        patcher = mock.patch.dict(os.environ, {
            "HOME": self.home, "CLAUDE_PROJECT_DIR": self.home, "CODEX_HOME": self.home})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(shutil.rmtree, self.home, True)


class HistoryTest(unittest.TestCase):
    def test_text_of_string_content(self):
        self.assertEqual(history.text_of(assistant("hi")), "hi")

    def test_text_of_part_list(self):
        message = {"role": "assistant", "content": [
            {"type": "text", "text": "one"}, {"type": "image_url", "image_url": {}},
            {"type": "text", "text": "two"}]}
        self.assertEqual(history.text_of(message), "one\ntwo")

    def test_text_of_tool_call_only_message(self):
        self.assertEqual(history.text_of(assistant(None, tool_calls=[{"id": "c"}])), "")

    def test_previous_turn_skips_current_prompt(self):
        messages = [user("why"), assistant("because"), user("and now?")]
        self.assertEqual(history.previous_turn(messages), ("why", "because"))

    def test_previous_turn_joins_assistant_messages_across_tools(self):
        messages = [
            user("fix it"),
            assistant("Looking at the log.", tool_calls=[{"id": "c"}]),
            tool("log output"),
            assistant(None, tool_calls=[{"id": "d"}]),
            tool("more output"),
            assistant("Fixed the pin."),
            user("thanks"),
        ]
        self.assertEqual(history.previous_turn(messages),
                         ("fix it", "Looking at the log.\n\nFixed the pin."))

    def test_previous_turn_without_assistant(self):
        self.assertEqual(history.previous_turn([user("first prompt")]), ("", ""))
        self.assertEqual(history.previous_turn([]), ("", ""))


class NodeRunnerTest(IsolatedHome):
    CHECK = REPO / "hooks" / "check.js"

    def test_runs_the_cli(self):
        out = node_runner.run_json(self.CHECK, {"assistant": WALL})
        self.assertTrue(any(f["rule"] == "wall of text" for f in out["findings"]))

    def test_missing_node_returns_none(self):
        with mock.patch.object(node_runner, "find_node", return_value=None):
            self.assertIsNone(node_runner.run_json(self.CHECK, {"assistant": WALL}))

    def test_timeout_returns_none(self):
        slow = Path(self.home) / "slow.js"
        slow.write_text("setTimeout(() => {}, 5000);")
        with mock.patch.object(node_runner, "TIMEOUT_S", 0.2):
            self.assertIsNone(node_runner.run_json(slow, {}))

    def test_non_json_stdout_returns_none(self):
        noisy = Path(self.home) / "noisy.js"
        noisy.write_text("console.log('warning: something');")
        self.assertIsNone(node_runner.run_json(noisy, {}))

    def test_non_zero_exit_returns_none(self):
        failing = Path(self.home) / "fail.js"
        failing.write_text("process.exit(3);")
        self.assertIsNone(node_runner.run_json(failing, {}))


if __name__ == "__main__":
    unittest.main()
```

Create a placeholder `.hermes-plugin/__init__.py` so the package loads:

```python
from . import history, node_runner  # noqa: F401
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 .hermes-plugin/test_plugin.py`
Expected: FAIL at import with `ModuleNotFoundError: No module named 'readable_responses_under_test.history'`.

- [ ] **Step 3: Implement**

Create `.hermes-plugin/node_runner.py`:

```python
"""Run a Node script in --json mode and parse what it prints."""

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

TIMEOUT_S = 2.0
_warned_missing = False


def find_node() -> str | None:
    found = shutil.which("node")
    if found:
        return found
    # The Hermes installer ships its own node, which is not always on PATH.
    hermes_home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
    bundled = hermes_home / "node" / "bin" / "node"
    return str(bundled) if bundled.is_file() else None


def run_json(script: Path, payload: dict) -> object | None:
    global _warned_missing
    node = find_node()
    if node is None:
        if not _warned_missing:
            logger.warning("readable-responses: node not found; the readability review is off")
            _warned_missing = True
        return None
    try:
        done = subprocess.run(
            [node, str(script), "--json"], input=json.dumps(payload),
            capture_output=True, text=True, timeout=TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.debug("readable-responses: %s did not finish: %s", script.name, exc)
        return None
    if done.returncode != 0:
        logger.debug("readable-responses: %s exited %s: %s", script.name, done.returncode, done.stderr.strip())
        return None
    try:
        return json.loads(done.stdout)
    except ValueError:
        logger.debug("readable-responses: %s printed non-JSON output", script.name)
        return None
```

Create `.hermes-plugin/history.py`:

```python
"""Read the previous turn out of Hermes's OpenAI-format conversation history."""

TEXT_PARTS = {"text", "output_text", "input_text"}


def text_of(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            part.get("text", "") for part in content
            if isinstance(part, dict) and part.get("type") in TEXT_PARTS)
    return ""


def previous_turn(messages: list[dict]) -> tuple[str, str]:
    """(user_text, assistant_text) for the last turn that has an assistant reply.

    pre_llm_call receives the history with the new prompt already at the end, so
    the walk first skips back to the newest assistant message. One turn spans
    every assistant message after its user message; tool messages sit between
    them and carry no prose.
    """
    end = len(messages) - 1
    while end >= 0 and messages[end].get("role") != "assistant":
        end -= 1
    if end < 0:
        return "", ""
    start = end
    while start >= 0 and messages[start].get("role") != "user":
        start -= 1
    user_text = text_of(messages[start]) if start >= 0 else ""
    replies = [text_of(m).strip() for m in messages[start + 1:end + 1] if m.get("role") == "assistant"]
    return user_text, "\n\n".join(r for r in replies if r)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 .hermes-plugin/test_plugin.py`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add .hermes-plugin/node_runner.py .hermes-plugin/history.py .hermes-plugin/__init__.py .hermes-plugin/test_plugin.py
git commit -s -m "feat(hermes): node runner and conversation history reader" -m "run_json finds node on PATH or in ~/.hermes/node, runs a script in --json mode with a 2 second timeout and returns None on any failure. previous_turn joins every assistant message of the last completed turn, across tool calls."
```

---

### Task 3: The `pre_llm_call` hook and manifest

**Files:**
- Create: `.hermes-plugin/plugin.yaml`
- Modify: `.hermes-plugin/__init__.py` (replace the Task 2 placeholder)
- Test: `.hermes-plugin/test_plugin.py`

**Interfaces:**
- Consumes: `history.previous_turn`, `node_runner.run_json`, the Task 1 CLI.
- Produces: `pre_llm_call(conversation_history=None, **_) -> dict | None` returning `{"context": str}`; `register(ctx)` calling `ctx.register_hook("pre_llm_call", pre_llm_call)`.

- [ ] **Step 1: Write the failing tests**

Add to `.hermes-plugin/test_plugin.py`, above `if __name__ == "__main__":`:

```python
class FakeCtx:
    def __init__(self):
        self.hooks = {}

    def register_hook(self, name, callback):
        self.hooks[name] = callback


class HookTest(IsolatedHome):
    def setUp(self):
        super().setUp()
        PLUGIN._last_directive = ""

    def context(self, messages):
        result = PLUGIN.pre_llm_call(conversation_history=messages, session_id="s1")
        return result["context"] if result else None

    def test_register_wires_pre_llm_call(self):
        ctx = FakeCtx()
        PLUGIN.register(ctx)
        self.assertIs(ctx.hooks["pre_llm_call"], PLUGIN.pre_llm_call)

    def test_first_turn_gets_the_directive_only(self):
        text = self.context([user("hello")])
        self.assertTrue(text.startswith("READABLE RESPONSE GUIDANCE."))
        self.assertNotIn("READABILITY REVIEW", text)

    def test_long_paragraph_is_reviewed(self):
        text = self.context([user("why is the bill high"), assistant(WALL), user("ok")])
        self.assertIn("READABILITY REVIEW for your previous message:", text)
        self.assertIn("wall of text", text)
        self.assertIn('"The deployment pipeline currently', text)
        self.assertIn("Inspect these passages in context.", text)

    def test_clean_reply_is_not_reviewed(self):
        text = self.context([user("why"), assistant(CLEAN), user("ok")])
        self.assertTrue(text.startswith("READABLE RESPONSE GUIDANCE."))
        self.assertNotIn("READABILITY REVIEW", text)

    def test_part_list_reply_is_reviewed(self):
        reply = {"role": "assistant", "content": [{"type": "text", "text": WALL}]}
        self.assertIn("wall of text", self.context([user("why"), reply, user("ok")]))

    def test_node_missing_returns_none_before_any_directive(self):
        with mock.patch.object(node_runner, "find_node", return_value=None):
            self.assertIsNone(PLUGIN.pre_llm_call(conversation_history=[user("hi")]))

    def test_node_failure_falls_back_to_last_directive(self):
        first = self.context([user("hi")])
        with mock.patch.object(node_runner, "run_json", return_value=None):
            again = self.context([user("why"), assistant(WALL), user("ok")])
        self.assertEqual(again, first)

    def test_non_dict_result_falls_back_to_last_directive(self):
        first = self.context([user("hi")])
        with mock.patch.object(node_runner, "run_json", return_value=["unexpected"]):
            self.assertEqual(self.context([user("hi")]), first)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 .hermes-plugin/test_plugin.py`
Expected: FAIL with `AttributeError: module 'readable_responses_under_test' has no attribute 'pre_llm_call'`.

- [ ] **Step 3: Implement**

Replace `.hermes-plugin/__init__.py`:

```python
"""readable-responses for Hermes Agent: per-prompt guidance and a readability
review of the previous reply, through the pre_llm_call hook."""

from pathlib import Path

from . import history, node_runner

CHECK_JS = Path(__file__).resolve().parent.parent / "hooks" / "check.js"

INSPECT = ("Inspect these passages in context. Change only what improves clarity while "
           "preserving meaning and the user's requested format. No automatic rewrite or "
           "reply to this notice is needed.")

# The directive quotes the resolved limits, so it comes from check.js. When a
# later call fails, the last one received still steers the turn.
_last_directive = ""


def _report(findings: list) -> list[str]:
    lines = ["", "READABILITY REVIEW for your previous message:"]
    lines += [f'  {f.get("rule")} - {f.get("detail")} - "{f.get("text")}"' for f in findings]
    lines.append(INSPECT)
    return lines


def pre_llm_call(conversation_history=None, **_):
    global _last_directive
    _, assistant_text = history.previous_turn(conversation_history or [])
    result = node_runner.run_json(CHECK_JS, {"assistant": assistant_text})
    if not isinstance(result, dict) or not isinstance(result.get("directive"), str):
        return {"context": _last_directive} if _last_directive else None
    _last_directive = result["directive"]
    lines = [_last_directive]
    findings = result.get("findings")
    if isinstance(findings, list) and findings:
        lines += _report(findings)
    return {"context": "\n".join(lines)}


def register(ctx):
    ctx.register_hook("pre_llm_call", pre_llm_call)
```

Create `.hermes-plugin/plugin.yaml`:

```yaml
name: readable-responses
version: 0.3.0
description: Readable response guidance and a readability review of the previous reply
author: NovusEdge
provides_hooks:
  - pre_llm_call
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 .hermes-plugin/test_plugin.py && node tests/run.js`
Expected: `OK`, then `all passed`.

- [ ] **Step 5: Commit**

```bash
git add .hermes-plugin/__init__.py .hermes-plugin/plugin.yaml .hermes-plugin/test_plugin.py
git commit -s -m "feat(hermes): pre_llm_call plugin" -m "Each prompt carries the guidance block; when the previous turn trips a limit, the readability review follows with the same wording as the Claude Code hook. A failed check falls back to the last guidance received."
```

---

### Task 4: Docs and an end-to-end check

**Files:**
- Modify: `README.md` (Quickstart, "How the two hosts differ", "Tests")
- Modify: `CHANGELOG.md`
- Modify: `limits.json` (`_comment`)

- [ ] **Step 1: Update the docs**

In `README.md`, add after the `### Codex CLI` quickstart section:

````markdown
### Hermes Agent

```bash
hermes plugins install NovusEdge/readable-responses --enable
```

The plugin runs `hooks/check.js` with `node`, from `PATH` or the copy Hermes installs in `~/.hermes/node`. Restart open Hermes sessions after installing.
````

Rename `## How the two hosts differ` to `## How the hosts differ`, keep its opening sentence, and replace the table with:

```markdown
| | Claude Code | Codex CLI | Hermes Agent |
|---|---|---|---|
| config | plugin `hooks.json` | `~/.codex/hooks.json` | `.hermes-plugin/plugin.yaml` |
| hook | `UserPromptSubmit` | `UserPromptSubmit` | `pre_llm_call` |
| hook output | raw stdout | `hookSpecificOutput.additionalContext` JSON | `{"context": …}` from Python |
| previous reply | transcript `message.content[].text` | transcript `payload.content[].output_text` | `conversation_history`, passed to `check.js --json` |
```

In `## Tuning`, add `~/.hermes/readable-responses.json` to the list of config files, between the Claude file and the project file, with the note that it applies to Hermes.

In `## Tests`, add:

````markdown
The Hermes plugin has its own suite:

```bash
python3 .hermes-plugin/test_plugin.py
```
````

In `limits.json`, change `_comment` to name all four sources:

```json
  "_comment": "Review thresholds, not mandatory output limits. Override them in .readable-responses.json in the project, ~/.hermes/readable-responses.json, ~/.claude/readable-responses.json, or CODEX_HOME/readable-responses.json. Installed plugin updates replace this file; the injected guidance quotes the resolved numbers.",
```

In `CHANGELOG.md`, add above `## [0.3.0]`:

```markdown
## [Unreleased]

### Added

- Hermes Agent plugin in `.hermes-plugin/`: per-prompt guidance and the previous-reply review through `pre_llm_call`.
- `node hooks/check.js --json` for hosts that pass message text instead of a transcript.
- `~/.hermes/readable-responses.json` as a limits source.
```

- [ ] **Step 2: Run both suites**

Run: `node tests/run.js && python3 .hermes-plugin/test_plugin.py`
Expected: `all passed`, then `OK`.

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md limits.json
git commit -s -m "docs: Hermes Agent install and host differences"
```

- [ ] **Step 4: End-to-end check in Hermes (by hand)**

Run, in a terminal outside any Claude Code session:

```bash
hermes plugins install file://$HOME/Projects/readable-responses --enable
hermes -z 'Explain in one single paragraph of at least 120 words why container registries grow.'
hermes -c -z 'thanks'
grep -n "READABILITY REVIEW" ~/.hermes/logs/agent.log | tail -3
```

Expected: the plugin installs and enables. The second command's request carries `READABILITY REVIEW for your previous message:` with a `wall of text` line. If the log does not record injected context, confirm instead with `hermes sessions` / the session transcript that the second user message contains the review. Record which source showed it in the PR description.
