import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { openHistoryDatabase } from './historyRepository';
import { createHistoryOwner, migrationBudget, LEGACY_STORAGE_KEY, HISTORY_ENABLED_KEY } from './historyMigration';
import { serializeSession, MAX_HISTORY_CHUNK_BYTES } from './historySerialization';
import { authId } from './historyReader';

const BODY_MARKER = 'SECRET-BODY-4f2a';
const TITLE_MARKER = 'SECRET-TITLE-9c1d';
const DATA_URL = 'data:image/png;base64,AAAABBBBCCCC';

let repo;
let values;
let storageWrites;
let published;
let opened;

beforeEach(async () => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    repo = await openHistoryDatabase({ name: `faults-${Math.random()}`, indexedDB: new IDBFactory() });
    opened = [repo];
    values = {};
    storageWrites = [];
    published = [];
});
afterEach(() => { opened.forEach(item => item.close()); });

const makeStorage = () => ({
    get: async key => values[key],
    set: async (key, value) => { storageWrites.push([key, value]); values[key] = value; },
});
const setLegacy = (sessions, state = {}) => { values[LEGACY_STORAGE_KEY] = JSON.stringify({ state: { sessions, model: 'm', ...state }, version: 3 }); };
const legacyState = () => JSON.parse(values[LEGACY_STORAGE_KEY]).state;

const fullBudget = { ...migrationBudget, maxWakeDurationMs: Infinity, minPauseMs: 0 };
// With min pause equal to the wake duration, every runWake converts exactly one staged unit.
// A one-byte batch limit makes each step a single unit (a manifest still converts as a whole).
const stepBudget = { ...migrationBudget, maxChunkBytes: 1, maxWakeDurationMs: 10, minPauseMs: 10 };
const unitBudget = { ...fullBudget, maxChunkBytes: 1 };
const makeOwner = (overrides = {}) => createHistoryOwner({
    repository: repo,
    storage: makeStorage(),
    pause: async () => {},
    budget: fullBudget,
    broadcast: event => { if (event.type === 'history.status.changed') published.push(event.status); },
    ...overrides,
});

const message = (index, extra = {}) => ({ role: index % 2 ? 'assistant' : 'user', content: `message ${index}`, ...extra });
const baseSessions = () => [
    {
        id: 'a', title: 'Alpha', model: 'm1', updatedAt: 1,
        messages: [message(0, { content: `a0 ${BODY_MARKER}` }), message(1, { files: [{ name: 'f.png', content: DATA_URL, originalContent: DATA_URL }] }), message(2)],
    },
    { id: 'b', title: 'Beta', model: 'm2', updatedAt: 2, messages: [message(0, { content: 'b0' }), message(1, { content: 'b1' })] },
];

const messagesOf = (result, id) => result.sessions.find(session => session.id === id)?.messages;
const idsOf = result => result.sessions.map(session => session.id).sort();

async function drain(service, limit = 500) {
    for (let index = 0; index < limit; index++) {
        const status = await service.runWake();
        if (['complete', 'error'].includes(status.phase)) return status;
    }
    throw new Error('migration did not settle');
}

const spyOn = (repository, log) => new Proxy(repository, {
    get(target, property) {
        const value = target[property];
        if (typeof value !== 'function') return value;
        return (...args) => { log.push({ method: property, args }); return value.apply(target, args); };
    },
});

// Throws once on the Nth call of one repository method, counting starts when armed.
function withFaults(repository) {
    const plan = { armed: false, method: null, nth: 1, when: 'before', error: null, finalizeOnly: false, calls: 0, fired: false };
    let finalizing = false;
    const proxy = new Proxy(repository, {
        get(target, property) {
            const value = target[property];
            if (typeof value !== 'function') return value;
            return (...args) => {
                if (property === 'getNextStagedUnits') {
                    return value.apply(target, args).then(units => { if (!units.length) finalizing = true; return units; });
                }
                if (plan.armed && !plan.fired && property === plan.method && (!plan.finalizeOnly || finalizing)) {
                    plan.calls += 1;
                    if (plan.calls === plan.nth) {
                        plan.fired = true;
                        if (plan.when === 'before') return Promise.reject(plan.error);
                        return Promise.resolve(value.apply(target, args)).then(() => { throw plan.error; });
                    }
                }
                return value.apply(target, args);
            };
        },
    });
    return {
        repository: proxy,
        plan,
        arm(options) { Object.assign(plan, { armed: true, nth: 1, when: 'before', finalizeOnly: false, calls: 0, fired: false }, options); finalizing = false; },
        get fired() { return plan.fired; },
    };
}

const rawText = value => JSON.stringify(value, (_, item) => {
    if (ArrayBuffer.isView(item)) return Array.from(item).map(code => String.fromCharCode(code)).join('');
    if (Object.prototype.toString.call(item) === '[object ArrayBuffer]') return Array.from(new Uint8Array(item)).map(code => String.fromCharCode(code)).join('');
    return item;
});

async function savedDump() {
    const dump = [];
    for (const { id } of await repo.listConversations()) dump.push(await repo.getConversation(id));
    dump.push(await repo.getMigrationStatus(), await repo.getMetadata('source-snapshot'));
    return rawText(dump);
}

