import { RequestFormat } from '../core/schema';
import { DetectedProject } from './formatDetect';

export function isFormatCompatible(requested: RequestFormat, detected: DetectedProject): boolean {
    return requested === 'auto'
        || requested === detected.format
        || (requested === 'rpgmv' && detected.format === 'rpgmz')
        || (requested === 'rpgmz-electron' && detected.format === 'rpgmz')
        || (requested === 'gdevelop-electron' && detected.format === 'gdevelop')
        || (requested === 'nwjs-webgame' && detected.container?.type === 'nwjs-package');
}
