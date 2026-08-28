import { IpcMainEvent } from 'electron';
import { onValidated } from '../ipcRegistration';

type Handler = (event: IpcMainEvent, payload: any) => unknown | Promise<unknown>;

export interface ProjectHandlers {
  selectFolder: Handler;
  log: Handler;
  projectConvert: Handler;
}

export function registerProjectHandlers(handlers: ProjectHandlers, trustedRoots?: string | readonly string[]): void {
  onValidated('select_folder', handlers.selectFolder, trustedRoots);
  onValidated('log', handlers.log, trustedRoots);
  onValidated('projectConvert', handlers.projectConvert, trustedRoots);
}