describe('prepare then activate with a changing legacy blob', () => {
    it('stages only changed sessions, tombstones deleted ones and keeps totals sane', async () => {
        setLegacy([...baseSessions(), { id: 'c', title: 'Gamma', updatedAt: 3, messages: [message(0, { content: 'c0' })] }]);
        const log = [];
        const service = makeOwner({ repository: spyOn(repo, log) });
        const prepared = await service.prepare();
        expect(prepared.phase).toBe('preparing');
        expect(prepared.enabled).toBe(false);

        const sessions = baseSessions();
        sessions[0].messages.push(message(3, { content: 'a3 new' }));
        sessions[0].updatedAt = 5;
        const added = { id: 'd', title: 'Delta', updatedAt: 6, messages: [message(0, { content: 'd0' })] };
        setLegacy([...sessions, added]);
        log.length = 0;
        const activated = await service.activate();
        expect(activated).toMatchObject({ enabled: true, phase: 'migrating', verifiedBytes: 0 });

        const staged = log.filter(entry => entry.method === 'putStagedUnits').flatMap(entry => entry.args[0]);
        expect(new Set(staged.map(unit => unit.conversationId))).toEqual(new Set(['a', 'd']));
        expect(log.filter(entry => entry.method === 'deleteConversation').map(entry => entry.args[0])).toEqual(['c']);
        expect((await repo.getTombstone('c')).deleted).toBe(true);

        const expectedIds = [...sessions, added].flatMap(session => serializeSession(session).map(unit => unit.id)).sort();
        expect((await repo.getStagedUnits()).map(unit => unit.id).sort()).toEqual(expectedIds);

        const done = await drain(service);
        expect(done.phase).toBe('complete');
        expect(done.progress).toBe(1);
        expect(done.verifiedBytes).toBeGreaterThan(0);
        expect(done.verifiedBytes).toBeLessThanOrEqual(done.totalBytes);
        const restored = await service.restore();
        expect(idsOf(restored)).toEqual(['a', 'b', 'd']);
        expect(messagesOf(restored, 'a')).toEqual(sessions[0].messages);
        expect(messagesOf(restored, 'b')).toEqual(sessions[1].messages);
        expect(messagesOf(restored, 'd')).toEqual(added.messages);
        expect(await service.reader.listConversationIds()).not.toContain('c');
        expect(await repo.getStagedUnits()).toEqual([]);
        for (const status of published) {
            expect(status.progress).toBeGreaterThanOrEqual(0);
            expect(status.progress).toBeLessThanOrEqual(1);
        }
    });

    it('never restores a session deleted between prepare and activate', async () => {
        setLegacy(baseSessions());
        const service = makeOwner();
        await service.prepare();
        setLegacy([baseSessions()[1]]);
        await service.activate();
        await drain(service);
        const restored = await service.restore();
        expect(idsOf(restored)).toEqual(['b']);
        expect(await repo.getConversation('a')).toBeNull();
        expect(await repo.getStagedUnits('a')).toEqual([]);
    });

    it('prepare and enable are idempotent', async () => {
        setLegacy(baseSessions());
        const service = makeOwner();
        await service.prepare();
        const first = (await repo.getStagedUnits()).map(unit => unit.id).sort();
        const preparedAgain = await service.prepare();
        expect((await repo.getStagedUnits()).map(unit => unit.id).sort()).toEqual(first);
        expect(preparedAgain.totalBytes).toBeGreaterThan(0);

        await service.enable();
        const enabledAgain = await service.enable();
        const concurrent = await Promise.all([service.enable(), service.enable(), service.prepare()]);
        expect(concurrent.every(status => status.enabled)).toBe(true);
        expect(enabledAgain.enabled).toBe(true);
        expect((await repo.getStagedUnits()).map(unit => unit.id).sort()).toEqual(first);

        await drain(service);
        await service.enable();
        const restored = await service.restore();
        expect(restored.sessions).toHaveLength(2);
        expect(messagesOf(restored, 'a')).toEqual(baseSessions()[0].messages);
        expect(messagesOf(restored, 'b')).toEqual(baseSessions()[1].messages);
        expect((await service.status()).phase).toBe('complete');
    });

    it('a repeated prepare drops units of messages removed from the legacy blob', async () => {
        setLegacy(baseSessions());
        const service = makeOwner();
        await service.prepare();
        const sessions = baseSessions();
        sessions[0].messages.pop();
        setLegacy(sessions);
        await service.prepare();
        const expected = sessions.flatMap(session => serializeSession(session).map(unit => unit.id)).sort();
        expect((await repo.getStagedUnits()).map(unit => unit.id).sort()).toEqual(expected);
        await service.activate();
        await drain(service);
        expect(messagesOf(await service.restore(), 'a')).toEqual(sessions[0].messages);
    });

    it('activate twice keeps the first activation result', async () => {
        setLegacy(baseSessions());
        const service = makeOwner();
        await service.prepare();
        const first = await service.activate();
        const second = await service.activate();
        expect(second).toEqual(first);
        await expect(makeOwner().activate().catch(error => error.message)).resolves.toBeDefined();
    });
});

