import { encryptRecord, decryptRecord, generateHistoryKey } from './historyCrypto';
import { serializeSession, serializeMessage, splitHistoryValue } from './historySerialization';
import { authId, createHistoryReader, storeOf } from './historyReader';
import { disabledHistoryStatus } from './historyStatus';

export const migrationBudget = { maxChunkBytes: 256 * 1024, targetWorkMs: 10, minPauseMs: 150, maxConcurrentJobs: 1, maxWakeDurationMs: 2000 };
export const HISTORY_ENABLED_KEY = 'tacit-history-enabled';
export const LEGACY_STORAGE_KEY = 'tacit-storage';
export { disabledHistoryStatus };

const STAGING_BATCH_BYTES = 8 * 1024 * 1024;
const COMMAND_TYPES = ['history.create', 'history.append', 'history.truncate', 'history.delete'];
// These failures describe one stale command, not a storage problem, so they must not mark the migration as failed.
const BENIGN_CODES = ['HISTORY_DELETED', 'HISTORY_REVISION_CONFLICT', 'HISTORY_NOT_FOUND'];

export function stripLegacyHistory(value) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : structuredClone(value);
    if (parsed?.state) { delete parsed.state.sessions; delete parsed.state.messages; }
    return typeof value === 'string' ? JSON.stringify(parsed) : parsed;
}

const errorText = error => (error instanceof Error ? error.message : String(error));
const sizeOf = units => units.reduce((sum, unit) => sum + unit.bytes.byteLength, 0);
const titleFrom = content => content.slice(0, 30).replace(/\n/g, ' ') + (content.length > 30 ? '...' : '');
const failure = (code, message) => Object.assign(new Error(message), { code });

// The legacy blob stores each session once and the active messages a second time at the root.
function legacySessions(value) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const state = parsed?.state || {};
    const sessions = [...(state.sessions || [])];
    const owned = state.currentSessionId ? sessions.some(session => session.id === state.currentSessionId) : sessions.length > 0;
    if (state.messages?.length && !owned) {
        sessions.push({ id: state.currentSessionId || 'legacy-orphan', title: 'Restored Chat', model: state.model, messages: state.messages });
    }
    return sessions.map(session => ({ ...session, messages: session.messages || [] }));
}

// Only counters are kept: the snapshot sits in the plaintext index and must not reveal titles.
const fingerprint = session => ({ count: session.messages.length, updatedAt: session.updatedAt ?? null });
const sameFingerprint = (a, b) => a && a.count === b.count && a.updatedAt === b.updatedAt;

