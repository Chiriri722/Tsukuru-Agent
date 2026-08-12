"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findElectronExecutables = findElectronExecutables;
exports.calculateAsarHeaderSha256 = calculateAsarHeaderSha256;
exports.inspectWindowsAsarIntegrity = inspectWindowsAsarIntegrity;
exports.normalizeAuthenticodeStatus = normalizeAuthenticodeStatus;
exports.inspectWindowsSignature = inspectWindowsSignature;
exports.runLaunchProbe = runLaunchProbe;
exports.isRuntimeIntegrityBlocked = isRuntimeIntegrityBlocked;
exports.inspectElectronRuntime = inspectElectronRuntime;
exports.inspectElectronFuses = inspectElectronFuses;
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const asar = __importStar(require("@electron/asar"));
const fuses_1 = require("@electron/fuses");
const constants_1 = require("@electron/fuses/dist/constants");
const resedit_1 = require("resedit");
const EXCLUDED_EXECUTABLE = /^(?:update|squirrel|crashpad_handler|notification_helper|unins\d*|uninstall(?:er)?)(?:[-_.].*)?\.exe$/i;
function findElectronExecutables(rootPath) {
    var _a;
    const root = path_1.default.resolve(rootPath);
    if (!fs_1.default.existsSync(root) || !fs_1.default.lstatSync(root).isDirectory())
        return { primary: null, candidates: [] };
    const candidates = fs_1.default.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && !EXCLUDED_EXECUTABLE.test(entry.name))
        .map((entry) => path_1.default.join(root, entry.name))
        .sort((left, right) => fs_1.default.statSync(right).size - fs_1.default.statSync(left).size || left.localeCompare(right));
    return { primary: (_a = candidates[0]) !== null && _a !== void 0 ? _a : null, candidates };
}
function calculateAsarHeaderSha256(archivePath) {
    return crypto_1.default.createHash('sha256').update(asar.getRawHeader(path_1.default.resolve(archivePath)).headerString).digest('hex');
}
function normalizeWindowsResourcePath(value) {
    return value.replace(/\//g, '\\').replace(/^\.\\/, '').toLowerCase();
}
function resourceNameMatches(value, expected) {
    return typeof value === 'string' && value.toUpperCase() === expected;
}
function inspectWindowsAsarIntegrity(executablePath, archivePath, archiveRelativePath = 'resources\\app.asar') {
    const archiveHeaderSha256 = calculateAsarHeaderSha256(archivePath);
    const absent = () => ({
        status: 'absent',
        archiveHeaderSha256,
        embeddedValue: null,
        embeddedAlgorithm: null,
        embeddedFile: null,
        matched: null,
    });
    try {
        const executable = resedit_1.NtExecutable.from(fs_1.default.readFileSync(path_1.default.resolve(executablePath)), { ignoreCert: true });
        const resources = resedit_1.NtExecutableResource.from(executable, true);
        const entries = resources.entries.filter((entry) => resourceNameMatches(entry.type, 'INTEGRITY') && resourceNameMatches(entry.id, 'ELECTRONASAR'));
        if (entries.length === 0)
            return absent();
        const expectedFile = normalizeWindowsResourcePath(archiveRelativePath);
        let parseError;
        for (const entry of entries) {
            try {
                const raw = Buffer.from(entry.bin).toString('utf8').replace(/^\uFEFF/, '').replace(/\0+$/, '');
                const records = JSON.parse(raw);
                if (!Array.isArray(records))
                    throw new Error('ElectronAsar integrity resource is not an array');
                const record = records.find((item) => {
                    if (!item || typeof item !== 'object')
                        return false;
                    const candidate = item;
                    return typeof candidate.file === 'string'
                        && typeof candidate.alg === 'string'
                        && typeof candidate.value === 'string'
                        && normalizeWindowsResourcePath(candidate.file) === expectedFile;
                });
                if (!record)
                    continue;
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
            }
            catch (err) {
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
    }
    catch (err) {
        return {
            ...absent(),
            status: 'unreadable',
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
function normalizeAuthenticodeStatus(status) {
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
function inspectWindowsSignature(executablePath) {
    const unavailable = (error) => ({
        status: 'unavailable',
        rawStatus: null,
        statusMessage: null,
        subject: null,
        thumbprint: null,
        trusted: null,
        error,
    });
    if (process.platform !== 'win32')
        return unavailable('Authenticode inspection is only available on Windows');
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const modernPowerShell = path_1.default.join(programFiles, 'PowerShell', '7', 'pwsh.exe');
    const bundledPowerShell = path_1.default.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const powerShell = fs_1.default.existsSync(modernPowerShell)
        ? modernPowerShell
        : (fs_1.default.existsSync(bundledPowerShell) ? bundledPowerShell : 'powershell.exe');
    const script = [
        '& {',
        '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
        '$signature = Get-AuthenticodeSignature -LiteralPath $env:TSUKURU_AGENT_SIGNATURE_TARGET',
        '$subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }',
        '$thumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }',
        '[pscustomobject]@{ Status = [string]$signature.Status; StatusMessage = $signature.StatusMessage; Subject = $subject; Thumbprint = $thumbprint } | ConvertTo-Json -Compress',
        '}',
    ].join('\n');
    const completed = (0, child_process_1.spawnSync)(powerShell, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
    ], {
        encoding: 'utf8',
        env: { ...process.env, TSUKURU_AGENT_SIGNATURE_TARGET: path_1.default.resolve(executablePath) },
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
    });
    if (completed.error)
        return unavailable(completed.error.message);
    if (completed.status !== 0) {
        return unavailable((completed.stderr || `PowerShell exited with code ${String(completed.status)}`).trim());
    }
    try {
        const parsed = JSON.parse(completed.stdout.trim());
        const rawStatus = typeof parsed.Status === 'string' ? parsed.Status : '';
        if (rawStatus === '')
            return unavailable('Authenticode returned an empty status');
        const status = normalizeAuthenticodeStatus(rawStatus);
        return {
            status,
            rawStatus,
            statusMessage: typeof parsed.StatusMessage === 'string' ? parsed.StatusMessage : null,
            subject: typeof parsed.Subject === 'string' ? parsed.Subject : null,
            thumbprint: typeof parsed.Thumbprint === 'string' ? parsed.Thumbprint : null,
            trusted: status === 'valid' ? true : (status === 'unavailable' || status === 'unknown' ? null : false),
        };
    }
    catch (err) {
        return unavailable(`Authenticode result parsing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
function appendBounded(current, chunk, maxBytes) {
    if (Buffer.byteLength(current, 'utf8') >= maxBytes)
        return current;
    const available = maxBytes - Buffer.byteLength(current, 'utf8');
    return current + Buffer.from(chunk).subarray(0, available).toString('utf8');
}
function runLaunchProbe(executablePath, args = [], options = {}) {
    var _a, _b;
    const executable = path_1.default.resolve(executablePath);
    const timeoutMs = Math.max(50, Math.trunc((_a = options.timeoutMs) !== null && _a !== void 0 ? _a : 3000));
    const maxOutputBytes = Math.max(1024, Math.trunc((_b = options.maxOutputBytes) !== null && _b !== void 0 ? _b : 64 * 1024));
    const startedAt = Date.now();
    const env = { ...process.env, ...options.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    delete env.NODE_EXTRA_CA_CERTS;
    return new Promise((resolve) => {
        var _a, _b;
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        let terminatedByProbe = false;
        let child;
        const finish = (partial) => {
            if (settled)
                return;
            settled = true;
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
            child = (0, child_process_1.spawn)(executable, args, {
                cwd: options.cwd ? path_1.default.resolve(options.cwd) : path_1.default.dirname(executable),
                env,
                shell: false,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        }
        catch (err) {
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
        (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (chunk) => {
            stdout = appendBounded(stdout, chunk, maxOutputBytes);
        });
        (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (chunk) => {
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
            finish({
                status: timedOut ? 'running' : (exitCode === 0 ? 'exited-ok' : 'exited-error'),
                exitCode: timedOut ? null : exitCode,
                signal: timedOut ? null : signal,
                timedOut,
                terminatedByProbe,
            });
        });
        const timer = setTimeout(() => {
            if (settled || child.exitCode !== null || child.signalCode !== null)
                return;
            timedOut = true;
            if (process.platform === 'win32' && child.pid) {
                const treeKill = (0, child_process_1.spawnSync)('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
                    windowsHide: true,
                    stdio: 'ignore',
                });
                terminatedByProbe = treeKill.status === 0;
            }
            if (!terminatedByProbe)
                terminatedByProbe = child.kill();
            if (!terminatedByProbe) {
                finish({
                    status: 'failed',
                    exitCode: child.exitCode,
                    signal: child.signalCode,
                    timedOut,
                    terminatedByProbe,
                    error: 'Launch probe could not terminate the process after the observation window',
                });
            }
        }, timeoutMs);
        child.once('exit', () => clearTimeout(timer));
        child.once('error', () => clearTimeout(timer));
    });
}
function isRuntimeIntegrityBlocked(fuses, integrity) {
    return (fuses === null || fuses === void 0 ? void 0 : fuses.status) === 'detected'
        && fuses.embeddedAsarIntegrityValidation === 'enabled'
        && (integrity === null || integrity === void 0 ? void 0 : integrity.status) !== 'matched';
}
async function inspectElectronRuntime(rootPath, archivePath, archiveRelativePath = 'resources\\app.asar') {
    var _a, _b;
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
    const warnings = [];
    let blockReason = null;
    if (blocked) {
        blockReason = `Electron의 내장 ASAR 무결성 fuse가 활성화되어 있지만 ${archiveRelativePath} 헤더 해시가 실행 파일 리소스와 일치하지 않습니다`;
        warnings.push(blockReason);
    }
    else if (fuses.status === 'unavailable') {
        warnings.push(`Electron fuse를 읽지 못했습니다: ${(_a = fuses.error) !== null && _a !== void 0 ? _a : '원인 불명'}`);
    }
    if (signature.status === 'hash-mismatch') {
        warnings.push('실행 파일 Authenticode 서명에서 해시 불일치가 감지되었습니다');
    }
    else if (signature.status === 'not-trusted') {
        warnings.push('실행 파일 서명은 존재하지만 현재 시스템에서 신뢰되지 않습니다');
    }
    else if (signature.status === 'not-signed') {
        warnings.push('실행 파일에 Authenticode 서명이 없습니다');
    }
    else if (signature.status === 'unavailable') {
        warnings.push(`실행 파일 서명을 평가하지 못했습니다: ${(_b = signature.error) !== null && _b !== void 0 ? _b : '원인 불명'}`);
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
function publicFuseState(state) {
    switch (state) {
        case constants_1.FuseState.ENABLE: return 'enabled';
        case constants_1.FuseState.DISABLE: return 'disabled';
        case constants_1.FuseState.REMOVED: return 'removed';
        case constants_1.FuseState.INHERIT: return 'inherited';
        default: return 'unknown';
    }
}
async function inspectElectronFuses(executablePath) {
    try {
        const wire = await (0, fuses_1.getCurrentFuseWire)(path_1.default.resolve(executablePath));
        return {
            status: 'detected',
            version: wire.version,
            runAsNode: publicFuseState(wire[fuses_1.FuseV1Options.RunAsNode]),
            embeddedAsarIntegrityValidation: publicFuseState(wire[fuses_1.FuseV1Options.EnableEmbeddedAsarIntegrityValidation]),
            onlyLoadAppFromAsar: publicFuseState(wire[fuses_1.FuseV1Options.OnlyLoadAppFromAsar]),
        };
    }
    catch (err) {
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
