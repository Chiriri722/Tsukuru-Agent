const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const { finished } = require('node:stream/promises');
const { runLaunchProbe } = require('../../.build/app/src/core/runtimeDiagnostics.js');

const supported = process.platform === 'win32';
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function pack(source, archive, options = {}) {
  const stream = await asar.createPackageWithOptions(source, archive, options);
  if (!stream.writableFinished) await finished(stream);
}

function copyRuntime(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const input = path.join(source, entry.name), output = path.join(destination, entry.name);
    if (entry.isDirectory()) copyRuntime(input, output);
    else if (entry.isFile()) fs.copyFileSync(input, output);
  }
}

test('environment-only control does not redirect Electron appData', { skip: !supported }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-profile-한글-'));
  const app = path.join(root, 'app');
  const profile = path.join(root, 'profile');
  const marker = path.join(root, 'paths.json');
  fs.mkdirSync(app);
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'tsukuru-isolation-fixture', main: 'main.js' }));
  fs.writeFileSync(path.join(app, 'main.js'), `
    const {app} = require('electron');
    require('fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({appData: app.getPath('appData')}));
    app.exit(0);
  `);
  try {
    const result = await runLaunchProbe(require('electron'), [app, '--user-data-dir=' + profile], {
      timeoutMs: 5000, env: { APPDATA: profile, LOCALAPPDATA: profile },
    });
    assert.equal(result.status, 'exited-ok', result.stderr);
    assert.notEqual(JSON.parse(fs.readFileSync(marker, 'utf8')).appData, profile);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isolated Electron writes only to its profile and preserves the source and same-name canary', { skip: !supported }, async (t) => {
  const { runIsolatedElectronProbe } = require('../../.build/app/src/core/electronProfileProbe.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-profile-한글-'));
  const name = 'tsukuru-canary-' + crypto.randomUUID();
  const canary = path.join(process.env.APPDATA, name);
  const source = path.join(root, 'source');
  const original = path.join(root, 'original.asar');
  const proof = path.join(root, 'fixture-proof.json');
  const profileRoots = [];
  fs.mkdirSync(source);
  fs.mkdirSync(canary);
  fs.writeFileSync(path.join(canary, 'save.json'), 'existing-save');
  const before = { hash: hash(path.join(canary, 'save.json')), stat: fs.statSync(path.join(canary, 'save.json')) };
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name, main: 'main.cjs' }));
  fs.writeFileSync(path.join(source, 'main.cjs'), `
    if (require.main !== module || module.id !== '.') throw new Error('Original main semantics lost');
    const {app, session, BrowserWindow} = require('electron');
    const fs = require('node:fs'), path = require('node:path');
    const keys = ['home', 'appData', 'userData', 'sessionData', 'temp', 'logs', 'crashDumps'];
    const paths = Object.fromEntries(keys.map(key => [key, app.getPath(key)]));
    const assert = require('node:assert/strict');
    for (const key of keys) assert.throws(() => app.setPath(key, ${JSON.stringify(canary)}), /external profile path/);
    assert.throws(() => app.setAppLogsPath(${JSON.stringify(canary)}), /external logs/);
    app.setPath('userData', paths.userData); app.setAppLogsPath();
    for (const key of keys) assert.equal(app.getPath(key), paths[key]);
    const save = path.join(paths.appData, app.name);
    fs.mkdirSync(save, {recursive: true}); fs.writeFileSync(path.join(save, 'save.json'), 'probe-save');
    const envPaths = ['APPDATA','LOCALAPPDATA','USERPROFILE','HOME','TEMP','TMP'].map(key => process.env[key]);
    for (const target of envPaths) fs.writeFileSync(path.join(target, 'env-canary'), 'probe');
    app.whenReady().then(async () => {
      const custom = session.fromPartition('persist:profile-fixture');
      await custom.cookies.set({url:'https://fixture.invalid', name:'test', value:'value'});
      const window = new BrowserWindow({show:false});
      await window.loadFile(path.join(__dirname, 'index.html'));
      await window.webContents.executeJavaScript(
        "localStorage.setItem('save','isolated'); new Promise((resolve,reject)=>{const r=indexedDB.open('save');r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>{r.result.close();resolve(true)};r.onerror=()=>reject(r.error)})");
      await session.defaultSession.flushStorageData(); await custom.flushStorageData();
      fs.writeFileSync(${JSON.stringify(proof)}, JSON.stringify({paths,envPaths,session:session.defaultSession.storagePath,custom:custom.storagePath,pid:process.pid}));
      app.exit(0);
    }).catch(error => { console.error(error); app.exit(7); });
  `);
  fs.writeFileSync(path.join(source, 'index.html'), '<!doctype html><title>Synthetic save fixture</title>');
  await pack(source, original, { unpack: '*.cjs' });
  const originalHash = hash(original);
  const unpackedHash = hash(path.join(original + '.unpacked', 'main.cjs'));
  const environment = JSON.stringify({ ...process.env });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const probeRoot = path.join(root, 'attempt-' + attempt);
      const payload = path.join(probeRoot, 'payload');
      copyRuntime(path.dirname(require('electron')), payload);
      const archive = path.join(payload, 'resources', 'app.asar');
      fs.copyFileSync(original, archive);
      copyRuntime(original + '.unpacked', archive + '.unpacked');
      const result = await runIsolatedElectronProbe(path.join(payload, 'electron.exe'), archive, probeRoot, { timeoutMs: 15000 });
      if (result.status !== 'exited-ok') t.diagnostic(JSON.stringify(result));
      assert.equal(result.status, 'exited-ok', JSON.stringify(result));
      assert.deepEqual(result.isolation, { strategy: 'electron-bootstrap-v1', verified: true, processTreeTerminated: true, cleanup: 'removed' });
      const observed = JSON.parse(fs.readFileSync(proof, 'utf8'));
      const profile = path.join(probeRoot, 'profile');
      for (const target of [...Object.values(observed.paths), ...observed.envPaths, observed.session, observed.custom]) {
        const relative = path.relative(profile, target);
        assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), target);
      }
      assert.equal(alive(observed.pid), false);
      assert.equal(fs.existsSync(probeRoot), false);
      profileRoots.push(profile);
    }
    assert.notEqual(profileRoots[0], profileRoots[1]);
    assert.equal(hash(original), originalHash);
    assert.equal(hash(path.join(original + '.unpacked', 'main.cjs')), unpackedHash);
    assert.equal(hash(path.join(canary, 'save.json')), before.hash);
    assert.equal(fs.statSync(path.join(canary, 'save.json')).mtimeMs, before.stat.mtimeMs);
    assert.deepEqual(fs.readdirSync(canary), ['save.json']);
    assert.ok(JSON.stringify({ ...process.env }) === environment, 'Parent environment must remain unchanged');
  } finally {
    try { await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
    finally { await fs.promises.rm(canary, { recursive: true, force: true }); }
  }
});

