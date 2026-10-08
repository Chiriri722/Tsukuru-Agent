import crypto from 'crypto';
import embeddedFs from 'fs';
import fs from './physicalFs';
import os from 'os';
import path from 'path';
import * as asar from '@electron/asar';
import { extractContainer, inspectContainer, packContainer } from './container';
import { resolveContainedPathWithoutLinks } from './pathSafety';
import { spawnTracked, terminateProcessTreeByPid } from './processRegistry';
import { appendBounded, inspectElectronFuses, LaunchProbeOptions, LaunchProbeResult } from './runtimeDiagnostics';

interface IsolatedProbeOptions extends LaunchProbeOptions { signal?: AbortSignal; }
interface JobProbeResult extends LaunchProbeResult { processTreeTerminated: boolean; }
interface JobReport {
    started: boolean;
    timedOut: boolean;
    cancelled: boolean;
    processTreeTerminated: boolean;
    exitCode: number | null;
    error: string | null;
}

function readJobReport(reportPath: string): JobReport {
    if (fs.statSync(reportPath).size > 4096) throw new Error('Invalid launch job report size');
    const value = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as JobReport;
    for (const key of ['started', 'timedOut', 'cancelled', 'processTreeTerminated']) {
        if (typeof value?.[key] !== 'boolean') throw new Error('Invalid launch job report');
    }
    if (value.exitCode !== null && !Number.isInteger(value.exitCode)) throw new Error('Invalid launch exit code');
    if (value.error !== null && typeof value.error !== 'string') throw new Error('Invalid launch job error');
    return value;
}

/** Windows 10+ job owner; stdin closure also cancels if the calling worker dies. */
export async function runWindowsProbeJob(
    executablePath: string, args: string[], root: string, options: IsolatedProbeOptions = {},
): Promise<JobProbeResult> {
    const executable = path.resolve(executablePath);
    const timeoutMs = Math.min(15_000, Math.max(50, Math.trunc(options.timeoutMs ?? 3000)));
    const startedAt = Date.now();
    const base: JobProbeResult = {
        executable, timeoutMs, elapsedMs: 0, status: 'failed', exitCode: null, signal: null,
        timedOut: false, terminatedByProbe: false, stdout: '', stderr: '', processTreeTerminated: true,
    };
    if (process.platform !== 'win32' || Number(os.release().split('.')[0]) < 10) {
        return { ...base, error: 'Profile-isolated launch requires Windows 10 or later' };
    }
    if (options.signal?.aborted) return { ...base, error: 'Launch probe cancelled before startup' };
    const id = crypto.randomUUID();
    const configPath = path.join(root, `job-${id}.json`);
    const reportPath = path.join(root, `job-${id}.result.json`);
    const scriptPath = path.join(root, `job-${id}.ps1`);
    // PowerShell cannot read Electron's virtual ASAR paths in packaged builds.
    fs.writeFileSync(scriptPath, embeddedFs.readFileSync(path.join(__dirname, 'windowsProbeJob.ps1')), { flag: 'wx' });
    fs.writeFileSync(configPath, JSON.stringify({ executable, args,
        cwd: options.cwd ?? path.dirname(executable), timeoutMs, reportPath }), { flag: 'wx' });
    const powerShell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // The isolated caller supplies a complete environment, including removal of
    // case aliases. Merging the parent again would resurrect those aliases.
    const env = { ...(options.env ?? process.env) };
    for (const key of Object.keys(env)) {
        if (/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|NODE_PATH)$/i.test(key)) delete env[key];
    }
    return new Promise((resolve) => {
        let settled = false;
        let watchdog: ReturnType<typeof setTimeout>;
        let forcedFinish: ReturnType<typeof setTimeout>;
        const child = spawnTracked(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
            scriptPath, '-ConfigPath', configPath], {
            env, stdio: ['pipe', 'pipe', 'pipe'], cwd: root,
        });
        const cancel = () => { if (!child.stdin?.destroyed) child.stdin?.end('\n'); };
        const finish = (failure?: string, didNotStart = false) => {
            if (settled) return;
            settled = true;
            clearTimeout(watchdog); clearTimeout(forcedFinish);
            options.signal?.removeEventListener('abort', cancel);
            base.elapsedMs = Date.now() - startedAt;
            base.processTreeTerminated = didNotStart;
            try {
                const report = readJobReport(reportPath);
                base.processTreeTerminated = report.processTreeTerminated;
                base.timedOut = report.timedOut;
                base.terminatedByProbe = report.started && (report.timedOut || report.cancelled) && report.processTreeTerminated;
                base.exitCode = report.exitCode;
                base.error = failure || report.error || (report.cancelled ? 'Launch probe cancelled' : undefined);
                if (base.error === undefined) delete base.error;
                if (!base.error && report.processTreeTerminated && report.started) {
                    base.status = report.timedOut ? 'running' : (report.exitCode === 0 ? 'exited-ok' : 'exited-error');
                }
            } catch {
                base.error = failure || 'Launch job did not confirm process-tree termination';
            }
            resolve(base);
        };
        child.stdin?.on('error', () => { /* A broker can exit before cancellation arrives. */ });
        const outputLimit = Math.min(64 * 1024, Math.max(1024, options.maxOutputBytes ?? 64 * 1024));
        child.stdout?.on('data', (chunk) => { base.stdout = appendBounded(base.stdout, chunk, outputLimit); });
        child.stderr?.on('data', (chunk) => { base.stderr = appendBounded(base.stderr, chunk, outputLimit); });
        child.once('error', (error) => finish(error.message, !child.pid));
        child.once('close', (code) => finish(code === 0 ? undefined : `Launch job exited with code ${String(code)}`));
        options.signal?.addEventListener('abort', cancel, { once: true });
        if (options.signal?.aborted) cancel();
        watchdog = setTimeout(() => {
            cancel();
            if (child.pid) terminateProcessTreeByPid(child.pid);
            forcedFinish = setTimeout(() => {
                child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
                finish('Launch job exceeded its startup/cleanup deadline');
            }, 1000);
        }, timeoutMs + 35_000);
    });
}

