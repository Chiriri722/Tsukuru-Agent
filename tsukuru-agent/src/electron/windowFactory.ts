import { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import path from 'path';

export interface SecureWindowOptions extends BrowserWindowConstructorOptions {
  bridge?: boolean;
  allowedNavigationHosts?: readonly string[];
}

export function createSecureWindow(options: SecureWindowOptions = {}): BrowserWindow {
  const {
    bridge = true,
    allowedNavigationHosts = [],
    webPreferences = {},
    ...windowOptions
  } = options;

  const preload = bridge ? path.join(__dirname, 'preload.js') : undefined;
  const securePreferences: Electron.WebPreferences = {
    ...webPreferences,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: false,
  };
  if (preload) securePreferences.preload = preload;
  else delete securePreferences.preload;

  const window = new BrowserWindow({
    ...windowOptions,
    webPreferences: securePreferences,
  });

  const navigationAllowed = (rawUrl: string): boolean => {
    try {
      const parsed = new URL(rawUrl);
      return parsed.protocol === 'https:' && allowedNavigationHosts.includes(parsed.hostname);
    } catch {
      return false;
    }
  };

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!navigationAllowed(url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  return window;
}
