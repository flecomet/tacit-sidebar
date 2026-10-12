// Translates changes of the in-memory sessions into targeted commands for the background history owner.
const sessionSummary = ({ id, title, model, updatedAt }) => ({ id, title, model, updatedAt });

let suspended = 0;
const pendingWrites = new Set();
const recordIds = new WeakMap();
const localCommands = new Set();
export const isOwnHistoryChange = event => Boolean(event?.commandId && localCommands.has(event.commandId));
export const getHistoryMessageId = message => message && (recordIds.get(message) || message.historyRecordId);
const guardTail = messages => ({
    expectedMessageCount: messages.length,
    ...(messages.length === 0 ? { expectedLastMessageId: null } : getHistoryMessageId(messages.at(-1)) ? { expectedLastMessageId: getHistoryMessageId(messages.at(-1)) } : {}),
});

export function markLegacyHistory(sessions) {
    for (const session of sessions) {
        session.messages.forEach((message, index) => recordIds.set(message, `legacy:${index}`));
    }
}

export async function settleHistoryWrites() {
    while (pendingWrites.size) await Promise.all([...pendingWrites]);
}

export function prepareHistoryCommand(command, createId, sessions) {
    const prepared = { commandId: createId(), ...command };
    localCommands.add(prepared.commandId);
    if (localCommands.size > 1000) localCommands.delete(localCommands.values().next().value);
    if (command.type === 'history.append') {
        const messages = sessions.find(session => session.id === command.sessionId)?.messages || [];
        const previous = messages[command.expectedMessageCount - 1];
        if (getHistoryMessageId(previous)) prepared.expectedLastMessageId = getHistoryMessageId(previous);
        recordIds.set(command.message, prepared.commandId);
    } else if (command.type === 'history.create') {
        command.session.messages.forEach((message, index) => recordIds.set(message, `${prepared.commandId}:${index}`));
    }
    return prepared;
}

// Restoring from the repository replaces the sessions wholesale and must not be written back.
export function withoutHistorySync(task) {
    suspended += 1;
    try { return task(); } finally { suspended -= 1; }
}

export function diffSessions(previous, next) {
    const commands = [];
    const before = new Map(previous.map(session => [session.id, session]));
    const present = new Set();
    for (const session of next) {
        present.add(session.id);
        const old = before.get(session.id);
        if (!old) {
            commands.push({ type: 'history.create', sessionId: session.id, session });
            continue;
        }
        if (old === session || old.messages === session.messages) continue;
        // Messages are compared by reference, so only real removals and additions produce commands.
        const shared = Math.min(old.messages.length, session.messages.length);
        let common = 0;
        while (common < shared && old.messages[common] === session.messages[common]) common++;
        if (common < old.messages.length) {
            commands.push({ type: 'history.truncate', sessionId: session.id, messageIndex: common, updatedAt: session.updatedAt, ...guardTail(old.messages) });
        }
        let count = common;
        for (const message of session.messages.slice(common)) {
            commands.push({ type: 'history.append', sessionId: session.id, message, updatedAt: session.updatedAt, session: sessionSummary(session), ...guardTail(session.messages.slice(0, count)) });
            count++;
        }
    }
    for (const session of previous) {
        if (!present.has(session.id)) commands.push({ type: 'history.delete', sessionId: session.id });
    }
    return commands;
}

export function startHistorySync({ store, send, createId, onError, onFailure }) {
    return store.subscribe((state, previous) => {
        if (suspended || !state.historyEnabled || !previous.historyEnabled || state.historyLoaded === false || state.sessions === previous.sessions) return;
        for (const change of diffSessions(previous.sessions, state.sessions)) {
            const command = prepareHistoryCommand(change, createId, state.sessions);
            const writing = send(command)
                .then(response => {
                    if (response?.error) throw Object.assign(new Error(response.message || response.error), { code: response.error });
                })
                .catch(error => {
                    onError(error?.message || String(error));
                    onFailure?.(command, error);
                })
                .finally(() => pendingWrites.delete(writing));
            pendingWrites.add(writing);
        }
    });
}
