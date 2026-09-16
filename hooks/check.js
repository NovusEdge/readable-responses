// Shape checker: paragraph length, sentence length, unbroken blocks. Word
// choice and cadence belong to the curt plugin, and duplicating its sets here
// would produce two reports for one fault.

const fs = require('fs');
const path = require('path');

const DEFAULTS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'limits.json'), 'utf8')
);
delete DEFAULTS._comment;

// An installed plugin lives in the marketplace cache, which the next update
// overwrites, so limits.json is defaults only. The project file wins over the
// user file, and both win over the defaults.
function loadLimits() {
  const codexHome =
    process.env.CODEX_HOME || path.join(process.env.HOME || '', '.codex');
  const sources = [
    path.join(codexHome, 'readable-responses.json'),
    path.join(process.env.HOME || '', '.claude', 'readable-responses.json'),
    path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.readable-responses.json'),
  ];
  const limits = { ...DEFAULTS };
  for (const file of sources) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof parsed[key] === 'number') limits[key] = parsed[key];
    }
  }
  return limits;
}

const LIMITS = loadLimits();

// The directive quotes the live numbers, so a tuned limits.json cannot leave the
// model working to a threshold the checker no longer enforces.
const DIRECTIVE = [
  'READABLE RESPONSE RULES. These apply to every reply this turn.',
  '- Lead with the answer. The first sentence carries the finding.',
  `- Keep a paragraph under ${LIMITS.paragraphWords} words. Break a longer one in two.`,
  `- Keep a sentence under ${LIMITS.sentenceWords} words.`,
  '- Compare three or more things in a table, never in prose.',
  `- Break a block longer than ${LIMITS.blockLines} lines with a list, a table, or a blank line.`,
].join('\n');

// curt already solves transcript parsing: one turn spans many assistant
// entries, tool results are user entries that carry no prose, and a long
// transcript must be read from the tail. Reuse it when it is installed.
function loadCurt() {
  const candidates = [
    path.join(process.env.HOME || '', '.claude/plugins/marketplaces/curt/hooks/check.js'),
    path.join(process.env.HOME || '', '.claude/plugins/marketplaces/anti-slop/hooks/check.js'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const mod = require(file);
      if (typeof mod.lastTurn === 'function' && typeof mod.prosify === 'function') {
        return mod;
      }
    } catch {
      // A plugin update can change the exports. Fall through to the local reader.
    }
  }
  return null;
}

const TAIL_BYTES = 256 * 1024;

function readTail(file) {
  const size = fs.statSync(file).size;
  if (size <= TAIL_BYTES) return fs.readFileSync(file, 'utf8');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(TAIL_BYTES);
    fs.readSync(fd, buf, 0, TAIL_BYTES, size - TAIL_BYTES);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

const TEXT_BLOCKS = new Set(['text', 'output_text', 'input_text']);

// Claude Code writes {type, message:{role, content}}. Codex writes a rollout
// file where the message hides under payload and shares the response_item type
// with reasoning and tool calls. Returns null for any line that carries no
// prose.
function messageOf(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (entry.isMeta) return null;
  if (entry.payload) {
    const p = entry.payload;
    if (entry.type !== 'response_item' || p.type !== 'message') return null;
    return { role: p.role, content: p.content };
  }
  if (entry.toolUseResult !== undefined) return null;
  return { role: entry.type, content: entry.message && entry.message.content };
}

function fallbackLastTurn(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return { assistant: null };
  const lines = readTail(transcriptPath).trim().split('\n');
  const texts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const message = messageOf(lines[i]);
    if (!message) continue;
    const content = message.content;
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      if (content.some(b => b.type === 'tool_result')) continue;
      text = content.filter(b => TEXT_BLOCKS.has(b.type)).map(b => b.text).join('\n');
    }
    text = (text || '').trim();
    // The boundary is the user entry itself. A Codex user message carries
    // input_text blocks, so testing the extracted prose would walk past it.
    if (message.role === 'user') {
      if (texts.length) break;
      continue;
    }
    if (text && message.role === 'assistant') texts.unshift(text);
  }
  return { assistant: texts.join('\n\n') || null };
}

function fallbackProsify(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .split('\n')
    .filter(l => !l.trimStart().startsWith('>'))
    .join('\n');
}

