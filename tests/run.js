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
const REAL_HOME = process.env.HOME;

// The in-process require of check.js below resolves config the same way the
// subprocess does, so both must see the same empty HOME and project directory.
process.env.HOME = EMPTY_HOME;
process.env.CLAUDE_PROJECT_DIR = EMPTY_HOME;
process.env.CODEX_HOME = EMPTY_HOME;

let failures = 0;

function run(stdin, { home = EMPTY_HOME, projectDir = EMPTY_HOME, args = [] } = {}) {
  return execFileSync('node', [HOOK, ...args], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: projectDir },
  });
}

function codexInstall(codexHome) {
  return execFileSync('python3', [path.join(__dirname, '..', 'install.py'), '--codex'], {
    encoding: 'utf8',
    env: { ...process.env, CODEX_HOME: codexHome },
  });
}

// A config source the hook should find. Returns the directory to point at.
function configDir(name, { userConfig, projectConfig } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `readable-responses-${name}-`));
  if (userConfig) {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'readable-responses.json'),
      JSON.stringify(userConfig)
    );
  }
  if (projectConfig) {
    fs.writeFileSync(
      path.join(dir, '.readable-responses.json'),
      JSON.stringify(projectConfig)
    );
  }
  return dir;
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

// A Codex rollout file. The message sits under payload, the assistant block is
// output_text, and tool traffic shares the response_item type.
const codexTurn = (prompt, reply) => [
  { type: 'session_meta', payload: { id: 'session' } },
  {
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] },
  },
  { type: 'response_item', payload: { type: 'reasoning', summary: [] } },
  { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}' } },
  {
    type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] },
  },
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
  const reply = 'Let me walk through the build. It runs on every branch.';
  const file = transcript('lead', turn('why is the bill high', reply));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('preamble opener reports buried lead', out.includes('buried lead'), out);
}

{
  const file = transcript('answerfirst', turn('why is the bill high', CLEAN));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('answer-first opener is not a buried lead', !out.includes('buried lead'), out);
}

{
  const reply = [
    'Build: runs on every push to every branch.',
    'Registry: fills with images nobody pulls.',
    'Storage: grows until the quarter closes.',
  ].join('\n');
  const file = transcript('prosetable', turn('compare these', reply));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('three labelled prose lines report prose table', out.includes('prose table'), out);
}

{
  const reply = ['Build: runs on every push.', 'Registry: fills up.'].join('\n');
  const file = transcript('twolabels', turn('compare these', reply));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('two labelled lines are not a prose table', !out.includes('prose table'), out);
}

{
  const reply = '- ' + WALL;
  const file = transcript('longbullet', turn('explain', reply));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('an overlong bullet reports long list item', out.includes('long list item'), out);
}

// The splitter used to cut this in two at "e.g. The", and neither half passed
// the sentence limit, so the violation went unreported.
{
  const reply = [
    'The cache layer should sit in front of the primary database for every read path',
    'that tolerates staleness, e.g. The dashboard counters, the leaderboard, and the',
    'search suggestions, all of which refresh on a timer anyway today.',
  ].join(' ');
  const file = transcript('abbrev', turn('explain', reply));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('an abbreviation does not end a sentence', out.includes('long sentence'), out);
}

{
  const home = configDir('userhome', { userConfig: { paragraphWords: 12 } });
  const file = transcript('userlimit', turn('why is the bill high', CLEAN));
  const out = run(JSON.stringify({ transcript_path: file }), { home });
  assert('user config lowers the paragraph limit', out.includes('over 12'), out);
  assert('directive quotes the user config', out.includes('under 12 words'), out);
  fs.rmSync(home, { recursive: true, force: true });
}

{
  const home = configDir('bothhome', { userConfig: { paragraphWords: 12 } });
  const project = configDir('bothproject', { projectConfig: { paragraphWords: 9 } });
  const file = transcript('projectlimit', turn('why is the bill high', CLEAN));
  const out = run(JSON.stringify({ transcript_path: file }), { home, projectDir: project });
  assert('project config beats user config', out.includes('under 9 words'), out);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
}

