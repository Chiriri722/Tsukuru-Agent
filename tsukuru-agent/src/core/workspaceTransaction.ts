import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ErrorCodes, OperationError } from './types';
import { throwIfSignalAborted } from './operationRuntime';
import { findLinkedPathComponent } from './pathSafety';
import { ArtifactReplacement, replaceArtifactPathsSync } from './atomic';

export interface WorkspaceTransactionOptions {
    outputPath: string;
    force?: boolean;
    signal?: AbortSignal;
}

type TransactionState = 'active' | 'committed' | 'rolled-back' | 'failed';

function assertReplaceableOutput(outputPath: string, force: boolean): void {
    if (path.parse(outputPath).root === outputPath) {
        throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, '파일시스템 루트는 출력 경로로 사용할 수 없습니다');
    }
    const linkedParent = findLinkedPathComponent(path.dirname(outputPath));
    if (linkedParent) {
        throw new OperationError(
            ErrorCodes.OUTPUT_CONFLICT,
            '출력 경로의 상위 디렉터리에 심볼릭 링크/정션이 있습니다',
            { outputPath, linkedParent },
        );
    }
    if (!fs.existsSync(outputPath)) return;
    const stat = fs.lstatSync(outputPath);
    if (stat.isSymbolicLink()) {
        throw new OperationError(
            ErrorCodes.OUTPUT_CONFLICT,
            '심볼릭 링크/정션은 출력 경로로 교체할 수 없습니다',
            { outputPath },
        );
    }
    if (!stat.isDirectory()) {
        throw new OperationError(
            ErrorCodes.OUTPUT_CONFLICT,
            '기존 출력 경로가 디렉터리가 아닌 파일입니다',
            { outputPath },
        );
    }
    if (!force) {
        throw new OperationError(
            ErrorCodes.OUTPUT_CONFLICT,
            '출력 경로가 이미 존재합니다',
            { outputPath },
        );
    }
}

export class WorkspaceTransaction {
    readonly outputPath: string;
    readonly stagingPath: string;
    readonly backupPath: string;
    private readonly force: boolean;
    private readonly signal?: AbortSignal;
    private state: TransactionState = 'active';

    constructor(options: WorkspaceTransactionOptions) {
        this.outputPath = path.resolve(options.outputPath);
        this.force = options.force === true;
        this.signal = options.signal;
        throwIfSignalAborted(this.signal, 'transaction-create');
        assertReplaceableOutput(this.outputPath, this.force);
        const parent = path.dirname(this.outputPath);
        fs.mkdirSync(parent, { recursive: true });
        const transactionId = crypto.randomUUID();
        const base = path.basename(this.outputPath);
        this.stagingPath = path.join(parent, `.${base}.tsukuru-stage-${transactionId}`);
        this.backupPath = path.join(parent, `.${base}.tsukuru-backup-${transactionId}`);
        fs.mkdirSync(this.stagingPath);
    }

    commit(additionalArtifacts: ArtifactReplacement[] = []): void {
        if (this.state !== 'active') {
            throw new OperationError(ErrorCodes.INTERNAL, `workspace transaction is not active: ${this.state}`);
        }
        if (!fs.existsSync(this.stagingPath) || !fs.lstatSync(this.stagingPath).isDirectory()) {
            this.state = 'failed';
            throw new OperationError(ErrorCodes.INTERNAL, 'workspace transaction staging directory is missing');
        }
        throwIfSignalAborted(this.signal, 'transaction-commit');
        assertReplaceableOutput(this.outputPath, this.force);
        if (additionalArtifacts.length > 0) {
            try {
                replaceArtifactPathsSync([
                    ...additionalArtifacts,
                    { staged: this.stagingPath, target: this.outputPath },
                ]);
                this.state = 'committed';
            } catch (error) {
                this.state = 'failed';
                throw error;
            }
            return;
        }
        const hadOutput = fs.existsSync(this.outputPath);
        if (hadOutput) fs.renameSync(this.outputPath, this.backupPath);
        try {
            fs.renameSync(this.stagingPath, this.outputPath);
            this.state = 'committed';
        } catch (error) {
            this.state = 'failed';
            if (hadOutput && fs.existsSync(this.backupPath) && !fs.existsSync(this.outputPath)) {
                try {
                    fs.renameSync(this.backupPath, this.outputPath);
                } catch (recoveryError) {
                    if (error instanceof Error) {
                        try {
                            Object.defineProperty(error, 'recoveryError', {
                                value: recoveryError,
                                enumerable: false,
                                configurable: true,
                            });
                        } catch { /* 최초 커밋 오류를 그대로 보존한다. */ }
                    }
                }
            }
            throw error;
        }
        if (fs.existsSync(this.backupPath)) {
            try {
                fs.rmSync(this.backupPath, { recursive: true, force: true });
            } catch { /* 새 출력은 이미 커밋됐으므로 복구 가능한 backup을 남긴다. */ }
        }
    }

    rollback(): void {
        if (this.state === 'committed' || this.state === 'rolled-back') return;
        if (fs.existsSync(this.backupPath) && !fs.existsSync(this.outputPath)) {
            fs.renameSync(this.backupPath, this.outputPath);
        }
        this.state = 'rolled-back';
        if (fs.existsSync(this.stagingPath)) {
            fs.rmSync(this.stagingPath, { recursive: true, force: true });
        }
    }

    dispose(): void {
        if (this.state === 'active' || this.state === 'failed') {
            try {
                this.rollback();
            } catch { /* dispose는 원래 작업의 성공/실패를 cleanup 오류로 덮지 않는다. */ }
        }
        if (fs.existsSync(this.stagingPath)) {
            try {
                fs.rmSync(this.stagingPath, { recursive: true, force: true });
            } catch { /* 복구 가능한 staging을 남기고 원래 결과를 유지한다. */ }
        }
        if (this.state === 'committed' && fs.existsSync(this.backupPath)) {
            try {
                fs.rmSync(this.backupPath, { recursive: true, force: true });
            } catch { /* 커밋 결과를 cleanup 실패로 뒤집지 않는다. */ }
        }
    }
}
