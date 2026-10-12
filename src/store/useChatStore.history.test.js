import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/historyClient', () => ({
    getHistoryStatus: vi.fn(),
    restoreHistory: vi.fn(),
    restoreHistorySession: vi.fn(),
    prepareHistory: vi.fn(),
    activateHistory: vi.fn(),
    sendHistoryCommand: vi.fn(),
}));

import { useChatStore } from './useChatStore';
import { getHistoryStatus, restoreHistory, restoreHistorySession, prepareHistory, activateHistory, sendHistoryCommand } from '../services/historyClient';

const STORAGE_NAME = 'tacit-storage';
const msg = (content, role = 'user') => ({ role, content });
const makeSession = (id, messages = [], extra = {}) => ({ id, title: 'New Chat', model: 'm0', updatedAt: 1, messages, ...extra });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
const state = () => useChatStore.getState();
const sent = () => sendHistoryCommand.mock.calls.map(([command]) => command);
const summarize = commands => commands.map(c => `${c.type}:${c.sessionId}`);

const BASE_STATE = {
    historyEnabled: false,
    historyLoaded: false,
    historyWriteError: null,
    historyNeedsReconcile: false,
    historyRecoverySessions: [],
    historyFailedCommands: [],
    sessions: [],
    messages: [],
    currentSessionId: null,
    model: 'm0',
    favorites: [],
    availableModels: [],
    providerMode: 'cloud',
};

// Puts the store in the "encryption active" state without emitting commands.
const seedEnabled = (sessions, currentSessionId = sessions[0]?.id ?? null) => {
    const current = sessions.find(s => s.id === currentSessionId);
    useChatStore.setState({ ...BASE_STATE });
    useChatStore.setState({ sessions, currentSessionId, messages: current ? current.messages : [], historyEnabled: true, historyLoaded: true });
    sendHistoryCommand.mockClear();
};

// Parsed 'tacit-storage' blobs written to chrome.storage.local, in order.
const blobWrites = () => chrome.storage.local.set.mock.calls
    .filter(([items]) => STORAGE_NAME in items)
    .map(([items]) => JSON.parse(items[STORAGE_NAME]).state);

beforeEach(async () => {
    await chrome.storage.local.clear();
    useChatStore.setState({ ...BASE_STATE });
    for (const fn of [getHistoryStatus, restoreHistory, restoreHistorySession, prepareHistory, activateHistory, sendHistoryCommand]) fn.mockReset();
    sendHistoryCommand.mockResolvedValue({ ok: true });
    getHistoryStatus.mockResolvedValue({ enabled: false, phase: 'disabled' });
    prepareHistory.mockResolvedValue({ phase: 'preparing' });
    activateHistory.mockResolvedValue({ phase: 'migrating', enabled: true });
    chrome.storage.local.set.mockClear();
});

describe('partialize', () => {
    const partialize = () => useChatStore.persist.getOptions().partialize(state());

    it('omits sessions and messages and includes historyEnabled when history encryption is active', () => {
        seedEnabled([makeSession('a', [msg('secret')])]);
        const saved = partialize();
        expect(saved).not.toHaveProperty('sessions');
        expect(saved).not.toHaveProperty('messages');
        expect(saved.historyEnabled).toBe(true);
        expect(saved.currentSessionId).toBe('a');
        expect(saved.model).toBe('m0');
        expect(JSON.stringify(saved)).not.toContain('secret');
    });

    it('keeps sessions and messages and saves historyEnabled false when encryption is off', () => {
        useChatStore.setState({ ...BASE_STATE, sessions: [makeSession('a', [msg('plain')])], messages: [msg('plain')] });
        const saved = partialize();
        expect(saved.sessions).toHaveLength(1);
        expect(saved.messages).toEqual([msg('plain')]);
        expect(saved.historyEnabled).toBe(false);
    });

    it('never writes sessions to chrome.storage while encryption is active', async () => {
        seedEnabled([makeSession('a', [msg('secret')])]);
        chrome.storage.local.set.mockClear();
        state().setModel('x');
        await flush();
        const writes = blobWrites();
        expect(writes.length).toBeGreaterThan(0);
        for (const write of writes) {
            expect(write).not.toHaveProperty('sessions');
            expect(write).not.toHaveProperty('messages');
            expect(write.historyEnabled).toBe(true);
        }
    });
});