describe('fault injection during conversion and finalization', () => {
    const convertPoints = [
        ['commitRevision', 1, 'before'], ['commitRevision', 3, 'before'], ['commitRevision', 8, 'before'],
        ['commitRevision', 1, 'after'], ['commitRevision', 4, 'after'],
        ['getRecords', 1, 'before'], ['getRecords', 3, 'before'],
        ['deleteStagedUnits', 1, 'before'], ['deleteStagedUnits', 5, 'before'],
        ['deleteStagedUnits', 1, 'after'], ['deleteStagedUnits', 6, 'after'],
        ['getConversationHead', 2, 'before'], ['getTombstone', 2, 'before'], ['getMigrationStatus', 3, 'before'],
    ];
    const finalizePoints = [
        ['setMigrationStatus', 1, 'before'], ['setMigrationStatus', 1, 'after'],
        ['setMigrationStatus', 2, 'before'], ['setMigrationStatus', 2, 'after'],
        ['countStagedUnits', 1, 'before'], ['listConversations', 1, 'before'], ['listStagedConversationIds', 1, 'before'],
        ['getTombstone', 1, 'before'], ['getConversationHead', 1, 'before'], ['getRecordKeys', 1, 'before'],
        ['getStagedUnitsOfKind', 1, 'before'],
    ];

    async function expectRecovery(harness, service, { expectStaged }) {
        expect(harness.fired).toBe(true);
        const failed = await service.status();
        expect(failed.phase).toBe('error');
        expect(failed.enabled).toBe(true);
        expect(failed.lastError).toContain('injected fault');
        if (expectStaged) expect((await repo.countStagedUnits())).toBeGreaterThan(0);
        // History stays readable and exact while the migration is in the error phase.
        const during = await service.restore();
        expect(messagesOf(during, 'a')).toEqual(baseSessions()[0].messages);
        expect(messagesOf(during, 'b')).toEqual(baseSessions()[1].messages);

        await service.resume();
        const resumed = await service.runWake();
        expect(resumed.phase).toBe('complete');
        expect(await repo.countStagedUnits()).toBe(0);
        const restored = await service.restore();
        expect(restored.sessions).toHaveLength(2);
        expect(messagesOf(restored, 'a')).toEqual(baseSessions()[0].messages);
        expect(messagesOf(restored, 'b')).toEqual(baseSessions()[1].messages);
        const legacy = legacyState();
        expect(legacy.sessions).toBeUndefined();
        expect(legacy.messages).toBeUndefined();
        expect(legacy.model).toBe('m');
    }

    it.each(convertPoints)('convertUnit: %s call %i throws %s', async (method, nth, when) => {
        setLegacy(baseSessions());
        const harness = withFaults(repo);
        const service = makeOwner({ repository: harness.repository, budget: unitBudget });
        await service.enable();
        harness.arm({ method, nth, when, error: new Error(`injected fault ${method}`) });
        await service.runWake();
        await expectRecovery(harness, service, { expectStaged: !(method === 'deleteStagedUnits' && when === 'after') });
    });

    it.each(finalizePoints)('finalize: %s call %i throws %s', async (method, nth, when) => {
        setLegacy(baseSessions());
        const harness = withFaults(repo);
        const service = makeOwner({ repository: harness.repository });
        await service.enable();
        harness.arm({ method, nth, when, finalizeOnly: true, error: new Error(`injected fault ${method}`) });
        await service.runWake();
        await expectRecovery(harness, service, { expectStaged: false });
    });

    it('a fault while staging during enable surfaces as an error and a resume completes', async () => {
        setLegacy(baseSessions());
        const harness = withFaults(repo);
        const service = makeOwner({ repository: harness.repository });
        harness.arm({ method: 'putStagedUnits', nth: 1, error: new Error('injected fault putStagedUnits') });
        await expect(service.enable()).rejects.toThrow('injected fault');
        expect((await service.status()).phase).toBe('error');
        await service.resume();
        const done = await drain(service);
        expect(done.phase).toBe('complete');
        const restored = await service.restore();
        expect(restored.sessions).toHaveLength(2);
        expect(messagesOf(restored, 'a')).toEqual(baseSessions()[0].messages);
        expect(legacyState().sessions).toBeUndefined();
    });

    it('a fault while staging the activation delta leaves a resumable state', async () => {
        setLegacy(baseSessions());
        const harness = withFaults(repo);
        const service = makeOwner({ repository: harness.repository });
        await service.prepare();
        const sessions = baseSessions();
        sessions[1].messages.push(message(2, { content: 'b2' }));
        setLegacy(sessions);
        harness.arm({ method: 'putStagedUnits', nth: 1, error: new Error('injected fault putStagedUnits') });
        await expect(service.activate()).rejects.toThrow('injected fault');
        expect((await service.status()).enabled).toBe(false);
        await service.resume();
        const done = await drain(service);
        expect(done.phase).toBe('complete');
        const restored = await service.restore();
        expect(messagesOf(restored, 'b')).toEqual(sessions[1].messages);
        expect(messagesOf(restored, 'a')).toEqual(sessions[0].messages);
    });

    it('a quota failure keeps phase error with its text and writes plaintext only to the staged store', async () => {
        setLegacy(baseSessions());
        const harness = withFaults(repo);
        const service = makeOwner({ repository: harness.repository });
        await service.enable();
        const quota = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
        harness.arm({ method: 'commitRevision', nth: 2, error: quota });
        const failed = await service.runWake();
        expect(failed.phase).toBe('error');
        expect(failed.lastError).toContain('quota');
        expect(await repo.countStagedUnits()).toBeGreaterThan(0);
        expect(await savedDump()).not.toContain(BODY_MARKER);
        expect(rawText(storageWrites.filter(([key]) => key !== LEGACY_STORAGE_KEY))).not.toContain(BODY_MARKER);
        expect(storageWrites.filter(([key]) => key === LEGACY_STORAGE_KEY)).toEqual([]);
        expect(storageWrites).toEqual([[HISTORY_ENABLED_KEY, true]]);
        expect(published.at(-1).phase).toBe('error');

        await service.resume();
        expect((await service.runWake()).phase).toBe('complete');
        expect(await savedDump()).not.toContain(BODY_MARKER);
        expect(messagesOf(await service.restore(), 'a')).toEqual(baseSessions()[0].messages);
    });

    it('does not keep message bodies in plaintext outside the staged store', async () => {
        setLegacy(baseSessions());
        const service = makeOwner();
        await service.enable();
        await service.runWake();
        const dump = await savedDump();
        expect(dump).not.toContain(BODY_MARKER);
        expect(dump).not.toContain('AAAABBBB');
    });

    it('does not keep session titles in plaintext outside the staged store', async () => {
        setLegacy([{ id: 'a', title: TITLE_MARKER, updatedAt: 1, messages: [message(0)] }]);
        const service = makeOwner();
        await service.enable();
        await service.runWake();
        expect(await savedDump()).not.toContain(TITLE_MARKER);
    });
});

