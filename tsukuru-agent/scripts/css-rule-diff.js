const fs = require('node:fs');
const path = require('node:path');

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function findClosingBrace(source, openingIndex) {
  let depth = 1;
  let quote = '';
  let escaped = false;
  for (let index = openingIndex + 1; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return index;
  }
  throw new Error(`unclosed CSS block at offset ${openingIndex}`);
}

function splitOutside(source, delimiter) {
  const parts = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  let parentheses = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(') parentheses += 1;
    else if (character === ')') parentheses = Math.max(0, parentheses - 1);
    else if (character === delimiter && parentheses === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function normalizeWhitespace(value) {
  return value.trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*([,:>+~()])\s*/g, '$1');
}

function normalizeSelector(prelude) {
  return splitOutside(prelude, ',')
    .map(normalizeWhitespace)
    .filter(Boolean)
    .sort()
    .join(',');
}

function normalizeDeclarations(block) {
  return splitOutside(block, ';')
    .map((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon < 0) return normalizeWhitespace(declaration);
      const property = declaration.slice(0, colon).trim();
      const value = normalizeWhitespace(declaration.slice(colon + 1));
      return `${property}:${value}`;
    })
    .filter(Boolean)
    .sort()
    .join(';');
}

function parseCssRules(source) {
  const rules = new Map();
  const clean = stripComments(source);

  function visit(segment, context = '') {
    let cursor = 0;
    while (cursor < segment.length) {
      const opening = segment.indexOf('{', cursor);
      if (opening < 0) break;
      const prelude = segment.slice(cursor, opening).trim();
      const closing = findClosingBrace(segment, opening);
      const block = segment.slice(opening + 1, closing);
      cursor = closing + 1;
      if (!prelude) continue;

      if (/^@(media|supports|container|layer|keyframes|-webkit-keyframes)\b/i.test(prelude)) {
        const nestedContext = [context, normalizeWhitespace(prelude)].filter(Boolean).join(' :: ');
        visit(block, nestedContext);
        continue;
      }

      const selector = normalizeSelector(prelude);
      const key = context ? `${context} :: ${selector}` : selector;
      rules.set(key, normalizeDeclarations(block));
    }
  }

  visit(clean);
  return rules;
}

function compareCssRules(baselineSource, candidateSource) {
  const baseline = parseCssRules(baselineSource);
  const candidate = parseCssRules(candidateSource);
  const unmatchedBaseline = [...baseline.keys()].filter((key) => !candidate.has(key));
  const unmatchedCandidate = new Set([...candidate.keys()].filter((key) => !baseline.has(key)));
  const relocated = [];
  const missing = [];
  const terminalSelector = (key) => key.split(' :: ').at(-1);
  for (const baselineKey of unmatchedBaseline) {
    const candidateKey = [...unmatchedCandidate].find((key) =>
      terminalSelector(key) === terminalSelector(baselineKey)
      && candidate.get(key) === baseline.get(baselineKey));
    if (candidateKey) {
      unmatchedCandidate.delete(candidateKey);
      relocated.push(`${baselineKey} -> ${candidateKey}`);
    } else {
      missing.push(baselineKey);
    }
  }
  const added = [...unmatchedCandidate].sort();
  const changed = [...baseline.keys()]
    .filter((key) => candidate.has(key) && baseline.get(key) !== candidate.get(key))
    .sort();
  return { missing: missing.sort(), added, changed, relocated: relocated.sort() };
}

function cssFiles(root) {
  const stats = fs.statSync(root);
  if (stats.isFile()) return [root];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.name.endsWith('.css')) files.push(fullPath);
    }
  };
  visit(root);
  return files.sort();
}

function formatCategory(category, file, entries) {
  return entries.map((entry) => `${category} ${file}: ${entry}`);
}

function runCli(argv) {
  if (argv.length !== 2) throw new Error('usage: node scripts/css-rule-diff.js <baseline-file-or-dir> <candidate-file-or-dir>');
  const [baselineRoot, candidateRoot] = argv.map((value) => path.resolve(value));
  const baselineStats = fs.statSync(baselineRoot);
  const candidateStats = fs.statSync(candidateRoot);
  if (baselineStats.isFile() !== candidateStats.isFile()) throw new Error('baseline and candidate must both be files or both be directories');

  const totals = { missing: 0, added: 0, changed: 0, relocated: 0 };
  const lines = [];
  for (const baselineFile of cssFiles(baselineRoot)) {
    const relative = baselineStats.isFile() ? path.basename(baselineFile) : path.relative(baselineRoot, baselineFile);
    const candidateFile = candidateStats.isFile() ? candidateRoot : path.join(candidateRoot, relative);
    if (!fs.existsSync(candidateFile)) {
      totals.missing += 1;
      lines.push(`MISSING_FILE ${relative}`);
      continue;
    }
    const result = compareCssRules(fs.readFileSync(baselineFile, 'utf8'), fs.readFileSync(candidateFile, 'utf8'));
    for (const category of ['missing', 'added', 'changed', 'relocated']) {
      totals[category] += result[category].length;
      lines.push(...formatCategory(category.toUpperCase(), relative, result[category]));
    }
  }
  process.stdout.write(`${lines.join('\n')}${lines.length ? '\n' : ''}`);
  process.stdout.write(`MISSING=${totals.missing} ADDED=${totals.added} CHANGED=${totals.changed} RELOCATED=${totals.relocated}\n`);
  return totals.missing === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`CSS rule diff failed: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { compareCssRules, parseCssRules, runCli };
