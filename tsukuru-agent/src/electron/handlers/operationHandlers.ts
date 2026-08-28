import { IpcMainEvent } from 'electron';
import { onValidated } from '../ipcRegistration';

type Handler = (event: IpcMainEvent, payload: any) => unknown | Promise<unknown>;

export interface OperationHandlers {
  extract: Handler;
  apply: Handler;
  translate: Handler;
  changeAllString: Handler;
  updateVersion: Handler;
  cancelOperation: Handler;
}

export function registerOperationHandlers(handlers: OperationHandlers, trustedRoots?: string | readonly string[]): void {
  onValidated('extract', handlers.extract, trustedRoots);
  onValidated('apply', handlers.apply, trustedRoots);
  onValidated('eztrans', handlers.translate, trustedRoots);
  onValidated('changeAllString', handlers.changeAllString, trustedRoots);
  onValidated('updateVersion', handlers.updateVersion, trustedRoots);
  onValidated('cancelOperation', handlers.cancelOperation, trustedRoots);
}
