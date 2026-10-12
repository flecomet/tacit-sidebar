const DB_VERSION = 1;
const FORMAT = 1;
const COMMAND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STATUS_KEY = 'status';
const METADATA_PREFIX = 'meta:';

const historyError = (code, message) => Object.assign(new Error(message), { code });
const tag = value => Object.prototype.toString.call(value);
const isBinary = value => ArrayBuffer.isView(value) || tag(value) === '[object ArrayBuffer]';
const isCount = value => Number.isSafeInteger(value) && value >= 0;

function validateEnvelope(record, label) {
    const keys = record && typeof record === 'object' ? Object.keys(record).sort().join() : '';
    if (keys !== 'ciphertext,format,iv' || record.format !== FORMAT || !ArrayBuffer.isView(record.iv)
        || record.iv.byteLength !== 12 || !isBinary(record.ciphertext)) {
        throw new TypeError(`${label} must contain a binary encrypted envelope`);
    }
}

// Only identifiers, counters and the encrypted envelope may reach the plaintext index.
function validateItem(item, label, allowed) {
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !allowed.includes(key))) {
        throw new TypeError(`${label} contains unsupported properties`);
    }
    if (typeof item.id !== 'string' || !item.id || !isCount(item.revision)
        || (item.chunkIndex !== undefined && !isCount(item.chunkIndex))) {
        throw new TypeError(`${label} has an invalid identity`);
    }
    if (item.attachmentIds !== undefined && (!Array.isArray(item.attachmentIds) || item.attachmentIds.some(value => typeof value !== 'string'))) {
        throw new TypeError(`${label} has invalid attachment references`);
    }
    validateEnvelope(item.record, label);
}

const itemKeys = ['id', 'revision', 'chunkIndex', 'record'];

function validateRecords(records = {}) {
    const { manifest, messages = [], attachments = [], deleteMessageIds = [], deleteAttachmentIds = [] } = records;
    for (const item of [].concat(manifest || [])) validateItem(item, 'Manifest record', itemKeys);
    messages.forEach(item => validateItem(item, 'Message record', [...itemKeys, 'attachmentIds']));
    attachments.forEach(item => validateItem(item, 'Attachment record', itemKeys));
    if ([...deleteMessageIds, ...deleteAttachmentIds].some(value => typeof value !== 'string')) throw new TypeError('Invalid record deletion');
}

const request = source => new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error);
});

const settled = tx => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('History transaction aborted'));
});

const withoutOwner = ({ conversationId, ...item }) => item;

