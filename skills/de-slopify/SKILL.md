---
name: de-slopify
description: Use when writing, revising, or reviewing technical docs, specs, READMEs, procedures, or troubleshooting guides, or when asked to remove formulaic or AI-sounding prose from blogs and portfolio pages. Not a default style for unrelated conversation or creative writing.
---

# De-slopify

Make writing precise and readable while preserving the author's meaning and voice.
Default to targeted edits. A clear sentence may need no change. A wording pass is
not a summary; preserve meaningful arguments, examples, and the connections between them.

## Choose the task

Honor the requested action: a review produces findings; a rewrite changes the
requested text; a wording-only edit preserves structure and scope. Infer the
audience and document type from context. Ask only when a missing answer would
materially change the result. Project instructions take precedence.

- **Engineering spec:** optimize for independent implementation and review.
  Read the spec checks in [review-checklist.md](references/review-checklist.md).
- **User documentation:** optimize for completing a task or finding an answer.
  Read the user-documentation checks in that reference.
- **Short prose:** edit directly. Preserve meaning and omit unrelated checklists.
- **Personal blogs and portfolio pages:** retain the author's actual experiences,
  opinions, jokes, and rhythm. Distinguish proposed, implemented, and tested work.
  Use the passage-level checks below rather than imposing a documentation voice.

## Editing method

1. Establish the facts. Read the requested material and relevant definitions.
   For technical documentation work, check commands and defaults against
   available source, help, or tests. For a wording-only request, use the supplied
   facts. Treat a design spec as proposed behavior: an implementation difference
   is not automatically a spec error.
2. Preserve meaning. Keep identifiers, syntax, defaults, conditions, uncertainty,
   and requirement strength. Retain useful examples, tables, rationale, and
   domain vocabulary. Keep technical terms consistent instead of rotating
   synonyms for variety.
3. Remove friction. Lead with the outcome or rule. Replace vague claims,
   ceremonial introductions, repeated conclusions, and marketing language with
   concrete facts. Expand shorthand where it conceals behavior. Split a dense
   bullet when its requirements need separate interpretation or tests.
4. Check the contract. Compare examples, errors, tables, and tests with the prose.
   Resolve a contradiction only when the source makes the intended rule clear.
   Otherwise record a specific open question and continue independent edits.
5. Compare the revision with the original. Check for lost conditions, changed
   quantifiers, invented behavior, and unnecessary expansion. Report what was
   actually verified; source inspection is not a live execution test.

## Formulaic prose

Read the surrounding argument before editing individual sentences. Look for
staged revelations, announcements of honesty, praise for the author's own
skepticism, canned questions and answers, and repeated slogan endings. Keep
the actual correction, evidence, or implication while removing empty ceremony.
A real change of mind may be central to the argument; retain the previous claim
and the evidence that changed it when supplied. An opener such as "there goes a
line I'd been leaning on" alone supplies neither; cut it without inventing the
missing belief.

Preserve good existing jokes, profanity, contractions, and varied sentence
lengths. Do not manufacture a human voice with new slang, clipped fragments,
deliberate mistakes, or a stock cynical persona. Never invent first-person
experiences, motives, feelings, or opinions on the author's behalf.

For example, "The honest version is better anyway: on the matched pairs, the
model scored 0.751" can become "On the matched pairs, the model scored 0.751."
Keep any substantive correction in the surrounding passage. Conversely,
"I spent forty minutes debugging a circuit that was unplugged" may need no edit.

A word or lint match is a prompt to inspect context, not proof of AI authorship
or bad prose. Passive voice, a useful contrast, a short paragraph, and an
ordinary adjective can all do useful work. Do not replace a promotional claim
with a quieter unsupported claim. For a wording-only edit, flag factual doubts
separately rather than silently changing the facts.

Read the revision as a passage, then compare it with the original. Restore
arguments or examples cut only for brevity, and repair broken connections.
Check whether the result still sounds like this author rather than uniformly
terse or polished assistant prose. There is no target reduction percentage.

## Output

For a rewrite, return the revised text or requested file edits. Add only material
unresolved questions and verification limits. For a review, give the location,
specific issue, reader impact, and suggested correction; separate editorial fixes
from decisions the author must make. If the text is already clear, say so briefly.

## Boundaries

The name is not a word blacklist. Do not impose sentence-length caps, banned
punctuation, fixed headings, or a tutorial structure on every document. Resolve
ambiguity without flattening useful voice or teaching experts basic vocabulary.
Never invent commands, defaults, recovery steps, or guarantees to fill a gap.
Document review does not authorize running destructive examples or changing code.

This is original practical guidance informed by public plain-language resources
and software-documentation concerns. It does not implement or certify ISO 24495-1,
ISO/IEC/IEEE 26514, or ASD-STE100. For provenance or standards questions, read
[sources-and-limits.md](references/sources-and-limits.md).
