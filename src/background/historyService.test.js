import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { openHistoryDatabase } from '../services/historyRepository';
import { HISTORY_ENABLED_KEY, LEGACY_STORAGE_KEY } from '../services/historyMigration';
import { createHistoryService, MIGRATION_ALARM } from './historyService';

const EXT_ID = 'extension-id';
const FROM_EXTENSION = { id: EXT_ID };

const legacyBlob = () => JSON.stringify({
    state: {
        sessions: [{ id: 'a', title: 'First chat', model: 'm', updatedAt: 1, messages: [{ role: 'user', content: 'hello' }] }],
        messages: [{ role: 'user', content: 'hello' }],
        currentSessionId: 'a',
        model: 'm',
    },
    version: 3,
});

let values;
let alarms;
let repositoryPromise;
let api;
let listeners;

// Builds the fake extension API. Writes made through storage.local.set notify onChanged listeners like Chrome does.
function makeApi({ withAlarms = true, withOnChanged = true, withOnStartup = true } = {}) {
    listeners = { message: [], changed: [], alarm: [], startup: [] };
    const built = {
        runtime: {
            id: EXT_ID,
            onMessage: { addListener: vi.fn(l => listeners.message.push(l)) },
            sendMessage: vi.fn().mockResolvedValue(undefined),
            ...(withOnStartup ? { onStartup: { addListener: vi.fn(l => listeners.startup.push(l)) } } : {}),
        },
        storage: {
            local: {
                get: vi.fn((keys, callback) => callback(Object.fromEntries(keys.map(key => [key, values[key]])))),
                set: vi.fn((items, callback) => {
                    const changes = {};
                    for (const [key, value] of Object.entries(items)) {
                        changes[key] = { oldValue: values[key], newValue: value };
                        values[key] = value;
                    }
                    callback?.();
                    queueMicrotask(() => listeners.changed.forEach(l => l(changes, 'local')));
                }),
            },
            ...(withOnChanged ? { onChanged: { addListener: vi.fn(l => listeners.changed.push(l)) } } : {}),
        },
    };
    if (withAlarms) {
        built.alarms = {
            get: vi.fn(async name => alarms.get(name)),
            create: vi.fn((name, info) => { alarms.set(name, { name, ...info }); }),
            clear: vi.fn(async name => alarms.delete(name)),
            onAlarm: { addListener: vi.fn(l => listeners.alarm.push(l)) },
        };
    }
    return built;
}

// A schedule that records its calls and runs them only when told to.
function recordingSchedule() {
    const calls = [];
    const schedule = vi.fn((fn, ms) => { calls.push({ fn, ms }); });
    schedule.calls = calls;
    schedule.runAll = async () => { for (const { fn } of calls.splice(0)) await fn(); };
    return schedule;
}

const makeService = (options = {}) => createHistoryService({
    api,
    openRepository: vi.fn(() => repositoryPromise),
    schedule: options.schedule || (fn => fn()),
});

// Delivers a message and returns what the listener returned and the response it eventually sent.
function deliver(service, message, sender = FROM_EXTENSION) {
    let respond;
    const response = new Promise(resolve => { respond = resolve; });
    const sendResponse = vi.fn(value => respond(value));
    const returned = service.onMessage(message, sender, sendResponse);
    return { returned, response, sendResponse };
}
const ask = async (service, message) => {
    const { returned, response } = deliver(service, message);
    expect(returned).toBe(true);
    return response;
};
const settle = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));

beforeEach(async () => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    // The owner rests 150 ms between units. The tests keep every other delay.
    const realSetTimeout = globalThis.setTimeout;
    vi.stubGlobal('setTimeout', (fn, ms, ...rest) => realSetTimeout(fn, ms >= 100 ? 0 : ms, ...rest));
    values = { [LEGACY_STORAGE_KEY]: legacyBlob() };
    alarms = new Map();
    repositoryPromise = openHistoryDatabase({ name: `service-${Math.random()}`, indexedDB: new IDBFactory() });
    api = makeApi();
});

afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    (await repositoryPromise).close();
});

// Enables encryption directly on the owner so that tests start from a known state.
async function enableOwner(service, { complete = false } = {}) {
    const instance = await service.owner();
    await instance.enable();
    if (complete) await instance.runWake();
    return instance;
}

describe('repository lifecycle', () => {
    it('reopens after a database version change closes the cached owner', async () => {
        const factory = new IDBFactory();
        const name = `lifecycle-${Math.random()}`;
        const repositories = [];
        const service = createHistoryService({ api, schedule: recordingSchedule(), openRepository: async () => {
            const repository = await openHistoryDatabase({ name, indexedDB: factory });
            repositories.push(repository);
            return repository;
        } });
        const first = await service.owner();
        await first.prepare();
        const upgrade = factory.open(name, 2);
        upgrade.onupgradeneeded = () => upgrade.transaction.abort();
        await new Promise(resolve => { upgrade.onerror = resolve; });
        const reopened = await service.owner();
        expect(reopened).not.toBe(first);
        expect((await reopened.status()).phase).toBe('preparing');
        repositories.forEach(repository => repository.close());
    });
});

describe('activation interruption recovery', () => {
    it('resumes repository activation when the storage marker was never written', async () => {
        const first = makeService({ schedule: recordingSchedule() });
        const instance = await enableOwner(first);
        delete values[HISTORY_ENABLED_KEY];
        const repository = await repositoryPromise;
        const service = createHistoryService({ api, openRepository: () => repositoryPromise,
            openReadRepository: async () => ({ getMigrationStatus: repository.getMigrationStatus, close: () => {} }), schedule: recordingSchedule() });
        service.register();
        await vi.waitFor(async () => expect((await instance.status()).phase).toBe('complete'), { timeout: 3000 });
        expect(values[HISTORY_ENABLED_KEY]).toBe(true);
    });

    it('rejects callback storage errors instead of announcing successful preparation', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        api.storage.local.get.mockImplementation((_keys, callback) => {
            api.runtime.lastError = { message: 'storage unavailable' };
            callback(undefined);
            delete api.runtime.lastError;
        });
        expect(await ask(service, { type: 'history.prepare' })).toMatchObject({ ok: false, message: 'storage unavailable' });
    });

    it('rejects an enabled marker callback failure and can repair it on repeated activation', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        await ask(service, { type: 'history.prepare' });
        const originalSet = api.storage.local.set.getMockImplementation();
        api.storage.local.set.mockImplementationOnce((_items, callback) => {
            api.runtime.lastError = { message: 'storage quota exceeded' };
            callback();
            delete api.runtime.lastError;
        });
        expect(await ask(service, { type: 'history.activate' })).toMatchObject({ ok: false, message: 'storage quota exceeded' });
        api.storage.local.set.mockImplementation(originalSet);
        await ask(service, { type: 'history.activate' });
        expect(values[HISTORY_ENABLED_KEY]).toBe(true);
    });
});

describe('coded failures', () => {
    it('preserves a database error code for panel recovery', async () => {
        const service = createHistoryService({ api, openRepository: async () => { throw Object.assign(new Error('upgrade blocked'), { code: 'HISTORY_BLOCKED' }); } });
        expect(await ask(service, { type: 'history.status' })).toEqual({ ok: false, error: 'HISTORY_BLOCKED', message: 'upgrade blocked' });
    });
});