describe('changes that do not touch sessions emit no history commands', () => {
    beforeEach(() => seedEnabled([makeSession('a', [msg('x')]), makeSession('b')], 'a'));

    it('setAvailableModels, setModel, setProviderMode and setActiveCloudProvider', () => {
        state().setAvailableModels([{ id: 'm1' }]);
        state().setModel('m1');
        state().setProviderMode('local');
        state().setActiveCloudProvider('openai');
        state().setLocalBaseUrl('http://localhost:1234/v1');
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('API key add, update, activate and remove', () => {
        state().addApiKey('openrouter', { label: 'one', encryptedKey: 'k1', baseUrl: '' });
        state().addApiKey('openrouter', { label: 'two', encryptedKey: 'k2', baseUrl: '' });
        const [first, second] = state().apiKeys.openrouter;
        state().updateApiKey('openrouter', first.id, { label: 'renamed' });
        state().setActiveApiKey('openrouter', second.id);
        state().removeApiKey('openrouter', first.id);
        expect(state().apiKeys.openrouter).toHaveLength(1);
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('favorites, web search and LM Studio settings', () => {
        state().toggleFavorite('m1');
        state().toggleFavorite('m1');
        state().toggleFavorite('m2');
        state().setWebSearchConfig({ enabled: true });
        state().setLmStudioSearch({ enabled: true });
        expect(state().favorites).toEqual(['m2']);
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('restoreSession and ensureActiveSession on an existing session', () => {
        state().restoreSession('b');
        state().ensureActiveSession();
        expect(state().currentSessionId).toBe('b');
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('does not emit commands when encryption is off', () => {
        useChatStore.setState({ ...BASE_STATE, historyEnabled: false, sessions: [makeSession('a')], currentSessionId: 'a' });
        state().addMessage(msg('hello'));
        state().createNewChat();
        state().deleteSession('a');
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });
});

describe('session actions emit targeted commands', () => {
    it('addMessage appends one message with the session summary and the generated title', () => {
        seedEnabled([makeSession('a')]);
        const message = msg('hello world');
        state().addMessage(message);
        const commands = sent();
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({ type: 'history.append', sessionId: 'a', message });
        expect(commands[0].message).toBe(message);
        expect(commands[0].session).toEqual({ id: 'a', title: 'hello world', model: 'm0', updatedAt: state().sessions[0].updatedAt });
        expect(commands[0].session).not.toHaveProperty('messages');
        expect(commands[0].updatedAt).toBe(state().sessions[0].updatedAt);
        expect(typeof commands[0].commandId).toBe('string');
        expect(commands[0].commandId).not.toBe('');
    });

    it('addMessage sends one append per call, in order, with unique command ids', () => {
        seedEnabled([makeSession('a')]);
        state().addMessage(msg('q'));
        state().addMessage(msg('a', 'assistant'));
        state().addMessage(msg('q2'));
        const commands = sent();
        expect(commands.map(c => c.message.content)).toEqual(['q', 'a', 'q2']);
        expect(commands.every(c => c.type === 'history.append')).toBe(true);
        expect(new Set(commands.map(c => c.commandId)).size).toBe(3);
    });

    it('addMessage without a matching current session emits nothing', () => {
        seedEnabled([makeSession('a')], 'missing');
        state().addMessage(msg('orphan'));
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('addMessageToSession appends to a session that is not the current one', () => {
        seedEnabled([makeSession('a', [msg('x')]), makeSession('b')], 'a');
        state().addMessageToSession('b', msg('background answer', 'assistant'));
        expect(summarize(sent())).toEqual(['history.append:b']);
        expect(sent()[0].message.content).toBe('background answer');
        expect(state().messages).toEqual([msg('x')]);
    });

    it('addMessageToSession for the current session updates the messages pointer and appends once', () => {
        seedEnabled([makeSession('a')]);
        state().addMessageToSession('a', msg('hi'));
        expect(summarize(sent())).toEqual(['history.append:a']);
        expect(state().messages).toHaveLength(1);
    });

    it('addMessageToSession for an unknown session emits nothing', () => {
        seedEnabled([makeSession('a')]);
        state().addMessageToSession('nope', msg('lost'));
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('createNewChat creates the new session in full, and does nothing when the current chat is empty', () => {
        seedEnabled([makeSession('a', [msg('x')])]);
        state().createNewChat();
        const [command] = sent();
        expect(sent()).toHaveLength(1);
        expect(command.type).toBe('history.create');
        expect(command.sessionId).toBe(state().currentSessionId);
        expect(command.sessionId).not.toBe('a');
        expect(command.session).toMatchObject({ id: command.sessionId, title: 'New Chat', messages: [], model: 'm0' });
        sendHistoryCommand.mockClear();
        state().createNewChat();
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('createNewChat creates the first session when none exists', () => {
        seedEnabled([], null);
        state().createNewChat();
        expect(summarize(sent())).toEqual([`history.create:${state().currentSessionId}`]);
    });

    it('ensureActiveSession creates a session when none is current', () => {
        seedEnabled([makeSession('a')], 'gone');
        state().ensureActiveSession();
        expect(sent()).toHaveLength(1);
        expect(sent()[0]).toMatchObject({ type: 'history.create', sessionId: state().currentSessionId });
    });

    it('deleteSession of a non-current session emits one delete', () => {
        seedEnabled([makeSession('a', [msg('x')]), makeSession('b')], 'a');
        state().deleteSession('b');
        expect(sent()).toHaveLength(1);
        expect(sent()[0]).toMatchObject({ type: 'history.delete', sessionId: 'b' });
        expect(state().currentSessionId).toBe('a');
    });

    it('deleteSession of the current session switches to the most recent one and emits only a delete', () => {
        seedEnabled([makeSession('a', [msg('x')], { updatedAt: 5 }), makeSession('b', [], { updatedAt: 9 }), makeSession('c', [], { updatedAt: 2 })], 'a');
        state().deleteSession('a');
        expect(summarize(sent())).toEqual(['history.delete:a']);
        expect(state().currentSessionId).toBe('b');
    });

    it('deleting the last chat emits a create for the fresh chat and a delete for the old one, in that order', () => {
        seedEnabled([makeSession('a', [msg('x')])]);
        state().deleteSession('a');
        expect(state().sessions).toHaveLength(1);
        const freshId = state().currentSessionId;
        expect(freshId).not.toBe('a');
        expect(summarize(sent())).toEqual([`history.create:${freshId}`, 'history.delete:a']);
        expect(sent()[0].session).toMatchObject({ id: freshId, title: 'New Chat', messages: [] });
    });

    it('truncateAtMessage emits one truncate with the message index', () => {
        seedEnabled([makeSession('a', [msg('0'), msg('1', 'assistant'), msg('2')])]);
        state().truncateAtMessage('a', 1);
        expect(sent()).toHaveLength(1);
        expect(sent()[0]).toMatchObject({ type: 'history.truncate', sessionId: 'a', messageIndex: 1 });
        expect(sent()[0].updatedAt).toBe(state().sessions[0].updatedAt);
        expect(state().messages).toHaveLength(1);
    });

    it('truncateAtMessage at index 0 and for an unknown session', () => {
        seedEnabled([makeSession('a', [msg('0'), msg('1')])]);
        state().truncateAtMessage('missing', 0);
        expect(sendHistoryCommand).not.toHaveBeenCalled();
        state().truncateAtMessage('a', 0);
        expect(sent()).toMatchObject([{ type: 'history.truncate', sessionId: 'a', messageIndex: 0 }]);
    });

    it('truncateAtMessage past the end emits nothing', () => {
        seedEnabled([makeSession('a', [msg('0'), msg('1')])]);
        state().truncateAtMessage('a', 5);
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('edit then regenerate emits truncate followed by append', () => {
        seedEnabled([makeSession('a', [msg('0'), msg('1', 'assistant')])]);
        state().truncateAtMessage('a', 0);
        state().addMessageToSession('a', msg('edited'));
        expect(summarize(sent())).toEqual(['history.truncate:a', 'history.append:a']);
        expect(sent()[0].messageIndex).toBe(0);
    });

    it('clearHistory truncates the current session at 0', () => {
        seedEnabled([makeSession('a', [msg('0'), msg('1')]), makeSession('b', [msg('other')])], 'a');
        state().clearHistory();
        expect(sent()).toHaveLength(1);
        expect(sent()[0]).toMatchObject({ type: 'history.truncate', sessionId: 'a', messageIndex: 0 });
        expect(state().sessions.find(s => s.id === 'b').messages).toHaveLength(1);
    });

    it('clearHistory on an empty chat emits nothing', () => {
        seedEnabled([makeSession('a')]);
        state().clearHistory();
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('retries an unacknowledged write with its original command id', async () => {
        seedEnabled([makeSession('a')]);
        sendHistoryCommand.mockRejectedValueOnce(new Error('worker offline'));
        state().addMessage(msg('unsaved'));
        await flush();
        const originalCommand = sent()[0];
        restoreHistory.mockResolvedValue([makeSession('a', [msg('unsaved')])]);
        await state().retryHistoryWrites();
        expect(sent()).toHaveLength(2);
        expect(sent()[1].commandId).toBe(originalCommand.commandId);
        expect(state().historyWriteError).toBeNull();
        expect(state().historyLoaded).toBe(true);
    });

    it.each(['delete', 'truncate'])('keeps a failed %s and its error through refresh until explicit retry', async (kind) => {
        seedEnabled([makeSession('a', [msg('old')]), makeSession('b')], 'b');
        sendHistoryCommand.mockRejectedValueOnce(new Error('worker offline'));
        if (kind === 'delete') state().deleteSession('a');
        else state().truncateAtMessage('a', 0);
        await flush();
        const failed = sent()[0];
        restoreHistory.mockResolvedValue([makeSession('a', [msg('old')]), makeSession('b')]);
        await state().hydrateHistory({ enabled: true });
        expect(state().historyFailedCommands).toHaveLength(1);
        expect(state().historyWriteError).toBe('worker offline');
        restoreHistory.mockResolvedValue(kind === 'delete' ? [makeSession('b')] : [makeSession('a'), makeSession('b')]);
        await state().retryHistoryWrites();
        expect(sent().at(-1).commandId).toBe(failed.commandId);
        expect(state().historyFailedCommands).toEqual([]);
        expect(state().historyWriteError).toBeNull();
    });

    it('reports a rejected command through historyWriteError', async () => {
        seedEnabled([makeSession('a')]);
        sendHistoryCommand.mockRejectedValueOnce(new Error('worker offline'));
        state().addMessage(msg('hi'));
        await flush();
        expect(state().historyWriteError).toBe('worker offline');
    });
});

describe('hydrateHistory', () => {
    it('blocks immediately on an enabled event and shares concurrent restore work', async () => {
        const gate = deferred();
        restoreHistory.mockReturnValue(gate.promise);
        getHistoryStatus.mockResolvedValue({ enabled: true });
        const first = state().hydrateHistory({ enabled: true });
        expect(state().historyEnabled).toBe(true);
        expect(state().historyLoaded).toBe(false);
        const second = state().hydrateHistory({ enabled: true });
        await flush();
        expect(restoreHistory).toHaveBeenCalledTimes(1);
        gate.resolve([makeSession('a')]);
        await Promise.all([first, second]);
        expect(state().historyLoaded).toBe(true);
    });

    it('lets an enabled event supersede an older disabled status response', async () => {
        const gate = deferred();
        getHistoryStatus.mockReturnValue(gate.promise);
        restoreHistory.mockResolvedValue([makeSession('a')]);
        const initial = state().hydrateHistory();
        await flush();
        const adopted = state().hydrateHistory({ enabled: true });
        gate.resolve({ enabled: false });
        await Promise.all([initial, adopted]);
        expect(state().historyEnabled).toBe(true);
        expect(state().sessions.map(s => s.id)).toEqual(['a']);
    });

    it('adopts encrypted history and saves local messages missing from its source', async () => {
        const local = makeSession('a', [msg('old'), msg('unsaved')]);
        useChatStore.setState({ ...BASE_STATE, sessions: [local], messages: local.messages, currentSessionId: 'a' });
        restoreHistory.mockResolvedValue([makeSession('a', [msg('old')]), makeSession('remote', [msg('remote')])]);
        await state().hydrateHistory({ enabled: true });
        expect(state().sessions.map(s => s.id)).toEqual(['a', 'remote']);
        expect(state().messages.map(m => m.content)).toEqual(['old', 'unsaved']);
        expect(sent()).toMatchObject([{ type: 'history.append', sessionId: 'a', message: { content: 'unsaved' } }]);
        expect(state().historyLoaded).toBe(true);
    });

    it('keeps an answer arriving while adoption is pending and writes it once after restore', async () => {
        const gate = deferred();
        const local = makeSession('a', [msg('old')]);
        useChatStore.setState({ ...BASE_STATE, sessions: [local], messages: local.messages, currentSessionId: 'a' });
        restoreHistory.mockReturnValue(gate.promise);
        const hydrating = state().hydrateHistory({ enabled: true });
        await flush();
        state().addMessageToSession('a', msg('pending answer', 'assistant'));
        expect(sendHistoryCommand).not.toHaveBeenCalled();
        gate.resolve([makeSession('a', [msg('old')])]);
        await hydrating;
        expect(sent()).toHaveLength(1);
        expect(state().messages.map(m => m.content)).toEqual(['old', 'pending answer']);
    });

    it('preserves an answer arriving during a refresh without restoring stale remote messages', async () => {
        const old = makeSession('a', [msg('obsolete')]);
        seedEnabled([old]);
        const gate = deferred();
        restoreHistory.mockReturnValue(gate.promise);
        const hydrating = state().hydrateHistory({ enabled: true });
        await flush();
        state().addMessageToSession('a', msg('pending answer', 'assistant'));
        gate.resolve([makeSession('a', [msg('remote replacement')])]);
        await hydrating;
        expect(state().messages.map(m => m.content)).toEqual(['remote replacement', 'pending answer']);
        expect(sent()).toMatchObject([{ type: 'history.append', message: { content: 'pending answer' } }]);
    });

    it('reloads a conflict and preserves the unsaved local append beside remote additions', async () => {
        seedEnabled([makeSession('a', [msg('old')])]);
        getHistoryStatus.mockResolvedValue({ enabled: true });
        restoreHistory.mockResolvedValue([makeSession('a', [msg('old'), msg('remote addition')])]);
        sendHistoryCommand.mockRejectedValueOnce(Object.assign(new Error('History changed in another panel'), { code: 'HISTORY_REVISION_CONFLICT' }));
        state().addMessage(msg('local addition'));
        await vi.waitFor(() => expect(state().messages.map(m => m.content)).toEqual(['old', 'remote addition', 'local addition']));
        expect(sent()).toHaveLength(2);
        expect(state().historyWriteError).toMatch(/another panel/);
    });

    it('restores sessions and the current session messages without emitting commands', async () => {
        const restored = [makeSession('a', [msg('old')]), makeSession('b', [msg('b1'), msg('b2', 'assistant')])];
        useChatStore.setState({ ...BASE_STATE, currentSessionId: 'b', historyEnabled: true });
        sendHistoryCommand.mockClear();
        getHistoryStatus.mockResolvedValue({ enabled: true, phase: 'complete' });
        restoreHistory.mockResolvedValue(restored);

        const status = await state().hydrateHistory();
        expect(status).toEqual({ enabled: true, phase: 'complete' });
        expect(state().sessions).toBe(restored);
        expect(state().messages).toBe(restored[1].messages);
        expect(state().historyEnabled).toBe(true);
        expect(state().historyLoaded).toBe(true);
        expect(state().historyWriteError).toBeNull();
        await flush();
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('does not emit commands even if the previous state already had history enabled and stale sessions', async () => {
        useChatStore.setState({ ...BASE_STATE, historyEnabled: true, sessions: [makeSession('stale')], currentSessionId: 'a' });
        sendHistoryCommand.mockClear();
        getHistoryStatus.mockResolvedValue({ enabled: true });
        restoreHistory.mockResolvedValue([makeSession('a', [msg('x')])]);
        await state().hydrateHistory();
        expect(state().sessions.map(s => s.id)).toEqual(['a']);
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('uses an empty message list when the current session is not in the repository', async () => {
        useChatStore.setState({ ...BASE_STATE, currentSessionId: 'missing', messages: [msg('stale')] });
        getHistoryStatus.mockResolvedValue({ enabled: true });
        restoreHistory.mockResolvedValue([makeSession('a', [msg('x')])]);
        await state().hydrateHistory();
        expect(state().messages).toEqual([]);
        expect(state().historyEnabled).toBe(true);
    });

    it('sync works again after hydrating', async () => {
        useChatStore.setState({ ...BASE_STATE, currentSessionId: 'a' });
        getHistoryStatus.mockResolvedValue({ enabled: true });
        restoreHistory.mockResolvedValue([makeSession('a')]);
        await state().hydrateHistory();
        state().addMessage(msg('after'));
        expect(summarize(sent())).toEqual(['history.append:a']);
    });

    it('drops a stale historyEnabled flag when the status says disabled, without restoring', async () => {
        useChatStore.setState({ ...BASE_STATE, historyEnabled: true, historyWriteError: 'old' });
        getHistoryStatus.mockResolvedValue({ enabled: false, phase: 'disabled' });
        const status = await state().hydrateHistory();
        expect(status).toEqual({ enabled: false, phase: 'disabled' });
        expect(state().historyEnabled).toBe(false);
        expect(state().historyLoaded).toBe(true);
        expect(state().historyWriteError).toBeNull();
        expect(restoreHistory).not.toHaveBeenCalled();
        expect(useChatStore.persist.getOptions().partialize(state())).toHaveProperty('sessions');
    });

    it('treats a missing status as disabled', async () => {
        useChatStore.setState({ ...BASE_STATE, historyEnabled: true });
        getHistoryStatus.mockResolvedValue(undefined);
        await state().hydrateHistory();
        expect(state().historyEnabled).toBe(false);
        expect(state().historyLoaded).toBe(true);
    });

    it('keeps the flag, leaves history unloaded and sets historyWriteError when restore fails', async () => {
        useChatStore.setState({ ...BASE_STATE, historyEnabled: true, currentSessionId: 'a' });
        sendHistoryCommand.mockClear();
        getHistoryStatus.mockResolvedValue({ enabled: true });
        restoreHistory.mockRejectedValue(new Error('History key is missing'));
        await expect(state().hydrateHistory()).resolves.toBeNull();
        expect(state().historyWriteError).toBe('History key is missing');
        expect(state().historyEnabled).toBe(true);
        expect(state().historyLoaded).toBe(false);
        expect(state().sessions).toEqual([]);
        expect(sendHistoryCommand).not.toHaveBeenCalled();
        // The empty in-memory list must not be saved into the settings blob.
        expect(useChatStore.persist.getOptions().partialize(state())).not.toHaveProperty('sessions');
    });

    it('sets historyWriteError when the status request itself fails', async () => {
        useChatStore.setState({ ...BASE_STATE, historyEnabled: true });
        getHistoryStatus.mockRejectedValue(new Error('status down'));
        await expect(state().hydrateHistory()).resolves.toBeNull();
        expect(state().historyWriteError).toBe('status down');
        expect(restoreHistory).not.toHaveBeenCalled();
    });

    it('stringifies a non-Error failure', async () => {
        getHistoryStatus.mockResolvedValue({ enabled: true });
        restoreHistory.mockRejectedValue('plain failure');
        await state().hydrateHistory();
        expect(state().historyWriteError).toBe('plain failure');
    });
});

describe('enableHistoryEncryption', () => {
    const legacySessions = () => [makeSession('s1', [msg('legacy one')], { title: 'Chat 1', updatedAt: 3 }), makeSession('s2', [msg('legacy two')], { title: 'Chat 2', updatedAt: 4 })];
    const seedLegacy = () => {
        const sessions = legacySessions();
        useChatStore.setState({ ...BASE_STATE, sessions, currentSessionId: 's1', messages: sessions[0].messages });
        chrome.storage.local.set.mockClear();
        sendHistoryCommand.mockClear();
        events.length = 0;
        return sessions;
    };
    const readBlob = () => new Promise(resolve => chrome.storage.local.get([STORAGE_NAME], result => resolve(result[STORAGE_NAME] && JSON.parse(result[STORAGE_NAME]).state)));
    let originalSet;
    let events;
    beforeEach(() => {
        events = [];
        originalSet = chrome.storage.local.set.getMockImplementation();
        chrome.storage.local.set.mockImplementation((items, callback) => {
            if (STORAGE_NAME in items) {
                const written = JSON.parse(items[STORAGE_NAME]).state;
                events.push('sessions' in written ? 'storage:with-sessions' : 'storage:without-sessions');
            }
            return originalSet(items, callback);
        });
    });
    afterEach(() => {
        chrome.storage.local.set.mockImplementation(originalSet);
    });

    it('does not let an older initial disabled status revert its own successful activation', async () => {
        seedLegacy();
        const gate = deferred();
        getHistoryStatus.mockReturnValueOnce(gate.promise);
        const initial = state().hydrateHistory();
        await flush();
        await state().enableHistoryEncryption();
        expect(state().historyEnabled).toBe(true);
        gate.resolve({ enabled: false, phase: 'disabled' });
        await initial;
        expect(state().historyEnabled).toBe(true);
        expect(state().historyLoaded).toBe(true);
        expect(await readBlob()).not.toHaveProperty('sessions');
        expect(restoreHistory).not.toHaveBeenCalled();
        state().addMessageToSession('s1', msg('after activation'));
        expect(sent().at(-1)).toMatchObject({ type: 'history.append', message: { content: 'after activation' } });
    });

    it('waits for saved settings before flushing the migration source', async () => {
        const savedSessions = legacySessions();
        const options = useChatStore.persist.getOptions();
        const originalGetItem = options.storage.getItem;
        const gate = deferred();
        options.storage.getItem = () => gate.promise;
        const rehydrating = useChatStore.persist.rehydrate();
        let blobAtPrepare;
        prepareHistory.mockImplementation(async () => { blobAtPrepare = await readBlob(); return {}; });
        const enabling = state().enableHistoryEncryption();
        try {
            await flush();
            expect(prepareHistory).not.toHaveBeenCalled();
            gate.resolve({ state: { historyEnabled: false, sessions: savedSessions, messages: savedSessions[0].messages, currentSessionId: 's1' }, version: options.version });
            await rehydrating;
            await enabling;
            expect(blobAtPrepare.sessions.map(session => session.id)).toEqual(['s1', 's2']);
        } finally {
            gate.resolve({ state: {}, version: options.version });
            await rehydrating;
            await enabling;
            options.storage.getItem = originalGetItem;
        }
    });

    it('saves the blob with sessions, prepares, then activates, and writes the sessions-less blob only afterwards', async () => {
        seedLegacy();
        const gate = deferred();
        let blobAtPrepare;
        let blobAtActivate;
        prepareHistory.mockImplementation(async () => { events.push('prepare'); blobAtPrepare = await readBlob(); return { phase: 'preparing' }; });
        activateHistory.mockImplementation(async () => { events.push('activate:start'); blobAtActivate = await readBlob(); await gate.promise; events.push('activate:end'); return { enabled: true }; });

        const enabling = state().enableHistoryEncryption();
        await vi.waitFor(() => expect(events).toContain('activate:start'));

        // The migration source still holds the sessions at both calls.
        expect(blobAtPrepare.sessions.map(s => s.id)).toEqual(['s1', 's2']);
        expect(blobAtActivate.sessions.map(s => s.id)).toEqual(['s1', 's2']);
        expect(blobAtActivate.historyEnabled).toBe(false);

        // Settings changes made inside the window are held, not written.
        state().setModel('changed-in-window');
        await flush();
        expect(events).not.toContain('storage:without-sessions');
        expect(state().historyEnabled).toBe(true);

        gate.resolve();
        await expect(enabling).resolves.toEqual({ enabled: true });

        expect(events).toEqual(['storage:with-sessions', 'prepare', 'activate:start', 'activate:end', 'storage:without-sessions']);
        const final = await readBlob();
        expect(final).not.toHaveProperty('sessions');
        expect(final).not.toHaveProperty('messages');
        expect(final.historyEnabled).toBe(true);
        expect(final.model).toBe('changed-in-window');
        // Held writes are coalesced into one.
        expect(events.filter(e => e === 'storage:without-sessions')).toHaveLength(1);
    });

    it('flushes the newest state (including a message just added) before preparing', async () => {
        seedLegacy();
        state().addMessageToSession('s1', msg('latest'));
        let blobAtPrepare;
        prepareHistory.mockImplementation(async () => { blobAtPrepare = await readBlob(); return {}; });
        await state().enableHistoryEncryption();
        expect(blobAtPrepare.sessions.find(s => s.id === 's1').messages.map(m => m.content)).toEqual(['legacy one', 'latest']);
    });

    it('does not call activate when prepare fails and leaves history disabled and writes unheld', async () => {
        seedLegacy();
        prepareHistory.mockRejectedValue(new Error('prepare failed'));
        await expect(state().enableHistoryEncryption()).rejects.toThrow('prepare failed');
        expect(activateHistory).not.toHaveBeenCalled();
        expect(state().historyEnabled).toBe(false);
        chrome.storage.local.set.mockClear();
        state().setModel('after');
        expect(blobWrites().at(-1)).toMatchObject({ model: 'after' });
    });

    it('adopts an independently enabled repository when prepare loses its response', async () => {
        seedLegacy();
        prepareHistory.mockRejectedValue(new Error('response lost'));
        getHistoryStatus.mockResolvedValue({ enabled: true });
        restoreHistory.mockResolvedValue(legacySessions());
        await expect(state().enableHistoryEncryption()).rejects.toThrow('response lost');
        expect(state().historyEnabled).toBe(true);
        expect(state().historyLoaded).toBe(true);
        expect(await readBlob()).not.toHaveProperty('sessions');
    });

    it('keeps the migration source and blocks after prepare fails with unknown status', async () => {
        seedLegacy();
        prepareHistory.mockRejectedValue(new Error('prepare interrupted'));
        getHistoryStatus.mockRejectedValue(new Error('status unavailable'));
        await expect(state().enableHistoryEncryption()).rejects.toThrow('prepare interrupted');
        expect(state().historyLoaded).toBe(false);
        expect(state().historyWriteError).toBe('status unavailable');
        expect((await readBlob()).sessions).toHaveLength(2);
    });

    it('reverts historyEnabled and still releases held writes when activate rejects', async () => {
        seedLegacy();
        activateHistory.mockImplementation(async () => {
            state().setModel('during-failure');
            throw new Error('activation failed');
        });
        await expect(state().enableHistoryEncryption()).rejects.toThrow('activation failed');
        expect(state().historyEnabled).toBe(false);

        // The released write contains the sessions again because history is back in the blob.
        const final = await readBlob();
        expect(final.historyEnabled).toBe(false);
        expect(final.model).toBe('during-failure');
        expect(final.sessions.map(s => s.id)).toEqual(['s1', 's2']);

        // Writes are no longer held.
        chrome.storage.local.set.mockClear();
        state().setModel('direct');
        expect(blobWrites().at(-1)).toMatchObject({ model: 'direct' });
        // Session changes are not sent while disabled.
        state().addMessageToSession('s1', msg('after failure'));
        expect(sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('keeps encrypted writes enabled when activation committed before its response failed', async () => {
        seedLegacy();
        activateHistory.mockRejectedValue(new Error('response lost'));
        getHistoryStatus.mockResolvedValue({ enabled: true });
        await expect(state().enableHistoryEncryption()).rejects.toThrow('response lost');
        expect(state().historyEnabled).toBe(true);
        expect(await readBlob()).not.toHaveProperty('sessions');
        state().addMessageToSession('s1', msg('after response loss'));
        expect(sent()).toMatchObject([{ type: 'history.append', message: { content: 'after response loss' } }]);
    });

    it('blocks writes rather than reverting to plaintext when activation status cannot be read', async () => {
        seedLegacy();
        activateHistory.mockRejectedValue(new Error('response lost'));
        getHistoryStatus.mockRejectedValue(new Error('status unavailable'));
        await expect(state().enableHistoryEncryption()).rejects.toThrow('response lost');
        expect(state().historyEnabled).toBe(true);
        expect(state().historyLoaded).toBe(false);
        expect(state().historyWriteError).toContain('status unavailable');
        expect(await readBlob()).not.toHaveProperty('sessions');
    });

    it('sends no commands for the legacy sessions while enabling', async () => {
        seedLegacy();
        await state().enableHistoryEncryption();
        await flush();
        expect(sendHistoryCommand).not.toHaveBeenCalled();
        expect(state().historyEnabled).toBe(true);
        expect(state().historyLoaded).toBe(true);
    });

    it('guards the legacy tail immediately after enabling without a full restore', async () => {
        seedLegacy();
        await state().enableHistoryEncryption();
        state().addMessageToSession('s1', msg('new answer', 'assistant'));
        expect(sent()[0]).toMatchObject({ expectedMessageCount: 1, expectedLastMessageId: 'legacy:0' });
        expect(restoreHistory).not.toHaveBeenCalled();
    });

    it('sends commands only for changes made after enabling, not for legacy-only sessions', async () => {
        seedLegacy();
        await state().enableHistoryEncryption();
        state().addMessageToSession('s2', msg('new answer', 'assistant'));
        const commands = sent();
        expect(summarize(commands)).toEqual(['history.append:s2']);
        expect(commands[0].message.content).toBe('new answer');
        expect(commands[0].session).toEqual({ id: 's2', title: 'Chat 2', model: 'm0', updatedAt: state().sessions[1].updatedAt });
        expect(JSON.stringify(commands)).not.toContain('legacy one');
        expect(JSON.stringify(commands)).not.toContain('legacy two');
    });

    it('a session change made while activation is pending reaches the service after the activate request', async () => {
        seedLegacy();
        const gate = deferred();
        activateHistory.mockImplementation(async () => { events.push('activate:start'); await gate.promise; return {}; });
        sendHistoryCommand.mockImplementation(async command => { events.push(`command:${command.type}`); return { ok: true }; });
        const enabling = state().enableHistoryEncryption();
        await vi.waitFor(() => expect(events).toContain('activate:start'));
        state().addMessageToSession('s1', msg('streamed during activation', 'assistant'));
        gate.resolve();
        await enabling;
        const order = events.filter(e => e === 'activate:start' || e.startsWith('command:'));
        expect(order).toEqual(['activate:start', 'command:history.append']);
    });

    it('a second enable after a failed one works', async () => {
        seedLegacy();
        activateHistory.mockRejectedValueOnce(new Error('first failure'));
        await expect(state().enableHistoryEncryption()).rejects.toThrow('first failure');
        await expect(state().enableHistoryEncryption()).resolves.toEqual({ phase: 'migrating', enabled: true });
        expect(state().historyEnabled).toBe(true);
        const final = await readBlob();
        expect(final).not.toHaveProperty('sessions');
    });
});


describe('targeted remote refresh', () => {
    it('reads only the changed conversation and keeps an unrelated composer ready', async () => {
        const a = makeSession('a', [msg('selected')]);
        seedEnabled([a, makeSession('b')], 'a');
        const gate = deferred();
        restoreHistorySession.mockReturnValue(gate.promise);
        const refreshing = state().refreshHistorySession('b');
        await flush();
        expect(state().historyLoaded).toBe(true);
        expect(state().messages).toBe(a.messages);
        expect(restoreHistory).not.toHaveBeenCalled();
        gate.resolve(makeSession('b', [msg('remote')]));
        await refreshing;
        expect(state().sessions[0]).toBe(a);
        expect(state().sessions[1].messages[0].content).toBe('remote');
        expect(state().messages).toBe(a.messages);
    });

    it('reads again if a local append was saved while the remote read was pending', async () => {
        seedEnabled([makeSession('a', [msg('old')])]);
        const gate = deferred();
        restoreHistorySession.mockReturnValueOnce(gate.promise).mockResolvedValue(makeSession('a', [msg('old'), msg('remote'), msg('local')]));
        const refreshing = state().refreshHistorySession('a');
        await flush();
        state().addMessage(msg('local'));
        gate.resolve(makeSession('a', [msg('old'), msg('remote')]));
        await refreshing;
        expect(state().messages.map(m => m.content)).toEqual(['old', 'remote', 'local']);
        expect(restoreHistorySession).toHaveBeenCalledTimes(2);
    });

    it('keeps an edit made during a background read and saves truncate before replacement', async () => {
        seedEnabled([makeSession('a', [msg('old question'), msg('old answer', 'assistant')])]);
        const gate = deferred();
        restoreHistorySession.mockReturnValueOnce(gate.promise).mockResolvedValue(makeSession('a', [msg('edited question')]));
        const refreshing = state().refreshHistorySession('a');
        await flush();
        state().truncateAtMessage('a', 0);
        state().addMessage(msg('edited question'));
        gate.resolve(makeSession('a', [msg('old question'), msg('old answer', 'assistant')]));
        await refreshing;
        expect(state().messages.map(m => m.content)).toEqual(['edited question']);
        expect(sent().map(command => command.type)).toEqual(['history.truncate', 'history.append']);
        expect(restoreHistorySession).toHaveBeenCalledTimes(2);
        expect(state().historyLoaded).toBe(true);
    });

    it('keeps unsaved local content and its failure visible through a scoped refresh', async () => {
        seedEnabled([makeSession('a', [msg('old')])]);
        sendHistoryCommand.mockRejectedValueOnce(new Error('worker offline'));
        state().addMessage(msg('unsaved'));
        await flush();
        restoreHistorySession.mockResolvedValue(makeSession('a', [msg('old'), msg('remote')]));
        await state().refreshHistorySession('a');
        expect(state().messages.map(m => m.content)).toEqual(['old', 'remote', 'unsaved']);
        expect(state().historyWriteError).toBe('worker offline');
        expect(state().historyFailedCommands).toHaveLength(1);
    });
});
