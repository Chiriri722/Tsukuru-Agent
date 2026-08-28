import { IpcMainEvent } from 'electron';
import { onValidated } from '../ipcRegistration';

type Handler = (event: IpcMainEvent, payload: any) => unknown | Promise<unknown>;

export interface SettingsHandlers {
  changeLang: Handler;
  settings: Handler;
  gamePatcher: Handler;
  applysettings: Handler;
  closesettings: Handler;
}

export function registerSettingsHandlers(handlers: SettingsHandlers, trustedRoots?: string | readonly string[]): void {
  onValidated('changeLang', handlers.changeLang, trustedRoots);
  onValidated('settings', handlers.settings, trustedRoots);
  onValidated('gamePatcher', handlers.gamePatcher, trustedRoots);
  onValidated('applysettings', handlers.applysettings, trustedRoots);
  onValidated('closesettings', handlers.closesettings, trustedRoots);
}
