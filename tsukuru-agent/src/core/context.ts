/**
 * 작업 Context: 기존 globalThis 전역 상태(mwindow 제외)를 대체한다.
 *
 * 설계 결정(계획서 §구현 방향): GUI/CLI 모두 프로세스당 한 번에 하나의 작업만
 * 실행하므로(기존 GUI도 'worked' 플래그로 직렬화), 깊은 난수 로직(extract.ts 등)을
 * 모두 매개변수화하는 대신 명시적 Context 홀더를 사용한다.
 * - 로직 코드는 globalThis 대신 ctx()를 통해 상태에 접근한다.
 * - GUI adapter(Phase 8)와 CLI 진입점(Phase 6)이 작업 시작 전 setActiveContext()를 호출한다.
 * - 향후 동시 작업이 필요해지면 매개변수 전달로 단계적 이전 가능하다.
 */
import { ProgressSink, Logger } from './types';

/** datas.ts의 settings와 동형(느슨한 인덱스 시그니처 유지). */
export interface RpgSettings {
    [key: string]: any;
}

/** RPG MV/MZ 추출·적용 중 변경되는 작업 상태(기존 globalThis.gb/externMsg 대체). */
export interface RpgState {
    settings: RpgSettings;
    /** 파일명 → 추출 데이터/출력 텍스트 버퍼(기존 globalThis.gb). */
    gb: { [fileName: string]: any };
    externMsg: { [key: string]: string };
    useExternMsg: boolean;
    externMsgKeys: string[];
}

/** globals.d.ts의 lenStr과 동형. */
export interface WolfExtStr {
    pos1: number;
    pos2: number;
    pos3: number;
    str: Uint8Array;
    len: number;
}

/** globals.d.ts의 extData와 동형. */
export interface WolfExtDataEntry {
    str: WolfExtStr;
    sourceFile: string;
    extractFile: string;
    endsWithNull: boolean;
    textLineNumber: number[];
    codeStr: string;
}

/** Wolf 추출·적용 작업 상태(기존 globalThis.Wolf* / sourceDir 대체). */
export interface WolfState {
    sourceDir: string;
    metadata: { ver: 2 | 3 | -1 };
    extData: WolfExtDataEntry[];
    cache: { [file: string]: Buffer };
    /** wolf 복호화 키(기존 globalThis.keyvalue). */
    keyvalue?: unknown;
}

export interface OperationContext {
    progress: ProgressSink;
    logger: Logger;
    rpg: RpgState;
    wolf: WolfState;
}

export function createRpgState(settings?: RpgSettings): RpgState {
    return {
        settings: settings ?? {},
        gb: {},
        externMsg: {},
        useExternMsg: false,
        externMsgKeys: [],
    };
}

export function createWolfState(sourceDir: string = ''): WolfState {
    return {
        sourceDir,
        metadata: { ver: -1 },
        extData: [],
        cache: {},
    };
}

export function createOperationContext(
    progress: ProgressSink,
    logger: Logger,
    init?: { rpg?: RpgState; wolf?: WolfState },
): OperationContext {
    return {
        progress,
        logger,
        rpg: init?.rpg ?? createRpgState(),
        wolf: init?.wolf ?? createWolfState(),
    };
}

let activeContext: OperationContext | null = null;

/** 작업 시작 전에 호출. null이면 해제. */
export function setActiveContext(context: OperationContext | null): void {
    activeContext = context;
}

export function hasActiveContext(): boolean {
    return activeContext !== null;
}

/** 현재 작업 Context. 미설정 상태에서 로직이 실행되면 즉시 실패시킨다. */
export function ctx(): OperationContext {
    if (activeContext === null) {
        throw new Error('Operation context is not set. GUI adapter 또는 CLI가 작업 시작 전에 setActiveContext()를 호출해야 합니다.');
    }
    return activeContext;
}