export async function openHistoryDatabase({ name = 'tacit-history', indexedDB = globalThis.indexedDB, readOnly = false } = {}) {
    const db = await new Promise((resolve, reject) => {
        const opening = indexedDB.open(name, DB_VERSION);
        opening.onupgradeneeded = () => {
            if (readOnly) {
                opening.transaction.abort();
                reject(historyError('HISTORY_NOT_FOUND', 'History database is not initialized'));
                return;
            }
            const upgrade = opening.result;
            upgrade.createObjectStore('conversations', { keyPath: 'id' });
            for (const store of ['manifests', 'messages', 'attachments']) {
                upgrade.createObjectStore(store, { keyPath: ['conversationId', 'id', 'chunkIndex'] }).createIndex('conversationId', 'conversationId');
            }
            const staged = upgrade.createObjectStore('staged', { keyPath: 'id' });
            staged.createIndex('conversationId', 'conversationId');
            staged.createIndex('conversationKind', ['conversationId', 'kind']);
            upgrade.createObjectStore('commands', { keyPath: 'id' });
            upgrade.createObjectStore('tombstones', { keyPath: 'id' });
            upgrade.createObjectStore('meta');
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
        opening.onblocked = () => reject(historyError('HISTORY_BLOCKED', 'History database upgrade is blocked'));
    });
    let closed = false;
    const closeListeners = new Set();
    const notifyClosed = () => {
        if (closed) return;
        closed = true;
        for (const listener of closeListeners) listener();
        closeListeners.clear();
    };
    const close = () => { db.close(); notifyClosed(); };
    // Schema upgrades and forced connection closure invalidate cached owners.
    db.onversionchange = close;
    db.onclose = notifyClosed;

    // The body runs inside one transaction. It may only await IndexedDB requests.
    async function run(stores, mode, body) {
        if (readOnly && mode !== 'readonly') throw historyError('HISTORY_READ_ONLY', 'Panel history connections cannot write');
        const tx = db.transaction(stores, mode);
        const completion = settled(tx);
        let result;
        try {
            result = await body(tx);
        } catch (error) {
            try { tx.abort(); } catch { /* already finished */ }
            await completion.catch(() => {});
            throw error;
        }
        await completion;
        return result;
    }

    // One key scan serves every id, so truncating many messages does not rescan the index per message.
    const removeByConversation = async (tx, store, id, recordIds) => {
        const keys = await request(tx.objectStore(store).index('conversationId').getAllKeys(id));
        await Promise.all(keys.filter(key => recordIds === undefined || recordIds.has(key[1]))
            .map(key => request(tx.objectStore(store).delete(key))));
    };

    const putAll = (tx, store, id, items = []) => Promise.all([].concat(items)
        .map(item => request(tx.objectStore(store).put({ conversationId: id, chunkIndex: 0, ...item }))));

    const readAll = async (tx, store, id) => (await request(tx.objectStore(store).index('conversationId').getAll(id))).map(withoutOwner);

    const prune = () => run(['commands'], 'readwrite', async tx => {
        const cutoff = Date.now() - COMMAND_TTL_MS;
        const rows = await request(tx.objectStore('commands').getAll());
        await Promise.all(rows.filter(row => row.at < cutoff).map(row => request(tx.objectStore('commands').delete(row.id))));
    });
    if (!readOnly) await prune().catch(() => {});

    const allStores = ['conversations', 'manifests', 'messages', 'attachments', 'staged', 'commands', 'tombstones', 'meta'];

    return {
        close,
        onClose(listener) {
            if (closed) listener();
            else closeListeners.add(listener);
            return () => closeListeners.delete(listener);
        },

        async getConversation(id) {
            return run(['conversations', 'manifests', 'messages', 'attachments'], 'readonly', async tx => {
                const row = await request(tx.objectStore('conversations').get(id));
                if (!row) return null;
                const manifestChunks = (await readAll(tx, 'manifests', id)).sort((a, b) => a.chunkIndex - b.chunkIndex);
                return {
                    id,
                    revision: row.revision,
                    manifest: manifestChunks[0] || null,
                    manifestChunks,
                    messages: await readAll(tx, 'messages', id),
                    attachments: await readAll(tx, 'attachments', id),
                };
            });
        },

        // Saved and staged records are read in one transaction so a concurrent conversion cannot split them.
        getConversationSnapshot: id => run(['conversations', 'manifests', 'messages', 'attachments', 'staged', 'tombstones'], 'readonly', async tx => {
            if (await request(tx.objectStore('tombstones').get(id))) return null;
            const row = await request(tx.objectStore('conversations').get(id));
            return {
                id,
                revision: row?.revision || 0,
                manifestChunks: row ? (await readAll(tx, 'manifests', id)).sort((a, b) => a.chunkIndex - b.chunkIndex) : [],
                messages: row ? await readAll(tx, 'messages', id) : [],
                attachments: row ? await readAll(tx, 'attachments', id) : [],
                staged: await request(tx.objectStore('staged').index('conversationId').getAll(id)),
            };
        }),

        // Head and key reads keep per-message work independent of the conversation size.
        getConversationHead: id => run(['conversations', 'manifests'], 'readonly', async tx => {
            const row = await request(tx.objectStore('conversations').get(id));
            if (!row) return null;
            const manifestChunks = (await readAll(tx, 'manifests', id)).sort((a, b) => a.chunkIndex - b.chunkIndex);
            return { id, revision: row.revision, manifestChunks };
        }),

        getRecordKeys: id => run(['messages', 'attachments'], 'readonly', async tx => {
            const keys = async store => (await request(tx.objectStore(store).index('conversationId').getAllKeys(id)))
                .map(([, recordId, chunkIndex]) => ({ id: recordId, chunkIndex }));
            return { messages: await keys('messages'), attachments: await keys('attachments') };
        }),

        getRecords: requests => run(['manifests', 'messages', 'attachments'], 'readonly', tx => Promise.all(requests.map(async ({ store, conversationId, id, chunkIndex = 0 }) => {
            const value = await request(tx.objectStore(store).get([conversationId, id, chunkIndex]));
            return value ? withoutOwner(value) : null;
        }))),

        getRecord: ({ store, conversationId, id, chunkIndex = 0 }) => run([store], 'readonly', async tx => {
            const value = await request(tx.objectStore(store).get([conversationId, id, chunkIndex]));
            return value ? withoutOwner(value) : null;
        }),

        listConversations: () => run(['conversations'], 'readonly', async tx => (await request(tx.objectStore('conversations').getAll()))
            .map(({ id, revision }) => ({ id, revision }))),

        async commitRevision({ id, expectedRevision, encryptedRecords = {}, checkpoint, commandId, completedStagedUnitIds = [], replaceManifest = false }) {
            if (typeof id !== 'string' || !id || !isCount(expectedRevision)) throw new TypeError('Invalid history revision request');
            validateRecords(encryptedRecords);
            return run(allStores, 'readwrite', async tx => {
                if (commandId) {
                    const acknowledged = await request(tx.objectStore('commands').get(commandId));
                    if (acknowledged) return acknowledged.ack;
                }
                if (await request(tx.objectStore('tombstones').get(id))) throw historyError('HISTORY_DELETED', 'Conversation was deleted');
                const row = await request(tx.objectStore('conversations').get(id));
                const current = row?.revision || 0;
                if (current !== expectedRevision) throw historyError('HISTORY_REVISION_CONFLICT', `Expected revision ${expectedRevision}, found ${current}`);
                const ack = { id, revision: current + 1 };
                const { manifest, messages, attachments, deleteMessageIds = [], deleteAttachmentIds = [] } = encryptedRecords;
                await request(tx.objectStore('conversations').put({ id, revision: ack.revision }));
                // A complete manifest replaces every stored chunk. Otherwise only the given chunks are updated.
                if (replaceManifest) await removeByConversation(tx, 'manifests', id);
                await putAll(tx, 'manifests', id, manifest);
                if (deleteMessageIds.length) await removeByConversation(tx, 'messages', id, new Set(deleteMessageIds));
                if (deleteAttachmentIds.length) await removeByConversation(tx, 'attachments', id, new Set(deleteAttachmentIds));
                await putAll(tx, 'messages', id, messages);
                await putAll(tx, 'attachments', id, attachments);
                await Promise.all(completedStagedUnitIds.map(unitId => request(tx.objectStore('staged').delete(unitId))));
                if (checkpoint !== undefined) await request(tx.objectStore('meta').put(checkpoint, STATUS_KEY));
                if (commandId) await request(tx.objectStore('commands').put({ id: commandId, ack, at: Date.now() }));
                return ack;
            });
        },

        async deleteConversation(id, { commandId, checkpoint } = {}) {
            return run(allStores, 'readwrite', async tx => {
                if (commandId) {
                    const acknowledged = await request(tx.objectStore('commands').get(commandId));
                    if (acknowledged) return acknowledged.ack;
                }
                const row = await request(tx.objectStore('conversations').get(id));
                const previous = await request(tx.objectStore('tombstones').get(id));
                const ack = { id, revision: Math.max(row?.revision || 0, previous?.revision || 0) + 1, deleted: true };
                await request(tx.objectStore('conversations').delete(id));
                for (const store of ['manifests', 'messages', 'attachments']) await removeByConversation(tx, store, id);
                const staged = await request(tx.objectStore('staged').index('conversationId').getAllKeys(id));
                await Promise.all(staged.map(key => request(tx.objectStore('staged').delete(key))));
                await request(tx.objectStore('tombstones').put(ack));
                if (checkpoint !== undefined) await request(tx.objectStore('meta').put(checkpoint, STATUS_KEY));
                if (commandId) await request(tx.objectStore('commands').put({ id: commandId, ack, at: Date.now() }));
                return ack;
            });
        },

        getTombstone: id => run(['tombstones'], 'readonly', async tx => (await request(tx.objectStore('tombstones').get(id))) || null),
        getCommand: id => run(['commands'], 'readonly', async tx => (await request(tx.objectStore('commands').get(id)))?.ack || null),
        getMigrationStatus: () => run(['meta'], 'readonly', async tx => (await request(tx.objectStore('meta').get(STATUS_KEY))) ?? null),
        setMigrationStatus: status => run(['meta'], 'readwrite', tx => request(tx.objectStore('meta').put(status, STATUS_KEY))),
        getMetadata: key => run(['meta'], 'readonly', async tx => (await request(tx.objectStore('meta').get(METADATA_PREFIX + key))) ?? null),
        setMetadata: (key, value) => run(['meta'], 'readwrite', tx => request(tx.objectStore('meta').put(value, METADATA_PREFIX + key))),

        putStagedUnits: (units, status) => {
            if (units.some(unit => typeof unit?.id !== 'string' || typeof unit.conversationId !== 'string' || !isBinary(unit.bytes))) {
                throw new TypeError('Staged units require binary bytes');
            }
            return run(['staged', 'meta'], 'readwrite', async tx => {
                await Promise.all(units.map(unit => request(tx.objectStore('staged').put(unit))));
                if (status !== undefined) await request(tx.objectStore('meta').put(status, STATUS_KEY));
            });
        },

        getStagedUnits: conversationId => run(['staged'], 'readonly', async tx => (conversationId === undefined
            ? request(tx.objectStore('staged').getAll())
            : request(tx.objectStore('staged').index('conversationId').getAll(conversationId)))),

        // A cursor avoids loading every pending unit to process the first one.
        getNextStagedUnit: () => run(['staged'], 'readonly', async tx => new Promise((resolve, reject) => {
            const cursor = tx.objectStore('staged').openCursor();
            cursor.onsuccess = () => resolve(cursor.result ? cursor.result.value : null);
            cursor.onerror = () => reject(cursor.error);
        })),

        listStagedConversationIds: () => run(['staged'], 'readonly', tx => new Promise((resolve, reject) => {
            const ids = new Set();
            const cursor = tx.objectStore('staged').index('conversationId').openKeyCursor(null, 'nextunique');
            cursor.onsuccess = () => {
                if (!cursor.result) { resolve([...ids]); return; }
                ids.add(cursor.result.key);
                cursor.result.continue();
            };
            cursor.onerror = () => reject(cursor.error);
        })),

        getStagedUnitsOfKind: (conversationId, kind) => run(['staged'], 'readonly', tx => request(tx.objectStore('staged').index('conversationKind').getAll([conversationId, kind]))),

        listStagedUnitIds: conversationId => run(['staged'], 'readonly', tx => request(tx.objectStore('staged').index('conversationId').getAllKeys(conversationId))),

        clearStagedUnits: () => run(['staged'], 'readwrite', tx => request(tx.objectStore('staged').clear())),

        // Units are returned in key order, so those of one conversation are adjacent.
        getNextStagedUnits: ({ maxBytes, maxCount = 500 }) => run(['staged'], 'readonly', tx => new Promise((resolve, reject) => {
            const units = [];
            let bytes = 0;
            const cursor = tx.objectStore('staged').openCursor();
            cursor.onsuccess = () => {
                const row = cursor.result;
                if (!row || units.length >= maxCount || (units.length && bytes + row.value.bytes.byteLength > maxBytes)) { resolve(units); return; }
                units.push(row.value);
                bytes += row.value.bytes.byteLength;
                row.continue();
            };
            cursor.onerror = () => reject(cursor.error);
        })),

        countStagedUnits: () => run(['staged'], 'readonly', tx => request(tx.objectStore('staged').count())),

        deleteStagedUnits: (ids, status) => run(['staged', 'meta'], 'readwrite', async tx => {
            await Promise.all(ids.map(unitId => request(tx.objectStore('staged').delete(unitId))));
            if (status !== undefined) await request(tx.objectStore('meta').put(status, STATUS_KEY));
        }),
    };
}
