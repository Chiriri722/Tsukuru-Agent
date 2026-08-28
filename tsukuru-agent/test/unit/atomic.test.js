const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    atomicWriteFilesSync,
    removePathBestEffortSync,
    replaceArtifactGroupSync,
    replaceDirSync,
} = require('../../.build/app/src/core/atomic.js');

test('best-effort cleanup returns the removal error without throwing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-cleanup-best-effort-'));
    const target = path.join(root, 'temporary');
    fs.mkdirSync(target);
    const originalRemove = fs.rmSync;
    fs.rmSync = (candidate, options) => {
        if (path.resolve(candidate) === path.resolve(target)) {
            throw new Error('simulated temporary cleanup failure');
        }
        return originalRemove(candidate, options);
    };
    let cleanupError;
    try {
        cleanupError = removePathBestEffortSync(target, { recursive: true, force: true });
    } finally {
        fs.rmSync = originalRemove;
    }
    assert.match(cleanupError.message, /simulated temporary cleanup failure/);
    assert.equal(fs.existsSync(target), true);
    fs.rmSync(root, { recursive: true, force: true });
});

test('atomic file batch installs every staged file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-atomic-success-'));
    try {
        const first = path.join(root, 'first.txt');
        const second = path.join(root, 'second.txt');
        fs.writeFileSync(first, 'old-first');
        fs.writeFileSync(second, 'old-second');
        atomicWriteFilesSync([
            { file: first, data: 'new-first' },
            { file: second, data: Buffer.from('new-second') },
        ]);
        assert.equal(fs.readFileSync(first, 'utf8'), 'new-first');
        assert.equal(fs.readFileSync(second, 'utf8'), 'new-second');
        assert.deepEqual(fs.readdirSync(root).sort(), ['first.txt', 'second.txt']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('atomic file batch restores every original when a later install fails', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-atomic-rollback-'));
    const first = path.join(root, 'first.txt');
    const second = path.join(root, 'second.txt');
    fs.writeFileSync(first, 'old-first');
    fs.writeFileSync(second, 'old-second');
    const originalRename = fs.renameSync;
    fs.renameSync = (source, destination) => {
        if (path.resolve(destination) === path.resolve(second) && path.basename(source).includes('.tmp-')) {
            const error = new Error('simulated second-file install failure');
            error.code = 'EIO';
            throw error;
        }
        return originalRename(source, destination);
    };
    try {
        assert.throws(
            () => atomicWriteFilesSync([
                { file: first, data: 'new-first' },
                { file: second, data: 'new-second' },
            ]),
            /simulated second-file install failure/,
        );
    } finally {
        fs.renameSync = originalRename;
    }
    try {
        assert.equal(fs.readFileSync(first, 'utf8'), 'old-first');
        assert.equal(fs.readFileSync(second, 'utf8'), 'old-second');
        assert.deepEqual(fs.readdirSync(root).sort(), ['first.txt', 'second.txt']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('atomic file batch rejects a parent chain that crosses a junction', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-atomic-link-'));
    try {
        const outside = path.join(root, 'outside');
        const nested = path.join(outside, 'nested');
        const linked = path.join(root, 'linked');
        fs.mkdirSync(nested, { recursive: true });
        try {
            fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
            t.skip(`symlink/junction creation unavailable: ${error.code}`);
            return;
        }
        assert.throws(
            () => atomicWriteFilesSync([{ file: path.join(linked, 'nested', 'result.txt'), data: 'blocked' }]),
            /link|junction|심볼릭|정션/i,
        );
        assert.deepEqual(fs.readdirSync(nested), []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function artifactGroupFixture(prefix) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const target = path.join(root, 'target');
    const staging = path.join(root, 'staging');
    fs.mkdirSync(target);
    fs.mkdirSync(staging);
    for (const [base, value] of [['Extract', 'extract'], ['Backup', 'backup']]) {
        fs.mkdirSync(path.join(target, base));
        fs.writeFileSync(path.join(target, base, 'state.txt'), `old-${value}`);
        fs.mkdirSync(path.join(staging, base));
        fs.writeFileSync(path.join(staging, base, 'state.txt'), `new-${value}`);
    }
    fs.writeFileSync(path.join(target, '.extracteddata'), 'old-mapping');
    fs.writeFileSync(path.join(staging, '.extracteddata'), 'new-mapping');
    return { root, target, staging };
}

test('artifact group replacement installs directories and files as one set', () => {
    const { root, target, staging } = artifactGroupFixture('tsukuru-artifact-success-');
    try {
        assert.equal(typeof replaceArtifactGroupSync, 'function');
        replaceArtifactGroupSync(staging, target, ['Extract', 'Backup', '.extracteddata']);
        assert.equal(fs.readFileSync(path.join(target, 'Extract', 'state.txt'), 'utf8'), 'new-extract');
        assert.equal(fs.readFileSync(path.join(target, 'Backup', 'state.txt'), 'utf8'), 'new-backup');
        assert.equal(fs.readFileSync(path.join(target, '.extracteddata'), 'utf8'), 'new-mapping');
        assert.deepEqual(fs.readdirSync(target).sort(), ['.extracteddata', 'Backup', 'Extract']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('artifact group replacement restores every original when a later install fails', () => {
    const { root, target, staging } = artifactGroupFixture('tsukuru-artifact-rollback-');
    const originalRename = fs.renameSync;
    fs.renameSync = (source, destination) => {
        if (path.resolve(source) === path.resolve(path.join(staging, 'Backup'))
            && path.resolve(destination) === path.resolve(path.join(target, 'Backup'))) {
            throw new Error('simulated artifact install failure');
        }
        return originalRename(source, destination);
    };
    try {
        assert.equal(typeof replaceArtifactGroupSync, 'function');
        assert.throws(
            () => replaceArtifactGroupSync(staging, target, ['Extract', 'Backup', '.extracteddata']),
            /simulated artifact install failure/,
        );
    } finally {
        fs.renameSync = originalRename;
    }
    try {
        assert.equal(fs.readFileSync(path.join(target, 'Extract', 'state.txt'), 'utf8'), 'old-extract');
        assert.equal(fs.readFileSync(path.join(target, 'Backup', 'state.txt'), 'utf8'), 'old-backup');
        assert.equal(fs.readFileSync(path.join(target, '.extracteddata'), 'utf8'), 'old-mapping');
        assert.deepEqual(fs.readdirSync(target).sort(), ['.extracteddata', 'Backup', 'Extract']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('artifact group replacement keeps the installed set when old-backup cleanup fails', () => {
    const { root, target, staging } = artifactGroupFixture('tsukuru-artifact-cleanup-');
    const originalRemove = fs.rmSync;
    fs.rmSync = (candidate, options) => {
        if (path.dirname(candidate) === target && path.basename(candidate).includes('.old-')) {
            throw new Error('simulated artifact backup cleanup failure');
        }
        return originalRemove(candidate, options);
    };
    try {
        assert.doesNotThrow(
            () => replaceArtifactGroupSync(staging, target, ['Extract', 'Backup', '.extracteddata']),
        );
    } finally {
        fs.rmSync = originalRemove;
    }
    try {
        assert.equal(fs.readFileSync(path.join(target, 'Extract', 'state.txt'), 'utf8'), 'new-extract');
        assert.equal(fs.readFileSync(path.join(target, 'Backup', 'state.txt'), 'utf8'), 'new-backup');
        assert.equal(fs.readFileSync(path.join(target, '.extracteddata'), 'utf8'), 'new-mapping');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('directory replacement keeps the installed tree when old-backup cleanup fails', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-directory-cleanup-'));
    const target = path.join(root, 'target');
    const staging = path.join(root, 'staging');
    fs.mkdirSync(target);
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(target, 'state.txt'), 'old');
    fs.writeFileSync(path.join(staging, 'state.txt'), 'new');
    const originalRemove = fs.rmSync;
    fs.rmSync = (candidate, options) => {
        if (path.dirname(candidate) === root && path.basename(candidate).startsWith('.target.old-')) {
            throw new Error('simulated directory backup cleanup failure');
        }
        return originalRemove(candidate, options);
    };
    try {
        assert.doesNotThrow(() => replaceDirSync(staging, target));
    } finally {
        fs.rmSync = originalRemove;
    }
    try {
        assert.equal(fs.readFileSync(path.join(target, 'state.txt'), 'utf8'), 'new');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('directory replacement preserves the install error when backup restoration also fails', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-directory-recovery-'));
    const target = path.join(root, 'target');
    const staging = path.join(root, 'staging');
    fs.mkdirSync(target);
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(target, 'state.txt'), 'old');
    fs.writeFileSync(path.join(staging, 'state.txt'), 'new');
    const installError = new Error('simulated directory install failure');
    const recoveryError = new Error('simulated directory recovery failure');
    const originalRename = fs.renameSync;
    fs.renameSync = (source, destination) => {
        if (path.resolve(source) === path.resolve(staging) && path.resolve(destination) === path.resolve(target)) {
            throw installError;
        }
        if (path.basename(source).startsWith('.target.old-') && path.resolve(destination) === path.resolve(target)) {
            throw recoveryError;
        }
        return originalRename(source, destination);
    };
    let thrown;
    try {
        replaceDirSync(staging, target);
    } catch (error) {
        thrown = error;
    } finally {
        fs.renameSync = originalRename;
    }
    try {
        assert.equal(thrown, installError);
        assert.equal(thrown.recoveryError, recoveryError);
        assert.equal(fs.existsSync(target), false);
        const backup = fs.readdirSync(root).find((name) => name.startsWith('.target.old-'));
        assert.ok(backup);
        assert.equal(fs.readFileSync(path.join(root, backup, 'state.txt'), 'utf8'), 'old');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
