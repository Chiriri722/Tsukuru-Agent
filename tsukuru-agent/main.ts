// Modules to control application life and create native browser window
// E:\Gamr\Tool\PPLSS\www\data\Extracted
import { app, BrowserWindow, dialog, globalShortcut } from 'electron';
import fs from 'fs';
import tools from './src/js/libs/projectTools'
import Store from 'electron-store';
const storage = new Store();
import path from 'path';
import * as edTool from './src/js/rpgmv/edtool.js';
let mainid = 0
const defaultHeight = 550
// 350 + 170
import * as dataBaseO from './src/js/rpgmv/datas.js';
import * as applyjs from "./src/js/rpgmv/apply.js";
import * as eztrans from "./src/js/rpgmv/translator.js";
import * as prjc from './src/js/rpgmv/projectConvert';
import Themes from './src/js/rpgmv/styles'
import sendUpdateInfo from './main_update'
import { wolfInit } from './src/js/wolf/main.js';
import { initFontIPC } from './src/js/rpgmv/fonts';
import { uninitPapago } from './src/js/libs/papagotrans';
import { initExtentions } from './src/js/libs/extentions';
import { OperationError, ErrorCodes } from './src/core/types';
import { createSecureWindow } from './src/electron/windowFactory';
import {
  resolveRendererRoute,
} from './src/electron/ipcPolicy';
import { checkForUpdate } from './src/electron/updatePolicy';
import { terminateTrackedProcesses } from './src/core/processRegistry';
import { publicErrorMessage } from './src/core/publicError';
import { registerWindowHandlers } from './src/electron/handlers/windowHandlers';
import { registerSettingsHandlers } from './src/electron/handlers/settingsHandlers';
import { registerProjectHandlers } from './src/electron/handlers/projectHandlers';
import { registerOperationHandlers } from './src/electron/handlers/operationHandlers';
import { guiOperationCancellation } from './src/electron/operationCancellation';
import { requestJson } from './src/core/httpClient';
import {
  activeGuiWorkerCount,
  cancelGuiOperation,
  runGuiOperation,
  terminateGuiOperation,
} from './src/electron/guiWorkerService';

const RELEASES_URL = 'https://github.com/Chiriri722/Tsukuru-Agent/releases';
const SUPPORT_URL = 'https://github.com/Chiriri722/Tsukuru-Agent/issues';


export function worked(){
  getMainWindow().webContents.send('worked', 0);
  getMainWindow().webContents.send('loading', 0);
}

function getSettings(){
  return globalThis.settings
}

async function loadSettings(){
  let givensettings = {}

  if(storage.has('settings')){
    givensettings = JSON.parse(storage.get('settings') as any)
  }

  globalThis.settings = dataBaseO.settings


  globalThis.settings = {...globalThis.settings, ...givensettings}
  globalThis.settings.version = app.getVersion()
  storage.set('settings', JSON.stringify(globalThis.settings))
}

let mainWindow:Electron.BrowserWindow

function changeLangHandler(ev, arg) {
  globalThis.settings.language = arg
  storage.set('settings', JSON.stringify(globalThis.settings))
  globalThis.mwindow.reload()
}


function createWindow() {
  loadSettings()
  setOPath()
  mainWindow = createSecureWindow({
    width: 800,
    height: defaultHeight,
    show: false,
    resizable: false,
    autoHideMenuBar: true,
    frame: false,
    icon: path.join(__dirname, 'res/icon.png')
  })
  
  mainWindow.setMenu(null)
  // and load the index.html of the app.
  // mainWindow.loadFile('./src/html/main/index.html')
  mainWindow.loadFile(resolveRendererRoute('home', __dirname))
  mainWindow.webContents.on('did-finish-load', function () {
    mainWindow.show();
    getMainWindow().webContents.send('is_version', app.getVersion());
    async function notifyUpdateState(currentVersion: string){
      const result = await checkForUpdate(currentVersion, async (url, options) => {
        const response = await requestJson(url, {
          timeoutMs: options.timeout,
          maxBytes: 64 * 1024,
          maxRedirects: options.maxRedirects,
        });
        return { status: response.status, data: response.data };
      })
      if(result.status === 'update-available'){
        getMainWindow().webContents.send('updateFound');
        return
      }
      const myversion = storage.has('myversion') ? storage.get('myversion') : currentVersion
      if(myversion !== currentVersion){
        storage.set("myversion", currentVersion)
        sendUpdateInfo()
      }
    }
    void notifyUpdateState(app.getVersion())
    globalThis.settings.themeData = Themes[globalThis.settings.theme]
    getMainWindow().webContents.send('getGlobalSettings', globalThis.settings);
    if(!tools.packed){
      globalShortcut.register('Control+Shift+I', () => {
        mainWindow.webContents.openDevTools()
        return false;
      });
    }
  });
  mainid = mainWindow.id;
  globalThis.mwindow = mainWindow
  mainWindow.on('close', () => {
    guiOperationCancellation.cancel()
    cancelGuiOperation()
    app.quit()
  })
  tools.init()
  // Open the DevTools.
}

