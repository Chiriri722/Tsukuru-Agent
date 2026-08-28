const fs = require('node:fs');
const path = require('node:path');
const sass = require('sass');

const appRoot = path.resolve(__dirname, '..');
const STYLE_PAIRS = [
  ['src/html/main/styles/main.scss', 'src/html/main/styles/main.css'],
  ['src/html/simple/back.scss', 'src/html/simple/back.css'],
  ['src/html/wolf/back.scss', 'src/html/wolf/back.css'],
].map(([scss, css]) => ({
  scssPath: path.join(appRoot, scss),
  cssPath: path.join(appRoot, css),
}));

function compileStyle(scssPath) {
  return `${sass.compile(scssPath, { style: 'expanded' }).css}\n`;
}

function normalizeLineEndings(text) {
  return text.replace(/\r\n?/g, '\n');
}

function collectStyleDriftIssues(pairs = STYLE_PAIRS) {
  const issues = [];
  for (const { scssPath, cssPath } of pairs) {
    if (!fs.existsSync(scssPath) || !fs.existsSync(cssPath)) {
      issues.push(cssPath);
      continue;
    }
    const generated = compileStyle(scssPath);
    const tracked = fs.readFileSync(cssPath, 'utf8');
    if (normalizeLineEndings(generated) !== normalizeLineEndings(tracked)) issues.push(cssPath);
  }
  return issues.sort();
}

function checkStyleDrift() {
  const issues = collectStyleDriftIssues();
  if (issues.length > 0) {
    throw new Error(issues.map((file) => `stale generated CSS: ${path.relative(appRoot, file)}`).join('\n'));
  }
  return STYLE_PAIRS.length;
}

if (require.main === module) {
  try {
    const count = checkStyleDrift();
    process.stdout.write(`style artifact check OK: ${count} SCSS/CSS pairs\n`);
  } catch (error) {
    process.stderr.write(`style artifact check failed:\n${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { STYLE_PAIRS, checkStyleDrift, collectStyleDriftIssues, compileStyle, normalizeLineEndings };
