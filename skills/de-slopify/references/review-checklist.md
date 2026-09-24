# Review checks

Apply the checks relevant to the requested work. These are review lenses, not
mandatory output sections. Keep small edits small.

## Engineering specs

- Identify the actor, trigger, condition, action, and observable result where
  they affect implementation. Check ordering, defaults, precedence, and failures.
- Preserve compact technical prose, annotated configuration, exact errors,
  architecture rationale, and exclusions with reasons.
- Expand phrases such as "same as today", "as above", or "no walk-up" when
  the intended behavior is not self-contained or precisely linked.
- Cross-check configuration examples against name-resolution and default rules.
  Check tables and test expectations against the same requirements.
- Distinguish a requirement, its rationale, an example, and an unresolved decision.
  Preserve "must", "may", and "should" meanings without imposing a new vocabulary.
- Check state transitions and retry semantics. A saved success marker alone does
  not establish how every execution policy behaves on the next run.
- Surface missing behavior as a question. For example: does a health-check failure
  retain execution-policy behavior, or override it? Do not choose during copyediting.
- Prefer stable links to named sections or symbols over "spec 3" or an unverified
  source line number. Do not treat an approved design as shipped functionality.

### Example

Original:

> `project.toml` in cwd activates scope. No walk-up.

Revision:

> Project scope is active when the current directory contains `project.toml`.
> The loader does not search parent directories.

If the actor is not established, verify it before naming the loader. This edit
expands an implicit rule; it does not add a discovery algorithm.

## User documentation

- Identify what readers need to accomplish and what they must already have.
  Include prerequisites when needed for success, not a generic setup checklist.
- Make headings and navigation match reader tasks. Keep explanation and reference
  near procedures when useful; do not reorganize an entire site for a small edit.
- Check that commands, flags, paths, permissions, and defaults match the relevant
  product version. Keep shell and platform assumptions explicit when they matter.
- For procedures, check actions, sequence, success signals, and likely failure
  recovery. "Check the logs" is incomplete when the reader cannot identify them.
- When evidence is missing, flag the missing prerequisite, readiness check, or log
  command. A polished but unsupported instruction is not an improvement.
- Explain consequential effects before the affected step, including data loss or
  downtime when the operation actually causes them. Avoid unrelated warnings.
- Preserve accessible structure: descriptive links, meaningful headings, and text
  equivalents for necessary visual information. Do not claim an accessibility audit.

## Meaning-preservation traps

"Reports the key and line" does not establish whether validation reports the
first error or all errors. Adding "each" can change a contract. Likewise, do not
replace "can" with "will", "after" with "immediately", or "retains applied state"
with "never reruns" without evidence.

Domain terms, punctuation, short fragments, and passive voice are not defects by
themselves. Change them when they impede this reader's understanding or hide a
necessary actor. Preserve text that already does its job.
