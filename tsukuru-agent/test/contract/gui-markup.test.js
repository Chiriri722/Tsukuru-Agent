const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const pagePaths = [
  'src/html/main/index.html',
  'src/html/simple/index.html',
  'src/html/wolf/index.html',
  'src/html/config/settings.html',
];

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

function openingTags(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))].map((match) => match[0]);
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? '';
}

function classTokens(tag) {
  return attribute(tag, 'class').split(/\s+/).filter(Boolean);
}

test('interactive GUI pages declare their language, CSP, and current product title', () => {
  for (const relativePath of pagePaths) {
    const html = read(relativePath);
    assert.match(html, /<html\b[^>]*\blang=["'][a-z-]+["']/i, relativePath);
    assert.match(html, /http-equiv=["']Content-Security-Policy["']/i, relativePath);
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc=["']https?:\/\//i, relativePath);
    assert.match(html, /<title>[^<]*Tsukuru Agent[^<]*<\/title>/i, relativePath);
  }
});

test('click targets use semantic buttons and obsolete placeholder controls are absent', () => {
  const interactiveDivClasses = new Set(['btn', 'btnx', 'runbtn', 'box', 'box2']);
  for (const relativePath of pagePaths.slice(0, 3)) {
    const html = read(relativePath);
    for (const tag of openingTags(html, 'div')) {
      const offending = classTokens(tag).find((token) => interactiveDivClasses.has(token));
      assert.equal(offending, undefined, `${relativePath}: clickable <div> class ${offending}`);
      assert.equal(attribute(tag, 'btn-val'), '', `${relativePath}: clickable <div btn-val>`);
    }
    assert.doesNotMatch(html, /<(?:button|div)\b[^>]*class=["'][^"']*\bbtn\b[^"']*["'][^>]*>\s*<\/(?:button|div)>/i, relativePath);
    assert.doesNotMatch(html, /<h(?:\s|>)/i, relativePath);
  }
});

test('every GUI button has an accessible text label', () => {
  for (const relativePath of pagePaths) {
    const html = read(relativePath);
    const buttons = [...html.matchAll(/<button\b(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/button>/gi)];
    assert.ok(buttons.length > 0, `${relativePath}: expected at least one button`);
    for (const button of buttons) {
      const attributes = button.groups.attributes;
      const visibleText = button.groups.body.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim();
      const accessibleName = visibleText
        || attribute(`<button ${attributes}>`, 'aria-label')
        || attribute(`<button ${attributes}>`, 'enlang');
      assert.ok(accessibleName, `${relativePath}: unlabeled ${button[0]}`);
    }
  }
});

test('settings checkboxes are wrapped by labels without sacrificing localized text nodes', () => {
  const html = read('src/html/config/settings.html');
  const checkboxIds = openingTags(html, 'input')
    .filter((tag) => attribute(tag, 'type').toLowerCase() === 'checkbox')
    .map((tag) => attribute(tag, 'id'));
  const labelBlocks = [...html.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)].map((match) => match[0]);
  const labeledIds = new Set(labelBlocks.flatMap((label) => openingTags(label, 'input').map((tag) => attribute(tag, 'id'))));

  assert.ok(checkboxIds.length > 0);
  assert.deepEqual([...labeledIds].sort(), checkboxIds.sort());
  assert.ok((html.match(/\benlang=/gi) || []).length >= checkboxIds.length);
  assert.doesNotMatch(html, /<label\b[^>]*\benlang=/i, 'enlang belongs on a child span so translation cannot remove the input');
});
