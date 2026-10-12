import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { IDBFactory, IDBDatabase } from 'fake-indexeddb';
import { openHistoryDatabase } from './historyRepository';
import { createHistoryOwner, disabledHistoryStatus } from './historyMigration';
import {
    getHistoryStatus, subscribeHistoryStatus, subscribeHistoryChanges, reportHistoryInteraction,
    prepareHistory, activateHistory, resumeHistory, pauseHistory, sendHistoryCommand, restoreHistory, restoreHistorySession,
} from './historyClient';

const originalChrome = globalThis.chrome;
const setChrome = value => { globalThis.chrome = value; };

beforeEach(() => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('getHistoryStatus', () => {
    it('returns the service answer when it responds', async () => {
        const status = { phase: 'complete', enabled: true, progress: 1 };
        setChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue(status) } });
        await expect(getHistoryStatus()).resolves.toEqual(status);
        expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'history.status' });
    });

    it('returns a disabled status when chrome.runtime is missing and indexedDB is undefined', async () => {
        setChrome({});
        vi.stubGlobal('indexedDB', undefined);
        const status = await getHistoryStatus();
        expect(status).toEqual(disabledHistoryStatus);
        expect(status.enabled).toBe(false);
        // A copy, so callers cannot mutate the shared default.
        expect(status).not.toBe(disabledHistoryStatus);
    });

    it('returns a disabled status when sendMessage rejects and indexedDB is undefined', async () => {
        setChrome({ runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('no receiver')) } });
        vi.stubGlobal('indexedDB', undefined);
        await expect(getHistoryStatus()).resolves.toEqual(disabledHistoryStatus);
    });

    describe('with IndexedDB', () => {
        let factory;
        beforeEach(() => {
            factory = new IDBFactory();
            vi.stubGlobal('indexedDB', factory);
        });

        const seed = async status => {
            const repository = await openHistoryDatabase({ indexedDB: factory });
            if (status) await repository.setMigrationStatus(status);
            repository.close();
        };

        it('reads the migration status from IndexedDB when sendMessage rejects', async () => {
            const saved = { ...disabledHistoryStatus, phase: 'migrating', enabled: true, progress: 0.4 };
            await seed(saved);
            setChrome({ runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('worker asleep')) } });
            await expect(getHistoryStatus()).resolves.toEqual(saved);
        });

        it('reads the migration status from IndexedDB when sendMessage returns undefined', async () => {
            const saved = { ...disabledHistoryStatus, phase: 'complete', enabled: true, progress: 1 };
            await seed(saved);
            setChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) } });
            await expect(getHistoryStatus()).resolves.toEqual(saved);
        });

        it('reads the migration status from IndexedDB when the service answers with an error', async () => {
            const saved = { ...disabledHistoryStatus, phase: 'migrating', enabled: true };
            await seed(saved);
            setChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'HISTORY_ERROR', message: 'x' }) } });
            await expect(getHistoryStatus()).resolves.toEqual(saved);
        });

        it('reads the status from IndexedDB when chrome.runtime is missing', async () => {
            const saved = { ...disabledHistoryStatus, phase: 'complete', enabled: true };
            await seed(saved);
            setChrome({});
            await expect(getHistoryStatus()).resolves.toEqual(saved);
        });

        it('returns disabled when the database holds no status, and closes the connection', async () => {
            await seed(null);
            const close = vi.spyOn(IDBDatabase.prototype, 'close');
            setChrome({ runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('down')) } });
            await expect(getHistoryStatus()).resolves.toEqual(disabledHistoryStatus);
            expect(close).toHaveBeenCalled();
        });

        it('does not touch IndexedDB when the service answers', async () => {
            const open = vi.spyOn(factory, 'open');
            setChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ enabled: true, phase: 'complete' }) } });
            await getHistoryStatus();
            expect(open).not.toHaveBeenCalled();
        });
    });
});