// Serialized into a new entry in the disposable ASAR; no host imports/closures.
function electronProfileBootstrap(config: { paths: Record<string, string>; profile: string; main: string; marker: string; token: string }): void {
    const { app } = require('electron');
    const fs = require('fs');
    const path = require('path');
    try {
        const within = (target: string) => {
            const relative = path.relative(config.profile, path.resolve(target));
            return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
        };
        const setPath = app.setPath.bind(app);
        for (const [name, target] of Object.entries(config.paths)) {
            setPath(name, target);
            if (path.resolve(app.getPath(name as Parameters<typeof app.getPath>[0])).toLowerCase() !== path.resolve(target).toLowerCase()) {
                throw new Error('Electron profile path readback failed: ' + name);
            }
        }
        app.setPath = (name: string, target: string) => {
            if (Object.prototype.hasOwnProperty.call(config.paths, name) && !within(target)) {
                throw new Error('Launch probe refused an external profile path: ' + name);
            }
            return setPath(name, target);
        };
        const setLogs = app.setAppLogsPath.bind(app);
        app.setAppLogsPath = (target = config.paths.logs) => {
            if (!within(target)) throw new Error('Launch probe refused external logs');
            return setLogs(target);
        };
        fs.writeFileSync(config.marker, JSON.stringify({ token: config.token }), { flag: 'wx' });
        // Preserve CommonJS entry semantics (require.main/module.id), as Electron does.
        require('module')._load(path.join(__dirname, config.main), null, true);
    } catch (error) {
        console.error('Isolated launch bootstrap failed:', error);
        app.exit(78);
    }
}

function createProfile(root: string): { paths: Record<string, string>; env: NodeJS.ProcessEnv; profile: string } {
    const profile = path.join(root, 'profile');
    fs.mkdirSync(profile); // Never reuse an existing profile.
    const home = path.join(profile, 'home');
    const paths = {
        home, appData: path.join(home, 'AppData', 'Roaming'),
        userData: path.join(profile, 'user-data'), sessionData: path.join(profile, 'session-data'),
        temp: path.join(profile, 'temp'), logs: path.join(profile, 'logs'), crashDumps: path.join(profile, 'crash-dumps'),
    };
    const local = path.join(home, 'AppData', 'Local');
    const replacements = {
        APPDATA: paths.appData, LOCALAPPDATA: local, USERPROFILE: home, HOME: home,
        HOMEDRIVE: path.parse(home).root.slice(0, -1), HOMEPATH: home.slice(path.parse(home).root.length - 1),
        TEMP: paths.temp, TMP: paths.temp, XDG_CONFIG_HOME: paths.appData,
        XDG_DATA_HOME: paths.appData, XDG_CACHE_HOME: local, ELECTRON_LOG_FILE: path.join(paths.logs, 'electron.log'),
    };
    for (const target of [...Object.values(paths), local]) fs.mkdirSync(target, { recursive: true });
    const env = { ...process.env };
    const replaced = new Set(Object.keys(replacements));
    for (const key of Object.keys(env)) {
        if (replaced.has(key.toUpperCase()) || /^(NODE_OPTIONS|NODE_EXTRA_CA_CERTS|NODE_PATH|ELECTRON_RUN_AS_NODE|ELECTRON_NO_ASAR)$/i.test(key)) delete env[key];
    }
    return { paths, profile, env: { ...env, ...replacements } };
}

function containedFile(root: string, relative: string): string {
    const resolved = resolveContainedPathWithoutLinks(root, relative);
    if (!resolved.ok || path.relative(root, resolved.path) === '..' || !fs.statSync(resolved.path).isFile()) {
        throw new Error('Launch probe file must be contained without links');
    }
    return resolved.path;
}

