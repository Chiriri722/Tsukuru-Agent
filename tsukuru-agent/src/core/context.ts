/**
 * 작업 Context: 기존 globalThis 전역 상태(mwindow 제외)를 대체한다.
 * 깊은 legacy 함수는 ctx() 호환 경계를 사용하지만 서비스는 withOperationContext로
 * 범위를 명시한다. AsyncLocalStorage가 중첩·병렬 작업의 상태를 서로 격리한다.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { ProgressSink, Logger } from './types';
import { createOperationRuntime, OperationRuntime } from './operationRuntime';

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

export interface OperationContext extends OperationRuntime {
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
    suppliedRuntime?: OperationRuntime,
): OperationContext {
    const runtime = suppliedRuntime ?? createOperationRuntime({ progress, logger });
    return {
        ...runtime,
        rpg: init?.rpg ?? createRpgState(),
        wolf: init?.wolf ?? createWolfState(),
    };
}

const operationContextStorage = new AsyncLocalStorage<OperationContext>();

/** callback의 동기·비동기 수명에만 context를 연결하고 종료 시 부모 상태를 복원한다. */
export function withOperationContext<T>(context: OperationContext, callback: () => T): T {
    return operationContextStorage.run(context, callback);
}

export function hasActiveContext(): boolean {
    return operationContextStorage.getStore() !== undefined;
}

/** 현재 작업 Context. 미설정 상태에서 로직이 실행되면 즉시 실패시킨다. */
export function ctx(): OperationContext {
    const context = operationContextStorage.getStore();
    if (!context) {
        throw new Error('Operation context is not set. 서비스 경계가 withOperationContext()로 작업을 실행해야 합니다.');
    }
    return context;
}
