import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const manifestPath = '.public-export.json';
const rootFiles = new Set([
    '.gitignore', 'README.md', 'CHANGELOG.md', 'LICENSE',
    'package.json', 'package-lock.json', 'postcss.config.js',
    'tailwind.config.js', 'vite.config.js', 'vitest.config.js',
    '.github/dependabot.yml', '.github/workflows/ci.yml',
    '.github/workflows/model-catalog.yml', '.github/workflows/security.yml',
    'docs/history-encryption-verification.md', 'docs/public-export.md',
]);

function selected(path) {
    if (posix.normalize(path) !== path || path.startsWith('/') || path.startsWith('../')) return false;
    if (path.split('/').some(part => part.endsWith('.local') || part === '.env' || part.startsWith('.env.') || ['.git', 'node_modules', 'dist'].includes(part))) return false;
    if (/\.(pem|key|p12|pfx|zip)$/i.test(path)) return false;
    return rootFiles.has(path) || /^(src|public|assets|scripts)\//.test(path);
}

function git(repo, args, options = {}) {
    try {
        return execFileSync('git', args, {
            cwd: repo, maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'], ...options,
        });
    } catch (error) {
        const detail = error.stderr?.toString('utf8').trim().replace(/(?:https?|ssh):\/\/\S+/g, '[repository URL redacted]');
        throw new Error(`Git ${args[0]} failed${detail ? ':\n' + detail : ''}`);
    }
}

function textGit(repo, ...args) {
    return git(repo, args).toString('utf8').trim();
}

function snapshot(repo, revision) {
    const files = {};
    const entries = git(repo, ['ls-tree', '-r', '-z', revision]).toString('utf8').split('\0').filter(Boolean);
    for (const entry of entries) {
        const tab = entry.indexOf('\t');
        const path = entry.slice(tab + 1);
        if (!selected(path)) continue;
        const [mode, type, oid] = entry.slice(0, tab).split(' ');
        if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
            throw new Error(`Selected path is a symbolic link or unsupported entry: ${path}`);
        }
        files[path] = { mode, oid };
    }
    return files;
}

function baseline(sourceRepo, revision, publicRepo) {
    const paths = textGit(publicRepo, 'ls-tree', '--name-only', 'HEAD').split('\n');
    if (paths.includes(manifestPath)) {
        const state = JSON.parse(textGit(publicRepo, 'show', `HEAD:${manifestPath}`));
        if (state.version !== 1 || !state.files || Array.isArray(state.files) || typeof state.files !== 'object') {
            throw new Error('Unsupported public export manifest');
        }
        for (const [path, entry] of Object.entries(state.files)) {
            if (!selected(path) || !entry || !['100644', '100755'].includes(entry.mode) || !/^[a-f0-9]{40,64}$/.test(entry.oid)) {
                throw new Error(`Invalid public export manifest entry: ${path}`);
            }
        }
        return state.files;
    }
    // Bootstrap from shared public history without fetching private objects into the public clone.
    for (const candidate of textGit(publicRepo, 'rev-list', 'HEAD').split('\n')) {
        try {
            git(sourceRepo, ['merge-base', '--is-ancestor', candidate, revision]);
            return snapshot(sourceRepo, candidate);
        } catch { /* A public-only commit cannot be the shared baseline. */ }
    }
    throw new Error('No common ancestor found; a reviewed initial baseline is required');
}

function same(a, b) {
    return a?.mode === b?.mode && a?.oid === b?.oid;
}

