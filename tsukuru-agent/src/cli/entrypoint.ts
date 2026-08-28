import fs from 'fs';
import { AgentResult, emptyResult } from '../core/schema';
import { ErrorCodes, OperationError, toOperationError } from '../core/types';
import { serializeAgentResult } from './presenter';

export interface CliIo {
    readRequest(source: string): string;
    writeStdout(text: string): void;
    redirectLegacyConsole(): void;
}

export type ExecuteAgentRequest = (request: unknown) => Promise<AgentResult>;

function usage(): string {
    return '사용법: tsukuru-agent run --request <request.json|->';
}

export function parseArgs(argv: string[]): string {
    const [command, ...rest] = argv;
    if (command !== 'run') {
        throw new OperationError(
            ErrorCodes.REQUEST_INVALID,
            `지원하지 않는 명령입니다: ${command ?? '(없음)'}. ${usage()}`,
        );
    }
    const requestIndex = rest.indexOf('--request');
    if (requestIndex < 0 || requestIndex + 1 >= rest.length) {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, `--request <file|-> 인수가 필요합니다. ${usage()}`);
    }
    return rest[requestIndex + 1];
}

export function loadRequest(source: string, io: CliIo): unknown {
    let raw: string;
    try {
        raw = io.readRequest(source);
    } catch (error) {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, `요청을 읽을 수 없습니다: ${source}`, {
            cause: String(error),
        });
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, '요청 JSON 파싱에 실패했습니다', {
            cause: String(error),
        });
    }
}

export const processCliIo: CliIo = {
    readRequest(source: string): string {
        return source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(source, 'utf8');
    },
    writeStdout(text: string): void {
        process.stdout.write(text);
    },
    redirectLegacyConsole(): void {
        console.log = console.error;
        console.info = console.error;
        console.warn = console.error;
        console.debug = console.error;
    },
};

export async function runCli(
    argv: string[],
    execute: ExecuteAgentRequest,
    io: CliIo = processCliIo,
): Promise<number> {
    io.redirectLegacyConsole();
    let result = emptyResult();
    try {
        result = await execute(loadRequest(parseArgs(argv), io));
    } catch (error) {
        const operationError = toOperationError(error);
        result.ok = false;
        result.error = operationError.toJSON();
    }
    io.writeStdout(serializeAgentResult(result));
    return result.ok ? 0 : 1;
}
