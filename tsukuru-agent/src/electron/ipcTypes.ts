export const rendererToMainChannels = [
  'changeLang',
  'license',
  'changeURL',
  'settings',
  'gamePatcher',
  'updatePage',
  'applysettings',
  'closesettings',
  'select_folder',
  'extract',
  'apply',
  'eztrans',
  'eztransHelp',
  'minimize',
  'close',
  'app_version',
  'updates',
  'changeAllString',
  'updateVersion',
  'setheight',
  'log',
  'projectConvert',
  'getextention',
  'wolf_ext',
  'wolf_apply',
  'selFont',
  'changeFontSize',
  'cancelOperation',
] as const;

export const rendererInvokeChannels = [
  'openFolder',
] as const;

export const mainToRendererChannels = [
  'worked',
  'loading',
  'loadingTag',
  'is_version',
  'updateFound',
  'getGlobalSettings',
  'alert',
  'alert_free',
  'alert2',
  'check_force',
  'settings',
  'set_path',
  'eztransError',
  'alertExten',
  'app_version',
  'ipc:error',
] as const;

export type RendererToMainChannel = typeof rendererToMainChannels[number];
export type RendererInvokeChannel = typeof rendererInvokeChannels[number];
export type MainToRendererChannel = typeof mainToRendererChannels[number];

export interface TsukuruBridge {
  send(channel: RendererToMainChannel, payload?: unknown): void;
  invoke(channel: RendererInvokeChannel, payload?: unknown): Promise<unknown>;
  on(channel: MainToRendererChannel, listener: (...args: any[]) => void): () => void;
}
