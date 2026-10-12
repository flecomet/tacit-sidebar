import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { openHistoryDatabase } from './historyRepository';
import { createHistoryReader, authId, storeOf } from './historyReader';
import { createHistoryOwner, migrationBudget } from './historyMigration';
import { encryptRecord, generateHistoryKey } from './historyCrypto';
import { serializeSession } from './historySerialization';

const DATA_URL = 'data:image/png;base64,QUJDREVGR0g=';
let repo;
let key;
let reader;

beforeEach(async () => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    repo = await openHistoryDatabase({ name: `reader-${Math.random()}`, indexedDB: new IDBFactory() });
    key = await generateHistoryKey();
    reader = createHistoryReader({ repository: repo, getKey: async () => key });
});
afterEach(() => repo.close());

const message = (index, extra = {}) => ({ role: index % 2 ? 'assistant' : 'user', content: `message ${index}`, ...extra });
const session = (id, count = 3, extra = {}) => ({
    id, title: `Title ${id}`, model: 'm', updatedAt: 10,
    messages: Array.from({ length: count }, (_, index) => message(index, index === 1 ? { files: [{ name: 'f.png', content: DATA_URL, originalContent: DATA_URL }] } : {})),
    ...extra,
});

const stage = units => repo.putStagedUnits(units);

// Encrypts the given units into one revision, bypassing the owner.
async function save(units, conversationId) {
    const head = await repo.getConversationHead(conversationId);
    const expectedRevision = head?.revision || 0;
    const revision = expectedRevision + 1;
    const records = { manifest: [], messages: [], attachments: [] };
    for (const unit of units) {
        const record = await encryptRecord({ key, plaintext: unit.bytes, recordId: authId(unit), revision, chunkIndex: unit.chunkIndex });
        records[unit.kind].push({ id: unit.recordId, revision, chunkIndex: unit.chunkIndex, record });
    }
    if (!records.manifest.length) delete records.manifest;
    await repo.commitRevision({ id: conversationId, expectedRevision, encryptedRecords: records });
}
const byId = sessions => [...sessions].sort((a, b) => a.id.localeCompare(b.id));

describe('storeOf and authId', () => {
    it('maps the manifest kind to its plural store and separates identity fields', () => {
        expect(storeOf('manifest')).toBe('manifests');
        expect(storeOf('messages')).toBe('messages');
        expect(authId({ conversationId: 'a', kind: 'messages', recordId: 'b' })).not.toBe(authId({ conversationId: 'b', kind: 'messages', recordId: 'a' }));
        expect(authId({ conversationId: 'a', kind: 'messages', recordId: 'x' })).not.toBe(authId({ conversationId: 'a', kind: 'attachments', recordId: 'x' }));
    });
});

describe('restore', () => {
    it('restores stable message identities without adding them to serialized content', async () => {
        const source = session('s', 1);
        await stage(serializeSession(source));
        const restored = await reader.decodeConversation('s');
        expect(restored.messages[0].historyRecordId).toBe('legacy:0');
        expect(JSON.stringify(restored.messages[0])).toBe(JSON.stringify(source.messages[0]));
    });

    it('returns nothing for an empty database', async () => {
        expect(await reader.restore()).toEqual([]);
        expect(await reader.decodeConversation('missing')).toBeNull();
        expect(await reader.listConversationIds()).toEqual([]);
    });

    it('restores a conversation that exists only as staged plaintext units', async () => {
        const source = session('s');
        await stage(serializeSession(source));
        expect(await reader.restore()).toEqual([source]);
        expect(await reader.listConversationIds()).toEqual(['s']);
    });

    it('restores a conversation that exists only as saved encrypted records', async () => {
        const source = session('s');
        await save(serializeSession(source), 's');
        expect(await repo.countStagedUnits()).toBe(0);
        expect(await reader.restore()).toEqual([source]);
    });

    it('restores mixed conversations, including one split between saved and staged units', async () => {
        const staged = session('staged');
        const saved = session('saved', 2);
        const split = session('split', 4);
        await stage(serializeSession(staged));
        await save(serializeSession(saved), 'saved');
        const units = serializeSession(split);
        // The manifest and the first two messages are saved, the rest and their attachments are still staged.
        const isSaved = unit => unit.kind === 'manifest' || ['legacy:0', 'legacy:1'].includes(unit.recordId.split(':attachment:')[0]);
        await save(units.filter(isSaved), 'split');
        await stage(units.filter(unit => !isSaved(unit)));
        expect(await repo.countStagedUnits()).toBeGreaterThan(0);

        const restored = byId(await reader.restore());
        expect(restored.map(item => item.id)).toEqual(['saved', 'split', 'staged']);
        expect(restored).toEqual(byId([staged, saved, split]));
    });

    it('lets a saved manifest replace the staged one', async () => {
        const source = session('s', 2);
        const units = serializeSession(source);
        await save(units.filter(unit => unit.kind === 'manifest'), 's');
        // A stale staged manifest with the old title must not win over the saved one.
        await stage(serializeSession({ ...source, title: 'Stale' }));
        const restored = await reader.decodeConversation('s');
        expect(restored.title).toBe('Title s');
        expect(restored.messages).toEqual(source.messages);
    });

    it('fails on a message that the manifest lists but no record holds', async () => {
        const source = session('s', 3);
        await stage(serializeSession(source).filter(unit => unit.recordId !== 'legacy:2'));
        await expect(reader.decodeConversation('s')).rejects.toThrow('History message is missing');
        await expect(reader.restore()).rejects.toThrow('History message is missing');
    });

    it('fails on a message that references a missing attachment', async () => {
        const source = session('s', 3);
        await stage(serializeSession(source).filter(unit => unit.kind !== 'attachments'));
        await expect(reader.decodeConversation('s')).rejects.toThrow('History attachment is missing');
    });

    it('returns null for staged messages without any manifest', async () => {
        const units = serializeSession(session('s')).filter(unit => unit.kind !== 'manifest');
        await stage(units);
        expect(await reader.decodeConversation('s')).toBeNull();
        expect(await reader.restore()).toEqual([]);
    });
});