describe('completion guards', () => {
    const phasesPublished = () => published.map(status => status.phase);

    it('never publishes complete when the cleaned legacy blob cannot be written', async () => {
        setLegacy(baseSessions());
        let failing = false;
        const storage = makeStorage();
        const guarded = { get: storage.get, set: async (key, value) => { if (failing && key === LEGACY_STORAGE_KEY) throw new Error('storage write failed'); return storage.set(key, value); } };
        const service = makeOwner({ storage: guarded });
        await service.enable();
        failing = true;
        const failed = await service.runWake();
        expect(failed.phase).toBe('error');
        expect(failed.lastError).toContain('storage write failed');
        expect(phasesPublished()).not.toContain('complete');
        expect(await repo.countStagedUnits()).toBe(0);
        expect(legacyState().sessions).toHaveLength(2);

        failing = false;
        await service.resume();
        expect((await service.runWake()).phase).toBe('complete');
        expect(legacyState().sessions).toBeUndefined();
    });

    it('never publishes complete when the cleanup leaves sessions behind', async () => {
        setLegacy(baseSessions());
        let ignoring = false;
        const storage = makeStorage();
        const guarded = { get: storage.get, set: async (key, value) => { if (ignoring && key === LEGACY_STORAGE_KEY) return; return storage.set(key, value); } };
        const service = makeOwner({ storage: guarded });
        await service.enable();
        ignoring = true;
        const failed = await service.runWake();
        expect(failed.phase).toBe('error');
        expect(failed.lastError).toContain('cleanup failed');
        expect(phasesPublished()).not.toContain('complete');
        ignoring = false;
        await service.resume();
        expect((await service.runWake()).phase).toBe('complete');
    });

    it('never publishes complete while staged units remain', async () => {
        setLegacy(baseSessions());
        const harness = withFaults(repo);
        const service = makeOwner({ repository: new Proxy(harness.repository, { get: (target, property) => (property === 'countStagedUnits' ? async () => 1 : target[property]) }) });
        await service.enable();
        const failed = await service.runWake();
        expect(failed.phase).toBe('error');
        expect(failed.lastError).toContain('pending records');
        expect(phasesPublished()).not.toContain('complete');
        expect(legacyState().sessions).toHaveLength(2);
    });

    it('publishes complete only once every staged unit is gone', async () => {
        setLegacy(baseSessions());
        const service = makeOwner({ budget: stepBudget });
        await service.enable();
        const total = await repo.countStagedUnits();
        for (let index = 0; index < total; index++) {
            const before = await repo.countStagedUnits();
            expect(before).toBeGreaterThan(0);
            const status = await service.runWake();
            expect(status.phase).toBe(index === total - 1 ? 'migrating' : 'migrating');
        }
        expect(await repo.countStagedUnits()).toBe(0);
        expect((await service.status()).phase).not.toBe('complete');
        expect((await service.runWake()).phase).toBe('complete');
        const completes = published.filter(status => status.phase === 'complete');
        expect(completes).toHaveLength(1);
    });
});

