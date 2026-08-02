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

export interface DetectedProject {
    format: DetectedFormat;
    /** RPG: data 폼더 / Wolf: data 폼더. */
    dataDir: string;
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

/** 판별 실패 시 null. */
export function detectFormat(projectPath: string): DetectedProject | null {
    const roots = [projectPath, path.join(projectPath, 'www')];

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
