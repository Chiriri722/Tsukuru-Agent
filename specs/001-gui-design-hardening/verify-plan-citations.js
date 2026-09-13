// Verifies every `file:line` citation in the Task-plan points at a real line.
// Usage: node verify-plan-citations.js
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const APP = path.join(REPO, 'tsukuru-agent');
const PLAN = path.join(__dirname, 'tasks.md');

// Maps a bare filename / partial path used in the plan to its real location.
const RESOLVE = {
  'main.ts': 'main.ts',
  'main.scss': 'src/html/main/styles/main.scss',
  'main.css': 'src/html/main/styles/main.css',
  'styles.ts': 'src/js/rpgmv/styles.ts',
  'renderer.ts': 'src/html/main/renderer.ts',
  'enlang.js': 'src/lib/enlang/enlang.js',
  'wolf/back.css': 'src/html/wolf/back.css',
  'wolf/back.scss': 'src/html/wolf/back.scss',
  'wolf/rend.ts': 'src/html/wolf/rend.ts',
  'simple/rend.ts': 'src/html/simple/rend.ts',
  'config/script.ts': 'src/html/config/script.ts',
  'wolf/index.html': 'src/html/wolf/index.html',
  'main/index.html': 'src/html/main/index.html',
  'simple/index.html': 'src/html/simple/index.html',
  'config/settings.html': 'src/html/config/settings.html',
  'settings.html': 'src/html/config/settings.html',
  'src/js/libs/papagotrans.ts': 'src/js/libs/papagotrans.ts',
  'src/js/rpgmv/styles.ts': 'src/js/rpgmv/styles.ts',
  'src/lib/enlang/enlang.js': 'src/lib/enlang/enlang.js',
  'src/html/simple/index.html': 'src/html/simple/index.html',
  'src/html/wolf/index.html': 'src/html/wolf/index.html',
  'src/html/main/index.html': 'src/html/main/index.html',
  'wolf': 'src/html/wolf/index.html',
  'simple': 'src/html/simple/index.html',
};

const plan = fs.readFileSync(PLAN, 'utf8');
const lineCache = new Map();
function lineCount(rel) {
  if (!lineCache.has(rel)) {
    const abs = path.join(APP, rel);
    if (!fs.existsSync(abs)) { lineCache.set(rel, -1); }
    else { lineCache.set(rel, fs.readFileSync(abs, 'utf8').split('\n').length); }
  }
  return lineCache.get(rel);
}

// `name:12` or `name:12-34` or `name:12,34`
const re = /`?([A-Za-z0-9_./-]+\.(?:ts|js|scss|css|html)):(\d+(?:[-,]\d+)*)`?/g;
const results = [];
let m;
while ((m = re.exec(plan)) !== null) {
  const [full, file, spec] = m;
  const rel = RESOLVE[file];
  if (!rel) { results.push(['UNMAPPED', full, '']); continue; }
  const total = lineCount(rel);
  if (total < 0) { results.push(['NOFILE', full, rel]); continue; }
  const nums = spec.split(/[-,]/).map(Number);
  const bad = nums.filter((n) => n < 1 || n > total);
  results.push([bad.length ? 'OUT_OF_RANGE' : 'OK', full, `${rel} (${total} lines)`]);
}

const bad = results.filter((r) => r[0] !== 'OK');
console.log(`citations checked: ${results.length}`);
console.log(`resolved in range: ${results.length - bad.length}`);
console.log(`problems:          ${bad.length}`);
for (const [status, full, rel] of bad) console.log(`  ${status}  ${full}  ${rel}`);
process.exit(bad.length ? 1 : 0);