export function createHistoryOwner({
    repository, storage, budget = migrationBudget,
    now = () => performance.now(),
    pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
    broadcast = () => {},
}) {
    let tail = Promise.resolve();
    let wake;
    let recentInteraction = -Infinity;
    let keyPromise;
    let adoptionKeyPromise;

    // Every mutation goes through one queue, so the owner never runs two storage jobs at once.
    const serial = task => {
        const result = tail.then(task);
        tail = result.catch(() => {});
        return result;
    };
    const status = async () => (await repository.getMigrationStatus()) || { ...disabledHistoryStatus };
    const publish = async next => {
        await repository.setMigrationStatus(next);
        broadcast({ type: 'history.status.changed', status: next });
        return next;
    };
    const getKey = () => keyPromise ||= (async () => {
        const saved = await repository.getMetadata('installation-key');
        if (saved) return saved;
        const created = await generateHistoryKey();
        await repository.setMetadata('installation-key', created);
        return created;
    })().catch(error => { keyPromise = undefined; throw error; });
    const reader = createHistoryReader({ repository, getKey });

    const withProgress = current => ({
        ...current,
        progress: current.totalBytes ? Math.min(0.95, (current.verifiedBytes / current.totalBytes) * 0.95) : 0.95,
    });
    const fail = async error => {
        const current = await status();
        await publish({ ...current, phase: 'error', lastError: errorText(error) });
        throw error;
    };

    // Small batches keep each IndexedDB transaction short. The status lands with the last batch.
    async function stage(units, next) {
        let batch = [];
        let bytes = 0;
        for (const unit of units) {
            batch.push(unit);
            bytes += unit.bytes.byteLength;
            if (bytes >= STAGING_BATCH_BYTES) {
                await repository.putStagedUnits(batch);
                batch = [];
                bytes = 0;
            }
        }
        await repository.putStagedUnits(batch, next);
    }

    async function prepareInternal() {
        const previous = await status();
        if (previous.enabled) return previous;
        await publish({ ...disabledHistoryStatus, phase: 'preparing' });
        await getKey();
        const started = now();
        // A repeated preparation starts from the legacy blob again, so earlier staging cannot leave stale units.
        await repository.clearStagedUnits();
        const sessions = legacySessions(await storage.get(LEGACY_STORAGE_KEY));
        const units = sessions.flatMap(serializeSession);
        const next = { ...disabledHistoryStatus, phase: 'preparing', totalBytes: sizeOf(units), preparationMs: now() - started };
        await repository.setMetadata('source-snapshot', Object.fromEntries(sessions.map(session => [session.id, fingerprint(session)])));
        await stage(units, next);
        broadcast({ type: 'history.status.changed', status: next });
        return next;
    }

    // The panel stops writing history to the legacy blob before this runs, so the delta read here is final.
    async function activateInternal() {
        const current = await status();
        if (current.enabled) { await storage.set(HISTORY_ENABLED_KEY, true); return current; }
        if (current.phase !== 'preparing') throw new Error('History encryption was not prepared');
        const snapshot = (await repository.getMetadata('source-snapshot')) || {};
        const sessions = legacySessions(await storage.get(LEGACY_STORAGE_KEY));
        let totalBytes = current.totalBytes;
        const changed = [];
        const seen = new Set();
        for (const session of sessions) {
            seen.add(session.id);
            if (sameFingerprint(snapshot[session.id], fingerprint(session)) || await repository.getTombstone(session.id)) continue;
            const units = serializeSession(session);
            const known = new Set(units.map(unit => unit.id));
            const previous = await repository.getStagedUnits(session.id);
            await repository.deleteStagedUnits(previous.filter(unit => !known.has(unit.id)).map(unit => unit.id));
            totalBytes += sizeOf(units) - sizeOf(previous);
            changed.push(...units);
        }
        for (const id of Object.keys(snapshot).filter(sessionId => !seen.has(sessionId))) await repository.deleteConversation(id);
        const next = { ...current, phase: 'migrating', enabled: true, totalBytes, verifiedBytes: 0, progress: 0, lastError: null };
        await repository.setMetadata('legacy-watermark', Object.fromEntries(sessions.map(session => [session.id, fingerprint(session)])));
        await stage(changed, next);
        await repository.setMetadata('source-snapshot', null);
        await storage.set(HISTORY_ENABLED_KEY, true);
        broadcast({ type: 'history.status.changed', status: next });
        return next;
    }

    // Small units are converted together, one commit per conversation, so the pause between steps is paid per batch.
    async function nextBatch() {
        const found = await repository.getNextStagedUnits({ maxBytes: budget.maxChunkBytes });
        const units = new Map(found.map(unit => [unit.id, unit]));
        // A manifest is replaced as a whole, so every staged chunk of it has to be part of the same step.
        for (const id of new Set(found.filter(unit => unit.kind === 'manifest').map(unit => unit.conversationId))) {
            for (const unit of await repository.getStagedUnitsOfKind(id, 'manifest')) units.set(unit.id, unit);
        }
        return [...units.values()];
    }

    async function convertBatch(batch) {
        const groups = new Map();
        for (const unit of batch) groups.set(unit.conversationId, [...(groups.get(unit.conversationId) || []), unit]);
        for (const [conversationId, group] of groups) await convertGroup(conversationId, group);
    }

    async function convertGroup(conversationId, group) {
        const current = await status();
        const checkpoint = withProgress({ ...current, phase: 'migrating', verifiedBytes: current.verifiedBytes + sizeOf(group), lastError: null });
        const ids = group.map(unit => unit.id);
        if (await repository.getTombstone(conversationId)) {
            await repository.deleteStagedUnits(ids, checkpoint);
            return;
        }
        const head = await repository.getConversationHead(conversationId);
        const expectedRevision = head?.revision || 0;
        const revision = expectedRevision + 1;
        const key = await getKey();
        const encryptedRecords = await encryptedUnits(group, revision);
        await repository.commitRevision({ id: conversationId, expectedRevision, encryptedRecords, replaceManifest: Boolean(encryptedRecords.manifest) });
        // The plaintext source stays staged until every stored record authenticates and matches it.
        const stored = await repository.getRecords(group.map(unit => ({ store: storeOf(unit.kind), conversationId, id: unit.recordId, chunkIndex: unit.chunkIndex })));
        for (const [index, unit] of group.entries()) {
            const saved = stored[index];
            if (!saved) throw new Error('History verification failed');
            const verified = await decryptRecord({ key, record: saved.record, recordId: authId(unit), revision: saved.revision, chunkIndex: saved.chunkIndex });
            if (verified.length !== unit.bytes.length || verified.some((byte, position) => byte !== unit.bytes[position])) throw new Error('History verification failed');
        }
        await repository.deleteStagedUnits(ids, checkpoint);
        broadcast({ type: 'history.status.changed', status: checkpoint });
    }

    async function encryptedUnits(units, revision) {
        const records = { messages: [], attachments: [] };
        const key = await getKey();
        for (const unit of units) {
            const item = {
                id: unit.recordId, revision, chunkIndex: unit.chunkIndex,
                record: await encryptRecord({ key, plaintext: unit.bytes, recordId: authId(unit), revision, chunkIndex: unit.chunkIndex }),
            };
            if (unit.kind === 'manifest') (records.manifest ||= []).push(item);
            else records[unit.kind].push(item);
        }
        return records;
    }

    async function deleteCommand(command) {
        const { sessionId: id, commandId } = command;
        const pending = await repository.getStagedUnits(id);
        const current = await status();
        const checkpoint = withProgress({ ...current, verifiedBytes: current.verifiedBytes + sizeOf(pending) });
        const result = await repository.deleteConversation(id, { commandId, checkpoint });
        broadcast({ type: 'history.changed', commandId, sessionId: id });
        return result;
    }

    async function writeCommand(command) {
        const { sessionId: id, commandId } = command;
        if (await repository.getTombstone(id)) throw failure('HISTORY_DELETED', 'Conversation was deleted');
        const head = await repository.getConversationHead(id);
        let manifest = await reader.loadManifest(id, head);
        const revision = (head?.revision || 0) + 1;
        let units = [];
        let deleteMessageIds = [];
        let deleteAttachmentIds = [];
        let completedStagedUnitIds = (await repository.getStagedUnitsOfKind(id, 'manifest')).map(unit => unit.id);

        if (command.type === 'history.create') {
            if (manifest) return { id, revision: head?.revision || 0 };
            const { messages = [], ...metadata } = command.session;
            manifest = { ...metadata, id, messageIds: messages.map((_, index) => `${commandId}:${index}`) };
            units = messages.flatMap((message, index) => serializeMessage(message, manifest.messageIds[index], id));
        } else {
            if (!manifest && command.session && command.type === 'history.append') {
                const { messages: _ignored, ...metadata } = command.session;
                manifest = { ...metadata, id, messageIds: [] };
            }
            if (!manifest) throw failure('HISTORY_NOT_FOUND', 'History conversation no longer exists');
            if (command.expectedMessageCount !== undefined) {
                if (!Number.isSafeInteger(command.expectedMessageCount) || command.expectedMessageCount < 0) throw new Error('Invalid expected history message count');
                if (manifest.messageIds.length !== command.expectedMessageCount) {
                    throw failure('HISTORY_REVISION_CONFLICT', `Expected ${command.expectedMessageCount} messages, found ${manifest.messageIds.length}`);
                }
            }
            if (command.expectedLastMessageId !== undefined) {
                if (command.expectedLastMessageId !== null && (typeof command.expectedLastMessageId !== 'string' || !command.expectedLastMessageId)) throw new Error('Invalid expected history message id');
                if ((manifest.messageIds.at(-1) ?? null) !== command.expectedLastMessageId) {
                    throw failure('HISTORY_REVISION_CONFLICT', 'The last saved history message changed');
                }
            }
            manifest = { ...manifest, updatedAt: command.updatedAt ?? Date.now() };
            if (command.type === 'history.append') {
                units = serializeMessage(command.message, commandId, id);
                manifest.messageIds = [...manifest.messageIds, commandId];
                if ((!manifest.title || manifest.title === 'New Chat') && command.message.role === 'user' && typeof command.message.content === 'string') {
                    manifest.title = titleFrom(command.message.content);
                }
            } else {
                if (!Number.isInteger(command.messageIndex) || command.messageIndex < 0) throw new Error('Invalid history truncation');
                deleteMessageIds = manifest.messageIds.slice(command.messageIndex);
                manifest.messageIds = manifest.messageIds.slice(0, command.messageIndex);
                const removed = new Set(deleteMessageIds);
                const ownerOf = recordId => recordId.split(':attachment:')[0];
                deleteAttachmentIds = [...new Set((await repository.getRecordKeys(id)).attachments.filter(item => removed.has(ownerOf(item.id))).map(item => item.id))];
                // Staged unit ids look like `<conversation>/<kind>/<record>/<chunk>`.
                const stagedOwner = unitId => {
                    const [kind, ...rest] = unitId.slice(id.length + 1).split('/');
                    return kind === 'manifest' ? null : ownerOf(rest.slice(0, -1).join('/'));
                };
                completedStagedUnitIds = [...completedStagedUnitIds, ...(await repository.listStagedUnitIds(id)).filter(unitId => removed.has(stagedOwner(unitId)))];
            }
        }
        units.push(...splitHistoryValue(manifest, 'manifest', 'manifest', id));
        const records = await encryptedUnits(units, revision);
        const result = await repository.commitRevision({
            id, expectedRevision: head?.revision || 0, commandId, completedStagedUnitIds,
            encryptedRecords: { ...records, deleteMessageIds, deleteAttachmentIds }, replaceManifest: true,
        });
        broadcast({ type: 'history.changed', commandId, sessionId: id });
        return result;
    }

    async function commandInternal(command) {
        if (!COMMAND_TYPES.includes(command?.type) || typeof command.commandId !== 'string' || !command.commandId || typeof command.sessionId !== 'string' || !command.sessionId) {
            throw new Error('Invalid history command');
        }
        if (!(await status()).enabled) return { disabled: true };
        const acknowledged = await repository.getCommand(command.commandId);
        if (acknowledged) return acknowledged;
        return command.type === 'history.delete' ? deleteCommand(command) : writeCommand(command);
    }

    const withSettingsLock = task => storage.withLock ? storage.withLock(task) : task();

    async function writeSettingsInternal(name, value) {
        if (name === LEGACY_STORAGE_KEY && (await status()).enabled) value = stripLegacyHistory(value);
        await withSettingsLock(() => storage.set(name, value));
    }

    async function legacyAdoptionId(value) {
        adoptionKeyPromise ||= (async () => {
            const saved = await repository.getMetadata('legacy-adoption-key');
            if (saved) return saved;
            const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
            await repository.setMetadata('legacy-adoption-key', key);
            return key;
        })().catch(error => { adoptionKeyPromise = undefined; throw error; });
        const signed = await crypto.subtle.sign('HMAC', await adoptionKeyPromise, new TextEncoder().encode(JSON.stringify(value)));
        return `legacy-adoption:${Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    }

    async function reconcileLegacyAppends(legacy) {
        const watermark = (await repository.getMetadata('legacy-watermark')) || {};
        let changed = false;
        for (const session of legacySessions(legacy)) {
            if (await repository.getTombstone(session.id)) continue;
            const previous = watermark[session.id] || { count: 0, updatedAt: null };
            const next = fingerprint(session);
            if (next.count <= previous.count) {
                if (next.updatedAt != null && previous.updatedAt != null && next.updatedAt > previous.updatedAt) {
                    const recoveryId = `recovered:${await legacyAdoptionId(['recovery', session])}`;
                    await commandInternal({
                        type: 'history.create', commandId: recoveryId, sessionId: recoveryId,
                        session: { ...session, id: recoveryId, title: `Recovered edits: ${session.title || 'Chat'}` },
                    });
                    watermark[session.id] = next;
                    await repository.setMetadata('legacy-watermark', watermark);
                    throw failure('HISTORY_LEGACY_CONFLICT', 'An older panel changed existing history. An encrypted recovered copy is available in the conversation list. Review it, then resume encryption.');
                }
                continue;
            }
            let current = await reader.decodeConversation(session.id);
            if (!current) {
                await commandInternal({ type: 'history.create', commandId: await legacyAdoptionId(['create', session.id]), sessionId: session.id, session: { ...session, messages: [] } });
                current = { messages: [] };
            }
            // Only the suffix can be new; a stale prefix may contain messages deliberately removed elsewhere.
            const acknowledged = current.messages.slice(previous.count).map(message => JSON.stringify(message));
            for (const [offset, message] of session.messages.slice(previous.count).entries()) {
                const index = acknowledged.indexOf(JSON.stringify(message));
                if (index >= 0) { acknowledged.splice(index, 1); continue; }
                await commandInternal({ type: 'history.append', commandId: await legacyAdoptionId([session.id, previous.count, offset, message]), sessionId: session.id, message, updatedAt: session.updatedAt });
            }
            watermark[session.id] = next;
            changed = true;
        }
        if (changed) await repository.setMetadata('legacy-watermark', watermark);
    }

    async function cleanLegacySettingsInternal() {
        // Settings writers share this lock, so cleanup cannot overwrite a newer value between get and set.
        await withSettingsLock(async () => {
            const legacy = await storage.get(LEGACY_STORAGE_KEY);
            const parsed = typeof legacy === 'string' ? JSON.parse(legacy) : legacy;
            if (parsed?.state && ('sessions' in parsed.state || 'messages' in parsed.state)) {
                await reconcileLegacyAppends(legacy);
                await storage.set(LEGACY_STORAGE_KEY, stripLegacyHistory(legacy));
            }
        });
    }

    async function finalize() {
        const current = await status();
        await publish({ ...current, phase: 'finalizing', progress: 0.97 });
        if (await repository.countStagedUnits()) throw new Error('History migration still has pending records');
        for (const id of await reader.listConversationIds()) {
            if (!(await repository.getTombstone(id))) await reader.verifyConversation(id);
        }
        await cleanLegacySettingsInternal();
        const readBack = await storage.get(LEGACY_STORAGE_KEY);
        const parsed = typeof readBack === 'string' ? JSON.parse(readBack) : readBack;
        if (parsed?.state && ('sessions' in parsed.state || 'messages' in parsed.state)) throw new Error('Legacy history cleanup failed');
        await publish({ ...current, phase: 'complete', enabled: true, progress: 1, lastError: null, legacyContentRemoved: true });
    }

    const needsWork = current => current.enabled && !['complete', 'error', 'paused'].includes(current.phase);

    return {
        status,
        reader,
        needsWork: async () => needsWork(await status()),
        prepare: () => serial(() => prepareInternal().catch(fail)),
        activate: () => serial(() => activateInternal().catch(fail)),
        enable: () => serial(() => prepareInternal().then(activateInternal).catch(fail)),
        resume: () => serial(async () => {
            const current = await status();
            if (!current.enabled) return prepareInternal().then(activateInternal).catch(fail);
            return publish({ ...current, phase: 'migrating', lastError: null });
        }),
        pause: () => serial(async () => {
            const current = await status();
            return needsWork(current) ? publish({ ...current, phase: 'paused' }) : current;
        }),
        restore: () => serial(async () => {
            const current = await status();
            return current.enabled ? { enabled: true, status: current, sessions: await reader.restore() } : { enabled: false, status: current };
        }),
        command: command => serial(() => commandInternal(command).catch(async error => {
            if (BENIGN_CODES.includes(error?.code)) return { error: error.code, message: error.message };
            return fail(error);
        })),
        cleanLegacySettings: () => serial(() => cleanLegacySettingsInternal().catch(fail)),
        writeSettings: (name, value) => serial(() => writeSettingsInternal(name, value)),
        interaction: () => { recentInteraction = now(); },
        runWake() {
            if (wake) return wake;
            wake = (async () => {
                const started = now();
                while (now() - started < budget.maxWakeDurationMs) {
                    const stepStarted = now();
                    const active = await serial(async () => {
                        if (!needsWork(await status())) return false;
                        const batch = await nextBatch();
                        if (!batch.length) { await finalize(); return false; }
                        await convertBatch(batch);
                        return true;
                    });
                    if (!active) break;
                    const elapsed = now() - stepStarted;
                    const rest = Math.max(budget.minPauseMs, elapsed > budget.targetWorkMs ? elapsed * 10 : 0, now() - recentInteraction < 1000 ? 300 : 0);
                    if (now() - started + rest >= budget.maxWakeDurationMs) break;
                    await pause(rest);
                }
                return status();
            })().catch(error => serial(() => fail(error)).catch(() => status())).finally(() => { wake = undefined; });
            return wake;
        },
    };
}
