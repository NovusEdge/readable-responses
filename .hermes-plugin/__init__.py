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
