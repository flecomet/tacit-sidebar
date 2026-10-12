import { openHistoryDatabase } from './historyRepository';
import { createHistoryReader } from './historyReader';
import { disabledHistoryStatus } from './historyStatus';

const STATUS_EVENT = 'history.status.changed';
const CHANGED_EVENT = 'history.changed';

const extensionRuntime = () => (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage ? chrome.runtime : null);

// A missing runtime or an unanswered message means the history service is not reachable, never that history is off.
async function send(message) {
    const runtime = extensionRuntime();
    if (!runtime) throw new Error('History service is unavailable');
    const response = await runtime.sendMessage(message);
    if (response === undefined) throw new Error('History service did not answer');
    if (response?.error && !response.ok) throw Object.assign(new Error(response.message || response.error), { code: response.error });
    return response;
}

// The repository is readable from the panel, so the status survives a service worker that does not answer.
export async function getHistoryStatus() {
    try {
        return await send({ type: 'history.status' });
    } catch (error) {
        if (typeof indexedDB === 'undefined') return { ...disabledHistoryStatus };
        const repository = await openHistoryDatabase({ readOnly: true }).catch(error => {
            if (error.code === 'HISTORY_NOT_FOUND') return null;
            throw error;
        });
        if (!repository) return { ...disabledHistoryStatus };
        try {
            return (await repository.getMigrationStatus()) || { ...disabledHistoryStatus };
        } finally {
            repository.close();
        }
    }
}

export function subscribeHistoryStatus(listener) {
    const onMessage = chrome?.runtime?.onMessage;
    if (!onMessage?.addListener) return () => {};
    const handler = message => { if (message?.type === STATUS_EVENT) listener(message.status); };
    onMessage.addListener(handler);
    return () => onMessage.removeListener?.(handler);
}

export function subscribeHistoryChanges(listener) {
    const onMessage = chrome?.runtime?.onMessage;
    if (!onMessage?.addListener) return () => {};
    const handler = message => { if (message?.type === CHANGED_EVENT) listener(message); };
    onMessage.addListener(handler);
    return () => onMessage.removeListener?.(handler);
}

export const reportHistoryInteraction = () => { send({ type: 'history.interaction' }).catch(() => {}); };
export const prepareHistory = () => sendWithRetry({ type: 'history.prepare' });
export const activateHistory = () => sendWithRetry({ type: 'history.activate' });
export const resumeHistory = () => send({ type: 'history.resume' });
export const pauseHistory = () => send({ type: 'history.pause' });
async function sendWithRetry(command) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try { return await send({ ...command }); }
        catch (error) {
            if (error.code || attempt === 2) throw error;
        }
    }
}

export const sendHistoryCommand = command => sendWithRetry(command);

// The panel shares the extension origin, so it reads and decrypts the repository directly. This avoids
// serializing the whole history through extension messaging, which has a size limit.
async function readHistory(read, empty) {
    const repository = await openHistoryDatabase({ readOnly: true }).catch(error => {
        if (error.code === 'HISTORY_NOT_FOUND') return null;
        throw error;
    });
    if (!repository) return empty;
    try {
        const reader = createHistoryReader({
            repository,
            getKey: async () => {
                const key = await repository.getMetadata('installation-key');
                if (!key) throw new Error('History key is missing');
                return key;
            },
        });
        return await read(reader);
    } finally {
        repository.close();
    }
}

export const restoreHistory = () => readHistory(reader => reader.restore(), []);
export const restoreHistorySession = sessionId => readHistory(reader => reader.decodeConversation(sessionId), null);
