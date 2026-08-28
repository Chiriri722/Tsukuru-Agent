const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const appRoot = path.resolve(__dirname, '..', '..');
const stageRoot = path.join(appRoot, '.build', 'app');

function withElectronMock(electronMock, callback) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electronMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return callback();
  } finally {
    Module._load = originalLoad;
  }
}

function freshRequire(relativePath) {
  const absolutePath = path.join(stageRoot, relativePath);
  delete require.cache[require.resolve(absolutePath)];
  return require(absolutePath);
}

function loadPreload() {
  const exposed = {};
  const sent = [];
  const invoked = [];
  const listeners = new Map();
  const ipcRenderer = {
    send(channel, payload) {
      sent.push({ channel, payload });
    },
    invoke(channel, payload) {
      invoked.push({ channel, payload });
      return Promise.resolve({ ok: true });
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
  };
  withElectronMock({
    contextBridge: {
      exposeInMainWorld(name, api) {
        exposed[name] = api;
      },
    },
    ipcRenderer,
  }, () => freshRequire('src/electron/preload.js'));
  return { api: exposed.tsukuru, sent, invoked, listeners };
}

test('preload exposes the complete allowlisted IPC contract', async () => {
  const policy = freshRequire('src/electron/ipcPolicy.js');
  const { api, sent, invoked, listeners } = loadPreload();
  assert.ok(api);

  for (const channel of policy.rendererToMainChannels) {
    api.send(channel, undefined);
  }
  assert.deepEqual(sent.map((item) => item.channel), policy.rendererToMainChannels);

  for (const channel of policy.rendererInvokeChannels) {
    await api.invoke(channel, 'C:\\');
  }
  assert.deepEqual(invoked.map((item) => item.channel), policy.rendererInvokeChannels);

  for (const channel of policy.mainToRendererChannels) {
    const unsubscribe = api.on(channel, () => {});
    assert.equal(typeof unsubscribe, 'function');
    assert.ok(listeners.has(channel));
    unsubscribe();
    assert.ok(!listeners.has(channel));
  }
});

test('preload rejects arbitrary channels before they reach Electron', async () => {
  const { api, sent, invoked } = loadPreload();
  assert.throws(() => api.send('shell:execute', 'calc.exe'), /not allowed/i);
  assert.throws(() => api.on('secret:event', () => {}), /not allowed/i);
  await assert.rejects(() => api.invoke('shell:execute', 'calc.exe'), /not allowed/i);
  assert.deepEqual(sent, []);
  assert.deepEqual(invoked, []);
});

test('preload listeners do not expose the Electron event object', () => {
  const { api, listeners } = loadPreload();
  const received = [];
  api.on('alert', (...args) => received.push(args));
  listeners.get('alert')({ sender: { id: 999 }, returnValue: 'secret' }, { message: 'ok' });
  assert.deepEqual(received, [[{ message: 'ok' }]]);
});

test('secure window factory forces security settings and denies popups', () => {
  const instances = [];
  class BrowserWindowMock {
    constructor(options) {
      this.options = options;
      this.events = new Map();
      this.webContents = {
        events: new Map(),
        on: (name, listener) => this.webContents.events.set(name, listener),
        setWindowOpenHandler: (listener) => { this.windowOpenHandler = listener; },
      };
      instances.push(this);
    }
  }

  const factory = withElectronMock({ BrowserWindow: BrowserWindowMock }, () =>
    freshRequire('src/electron/windowFactory.js'));
  const created = factory.createSecureWindow({
    width: 640,
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
  });

  assert.equal(created, instances[0]);
  assert.equal(created.options.webPreferences.nodeIntegration, false);
  assert.equal(created.options.webPreferences.contextIsolation, true);
  assert.equal(created.options.webPreferences.sandbox, true);
  assert.equal(created.options.webPreferences.webSecurity, true);
  assert.match(created.options.webPreferences.preload, /preload\.js$/);
  assert.deepEqual(created.windowOpenHandler({ url: 'https://example.invalid' }), { action: 'deny' });

  let prevented = false;
  created.webContents.events.get('will-navigate')({ preventDefault: () => { prevented = true; } }, 'https://example.invalid');
  assert.equal(prevented, true);
});

test('IPC policy validates channels, senders, routes, URLs, and local folders', () => {
  const policy = freshRequire('src/electron/ipcPolicy.js');
  assert.equal(policy.validateIpcRequest('changeLang', 'ko'), 'ko');
  assert.equal(policy.validateIpcRequest('changeURL', 'rpg'), 'rpg');
  assert.throws(() => policy.validateIpcRequest('changeLang', 'jp'), /invalid/i);
  assert.throws(() => policy.validateIpcRequest('changeURL', '../license.html'), /invalid/i);
  assert.throws(() => policy.validateIpcRequest('unknown-channel', undefined), /unknown/i);
  assert.throws(() => policy.validateIpcRequest('setheight', 100000), /invalid/i);

  const trustedUrl = new URL(`file:///${stageRoot.replace(/\\/g, '/')}/src/html/main/index.html`).href;
  assert.doesNotThrow(() => policy.assertTrustedSender({ sender: { getURL: () => trustedUrl } }, stageRoot));
  assert.throws(() => policy.assertTrustedSender({ sender: { getURL: () => 'https://evil.invalid/' } }, stageRoot), /sender/i);
  assert.throws(() => policy.assertTrustedSender({ sender: { getURL: () => new URL(`file:///${path.dirname(stageRoot).replace(/\\/g, '/')}/escape.html`).href } }, stageRoot), /sender/i);

  assert.equal(policy.resolveRendererRoute('home', stageRoot), path.join(stageRoot, 'src', 'html', 'simple', 'index.html'));
  assert.equal(policy.resolveRendererRoute('rpg', stageRoot), path.join(stageRoot, 'src', 'html', 'main', 'index.html'));
  assert.throws(() => policy.resolveRendererRoute('../license', stageRoot), /route/i);

  assert.equal(policy.validateExternalUrl('https://github.com/Chiriri722/Tsukuru-Agent/releases'), 'https://github.com/Chiriri722/Tsukuru-Agent/releases');
  assert.equal(policy.validateExternalUrl('https://dotnet.microsoft.com/en-us/download/dotnet/'), 'https://dotnet.microsoft.com/en-us/download/dotnet/');
  assert.throws(() => policy.validateExternalUrl('http://github.com/Chiriri722/Tsukuru-Agent'), /HTTPS/i);
  assert.throws(() => policy.validateExternalUrl('https://github.com.evil.invalid/'), /host/i);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-ipc-folder-'));
  try {
    assert.equal(policy.resolveExistingLocalDirectory(tempRoot), fs.realpathSync(tempRoot));
    assert.throws(() => policy.resolveExistingLocalDirectory(path.join(tempRoot, 'missing')), /directory/i);
    assert.throws(() => policy.resolveExistingLocalDirectory('relative'), /absolute/i);
    const gameRoot = path.join(tempRoot, 'game');
    const dataRoot = path.join(gameRoot, 'data');
    fs.mkdirSync(dataRoot, { recursive: true });
    assert.equal(policy.validateIpcRequest('selFont', dataRoot), fs.realpathSync(dataRoot));
    assert.deepEqual(policy.validateIpcRequest('changeFontSize', [dataRoot, 24]), [fs.realpathSync(dataRoot), 24]);
    assert.throws(() => policy.validateIpcRequest('selFont', path.join(tempRoot, 'missing')), /invalid|directory/i);
    assert.throws(() => policy.validateIpcRequest('selFont', gameRoot), /data/i);
    assert.throws(() => policy.validateIpcRequest('changeFontSize', [dataRoot, 24, 'unexpected']), /invalid/i);
    const versionRoots = ['translated', 'new', 'old'].map((name) => {
      const root = path.join(tempRoot, name);
      fs.mkdirSync(root);
      return root;
    });
    const operation = (root) => ({ dir: Buffer.from(root, 'utf8').toString('base64') });
    const request = {
      dir1_base: versionRoots[0],
      dir2_base: versionRoots[1],
      dir3_base: versionRoots[2],
      dir1: operation(versionRoots[0]),
      dir2: operation(versionRoots[1]),
      dir3: operation(versionRoots[2]),
      config: {},
    };
    assert.deepEqual(policy.validateIpcRequest('updateVersion', request), {
      ...request,
      dir1_base: fs.realpathSync(versionRoots[0]),
      dir2_base: fs.realpathSync(versionRoots[1]),
      dir3_base: fs.realpathSync(versionRoots[2]),
    });
    assert.throws(
      () => policy.validateIpcRequest('updateVersion', { ...request, dir2_base: versionRoots[0], dir2: operation(versionRoots[0]) }),
      /distinct/i,
    );
    assert.throws(
      () => policy.validateIpcRequest('updateVersion', { ...request, dir2: operation(versionRoots[0]) }),
      /match/i,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('validated IPC registration blocks untrusted senders and returns structured errors', async () => {
  const registered = new Map();
  const handledRequests = new Map();
  const electronMock = {
    app: { getAppPath: () => stageRoot },
    ipcMain: {
      on: (channel, listener) => registered.set(channel, listener),
      handle: (channel, listener) => handledRequests.set(channel, listener),
    },
  };
  const registration = withElectronMock(electronMock, () => freshRequire('src/electron/ipcRegistration.js'));
  const handled = [];
  registration.onValidated('changeLang', async (_event, payload) => handled.push(payload));

  const replies = [];
  const trustedUrl = new URL(`file:///${stageRoot.replace(/\\/g, '/')}/src/html/main/index.html`).href;
  const trusted = {
    sender: {
      getURL: () => trustedUrl,
      isDestroyed: () => false,
      send: (channel, payload) => replies.push({ channel, payload }),
    },
  };
  registered.get('changeLang')(trusted, 'ko');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(handled, ['ko']);
  assert.deepEqual(replies, []);

  registered.get('changeLang')(trusted, 'jp');
  registered.get('changeLang')({
    sender: {
      getURL: () => 'https://evil.invalid/',
      isDestroyed: () => false,
      send: (channel, payload) => replies.push({ channel, payload }),
    },
  }, 'ko');
  assert.deepEqual(replies.map((item) => item.channel), ['ipc:error', 'ipc:error']);
  assert.deepEqual(replies.map((item) => item.payload.code), [
    'E_IPC_PAYLOAD_INVALID',
    'E_IPC_SENDER_INVALID',
  ]);
  assert.deepEqual(handled, ['ko']);
  assert.ok(replies.every((item) => !('stack' in item.payload)));

  registration.handleValidated('openFolder', async (_event, payload) => payload);
  assert.deepEqual(await handledRequests.get('openFolder')(trusted, 'C:\\'), { ok: true, value: 'C:\\' });
  assert.deepEqual(await handledRequests.get('openFolder')(trusted, ''), {
    ok: false,
    error: { code: 'E_IPC_PAYLOAD_INVALID', message: 'Invalid IPC payload for openFolder' },
  });
});
