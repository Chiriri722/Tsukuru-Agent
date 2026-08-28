import { contextBridge, ipcRenderer } from 'electron';
import type { MainToRendererChannel, RendererInvokeChannel, RendererToMainChannel, TsukuruBridge } from './ipcTypes';

// Keep these self-contained: sandboxed Electron preloads may only require a
// limited set of built-in modules. The integration contract checks that this
// list stays identical to ipcTypes.ts.
const rendererToMain = new Set<string>([
  'changeLang', 'license', 'changeURL', 'settings', 'gamePatcher', 'updatePage',
  'applysettings', 'closesettings', 'select_folder', 'extract', 'apply',
  'eztrans', 'eztransHelp', 'minimize', 'close', 'app_version', 'updates',
  'changeAllString', 'updateVersion', 'setheight', 'log',
  'projectConvert', 'getextention', 'wolf_ext', 'wolf_apply', 'selFont',
  'changeFontSize',
  'cancelOperation',
]);

const rendererInvoke = new Set<string>(['openFolder']);

const mainToRenderer = new Set<string>([
  'worked', 'loading', 'loadingTag', 'is_version', 'updateFound',
  'getGlobalSettings', 'alert', 'alert_free', 'alert2', 'check_force',
  'settings', 'set_path', 'eztransError', 'alertExten', 'app_version',
  'ipc:error',
]);

function assertAllowed(channel: string, allowed: Set<string>): void {
  if (!allowed.has(channel)) {
    throw new Error(`IPC channel is not allowed: ${channel}`);
  }
}

const bridge: TsukuruBridge = Object.freeze({
  send(channel: RendererToMainChannel, payload?: unknown): void {
    assertAllowed(channel, rendererToMain);
    ipcRenderer.send(channel, payload);
  },
  async invoke(channel: RendererInvokeChannel, payload?: unknown): Promise<unknown> {
    assertAllowed(channel, rendererInvoke);
    const response = await ipcRenderer.invoke(channel, payload) as {
      ok: boolean;
      value?: unknown;
      error?: { code?: string; message?: string };
    };
    if (response?.ok) return response.value;
    const error = new Error(response?.error?.message || 'The requested GUI operation failed.');
    if (response?.error?.code) (error as Error & { code?: string }).code = response.error.code;
    throw error;
  },
  on(channel: MainToRendererChannel, listener: (...args: any[]) => void): () => void {
    assertAllowed(channel, mainToRenderer);
    if (typeof listener !== 'function') {
      throw new TypeError('IPC listener must be a function');
    }
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: any[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});

contextBridge.exposeInMainWorld('tsukuru', bridge);