describe('message filtering', () => {
    it('ignores messages from a sender whose id differs from runtime.id', async () => {
        const service = makeService();
        const { returned, sendResponse } = deliver(service, { type: 'history.status' }, { id: 'someone-else' });
        expect(returned).toBe(false);
        await settle();
        expect(sendResponse).not.toHaveBeenCalled();
    });

    it('ignores messages without a sender or with a sender without id', () => {
        const service = makeService();
        expect(deliver(service, { type: 'history.status' }, null).returned).toBe(false);
        expect(deliver(service, { type: 'history.status' }, {}).returned).toBe(false);
        expect(deliver(service, { type: 'history.status' }, { url: 'https://example.com' }).returned).toBe(false);
    });

    it('does not open the repository for ignored messages', async () => {
        const openRepository = vi.fn(() => repositoryPromise);
        const service = createHistoryService({ api, openRepository, schedule: fn => fn() });
        deliver(service, { type: 'history.status' }, { id: 'other' });
        deliver(service, { type: 'other' });
        await settle();
        expect(openRepository).not.toHaveBeenCalled();
    });

    it.each([
        ['an unrelated type', { type: 'tab.update' }],
        ['a type that only resembles history', { type: 'historyX.status' }],
        ['a type without a dot', { type: 'history' }],
        ['an unknown history type', { type: 'history.unknown' }],
        ['a status event broadcast by the service itself', { type: 'history.status.changed', status: {} }],
        ['a message without type', {}],
        ['a non-string type', { type: 7 }],
        ['null', null],
        ['undefined', undefined],
    ])('ignores %s', async (_label, message) => {
        const service = makeService();
        const { returned, sendResponse } = deliver(service, message);
        expect(returned).toBe(false);
        await settle();
        expect(sendResponse).not.toHaveBeenCalled();
    });
});

