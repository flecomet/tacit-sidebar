import { beforeEach, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { openHistoryDatabase } from './historyRepository';
import { createHistoryOwner, migrationBudget } from './historyMigration';

let repo, storage;
beforeEach(async () => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    repo = await openHistoryDatabase({ name: `migration-${Math.random()}`, indexedDB: new IDBFactory() });
    const values = { 'tacit-storage': JSON.stringify({ state: { sessions: [{ id: 'a', title: 'secret title', messages: [{ role: 'user', content: 'hello' }] }], messages: [{ role: 'user', content: 'hello' }], model: 'm' }, version: 3 }) };
    storage = { get: async key => values[key], set: async (key, value) => { values[key] = value; } };
});
const owner = () => createHistoryOwner({ repository: repo, storage, pause: async () => {}, budget: { ...migrationBudget, maxWakeDurationMs: 2000, minPauseMs: 0 } });

describe('durable history owner', () => {
    it('migrates and verifies before removing both legacy copies', async () => {
        const service = owner();
        await service.enable();
        await service.runWake();
        expect((await service.status()).phase).toBe('complete');
        expect((await service.restore()).sessions[0].messages[0].content).toBe('hello');
        const legacy = JSON.parse(await storage.get('tacit-storage'));
        expect(legacy.state.sessions).toBeUndefined();
        expect(legacy.state.messages).toBeUndefined();
        expect(legacy.state.model).toBe('m');
        expect(await repo.getStagedUnits()).toEqual([]);
    });
    it('resumes using durable units and deduplicates append acknowledgments', async () => {
        await owner().enable();
        const resumed = owner();
        const command = { type: 'history.append', commandId: 'append-once', sessionId: 'a', message: { role: 'assistant', content: 'answer' } };
        await resumed.command(command);
        await resumed.command(command);
        await resumed.runWake();
        expect((await resumed.restore()).sessions[0].messages.map(m => m.content)).toEqual(['hello', 'answer']);
    });
    it.each(['history.append', 'history.truncate'])('rejects stale %s without discarding another panel message', async type => {
        const service = owner();
        await service.enable();
        await service.command({ type: 'history.append', commandId: 'remote', sessionId: 'a', expectedMessageCount: 1, message: { role: 'assistant', content: 'remote answer' } });
        const result = await service.command({ type, commandId: 'stale', sessionId: 'a', expectedMessageCount: 1, messageIndex: 0, message: { role: 'user', content: 'stale' } });
        expect(result).toMatchObject({ error: 'HISTORY_REVISION_CONFLICT' });
        expect(await repo.getCommand('stale')).toBeNull();
        expect((await service.restore()).sessions[0].messages.map(message => message.content)).toEqual(['hello', 'remote answer']);
        expect((await service.status()).phase).toBe('migrating');
    });

    it.each(['history.append', 'history.truncate'])('rejects same-count divergent tails for %s', async type => {
        const service = owner();
        await service.enable();
        await service.command({ type: 'history.truncate', commandId: 'remote-cut', sessionId: 'a', expectedMessageCount: 1, expectedLastMessageId: 'legacy:0', messageIndex: 0 });
        await service.command({ type: 'history.append', commandId: 'replacement', sessionId: 'a', expectedMessageCount: 0, expectedLastMessageId: null, message: { role: 'assistant', content: 'remote replacement' } });
        const result = await service.command({ type, commandId: 'diverged', sessionId: 'a', expectedMessageCount: 1, expectedLastMessageId: 'legacy:0', messageIndex: 0, message: { role: 'user', content: 'stale' } });
        expect(result).toMatchObject({ error: 'HISTORY_REVISION_CONFLICT' });
        expect((await service.restore()).sessions[0].messages.map(message => message.content)).toEqual(['remote replacement']);
    });

    it('accepts guarded commands and deduplicates retries after the message count changes', async () => {
        const service = owner();
        await service.enable();
        const append = { type: 'history.append', commandId: 'guarded', sessionId: 'a', expectedMessageCount: 1, message: { role: 'assistant', content: 'answer' } };
        const ack = await service.command(append);
        expect(await service.command(append)).toEqual(ack);
        await service.command({ type: 'history.truncate', commandId: 'truncate', sessionId: 'a', expectedMessageCount: 2, messageIndex: 1 });
        expect((await service.restore()).sessions[0].messages.map(message => message.content)).toEqual(['hello']);
    });

    it('does not restore deleted sessions after a restart', async () => {
        await owner().enable();
        await owner().command({ type: 'history.delete', commandId: 'delete-a', sessionId: 'a' });
        await owner().runWake();
        expect((await owner().restore()).sessions).toEqual([]);
    });
    it('chunks a huge message and preserves attachment variants without duplicate payloads', async () => {
        const payload = `data:image/png;base64,${'A'.repeat(700000)}`;
        const message = { role: 'user', content: 'x'.repeat(900000), files: [{ content: payload, originalContent: payload }] };
        await storage.set('tacit-storage', JSON.stringify({ state: { sessions: [{ id: 'a', title: 'large', messages: [message] }] } }));
        const service = owner();
        await service.enable();
        const units = await repo.getStagedUnits();
        expect(Math.max(...units.map(unit => unit.bytes.byteLength))).toBeLessThanOrEqual(256 * 1024);
        expect(units.filter(unit => unit.kind === 'attachments').length).toBe(3);
        await service.runWake();
        expect((await service.restore()).sessions[0].messages).toEqual([message]);
    });
    it('prevents stale settings writers from reintroducing history after activation', async () => {
        const service = owner();
        await service.enable();
        await service.writeSettings('tacit-storage', JSON.stringify({ state: { sessions: [{ title: 'stale' }], messages: ['stale'], model: 'changed' } }));
        expect(JSON.parse(await storage.get('tacit-storage')).state).toEqual({ model: 'changed' });
        await service.runWake();
        expect((await service.restore()).sessions[0].title).toBe('secret title');
    });
    it('coordinates cleanup with settings writes across the read and write boundary', async () => {
        const service = owner();
        await service.enable();
        let lockTail = Promise.resolve();
        storage.withLock = task => {
            const result = lockTail.then(task);
            lockTail = result.catch(() => {});
            return result;
        };
        const originalGet = storage.get;
        let readStarted, releaseRead;
        const started = new Promise(resolve => { readStarted = resolve; });
        const gate = new Promise(resolve => { releaseRead = resolve; });
        storage.get = async key => {
            const value = await originalGet(key);
            if (key === 'tacit-storage') { readStarted(); await gate; }
            return value;
        };
        const cleanup = service.cleanLegacySettings();
        await started;
        const current = JSON.stringify({ state: { model: 'newest', temperature: 0.7 }, version: 3 });
        const writer = storage.withLock(() => storage.set('tacit-storage', current));
        await Promise.resolve();
        releaseRead();
        await Promise.all([cleanup, writer]);
        expect(await originalGet('tacit-storage')).toBe(current);
    });

    it('saves a stale panel legacy append before stripping its settings after closure', async () => {
        const service = owner();
        const initial = JSON.parse(await storage.get('tacit-storage'));
        await service.enable();
        await service.runWake();
        initial.state.sessions[0].messages.push({ role: 'assistant', content: 'answer after activation' });
        initial.state.sessions[0].updatedAt = 2;
        await storage.set('tacit-storage', JSON.stringify(initial));
        await service.cleanLegacySettings();
        expect((await service.restore()).sessions[0].messages.map(message => message.content)).toEqual(['hello', 'answer after activation']);
        expect(JSON.parse(await storage.get('tacit-storage')).state.sessions).toBeUndefined();
    });

    it.each(['truncate', 'delete'])('does not resurrect old legacy messages after %s', async action => {
        const service = owner();
        const initial = await storage.get('tacit-storage');
        await service.enable();
        await service.runWake();
        await service.command(action === 'delete'
            ? { type: 'history.delete', commandId: 'remove', sessionId: 'a' }
            : { type: 'history.truncate', commandId: 'remove', sessionId: 'a', messageIndex: 0 });
        await storage.set('tacit-storage', initial);
        await service.cleanLegacySettings();
        const restored = (await service.restore()).sessions;
        expect(restored).toHaveLength(action === 'delete' ? 0 : 1);
        if (restored.length) expect(restored[0].messages).toEqual([]);
    });

    it('deduplicates a legacy append already acknowledged through a panel command', async () => {
        const service = owner();
        const initial = JSON.parse(await storage.get('tacit-storage'));
        const answer = { role: 'assistant', content: 'answer' };
        await service.enable();
        await service.command({ type: 'history.append', commandId: 'answer', sessionId: 'a', message: answer });
        initial.state.sessions[0].messages.push(answer);
        await storage.set('tacit-storage', JSON.stringify(initial));
        await service.cleanLegacySettings();
        expect((await service.restore()).sessions[0].messages.map(message => message.content)).toEqual(['hello', 'answer']);
    });

    it('replays legacy adoption after truncation and a watermark failure without duplicating repeated messages', async () => {
        const service = owner();
        const initial = JSON.parse(await storage.get('tacit-storage'));
        await service.enable();
        await service.runWake();
        await service.command({ type: 'history.truncate', commandId: 'cut', sessionId: 'a', messageIndex: 0 });
        const repeated = { role: 'user', content: 'same new message' };
        initial.state.sessions[0].messages.push(repeated, repeated);
        await storage.set('tacit-storage', JSON.stringify(initial));
        const setMetadata = repo.setMetadata.bind(repo);
        let failOnce = true;
        repo.setMetadata = async (key, value) => {
            if (key === 'legacy-watermark' && failOnce) { failOnce = false; throw new Error('stopped before watermark'); }
            return setMetadata(key, value);
        };
        await expect(service.cleanLegacySettings()).rejects.toThrow('stopped before watermark');
        expect((await service.restore()).sessions[0].messages.map(message => message.content)).toEqual(['same new message', 'same new message']);
        await owner().cleanLegacySettings();
        expect((await service.restore()).sessions[0].messages.map(message => message.content)).toEqual(['same new message', 'same new message']);
        expect(JSON.parse(await storage.get('tacit-storage')).state.sessions).toBeUndefined();
    });

    it('does not resurrect a newly adopted legacy session after truncation before its watermark was saved', async () => {
        const service = owner();
        await service.enable();
        await service.runWake();
        await storage.set('tacit-storage', JSON.stringify({ state: { sessions: [{ id: 'legacy-new', title: 'new', messages: [{ role: 'user', content: 'new content' }] }] } }));
        const setMetadata = repo.setMetadata.bind(repo);
        let failOnce = true;
        repo.setMetadata = async (key, value) => {
            if (key === 'legacy-watermark' && failOnce) { failOnce = false; throw new Error('stopped before watermark'); }
            return setMetadata(key, value);
        };
        await expect(service.cleanLegacySettings()).rejects.toThrow('stopped before watermark');
        await service.command({ type: 'history.truncate', commandId: 'cut-new', sessionId: 'legacy-new', messageIndex: 0 });
        await owner().cleanLegacySettings();
        expect((await service.restore()).sessions.find(session => session.id === 'legacy-new').messages).toEqual([]);
    });

    it('retains ambiguous newer legacy edits in error while accepting encrypted modern commands', async () => {
        const initial = JSON.parse(await storage.get('tacit-storage'));
        initial.state.sessions[0].updatedAt = 1;
        await storage.set('tacit-storage', JSON.stringify(initial));
        const service = owner();
        await service.enable();
        await service.runWake();
        initial.state.sessions[0].messages[0].content = 'legacy replacement';
        initial.state.sessions[0].updatedAt = 2;
        const ambiguous = JSON.stringify(initial);
        await storage.set('tacit-storage', ambiguous);
        await expect(service.cleanLegacySettings()).rejects.toMatchObject({ code: 'HISTORY_LEGACY_CONFLICT' });
        expect(await storage.get('tacit-storage')).toBe(ambiguous);
        expect(await service.status()).toMatchObject({ enabled: true, phase: 'error' });
        expect(await service.command({ type: 'history.append', commandId: 'modern', sessionId: 'a', message: { role: 'assistant', content: 'modern answer' } })).toMatchObject({ id: 'a' });
        expect((await service.restore()).sessions[0].messages.map(message => message.content)).toEqual(['hello', 'modern answer']);
    });

    it('keeps ambiguous legacy edits accessible after a newer settings write removes the source blob', async () => {
        const initial = JSON.parse(await storage.get('tacit-storage'));
        initial.state.sessions[0].updatedAt = 1;
        await storage.set('tacit-storage', JSON.stringify(initial));
        const service = owner();
        await service.enable();
        await service.runWake();
        initial.state.sessions[0].messages[0].content = 'recovered replacement';
        initial.state.sessions[0].updatedAt = 2;
        await storage.set('tacit-storage', JSON.stringify(initial));
        await expect(service.cleanLegacySettings()).rejects.toMatchObject({ code: 'HISTORY_LEGACY_CONFLICT' });
        await service.writeSettings('tacit-storage', JSON.stringify({ state: { model: 'changed' }, version: 3 }));
        const sessions = (await owner().restore()).sessions;
        expect(sessions.find(session => session.id === 'a').messages.map(message => message.content)).toEqual(['hello']);
        const recovered = sessions.find(session => session.title === 'Recovered edits: secret title');
        expect(recovered?.messages.map(message => message.content)).toEqual(['recovered replacement']);
        expect((await service.status()).lastError).toMatch(/recovered copy/i);
    });

    it('reuses a recovery conversation if interrupted before its watermark is acknowledged', async () => {
        const initial = JSON.parse(await storage.get('tacit-storage'));
        initial.state.sessions[0].updatedAt = 1;
        await storage.set('tacit-storage', JSON.stringify(initial));
        const service = owner();
        await service.enable();
        await service.runWake();
        initial.state.sessions[0].messages[0].content = 'recovered replacement';
        initial.state.sessions[0].updatedAt = 2;
        await storage.set('tacit-storage', JSON.stringify(initial));
        const setMetadata = repo.setMetadata.bind(repo);
        let failOnce = true;
        repo.setMetadata = async (key, value) => {
            if (key === 'legacy-watermark' && failOnce) { failOnce = false; throw new Error('stopped before recovery watermark'); }
            return setMetadata(key, value);
        };
        await expect(service.cleanLegacySettings()).rejects.toThrow('stopped before recovery watermark');
        await expect(owner().cleanLegacySettings()).rejects.toMatchObject({ code: 'HISTORY_LEGACY_CONFLICT' });
        expect((await service.restore()).sessions.filter(session => session.title === 'Recovered edits: secret title')).toHaveLength(1);
    });

    it('imports a genuine legacy suffix without restoring the truncated prefix', async () => {
        const initial = JSON.parse(await storage.get('tacit-storage'));
        const service = owner();
        await service.enable();
        await service.runWake();
        await service.command({ type: 'history.truncate', commandId: 'cut', sessionId: 'a', messageIndex: 0 });
        initial.state.sessions[0].messages.push({ role: 'user', content: 'new after cut' });
        await storage.set('tacit-storage', JSON.stringify(initial));
        await service.cleanLegacySettings();
        expect((await service.restore()).sessions[0].messages.map(message => message.content)).toEqual(['new after cut']);
    });

    it('ignores a genuine legacy suffix for a deleted conversation', async () => {
        const initial = JSON.parse(await storage.get('tacit-storage'));
        const service = owner();
        await service.enable();
        await service.command({ type: 'history.delete', commandId: 'delete', sessionId: 'a' });
        initial.state.sessions[0].messages.push({ role: 'user', content: 'new after delete' });
        await storage.set('tacit-storage', JSON.stringify(initial));
        await service.cleanLegacySettings();
        expect((await service.restore()).sessions).toEqual([]);
    });

    it('converts many small messages in few steps instead of one step per message', async () => {
        const messages = Array.from({ length: 300 }, (_, index) => ({ role: 'user', content: `message ${index} ${'x'.repeat(2000)}` }));
        await storage.set('tacit-storage', JSON.stringify({ state: { sessions: [{ id: 'a', title: 'many', messages }] } }));
        const service = owner();
        await service.enable();
        const units = (await repo.getStagedUnits()).length;
        let commits = 0;
        const commitRevision = repo.commitRevision.bind(repo);
        repo.commitRevision = async request => { commits += 1; return commitRevision(request); };
        let steps = 0;
        while (await service.needsWork()) {
            await service.runWake();
            steps += 1;
            if (steps > 50) break;
        }
        expect(units).toBe(301);
        expect((await service.status()).phase).toBe('complete');
        // About 600 KB of plaintext at 256 KiB per step.
        expect(commits).toBeLessThanOrEqual(3);
        expect((await service.restore()).sessions[0].messages).toEqual(messages);
    });
});