{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'readable-responses-badcfg-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'readable-responses.json'), '{ broken');
  const out = run(JSON.stringify({ session_id: 'abc' }), { home });
  assert('malformed config falls back to the defaults', out.includes('under 70 words'), out);
  fs.rmSync(home, { recursive: true, force: true });
}

{
  const file = transcript('codex', codexTurn('why is the bill high', WALL));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('codex rollout reaches the same finding', out.includes('wall of text'), out);
  assert('codex tool traffic is skipped', out.includes('The deployment pipeline currently'), out);
}

{
  const file = transcript('codexclean', codexTurn('why is the bill high', CLEAN));
  const out = run(JSON.stringify({ transcript_path: file }));
  assert('codex clean turn reports nothing', !out.includes('READABILITY VIOLATED'), out);
}

{
  const file = transcript('codexjson', codexTurn('why is the bill high', WALL));
  const out = run(JSON.stringify({ transcript_path: file }), { args: ['--codex'] });
  let parsed = null;
  try {
    parsed = JSON.parse(out);
  } catch {
    parsed = null;
  }
  assert('--codex emits JSON', parsed !== null, out);
  const specific = (parsed && parsed.hookSpecificOutput) || {};
  assert('--codex names the event', specific.hookEventName === 'UserPromptSubmit', out);
  assert(
    '--codex carries the report as additionalContext',
    typeof specific.additionalContext === 'string' && specific.additionalContext.includes('wall of text'),
    out
  );
}

{
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'readable-responses-codexhome-'));
  const existing = {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'true', timeout: 30 }] }],
    },
  };
  fs.writeFileSync(path.join(codexHome, 'hooks.json'), JSON.stringify(existing));
  codexInstall(codexHome);
  const merged = JSON.parse(fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'));
  assert('codex install keeps existing hooks', Array.isArray(merged.hooks.Stop), JSON.stringify(merged));
  const entries = merged.hooks.UserPromptSubmit || [];
  const commands = JSON.stringify(entries);
  assert('codex install registers UserPromptSubmit', entries.length === 1, commands);
  assert('codex install passes --codex', commands.includes('--codex'), commands);
  assert(
    'codex install copies the hook next to the config',
    fs.existsSync(path.join(codexHome, 'readable-responses', 'hooks', 'inject.js')),
    commands
  );

  codexInstall(codexHome);
  const again = JSON.parse(fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'));
  assert(
    'a second install does not duplicate the entry',
    again.hooks.UserPromptSubmit.length === 1,
    JSON.stringify(again.hooks.UserPromptSubmit)
  );
  fs.rmSync(codexHome, { recursive: true, force: true });
}

{
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'readable-responses-codexcfg-'));
  fs.writeFileSync(
    path.join(codexHome, 'readable-responses.json'),
    JSON.stringify({ sentenceWords: 8 })
  );
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ session_id: 'abc' }),
    encoding: 'utf8',
    env: { ...process.env, HOME: EMPTY_HOME, CLAUDE_PROJECT_DIR: EMPTY_HOME, CODEX_HOME: codexHome },
  });
  assert('CODEX_HOME config is read', out.includes('under 8 words'), out);
  fs.rmSync(codexHome, { recursive: true, force: true });
}

{
  const curtCheck = path.join(
    REAL_HOME || '',
    '.claude/plugins/marketplaces/curt/hooks/check.js'
  );
  if (fs.existsSync(curtCheck)) {
    const file = transcript('curt', turn('why is the bill high', WALL));
    const out = run(JSON.stringify({ transcript_path: file }), { home: REAL_HOME });
    assert('curt transcript reader reaches the same finding', out.includes('wall of text'), out);
  } else {
    console.log('  skip curt transcript reader (curt not installed)');
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
fs.rmSync(EMPTY_HOME, { recursive: true, force: true });

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
