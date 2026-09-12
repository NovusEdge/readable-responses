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

function main(input) {
  let payload = {};
  try {
    payload = JSON.parse(input || '{}');
  } catch {
    payload = {};
  }
  const out = [DIRECTIVE, ...report(payload.transcript_path)];
  process.stdout.write(out.join('\n') + '\n');
}

if (require.main === module) {
  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    stdin += chunk;
  });
  process.stdin.on('end', () => main(stdin));
  process.stdin.on('error', () => main(''));
}

module.exports = { main, report };