describe('commands while migrating', () => {
    const appendCommand = (commandId, content, sessionId = 'a', extra = {}) => ({ type: 'history.append', commandId, sessionId, message: { role: 'assistant', content }, ...extra });

    async function stagedService(budget = stepBudget) {
        setLegacy(baseSessions());
        const service = makeOwner({ budget });
        await service.enable();
        return service;
    }

    it('keeps every message in order across interleaved append, create, truncate and delete', async () => {
        const service = await stagedService();
        let expectedA = baseSessions()[0].messages;
        let expectedB = null;
        const check = async () => {
            const restored = await service.restore();
            expect(messagesOf(restored, 'a')).toEqual(expectedA);
            expect(messagesOf(restored, 'b') ?? null).toEqual(expectedB === null ? (baseSessions()[1].messages) : expectedB);
        };
        expectedB = baseSessions()[1].messages;
        await service.runWake();
        await check();
        await service.command(appendCommand('x1', 'reply 1'));
        expectedA = [...expectedA, { role: 'assistant', content: 'reply 1' }];
        await check();
        await service.runWake();
        await service.runWake();
        await check();
        const created = { id: 'n', title: 'New', model: 'm', messages: [message(0, { content: 'n0' }), message(1, { content: 'n1' })] };
        await service.command({ type: 'history.create', commandId: 'create-n', sessionId: 'n', session: created });
        await service.runWake();
        let restored = await service.restore();
        expect(messagesOf(restored, 'n')).toEqual(created.messages);
        await service.command({ type: 'history.truncate', commandId: 'trunc-a', sessionId: 'a', messageIndex: 2 });
        expectedA = expectedA.slice(0, 2);
        await check();
        await service.command(appendCommand('x2', 'reply 2'));
        expectedA = [...expectedA, { role: 'assistant', content: 'reply 2' }];
        await service.runWake();
        await check();
        await service.command({ type: 'history.delete', commandId: 'del-b', sessionId: 'b' });
        await service.command(appendCommand('x3', 'reply 3'));
        expectedA = [...expectedA, { role: 'assistant', content: 'reply 3' }];
        restored = await service.restore();
        expect(idsOf(restored)).toEqual(['a', 'n']);
        expect(messagesOf(restored, 'a')).toEqual(expectedA);

        const done = await drain(makeOwner());
        expect(done.phase).toBe('complete');
        restored = await service.restore();
        expect(idsOf(restored)).toEqual(['a', 'n']);
        expect(messagesOf(restored, 'a')).toEqual(expectedA);
        expect(messagesOf(restored, 'n')).toEqual(created.messages);
        expect(await repo.countStagedUnits()).toBe(0);
    });

    it('handles 25 concurrent commands next to a running wake', async () => {
        const service = await stagedService(fullBudget);
        const wake = service.runWake();
        const commands = Array.from({ length: 25 }, (_, index) => service.command(appendCommand(`c${String(index).padStart(2, '0')}`, `reply ${index}`)));
        const results = await Promise.all(commands);
        expect(results.every(result => result.revision > 0 && !result.error)).toBe(true);
        await wake;
        const done = await drain(service);
        expect(done.phase).toBe('complete');
        const restored = await service.restore();
        expect(messagesOf(restored, 'a')).toEqual([
            ...baseSessions()[0].messages,
            ...Array.from({ length: 25 }, (_, index) => ({ role: 'assistant', content: `reply ${index}` })),
        ]);
        expect(messagesOf(restored, 'b')).toEqual(baseSessions()[1].messages);
    });

    it('records one message when the same commandId is sent twice', async () => {
        const service = await stagedService();
        const first = await service.command(appendCommand('same', 'once'));
        const second = await service.command(appendCommand('same', 'once'));
        const concurrent = await Promise.all([service.command(appendCommand('same', 'once')), service.command(appendCommand('same', 'once'))]);
        expect(second).toEqual(first);
        expect(concurrent).toEqual([first, first]);
        await drain(makeOwner({ budget: fullBudget }));
        const contents = messagesOf(await service.restore(), 'a').map(item => item.content);
        expect(contents.filter(content => content === 'once')).toHaveLength(1);
        expect(contents).toHaveLength(baseSessions()[0].messages.length + 1);
    });

    it('answers an append to a deleted conversation with a benign error and keeps the phase', async () => {
        const service = await stagedService();
        await service.command({ type: 'history.delete', commandId: 'del', sessionId: 'a' });
        const before = await service.status();
        const result = await service.command(appendCommand('late', 'too late'));
        expect(result).toMatchObject({ error: 'HISTORY_DELETED' });
        const recreate = await service.command({ type: 'history.create', commandId: 'again', sessionId: 'a', session: { id: 'a', title: 'x', messages: [] } });
        expect(recreate).toMatchObject({ error: 'HISTORY_DELETED' });
        const after = await service.status();
        expect(after.phase).toBe(before.phase);
        expect(after.phase).not.toBe('error');
        expect(after.lastError ?? null).toBeNull();
        expect(published.map(status => status.phase)).not.toContain('error');
        const done = await drain(service);
        expect(done.phase).toBe('complete');
        expect(idsOf(await service.restore())).toEqual(['b']);
    });

    it('answers a stale append for an unknown conversation without metadata with a benign error', async () => {
        const service = await stagedService();
        const result = await service.command(appendCommand('ghost-1', 'hi', 'ghost'));
        expect(result).toMatchObject({ error: 'HISTORY_NOT_FOUND' });
        const truncate = await service.command({ type: 'history.truncate', commandId: 'ghost-2', sessionId: 'ghost', messageIndex: 0 });
        expect(truncate).toMatchObject({ error: 'HISTORY_NOT_FOUND' });
        expect((await service.status()).phase).toBe('migrating');
        expect(idsOf(await service.restore())).toEqual(['a', 'b']);
    });

    it('creates the conversation for a stale append that carries session metadata', async () => {
        const service = await stagedService();
        const result = await service.command(appendCommand('ghost-3', 'hi', 'ghost', { session: { id: 'ghost', title: 'Ghost', model: 'm', messages: [message(9)] } }));
        expect(result.error).toBeUndefined();
        const ghost = (await service.restore()).sessions.find(session => session.id === 'ghost');
        expect(ghost).toMatchObject({ title: 'Ghost', model: 'm' });
        expect(ghost.messages).toEqual([{ role: 'assistant', content: 'hi' }]);
        expect((await service.status()).phase).toBe('migrating');
    });

    it('rejects malformed commands without touching migration data', async () => {
        const service = await stagedService();
        await expect(service.command({ type: 'history.unknown', commandId: 'x', sessionId: 'a' })).rejects.toThrow('Invalid history command');
        await service.resume();
        expect(idsOf(await service.restore())).toEqual(['a', 'b']);
    });

    it.each([0, 3, 'all'])('truncate removes messages, attachments and staged units (%s units converted first)', async converted => {
        const attachment = index => `data:image/png;base64,${String(index).repeat(12)}`;
        const messages = [
            message(0, { content: 't0' }),
            message(1, { content: 't1', files: [{ content: attachment(1), originalContent: attachment(1) }] }),
            message(2, { content: 't2', files: [{ content: attachment(2) }] }),
            message(3, { content: 't3' }),
        ];
        setLegacy([{ id: 't', title: 'T', updatedAt: 1, messages }]);
        const service = makeOwner({ budget: stepBudget });
        await service.enable();
        if (converted === 'all') await drain(makeOwner({ budget: fullBudget, repository: repo }));
        else for (let index = 0; index < converted; index++) await service.runWake();
        await service.command({ type: 'history.truncate', commandId: 'trunc', sessionId: 't', messageIndex: 1 });

        const stagedIds = await repo.listStagedUnitIds('t');
        expect(stagedIds.filter(unitId => /legacy:[123]/.test(unitId))).toEqual([]);
        const keys = await repo.getRecordKeys('t');
        expect(keys.messages.map(item => item.id).filter(id => id !== 'legacy:0')).toEqual([]);
        expect(keys.attachments).toEqual([]);
        expect(messagesOf(await service.restore(), 't')).toEqual([messages[0]]);

        await service.command(appendCommand('after-trunc', 'new', 't'));
        const done = await drain(service);
        expect(done.phase).toBe('complete');
        expect(messagesOf(await service.restore(), 't')).toEqual([messages[0], { role: 'assistant', content: 'new' }]);
        expect((await repo.getRecordKeys('t')).attachments).toEqual([]);
    });

    it('appending to a large staged conversation does not convert its messages', async () => {
        const messages = Array.from({ length: 40 }, (_, index) => message(index, { content: `big ${index}` }));
        setLegacy([{ id: 'big', title: 'Big', updatedAt: 1, messages }]);
        const service = makeOwner({ budget: stepBudget });
        await service.enable();
        const before = await repo.listStagedUnitIds('big');
        const manifestUnits = (await repo.getStagedUnitsOfKind('big', 'manifest')).length;
        expect(before).toHaveLength(40 + manifestUnits);

        await service.command(appendCommand('big-1', 'tail', 'big'));
        const after = await repo.listStagedUnitIds('big');
        expect(after).toHaveLength(before.length - manifestUnits);
        expect(after.some(unitId => unitId.includes('/manifest/'))).toBe(false);
        expect((await repo.getRecordKeys('big')).messages).toHaveLength(1);
        const restored = messagesOf(await service.restore(), 'big');
        expect(restored).toEqual([...messages, { role: 'assistant', content: 'tail' }]);
    });
});

