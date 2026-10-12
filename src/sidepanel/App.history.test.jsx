import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import App from './App';
import { useChatStore } from '../store/useChatStore';
import { fetchModels } from '../services/modelService';
import { emptyKeys, emptyActive } from '../store/apiKeys';
import * as historyClient from '../services/historyClient';

vi.mock('../utils/fileProcessor', () => ({ processFile: vi.fn() }));
vi.mock('../utils/pageScraper', () => ({ scrapePage: vi.fn() }));
vi.mock('../utils/encryption', () => ({
    encryptData: vi.fn(key => Promise.resolve(`encrypted-${key}`)),
    decryptData: vi.fn(key => Promise.resolve(key.replace('encrypted-', ''))),
}));
vi.mock('../services/modelService', () => ({
    fetchModels: vi.fn().mockResolvedValue([]),
    getModelCategory: vi.fn(m => m._category || 'General'),
}));
vi.mock('../services/chatService', () => ({
    chatService: { sendMessage: vi.fn().mockResolvedValue({ content: 'ok', usage: {} }) },
}));
vi.mock('../services/historyClient', () => ({
    getHistoryStatus: vi.fn(),
    subscribeHistoryStatus: vi.fn(),
    subscribeHistoryChanges: vi.fn(),
    reportHistoryInteraction: vi.fn(),
    resumeHistory: vi.fn(),
    pauseHistory: vi.fn(),
    restoreHistory: vi.fn(),
    restoreHistorySession: vi.fn(),
    prepareHistory: vi.fn(),
    activateHistory: vi.fn(),
    sendHistoryCommand: vi.fn(),
}));

const original = (() => {
    const { hydrateHistory, enableHistoryEncryption, ensureActiveSession } = useChatStore.getState();
    return { hydrateHistory, enableHistoryEncryption, ensureActiveSession };
})();

