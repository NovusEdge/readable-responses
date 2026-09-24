#!/usr/bin/env node
// UserPromptSubmit hook. Stdout is injected into the model's context each turn.

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

  const findings = check(prose).slice(0, LIMITS.maxReported);
  if (!findings.length) return [];

  return [
    '',
    'READABILITY REVIEW for your previous message:',
    ...findings.map(v => `  ${v.rule} - ${v.detail} - "${v.text}"`),
    'Inspect these passages in context. Change only what improves clarity while preserving meaning and the user\'s requested format. No automatic rewrite or reply to this notice is needed.',
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
