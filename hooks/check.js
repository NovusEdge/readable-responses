// Shape checker: paragraph length, sentence length, unbroken blocks. Word
// choice and cadence belong to the curt plugin, and duplicating its sets here
// would produce two reports for one fault.

const fs = require('fs');
const path = require('path');

const LIMITS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'limits.json'), 'utf8')
);

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

function fallbackLastTurn(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return { assistant: null };
  const lines = readTail(transcriptPath).trim().split('\n');
  const texts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.isMeta || entry.toolUseResult !== undefined) continue;
    const content = entry.message && entry.message.content;
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      if (content.some(b => b.type === 'tool_result')) continue;
      text = content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }
    text = (text || '').trim();
    if (!text) continue;
    if (entry.type === 'assistant') texts.unshift(text);
    else if (entry.type === 'user' && texts.length) break;
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
  const turn = curt ? curt.lastTurn(transcriptPath) : fallbackLastTurn(transcriptPath);
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

function sentencesOf(paragraph) {
  return paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z"'(—])/)
    .map(s => s.trim())
    .filter(Boolean);
}

function check(prose) {
  const found = [];

  for (const paragraph of paragraphs(prose)) {
    const count = words(paragraph);
    if (count > LIMITS.paragraphWords) {
      found.push({
        rule: 'wall of text',
        detail: `${count} words in one paragraph (over ${LIMITS.paragraphWords})`,
        text: clip(paragraph),
      });
    }
    for (const sentence of sentencesOf(paragraph)) {
      const length = words(sentence);
      if (length > LIMITS.sentenceWords) {
        found.push({
          rule: 'long sentence',
          detail: `${length} words (over ${LIMITS.sentenceWords})`,
          text: clip(sentence),
        });
      }
    }
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
