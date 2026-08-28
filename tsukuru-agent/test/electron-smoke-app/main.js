const { app } = require('electron');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const stageRoot = path.join(appRoot, '.build', 'app');
const trustedRoots = [__dirname, stageRoot];
const smokeGamePath = path.join(appRoot, 'test', 'fixtures', 'electron-smoke-game');

const settingsPayload = Object.freeze({
  userdict: {},
  extractSomeScript: false,
  extractSomeScript2: [],
  extractPlus: [],
  ExtractAddLine: false,
  onefile_src: true,
  onefile_note: true,
  JsonChangeLine: false,
  oneMapFile: false,
  loadingText: true,
  ExternMsgJson: true,
  DoNotTransHangul: true,
  formatNice: true,
  hideUnrecomenedTranslators: true,
  themeData: {},
  language: 'ko',
  HideExtractAll: true,
  version: '2.5.0-smoke',
});

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(check, label, attempts = 100) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(25);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

async function waitForBridgeResult(window, handledLanguages) {
  return waitFor(async () => {
    const renderer = await window.webContents.executeJavaScript('window.smokeResult');
    return handledLanguages.length === 1 && renderer.eventPayload && renderer.invokeResult &&
      renderer.arbitraryInvokeRejected ? renderer : null;
  }, 'Electron preload/IPC bridge smoke');
}

async function waitForPage(window, suffix) {
  return waitFor(async () => {
    const url = decodeURIComponent(window.webContents.getURL()).replaceAll('\\\\', '/');
    if (!url.endsWith(suffix)) return null;
    const ready = await window.webContents.executeJavaScript('document.readyState === "complete"');
    return ready ? url : null;
  }, `GUI route ${suffix}`);
}

async function rendererSecurity(window, requiredIds) {
  return window.webContents.executeJavaScript(`(() => ({
    bridgeAvailable: Boolean(window.tsukuru),
    nodeRequireType: typeof require,
    processType: typeof process,
    requiredElements: ${JSON.stringify(requiredIds)}.every((id) => Boolean(document.getElementById(id)))
  }))()`);
}

