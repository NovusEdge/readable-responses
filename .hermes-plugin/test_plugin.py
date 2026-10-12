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

    def test_text_of_part_with_null_text(self):
        message = {"role": "assistant", "content": [
            {"type": "text", "text": None}, {"type": "text", "text": "ok"}]}
        self.assertEqual(history.text_of(message), "\nok")

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
        with mock.patch.object(node_runner, "find_node", return_value=None), \
                mock.patch.object(node_runner, "_warned_missing", False), \
                self.assertLogs(node_runner.logger, "WARNING"):
            self.assertIsNone(node_runner.run_json(self.CHECK, {"assistant": WALL}))

    def test_unresolvable_home_returns_none(self):
        env = {k: v for k, v in os.environ.items() if k != "HERMES_HOME"}
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch("shutil.which", return_value=None), \
                mock.patch.object(Path, "home", side_effect=RuntimeError("no home")), \
                mock.patch.object(node_runner, "_warned_missing", True):
            self.assertIsNone(node_runner.run_json(self.CHECK, {}))

    def test_unserializable_payload_returns_none(self):
        self.assertIsNone(node_runner.run_json(self.CHECK, {"assistant": object()}))

    def test_invalid_utf8_stdout_returns_none(self):
        bad = Path(self.home) / "bad.js"
        bad.write_text("process.stdout.write(Buffer.from([0xff, 0xfe]));")
        self.assertIsNone(node_runner.run_json(bad, {}))

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
