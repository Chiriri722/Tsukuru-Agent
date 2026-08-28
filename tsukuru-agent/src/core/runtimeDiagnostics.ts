import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import * as asar from '@electron/asar';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { FuseState } from '@electron/fuses/dist/constants';
import { NtExecutable, NtExecutableResource } from 'resedit';

export interface ElectronExecutableSelection {
    primary: string | null;
    candidates: string[];
}

export type PublicFuseState = 'enabled' | 'disabled' | 'removed' | 'inherited' | 'unknown';

export interface ElectronFuseInspection {
    status: 'detected' | 'unavailable';
    version: string | null;
    runAsNode: PublicFuseState;
    embeddedAsarIntegrityValidation: PublicFuseState;
    onlyLoadAppFromAsar: PublicFuseState;
    error?: string;
}

export interface WindowsAsarIntegrityInspection {
    status: 'matched' | 'mismatch' | 'absent' | 'unreadable';
    archiveHeaderSha256: string;
    embeddedValue: string | null;
    embeddedAlgorithm: string | null;
    embeddedFile: string | null;
    matched: boolean | null;
    error?: string;
}

export type AuthenticodeStatus =
    | 'valid'
    | 'not-signed'
    | 'hash-mismatch'
    | 'not-trusted'
    | 'unsupported-format'
    | 'incompatible'
    | 'unknown'
    | 'unavailable';

export interface WindowsSignatureInspection {
    status: AuthenticodeStatus;
    rawStatus: string | null;
    statusMessage: string | null;
    subject: string | null;
    thumbprint: string | null;
    trusted: boolean | null;
    error?: string;
}

export type LaunchProbeStatus = 'running' | 'exited-ok' | 'exited-error' | 'failed';

export interface LaunchProbeOptions {
    timeoutMs?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    maxOutputBytes?: number;
}

export interface LaunchProbeResult {
    status: LaunchProbeStatus;
    executable: string;
    timeoutMs: number;
    elapsedMs: number;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    terminatedByProbe: boolean;
    stdout: string;
    stderr: string;
    error?: string;
}

export interface ElectronRuntimeInspection {
    executable: string | null;
    executableCandidates: string[];
    fuses: ElectronFuseInspection | null;
    asarIntegrity: WindowsAsarIntegrityInspection | null;
    signature: WindowsSignatureInspection | null;
    launchProbe: LaunchProbeResult | null;
    blocked: boolean;
    blockReason: string | null;
    risk: 'low' | 'warning' | 'critical' | 'unassessed';
    warnings: string[];
}

const EXCLUDED_EXECUTABLE = /^(?:update|squirrel|crashpad_handler|notification_helper|unins\d*|uninstall(?:er)?)(?:[-_.].*)?\.exe$/i;

export function findElectronExecutables(rootPath: string): ElectronExecutableSelection {
    const root = path.resolve(rootPath);
    if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) return { primary: null, candidates: [] };
    const candidates = fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && !EXCLUDED_EXECUTABLE.test(entry.name))
        .map((entry) => path.join(root, entry.name))
        .sort((left, right) => fs.statSync(right).size - fs.statSync(left).size || left.localeCompare(right));
    return { primary: candidates[0] ?? null, candidates };
}

export function calculateAsarHeaderSha256(archivePath: string): string {
    return crypto.createHash('sha256').update(asar.getRawHeader(path.resolve(archivePath)).headerString).digest('hex');
}

