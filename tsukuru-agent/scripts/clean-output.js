const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const allowedOutputs = new Set(['dist', 'dist-cli']);

function resolveOutputDirectory(name) {
  if (!allowedOutputs.has(name)) {
    throw new Error(`unsupported output directory: ${name}`);
  }
  return path.join(appRoot, name);
}

function cleanOutput(name) {
  fs.rmSync(resolveOutputDirectory(name), { recursive: true, force: true });
}

if (require.main === module) {
  try {
    cleanOutput(process.argv[2]);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { cleanOutput, resolveOutputDirectory };