describe('verifyConversation', () => {
    it('passes on a healthy saved conversation', async () => {
        await save(serializeSession(session('s')), 's');
        await expect(reader.verifyConversation('s')).resolves.toBeUndefined();
    });

    it('passes when the messages are only staged, or split between both stores', async () => {
        await stage(serializeSession(session('staged')));
        await expect(reader.verifyConversation('staged')).resolves.toBeUndefined();
        const units = serializeSession(session('split', 3));
        await save(units.filter(unit => unit.kind === 'manifest' || unit.recordId === 'legacy:0'), 'split');
        await stage(units.filter(unit => unit.kind !== 'manifest' && unit.recordId !== 'legacy:0'));
        await expect(reader.verifyConversation('split')).resolves.toBeUndefined();
    });

    it('throws when a message record is missing', async () => {
        await save(serializeSession(session('s')), 's');
        const head = await repo.getConversationHead('s');
        await repo.commitRevision({ id: 's', expectedRevision: head.revision, encryptedRecords: { deleteMessageIds: ['legacy:1'] } });
        await expect(reader.verifyConversation('s')).rejects.toThrow('History message is missing');
    });

    it('throws when the manifest is missing', async () => {
        await expect(reader.verifyConversation('nobody')).rejects.toThrow('History manifest is missing');
    });

    it('throws when a saved manifest cannot authenticate', async () => {
        await save(serializeSession(session('s')), 's');
        const other = await generateHistoryKey();
        const wrong = createHistoryReader({ repository: repo, getKey: async () => other });
        await expect(wrong.verifyConversation('s')).rejects.toThrow();
    });
});

describe('tombstones', () => {
    it('decodes a tombstoned id as null even if units were staged afterwards', async () => {
        await save(serializeSession(session('s')), 's');
        await repo.deleteConversation('s');
        expect(await reader.decodeConversation('s')).toBeNull();
        await stage(serializeSession(session('s')));
        expect(await reader.decodeConversation('s')).toBeNull();
        expect(await reader.restore()).toEqual([]);
    });

    it('keeps other conversations restorable', async () => {
        await save(serializeSession(session('gone')), 'gone');
        await save(serializeSession(session('kept')), 'kept');
        await repo.deleteConversation('gone');
        expect((await reader.restore()).map(item => item.id)).toEqual(['kept']);
    });
});

describe('snapshots while units convert', () => {
    const stepBudget = { ...migrationBudget, maxWakeDurationMs: 10, minPauseMs: 10 };

    function setup(sessions) {
        const values = { 'tacit-storage': JSON.stringify({ state: { sessions, model: 'm' } }) };
        const owner = createHistoryOwner({
            repository: repo, pause: async () => {}, budget: stepBudget,
            storage: { get: async name => values[name], set: async (name, value) => { values[name] = value; } },
        });
        const independent = createHistoryReader({ repository: repo, getKey: () => repo.getMetadata('installation-key') });
        return { owner, independent };
    }

    it('never loses or duplicates a message between conversions', async () => {
        const sessions = [session('a', 4), session('b', 3)];
        const { owner, independent } = setup(sessions);
        await owner.enable();
        const total = await repo.countStagedUnits();
        for (let index = 0; index < total; index++) {
            await owner.runWake();
            expect(byId(await independent.restore())).toEqual(byId(sessions));
        }
        expect(await repo.countStagedUnits()).toBe(0);
        expect(byId(await independent.restore())).toEqual(byId(sessions));
    });

    it('reads a consistent snapshot while conversions run concurrently', async () => {
        const sessions = [session('a', 5), session('b', 2)];
        const { owner, independent } = setup(sessions);
        await owner.enable();
        const total = await repo.countStagedUnits();
        for (let index = 0; index < total; index++) {
            const [restored] = await Promise.all([independent.restore(), owner.runWake(), independent.decodeConversation('a')]);
            expect(byId(restored)).toEqual(byId(sessions));
        }
    });

    it('verifies every conversation after the migration completed', async () => {
        const sessions = [session('a', 3), session('b', 3)];
        const { owner, independent } = setup(sessions);
        await owner.enable();
        for (let index = 0; index < 40; index++) await owner.runWake();
        expect((await owner.status()).phase).toBe('complete');
        for (const id of await independent.listConversationIds()) await expect(independent.verifyConversation(id)).resolves.toBeUndefined();
    });
});