describe('send helpers', () => {
    const answer = response => setChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue(response) } });
    const helpers = [
        ['prepareHistory', prepareHistory, 'history.prepare'],
        ['activateHistory', activateHistory, 'history.activate'],
        ['resumeHistory', resumeHistory, 'history.resume'],
        ['pauseHistory', pauseHistory, 'history.pause'],
    ];

    it.each(helpers)('%s sends its message type and returns the response', async (_name, helper, type) => {
        answer({ ok: true, phase: 'x' });
        await expect(helper()).resolves.toEqual({ ok: true, phase: 'x' });
        expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type });
    });

    it.each(helpers)('%s throws the message of an {ok:false} response', async (_name, helper) => {
        answer({ ok: false, error: 'HISTORY_ERROR', message: 'disk full' });
        await expect(helper()).rejects.toThrow('disk full');
    });

    it('throws the error code when the failed response has no message', async () => {
        answer({ ok: false, error: 'HISTORY_ERROR' });
        await expect(prepareHistory()).rejects.toThrow('HISTORY_ERROR');
    });

    it('throws when the service is unavailable', async () => {
        setChrome({});
        await expect(prepareHistory()).rejects.toThrow('History service is unavailable');
    });

    it('throws when the service does not answer', async () => {
        answer(undefined);
        await expect(activateHistory()).rejects.toThrow('History service did not answer');
    });

    it('propagates a sendMessage rejection', async () => {
        setChrome({ runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('port closed')) } });
        await expect(resumeHistory()).rejects.toThrow('port closed');
    });

    it('sendHistoryCommand forwards a copy of the command', async () => {
        answer({ id: 'a', revision: 1 });
        const command = { type: 'history.create', commandId: 'c1', sessionId: 'a' };
        await expect(sendHistoryCommand(command)).resolves.toEqual({ id: 'a', revision: 1 });
        const sent = globalThis.chrome.runtime.sendMessage.mock.calls[0][0];
        expect(sent).toEqual(command);
        expect(sent).not.toBe(command);
    });

    it('retries a lost acknowledgement with the same command identity', async () => {
        const sendMessage = vi.fn().mockRejectedValueOnce(new Error('port closed')).mockResolvedValue({ id: 'a', revision: 1 });
        setChrome({ runtime: { sendMessage } });
        const command = { type: 'history.delete', commandId: 'stable', sessionId: 'a' };
        await expect(sendHistoryCommand(command)).resolves.toEqual({ id: 'a', revision: 1 });
        expect(sendMessage.mock.calls.map(([message]) => message.commandId)).toEqual(['stable', 'stable']);
    });

    it('preserves a revision conflict code without retrying an acknowledged rejection', async () => {
        answer({ error: 'HISTORY_REVISION_CONFLICT', message: 'Changed elsewhere' });
        await expect(sendHistoryCommand({ commandId: 'stable' })).rejects.toMatchObject({ code: 'HISTORY_REVISION_CONFLICT' });
        expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('sendHistoryCommand throws on a failed response', async () => {
        answer({ ok: false, error: 'HISTORY_ERROR', message: 'bad command' });
        await expect(sendHistoryCommand({ type: 'history.delete', commandId: 'c', sessionId: 'a' })).rejects.toThrow('bad command');
    });

    // The background answers a stale command with {error, message} and no ok flag (BENIGN_CODES in historyMigration).
    // The client turns that into a rejection, which the store reports as a write error.
    it('treats an {error, message} response without ok as a failure', async () => {
        answer({ error: 'HISTORY_DELETED', message: 'Conversation was deleted' });
        await expect(sendHistoryCommand({ type: 'history.append', commandId: 'c', sessionId: 'a' })).rejects.toThrow('Conversation was deleted');
    });

    it('reportHistoryInteraction never throws or rejects, even when the service is unavailable', async () => {
        setChrome({});
        expect(() => reportHistoryInteraction()).not.toThrow();
        await Promise.resolve();
        setChrome({ runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('x')) } });
        expect(() => reportHistoryInteraction()).not.toThrow();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'history.interaction' });
    });
});

