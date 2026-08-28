import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findLinkedPathComponent } from '../core/pathSafety';
import {
  mainToRendererChannels,
  rendererInvokeChannels,
  rendererToMainChannels,
  RendererInvokeChannel,
  RendererToMainChannel,
} from './ipcTypes';

export { mainToRendererChannels, rendererInvokeChannels, rendererToMainChannels };

type IpcRequestChannel = RendererToMainChannel | RendererInvokeChannel;

export class IpcPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'IpcPolicyError';
    this.code = code;
  }
}

const noPayload = new Set<string>([
  'license', 'settings', 'updatePage', 'closesettings', 'eztransHelp',
  'minimize', 'close', 'app_version', 'updates',
  'cancelOperation',
]);

const routeFiles = Object.freeze({
  home: ['src', 'html', 'simple', 'index.html'],
  rpg: ['src', 'html', 'main', 'index.html'],
  wolf: ['src', 'html', 'wolf', 'index.html'],
});

function invalid(channel: string): never {
  throw new IpcPolicyError('E_IPC_PAYLOAD_INVALID', `Invalid IPC payload for ${channel}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeRecord(value: unknown, channel: string): Record<string, unknown> {
  if (!isPlainRecord(value)) invalid(channel);
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    invalid(channel);
  }
  if (encoded.length > 2 * 1024 * 1024) invalid(channel);
  if (/"(?:__proto__|prototype|constructor)"\s*:/.test(encoded)) invalid(channel);
  return value;
}

function boundedString(value: unknown, channel: string, max = 32768): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) {
    invalid(channel);
  }
  return value;
}

function base64Path(value: unknown, channel: string): string {
  const encoded = boundedString(value, channel, 65536);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) invalid(channel);
  return encoded;
}

function decodedBase64Path(value: unknown, channel: string): string {
  const encoded = base64Path(value, channel);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64'));
  } catch {
    invalid(channel);
  }
}

function sameFilesystemPath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function resolveExistingRpgDataDirectory(value: unknown, channel: string): string {
  const candidate = boundedString(value, channel);
  if (!path.isAbsolute(candidate)) invalid(channel);
  const linkedPath = findLinkedPathComponent(candidate);
  if (linkedPath) {
    throw new IpcPolicyError('E_LOCAL_PATH_INVALID', 'RPG data directory must not cross a symbolic link or junction');
  }
  const canonical = resolveExistingLocalDirectory(candidate);
  if (path.basename(canonical).toLowerCase() !== 'data') {
    throw new IpcPolicyError('E_LOCAL_PATH_INVALID', 'RPG data directory must be named data');
  }
  return canonical;
}

function validateFontSizeChange(payload: unknown, channel: string): [string, number] {
  if (!Array.isArray(payload) || payload.length !== 2) invalid(channel);
  const fontSize = payload[1];
  if (!Number.isInteger(fontSize) || fontSize < 8 || fontSize > 128) invalid(channel);
  return [resolveExistingRpgDataDirectory(payload[0], channel), fontSize];
}

function validateBulkStringChange(payload: unknown, channel: string): Record<string, unknown> {
  const record = assertSafeRecord(payload, channel);
  base64Path(record.dir, channel);
  if (!Array.isArray(record.data) || record.data.length !== 2 ||
      record.data.some((item) => typeof item !== 'string' || item.length > 1024 * 1024)) invalid(channel);
  return record;
}

function validateWolfOperation(payload: unknown, channel: string): Record<string, unknown> {
  const record = assertSafeRecord(payload, channel);
  boundedString(record.folder, channel);
  assertSafeRecord(record.config, channel);
  return record;
}

function validateEncodedPathOperation(payload: unknown, channel: string): Record<string, unknown> {
  const record = assertSafeRecord(payload, channel);
  base64Path(record.dir, channel);
  return record;
}

function validateVersionUpdate(payload: unknown, channel: string): Record<string, unknown> {
  const record = assertSafeRecord(payload, channel);
  const operations = [record.dir1, record.dir2, record.dir3]
    .map((operation) => assertSafeRecord(operation, channel));
  assertSafeRecord(record.config, channel);
  const canonicalRoots = [record.dir1_base, record.dir2_base, record.dir3_base]
    .map((root) => resolveExistingLocalDirectory(boundedString(root, channel)));
  const operationRoots = operations
    .map((operation) => resolveExistingLocalDirectory(decodedBase64Path(operation.dir, channel)));
  if (canonicalRoots.some((root, index) => !sameFilesystemPath(root, operationRoots[index]))) {
    throw new IpcPolicyError('E_IPC_PAYLOAD_INVALID', 'Version workspace paths must match their encoded operations');
  }
  if (new Set(canonicalRoots.map((root) => root.toLowerCase())).size !== canonicalRoots.length) {
    throw new IpcPolicyError('E_IPC_PAYLOAD_INVALID', 'Version workspaces must be distinct');
  }
  return {
    ...record,
    dir1_base: canonicalRoots[0],
    dir2_base: canonicalRoots[1],
    dir3_base: canonicalRoots[2],
  };
}

export function validateIpcRequest(channel: string, payload: unknown): unknown {
  const requestChannels = [...rendererToMainChannels, ...rendererInvokeChannels] as readonly string[];
  if (!requestChannels.includes(channel)) {
    throw new IpcPolicyError('E_IPC_CHANNEL_UNKNOWN', `Unknown IPC channel: ${channel}`);
  }
  const typedChannel = channel as IpcRequestChannel;
  if (noPayload.has(typedChannel)) {
    if (payload !== undefined && payload !== null) invalid(channel);
    return undefined;
  }

  switch (typedChannel) {
    case 'changeLang':
      if (payload !== 'ko' && payload !== 'en') invalid(channel);
      return payload;
    case 'changeURL':
      if (!Object.prototype.hasOwnProperty.call(routeFiles, payload as PropertyKey)) invalid(channel);
      return payload;
    case 'select_folder':
      if (!['folder_input', 'swi1', 'swi2', 'swi3'].includes(payload as string)) invalid(channel);
      return payload;
    case 'setheight':
      if (!Number.isInteger(payload) || (payload as number) < 320 || (payload as number) > 1200) invalid(channel);
      return payload;
    case 'openFolder':
    case 'gamePatcher':
    case 'projectConvert':
      return boundedString(payload, channel);
    case 'selFont':
      return resolveExistingRpgDataDirectory(payload, channel);
    case 'getextention':
      if (payload !== 'wolfdec' && payload !== 'none') invalid(channel);
      return payload;
    case 'log':
      if (!['string', 'number', 'boolean', 'undefined'].includes(typeof payload) && payload !== null) invalid(channel);
      return payload;
    case 'changeFontSize':
      return validateFontSizeChange(payload, channel);
    case 'changeAllString':
      return validateBulkStringChange(payload, channel);
    case 'wolf_ext':
    case 'wolf_apply':
      return validateWolfOperation(payload, channel);
    case 'extract':
    case 'apply':
    case 'eztrans':
      return validateEncodedPathOperation(payload, channel);
    case 'applysettings':
      return assertSafeRecord(payload, channel);
    case 'updateVersion':
      return validateVersionUpdate(payload, channel);
    default:
      invalid(channel);
  }
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function assertTrustedSender(
  event: { sender?: { getURL?: () => string; isDestroyed?: () => boolean } },
  appRoot: string | readonly string[],
): void {
  if (!event?.sender || typeof event.sender.getURL !== 'function' || event.sender.isDestroyed?.()) {
    throw new IpcPolicyError('E_IPC_SENDER_INVALID', 'IPC sender is not trusted');
  }
  let senderPath: string;
  try {
    const senderUrl = new URL(event.sender.getURL());
    if (senderUrl.protocol !== 'file:' || senderUrl.username || senderUrl.password) throw new Error('not local');
    senderPath = path.resolve(fileURLToPath(senderUrl));
  } catch {
    throw new IpcPolicyError('E_IPC_SENDER_INVALID', 'IPC sender is not a trusted local document');
  }
  const roots = (Array.isArray(appRoot) ? appRoot : [appRoot]).map((root) => path.resolve(root));
  if (!roots.some((root) => isWithin(root.toLowerCase(), senderPath.toLowerCase()))) {
    throw new IpcPolicyError('E_IPC_SENDER_INVALID', 'IPC sender is outside the application root');
  }
}

export function resolveRendererRoute(routeId: string, appRoot: string): string {
  const parts = routeFiles[routeId as keyof typeof routeFiles];
  if (!parts) throw new IpcPolicyError('E_IPC_ROUTE_INVALID', 'Renderer route is not allowed');
  return path.join(appRoot, ...parts);
}

export function validateExternalUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new IpcPolicyError('E_EXTERNAL_URL_INVALID', 'External URL is invalid');
  }
  if (parsed.protocol !== 'https:') {
    throw new IpcPolicyError('E_EXTERNAL_URL_INVALID', 'External URL must use HTTPS');
  }
  const approvedHosts = new Set(['github.com', 'dotnet.microsoft.com']);
  if (!approvedHosts.has(parsed.hostname) || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    throw new IpcPolicyError('E_EXTERNAL_URL_INVALID', 'External URL host is not allowed');
  }
  return parsed.toString();
}

export function resolveExistingLocalDirectory(value: string): string {
  const candidate = boundedString(value, 'openFolder');
  if (!path.isAbsolute(candidate)) {
    throw new IpcPolicyError('E_LOCAL_PATH_INVALID', 'Local directory must be absolute');
  }
  let canonical: string;
  try {
    canonical = fs.realpathSync(candidate);
    if (!fs.statSync(canonical).isDirectory()) throw new Error('not directory');
  } catch {
    throw new IpcPolicyError('E_LOCAL_PATH_INVALID', 'Local directory does not exist');
  }
  return canonical;
}
