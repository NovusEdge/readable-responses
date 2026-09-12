#!/usr/bin/env node
// Runs the hook as a subprocess so the test covers what Claude Code actually
// executes: stdin JSON in, injected context out.
//
// HOME points at an empty directory for every case except the last, which forces
// the built-in transcript reader. With the real HOME the result would depend on
// whether curt happens to be installed on the machine running the tests.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'inject.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'readable-responses-test-'));
const EMPTY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'readable-responses-home-'));

let failures = 0;

function run(stdin, { home = EMPTY_HOME } = {}) {
  return execFileSync('node', [HOOK], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

function transcript(name, entries) {
  const file = path.join(TMP, `${name}.jsonl`);
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

const turn = (prompt, reply) => [
  { type: 'user', message: { role: 'user', content: prompt } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
];

function assert(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${name}`);
  if (detail) console.log(detail.split('\n').map(l => `       ${l}`).join('\n'));
}

const WALL = [
  'The deployment pipeline currently builds the container image on every push to any branch,',
  'which means the registry fills with images nobody will ever pull, and the build minutes are',
  'spent on branches that get deleted within the hour, so the sensible change is to build only',
  'on the default branch and on tags, then let a scheduled job prune anything older than thirty',
  'days from the registry, because the storage cost is the part of the bill that grows without',
  'anyone noticing it until the quarter closes and somebody asks where the money went.',
].join(' ');

const CLEAN = [
  'The build runs on every branch. That fills the registry with images nobody pulls.',
  '',
  'Build on the default branch and on tags. Prune images older than thirty days.',
].join('\n');

const FENCED = [
  '```js',
  WALL.split(' ').map(w => `const ${w.replace(/\W/g, '')} = 1;`).join('\n'),
  '```',
].join('\n');

console.log('readable-responses');

{
  const file = transcript('wall', turn('why is the bill high', WALL));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('violating paragraph reports wall of text', out.includes('wall of text'), out);
  assert('report quotes the offending text', out.includes('The deployment pipeline currently'), out);
  assert('report names the limit', /over 70/.test(out), out);
  assert('directive is always present', out.startsWith('READABLE RESPONSE RULES.'), out);
}

{
  const file = transcript('clean', turn('why is the bill high', CLEAN));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('clean message reports nothing', !out.includes('READABILITY VIOLATED'), out);
  assert('clean message still gets the directive', out.includes('READABLE RESPONSE RULES.'), out);
}

{
  const out = run(JSON.stringify({ session_id: 'abc' }));
  assert('missing transcript_path emits the directive only', out.trim() === require('../hooks/check.js').DIRECTIVE, out);
}

{
  const out = run('not json at all {{{');
  assert('malformed stdin emits the directive only', out.trim() === require('../hooks/check.js').DIRECTIVE, out);
  const empty = run('');
  assert('empty stdin emits the directive only', empty.trim() === require('../hooks/check.js').DIRECTIVE, empty);
}

{
  const file = transcript('missing', turn('hi', CLEAN));
  const out = run(JSON.stringify({ transcript_path: path.join(TMP, 'nope.jsonl') }));
  assert('unreadable transcript emits the directive only', out.trim() === require('../hooks/check.js').DIRECTIVE, out);
  fs.unlinkSync(file);
}

{
  const file = transcript('fenced', turn('show me the code', FENCED));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('code fences produce no violations', !out.includes('READABILITY VIOLATED'), out);
}

{
  const file = transcript('longsentence', turn('explain', WALL.split('. ')[0] + '.'));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('long sentence is named separately', out.includes('long sentence'), out);
}

{
  const lines = Array.from({ length: 9 }, (_, i) => `Line ${i + 1} of an unbroken block of prose.`);
  const file = transcript('block', turn('explain', lines.join('\n')));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('unbroken block is named', out.includes('unbroken block'), out);
}

{
  const curtCheck = path.join(
    process.env.HOME || '',
    '.claude/plugins/marketplaces/curt/hooks/check.js'
  );
  if (fs.existsSync(curtCheck)) {
    const file = transcript('curt', turn('why is the bill high', WALL));
    const out = run(JSON.stringify({ transcript_path: file }), { home: process.env.HOME });
    assert('curt transcript reader reaches the same finding', out.includes('wall of text'), out);
  } else {
    console.log('  skip curt transcript reader (curt not installed)');
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
fs.rmSync(EMPTY_HOME, { recursive: true, force: true });

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