describe('routing', () => {
    it('answers history.status with the disabled status and returns true for an asynchronous response', async () => {
        const service = makeService();
        const { returned, response } = deliver(service, { type: 'history.status' });
        expect(returned).toBe(true);
        await expect(response).resolves.toMatchObject({ phase: 'disabled', enabled: false });
    });

    it('schedules a wake when the status is requested', async () => {
        const schedule = recordingSchedule();
        const service = makeService({ schedule });
        await ask(service, { type: 'history.status' });
        expect(schedule).toHaveBeenCalledTimes(1);
        expect(schedule.mock.calls[0][1]).toBe(0);
    });

    it('prepares, then activates, persisting the enabled flag and creating the alarm', async () => {
        const schedule = recordingSchedule();
        const service = makeService({ schedule });
        const prepared = await ask(service, { type: 'history.prepare' });
        expect(prepared).toMatchObject({ phase: 'preparing', enabled: false });
        expect(values[HISTORY_ENABLED_KEY]).toBeUndefined();
        expect(api.runtime.sendMessage).toHaveBeenCalledWith({ type: 'history.status.changed', status: expect.objectContaining({ phase: 'preparing' }) });

        const activated = await ask(service, { type: 'history.activate' });
        expect(activated).toMatchObject({ phase: 'migrating', enabled: true });
        expect(values[HISTORY_ENABLED_KEY]).toBe(true);
        expect(api.alarms.create).toHaveBeenCalledWith(MIGRATION_ALARM, { periodInMinutes: 1 });
        expect(schedule.calls.some(call => call.ms === 0)).toBe(true);
    });

    it('answers history.activate without a prior prepare with an error response', async () => {
        const service = makeService();
        const response = await ask(service, { type: 'history.activate' });
        expect(response).toEqual({ ok: false, error: 'HISTORY_ERROR', message: 'History encryption was not prepared' });
        expect(api.alarms.create).not.toHaveBeenCalled();
    });

    it('history.resume enables a disabled history in one step', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        const response = await ask(service, { type: 'history.resume' });
        expect(response).toMatchObject({ enabled: true, phase: 'migrating' });
        expect(alarms.has(MIGRATION_ALARM)).toBe(true);
    });

    it('history.pause stops the work and clears the alarm; history.resume restarts both', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        await enableOwner(service);
        await ask(service, { type: 'history.resume' });
        expect(alarms.has(MIGRATION_ALARM)).toBe(true);

        const paused = await ask(service, { type: 'history.pause' });
        expect(paused.phase).toBe('paused');
        expect(alarms.has(MIGRATION_ALARM)).toBe(false);

        const resumed = await ask(service, { type: 'history.resume' });
        expect(resumed).toMatchObject({ phase: 'migrating', enabled: true });
        expect(alarms.has(MIGRATION_ALARM)).toBe(true);
    });

    it('history.interaction answers {ok:true}', async () => {
        const service = makeService();
        await expect(ask(service, { type: 'history.interaction' })).resolves.toEqual({ ok: true });
    });

    it('activating wakes the migration to completion when the schedule runs immediately', async () => {
        const service = makeService();
        await ask(service, { type: 'history.prepare' });
        await ask(service, { type: 'history.activate' });
        const instance = await service.owner();
        await vi.waitFor(async () => expect((await instance.status()).phase).toBe('complete'), { timeout: 3000 });
        expect(alarms.has(MIGRATION_ALARM)).toBe(false);
        expect(JSON.parse(values[LEGACY_STORAGE_KEY]).state.sessions).toBeUndefined();
    });

    describe('commands', () => {
        let service;
        let instance;
        beforeEach(async () => {
            service = makeService({ schedule: recordingSchedule() });
            instance = await enableOwner(service, { complete: true });
        });
        const command = (type, extra) => ({ type, commandId: `${type}-${Math.random()}`, ...extra });
        const restored = async () => (await instance.restore()).sessions;

        it('routes history.create', async () => {
            const response = await ask(service, command('history.create', { sessionId: 'b', session: { id: 'b', title: 'Second', model: 'm', updatedAt: 5, messages: [{ role: 'user', content: 'yo' }] } }));
            expect(response).toEqual({ id: 'b', revision: 1 });
            const session = (await restored()).find(s => s.id === 'b');
            expect(session.messages).toEqual([{ role: 'user', content: 'yo' }]);
        });

        it('routes history.append and derives nothing from messages in the summary', async () => {
            const response = await ask(service, command('history.append', {
                sessionId: 'a', message: { role: 'assistant', content: 'answer' }, updatedAt: 9,
                session: { id: 'a', title: 'First chat', model: 'm', updatedAt: 9 },
            }));
            // Revision 1 holds the migrated manifest and message, which convert in one batch.
            expect(response).toMatchObject({ id: 'a', revision: 2 });
            const session = (await restored()).find(s => s.id === 'a');
            expect(session.messages.map(m => m.content)).toEqual(['hello', 'answer']);
            expect(session.updatedAt).toBe(9);
        });

        it('routes history.truncate', async () => {
            await ask(service, command('history.append', { sessionId: 'a', message: { role: 'assistant', content: 'answer' }, updatedAt: 9 }));
            const response = await ask(service, command('history.truncate', { sessionId: 'a', messageIndex: 1, updatedAt: 10 }));
            expect(response).toMatchObject({ id: 'a' });
            expect((await restored()).find(s => s.id === 'a').messages.map(m => m.content)).toEqual(['hello']);
        });

        it('routes history.delete', async () => {
            const response = await ask(service, command('history.delete', { sessionId: 'a' }));
            expect(response).toMatchObject({ id: 'a', deleted: true });
            expect(await restored()).toEqual([]);
        });

        it('answers a repeated command id with the stored acknowledgment without applying it twice', async () => {
            const append = command('history.append', { sessionId: 'a', message: { role: 'assistant', content: 'once' }, updatedAt: 9 });
            const first = await ask(service, append);
            const second = await ask(service, append);
            expect(second).toEqual(first);
            expect((await restored()).find(s => s.id === 'a').messages.map(m => m.content)).toEqual(['hello', 'once']);
        });

        it('answers a stale command with the benign error response instead of failing the migration', async () => {
            const response = await ask(service, command('history.truncate', { sessionId: 'unknown', messageIndex: 0 }));
            expect(response).toMatchObject({ error: 'HISTORY_NOT_FOUND' });
            expect((await instance.status()).phase).toBe('complete');
        });

        it('runs a wake after answering a command', async () => {
            const wake = vi.spyOn(instance, 'needsWork');
            await ask(service, command('history.delete', { sessionId: 'a' }));
            await vi.waitFor(() => expect(wake).toHaveBeenCalled());
        });

        it('reports an invalid command as HISTORY_ERROR', async () => {
            const response = await ask(service, { type: 'history.append', sessionId: 'a' });
            expect(response).toEqual({ ok: false, error: 'HISTORY_ERROR', message: 'Invalid history command' });
        });

        it('answers {disabled:true} for a command while history is not enabled', async () => {
            api = makeApi();
            values = {};
            repositoryPromise = openHistoryDatabase({ name: `service-${Math.random()}`, indexedDB: new IDBFactory() });
            const fresh = makeService({ schedule: recordingSchedule() });
            const response = await ask(fresh, command('history.append', { sessionId: 'a', message: { role: 'user', content: 'x' } }));
            expect(response).toEqual({ disabled: true });
        });
    });
});

