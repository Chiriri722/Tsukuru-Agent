import { BrowserWindow, shell } from 'electron';
import path from 'path';
import { handleValidated, onValidated } from '../ipcRegistration';
import {
  resolveExistingLocalDirectory,
  resolveRendererRoute,
  validateExternalUrl,
} from '../ipcPolicy';
import { createSecureWindow } from '../windowFactory';

export interface WindowHandlerDependencies {
  appRoot: string;
  iconPath: string;
  releasesUrl: string;
  supportUrl: string;
  getVersion(): string;
  getMainWindow(): BrowserWindow;
}

export function registerWindowHandlers(deps: WindowHandlerDependencies): void {
  onValidated('license', () => {
    const licenseWindow = createSecureWindow({
      width: 800,
      height: 400,
      resizable: true,
      autoHideMenuBar: true,
      icon: deps.iconPath,
    });
    licenseWindow.setMenu(null);
    void licenseWindow.loadFile(path.join(deps.appRoot, 'src/html/license.html'));
    licenseWindow.show();
  });

  onValidated('changeURL', (_event, routeId) => {
    return deps.getMainWindow().loadFile(resolveRendererRoute(routeId, deps.appRoot));
  });

  onValidated('updatePage', () => shell.openExternal(validateExternalUrl(`${deps.releasesUrl}/latest`)));
  onValidated('eztransHelp', () => shell.openExternal(validateExternalUrl(deps.supportUrl)));
  onValidated('updates', () => shell.openExternal(validateExternalUrl(deps.releasesUrl)));

  onValidated('minimize', () => deps.getMainWindow().minimize());
  onValidated('close', () => deps.getMainWindow().close());
  onValidated('app_version', (event) => {
    event.sender.send('app_version', { version: deps.getVersion() });
  });

  handleValidated('openFolder', async (_event, requestedPath) => {
    const errorMessage = await shell.openPath(resolveExistingLocalDirectory(requestedPath));
    if (errorMessage) throw new Error('The local directory could not be opened.');
  });

  onValidated('setheight', (_event, height) => {
    const window = deps.getMainWindow();
    window.setResizable(true);
    window.setSize(800, height, false);
    window.setResizable(false);
  });
}