describe('subscriptions', () => {
    const makeRuntime = () => {
        const listeners = new Set();
        return {
            listeners,
            onMessage: { addListener: vi.fn(l => listeners.add(l)), removeListener: vi.fn(l => listeners.delete(l)) },
            emit: message => listeners.forEach(l => l(message)),
        };
    };

    it('subscribeHistoryStatus registers a listener, forwards only status events and unsubscribes', () => {
        const runtime = makeRuntime();
        setChrome({ runtime: { onMessage: runtime.onMessage } });
        const listener = vi.fn();
        const unsubscribe = subscribeHistoryStatus(listener);
        expect(runtime.listeners.size).toBe(1);

        runtime.emit({ type: 'history.status.changed', status: { phase: 'complete' } });
        expect(listener).toHaveBeenCalledWith({ phase: 'complete' });

        runtime.emit({ type: 'history.changed' });
        runtime.emit({ type: 'other' });
        runtime.emit(undefined);
        runtime.emit({});
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        expect(runtime.listeners.size).toBe(0);
        runtime.emit({ type: 'history.status.changed', status: {} });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('subscribeHistoryChanges registers a listener, forwards only change events and unsubscribes', () => {
        const runtime = makeRuntime();
        setChrome({ runtime: { onMessage: runtime.onMessage } });
        const listener = vi.fn();
        const unsubscribe = subscribeHistoryChanges(listener);
        expect(runtime.listeners.size).toBe(1);

        runtime.emit({ type: 'history.changed' });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith({ type: 'history.changed' });

        runtime.emit({ type: 'history.status.changed', status: {} });
        runtime.emit({ type: 'unrelated' });
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        expect(runtime.listeners.size).toBe(0);
    });

    it('both subscriptions can coexist and are independent', () => {
        const runtime = makeRuntime();
        setChrome({ runtime: { onMessage: runtime.onMessage } });
        const onStatus = vi.fn();
        const onChange = vi.fn();
        const offStatus = subscribeHistoryStatus(onStatus);
        subscribeHistoryChanges(onChange);
        offStatus();
        runtime.emit({ type: 'history.changed' });
        expect(onStatus).not.toHaveBeenCalled();
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('returns a no-op unsubscribe when chrome.runtime.onMessage is unavailable', () => {
        setChrome({ runtime: {} });
        expect(() => subscribeHistoryStatus(vi.fn())()).not.toThrow();
        expect(() => subscribeHistoryChanges(vi.fn())()).not.toThrow();
        setChrome({});
        expect(() => subscribeHistoryStatus(vi.fn())()).not.toThrow();
    });

    it('unsubscribes safely when removeListener is missing', () => {
        const addListener = vi.fn();
        setChrome({ runtime: { onMessage: { addListener } } });
        const unsubscribe = subscribeHistoryChanges(vi.fn());
        expect(addListener).toHaveBeenCalledTimes(1);
        expect(() => unsubscribe()).not.toThrow();
    });

    it('does not throw when chrome itself is undefined', () => {
        // The helpers read chrome?.runtime, but a ReferenceError would surface if chrome were not declared at all.
        setChrome(undefined);
        expect(() => subscribeHistoryStatus(vi.fn())()).not.toThrow();
    });
});

describe('restoreHistory', () => {
    let factory;
    beforeEach(() => {
        factory = new IDBFactory();
        vi.stubGlobal('indexedDB', factory);
    });

    const migrate = async sessions => {
        const repository = await openHistoryDatabase({ indexedDB: factory });
        const values = { 'tacit-storage': JSON.stringify({ state: { sessions, currentSessionId: sessions[0]?.id, model: 'm' }, version: 3 }) };
        const storage = { get: async key => values[key], set: async (key, value) => { values[key] = value; } };
        const owner = createHistoryOwner({ repository, storage, pause: async () => {} });
        await owner.enable();
        await owner.runWake();
        return repository;
    };

    it('decrypts the stored sessions with the stored key and closes the connection', async () => {
        const sessions = [
            { id: 's1', title: 'First', model: 'm', updatedAt: 3, messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'world' }] },
            { id: 's2', title: 'Second', model: 'm', updatedAt: 4, messages: [] },
        ];
        (await migrate(sessions)).close();
        const close = vi.spyOn(IDBDatabase.prototype, 'close');
        const restored = await restoreHistory();
        expect(restored.map(s => s.id).sort()).toEqual(['s1', 's2']);
        expect(restored.find(s => s.id === 's1').messages).toEqual(sessions[0].messages);
        expect(restored.find(s => s.id === 's1').title).toBe('First');
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('returns an empty list for an empty repository without needing a key', async () => {
        await expect(restoreHistory()).resolves.toEqual([]);
    });

    it('throws "History key is missing" when sessions exist but the key does not, and still closes', async () => {
        const repository = await migrate([{ id: 's1', title: 'T', model: 'm', updatedAt: 1, messages: [{ role: 'user', content: 'x' }] }]);
        await repository.setMetadata('installation-key', null);
        repository.close();
        const close = vi.spyOn(IDBDatabase.prototype, 'close');
        await expect(restoreHistory()).rejects.toThrow('History key is missing');
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('does not use chrome messaging', async () => {
        setChrome({ runtime: { sendMessage: vi.fn() } });
        await restoreHistory();
        expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
});

describe('activation transport recovery', () => {
    it.each([prepareHistory, activateHistory])('retries an interrupted opt-in request', async helper => {
        const sendMessage = vi.fn().mockRejectedValueOnce(new Error('channel closed')).mockResolvedValue({ enabled: true });
        setChrome({ runtime: { sendMessage } });
        await expect(helper()).resolves.toEqual({ enabled: true });
        expect(sendMessage).toHaveBeenCalledTimes(2);
    });
});

describe('scoped history restoration', () => {
    it('reads only the requested conversation and preserves its message identity', async () => {
        vi.stubGlobal('indexedDB', new IDBFactory());
        const repository = await openHistoryDatabase();
        const values = { 'tacit-storage': JSON.stringify({ state: { sessions: [
            { id: 'a', title: 'A', messages: [{ role: 'user', content: 'one' }] },
            { id: 'b', title: 'B', messages: [{ role: 'user', content: 'two' }] },
        ] } }) };
        const owner = createHistoryOwner({ repository, storage: { get: async key => values[key], set: async (key, value) => { values[key] = value; } } });
        await owner.enable();
        repository.close();
        const restored = await restoreHistorySession('a');
        expect(restored.id).toBe('a');
        expect(restored.messages[0].content).toBe('one');
        expect(restored.messages[0].historyRecordId).toBe('legacy:0');
        expect(await restoreHistorySession('absent')).toBeNull();
    });
});