describe('error responses', () => {
    it('turns a failing repository open into {ok:false,error:HISTORY_ERROR,message}', async () => {
        const service = createHistoryService({ api, openRepository: () => Promise.reject(new Error('IndexedDB unavailable')), schedule: fn => fn() });
        const response = await ask(service, { type: 'history.status' });
        expect(response).toEqual({ ok: false, error: 'HISTORY_ERROR', message: 'IndexedDB unavailable' });
    });

    it('stringifies a non-Error failure', async () => {
        const service = createHistoryService({ api, openRepository: () => Promise.reject('quota'), schedule: fn => fn() });
        const response = await ask(service, { type: 'history.prepare' });
        expect(response).toEqual({ ok: false, error: 'HISTORY_ERROR', message: 'quota' });
    });

    it('answers a command with an error response when the owner fails', async () => {
        const service = makeService();
        const instance = await service.owner();
        vi.spyOn(instance, 'command').mockRejectedValue(new Error('disk full'));
        const response = await ask(service, { type: 'history.create', commandId: 'c', sessionId: 'z', session: { id: 'z' } });
        expect(response).toEqual({ ok: false, error: 'HISTORY_ERROR', message: 'disk full' });
    });

    it('answers every request exactly once on success', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        const { sendResponse, response } = deliver(service, { type: 'history.interaction' });
        await response;
        await settle();
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    // owner() caches the promise returned by openRepository(), so a transient open failure is never retried.
    it('recovers when the repository can be opened on a later request after one failed open', async () => {
        const openRepository = vi.fn()
            .mockRejectedValueOnce(new Error('blocked by another connection'))
            .mockImplementation(() => repositoryPromise);
        const service = createHistoryService({ api, openRepository, schedule: () => {} });
        const first = await ask(service, { type: 'history.status' });
        expect(first).toMatchObject({ ok: false, error: 'HISTORY_ERROR' });
        const second = await ask(service, { type: 'history.status' });
        expect(second).toMatchObject({ phase: 'disabled', enabled: false });
        expect(openRepository).toHaveBeenCalledTimes(2);
    });
});

describe('alarm management', () => {
    it('creates the alarm once while work remains and does not recreate an existing one', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        await enableOwner(service);
        await ask(service, { type: 'history.resume' });
        await ask(service, { type: 'history.resume' });
        expect(api.alarms.create).toHaveBeenCalledTimes(1);
        expect(api.alarms.create).toHaveBeenCalledWith(MIGRATION_ALARM, { periodInMinutes: 1 });
    });

    it('clears the alarm once the migration is complete', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        await ask(service, { type: 'history.resume' });
        expect(alarms.has(MIGRATION_ALARM)).toBe(true);
        await service.wake();
        const instance = await service.owner();
        expect((await instance.status()).phase).toBe('complete');
        expect(api.alarms.clear).toHaveBeenCalledWith(MIGRATION_ALARM);
        expect(alarms.has(MIGRATION_ALARM)).toBe(false);
    });

    it('clears the alarm when a wake finds nothing to do', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        alarms.set(MIGRATION_ALARM, { name: MIGRATION_ALARM });
        await service.wake();
        expect(api.alarms.clear).toHaveBeenCalledWith(MIGRATION_ALARM);
        expect(alarms.size).toBe(0);
    });

    it('works without the alarms API', async () => {
        api = makeApi({ withAlarms: false });
        const service = makeService({ schedule: recordingSchedule() });
        await ask(service, { type: 'history.resume' });
        await expect(service.wake()).resolves.toBeUndefined();
        expect((await (await service.owner()).status()).phase).toBe('complete');
    });
});