// The prose of the previous assistant turn, code and quotes removed.
function previousProse(transcriptPath) {
  const curt = loadCurt();
  // curt reads the Claude Code schema only, so a Codex rollout comes back empty
  // and the built-in reader has to take over.
  let turn = curt ? curt.lastTurn(transcriptPath) : null;
  if (!turn || !turn.assistant) turn = fallbackLastTurn(transcriptPath);
  if (!turn || !turn.assistant) return null;
  return curt ? curt.prosify(turn.assistant) : fallbackProsify(turn.assistant);
}

const words = s => s.split(/\s+/).filter(Boolean).length;
const clip = s => (s.length > 90 ? s.slice(0, 87) + '...' : s);

// A structural line carries its own visual break, so it never counts toward a
// paragraph or an unbroken block.
const isStructural = line => /^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|\||---)/.test(line);

function paragraphs(prose) {
  return prose
    .split(/\n{2,}/)
    .map(block => block.split('\n').filter(l => l.trim() && !isStructural(l)).join(' '))
    .map(block => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// A trailing abbreviation ends in a period and is followed by a capital, so
// without the lookbehind "e.g. The" splits one long sentence into two short
// ones and the violation goes unreported.
const ABBREVIATIONS = /(?<!\b(?:e\.g|i\.e|etc|vs|cf|al|approx|Dr|Mr|Mrs|Ms|Prof|Fig)\.)/;

const SENTENCE_BREAK = new RegExp(
  `(?<=[.!?])${ABBREVIATIONS.source}\\s+(?=[A-Z"'(—])`
);

function sentencesOf(paragraph) {
  return paragraph
    .split(SENTENCE_BREAK)
    .map(s => s.trim())
    .filter(Boolean);
}

// Openers that spend the first sentence on intent instead of the finding.
const PREAMBLE = /^(?:let(?:'s| me)\b|i'?ll\b|i will\b|i'?m going to\b|here'?s what\b|sure[,.!]|great[,.!]|first,|to start\b|looking at\b|based on\b)/i;

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

// A short label followed by its value: one row of a table someone wrote as prose.
const LABELLED = /^[^:\n]{1,40}:\s+\S/;

function longSentences(text) {
  return sentencesOf(text)
    .map(sentence => ({ sentence, length: words(sentence) }))
    .filter(({ length }) => length > LIMITS.sentenceWords)
    .map(({ sentence, length }) => ({
      rule: 'long sentence',
      detail: `${length} words (over ${LIMITS.sentenceWords})`,
      text: clip(sentence),
    }));
}

function check(prose) {
  const found = [];

  const opening = paragraphs(prose)[0];
  if (opening && PREAMBLE.test(sentencesOf(opening)[0])) {
    found.push({
      rule: 'buried lead',
      detail: 'the first sentence states intent, not the finding',
      text: clip(sentencesOf(opening)[0]),
    });
  }

  for (const line of prose.split('\n')) {
    const match = line.match(LIST_ITEM);
    if (!match) continue;
    const item = match[1].replace(/\s+/g, ' ').trim();
    if (!item) continue;
    const count = words(item);
    if (count > LIMITS.paragraphWords) {
      found.push({
        rule: 'long list item',
        detail: `${count} words in one list item (over ${LIMITS.paragraphWords})`,
        text: clip(item),
      });
    }
    found.push(...longSentences(item));
  }

  let labelled = [];
  for (const line of prose.split('\n').concat([''])) {
    const text = line.trim();
    if (text && !isStructural(line) && LABELLED.test(text)) {
      labelled.push(text);
      continue;
    }
    if (labelled.length >= 3) {
      found.push({
        rule: 'prose table',
        detail: `${labelled.length} labelled lines in a row (use a table)`,
        text: clip(labelled[0]),
      });
    }
    labelled = [];
  }

  for (const paragraph of paragraphs(prose)) {
    const count = words(paragraph);
    if (count > LIMITS.paragraphWords) {
      found.push({
        rule: 'wall of text',
        detail: `${count} words in one paragraph (over ${LIMITS.paragraphWords})`,
        text: clip(paragraph),
      });
    }
    found.push(...longSentences(paragraph));
  }

  let run = [];
  for (const line of prose.split('\n').concat([''])) {
    if (line.trim() && !isStructural(line)) {
      run.push(line);
      continue;
    }
    if (run.length > LIMITS.blockLines) {
      found.push({
        rule: 'unbroken block',
        detail: `${run.length} prose lines with no break (over ${LIMITS.blockLines})`,
        text: clip(run[0].trim()),
      });
    }
    run = [];
  }

  const seen = new Set();
  return found.filter(v => {
    const key = `${v.rule}:${v.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { LIMITS, DIRECTIVE, check, previousProse, loadCurt };