describe('record binding', () => {
    async function migrated() {
        setLegacy(baseSessions());
        const service = makeOwner();
        await service.enable();
        await drain(service);
        return service;
    }
    const copy = async ({ from, to, fromId, toId, revision, store = 'messages' }) => {
        const record = await repo.getRecord({ store, conversationId: from, id: fromId });
        const head = await repo.getConversationHead(to);
        await repo.commitRevision({
            id: to, expectedRevision: head.revision,
            encryptedRecords: { [store]: [{ id: toId, revision: revision ?? record.revision, chunkIndex: 0, record: record.record }] },
        });
    };

    it('restore succeeds on the untouched data (control)', async () => {
        const service = await migrated();
        expect((await service.restore()).sessions).toHaveLength(2);
    });

    it('rejects a message record copied from another conversation', async () => {
        const service = await migrated();
        await copy({ from: 'a', to: 'b', fromId: 'legacy:0', toId: 'legacy:0' });
        await expect(service.restore()).rejects.toThrow();
        await expect(service.reader.decodeConversation('b')).rejects.toThrow();
        await expect(service.reader.decodeConversation('a')).resolves.toBeTruthy();
    });

    it('rejects a message record copied to another record id of the same conversation', async () => {
        const service = await migrated();
        await copy({ from: 'a', to: 'a', fromId: 'legacy:0', toId: 'legacy:1' });
        await expect(service.reader.decodeConversation('a')).rejects.toThrow();
    });

    it('rejects a record whose revision was altered', async () => {
        const service = await migrated();
        const record = await repo.getRecord({ store: 'messages', conversationId: 'a', id: 'legacy:0' });
        await copy({ from: 'a', to: 'a', fromId: 'legacy:0', toId: 'legacy:0', revision: record.revision + 100 });
        await expect(service.reader.decodeConversation('a')).rejects.toThrow();
    });

    it('rejects an attachment copied between conversations', async () => {
        const service = await migrated();
        const keys = await repo.getRecordKeys('a');
        expect(keys.attachments.length).toBeGreaterThan(0);
        await copy({ from: 'a', to: 'b', fromId: keys.attachments[0].id, toId: keys.attachments[0].id, store: 'attachments' });
        // The attachment is unreferenced in b, so b decodes, but the record is bound to a and must not decrypt in b.
        const key = await repo.getMetadata('installation-key');
        const { decryptRecord } = await import('./historyCrypto');
        const stored = await repo.getRecord({ store: 'attachments', conversationId: 'b', id: keys.attachments[0].id });
        await expect(decryptRecord({ key, record: stored.record, recordId: authId({ conversationId: 'b', kind: 'attachments', recordId: keys.attachments[0].id }), revision: stored.revision, chunkIndex: 0 })).rejects.toThrow();
        void service;
    });
});

describe('pause and resume', () => {
    it('pause stops progress and keeps verified bytes, resume continues', async () => {
        setLegacy(baseSessions());
        const service = makeOwner({ budget: stepBudget });
        await service.enable();
        const total = await repo.countStagedUnits();
        await service.runWake();
        await service.runWake();
        const running = await service.status();
        expect(running.verifiedBytes).toBeGreaterThan(0);

        const paused = await service.pause();
        expect(paused.phase).toBe('paused');
        expect(paused.verifiedBytes).toBe(running.verifiedBytes);
        expect(await service.needsWork()).toBe(false);
        const stagedWhilePaused = await repo.countStagedUnits();
        const idle = await service.runWake();
        expect(idle.phase).toBe('paused');
        expect(idle.verifiedBytes).toBe(running.verifiedBytes);
        expect(await repo.countStagedUnits()).toBe(stagedWhilePaused);
        expect(stagedWhilePaused).toBe(total - 2);

        const resumed = await service.resume();
        expect(resumed.phase).toBe('migrating');
        expect(resumed.verifiedBytes).toBe(running.verifiedBytes);
        const progressed = await service.runWake();
        expect(progressed.verifiedBytes).toBeGreaterThan(running.verifiedBytes);
        expect(progressed.phase).not.toBe('complete');
        const done = await drain(service);
        expect(done.phase).toBe('complete');
        expect(await repo.countStagedUnits()).toBe(0);
        expect(messagesOf(await service.restore(), 'a')).toEqual(baseSessions()[0].messages);
    });

    it('a pause queued during a wake stops it after the current unit', async () => {
        setLegacy(baseSessions());
        const service = makeOwner({ budget: unitBudget });
        await service.enable();
        const total = await repo.countStagedUnits();
        const wake = service.runWake();
        const paused = service.pause();
        const final = await wake;
        expect((await paused).phase).toBe('paused');
        expect(final.phase).toBe('paused');
        expect(await repo.countStagedUnits()).toBe(total - 1);
        await service.resume();
        expect((await service.runWake()).phase).toBe('complete');
    });

    it('pause leaves a completed or errored migration unchanged', async () => {
        setLegacy(baseSessions());
        const service = makeOwner();
        await service.enable();
        await drain(service);
        expect((await service.pause()).phase).toBe('complete');
        expect((await service.resume()).phase).toBe('migrating');
        expect((await service.runWake()).phase).toBe('complete');
    });
});

