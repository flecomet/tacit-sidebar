import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openHistoryDatabase } from './historyRepository';

let repository;
let factory;
const envelope = () => ({ format: 1, iv: new Uint8Array(12), ciphertext: new Uint8Array(17).buffer });
const message = (id, revision = 1, chunkIndex = 0) => ({ id, revision, chunkIndex, record: envelope(), attachmentIds: ['image'] });
const records = () => ({
    manifest: { id: 'manifest', revision: 1, record: envelope() },
    messages: [message('message')],
    attachments: [{ id: 'image', revision: 1, record: envelope() }],
});

beforeEach(async () => {
    factory = new IDBFactory();
    repository = await openHistoryDatabase({ name: 'test-history', indexedDB: factory });
});
afterEach(() => repository?.close());

describe('history repository', () => {
    it('opens panel readers without pruning acknowledgements or allowing writes', async () => {
        await repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: records(), commandId: 'old' });
        const raw = await new Promise(resolve => { const opening = factory.open('test-history'); opening.onsuccess = () => resolve(opening.result); });
        const tx = raw.transaction('commands', 'readwrite');
        tx.objectStore('commands').put({ id: 'old', ack: { id: 'one', revision: 1 }, at: 0 });
        await new Promise(resolve => { tx.oncomplete = resolve; });
        raw.close();
        const reader = await openHistoryDatabase({ name: 'test-history', indexedDB: factory, readOnly: true });
        try {
            expect(await reader.getCommand('old')).toEqual({ id: 'one', revision: 1 });
            await expect(reader.setMigrationStatus({ phase: 'error' })).rejects.toMatchObject({ code: 'HISTORY_READ_ONLY' });
            expect(await repository.getMigrationStatus()).toBeNull();
        } finally { reader.close(); }
    });

    it('does not create a database from a panel reader connection', async () => {
        await expect(openHistoryDatabase({ name: 'missing', indexedDB: factory, readOnly: true })).rejects.toMatchObject({ code: 'HISTORY_NOT_FOUND' });
        expect((await factory.databases()).map(row => row.name)).toEqual(['test-history']);
    });

    it('publishes binary records with the revision and checkpoint atomically', async () => {
        await repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: records(), checkpoint: { phase: 'migrating', verifiedBytes: 17 } });
        const saved = await repository.getConversation('one');
        expect(saved.revision).toBe(1);
        expect(saved.manifest.record.format).toBe(1);
        expect(saved.messages).toHaveLength(1);
        expect(saved.attachments).toHaveLength(1);
        expect(await repository.getMigrationStatus()).toEqual({ phase: 'migrating', verifiedBytes: 17 });
        expect((await repository.listConversations()).map(({ id }) => id)).toEqual(['one']);
    });

    it('rejects stale publishers without advancing the checkpoint', async () => {
        await repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: records(), checkpoint: { verifiedBytes: 17 } });
        await expect(repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: { messages: [message('lost')] }, checkpoint: { verifiedBytes: 99 } })).rejects.toMatchObject({ code: 'HISTORY_REVISION_CONFLICT' });
        expect((await repository.getConversation('one')).messages.map(({ id }) => id)).toEqual(['message']);
        expect(await repository.getMigrationStatus()).toEqual({ verifiedBytes: 17 });
    });

    it('preserves unchanged records and attachment references across targeted commits', async () => {
        await repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: records() });
        await repository.commitRevision({ id: 'one', expectedRevision: 1, encryptedRecords: { messages: [message('second', 2)] } });
        const saved = await repository.getConversation('one');
        expect(saved.revision).toBe(2);
        expect(saved.manifest.revision).toBe(1);
        expect(saved.messages.map(({ revision }) => revision)).toEqual([1, 2]);
        expect(saved.attachments).toHaveLength(1);
    });

    it('deduplicates commands after reopening and returns the original acknowledgement', async () => {
        await repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: records(), commandId: 'append-1' });
        repository.close();
        repository = await openHistoryDatabase({ name: 'test-history', indexedDB: factory });
        const ack = await repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: records(), commandId: 'append-1' });
        expect(ack).toEqual({ id: 'one', revision: 1 });
        expect(await repository.getCommand('append-1')).toEqual(ack);
        expect((await repository.getConversation('one')).revision).toBe(1);
    });

    it('retains tombstones while deleting content, staged units and preventing resurrection', async () => {
        await repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: records() });
        await repository.putStagedUnits([{ id: 'staged', conversationId: 'one', bytes: new Uint8Array([1]) }]);
        expect(await repository.deleteConversation('one', { commandId: 'delete-1' })).toEqual({ id: 'one', revision: 2, deleted: true });
        expect(await repository.getConversation('one')).toBeNull();
        expect(await repository.listConversations()).toEqual([]);
        expect(await repository.getStagedUnits()).toEqual([]);
        expect(await repository.getTombstone('one')).toEqual({ id: 'one', revision: 2, deleted: true });
        await expect(repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: records() })).rejects.toMatchObject({ code: 'HISTORY_DELETED' });
        expect(await repository.deleteConversation('one', { commandId: 'delete-1' })).toEqual({ id: 'one', revision: 2, deleted: true });
    });

    it('removes all message chunks on truncation and drops orphaned attachments', async () => {
        await repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: { ...records(), messages: [message('message', 1, 0), message('message', 1, 1)] } });
        await repository.commitRevision({ id: 'one', expectedRevision: 1, encryptedRecords: { deleteMessageIds: ['message'], deleteAttachmentIds: ['image'] } });
        expect((await repository.getConversation('one')).messages).toEqual([]);
        expect((await repository.getConversation('one')).attachments).toEqual([]);
    });

    it('rolls back all stores when a record cannot be cloned', async () => {
        await repository.setMigrationStatus({ verifiedBytes: 0 });
        await repository.putStagedUnits([{ id: 'staged', conversationId: 'one', bytes: new Uint8Array([1]) }]);
        await expect(repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: records(), checkpoint: { invalid: () => 1 }, commandId: 'failed', completedStagedUnitIds: ['staged'] })).rejects.toThrow();
        expect(await repository.getConversation('one')).toBeNull();
        expect(await repository.getMigrationStatus()).toEqual({ verifiedBytes: 0 });
        expect(await repository.getCommand('failed')).toBeNull();
        expect(await repository.getStagedUnits()).toHaveLength(1);
    });

    it('stages resumable units and metadata without duplicating units', async () => {
        const unit = { id: 'unit', conversationId: 'one', kind: 'message', recordId: 'message', chunkIndex: 0, bytes: new Uint8Array([5, 6]) };
        await repository.putStagedUnits([unit], { phase: 'preparing' });
        await repository.putStagedUnits([unit]);
        expect(await repository.getStagedUnits('one')).toHaveLength(1);
        await repository.setMetadata('cutover', true);
        expect(await repository.getMetadata('cutover')).toBe(true);
        await repository.deleteStagedUnits(['unit'], { phase: 'complete' });
        expect(await repository.getStagedUnits()).toEqual([]);
        expect(await repository.getMigrationStatus()).toEqual({ phase: 'complete' });
    });

    it('serializes competing writers so only one stale revision can publish', async () => {
        const second = await openHistoryDatabase({ name: 'test-history', indexedDB: factory });
        try {
            const outcomes = await Promise.allSettled([
                repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: records() }),
                second.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: records() }),
            ]);
            expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
            expect(outcomes.find(({ status }) => status === 'rejected').reason.code).toBe('HISTORY_REVISION_CONFLICT');
        } finally { second.close(); }
    });

    it('rejects plaintext record properties and malformed binary envelopes', async () => {
        await expect(repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: { messages: [{ ...message('message'), content: 'leak' }] } })).rejects.toThrow();
        await expect(repository.commitRevision({ id: 'one', expectedRevision: 0, encryptedRecords: { messages: [{ ...message('message'), record: { format: 1, iv: [], ciphertext: 'leak' } }] } })).rejects.toThrow();
        expect(await repository.getConversation('one')).toBeNull();
    });
});