function normalizeWindowsResourcePath(value: string): string {
    return value.replace(/\//g, '\\').replace(/^\.\\/, '').toLowerCase();
}

function resourceNameMatches(value: string | number, expected: string): boolean {
    return typeof value === 'string' && value.toUpperCase() === expected;
}

export function inspectWindowsAsarIntegrity(
    executablePath: string,
    archivePath: string,
    archiveRelativePath = 'resources\\app.asar',
): WindowsAsarIntegrityInspection {
    const archiveHeaderSha256 = calculateAsarHeaderSha256(archivePath);
    const absent = (): WindowsAsarIntegrityInspection => ({
        status: 'absent',
        archiveHeaderSha256,
        embeddedValue: null,
        embeddedAlgorithm: null,
        embeddedFile: null,
        matched: null,
    });

    try {
        const executable = NtExecutable.from(fs.readFileSync(path.resolve(executablePath)), { ignoreCert: true });
        const resources = NtExecutableResource.from(executable, true);
        const entries = resources.entries.filter((entry) =>
            resourceNameMatches(entry.type, 'INTEGRITY') && resourceNameMatches(entry.id, 'ELECTRONASAR'));
        if (entries.length === 0) return absent();

        const expectedFile = normalizeWindowsResourcePath(archiveRelativePath);
        let parseError: unknown;
        for (const entry of entries) {
            try {
                const raw = Buffer.from(entry.bin).toString('utf8').replace(/^\uFEFF/, '').replace(/\0+$/, '');
                const records = JSON.parse(raw) as unknown;
                if (!Array.isArray(records)) throw new Error('ElectronAsar integrity resource is not an array');
                const record = records.find((item): item is { file: string; alg: string; value: string } => {
                    if (!item || typeof item !== 'object') return false;
                    const candidate = item as Record<string, unknown>;
                    return typeof candidate.file === 'string'
                        && typeof candidate.alg === 'string'
                        && typeof candidate.value === 'string'
                        && normalizeWindowsResourcePath(candidate.file) === expectedFile;
                });
                if (!record) continue;

                const matched = record.alg.toLowerCase() === 'sha256'
                    && record.value.toLowerCase() === archiveHeaderSha256.toLowerCase();
                return {
                    status: matched ? 'matched' : 'mismatch',
                    archiveHeaderSha256,
                    embeddedValue: record.value,
                    embeddedAlgorithm: record.alg,
                    embeddedFile: record.file,
                    matched,
                };
            } catch (err) {
                parseError = err;
            }
        }

        if (parseError) {
            return {
                ...absent(),
                status: 'unreadable',
                error: parseError instanceof Error ? parseError.message : String(parseError),
            };
        }
        return absent();
    } catch (err) {
        return {
            ...absent(),
            status: 'unreadable',
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

export function normalizeAuthenticodeStatus(status: string): AuthenticodeStatus {
    switch (status.toLowerCase()) {
        case 'valid': return 'valid';
        case 'notsigned': return 'not-signed';
        case 'hashmismatch': return 'hash-mismatch';
        case 'nottrusted': return 'not-trusted';
        case 'notsupportedfileformat': return 'unsupported-format';
        case 'incompatible': return 'incompatible';
        case 'unknownerror':
        default: return 'unknown';
    }
}

export function inspectWindowsSignature(executablePath: string): WindowsSignatureInspection {
    const unavailable = (error: string): WindowsSignatureInspection => ({
        status: 'unavailable',
        rawStatus: null,
        statusMessage: null,
        subject: null,
        thumbprint: null,
        trusted: null,
        error,
    });
    if (process.platform !== 'win32') return unavailable('Authenticode inspection is only available on Windows');

    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const modernPowerShell = path.join(programFiles, 'PowerShell', '7', 'pwsh.exe');
    const bundledPowerShell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const powerShell = fs.existsSync(modernPowerShell)
        ? modernPowerShell
        : (fs.existsSync(bundledPowerShell) ? bundledPowerShell : 'powershell.exe');
    const script = [
        '& {',
        '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
        '$signature = Get-AuthenticodeSignature -LiteralPath $env:TSUKURU_AGENT_SIGNATURE_TARGET',
        '$subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }',
        '$thumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }',
        '[pscustomobject]@{ Status = [string]$signature.Status; StatusMessage = $signature.StatusMessage; Subject = $subject; Thumbprint = $thumbprint } | ConvertTo-Json -Compress',
        '}',
    ].join('\n');
    const completed = spawnSync(powerShell, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
    ], {
        encoding: 'utf8',
        env: { ...process.env, TSUKURU_AGENT_SIGNATURE_TARGET: path.resolve(executablePath) },
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
    });
    if (completed.error) return unavailable(completed.error.message);
    if (completed.status !== 0) {
        return unavailable((completed.stderr || `PowerShell exited with code ${String(completed.status)}`).trim());
    }

    try {
        const parsed = JSON.parse(completed.stdout.trim()) as Record<string, unknown>;
        const rawStatus = typeof parsed.Status === 'string' ? parsed.Status : '';
        if (rawStatus === '') return unavailable('Authenticode returned an empty status');
        const status = normalizeAuthenticodeStatus(rawStatus);
        return {
            status,
            rawStatus,
            statusMessage: typeof parsed.StatusMessage === 'string' ? parsed.StatusMessage : null,
            subject: typeof parsed.Subject === 'string' ? parsed.Subject : null,
            thumbprint: typeof parsed.Thumbprint === 'string' ? parsed.Thumbprint : null,
            trusted: status === 'valid' ? true : (status === 'unavailable' || status === 'unknown' ? null : false),
        };
    } catch (err) {
        return unavailable(`Authenticode result parsing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

function appendBounded(current: string, chunk: Buffer | string, maxBytes: number): string {
    if (Buffer.byteLength(current, 'utf8') >= maxBytes) return current;
    const available = maxBytes - Buffer.byteLength(current, 'utf8');
    return current + Buffer.from(chunk).subarray(0, available).toString('utf8');
}

export function runLaunchProbe(
    executablePath: string,
    args: string[] = [],
    options: LaunchProbeOptions = {},
): Promise<LaunchProbeResult> {
    const executable = path.resolve(executablePath);
    const timeoutMs = Math.max(50, Math.trunc(options.timeoutMs ?? 3_000));
    const maxOutputBytes = Math.max(1024, Math.trunc(options.maxOutputBytes ?? 64 * 1024));
    const terminationGraceMs = 1_000;
    const startedAt = Date.now();
    const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    delete env.NODE_EXTRA_CA_CERTS;

    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        let terminatedByProbe = false;
        let child: ReturnType<typeof spawn>;
        let observationTimer: ReturnType<typeof setTimeout> | undefined;
        let terminationTimer: ReturnType<typeof setTimeout> | undefined;

        const finish = (partial: Omit<LaunchProbeResult, 'executable' | 'timeoutMs' | 'elapsedMs' | 'stdout' | 'stderr'>) => {
            if (settled) return;
            settled = true;
            if (observationTimer) clearTimeout(observationTimer);
            if (terminationTimer) clearTimeout(terminationTimer);
            resolve({
                ...partial,
                executable,
                timeoutMs,
                elapsedMs: Date.now() - startedAt,
                stdout,
                stderr,
            });
        };

        try {
            child = spawn(executable, args, {
                cwd: options.cwd ? path.resolve(options.cwd) : path.dirname(executable),
                env,
                shell: false,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (err) {
            finish({
                status: 'failed',
                exitCode: null,
                signal: null,
                timedOut: false,
                terminatedByProbe: false,
                error: err instanceof Error ? err.message : String(err),
            });
            return;
        }

        child.stdout?.on('data', (chunk: Buffer | string) => {
            stdout = appendBounded(stdout, chunk, maxOutputBytes);
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
            stderr = appendBounded(stderr, chunk, maxOutputBytes);
        });
        child.once('error', (err) => {
            finish({
                status: 'failed',
                exitCode: null,
                signal: null,
                timedOut,
                terminatedByProbe,
                error: err.message,
            });
        });
        child.once('exit', (exitCode, signal) => {
            if (timedOut) terminatedByProbe = true;
            finish({
                status: timedOut ? 'running' : (exitCode === 0 ? 'exited-ok' : 'exited-error'),
                exitCode: timedOut ? null : exitCode,
                signal: timedOut ? null : signal,
                timedOut,
                terminatedByProbe,
            });
        });

        observationTimer = setTimeout(() => {
            if (settled || child.exitCode !== null || child.signalCode !== null) return;
            timedOut = true;
            if (process.platform === 'win32' && child.pid) {
                const treeKill = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
                    windowsHide: true,
                    stdio: 'ignore',
                    timeout: 5_000,
                });
                terminatedByProbe = treeKill.status === 0;
            }
            if (!terminatedByProbe) terminatedByProbe = child.kill();
            if (child.exitCode !== null || child.signalCode !== null) {
                terminatedByProbe = true;
                finish({
                    status: 'running',
                    exitCode: null,
                    signal: null,
                    timedOut,
                    terminatedByProbe,
                });
                return;
            }
            terminationTimer = setTimeout(() => {
                if (settled) return;
                if (child.exitCode !== null || child.signalCode !== null) {
                    terminatedByProbe = true;
                    finish({
                        status: 'running',
                        exitCode: null,
                        signal: null,
                        timedOut,
                        terminatedByProbe,
                    });
                    return;
                }
                finish({
                    status: 'failed',
                    exitCode: child.exitCode,
                    signal: child.signalCode,
                    timedOut,
                    terminatedByProbe,
                    error: 'Launch probe could not terminate the process after the observation window',
                });
            }, terminationGraceMs);
        }, timeoutMs);
    });
}

export function isRuntimeIntegrityBlocked(
    fuses: Pick<ElectronFuseInspection, 'status' | 'embeddedAsarIntegrityValidation'> | null,
    integrity: Pick<WindowsAsarIntegrityInspection, 'status'> | null,
): boolean {
    return fuses?.status === 'detected'
        && fuses.embeddedAsarIntegrityValidation === 'enabled'
        && integrity?.status !== 'matched';
}

export async function inspectElectronRuntime(
    rootPath: string,
    archivePath: string,
    archiveRelativePath = 'resources\\app.asar',
): Promise<ElectronRuntimeInspection> {
    const selection = findElectronExecutables(rootPath);
    if (!selection.primary) {
        return {
            executable: null,
            executableCandidates: selection.candidates,
            fuses: null,
            asarIntegrity: null,
            signature: null,
            launchProbe: null,
            blocked: false,
            blockReason: null,
            risk: 'unassessed',
            warnings: ['Electron 실행 파일을 찾지 못해 fuse·코드 서명·내장 ASAR 무결성을 평가하지 못했습니다'],
        };
    }

    const executable = selection.primary;
    const fuses = await inspectElectronFuses(executable);
    const asarIntegrity = inspectWindowsAsarIntegrity(executable, archivePath, archiveRelativePath);
    const signature = inspectWindowsSignature(executable);
    const blocked = isRuntimeIntegrityBlocked(fuses, asarIntegrity);
    const warnings: string[] = [];
    let blockReason: string | null = null;

    if (blocked) {
        blockReason = `Electron의 내장 ASAR 무결성 fuse가 활성화되어 있지만 ${archiveRelativePath} 헤더 해시가 실행 파일 리소스와 일치하지 않습니다`;
        warnings.push(blockReason);
    } else if (fuses.status === 'unavailable') {
        warnings.push(`Electron fuse를 읽지 못했습니다: ${fuses.error ?? '원인 불명'}`);
    }

    if (signature.status === 'hash-mismatch') {
        warnings.push('실행 파일 Authenticode 서명에서 해시 불일치가 감지되었습니다');
    } else if (signature.status === 'not-trusted') {
        warnings.push('실행 파일 서명은 존재하지만 현재 시스템에서 신뢰되지 않습니다');
    } else if (signature.status === 'not-signed') {
        warnings.push('실행 파일에 Authenticode 서명이 없습니다');
    } else if (signature.status === 'unavailable') {
        warnings.push(`실행 파일 서명을 평가하지 못했습니다: ${signature.error ?? '원인 불명'}`);
    }

    const risk = blocked || signature.status === 'hash-mismatch'
        ? 'critical'
        : (warnings.length > 0 ? 'warning' : 'low');
    return {
        executable,
        executableCandidates: selection.candidates,
        fuses,
        asarIntegrity,
        signature,
        launchProbe: null,
        blocked,
        blockReason,
        risk,
        warnings,
    };
}

function publicFuseState(state: FuseState | undefined): PublicFuseState {
    switch (state) {
        case FuseState.ENABLE: return 'enabled';
        case FuseState.DISABLE: return 'disabled';
        case FuseState.REMOVED: return 'removed';
        case FuseState.INHERIT: return 'inherited';
        default: return 'unknown';
    }
}

export async function inspectElectronFuses(executablePath: string): Promise<ElectronFuseInspection> {
    try {
        const wire = await getCurrentFuseWire(path.resolve(executablePath));
        return {
            status: 'detected',
            version: wire.version,
            runAsNode: publicFuseState(wire[FuseV1Options.RunAsNode]),
            embeddedAsarIntegrityValidation: publicFuseState(wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]),
            onlyLoadAppFromAsar: publicFuseState(wire[FuseV1Options.OnlyLoadAppFromAsar]),
        };
    } catch (err) {
        return {
            status: 'unavailable',
            version: null,
            runAsNode: 'unknown',
            embeddedAsarIntegrityValidation: 'unknown',
            onlyLoadAppFromAsar: 'unknown',
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