function pathFromPayload(payload) {
  return Buffer.from(payload.dir, 'base64').toString('utf8');
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

app.whenReady().then(async () => {
  const { createSecureWindow } = require(path.join(stageRoot, 'src', 'electron', 'windowFactory.js'));
  const { handleValidated, onValidated } = require(path.join(stageRoot, 'src', 'electron', 'ipcRegistration.js'));
  const { resolveRendererRoute } = require(path.join(stageRoot, 'src', 'electron', 'ipcPolicy.js'));
  const { registerSettingsHandlers } = require(path.join(stageRoot, 'src', 'electron', 'handlers', 'settingsHandlers.js'));
  const { registerProjectHandlers } = require(path.join(stageRoot, 'src', 'electron', 'handlers', 'projectHandlers.js'));
  const { registerOperationHandlers } = require(path.join(stageRoot, 'src', 'electron', 'handlers', 'operationHandlers.js'));

  const handled = {
    languages: [],
    routes: [],
    heights: [],
    extract: [],
    apply: [],
    settingsOpened: 0,
    settingsApplied: [],
    settingsClosed: 0,
    wolfExtract: [],
    wolfApply: [],
  };
  let mainWindow;
  let settingsWindow;
  let settingsReady = false;

  handleValidated('openFolder', (_event, payload) => `handled:${payload}`, trustedRoots);
  onValidated('changeURL', async (_event, routeId) => {
    handled.routes.push(routeId);
    await mainWindow.loadFile(resolveRendererRoute(routeId, stageRoot));
  }, trustedRoots);
  onValidated('setheight', (_event, payload) => handled.heights.push(payload), trustedRoots);
  onValidated('wolf_ext', (event, payload) => {
    handled.wolfExtract.push(payload);
    event.sender.send('worked');
  }, trustedRoots);
  onValidated('wolf_apply', (event, payload) => {
    handled.wolfApply.push(payload);
    event.sender.send('worked');
  }, trustedRoots);

  registerSettingsHandlers({
    changeLang: (_event, payload) => handled.languages.push(payload),
    settings: async () => {
      handled.settingsOpened += 1;
      settingsReady = false;
      settingsWindow = createSecureWindow({ show: false, width: 480, height: 640 });
      await settingsWindow.loadFile(path.join(stageRoot, 'src', 'html', 'config', 'settings.html'));
      settingsWindow.webContents.send('settings', settingsPayload);
      settingsReady = true;
    },
    gamePatcher: () => undefined,
    applysettings: (_event, payload) => handled.settingsApplied.push(payload),
    closesettings: () => {
      handled.settingsClosed += 1;
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy();
    },
  }, trustedRoots);
  registerProjectHandlers({
    selectFolder: () => undefined,
    log: () => undefined,
    projectConvert: () => undefined,
  }, trustedRoots);
  registerOperationHandlers({
    extract: (event, payload) => {
      handled.extract.push(payload);
      event.sender.send('worked');
    },
    apply: (event, payload) => {
      handled.apply.push(payload);
      event.sender.send('worked');
    },
    translate: () => undefined,
    changeAllString: () => undefined,
    updateVersion: () => undefined,
  }, trustedRoots);

  mainWindow = createSecureWindow({ show: false, width: 800, height: 600 });
  let exitCode = 0;
  try {
    await mainWindow.loadFile(path.join(__dirname, 'index.html'));
    mainWindow.webContents.send('alert', { message: 'main-to-renderer' });
    const bridge = await waitForBridgeResult(mainWindow, handled.languages);
    const preferences = mainWindow.webContents.getLastWebPreferences();

    await mainWindow.loadFile(resolveRendererRoute('home', stageRoot));
    await waitForPage(mainWindow, '/src/html/simple/index.html');
    mainWindow.webContents.send('getGlobalSettings', settingsPayload);
    const home = await rendererSecurity(mainWindow, ['gokupu', 'simpuru', 'mainMenu']);

    await mainWindow.webContents.executeJavaScript("document.getElementById('gokupu').click()");
    await waitForPage(mainWindow, '/src/html/main/index.html');
    mainWindow.webContents.send('getGlobalSettings', settingsPayload);
    const rpgSecurity = await rendererSecurity(mainWindow, ['folder_input', 'ext', 'apply', 'run', 'settings', 'WolfBtn']);

    await mainWindow.webContents.executeJavaScript(`(() => {
      document.getElementById('folder_input').value = ${JSON.stringify(smokeGamePath)};
      document.getElementById('ext').click();
      document.getElementById('run').click();
    })()`);
    await waitFor(() => handled.extract.length === 1, 'RPG extract IPC');
    await sleep(50);
    await mainWindow.webContents.executeJavaScript(`(() => {
      document.getElementById('apply').click();
      document.getElementById('run').click();
    })()`);
    await waitFor(() => handled.apply.length === 1, 'RPG apply IPC');
    await sleep(50);

    await mainWindow.webContents.executeJavaScript("document.getElementById('settings').click()");
    await waitFor(() => settingsReady && settingsWindow && !settingsWindow.isDestroyed(), 'settings window');
    const settingsSecurity = await rendererSecurity(settingsWindow, ['userdict', 'extractSomeScript2', 'extractPlus', 'apply', 'close']);
    await settingsWindow.webContents.executeJavaScript("document.getElementById('apply').click()");
    await waitFor(() => handled.settingsApplied.length === 1, 'settings apply IPC');
    await settingsWindow.webContents.executeJavaScript("document.getElementById('close').click()");
    await waitFor(() => handled.settingsClosed === 1, 'settings close IPC');

    await mainWindow.webContents.executeJavaScript("document.getElementById('WolfBtn').click()");
    await waitForPage(mainWindow, '/src/html/wolf/index.html');
    mainWindow.webContents.send('getGlobalSettings', settingsPayload);
    const wolfSecurity = await rendererSecurity(mainWindow, ['folder_input', 'runbtn', 'runbtn2', 'settings', 'WolfBtn']);
    await mainWindow.webContents.executeJavaScript(`(() => {
      document.getElementById('folder_input').value = ${JSON.stringify(smokeGamePath)};
      document.getElementById('runbtn').click();
    })()`);
    await waitFor(() => handled.wolfExtract.length === 1, 'Wolf extract IPC');
    await sleep(50);
    await mainWindow.webContents.executeJavaScript("document.getElementById('runbtn2').click()");
    await waitFor(() => handled.wolfApply.length === 1, 'Wolf apply IPC');
    await sleep(50);
    await mainWindow.webContents.executeJavaScript("document.getElementById('WolfBtn').click()");
    await waitForPage(mainWindow, '/src/html/main/index.html');

    const secure = (value) => value.bridgeAvailable === true &&
      value.nodeRequireType === 'undefined' &&
      value.processType === 'undefined' &&
      value.requiredElements === true;
    const gui = {
      routes: handled.routes,
      heights: handled.heights,
      rpg: {
        extractCount: handled.extract.length,
        applyCount: handled.apply.length,
        extractPath: pathFromPayload(handled.extract[0]),
        applyPath: pathFromPayload(handled.apply[0]),
      },
      settings: {
        opened: handled.settingsOpened,
        applied: handled.settingsApplied.length,
        closed: handled.settingsClosed,
        version: handled.settingsApplied[0]?.version,
      },
      wolf: {
        extractCount: handled.wolfExtract.length,
        applyCount: handled.wolfApply.length,
        extractPath: handled.wolfExtract[0]?.folder,
        applyPath: handled.wolfApply[0]?.folder,
      },
      security: { home, rpg: rpgSecurity, settings: settingsSecurity, wolf: wolfSecurity },
    };
    const result = {
      ok: bridge.bridgeAvailable === true &&
        bridge.arbitraryRejected === true &&
        bridge.arbitraryInvokeRejected === true &&
        bridge.invokeResult === 'handled:smoke-path' &&
        bridge.nodeRequireType === 'undefined' &&
        bridge.processType === 'undefined' &&
        bridge.eventPayload?.message === 'main-to-renderer' &&
        handled.languages[0] === 'ko' &&
        preferences.nodeIntegration === false &&
        preferences.contextIsolation === true &&
        preferences.sandbox === true &&
        preferences.webSecurity === true &&
        handled.routes.join(',') === 'rpg,wolf,rpg' &&
        samePath(gui.rpg.extractPath, smokeGamePath) &&
        samePath(gui.rpg.applyPath, smokeGamePath) &&
        gui.settings.opened === 1 && gui.settings.applied === 1 && gui.settings.closed === 1 &&
        gui.settings.version === settingsPayload.version &&
        samePath(gui.wolf.extractPath, smokeGamePath) && samePath(gui.wolf.applyPath, smokeGamePath) &&
        secure(home) && secure(rpgSecurity) && secure(settingsSecurity) && secure(wolfSecurity),
      renderer: bridge,
      gui,
      preferences: {
        nodeIntegration: preferences.nodeIntegration,
        contextIsolation: preferences.contextIsolation,
        sandbox: preferences.sandbox,
        webSecurity: preferences.webSecurity,
      },
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    exitCode = 1;
  } finally {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    app.exit(exitCode);
  }
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  app.exit(1);
});
