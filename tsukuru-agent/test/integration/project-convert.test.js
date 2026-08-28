const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

let selectedDestination;
const electronMock = {
  app: { getPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-project-temp-')) },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [selectedDestination] }),
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};
const { ConvertProject } = require('../../.build/app/src/js/rpgmv/projectConvert.js');
const projectTools = require('../../.build/app/src/js/libs/projectTools.js').default;
Module._load = originalLoad;

function setupProject() {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-project-source-'));
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-project-destination-'));
  const selection = path.join(source, 'Game.exe');
  fs.writeFileSync(selection, 'launcher');
  selectedDestination = destination;
  const messages = [];
  global.mwindow = {
    webContents: { send: (...args) => messages.push(args) },
  };
  projectTools.init();
  return { source, destination, selection, messages };
}

function outputDirectories(destination) {
  return fs.readdirSync(destination, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(destination, entry.name));
}

test('project conversion copies extensionless project files', async () => {
  const { source, destination, selection } = setupProject();
  fs.writeFileSync(path.join(source, 'README'), 'extensionless');

  await ConvertProject(selection);

  const outputs = outputDirectories(destination);
  assert.equal(outputs.length, 1);
  assert.equal(fs.readFileSync(path.join(outputs[0], 'README'), 'utf8'), 'extensionless');
});

test('project conversion does not write diagnostics directly to process stdout', async () => {
  const { destination, selection } = setupProject();
  const directOutput = [];
  const originalLog = console.log;
  try {
    console.log = (...args) => directOutput.push(args);
    await ConvertProject(selection);
  } finally {
    console.log = originalLog;
  }

  assert.equal(outputDirectories(destination).length, 1);
  assert.deepEqual(directOutput, []);
});

test('project conversion rejects a source directory junction without leaving partial output', async (t) => {
  const { source, destination, selection, messages } = setupProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-project-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
  try {
    fs.symlinkSync(outside, path.join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      t.skip(`junction creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  await ConvertProject(selection);

  assert.deepEqual(outputDirectories(destination), []);
  assert.ok(messages.some(([channel, payload]) => channel === 'alert'
    && payload?.icon === 'error'
    && /symbolic link|junction/i.test(payload.message)));
});

test('project conversion rolls back copied output when post-copy validation fails', async () => {
  const { source, destination, selection, messages } = setupProject();
  fs.mkdirSync(path.join(source, 'js'));
  fs.writeFileSync(path.join(source, 'js', 'plugins.js'), 'var $plugins = definitely-not-json;');

  await ConvertProject(selection);

  assert.deepEqual(outputDirectories(destination), []);
  assert.ok(messages.some(([channel, payload]) => channel === 'alert' && payload?.icon === 'error'));
});

test('project conversion rejects a directory passed as the selected game executable', async () => {
  const { source, destination, messages } = setupProject();
  const selectedDirectory = path.join(source, 'selected-directory');
  fs.mkdirSync(selectedDirectory);

  await ConvertProject(selectedDirectory);

  assert.deepEqual(outputDirectories(destination), []);
  assert.ok(messages.some(([channel, payload]) => channel === 'alert' && payload?.icon === 'error'));
});

test('project conversion rejects a destination inside the source tree', async () => {
  const { source, selection, messages } = setupProject();
  selectedDestination = source;

  await ConvertProject(selection);

  assert.equal(
    fs.readdirSync(source, { withFileTypes: true }).some((entry) => entry.isDirectory() && entry.name.startsWith('Project')),
    false,
  );
  assert.ok(messages.some(([channel, payload]) => channel === 'alert' && payload?.icon === 'error'));
});