describe('wake', () => {
    it('is bounded: with a clock that runs fast one wake converts a single unit, keeps the alarm and schedules one follow-up', async () => {
        const schedule = recordingSchedule();
        const service = makeService({ schedule });
        await ask(service, { type: 'history.resume' });
        schedule.calls.length = 0;

        let clock = 0;
        const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 500));
        await service.wake();
        now.mockRestore();

        const instance = await service.owner();
        const status = await instance.status();
        expect(status.phase).toBe('migrating');
        expect(status.progress).toBeGreaterThan(0);
        expect(status.progress).toBeLessThan(1);
        expect(alarms.has(MIGRATION_ALARM)).toBe(true);
        const followUps = schedule.calls.filter(call => call.ms === 3000);
        expect(followUps).toHaveLength(1);

        // Running the follow-up with a normal clock finishes the job.
        await schedule.runAll();
        await vi.waitFor(async () => expect((await instance.status()).phase).toBe('complete'), { timeout: 3000 });
    });

    it('schedules only one follow-up wake however many wake() calls overlap', async () => {
        const schedule = recordingSchedule();
        const service = makeService({ schedule });
        await ask(service, { type: 'history.resume' });
        schedule.calls.length = 0;

        let clock = 0;
        const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 500));
        await Promise.all([service.wake(), service.wake(), service.wake(), service.wake()]);
        now.mockRestore();

        expect(schedule.calls.filter(call => call.ms === 3000)).toHaveLength(1);
    });

    it('releases the follow-up claim once it has run, so later wakes can schedule again', async () => {
        const schedule = recordingSchedule();
        const service = makeService({ schedule });
        await ask(service, { type: 'history.resume' });
        schedule.calls.length = 0;
        // Stop each wake after the first batch so work remains and a follow-up is scheduled.
        let clock = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => (clock += 5000));
        await service.wake();
        expect(schedule.calls.filter(call => call.ms === 3000)).toHaveLength(1);
        const [{ fn }] = schedule.calls.splice(0);
        await fn();
        await vi.waitFor(() => expect(schedule.calls.filter(call => call.ms === 3000).length).toBeLessThanOrEqual(1));
        await service.wake();
        expect(schedule.calls.length).toBeLessThanOrEqual(2);
    });

    it('does nothing and schedules nothing when history is disabled', async () => {
        const schedule = recordingSchedule();
        const service = makeService({ schedule });
        await service.wake();
        expect(schedule).not.toHaveBeenCalled();
        expect(api.alarms.create).not.toHaveBeenCalled();
    });
});

