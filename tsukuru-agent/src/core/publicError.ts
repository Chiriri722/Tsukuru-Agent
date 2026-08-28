const WINDOWS_ABSOLUTE_PATH = /(?:[A-Za-z]:[\\/]|\\\\)[^\r\n\t"'<>|]*/g;
const FILE_URL = /file:\/\/\/[^\r\n\t"'<>|]*/gi;
const COMMON_POSIX_PATH = /\/(?:home|Users|tmp|var|opt|mnt|media)\/[^\r\n\t"'<>|]*/g;

export function publicErrorMessage(error: unknown, fallback = 'The GUI operation failed.'): string {
  if (!(error instanceof Error) || typeof error.message !== 'string' || error.message.trim().length === 0) {
    return fallback;
  }
  const sanitized = error.message
    .replace(FILE_URL, '[path]')
    .replace(WINDOWS_ABSOLUTE_PATH, '[path]')
    .replace(COMMON_POSIX_PATH, '[path]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  if (!sanitized) return fallback;
  return sanitized.slice(0, 500);
}
