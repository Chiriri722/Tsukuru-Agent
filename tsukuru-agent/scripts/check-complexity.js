const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node);
}

function nodeName(node, sourceFile) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (node.name) return node.name.getText(sourceFile);
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  if (ts.isPropertyAssignment(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  return `<anonymous@${line}>`;
}

function decisionWeight(node) {
  if (ts.isIfStatement(node)
    || ts.isConditionalExpression(node)
    || ts.isForStatement(node)
    || ts.isForInStatement(node)
    || ts.isForOfStatement(node)
    || ts.isWhileStatement(node)
    || ts.isDoStatement(node)
    || ts.isCaseClause(node)
    || ts.isCatchClause(node)) return 1;
  if (ts.isBinaryExpression(node) && [
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken,
  ].includes(node.operatorToken.kind)) return 1;
  return 0;
}

function functionComplexity(node) {
  let complexity = 1;
  const visit = (child) => {
    if (child !== node && isFunctionLike(child)) return;
    complexity += decisionWeight(child);
    ts.forEachChild(child, visit);
  };
  if (node.body) visit(node.body);
  return complexity;
}

function analyzeTypeScript(source, filePath = 'source.ts') {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = [];
  const discover = (node) => {
    if (isFunctionLike(node)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      functions.push({
        file: filePath.replaceAll('\\', '/'),
        name: nodeName(node, sourceFile),
        line: position.line + 1,
        complexity: functionComplexity(node),
      });
    }
    ts.forEachChild(node, discover);
  };
  discover(sourceFile);
  return functions;
}

function sourceFiles() {
  const files = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(fullPath);
    }
  };
  visit(path.join(appRoot, 'src'));
  for (const name of ['main.ts', 'main_update.ts']) {
    const fullPath = path.join(appRoot, name);
    if (fs.existsSync(fullPath)) files.push(fullPath);
  }
  return files.sort();
}

function collectComplexityIssues({ maxComplexity = 40, files = sourceFiles() } = {}) {
  const issues = [];
  for (const filePath of files) {
    const relative = path.relative(appRoot, filePath).replaceAll('\\', '/');
    for (const entry of analyzeTypeScript(fs.readFileSync(filePath, 'utf8'), relative)) {
      if (entry.complexity > maxComplexity) issues.push(entry);
    }
  }
  return issues.sort((left, right) =>
    right.complexity - left.complexity
    || left.file.localeCompare(right.file)
    || left.line - right.line);
}

function checkComplexity(options) {
  const issues = collectComplexityIssues(options);
  if (issues.length > 0) {
    throw new Error(issues.map((entry) =>
      `${entry.file}:${entry.line} ${entry.name} complexity=${entry.complexity}`).join('\n'));
  }
}

if (require.main === module) {
  try {
    checkComplexity();
    process.stdout.write('complexity check OK: all TypeScript functions <= 40\n');
  } catch (error) {
    process.stderr.write(`complexity check failed:\n${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  analyzeTypeScript,
  checkComplexity,
  collectComplexityIssues,
  functionComplexity,
  sourceFiles,
};