describe('register', () => {
    it('adds the message, storage, alarm and startup listeners', () => {
        const service = makeService();
        service.register();
        expect(api.runtime.onMessage.addListener).toHaveBeenCalledWith(service.onMessage);
        expect(api.storage.onChanged.addListener).toHaveBeenCalledWith(service.onStorageChanged);
        expect(api.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
        expect(api.runtime.onStartup.addListener).toHaveBeenCalledTimes(1);
    });

    it('does not fail when optional APIs are missing', () => {
        api = makeApi({ withAlarms: false, withOnChanged: false, withOnStartup: false });
        const service = makeService();
        expect(() => service.register()).not.toThrow();
    });

    it('does not open the repository at startup when the enabled flag is not set', async () => {
        const openRepository = vi.fn(() => repositoryPromise);
        const service = createHistoryService({ api, openRepository, schedule: fn => fn() });
        service.register();
        await settle();
        expect(openRepository).not.toHaveBeenCalled();
    });

    it('resumes interrupted work at startup when the enabled flag is set', async () => {
        const first = makeService({ schedule: recordingSchedule() });
        const instance = await enableOwner(first);
        expect((await instance.status()).phase).toBe('migrating');
        expect(values[HISTORY_ENABLED_KEY]).toBe(true);

        const second = makeService({ schedule: recordingSchedule() });
        second.register();
        await vi.waitFor(async () => expect((await instance.status()).phase).toBe('complete'), { timeout: 3000 });
        expect(alarms.has(MIGRATION_ALARM)).toBe(false);
    });

    it('removes a leftover alarm at startup when no work remains', async () => {
        await enableOwner(makeService({ schedule: recordingSchedule() }), { complete: true });
        alarms.set(MIGRATION_ALARM, { name: MIGRATION_ALARM });
        makeService({ schedule: recordingSchedule() }).register();
        await vi.waitFor(() => expect(alarms.has(MIGRATION_ALARM)).toBe(false));
    });

    it('resumes again when the browser starts', async () => {
        await enableOwner(makeService({ schedule: recordingSchedule() }), { complete: true });
        const service = makeService({ schedule: recordingSchedule() });
        const instance = await service.owner();
        service.register();
        // Put the history back into a migrating state, then fire the startup listener.
        await instance.resume();
        const runWake = vi.spyOn(instance, 'runWake');
        expect(listeners.startup).toHaveLength(1);
        listeners.startup.forEach(l => l());
        await vi.waitFor(() => expect(runWake).toHaveBeenCalled());
        await vi.waitFor(async () => expect((await instance.status()).phase).toBe('complete'), { timeout: 3000 });
    });

    it('runs a wake when the migration alarm fires and ignores other alarms', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        const instance = await enableOwner(service);
        const runWake = vi.spyOn(instance, 'runWake');
        service.register();
        // register() itself resumes at startup because the flag is set.
        await vi.waitFor(async () => expect((await instance.status()).phase).toBe('complete'), { timeout: 3000 });
        runWake.mockClear();

        const [onAlarm] = listeners.alarm;
        onAlarm({ name: 'something-else' });
        await settle();
        expect(runWake).not.toHaveBeenCalled();

        await instance.resume();
        onAlarm({ name: MIGRATION_ALARM });
        await vi.waitFor(() => expect(runWake).toHaveBeenCalledTimes(1));
        await vi.waitFor(async () => expect((await instance.status()).phase).toBe('complete'), { timeout: 3000 });
    });
});

