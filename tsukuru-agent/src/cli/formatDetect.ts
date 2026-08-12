/**
 * 프로젝트 포맷 판별 및 경로 정규화 (계획서 §CLI 계약 format:auto).
 * Electron 비의존.
 *
 * 판별 순서(Key Question 5 결정):
 * 1. Wolf 마커 우선(.wolf 아카이브, data 폼더 내 .mps) — 더 특징적
 * 2. RPG MV/MZ 마커(data 폼더 내 .json)
 * 3. projectPath 자체가 data 폼더인 경우
 */
import fs from 'fs';
import path from 'path';
import { DetectedFormat } from '../core/schema';
import { ContainerInfo, inspectContainer } from '../core/container';

export interface DetectedProject {
    format: DetectedFormat;
    /** RPG: data 폼더 / Wolf: data 폼더. */
    dataDir: string;
    /** v2 컨테이너 진단. v1 호출에서는 생략될 수 있다. */
    container?: ContainerInfo;
}

function isDir(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function isFile(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

function containsExt(dir: string, ext: string): boolean {
    try {
        return fs.readdirSync(dir).some((f) => f.toLowerCase().endsWith(ext));
    } catch {
        return false;
    }
}

function isPortableRpgExtractionPack(projectPath: string): boolean {
    return isDir(projectPath)
        && isDir(path.join(projectPath, 'Backup'))
        && containsExt(path.join(projectPath, 'Backup'), '.json')
        && isFile(path.join(projectPath, 'Extract', 'manifest.json'));
}

/** 판별 실패 시 null. */
export function detectFormat(projectPath: string): DetectedProject | null {
    const roots = [projectPath, path.join(projectPath, 'www')];

    // 원본 data 폴더에서 Backup/Extract/.extracteddata만 따로 옮긴 휴대용 작업 팩.
    if (isPortableRpgExtractionPack(projectPath)) {
        return { format: 'rpgmv', dataDir: projectPath };
    }

    // 1. Wolf 마커
    for (const root of roots) {
        if (!isDir(root)) {
            continue;
        }
        if (isFile(path.join(root, 'Data.wolf'))) {
            const dd = ['data', 'Data'].map((n) => path.join(root, n)).find(isDir);
            if (dd) {
                return { format: 'wolf', dataDir: dd };
            }
        }
        for (const name of ['data', 'Data']) {
            const dd = path.join(root, name);
            if (isDir(dd) && containsExt(dd, '.mps')) {
                return { format: 'wolf', dataDir: dd };
            }
        }
    }

    // 2. RPG MV/MZ 마커
    for (const root of roots) {
        if (!isDir(root)) {
            continue;
        }
        for (const name of ['data', 'Data']) {
            const dd = path.join(root, name);
            if (isDir(dd) && containsExt(dd, '.json')) {
                return { format: 'rpgmv', dataDir: dd };
            }
        }
    }

    // 3. projectPath 자체가 data 폼더
    if (isDir(projectPath)) {
        if (containsExt(projectPath, '.mps')) {
            return { format: 'wolf', dataDir: projectPath };
        }
        if (containsExt(projectPath, '.json')) {
            return { format: 'rpgmv', dataDir: projectPath };
        }
    }
    return null;
}

/** v2 탐지: loose directory와 Electron/NW.js wrapper를 엔진 프로파일로 정규화한다. */
export function detectProject(projectPath: string): DetectedProject | null {
    const container = inspectContainer(projectPath);
    const engine = container.engine.type;
    if (engine !== 'unknown') {
        const base = path.join(container.rootPath, container.engine.root);
        const dataCandidates = [
            path.join(base, 'data'),
            path.join(base, 'Data'),
            path.join(container.rootPath, 'www', 'data'),
            path.join(container.rootPath, 'www', 'Data'),
        ];
        const dataDir = container.type === 'electron-asar'
            ? path.join(base, 'data')
            : (dataCandidates.find(isDir) ?? path.join(base, 'data'));
        return { format: engine as DetectedFormat, dataDir, container };
    }
    const legacy = detectFormat(projectPath);
    return legacy ? { ...legacy, container } : null;
}
