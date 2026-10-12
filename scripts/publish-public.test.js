import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { publishPublic } from './publish-public.mjs';

let root, source, remote, originalConfig;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (path, value) => {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), value);
};
const commit = () => { git(source, 'add', '.'); git(source, 'commit', '-m', 'Update files'); };
const publish = (options = {}) => publishPublic({ sourceRepo: source, publicUrl: remote, push: true, validate: false, ...options });
const publicFile = (path) => git(remote, 'show', `main:${path}`);

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'public-export-test-'));
    source = join(root, 'source');
    remote = join(root, 'public.git');
    originalConfig = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig');
    writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[user]\nname = Test Owner\nemail = owner@example.test\n[commit]\ngpgsign = false\n');
    mkdirSync(source);
    git(source, 'init', '-b', 'main');
    put('README.md', 'Public readme');
    put('src/app.js', 'export const version = 1;');
    put('src/services/__fixtures__/models.json', '{"version":1}');
    commit();
    git(root, 'clone', '--bare', source, remote);
    put('docs/project-description-and-monetization.md', 'PRIVATE_STRATEGY_MARKER');
    commit();
});

afterEach(() => {
    if (originalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = originalConfig;
    rmSync(root, { recursive: true, force: true });
});

describe('public snapshot publication', () => {
    it('copies selected committed files without transferring private history or dirty files', () => {
        put('src/app.js', 'export const version = 2;');
        put('src/.env', 'PRIVATE_ENV_MARKER');
        put('src/notes.local/draft.md', 'PRIVATE_LOCAL_MARKER');
        commit();
        const privateHead = git(source, 'rev-parse', 'HEAD');
        const publicHead = git(remote, 'rev-parse', 'main');
        put('src/app.js', 'UNCOMMITTED_MARKER');
        publish();
        expect(publicFile('src/app.js')).toBe('export const version = 2;');
        expect(git(remote, 'rev-parse', 'main^')).toBe(publicHead);
        expect(() => git(remote, 'cat-file', '-e', `${privateHead}^{commit}`)).toThrow();
        const paths = git(remote, 'ls-tree', '-r', '--name-only', 'main');
        expect(paths).not.toContain('project-description');
        expect(paths).not.toContain('.env');
        expect(paths).not.toContain('notes.local');
        expect(readFileSync(join(source, 'src/app.js'), 'utf8')).toBe('UNCOMMITTED_MARKER');
    });

    it('preserves newer public fixtures on the first and subsequent exports', () => {
        const publicClone = join(root, 'public-clone');
        git(root, 'clone', remote, publicClone);
        writeFileSync(join(publicClone, 'src/services/__fixtures__/models.json'), '{"version":2}');
        git(publicClone, 'commit', '-am', 'Refresh catalog');
        git(publicClone, 'push', 'origin', 'main');
        publish();
        put('src/app.js', 'export const version = 3;');
        commit();
        publish();
        expect(publicFile('src/services/__fixtures__/models.json')).toBe('{"version":2}');
        expect(publicFile('src/app.js')).toBe('export const version = 3;');
    });

    it('refuses conflicting changes without updating the public branch', () => {
        publish();
        const publicClone = join(root, 'public-clone');
        git(root, 'clone', remote, publicClone);
        writeFileSync(join(publicClone, 'src/app.js'), 'Public contribution');
        git(publicClone, 'commit', '-am', 'Public contribution');
        git(publicClone, 'push', 'origin', 'main');
        const before = git(remote, 'rev-parse', 'main');
        put('src/app.js', 'Private development');
        commit();
        expect(() => publish()).toThrow(/conflict.*src\/app.js/is);
        expect(git(remote, 'rev-parse', 'main')).toBe(before);
    });

    it('does not create another commit for unchanged or private-only updates', () => {
        publish();
        const before = git(remote, 'rev-parse', 'main');
        put('docs/project-description-and-monetization.md', 'More private notes');
        commit();
        expect(publish().changed).toBe(false);
        expect(git(remote, 'rev-parse', 'main')).toBe(before);
    });

    it('propagates deletions and executable modes', () => {
        put('scripts/tool.sh', '#!/bin/sh\nexit 0\n');
        commit();
        git(source, 'update-index', '--chmod=+x', 'scripts/tool.sh');
        git(source, 'commit', '-m', 'Make tool executable');
        publish();
        expect(git(remote, 'ls-tree', 'main', 'scripts/tool.sh')).toMatch(/^100755 /);
        rmSync(join(source, 'src/app.js'));
        commit();
        publish();
        expect(() => publicFile('src/app.js')).toThrow();
    });

    it('rejects selected symbolic links before publishing', () => {
        symlinkSync('../docs/project-description-and-monetization.md', join(source, 'src/leak'));
        commit();
        const before = git(remote, 'rev-parse', 'main');
        expect(() => publish()).toThrow(/symbolic|symlink/i);
        expect(git(remote, 'rev-parse', 'main')).toBe(before);
    });

    it('previews a publication without changing either branch', () => {
        put('src/app.js', 'Preview change');
        commit();
        const before = git(remote, 'rev-parse', 'main');
        expect(publish({ push: false }).changed).toBe(true);
        expect(git(remote, 'rev-parse', 'main')).toBe(before);
    });

    it('leaves public-only files outside the policy untouched by refusing the export', () => {
        const publicClone = join(root, 'public-clone');
        git(root, 'clone', remote, publicClone);
        writeFileSync(join(publicClone, 'CONTRIBUTING.md'), 'Public contribution guidelines');
        git(publicClone, 'add', '.');
        git(publicClone, 'commit', '-m', 'Add contribution guidelines');
        git(publicClone, 'push', 'origin', 'main');
        const before = git(remote, 'rev-parse', 'main');
        expect(() => publish()).toThrow(/policy.*CONTRIBUTING.md/is);
        expect(git(remote, 'rev-parse', 'main')).toBe(before);
    });

    it('handles a file replacing a directory between publications', () => {
        put('src/module/index.js', 'First module');
        commit();
        publish();
        rmSync(join(source, 'src/module'), { recursive: true });
        put('src/module', 'Replacement file');
        commit();
        publish();
        expect(publicFile('src/module')).toBe('Replacement file');
    });

    it('does not push when candidate validation fails', () => {
        const packageJson = { name: 'test-export', version: '1.0.0', scripts: { test: 'node -e "process.exit(1)"', build: 'node -e "process.exit(0)"' } };
        put('package.json', JSON.stringify(packageJson));
        put('package-lock.json', JSON.stringify({ name: 'test-export', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'test-export', version: '1.0.0' } } }));
        commit();
        const before = git(remote, 'rev-parse', 'main');
        expect(() => publish({ validate: true })).toThrow();
        expect(git(remote, 'rev-parse', 'main')).toBe(before);
    });
});