describe('onStorageChanged', () => {
    const dirty = (extra = {}) => JSON.stringify({
        state: { sessions: [{ id: 'old', messages: [{ role: 'user', content: 'leaked' }] }], messages: [{ role: 'user', content: 'leaked' }], model: 'changed', ...extra },
        version: 3,
    });
    const change = value => ({ [LEGACY_STORAGE_KEY]: { newValue: value } });
    const writesToLegacy = () => api.storage.local.set.mock.calls.filter(([items]) => LEGACY_STORAGE_KEY in items);

    it('re-strips sessions and messages written after activation, keeping other settings', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        await enableOwner(service, { complete: true });
        api.storage.local.set.mockClear();

        values[LEGACY_STORAGE_KEY] = dirty();
        service.onStorageChanged(change(values[LEGACY_STORAGE_KEY]), 'local');
        await vi.waitFor(() => expect(JSON.parse(values[LEGACY_STORAGE_KEY]).state).toEqual({ model: 'changed' }));
        expect(JSON.parse(values[LEGACY_STORAGE_KEY]).version).toBe(3);
    });

    it('strips the current settings instead of an obsolete storage event', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        const instance = await enableOwner(service, { complete: true });
        const obsolete = dirty({ model: 'obsolete' });
        const current = dirty({ model: 'current', temperature: 0.7 });
        values[LEGACY_STORAGE_KEY] = current;
        service.onStorageChanged(change(obsolete), 'local');
        await vi.waitFor(() => expect(JSON.parse(values[LEGACY_STORAGE_KEY]).state).toEqual({ model: 'current', temperature: 0.7 }));
        expect((await instance.status()).phase).toBe('complete');
    });

    it('leaves newer clean settings unchanged after an obsolete storage event', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        await enableOwner(service, { complete: true });
        const current = JSON.stringify({ state: { model: 'current' }, version: 3 });
        values[LEGACY_STORAGE_KEY] = current;
        service.onStorageChanged(change(dirty({ model: 'obsolete' })), 'local');
        await settle();
        expect(values[LEGACY_STORAGE_KEY]).toBe(current);
    });

    it('also strips an object value (not only a JSON string)', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        await enableOwner(service, { complete: true });
        const value = JSON.parse(dirty());
        values[LEGACY_STORAGE_KEY] = value;
        service.onStorageChanged(change(value), 'local');
        await vi.waitFor(() => expect(values[LEGACY_STORAGE_KEY].state).toEqual({ model: 'changed' }));
    });

    it('does not loop: its own clean write triggers onChanged and causes no further write', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        service.register();
        await enableOwner(service, { complete: true });
        api.storage.local.set.mockClear();

        values[LEGACY_STORAGE_KEY] = dirty();
        service.onStorageChanged(change(values[LEGACY_STORAGE_KEY]), 'local');
        await vi.waitFor(() => expect(writesToLegacy()).toHaveLength(1));
        await settle(50);
        expect(writesToLegacy()).toHaveLength(1);
    });

    it('writes nothing when the value is already clean', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        await enableOwner(service, { complete: true });
        api.storage.local.set.mockClear();
        service.onStorageChanged(change(JSON.stringify({ state: { model: 'x' } })), 'local');
        await settle();
        expect(writesToLegacy()).toHaveLength(0);
    });

    it('ignores the value before activation (history not enabled)', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        const before = dirty();
        values[LEGACY_STORAGE_KEY] = before;
        service.onStorageChanged(change(before), 'local');
        await settle();
        expect(values[LEGACY_STORAGE_KEY]).toBe(before);
        expect(writesToLegacy()).toHaveLength(0);
    });

    it('ignores the value between prepare and activate', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        await ask(service, { type: 'history.prepare' });
        const before = dirty();
        values[LEGACY_STORAGE_KEY] = before;
        service.onStorageChanged(change(before), 'local');
        await settle();
        expect(values[LEGACY_STORAGE_KEY]).toBe(before);
    });

    it.each([
        ['another area', { [LEGACY_STORAGE_KEY]: { newValue: 'x' } }, 'sync'],
        ['another key', { other: { newValue: dirty() } }, 'local'],
        ['a removed value', { [LEGACY_STORAGE_KEY]: { oldValue: 'x' } }, 'local'],
    ])('ignores %s', async (_label, changes, area) => {
        const service = makeService({ schedule: recordingSchedule() });
        await enableOwner(service, { complete: true });
        api.storage.local.set.mockClear();
        service.onStorageChanged(changes, area);
        await settle();
        expect(writesToLegacy()).toHaveLength(0);
    });

    it('does not throw or write for an unparsable string', async () => {
        const service = makeService({ schedule: recordingSchedule() });
        await enableOwner(service, { complete: true });
        api.storage.local.set.mockClear();
        expect(() => service.onStorageChanged(change('{not json'), 'local')).not.toThrow();
        await settle();
        expect(writesToLegacy()).toHaveLength(0);
    });
});
