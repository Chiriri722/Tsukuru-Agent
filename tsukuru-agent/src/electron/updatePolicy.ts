export const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/Chiriri722/Tsukuru-Agent/main/tsukuru-agent/version.json';
export const UPDATE_TIMEOUT_MS = 5000;

export type UpdateStatus = 'update-available' | 'current' | 'offline' | 'invalid-response';

export interface UpdateCheckResult {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
}

export interface UpdateResponse {
  status: number;
  data: unknown;
}

export type UpdateGetter = (
  url: string,
  options: { timeout: number; maxRedirects: number; responseType: 'json' },
) => Promise<UpdateResponse>;

export function parseVersion(value: unknown): [number, number, number] {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error('Version must be a canonical numeric semantic version');
  }
  const parts = value.split('.').map(Number) as [number, number, number];
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error('Version component is outside the safe integer range');
  }
  return parts;
}

export function compareVersions(left: string, right: string): -1 | 0 | 1 {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

function responseVersion(response: UpdateResponse): string | undefined {
  if (response?.status !== 200 || response.data === null || typeof response.data !== 'object' || Array.isArray(response.data)) {
    return undefined;
  }
  const version = (response.data as { version?: unknown }).version;
  try {
    parseVersion(version);
    return version as string;
  } catch {
    return undefined;
  }
}

export async function checkForUpdate(currentVersion: string, get: UpdateGetter): Promise<UpdateCheckResult> {
  parseVersion(currentVersion);
  let response: UpdateResponse;
  try {
    response = await get(UPDATE_MANIFEST_URL, {
      timeout: UPDATE_TIMEOUT_MS,
      maxRedirects: 0,
      responseType: 'json',
    });
  } catch {
    return { status: 'offline', currentVersion };
  }
  const latestVersion = responseVersion(response);
  if (!latestVersion) return { status: 'invalid-response', currentVersion };
  return {
    status: compareVersions(currentVersion, latestVersion) < 0 ? 'update-available' : 'current',
    currentVersion,
    latestVersion,
  };
}
