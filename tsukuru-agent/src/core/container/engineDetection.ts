import { EngineDetection } from './types';

function hasFile(entries: readonly string[], root: string, relative: string): boolean {
    const prefix = root ? root + '/' : '';
    return entries.includes(prefix + relative);
}

function hasUnder(entries: readonly string[], root: string, predicate: (entry: string) => boolean): boolean {
    const prefix = root ? root + '/' : '';
    return entries.some((entry) => entry.startsWith(prefix) && predicate(entry.slice(prefix.length)));
}

export function findNestedEngineRoot(entries: readonly string[]): string {
    const candidates = ['', 'project', 'www', 'game', 'app', 'data'];
    let best = '';
    let bestScore = -1;
    for (const candidate of candidates) {
        let score = 0;
        if (hasUnder(entries, candidate, (e) => e.startsWith('data/') && e.endsWith('.json'))) score += 4;
        if (hasFile(entries, candidate, 'js/rmmz_core.js')) score += 6;
        if (hasFile(entries, candidate, 'index.html')) score += 1;
        if (hasUnder(entries, candidate, (e) => e.startsWith('scenario/') && e.endsWith('.ks'))) score += 5;
        if (score > bestScore || (score > 0 && score === bestScore && candidate.length > best.length)) {
            best = candidate;
            bestScore = score;
        }
    }
    return best;
}

export function detectContainerEngine(entries: readonly string[], root: string): EngineDetection {
    const features: string[] = [];
    const hasRpgCore = hasFile(entries, root, 'js/rmmz_core.js');
    const hasRpgData = hasUnder(entries, root, (e) => e.startsWith('data/') && e.endsWith('.json'));
    const hasMvData = hasUnder(entries, root, (e) => e.startsWith('data/') && e.endsWith('.json'));
    const hasWolf = hasFile(entries, root, 'Data.wolf') || hasUnder(entries, root, (e) => e.endsWith('.mps'));
    const hasTyrano = hasUnder(entries, root, (e) => (e.startsWith('scenario/') || e.startsWith('data/scenario/')) && e.endsWith('.ks'));
    const hasGdevelop = hasUnder(entries, root, (e) => /(^|\/)gdjs(\/|$)|(^|\/)libs\/gdjs(\/|$)|(^|\/)code\d*\.js$/.test(e));
    const electronForMz = entries.some((e) => /(^|\/)ElectronForMz\.js$/i.test(e));

    if (hasRpgCore && hasRpgData) {
        if (electronForMz) features.push('electron-for-mz');
        if (entries.some((e) => /(^|\/)plugins\//i.test(e))) features.push('plugins');
        if (entries.some((e) => /live2d|cubism/i.test(e))) features.push('live2d');
        if (entries.some((e) => /effekseer/i.test(e))) features.push('effekseer');
        return {
            type: 'rpgmz',
            root,
            wrapper: electronForMz ? 'ElectronForMZ' : null,
            features,
            confidence: electronForMz ? 0.99 : 0.95,
        };
    }
    if (hasWolf) return { type: 'wolf', root, wrapper: null, features, confidence: 0.9 };
    if (hasTyrano) return { type: 'tyrano', root, wrapper: null, features, confidence: 0.9 };
    if (hasGdevelop) return { type: 'gdevelop', root, wrapper: null, features, confidence: 0.7 };
    if (hasMvData) return { type: 'rpgmv', root, wrapper: null, features, confidence: 0.65 };
    return { type: 'unknown', root, wrapper: null, features, confidence: 0 };
}
