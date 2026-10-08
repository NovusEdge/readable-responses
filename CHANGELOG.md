# Changelog

## Unreleased

### Added

- Codex plugin manifest at `.codex-plugin/plugin.json`, sharing the skill and `hooks/hooks.json` with the Claude plugin. Installs with `codex plugin add`; `install.py --codex` stays as an alternative.
- Description on the Claude marketplace manifest, so `claude plugin validate --strict` passes.

## [0.3.0] - 2026-09-24

### Changed

- Replaced mandatory sentence and paragraph caps with contextual review signals.
- Removed automatic table requirements and instructions to rewrite every future reply.
- Added tone guidance that preserves meaning, evidence, uncertainty, author voice, and the user's requested format. Progress updates can state the next action without inventing a finding.
- Reframed hook findings as passages to inspect. Detection thresholds and configuration precedence remain compatible.

### Added

- Bundled the `de-slopify` editing skill, its review references, and Codex metadata. The skill now ships under the same version as the plugin.
- Codex installation of the bundled skill, preserving existing personal copies and unrelated hooks.
- Regression coverage for advisory notices and skill installation.

### Fixed

- Validate existing Codex hook JSON before replacing installed files.

## [0.2.1] - 2026-09-16

- Removed the duplicate hook declaration from the Claude plugin manifest.

## [0.2.0] - 2026-09-16

- Added checks for the injected rules and support for Codex CLI transcripts and installation.

[0.3.0]: https://github.com/NovusEdge/readable-responses/releases/tag/v0.3.0
[0.2.1]: https://github.com/NovusEdge/readable-responses/releases/tag/v0.2.1
[0.2.0]: https://github.com/NovusEdge/readable-responses/releases/tag/v0.2.0
