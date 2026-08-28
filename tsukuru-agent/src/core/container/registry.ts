import { asarContainerAdapter } from './adapters/asar';
import { directoryContainerAdapter } from './adapters/directory';
import { nwjsContainerAdapter } from './adapters/nwjs';
import { ContainerFormatAdapter, ContainerType, SupportedContainerType } from './types';

export const containerAdapterRegistry: Readonly<Record<SupportedContainerType, ContainerFormatAdapter>> = Object.freeze({
    directory: directoryContainerAdapter,
    'electron-asar': asarContainerAdapter,
    'nwjs-package': nwjsContainerAdapter,
});

export function getContainerAdapter(type: ContainerType): ContainerFormatAdapter {
    if (type === 'unknown') throw new Error('지원하지 않는 컨테이너입니다: ' + type);
    return containerAdapterRegistry[type];
}
