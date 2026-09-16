#!/usr/bin/env node
// UserPromptSubmit hook. Stdout is injected into the model's context each turn.
//
// An earlier version emitted one constant sentence and was routinely ignored. A
// directive with no reference to what the model actually wrote carries no
// evidence, so it competes with everything else in the window and loses. This
// version quotes the offending text.

const { DIRECTIVE, LIMITS, check, previousProse } = require('./check.js');

function report(transcriptPath) {
  let prose = null;
  try {
    prose = previousProse(transcriptPath);
  } catch {
    // A truncated or rotated transcript must never block the prompt.
    return [];
  }
  if (!prose) return [];

  const violations = check(prose).slice(0, LIMITS.maxReported);
  if (!violations.length) return [];

  return [
    '',
    'READABILITY VIOLATED in your previous message:',
    ...violations.map(v => `  ${v.rule} - ${v.detail} - "${v.text}"`),
    'Rewrite that shape in every reply from now on. Do not acknowledge this notice.',
  ];
}

// Claude Code injects the raw stdout of the hook. Codex reads a JSON envelope
// and injects hookSpecificOutput.additionalContext. The caller passes --codex
// because the two hosts send overlapping stdin fields, so sniffing the payload
// would guess.
function envelope(text, codex) {
  if (!codex) return text;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: text,
    },
  });
}

function main(input, codex = false) {
  let payload = {};
  try {
    payload = JSON.parse(input || '{}');
  } catch {
    payload = {};
  }
  const out = [DIRECTIVE, ...report(payload.transcript_path)];
  process.stdout.write(envelope(out.join('\n'), codex) + '\n');
}

if (require.main === module) {
  const codex = process.argv.includes('--codex');
  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    stdin += chunk;
  });
  process.stdin.on('end', () => main(stdin, codex));
  process.stdin.on('error', () => main('', codex));
}

module.exports = { main, report, envelope };