describe('scheduler', () => {
    const sixMessages = () => [{ id: 'a', title: 'Alpha', updatedAt: 1, messages: Array.from({ length: 6 }, (_, index) => message(index)) }];

    function clockHarness({ cost = 0, budget = {} } = {}) {
        const clock = { t: 1000 };
        const pauses = [];
        const converted = [];
        let inFlight = 0;
        let maxInFlight = 0;
        const repository = new Proxy(repo, {
            get(target, property) {
                const value = target[property];
                if (property === 'commitRevision' || property === 'deleteStagedUnits') {
                    return async (...args) => {
                        inFlight += 1;
                        maxInFlight = Math.max(maxInFlight, inFlight);
                        await new Promise(resolve => setTimeout(resolve, 0));
                        if (property === 'commitRevision') clock.t += cost;
                        try { return await value.apply(target, args); } finally { inFlight -= 1; }
                    };
                }
                if (property === 'deleteStagedUnits') return value;
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const service = makeOwner({
            repository,
            now: () => clock.t,
            pause: async ms => { pauses.push(ms); clock.t += ms; },
            budget: { ...migrationBudget, maxChunkBytes: 1, maxWakeDurationMs: 100000, ...budget },
        });
        return { clock, pauses, converted, service, stats: () => ({ maxInFlight }) };
    }

    it('runs one conversion at a time even with concurrent wakes and commands', async () => {
        setLegacy(sixMessages());
        const harness = clockHarness();
        await harness.service.enable();
        const first = harness.service.runWake();
        const second = harness.service.runWake();
        expect(second).toBe(first);
        const commands = Array.from({ length: 5 }, (_, index) => harness.service.command({ type: 'history.append', commandId: `k${index}`, sessionId: 'a', message: { role: 'user', content: `k${index}` } }));
        await Promise.all([first, ...commands]);
        expect(harness.stats().maxInFlight).toBe(1);
        expect((await harness.service.status()).phase).toBe('complete');
        expect(messagesOf(await harness.service.restore(), 'a')).toHaveLength(6 + 5);
    });

    it('pauses at least minPauseMs after every unit', async () => {
        setLegacy(sixMessages());
        const harness = clockHarness();
        await harness.service.enable();
        const units = await repo.countStagedUnits();
        await harness.service.runWake();
        expect(harness.pauses).toHaveLength(units);
        expect(Math.min(...harness.pauses)).toBeGreaterThanOrEqual(migrationBudget.minPauseMs);
        expect(harness.pauses.every(ms => ms === migrationBudget.minPauseMs)).toBe(true);
    });

    it('stops at maxWakeDurationMs and continues on the next wake', async () => {
        setLegacy(sixMessages());
        const harness = clockHarness({ budget: { maxWakeDurationMs: 500 } });
        await harness.service.enable();
        const units = await repo.countStagedUnits();
        const started = harness.clock.t;
        const status = await harness.service.runWake();
        expect(harness.clock.t - started).toBeLessThan(500);
        expect(harness.pauses.length).toBeGreaterThan(0);
        expect(harness.pauses.length).toBeLessThan(units);
        expect(status.phase).toBe('migrating');
        expect(await repo.countStagedUnits()).toBeGreaterThan(0);
        let wakes = 1;
        let current = status;
        while (current.phase === 'migrating' && wakes < 20) { current = await harness.service.runWake(); wakes += 1; }
        expect(current.phase).toBe('complete');
        expect(wakes).toBeGreaterThan(1);
    });

    it('lengthens the pause to ten times the work of a unit above targetWorkMs', async () => {
        setLegacy(sixMessages());
        const harness = clockHarness({ cost: 50 });
        await harness.service.enable();
        await harness.service.runWake();
        const slow = harness.pauses.filter(ms => ms > migrationBudget.minPauseMs);
        expect(slow.length).toBeGreaterThan(0);
        expect(harness.pauses.every(ms => ms === 500)).toBe(true);
    });

    it('interaction lengthens the pause for a second then falls back', async () => {
        setLegacy([{ id: 'a', title: 'Alpha', updatedAt: 1, messages: Array.from({ length: 14 }, (_, index) => message(index)) }]);
        const harness = clockHarness();
        await harness.service.enable();
        harness.service.interaction();
        await harness.service.runWake();
        expect(harness.pauses[0]).toBe(300);
        expect(harness.pauses.at(-1)).toBe(migrationBudget.minPauseMs);
        expect(harness.pauses.some(ms => ms === 300)).toBe(true);
        expect(harness.pauses.some(ms => ms === migrationBudget.minPauseMs)).toBe(true);
    });
});

describe('large payloads and chunk boundaries', () => {
    it('chunks a 900 KB message and two 700 KB attachments into units of at most 256 KiB', async () => {
        const first = `data:image/png;base64,${'A'.repeat(700000)}`;
        const second = `data:image/jpeg;base64,${'B'.repeat(700000)}`;
        const big = { role: 'user', content: `${'x'.repeat(900000)}`, files: [{ content: first, originalContent: first }, { content: second }] };
        setLegacy([{ id: 'a', title: 'large', updatedAt: 1, messages: [big, message(1)] }]);
        const service = makeOwner();
        await service.enable();
        const units = await repo.getStagedUnits();
        expect(Math.max(...units.map(unit => unit.bytes.byteLength))).toBeLessThanOrEqual(MAX_HISTORY_CHUNK_BYTES);
        expect(units.filter(unit => unit.kind === 'attachments' && unit.recordId.startsWith('legacy:0:attachment:0')).length).toBe(3);
        expect(units.filter(unit => unit.kind === 'attachments' && unit.recordId.startsWith('legacy:0:attachment:1')).length).toBe(3);
        expect(units.filter(unit => unit.kind === 'messages' && unit.recordId === 'legacy:0').length).toBe(4);
        await drain(service);
        const saved = await repo.getConversation('a');
        expect(saved.messages.length).toBeGreaterThanOrEqual(5);
        for (const item of [...saved.messages, ...saved.attachments]) {
            expect(item.record.ciphertext.byteLength).toBeLessThanOrEqual(MAX_HISTORY_CHUNK_BYTES + 16);
        }
        const restored = await service.restore();
        expect(messagesOf(restored, 'a')).toEqual([big, message(1)]);
    }, 20000);

    it('does not mix messages of two sessions that both contain legacy message index 0', async () => {
        const sessions = [
            { id: 's1', title: 'One', updatedAt: 1, messages: [message(0, { content: 'one-0' }), message(1, { content: 'one-1' })] },
            { id: 's2', title: 'Two', updatedAt: 2, messages: [message(0, { content: 'two-0', files: [{ content: DATA_URL }] }), message(1, { content: 'two-1' })] },
        ];
        setLegacy(sessions);
        const service = makeOwner();
        await service.enable();
        const middle = makeOwner({ budget: stepBudget });
        for (let index = 0; index < 4; index++) {
            await middle.runWake();
            const restored = await service.restore();
            expect(messagesOf(restored, 's1')).toEqual(sessions[0].messages);
            expect(messagesOf(restored, 's2')).toEqual(sessions[1].messages);
        }
        await drain(service);
        const restored = await service.restore();
        expect(messagesOf(restored, 's1')).toEqual(sessions[0].messages);
        expect(messagesOf(restored, 's2')).toEqual(sessions[1].messages);
        expect(restored.sessions).toHaveLength(2);
    });
});

describe('multi-chunk manifests', () => {
    const manifestChunks = async id => (await repo.getConversationHead(id))?.manifestChunks.length ?? 0;

    it('replaces every manifest chunk when appending to and truncating a 9000 message staged conversation', async () => {
        const messages = Array.from({ length: 9000 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `m${index}` }));
        setLegacy([{ id: 'a', title: 'Huge', updatedAt: 1, notes: 'n'.repeat(150 * 1024), messages }]);
        const service = makeOwner({ budget: stepBudget });
        await service.enable();
        const manifestUnits = await repo.getStagedUnitsOfKind('a', 'manifest');
        expect(manifestUnits.length).toBeGreaterThan(1);
        expect(manifestUnits.reduce((sum, unit) => sum + unit.bytes.byteLength, 0)).toBeGreaterThan(MAX_HISTORY_CHUNK_BYTES);
        // Decoding goes through the snapshot reader directly, the cursor over 9000 staged keys in restore() is slow in fake-indexeddb.
        const read = async () => (await service.reader.decodeConversation('a')).messages;

        await service.command({ type: 'history.append', commandId: 'tail', sessionId: 'a', message: { role: 'user', content: 'tail' } });
        expect(await manifestChunks('a')).toBeGreaterThan(1);
        expect(await repo.getStagedUnitsOfKind('a', 'manifest')).toEqual([]);
        let restored = await read();
        expect(restored).toHaveLength(9001);
        expect(restored.at(-1)).toEqual({ role: 'user', content: 'tail' });

        await service.command({ type: 'history.truncate', commandId: 'cut', sessionId: 'a', messageIndex: 8990 });
        expect(await manifestChunks('a')).toBeGreaterThan(1);
        expect(await read()).toEqual(messages.slice(0, 8990));
        expect(await repo.listStagedUnitIds('a')).toHaveLength(8990);

        await service.command({ type: 'history.append', commandId: 'again', sessionId: 'a', message: { role: 'user', content: 'again' } });
        expect(await read()).toEqual([...messages.slice(0, 8990), { role: 'user', content: 'again' }]);
    }, 30000);

    it('replaces every manifest chunk for a saved conversation with a manifest above 256 KiB', async () => {
        const service = makeOwner();
        await service.enable();
        const commandId = `create-${'c'.repeat(400)}`;
        const messages = Array.from({ length: 800 }, (_, index) => ({ role: 'user', content: `s${index}` }));
        await service.command({ type: 'history.create', commandId, sessionId: 'big', session: { id: 'big', title: 'Big', messages } });
        expect(await manifestChunks('big')).toBeGreaterThan(1);
        expect(messagesOf(await service.restore(), 'big')).toEqual(messages);

        await service.command({ type: 'history.append', commandId: 'one-more', sessionId: 'big', message: { role: 'user', content: 'extra' } });
        expect(messagesOf(await service.restore(), 'big')).toEqual([...messages, { role: 'user', content: 'extra' }]);

        await service.command({ type: 'history.truncate', commandId: 'cut-saved', sessionId: 'big', messageIndex: 300 });
        expect(messagesOf(await service.restore(), 'big')).toEqual(messages.slice(0, 300));
        expect((await repo.getRecordKeys('big')).messages).toHaveLength(300);
        expect((await drain(service)).phase).toBe('complete');
        expect(messagesOf(await service.restore(), 'big')).toEqual(messages.slice(0, 300));
    }, 30000);

    it('replaces every staged manifest chunk on append and truncate of a conversation with a large manifest', async () => {
        const messages = Array.from({ length: 30 }, (_, index) => message(index, { content: `p${index}` }));
        setLegacy([{ id: 'a', title: 'Notes', updatedAt: 1, notes: 'n'.repeat(600 * 1024), messages }]);
        const service = makeOwner({ budget: stepBudget });
        await service.enable();
        expect((await repo.getStagedUnitsOfKind('a', 'manifest')).length).toBeGreaterThanOrEqual(3);
        await service.command({ type: 'history.append', commandId: 'm1', sessionId: 'a', message: { role: 'user', content: 'extra' } });
        expect(await manifestChunks('a')).toBeGreaterThanOrEqual(3);
        expect(await repo.getStagedUnitsOfKind('a', 'manifest')).toEqual([]);
        expect(messagesOf(await service.restore(), 'a')).toEqual([...messages, { role: 'user', content: 'extra' }]);
        await service.command({ type: 'history.truncate', commandId: 'm2', sessionId: 'a', messageIndex: 10 });
        expect(messagesOf(await service.restore(), 'a')).toEqual(messages.slice(0, 10));
        await service.command({ type: 'history.append', commandId: 'm3', sessionId: 'a', message: { role: 'user', content: 'last' } });
        expect((await drain(service)).phase).toBe('complete');
        expect(messagesOf(await service.restore(), 'a')).toEqual([...messages.slice(0, 10), { role: 'user', content: 'last' }]);
    }, 30000);

    // Fails today: once only the first manifest chunk is converted, the reader treats it as the whole manifest and fails to parse it.
    it('keeps the conversation readable while a multi-chunk manifest converts chunk by chunk', async () => {
        const messages = [message(0, { content: 'p0' }), message(1, { content: 'p1' })];
        setLegacy([{ id: 'a', title: 'Notes', updatedAt: 1, notes: 'n'.repeat(600 * 1024), messages }]);
        const service = makeOwner({ budget: stepBudget });
        await service.enable();
        expect((await repo.getStagedUnitsOfKind('a', 'manifest')).length).toBeGreaterThanOrEqual(3);
        const total = await repo.countStagedUnits();
        for (let index = 0; index < total; index++) {
            await service.runWake();
            expect(messagesOf(await service.restore(), 'a')).toEqual(messages);
        }
        expect((await service.runWake()).phase).toBe('complete');
        expect(messagesOf(await service.restore(), 'a')).toEqual(messages);
    }, 20000);

    // Fails today: writeCommand loads the manifest from the saved chunks only, which is a partial manifest after the first chunk converted.
    it('accepts an append while a multi-chunk manifest is only partly converted', async () => {
        const messages = [message(0, { content: 'p0' })];
        setLegacy([{ id: 'a', title: 'Notes', updatedAt: 1, notes: 'n'.repeat(600 * 1024), messages }]);
        const service = makeOwner({ budget: stepBudget });
        await service.enable();
        await service.runWake();
        const result = await service.command({ type: 'history.append', commandId: 'mid', sessionId: 'a', message: { role: 'user', content: 'mid' } });
        expect(result.error).toBeUndefined();
        const done = await drain(makeOwner({ budget: fullBudget }));
        expect(done.phase).toBe('complete');
        expect(messagesOf(await service.restore(), 'a')).toEqual([...messages, { role: 'user', content: 'mid' }]);
    }, 20000);
});
