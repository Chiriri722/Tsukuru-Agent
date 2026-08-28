export type ProtectedPathProfile = 'electron-rpg' | 'gdevelop';

export const protectedPathProfiles: Readonly<Record<ProtectedPathProfile, readonly RegExp[]>> = Object.freeze({
    'electron-rpg': Object.freeze([
        /(^|\/)(package\.json|main\.js|preload[^/]*\.js|ElectronForMz\.js|js\/rmmz_[^/]*\.js|js\/plugins\.js|www\/js\/rmmz_[^/]*\.js)$/i,
    ]),
    gdevelop: Object.freeze([
        /(^|\/)(gdjs|libs\/gdjs|Extensions)\/.*\.js$/i,
        /(^|\/)code\d*\.js$/i,
    ]),
});

export function matchesProtectedPath(
    filePath: string,
    profiles: readonly ProtectedPathProfile[] = ['electron-rpg', 'gdevelop'],
): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return profiles.some((profile) => protectedPathProfiles[profile].some((pattern) => pattern.test(normalized)));
}