const status = (phase, progress = 0) => ({ phase, progress, enabled: phase !== 'disabled', lastError: null });
const session = (id, title = id) => ({ id, title, messages: [], model: 'm', updatedAt: 1 });
const PLACEHOLDER = 'Ask... (type / for prompts)';
const input = () => screen.getByPlaceholderText(PLACEHOLDER);
// The textarea itself stays editable in ChatInput; `disabled` blocks sending (Send button and Enter) and attachments.
const typeDraft = () => fireEvent.change(input(), { target: { value: 'hello' } });
const sendDisabled = () => screen.getByRole('button', { name: 'Send' }).disabled;
const deferred = () => {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

let listeners;
let changeListeners;
let current;
const publish = async (next) => {
    act(() => { listeners.forEach(listener => listener(next)); });
    // The hook applies the newest event after a 250 ms visual interval.
    await act(async () => { await new Promise(r => setTimeout(r, 270)); });
};

beforeEach(() => {
    vi.clearAllMocks();
    listeners = [];
    changeListeners = [];
    historyClient.subscribeHistoryChanges.mockImplementation(listener => {
        changeListeners.push(listener);
        return () => { changeListeners = changeListeners.filter(l => l !== listener); };
    });
    current = status('disabled');
    vi.mocked(fetchModels).mockResolvedValue([]);
    historyClient.getHistoryStatus.mockImplementation(() => Promise.resolve(current));
    historyClient.subscribeHistoryStatus.mockImplementation((listener) => {
        listeners.push(listener);
        return () => { listeners = listeners.filter(l => l !== listener); };
    });
    historyClient.restoreHistory.mockResolvedValue([]);
    historyClient.sendHistoryCommand.mockResolvedValue({ ok: true });
    useChatStore.setState({
        ...original,
        apiKeys: emptyKeys(),
        activeKeyId: emptyActive(),
        activeCloudProvider: 'openrouter',
        providerMode: 'cloud',
        messages: [],
        sessions: [],
        currentSessionId: null,
        historyEnabled: false,
        historyLoaded: false,
        historyWriteError: null,
        historyNeedsReconcile: false,
    historyRecoverySessions: [],
    historyFailedCommands: [],
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const settled = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

describe('App history encryption: disabled', () => {
    it('shows no header indicator and offers to enable encryption in settings', async () => {
        render(<App />);
        await settled();
        expect(screen.queryByRole('progressbar')).toBeNull();
        // The only header buttons are the sidebar, new chat and settings ones.
        expect(screen.queryByRole('button', { name: /history encryption/i })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(screen.getByRole('button', { name: 'Enable history encryption' })).toBeTruthy();
    });

    it('calls the store action when the enable button is clicked and reports its failure', async () => {
        const enable = vi.fn().mockRejectedValue(new Error('Background unavailable'));
        useChatStore.setState({ enableHistoryEncryption: enable });
        render(<App />);
        await settled();
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        fireEvent.click(screen.getByRole('button', { name: 'Enable history encryption' }));
        expect(enable).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Background unavailable'));
        // The failure leaves the button usable and nothing claims encryption.
        expect(screen.getByRole('button', { name: 'Enable history encryption' }).disabled).toBe(false);
        expect(document.querySelector('.lucide-shield-check')).toBeNull();
    });

    it('disables the enable button while the action is pending', async () => {
        const pending = deferred();
        useChatStore.setState({ enableHistoryEncryption: vi.fn(() => pending.promise) });
        render(<App />);
        await settled();
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        fireEvent.click(screen.getByRole('button', { name: 'Enable history encryption' }));
        expect(screen.getByRole('button', { name: 'Starting…' }).disabled).toBe(true);
        await act(async () => { pending.resolve(); });
        expect(screen.getByRole('button', { name: 'Enable history encryption' }).disabled).toBe(false);
    });
});

describe('App history encryption: indicator', () => {
    it('shows a measurable progressbar before the Settings button and opens settings on click', async () => {
        current = status('migrating', 0.4);
        render(<App />);
        const bar = await screen.findByRole('progressbar');
        expect(bar.getAttribute('aria-valuenow')).toBe('40');
        expect(bar.getAttribute('aria-valuemin')).toBe('0');
        expect(bar.getAttribute('aria-valuemax')).toBe('100');

        const button = screen.getByRole('button', { name: /Encrypting history: 40%/ });
        const settings = screen.getByRole('button', { name: 'Settings' });
        expect(button.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(button.parentElement).toBe(settings.parentElement);

        expect(screen.queryByText('OpenRouter API Keys')).toBeNull();
        fireEvent.click(button);
        expect(screen.getByText('OpenRouter API Keys')).toBeTruthy();
        expect(screen.getByRole('region', { name: 'History encryption' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    });

    it('appears when a status event moves the phase away from disabled', async () => {
        render(<App />);
        await settled();
        expect(screen.queryByRole('progressbar')).toBeNull();
        await publish(status('migrating', 0.2));
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('20');
    });

    it('shows the shield, and no progressbar, only for the complete phase', async () => {
        current = status('migrating', 0.9);
        const { container } = render(<App />);
        await screen.findByRole('progressbar');
        for (const phase of ['preparing', 'migrating', 'finalizing', 'paused', 'error']) {
            await publish({ ...status(phase, 1), lastError: phase === 'error' ? 'Disk full' : null });
            expect(container.querySelector('.lucide-shield-check'), phase).toBeNull();
            expect(screen.getByRole('progressbar'), phase).toBeTruthy();
        }
        await publish(status('complete', 1));
        expect(container.querySelector('.lucide-shield-check')).not.toBeNull();
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.getByRole('button', { name: /current history encrypted/i })).toBeTruthy();
    });

    it('never shows the shield for an error status, and the label carries the error', async () => {
        current = { ...status('error', 1), lastError: 'Quota exceeded' };
        const { container } = render(<App />);
        const bar = await screen.findByRole('progressbar');
        expect(container.querySelector('.lucide-shield-check')).toBeNull();
        expect(Number(bar.getAttribute('aria-valuenow'))).toBeLessThan(100);
        expect(screen.getByRole('button', { name: /History encryption error.*Quota exceeded/ })).toBeTruthy();
    });

    it('shows an error indicator, not a disabled state, when the status cannot be read', async () => {
        historyClient.getHistoryStatus.mockRejectedValue(new Error('History unavailable'));
        const { container } = render(<App />);
        await screen.findByRole('progressbar');
        expect(container.querySelector('.lucide-shield-check')).toBeNull();
        expect(screen.getByRole('button', { name: /History unavailable/ })).toBeTruthy();
    });

    it('drops the shield again if a later event reports a non-complete phase', async () => {
        current = status('complete', 1);
        const { container } = render(<App />);
        await waitFor(() => expect(container.querySelector('.lucide-shield-check')).not.toBeNull());
        await publish(status('paused', 0.5));
        expect(container.querySelector('.lucide-shield-check')).toBeNull();
    });
});

describe('App history encryption: loading the encrypted history', () => {
    it('blocks sending and shows a status until hydrateHistory resolves', async () => {
        current = status('complete', 1);
        const restore = deferred();
        historyClient.restoreHistory.mockReturnValue(restore.promise);
        useChatStore.setState({ historyEnabled: true, historyLoaded: false, currentSessionId: 's1' });
        render(<App />);

        await waitFor(() => expect(historyClient.restoreHistory).toHaveBeenCalledTimes(1));
        expect(screen.getByText(/Loading encrypted history/)).toBeTruthy();
        expect(screen.getByRole('status').textContent).toMatch(/Loading encrypted history/);
        typeDraft();
        expect(sendDisabled()).toBe(true);
        fireEvent.keyDown(input(), { key: 'Enter' });
        expect(useChatStore.getState().messages).toEqual([]);

        await act(async () => { restore.resolve([session('s1', 'Restored one')]); });
        await waitFor(() => expect(sendDisabled()).toBe(false));
        expect(screen.queryByText(/Loading encrypted history/)).toBeNull();
        expect(useChatStore.getState().historyLoaded).toBe(true);
    });

    it('shows the error with a Retry button and keeps sending blocked when restoring fails', async () => {
        current = status('complete', 1);
        historyClient.restoreHistory.mockRejectedValueOnce(new Error('History key is missing'));
        useChatStore.setState({ historyEnabled: true, historyLoaded: false, currentSessionId: 's1' });
        render(<App />);

        const retry = await screen.findByRole('button', { name: 'Retry' });
        expect(screen.getByRole('status').textContent).toMatch(/could not be loaded: History key is missing/);
        typeDraft();
        expect(sendDisabled()).toBe(true);

        historyClient.restoreHistory.mockResolvedValueOnce([session('s1')]);
        fireEvent.click(retry);
        await waitFor(() => expect(sendDisabled()).toBe(false));
        expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
        expect(useChatStore.getState().historyWriteError).toBeNull();
    });

    it('does not write a placeholder chat to the repository after a failed restore', async () => {
        current = status('complete', 1);
        historyClient.restoreHistory.mockRejectedValue(new Error('History key is missing'));
        useChatStore.setState({ historyEnabled: true, historyLoaded: false, currentSessionId: 's1' });
        render(<App />);
        await screen.findByRole('button', { name: 'Retry' });
        await settled();
        // Unread conversations exist, so nothing new may be created next to them.
        expect(historyClient.sendHistoryCommand).not.toHaveBeenCalled();
        expect(useChatStore.getState().sessions).toEqual([]);
    });
});

describe('App history encryption: cross-panel activation', () => {
    it('hydrates once when an enabled status arrives while this panel has history off', async () => {
        const hydrate = vi.fn().mockResolvedValue(null);
        useChatStore.setState({ hydrateHistory: hydrate });
        render(<App />);
        await settled();
        expect(hydrate).toHaveBeenCalledTimes(1); // the mount-time call
        expect(useChatStore.getState().historyEnabled).toBe(false);

        await publish(status('migrating', 0.1));
        expect(hydrate).toHaveBeenCalledTimes(2);
    });

    it('does not hydrate again for a disabled status or when history is already enabled', async () => {
        const hydrate = vi.fn().mockResolvedValue(null);
        useChatStore.setState({ hydrateHistory: hydrate, historyEnabled: true, historyLoaded: true });
        render(<App />);
        await settled();
        expect(hydrate).toHaveBeenCalledTimes(1);
        await publish(status('migrating', 0.1));
        expect(hydrate).toHaveBeenCalledTimes(1);

        act(() => useChatStore.setState({ historyEnabled: false }));
        await publish(status('disabled'));
        expect(hydrate).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes its status listeners on unmount', async () => {
        const { unmount } = render(<App />);
        await settled();
        expect(listeners.length).toBeGreaterThanOrEqual(2);
        unmount();
        expect(listeners).toHaveLength(0);
    });
});

describe('App history encryption: interaction reports', () => {
    it('reports typing at most once per second', async () => {
        render(<App />);
        await settled();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(10_000);
        const type = () => { fireEvent.keyDown(input(), { key: 'a' }); };

        type(); type(); type();
        expect(historyClient.reportHistoryInteraction).toHaveBeenCalledTimes(1);

        vi.setSystemTime(10_999);
        type();
        expect(historyClient.reportHistoryInteraction).toHaveBeenCalledTimes(1);

        vi.setSystemTime(11_000);
        type(); type();
        expect(historyClient.reportHistoryInteraction).toHaveBeenCalledTimes(2);
    });

    it('reports key presses made elsewhere in the panel too', async () => {
        render(<App />);
        await settled();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Settings' }), { key: 'Tab' });
        expect(historyClient.reportHistoryInteraction).toHaveBeenCalledTimes(1);
    });
});

describe('App history encryption: initial session', () => {
    it('does not call ensureActiveSession before hydrateHistory settles', async () => {
        current = status('complete', 1);
        const restore = deferred();
        historyClient.restoreHistory.mockReturnValue(restore.promise);
        const ensure = vi.fn();
        useChatStore.setState({ ensureActiveSession: ensure, historyEnabled: true, historyLoaded: false, currentSessionId: 's1' });
        render(<App />);
        await waitFor(() => expect(historyClient.restoreHistory).toHaveBeenCalled());
        await settled();
        expect(ensure).not.toHaveBeenCalled();

        await act(async () => { restore.resolve([session('s1')]); });
        await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
        expect(useChatStore.getState().historyLoaded).toBe(true);
    });

    it('creates no placeholder chat next to restored sessions', async () => {
        current = status('complete', 1);
        historyClient.restoreHistory.mockResolvedValue([session('s1', 'Old A'), session('s2', 'Old B')]);
        useChatStore.setState({ historyEnabled: true, historyLoaded: false, currentSessionId: 's2' });
        render(<App />);
        await waitFor(() => expect(useChatStore.getState().historyLoaded).toBe(true));
        await settled();
        const { sessions, currentSessionId } = useChatStore.getState();
        expect(sessions.map(s => s.title)).toEqual(['Old A', 'Old B']);
        expect(currentSessionId).toBe('s2');
        expect(historyClient.sendHistoryCommand).not.toHaveBeenCalled();
    });

    it('still creates the first chat when history is disabled', async () => {
        render(<App />);
        await waitFor(() => expect(useChatStore.getState().sessions).toHaveLength(1));
        expect(useChatStore.getState().currentSessionId).toBe(useChatStore.getState().sessions[0].id);
    });
});


describe('App history encryption: persistence failures', () => {
    it('keeps write failures visible after history has loaded', async () => {
        current = status('complete', 1);
        render(<App />);
        await waitFor(() => expect(useChatStore.getState().historyLoaded).toBe(true));
        act(() => useChatStore.setState({ historyWriteError: 'Storage quota exceeded' }));
        expect(screen.getByRole('alert').textContent).toMatch(/could not be saved.*Storage quota exceeded/);
        expect(screen.queryByText(/Loading encrypted history/)).toBeNull();
    });

    it('blocks sending immediately when another panel enables encryption', async () => {
        render(<App />);
        await settled();
        const gate = deferred();
        historyClient.restoreHistory.mockReturnValue(gate.promise);
        current = status('migrating', 0.1);
        act(() => listeners.forEach(listener => listener(current)));
        typeDraft();
        expect(sendDisabled()).toBe(true);
        await act(async () => { gate.resolve([]); });
    });
});


it('refreshes repository changes from another panel without resurrecting a removed message', async () => {
    current = status('complete', 1);
    historyClient.restoreHistory.mockResolvedValue([session('a')]);
    render(<App />);
    await waitFor(() => expect(useChatStore.getState().historyLoaded).toBe(true));
    historyClient.restoreHistory.mockResolvedValue([{ ...session('a'), messages: [{ role: 'user', content: 'from another panel' }] }]);
    await act(async () => { changeListeners.forEach(listener => listener()); });
    await waitFor(() => expect(useChatStore.getState().sessions[0].messages[0]?.content).toBe('from another panel'));
});


it('blocks sends until initial status is known even when saved history is disabled', async () => {
    const gate = deferred();
    historyClient.getHistoryStatus.mockReturnValue(gate.promise);
    render(<App />);
    typeDraft();
    expect(sendDisabled()).toBe(true);
    expect(useChatStore.getState().sessions).toEqual([]);
    await act(async () => { gate.resolve(status('disabled')); });
    await waitFor(() => expect(sendDisabled()).toBe(false));
});


it('initializes a writable chat after another panel deletes the selected conversation', async () => {
    current = status('complete', 1);
    useChatStore.setState({ currentSessionId: 'a' });
    historyClient.restoreHistory.mockResolvedValue([{ ...session('a'), messages: [{ role: 'user', content: 'old' }] }]);
    render(<App />);
    await waitFor(() => expect(useChatStore.getState().historyLoaded).toBe(true));
    historyClient.restoreHistory.mockResolvedValue([]);
    await act(async () => { changeListeners.forEach(listener => listener()); });
    await waitFor(() => expect(useChatStore.getState().currentSessionId).not.toBe('a'));
    act(() => useChatStore.getState().addMessage({ role: 'user', content: 'new question' }));
    expect(useChatStore.getState().sessions[0].messages[0].content).toBe('new question');
});


it('keeps sending available while refreshing a different conversation', async () => {
    current = status('complete', 1);
    useChatStore.setState({ currentSessionId: 'a' });
    historyClient.restoreHistory.mockResolvedValue([session('a'), session('b')]);
    render(<App />);
    await waitFor(() => expect(useChatStore.getState().historyLoaded).toBe(true));
    const gate = deferred();
    historyClient.restoreHistorySession.mockReturnValue(gate.promise);
    act(() => { changeListeners.forEach(listener => listener({ sessionId: 'b', commandId: 'remote-command' })); });
    typeDraft();
    expect(sendDisabled()).toBe(false);
    await waitFor(() => expect(historyClient.restoreHistorySession).toHaveBeenCalledWith('b'));
    expect(historyClient.restoreHistory).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(session('b', 'Remote title')); });
});


it('disables chat mutations while encrypted history is being adopted', async () => {
    current = status('complete', 1);
    const gate = deferred();
    const old = { ...session('a'), messages: [{ role: 'user', content: 'existing question' }] };
    useChatStore.setState({ historyEnabled: true, historyLoaded: false, sessions: [old], messages: old.messages, currentSessionId: 'a' });
    historyClient.restoreHistory.mockReturnValue(gate.promise);
    render(<App />);
    expect(screen.getByTitle('New Chat').disabled).toBe(true);
    expect(screen.queryByTitle('Edit message')).toBeNull();
    await act(async () => { gate.resolve([old]); });
});


it('opens normal settings from the encrypted indicator without scrolling and can close them', async () => {
    current = status('complete', 1);
    const scroll = vi.fn();
    const previous = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Current history encrypted' }));
        await settled();
        expect(scroll).not.toHaveBeenCalled();
        expect(screen.getByText('OpenRouter API Keys')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }));
        expect(screen.queryByText('OpenRouter API Keys')).toBeNull();
    } finally {
        if (previous) Element.prototype.scrollIntoView = previous;
        else delete Element.prototype.scrollIntoView;
    }
});
