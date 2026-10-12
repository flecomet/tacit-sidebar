import { describe, it, expect, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { diffSessions, startHistorySync, withoutHistorySync } from './historySync';

const msg = (content, role = 'user') => ({ role, content });
const session = (id, messages = [], extra = {}) => ({ id, title: 'New Chat', model: 'm', updatedAt: 1, messages, ...extra });

describe('diffSessions', () => {
    it('guards appends and truncation against a different remote tail', () => {
        const first = msg('first');
        const last = msg('last');
        Object.defineProperty(first, 'historyRecordId', { value: 'record-first' });
        Object.defineProperty(last, 'historyRecordId', { value: 'record-last' });
        const old = session('a', [first, last]);
        const commands = diffSessions([old], [{ ...old, messages: [first, msg('replacement')] }]);
        expect(commands[0]).toMatchObject({ type: 'history.truncate', expectedMessageCount: 2, expectedLastMessageId: 'record-last' });
        expect(commands[1]).toMatchObject({ type: 'history.append', expectedMessageCount: 1, expectedLastMessageId: 'record-first' });
    });

    it('creates a session that did not exist before, with its full content', () => {
        const created = session('a', [msg('hi')]);
        expect(diffSessions([], [created])).toEqual([{ type: 'history.create', sessionId: 'a', session: created }]);
    });

    it('emits one append per added message, each with the session summary and no messages', () => {
        const first = msg('one');
        const prev = [session('a', [first])];
        const second = msg('two', 'assistant');
        const third = msg('three');
        const next = [{ ...prev[0], title: 'T', model: 'm2', updatedAt: 5, messages: [first, second, third] }];
        const summary = { id: 'a', title: 'T', model: 'm2', updatedAt: 5 };
        expect(diffSessions(prev, next)).toEqual([
            { type: 'history.append', sessionId: 'a', message: second, updatedAt: 5, session: summary, expectedMessageCount: 1 },
            { type: 'history.append', sessionId: 'a', message: third, updatedAt: 5, session: summary, expectedMessageCount: 2 },
        ]);
    });

    it('emits a delete for a removed session', () => {
        expect(diffSessions([session('a'), session('b')], [session('b')])).toEqual([{ type: 'history.delete', sessionId: 'a' }]);
    });

    it('emits a truncate to the first differing index', () => {
        const [m0, m1, m2] = [msg('0'), msg('1'), msg('2')];
        const prev = [session('a', [m0, m1, m2])];
        const next = [{ ...prev[0], updatedAt: 9, messages: [m0] }];
        expect(diffSessions(prev, next)).toEqual([{ type: 'history.truncate', sessionId: 'a', messageIndex: 1, updatedAt: 9, expectedMessageCount: 3 }]);
    });

    it('emits truncate at index 0 when the session is cleared', () => {
        const prev = [session('a', [msg('0')])];
        expect(diffSessions(prev, [{ ...prev[0], messages: [] }])).toEqual([
            { type: 'history.truncate', sessionId: 'a', messageIndex: 0, updatedAt: 1, expectedMessageCount: 1 },
        ]);
    });

    it('emits truncate then append when a message is replaced in one change', () => {
        const [m0, m1] = [msg('0'), msg('1')];
        const replacement = msg('1 edited');
        const prev = [session('a', [m0, m1])];
        const next = [{ ...prev[0], updatedAt: 7, messages: [m0, replacement] }];
        const commands = diffSessions(prev, next);
        expect(commands.map(c => c.type)).toEqual(['history.truncate', 'history.append']);
        expect(commands[0]).toMatchObject({ messageIndex: 1, updatedAt: 7 });
        expect(commands[1].message).toBe(replacement);
    });

    it('treats structurally equal but distinct message objects as changed (reference comparison)', () => {
        const prev = [session('a', [msg('same')])];
        const next = [{ ...prev[0], messages: [msg('same')] }];
        expect(diffSessions(prev, next).map(c => c.type)).toEqual(['history.truncate', 'history.append']);
    });

    it('emits nothing for unchanged references', () => {
        const prev = [session('a', [msg('x')]), session('b')];
        expect(diffSessions(prev, [...prev])).toEqual([]);
    });

    it('emits nothing when only settings of the session change but the messages array is shared', () => {
        const prev = [session('a', [msg('x')])];
        const next = [{ ...prev[0], title: 'renamed', updatedAt: 99 }];
        expect(diffSessions(prev, next)).toEqual([]);
    });

    it('combines create, append and delete across sessions in a deterministic order', () => {
        const m0 = msg('0');
        const prev = [session('a', [m0]), session('gone')];
        const next = [{ ...prev[0], messages: [m0, msg('1')] }, session('new')];
        expect(diffSessions(prev, next).map(c => `${c.type}:${c.sessionId}`)).toEqual([
            'history.append:a', 'history.create:new', 'history.delete:gone',
        ]);
    });
});

describe('startHistorySync', () => {
    const setup = (initial = {}, send) => {
        const store = createStore(() => ({ historyEnabled: true, sessions: [], other: 0, ...initial }));
        const sendFn = send || vi.fn(() => Promise.resolve({ ok: true }));
        const onError = vi.fn();
        let n = 0;
        const unsubscribe = startHistorySync({ store, send: sendFn, createId: () => `id-${++n}`, onError });
        return { store, send: sendFn, onError, unsubscribe };
    };
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    it('sends commands carrying a unique commandId, in order', () => {
        const { store, send } = setup();
        const a = session('a', [msg('0')]);
        store.setState({ sessions: [a] });
        store.setState({ sessions: [{ ...a, messages: [...a.messages, msg('1'), msg('2')] }, session('b')] });
        const sent = send.mock.calls.map(([command]) => command);
        expect(sent.map(c => `${c.type}:${c.sessionId}`)).toEqual([
            'history.create:a', 'history.append:a', 'history.append:a', 'history.create:b',
        ]);
        const ids = sent.map(c => c.commandId);
        expect(ids).toEqual(['id-1', 'id-2', 'id-3', 'id-4']);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('carries the generated record id into the next optimistic append guard', () => {
        const { store, send } = setup();
        const a = session('a');
        store.setState({ sessions: [a] });
        const first = msg('first');
        store.setState({ sessions: [{ ...a, messages: [first, msg('second')] }] });
        expect(send.mock.calls[1][0]).toMatchObject({ expectedMessageCount: 0, expectedLastMessageId: null });
        expect(send.mock.calls[2][0]).toMatchObject({ expectedMessageCount: 1, expectedLastMessageId: 'id-2' });
        expect(JSON.stringify(first)).toBe('{"role":"user","content":"first"}');
    });

    it('does not send when sessions did not change', () => {
        const { store, send } = setup();
        store.setState({ other: 1 });
        expect(send).not.toHaveBeenCalled();
    });

    it('does not send when historyEnabled is false', () => {
        const { store, send } = setup({ historyEnabled: false });
        store.setState({ sessions: [session('a')] });
        expect(send).not.toHaveBeenCalled();
    });

    it('does not send on the change that flips historyEnabled on (previous state was disabled)', () => {
        const { store, send } = setup({ historyEnabled: false });
        store.setState({ historyEnabled: true, sessions: [session('a')] });
        expect(send).not.toHaveBeenCalled();
        store.setState({ sessions: [session('a'), session('b')] });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toMatchObject({ type: 'history.create', sessionId: 'b' });
    });

    it('does not send while withoutHistorySync is active, and sends again afterwards', () => {
        const { store, send } = setup();
        const result = withoutHistorySync(() => {
            store.setState({ sessions: [session('a')] });
            return 'value';
        });
        expect(result).toBe('value');
        expect(send).not.toHaveBeenCalled();
        store.setState({ sessions: [session('a'), session('b')] });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toMatchObject({ type: 'history.create', sessionId: 'b' });
    });

    it('re-enables sync after the task throws', () => {
        const { store, send } = setup();
        expect(() => withoutHistorySync(() => { throw new Error('boom'); })).toThrow('boom');
        store.setState({ sessions: [session('a')] });
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('keeps sync suspended across nested withoutHistorySync calls', () => {
        const { store, send } = setup();
        withoutHistorySync(() => {
            withoutHistorySync(() => {});
            store.setState({ sessions: [session('a')] });
        });
        expect(send).not.toHaveBeenCalled();
    });

    it('calls onError with the message when send rejects', async () => {
        const { store, onError } = setup({}, vi.fn(() => Promise.reject(new Error('worker down'))));
        store.setState({ sessions: [session('a')] });
        await flush();
        expect(onError).toHaveBeenCalledWith('worker down');
    });

    it('calls onError with a stringified non-Error rejection', async () => {
        const { store, onError } = setup({}, vi.fn(() => Promise.reject('plain')));
        store.setState({ sessions: [session('a')] });
        await flush();
        expect(onError).toHaveBeenCalledWith('plain');
    });

    it('calls onError with the message of an {error} response', async () => {
        const { store, onError } = setup({}, vi.fn(() => Promise.resolve({ error: 'HISTORY_NOT_FOUND', message: 'gone' })));
        store.setState({ sessions: [session('a')] });
        await flush();
        expect(onError).toHaveBeenCalledWith('gone');
    });

    it('falls back to the error code when an {error} response has no message', async () => {
        const { store, onError } = setup({}, vi.fn(() => Promise.resolve({ error: 'HISTORY_ERROR' })));
        store.setState({ sessions: [session('a')] });
        await flush();
        expect(onError).toHaveBeenCalledWith('HISTORY_ERROR');
    });

    it('does not call onError for successful responses', async () => {
        const { store, onError } = setup();
        store.setState({ sessions: [session('a')] });
        await flush();
        expect(onError).not.toHaveBeenCalled();
    });
});