export function publishPublic({ sourceRepo = process.cwd(), publicUrl, revision = 'HEAD', push = false, validate = true, sourceBranch }) {
    sourceRepo = resolve(sourceRepo);
    const sourceRevision = textGit(sourceRepo, 'rev-parse', '--verify', `${revision}^{commit}`);
    const sourceFiles = snapshot(sourceRepo, sourceRevision);
    if (!sourceFiles['package.json'] && validate) throw new Error('The export must include package.json');
    publicUrl ||= process.env.PUBLIC_REPOSITORY_URL || textGit(sourceRepo, 'remote', 'get-url', 'github');
    const temporary = mkdtempSync(join(tmpdir(), 'tacit-public-export-'));
    const publicRepo = join(temporary, 'public');
    try {
        git(temporary, ['clone', '--no-local', '--single-branch', '--branch', 'main', '--', publicUrl, publicRepo]);
        const publicHead = textGit(publicRepo, 'rev-parse', 'HEAD');
        const publicFiles = snapshot(publicRepo, 'HEAD');
        const tracked = git(publicRepo, ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
        const unknown = tracked.filter(path => path !== manifestPath && !selected(path));
        if (unknown.length) throw new Error(`Public files outside the export policy require review:\n${unknown.join('\n')}`);
        const previous = baseline(sourceRepo, sourceRevision, publicRepo);
        const result = {};
        const conflicts = [];
        for (const path of new Set([...Object.keys(previous), ...Object.keys(sourceFiles), ...Object.keys(publicFiles)])) {
            const base = previous[path], source = sourceFiles[path], published = publicFiles[path];
            if (!same(source, base) && !same(published, base) && !same(source, published)) {
                conflicts.push(path);
                continue;
            }
            const keepPublic = same(source, base);
            const entry = keepPublic ? published : source;
            if (entry) result[path] = { ...entry, repo: keepPublic ? publicRepo : sourceRepo };
        }
        if (conflicts.length) throw new Error(`Public/private conflict; reconcile these files in the source repository first:\n${conflicts.join('\n')}`);

        // Remove tracked leaves first so stale files and file/directory transitions cannot survive.
        git(publicRepo, ['rm', '-r', '--force', '--ignore-unmatch', '--', '.']);
        for (const [path, entry] of Object.entries(result)) {
            const destination = join(publicRepo, path);
            mkdirSync(dirname(destination), { recursive: true });
            writeFileSync(destination, git(entry.repo, ['cat-file', 'blob', entry.oid]));
            chmodSync(destination, entry.mode === '100755' ? 0o755 : 0o644);
        }
        writeFileSync(join(publicRepo, manifestPath), JSON.stringify({ version: 1, files: sourceFiles }, null, 2) + '\n');
        git(publicRepo, ['add', '--all']);
        const diff = textGit(publicRepo, 'diff', '--cached', '--stat');
        if (!diff) return { changed: false, publicHead, diff: '' };
        process.stdout.write(diff + '\n');
        const candidateTree = textGit(publicRepo, 'write-tree');
        if (validate) {
            for (const args of [['ci'], ['test'], ['run', 'build']]) {
                execFileSync('npm', args, { cwd: publicRepo, stdio: 'inherit' });
            }
            // Build/install hooks must not alter the exact snapshot that was reviewed and tested.
            if (textGit(publicRepo, 'diff', '--name-only') || textGit(publicRepo, 'write-tree') !== candidateTree) throw new Error('Validation modified tracked export files');
        }
        if (!push) return { changed: true, publicHead, diff };
        if (sourceBranch) {
            const latest = textGit(sourceRepo, 'ls-remote', 'origin', `refs/heads/${sourceBranch}`).split(/\s/)[0];
            if (latest !== sourceRevision) return { changed: false, skipped: true, publicHead, diff };
        }
        git(publicRepo, ['commit', '-m', 'chore: publish selected source snapshot']);
        const commit = textGit(publicRepo, 'rev-parse', 'HEAD');
        // A normal push rejects a concurrent update rather than replacing public contributions.
        git(publicRepo, ['push', 'origin', 'HEAD:refs/heads/main']);
        return { changed: true, publicHead, commit, diff };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: {
            push: { type: 'boolean', default: false },
            source: { type: 'string', default: process.cwd() },
            'public-repo': { type: 'string' },
            revision: { type: 'string', default: 'HEAD' },
        } });
        const result = publishPublic({ sourceRepo: values.source, publicUrl: values['public-repo'], revision: values.revision, push: values.push, sourceBranch: process.env.PUBLIC_EXPORT_SOURCE_BRANCH });
        console.log(result.skipped ? 'Source branch advanced; the newer pipeline will publish.' : result.changed ? (values.push ? 'Public snapshot published.' : 'Preview validated; nothing pushed.') : 'Public snapshot is already current.');
    } catch (error) {
        // Child-process errors can contain authenticated URLs; do not echo command arguments.
        console.error(error.status !== undefined ? `Export command failed with status ${error.status}.` : error.message);
        process.exitCode = 1;
    }
}