async function prepareBootstrap(archive: string, root: string, paths: Record<string, string>, profile: string): Promise<{ marker: string; token: string }> {
    const info = inspectContainer(archive);
    if (info.type !== 'electron-asar' || !info.archive || info.archive.invalidEntryCount || info.archive.unsafeLinkCount) {
        throw new Error('Launch profile isolation requires a valid link-free Electron ASAR');
    }
    const packageBytes = asar.extractFile(archive, 'package.json');
    if (packageBytes.length > 64 * 1024) throw new Error('Launch package metadata exceeds the supported size');
    const metadata = JSON.parse(packageBytes.toString('utf8'));
    for (const name of [metadata.name, metadata.productName]) {
        if (name !== undefined && (typeof name !== 'string' || !name || name.length > 128
            || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name))) {
            throw new Error('Launch profile isolation requires a safe application profile name');
        }
    }
    const main = metadata.main ?? 'index.js';
    if (typeof main !== 'string' || !/\.(cjs|js)$/i.test(main) || path.isAbsolute(main)
        || main.replace(/\\/g, '/').split('/').some((part) => part === '..' || part.includes(':'))) {
        throw new Error('Launch profile isolation requires a contained CommonJS main (HTML/ESM/external entries are unsupported)');
    }
    const staging = path.join(root, 'bootstrap-source');
    await extractContainer(info, staging);
    const entry = containedFile(staging, main);
    if (path.extname(entry).toLowerCase() !== '.cjs') {
        let directory = path.dirname(entry);
        while (true) {
            const packagePath = path.join(directory, 'package.json');
            if (fs.existsSync(packagePath)) {
                if (JSON.parse(fs.readFileSync(packagePath, 'utf8')).type === 'module') throw new Error('ESM launch entry is unsupported');
                break;
            }
            if (directory === staging) break;
            directory = path.dirname(directory);
        }
    }
    const token = crypto.randomUUID();
    const marker = path.join(profile, 'bootstrap.json');
    const bootstrapName = `tsukuru-probe-${token}.cjs`;
    const bootstrap = `(${electronProfileBootstrap.toString()})(${JSON.stringify({ paths, profile, main, marker, token })});\n`;
    fs.writeFileSync(path.join(staging, bootstrapName), bootstrap, { flag: 'wx' });
    fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ ...metadata, main: bootstrapName }));
    const packed = path.join(root, 'instrumented', 'app.asar');
    await packContainer(info, staging, packed);
    fs.copyFileSync(packed, archive);
    for (const relative of info.archive.unpackedEntries) {
        fs.copyFileSync(containedFile(packed + '.unpacked', relative), containedFile(archive + '.unpacked', relative));
    }
    return { marker, token };
}

/** Takes ownership of a newly allocated probe root containing only the disposable payload. */
export async function runIsolatedElectronProbe(
    executable: string, archive: string, root: string, options: IsolatedProbeOptions = {},
): Promise<LaunchProbeResult> {
    // Validate ownership boundaries before entering the cleanup scope.
    containedFile(root, path.relative(root, executable));
    containedFile(root, path.relative(root, archive));
    const startedAt = Date.now();
    let safeToClean = true;
    let result: LaunchProbeResult = {
        status: 'failed', executable, timeoutMs: options.timeoutMs ?? 3000, elapsedMs: 0,
        exitCode: null, signal: null, timedOut: false, terminatedByProbe: false, stdout: '', stderr: '',
        isolation: { strategy: 'electron-bootstrap-v1', verified: false, processTreeTerminated: true, cleanup: 'retained' },
    };
    try {
        if (process.platform !== 'win32' || Number(os.release().split('.')[0]) < 10) throw new Error('Profile-isolated launch requires Windows 10 or later');
        if (options.signal?.aborted) throw new Error('Launch probe cancelled before preparation');
        const fuses = await inspectElectronFuses(executable);
        if (fuses.status !== 'detected' || fuses.embeddedAsarIntegrityValidation !== 'disabled') {
            throw new Error('Profile isolation requires a recognized Electron runtime with embedded ASAR integrity disabled; protected/unknown wrappers cannot be probed');
        }
        const { paths, profile, env } = createProfile(root);
        const proof = await prepareBootstrap(archive, root, paths, profile);
        if (options.signal?.aborted) throw new Error('Launch probe cancelled before execution');
        safeToClean = false;
        const job = await runWindowsProbeJob(executable, [`--user-data-dir=${paths.userData}`], root, { ...options, env });
        safeToClean = job.processTreeTerminated;
        let verified = false;
        try { verified = fs.statSync(proof.marker).size < 256 && JSON.parse(fs.readFileSync(proof.marker, 'utf8')).token === proof.token; } catch { /* Missing proof is a failure. */ }
        const { processTreeTerminated, ...launch } = job;
        result = { ...launch, isolation: { strategy: 'electron-bootstrap-v1', verified, processTreeTerminated, cleanup: 'retained' } };
        if (!verified || !processTreeTerminated) {
            result.status = 'failed';
            result.error = result.error || 'Launch probe did not confirm profile isolation and process-tree termination';
        }
    } catch (error) {
        result.status = 'failed';
        result.error = error instanceof Error ? error.message : String(error);
        result.isolation.processTreeTerminated = safeToClean;
    } finally {
        if (safeToClean) {
            try {
                await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
                result.isolation.cleanup = 'removed';
            } catch (error) {
                result.status = 'failed';
                result.error = `Launch probe cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
            }
        }
        result.elapsedMs = Date.now() - startedAt;
    }
    return result;
}
