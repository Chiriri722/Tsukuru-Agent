import fs from 'fs';
import path from 'path';
import { DetectedProject } from './formatDetect';
import { selectEngineAdapter } from './engineRegistry';

export function gdevelopProjectRoot(detected: DetectedProject): string {
    const containerRoot = detected.container?.rootPath ?? path.dirname(detected.dataDir);
    const engineRoot = detected.container?.engine.root ?? '';
    const candidate = path.join(containerRoot, ...engineRoot.split('/').filter(Boolean));
    if (fs.existsSync(path.join(candidate, 'data.js')) || fs.existsSync(path.join(candidate, 'www', 'data.js'))) {
        return candidate;
    }
    return containerRoot;
}

export function tyranoProjectRoot(detected: DetectedProject): string {
    const containerRoot = detected.container?.rootPath ?? path.dirname(detected.dataDir);
    const engineRoot = detected.container?.engine.root ?? '';
    const candidate = path.join(containerRoot, engineRoot);
    if (path.basename(candidate).toLowerCase() === 'data' && fs.existsSync(path.join(candidate, 'scenario'))) {
        return path.dirname(candidate);
    }
    if (fs.existsSync(path.join(candidate, 'data', 'scenario'))) return candidate;
    if (path.basename(detected.dataDir).toLowerCase() === 'data'
        && fs.existsSync(path.join(detected.dataDir, 'scenario'))) {
        return path.dirname(detected.dataDir);
    }
    return containerRoot;
}

export function extractionWorkspacePath(detected: DetectedProject): string {
    const layout = selectEngineAdapter(detected).extractLayout;
    if (layout === 'gdevelop-root') return path.join(gdevelopProjectRoot(detected), '_Extract');
    return layout === 'rpg-data'
        ? path.join(detected.dataDir, 'Extract')
        : path.join(detected.dataDir, '_Extract');
}

export function patchWorkspacePath(detected: DetectedProject): string {
    const layout = selectEngineAdapter(detected).extractLayout;
    if (layout === 'tyrano-data') return path.join(tyranoProjectRoot(detected), 'data', '_Extract');
    if (layout === 'gdevelop-root') return path.join(gdevelopProjectRoot(detected), '_Extract');
    return extractionWorkspacePath(detected);
}