test('Windows probe job stops detached descendants after parent exit, timeout and cancellation', { skip: !supported }, async () => {
  const { runWindowsProbeJob } = require('../../.build/app/src/core/electronProfileProbe.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-profile-job-'));
  try {
    for (const mode of ['exit', 'timeout', 'cancel']) {
      const attempt = path.join(root, mode);
      fs.mkdirSync(attempt);
      const pidPath = path.join(attempt, 'child.pid');
      const controller = new AbortController();
      const script = `
        const child = require('child_process').spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {detached:true,stdio:'ignore'});
        require('fs').writeFileSync(${JSON.stringify(pidPath)}, String(child.pid)); child.unref();
        ${mode === 'exit' ? 'process.exit(0)' : 'setInterval(()=>{},1000)'};
      `;
      const pending = runWindowsProbeJob(process.execPath, ['-e', script], attempt, { timeoutMs: mode === 'timeout' ? 5000 : 15000, signal: controller.signal });
      const cancelTimer = mode === 'cancel' ? setInterval(() => { if (fs.existsSync(pidPath)) controller.abort(); }, 25) : null;
      let pid;
      try {
        const result = await pending;
        assert.equal(result.status, { exit: 'exited-ok', timeout: 'running', cancel: 'failed' }[mode], JSON.stringify(result));
        pid = Number(fs.readFileSync(pidPath, 'utf8'));
        assert.equal(result.processTreeTerminated, true, JSON.stringify(result));
        assert.equal(alive(pid), false);
        assert.equal(result.status, { exit: 'exited-ok', timeout: 'running', cancel: 'failed' }[mode]);
      } finally {
        clearInterval(cancelTimer);
        if (pid && alive(pid)) process.kill(pid);
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unsupported Electron entries are refused before game code and cleaned', { skip: !supported }, async () => {
  const { runIsolatedElectronProbe } = require('../../.build/app/src/core/electronProfileProbe.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-profile-refusal-'));
  try {
    for (const metadata of [{ main: 'index.html' }, { main: 'main.js', type: 'module' }, { main: '../outside.js' },
      { main: 'absent.cjs' }, { main: 'main.js', name: '../outside-profile' }]) {
      const source = fs.mkdtempSync(path.join(root, 'source-'));
      const probe = fs.mkdtempSync(path.join(root, 'probe-'));
      const archive = path.join(probe, 'payload', 'resources', 'app.asar');
      const executable = path.join(probe, 'payload', 'electron.exe');
      fs.mkdirSync(path.dirname(archive), { recursive: true });
      fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'unsupported-fixture', ...metadata }));
      fs.writeFileSync(path.join(source, 'main.js'), 'throw new Error("must not execute")');
      await pack(source, archive);
      fs.copyFileSync(require('electron'), executable);
      const result = await runIsolatedElectronProbe(executable, archive, probe);
      assert.equal(result.status, 'failed');
      assert.equal(result.isolation.verified, false);
      assert.equal(result.isolation.processTreeTerminated, true);
      assert.equal(result.isolation.cleanup, 'removed');
      assert.equal(fs.existsSync(probe), false);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('protected or unknown runtimes and cleanup failures never become a successful probe', { skip: !supported }, async () => {
  const { runIsolatedElectronProbe } = require('../../.build/app/src/core/electronProfileProbe.js');
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-profile-guards-'));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'package.json'), '{"name":"fixture","main":"main.js"}');
  fs.writeFileSync(path.join(source, 'main.js'), 'throw new Error("must not execute")');
  const remove = fs.promises.rm;
  try {
    for (const mode of ['integrity', 'unknown', 'cleanup', 'aborted']) {
      const probe = fs.mkdtempSync(path.join(root, 'probe-'));
      const archive = path.join(probe, 'app.asar'), executable = path.join(probe, 'Game.exe');
      await pack(source, archive);
      fs.copyFileSync(mode === 'integrity' ? require('electron') : process.execPath, executable);
      if (mode === 'integrity') {
        await flipFuses(executable, { version: FuseVersion.V1, [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true });
      }
      if (mode === 'cleanup') fs.promises.rm = async (target, options) => {
        if (target === probe) throw Object.assign(new Error('synthetic locked profile'), { code: 'EPERM' });
        return remove(target, options);
      };
      const controller = new AbortController();
      if (mode === 'aborted') controller.abort();
      const result = await runIsolatedElectronProbe(executable, archive, probe, { signal: controller.signal });
      fs.promises.rm = remove;
      assert.equal(result.status, 'failed');
      assert.equal(result.isolation.verified, false);
      assert.equal(result.isolation.processTreeTerminated, true);
      assert.equal(result.isolation.cleanup, mode === 'cleanup' ? 'retained' : 'removed');
      assert.equal(fs.existsSync(probe), mode === 'cleanup');
    }
  } finally { fs.promises.rm = remove; await fs.promises.rm(root, { recursive: true, force: true }); }
});

test('Windows job creation failure confirms that no game process needs cleanup', { skip: !supported }, async () => {
  const { runWindowsProbeJob } = require('../../.build/app/src/core/electronProfileProbe.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-profile-missing-'));
  try {
    const result = await runWindowsProbeJob(path.join(root, 'missing.exe'), [], root, { timeoutMs: 1000 });
    assert.equal(result.status, 'failed');
    assert.equal(result.processTreeTerminated, true);
    assert.ok(result.error);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the job broker stops the game when its owning Node process is forcibly terminated', { skip: !supported }, async () => {
  const { spawn } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-profile-owner-'));
  const pidPath = path.join(root, 'game.pid');
  const brokerPath = path.join(root, 'broker.pid');
  const modulePath = require.resolve('../../.build/app/src/core/electronProfileProbe.js');
  const registryPath = require.resolve('../../.build/app/src/core/processRegistry.js');
  const game = `require('fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(()=>{},1000)`;
  const owner = `
    const fs = require('fs');
    require(${JSON.stringify(registryPath)}).setTrackedProcessObserver(event => {
      if(event.state === 'spawn') fs.writeFileSync(${JSON.stringify(brokerPath)}, String(event.pid));
    });
    require(${JSON.stringify(modulePath)}).runWindowsProbeJob(process.execPath, ['-e', ${JSON.stringify(game)}], ${JSON.stringify(root)}, {timeoutMs:15000});
  `;
  let pid, brokerPid;
  const worker = spawn(process.execPath, ['-e', owner], { windowsHide: true, stdio: 'ignore' });
  try {
    for (let attempt = 0; !fs.existsSync(pidPath) && attempt < 600; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(fs.existsSync(pidPath), 'Synthetic game must start before the owner is killed');
    pid = Number(fs.readFileSync(pidPath, 'utf8'));
    brokerPid = Number(fs.readFileSync(brokerPath, 'utf8'));
    worker.kill('SIGKILL');
    for (let attempt = 0; (alive(pid) || alive(brokerPid)) && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(alive(pid), false);
    assert.equal(alive(brokerPid), false);
    // With the caller gone, broken output pipes can end PowerShell before its
    // JSON report is written. Job closure must still stop every owned process.
  } finally {
    if (!worker.killed) worker.kill('SIGKILL');
    if (brokerPid && alive(brokerPid)) process.kill(brokerPid);
    if (pid && alive(pid)) process.kill(pid);
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('container apply publishes the original entry and isolates only its disposable launch copy', { skip: !supported }, async () => {
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-profile-workflow-'));
  const source = path.join(root, 'source'), game = path.join(root, 'game');
  const working = path.join(root, 'working'), output = path.join(root, 'output');
  const archive = path.join(game, 'resources', 'app.asar');
  try {
    const driver = path.join(root, 'agent.cjs');
    const cliProfile = path.join(root, 'cli-profile');
    fs.mkdirSync(cliProfile);
    fs.writeFileSync(driver, `const {app}=require('electron');
      app.setPath('userData', ${JSON.stringify(cliProfile)});
      require(${JSON.stringify(require.resolve('../../.build/app/src/cli/run.js'))}).runAgent(['run','--request',process.argv[2]])
        .then(code=>app.exit(code),()=>app.exit(1));`);
    const executeAgentRequest = async (request) => {
      const requestPath = path.join(root, request.operation + '.json');
      fs.writeFileSync(requestPath, JSON.stringify(request));
      const completed = spawnSync(require('electron'), [driver, requestPath, '--user-data-dir=' + cliProfile],
        { windowsHide: true, encoding: 'utf8', timeout: 60000 });
      assert.ok(!completed.error, completed.error?.code);
      return JSON.parse(completed.stdout);
    };
    copyRuntime(path.dirname(require('electron')), game);
    fs.mkdirSync(path.join(source, 'project', 'data'), { recursive: true });
    fs.mkdirSync(path.join(source, 'project', 'js'), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{"name":"tsukuru-launch-roundtrip","main":"main.cjs"}');
    fs.writeFileSync(path.join(source, 'main.cjs'), "const {app}=require('electron'); require('fs').writeFileSync(require('path').join(app.getPath('userData'),'save'),'synthetic'); app.exit(0);");
    fs.writeFileSync(path.join(source, 'project/data/Actors.json'), '[null,{"name":"Actor"}]');
    fs.writeFileSync(path.join(source, 'project/data/System.json'), '{"encryptionKey":""}');
    fs.writeFileSync(path.join(source, 'project/js/rmmz_core.js'), '// synthetic engine marker');
    const nestedSource = path.join(root, 'nested-source');
    fs.mkdirSync(nestedSource);
    fs.writeFileSync(path.join(nestedSource, 'asset.txt'), 'nested archive must remain a physical file');
    const nestedArchive = path.join(source, 'assets', 'nested.asar');
    fs.mkdirSync(path.dirname(nestedArchive));
    await pack(nestedSource, nestedArchive);
    await pack(source, archive);
    const before = hash(archive);
    const extracted = await executeAgentRequest({ schemaVersion: 2, operation: 'extract', projectPath: game, outputPath: working });
    assert.equal(extracted.ok, true, JSON.stringify(extracted.error));
    let result;
    try {
      result = await executeAgentRequest({ schemaVersion: 2, operation: 'apply', projectPath: working,
        outputPath: output, options: { containerSourcePath: game, launchProbe: true, launchTimeoutMs: 3000 } });
    } catch (error) { throw new Error(JSON.stringify(error.details || error.message)); }
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(result.runtime.launchProbe.status, 'exited-ok');
    assert.deepEqual(result.runtime.launchProbe.isolation, { strategy: 'electron-bootstrap-v1', verified: true, processTreeTerminated: true, cleanup: 'removed' });
    assert.equal(hash(archive), before);
    const published = path.join(output, 'resources/app.asar');
    assert.equal(JSON.parse(asar.extractFile(published, 'package.json').toString()).main, 'main.cjs');
    assert.deepEqual(asar.extractFile(published, 'main.cjs'), fs.readFileSync(path.join(source, 'main.cjs')));
    assert.deepEqual(asar.extractFile(published, 'assets/nested.asar'), fs.readFileSync(nestedArchive));
    assert.ok(!asar.listPackage(published).some(entry => entry.includes('tsukuru-probe-')));
    assert.equal(result.runtime.launchProbe.executable, path.join(output, 'electron.exe'));
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});