const getMainWindow = () => {
  const ID = mainid * 1;
  return BrowserWindow.fromId(ID)
}

registerWindowHandlers({
  appRoot: __dirname,
  iconPath: path.join(__dirname, 'res/icon.png'),
  releasesUrl: RELEASES_URL,
  supportUrl: SUPPORT_URL,
  getVersion: () => app.getVersion(),
  getMainWindow,
})

function sendAlert(txt){
  getMainWindow().webContents.send('alert', txt);
}

function sendAlertSmall(txt){
  getMainWindow().webContents.send('alert_free', {html: txt, width:"90vw", height:"95vh"});
}

function sendError(txt){
  getMainWindow().webContents.send('alert', {icon: 'error',  message: txt});
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow()
  initExtentions()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

function settingsHandler() {
  globalThis.settingsWindow = createSecureWindow({
    width: 800,
    height: 700,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'res/icon.png'),
  })
  globalThis.settingsWindow.setMenu(null)
  globalThis.settingsWindow.loadFile(path.join(__dirname, 'src/html/config/settings.html'))
  globalThis.settingsWindow.webContents.on('did-finish-load', function () {
    globalThis.settingsWindow.show();
    globalThis.settingsWindow.webContents.send('settings', getSettings());
  });
  globalThis.settingsWindow.on('close', function() { //   <---- Catch close event
    worked()
  });
  globalThis.settingsWindow.show()
}

function gamePatcherHandler(ev, dir) {
  if(!edTool.exists(dir)){
    sendError('추출된 파일이 없습니다')
    worked()
    return
  }
  globalThis.settingsWindow = createSecureWindow({
    width: 800,
    height: 400,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'res/icon.png'),
  })
  globalThis.settingsWindow.setMenu(null)
  globalThis.settingsWindow.loadFile(path.join(__dirname, 'src/html/patcher/index.html'))
  globalThis.settingsWindow.webContents.on('did-finish-load', function () {
    globalThis.settingsWindow.show();
    globalThis.settingsWindow.webContents.send('settings', getSettings());
  });
  globalThis.settingsWindow.on('close', function() { //   <---- Catch close event
    worked()
  });
  globalThis.settingsWindow.show()
}


// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

let quitCleanupComplete = false
let quitCleanupStarted = false
app.on('before-quit', (event) => {
  if (quitCleanupComplete || activeGuiWorkerCount() === 0) return
  event.preventDefault()
  if (quitCleanupStarted) return
  quitCleanupStarted = true
  guiOperationCancellation.cancel()
  void (async () => {
    try {
      await terminateGuiOperation()
    } finally {
      quitCleanupComplete = true
      app.quit()
    }
  })()
})

app.once('will-quit', () => {
  guiOperationCancellation.cancel()
  globalShortcut.unregisterAll()
  uninitPapago()
  terminateTrackedProcesses()
})

async function applySettingsHandler(ev, arg) {
  globalThis.settings = {...globalThis.settings, ...arg}
  storage.set('settings', JSON.stringify(globalThis.settings))
  globalThis.settingsWindow.close()
  globalThis.settings.themeData = Themes[globalThis.settings.theme]
  console.log(globalThis.settings)
  getMainWindow().webContents.send('getGlobalSettings', globalThis.settings);
  worked()
}

async function closeSettingsHandler() {
  globalThis.settingsWindow.close()
  worked()
}

async function selectFolderHandler(ev, typeo) {
  let Path = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if(!Path.canceled){
    const qs = Path.filePaths[0]
    let qv
    if(qs.includes('\\')){
      qv = qs.split('\\')[qs.split('\\').length-1]
    }
    else{
      qv = qs.split('/')[qs.split('/').length-1]
    }
    let dir = qs
    if(qv === 'data'){
      getMainWindow().webContents.send('set_path', {type:typeo, dir:dir});
    }
    else{
      if(fs.existsSync(path.join(qs, 'www', 'data'))){
        getMainWindow().webContents.send('set_path', {type:typeo, dir:path.join(qs, 'www', 'data')});
      }
      else if(fs.existsSync(path.join(qs, 'data'))){
        getMainWindow().webContents.send('set_path', {type:typeo, dir:path.join(qs, 'data')});
      }
      else if(fs.existsSync(path.join(qs, 'Data.wolf'))){
        getMainWindow().webContents.send('set_path', {type:typeo, dir:path.join(qs)});
      }
      else{
        getMainWindow().webContents.send('alert', {icon: 'error',  message:'폴더가 올바르지 않습니다'});
      }
    }
  }
}

