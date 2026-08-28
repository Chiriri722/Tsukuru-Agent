/**
 * Extract/manifest.json 스키마 및 해시 유틸리티 (계획서 §Manifest와 안전성).
 * Electron 비의존.
 */
import crypto from 'crypto';

export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_SCHEMA_VERSION = 1;

/** RPG MV/MZ 적용 메타데이터. */
export interface MvApplyMeta {
    /** 추출 분류 경로(script/javascript/note/note2/ext 등, 기존 qpath). */
    qpath: string;
    /** 이벤트 코드 등 부가 설정(기존 conf). */
    conf?: unknown;
    /** 다중 라인 항목의 종료 행 인덱스(기존 .extracteddata의 m). */
    endLine: number;
    /** 원본 JSON 파일이 다른 경우(기존 origin). */
    originFile?: string;
}

/** Wolf 바이너리 오프셋 메타데이터. */
export interface WolfBinaryMeta {
    sourceFile: string;
    pos1: number;
    pos2: number;
    pos3: number;
    len: number;
}

export interface TyranoApplyMeta {
    /** 원본 KS의 0-base 행과 UTF-16 column 범위(end 미포함). */
    line: number;
    start: number;
    end: number;
    /** 추출 시 원본 segment 해시. patch 후에도 바뀌지 않는다. */
    sourceHash: string;
}

export interface GDevelopApplyMeta {
    /** projectData JSON 또는 opt-in code literal. 누락은 기존 projectData entry로 해석한다. */
    kind?: 'project-data' | 'code-literal';
    /** gdjs.projectData 안의 RFC 6901 JSON Pointer. */
    jsonPointer?: string;
    /** 허용된 정적 텍스트 객체 타입과 필드. */
    objectType?: string;
    field?: string;
    /** 추출 당시 data.js 안 원문 해시. */
    sourceHash: string;
    sourceStart?: number;
    sourceEnd?: number;
    quote?: '"' | "'";
    callee?: 'setString' | 'setBBText';
    candidateIndex?: number;
}

export interface SourceSnapshot {
    hash: string;
    encoding: 'utf8' | 'shift_jis';
}

export interface ManifestEntry {
    /** 안정적인 항목 ID. MV: `<extractFile>#<jsonPath>`, Wolf: `<extractFile>#<index>`. */
    id: string;
    /** 원본 파일(프로젝트 기준 상대 경로). */
    sourceFile: string;
    /** 데이터 경로(MV: JSON 경로, Wolf: codeStr). */
    dataPath: string;
    /** 추출 텍스트 파일(Extract 폼더 기준 상대 경로). */
    extractFile: string;
    /** 추출 텍스트 줄 범위(0-base, end는 미포함). */
    lineStart: number;
    lineEnd: number;
    /** 원문 SHA-256(hex, 소문자). MV는 원문 문자열의 UTF-8, Wolf는 원본 바이트 기준. */
    hash: string;
    /** 텍스트 인코딩(utf8 | shift_jis). */
    encoding: string;
    /** 널 종료 여부. */
    nullTerminated: boolean;
    mv?: MvApplyMeta;
    wolf?: WolfBinaryMeta;
    tyrano?: TyranoApplyMeta;
    gdevelop?: GDevelopApplyMeta;
}

export interface ExtractManifest {
    schemaVersion: number;
    format: 'rpgmv' | 'wolf' | 'tyrano' | 'gdevelop';
    createdAt: string;
    entries: ManifestEntry[];
    sourceSnapshots?: Record<string, SourceSnapshot>;
}

export function createManifest(format: 'rpgmv' | 'wolf' | 'tyrano' | 'gdevelop'): ExtractManifest {
    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        format,
        createdAt: new Date().toISOString(),
        entries: [],
    };
}

/** 원문 문자열(UTF-8)의 SHA-256 hex. */
export function sha256Text(text: string): string {
    return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/** 바이너리의 SHA-256 hex. */
export function sha256Bytes(data: Buffer | Uint8Array): string {
    return crypto.createHash('sha256').update(data as Buffer).digest('hex');
}
