import { decryptRecord } from './historyCrypto';
import { joinHistoryValue, restoreMessage } from './historySerialization';

export const storeOf = kind => (kind === 'manifest' ? 'manifests' : kind);

// The conversation and record kind are authenticated so a record cannot be moved between conversations.
export const authId = ({ conversationId, kind, recordId }) => `${conversationId}\u0000${kind}\u0000${recordId}`;

// Read-only decoding shared by the background owner and the panel, which restores history directly from IndexedDB.
export function createHistoryReader({ repository, getKey }) {
    const open = async (conversationId, kind, item) => decryptRecord({
        key: await getKey(),
        record: item.record,
        recordId: authId({ conversationId, kind, recordId: item.id }),
        revision: item.revision,
        chunkIndex: item.chunkIndex,
    });

    // Staged units hold plaintext that has not been converted yet. Saved records are always newer.
    async function loadManifest(id, head) {
        const parts = new Map();
        if (head?.manifestChunks.length) {
            for (const item of head.manifestChunks) parts.set(item.chunkIndex, { chunkIndex: item.chunkIndex, bytes: await open(id, 'manifest', item) });
        } else {
            for (const unit of await repository.getStagedUnitsOfKind(id, 'manifest')) parts.set(unit.chunkIndex, { chunkIndex: unit.chunkIndex, bytes: unit.bytes });
        }
        return parts.size ? joinHistoryValue([...parts.values()]) : null;
    }

    async function decodeConversation(id) {
        const snapshot = await repository.getConversationSnapshot(id);
        if (!snapshot) return null;
        const groups = { manifest: new Map(), messages: new Map(), attachments: new Map() };
        const add = (kind, recordId, part) => {
            if (!groups[kind].has(recordId)) groups[kind].set(recordId, new Map());
            groups[kind].get(recordId).set(part.chunkIndex, part);
        };
        for (const unit of snapshot.staged) add(unit.kind, unit.recordId, unit);
        // Saved records replace staged ones, and a saved manifest replaces every staged manifest chunk.
        if (snapshot.manifestChunks.length) groups.manifest.delete('manifest');
        for (const [kind, records] of [['manifest', snapshot.manifestChunks], ['messages', snapshot.messages], ['attachments', snapshot.attachments]]) {
            for (const item of records) add(kind, item.id, { chunkIndex: item.chunkIndex, bytes: await open(id, kind, item) });
        }
        if (!groups.manifest.has('manifest')) return null;
        const { messageIds, ...metadata } = joinHistoryValue([...groups.manifest.get('manifest').values()]);
        const attachments = new Map([...groups.attachments].map(([key, parts]) => [key, joinHistoryValue([...parts.values()])]));
        const messages = messageIds.map(messageId => {
            const parts = groups.messages.get(messageId);
            if (!parts) throw new Error('History message is missing');
            const message = restoreMessage(joinHistoryValue([...parts.values()]), attachments);
            Object.defineProperty(message, 'historyRecordId', { value: messageId, configurable: true });
            return message;
        });
        return { ...metadata, id, messages };
    }

    // Finalization cannot afford to decode every message again, so it checks structure and the manifest only.
    async function verifyConversation(id) {
        const head = await repository.getConversationHead(id);
        const manifest = await loadManifest(id, head);
        if (!manifest) throw new Error('History manifest is missing');
        const keys = await repository.getRecordKeys(id);
        const staged = new Set((await repository.getStagedUnitsOfKind(id, 'messages')).map(unit => unit.recordId));
        const present = new Set([...keys.messages.map(item => item.id), ...staged]);
        if (manifest.messageIds.some(messageId => !present.has(messageId))) throw new Error('History message is missing');
    }

    async function listConversationIds() {
        const ids = new Set((await repository.listConversations()).map(row => row.id));
        (await repository.listStagedConversationIds()).forEach(id => ids.add(id));
        return [...ids];
    }

    async function restore() {
        const sessions = [];
        for (const id of await listConversationIds()) {
            const session = await decodeConversation(id);
            if (session) sessions.push(session);
        }
        return sessions;
    }

    return { loadManifest, decodeConversation, verifyConversation, listConversationIds, restore };
}