async function extractor(arg){
  let operation;
  try {
    operation = guiOperationCancellation.begin(() => cancelGuiOperation());
    const dir = Buffer.from(arg.dir, "base64").toString('utf8');
    await runGuiOperation({
      operation: 'rpg-extract',
      payload: { ...arg, dir },
      settings: { ...globalThis.settings },
      oPath: globalThis.oPath,
    });
    if(!arg.silent){
      getMainWindow().webContents.send('alert2'); 
    }
    return true
  } catch (err) {
    if(err instanceof OperationError && err.code === ErrorCodes.EXTRACT_EXISTS){
      getMainWindow().webContents.send('check_force', arg); 
      return false
    }
    const message = publicErrorMessage(err);
    getMainWindow().webContents.send('alert', {icon: 'error', message}); 
    return false
  } finally {
    if(operation) guiOperationCancellation.finish(operation.id);
  }
}
async function extractHandler(ev, arg) {
  await extractor(arg)
  worked()
}

function setOPath(){
  if(tools.packed){
    globalThis.oPath = process.resourcesPath
  }
  else{
    globalThis.oPath = __dirname
  }
}

async function changeAllStringHandler(ev, arg) {
  let operation;
  try {
    const dataRoot = Buffer.from(arg.dir, "base64").toString('utf8');
    operation = guiOperationCancellation.begin(() => cancelGuiOperation());
    await runGuiOperation({
      operation: 'change-all-strings',
      payload: { dataRoot, search: arg.data[0], replacement: arg.data[1] },
      settings: { ...globalThis.settings },
      oPath: globalThis.oPath,
    })
    getMainWindow().webContents.send('alert', "완료되었습니다");
  } catch (err) {
    const message = publicErrorMessage(err)
    getMainWindow().webContents.send('alert', {icon: 'error', message});
  } finally {
    if(operation) guiOperationCancellation.finish(operation.id);
    worked()
  }
}

async function updateVersionHandler(ev, arg) {
  try {
    if(!fs.existsSync(path.join(arg.dir1_base, 'Extract'))){
      sendError('구버전 번역본의 Extract 폴더가 존재하지 않습니다')
      worked()
      return
    }
    
    console.log(arg.dir3)
    if(!await extractor({
      ...arg.dir3,
      dir: Buffer.from(path.join(arg.dir3_base), "utf8").toString('base64'),
      force: true,
      silent: true
    })) {
      worked()
      return
    }
    console.log(arg.dir2)
    if(!await extractor({
      ...arg.dir2,
      dir: Buffer.from(path.join(arg.dir2_base), "utf8").toString('base64'),
      force: true,
      silent: true
    })) {
      worked()
      return
    }
    const operation = guiOperationCancellation.begin(() => cancelGuiOperation());
    try {
      await runGuiOperation({
        operation: 'version-port',
        payload: {
          translatedRoot: arg.dir1_base,
          oldRoot: arg.dir3_base,
          newRoot: arg.dir2_base,
        },
        settings: { ...globalThis.settings },
        oPath: globalThis.oPath,
      })
    } finally {
      guiOperationCancellation.finish(operation.id)
    }
    getMainWindow().webContents.send('alert', '완료되었습니다')
    worked()
  } catch (err) {
    getMainWindow().webContents.send('alert', {icon: 'error', message: publicErrorMessage(err)});
    worked()
  }
}

wolfInit()
initFontIPC()

registerSettingsHandlers({
  changeLang: changeLangHandler,
  settings: settingsHandler,
  gamePatcher: gamePatcherHandler,
  applysettings: applySettingsHandler,
  closesettings: closeSettingsHandler,
})

registerProjectHandlers({
  selectFolder: selectFolderHandler,
  log: async (_ev, arg) => console.log(arg),
  projectConvert: async (_ev, arg) => prjc.ConvertProject(arg),
})

registerOperationHandlers({
  extract: extractHandler,
  apply: applyjs.apply,
  translate: eztrans.trans,
  changeAllString: changeAllStringHandler,
  updateVersion: updateVersionHandler,
  cancelOperation: async () => {
    guiOperationCancellation.cancel();
  },
})
