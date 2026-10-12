import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';
import * as fileProcessor from '../utils/fileProcessor';
import * as pageScraper from '../utils/pageScraper';
import { useChatStore } from '../store/useChatStore';
import { fetchModels, clearModelCache } from '../services/modelService';
import { emptyKeys, emptyActive } from '../store/apiKeys';
import { useDraftStore } from '../store/useDraftStore';

// Mocks
vi.mock('../utils/fileProcessor', () => ({
    processFile: vi.fn()
}));

vi.mock('../utils/pageScraper', () => ({
    scrapePage: vi.fn()
}));

vi.mock('../utils/encryption', () => ({
    encryptData: vi.fn(key => Promise.resolve(`encrypted-${key}`)),
    decryptData: vi.fn(key => Promise.resolve(key.replace('encrypted-', '')))
}));

vi.mock('../services/modelService', () => ({
    fetchModels: vi.fn().mockResolvedValue([]),
    clearModelCache: vi.fn(),
    getModelCategory: vi.fn(m => m._category || 'General')
}));

const PAID = { id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', pricing: { prompt: '0.000002', completion: '0.00001' } };
const FREE = { id: 'meta/llama:free', name: 'Llama Free', pricing: { prompt: '0', completion: '0' } };
const OPENROUTER_KEYS = {
    apiKeys: {
        ...emptyKeys(), openrouter: [
            { id: 'k1', label: 'EU', encryptedKey: 'encrypted-eu-key', baseUrl: 'https://eu.openrouter.ai/api/v1' },
            { id: 'k2', label: 'Global', encryptedKey: 'encrypted-global-key', baseUrl: '' },
        ]
    },
    activeKeyId: { ...emptyActive(), openrouter: 'k1' },
};
const deferred = () => {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
const draftBox = () => screen.getByPlaceholderText('Ask... (type / for prompts)');
const typeDraft = (text) => fireEvent.change(draftBox(), { target: { value: text } });
const sendButton = () => screen.getByRole('button', { name: 'Send' });
const chatCalls = () => global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'));
const attach = async (name) => {
    fileProcessor.processFile.mockResolvedValue({ name, type: 'text', content: 'x' });
    fireEvent.change(screen.getByTitle('Attach file').querySelector('input'), { target: { files: [new File(['x'], name)] } });
    await screen.findByText(name);
};
const MSG = {
    missingKey: 'Add an OpenRouter API key to load available models.',
    loading: 'Loading available models…',
    failed: 'Could not load models allowed by your OpenRouter settings.',
    empty: 'No models available with your current OpenRouter settings.',
    choose: 'Choose a model before sending.',
};

// Mock fetch for OpenRouter
global.fetch = vi.fn();

describe('App Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(fetchModels).mockResolvedValue([]);
        useDraftStore.setState({ draft: '' });

        // Reset store
        useChatStore.setState({
            apiKeys: emptyKeys(),
            activeKeyId: emptyActive(),
            activeCloudProvider: 'openrouter',
            messages: [],
            providerMode: 'cloud'
        });

        // Mock fetch with streaming support for OpenRouter
        global.fetch.mockImplementation(() => {
            // Create a mock SSE stream
            const sseData = 'data: {"choices":[{"delta":{"content":"AI Response"}}]}\n\ndata: {"usage":{"total_tokens":10}}\n\ndata: [DONE]\n';
            const encoder = new TextEncoder();
            const encoded = encoder.encode(sseData);
            let position = 0;

            return Promise.resolve({
                ok: true,
                body: {
                    getReader: () => ({
                        read: () => {
                            if (position < encoded.length) {
                                const chunk = encoded.slice(position);
                                position = encoded.length;
                                return Promise.resolve({ done: false, value: chunk });
                            }
                            return Promise.resolve({ done: true, value: undefined });
                        },
                        cancel: () => Promise.resolve()
                    })
                },
                text: () => Promise.resolve(JSON.stringify({
                    choices: [{ message: { content: 'AI Response' } }]
                })),
                json: async () => ({
                    choices: [{ message: { content: 'AI Response' } }]
                })
            });
        });
    });

    it('should render the header and main components', () => {
        render(<App />);
        // Settings button
        expect(screen.getByRole('button', { name: /settings/i })).toBeDefined(); // Settings icon button
    });

    it.each(['empty', 'failed'])('clears the previous cloud model when local model discovery is %s', async (result) => {
        useChatStore.setState({
            providerMode: 'local',
            model: 'stepfun/step-5-preview',
            availableModels: [{ id: 'stepfun/step-5-preview', name: 'Step 5 Preview' }],
        });
        if (result === 'failed') {
            vi.mocked(fetchModels).mockRejectedValueOnce(new Error('Local server unavailable'));
        }

        render(<App />);
        fireEvent.focus(screen.getByRole('combobox'));

        await waitFor(() => {
            expect(useChatStore.getState().availableModels).toEqual([]);
            expect(useChatStore.getState().model).toBe('');
            expect(screen.getByRole('combobox').value).toBe('');
        });
        expect(screen.getByText('No models found')).toBeDefined();
    });

    it.each(['missing-model', 'local-second'])('selects an available model after discovery with previous selection %s', async (model) => {
        useChatStore.setState({ providerMode: 'local', model, availableModels: [] });
        vi.mocked(fetchModels).mockResolvedValueOnce([
            { id: 'local-first', name: 'First Local Model', _category: 'Local' },
            { id: 'local-second', name: 'Second Local Model', _category: 'Local' },
        ]);

        render(<App />);

        await waitFor(() => expect(screen.getByRole('combobox').value).toBe(
            model === 'local-second' ? 'Second Local Model' : 'First Local Model'
        ));
    });

    it('should show settings modal when clicking settings', async () => {
        render(<App />);
        const settingsBtn = screen.getByRole('button', { name: /settings/i }); // We'll add aria-label to button
        fireEvent.click(settingsBtn);

        expect(screen.getByText('OpenRouter API Keys')).toBeDefined();
    });

    it('should handle sending a message', async () => {
        // OpenRouter sends only with a model from the loaded catalogue.
        useChatStore.setState({ model: PAID.id });
        vi.mocked(fetchModels).mockResolvedValue([PAID]);
        render(<App />);

        // 1. Enter API Key (mocking it being saved or just assuming logic handles it)
        // For test simplicity, we might need to mock useChatStore state?
        // Actually, we are testing integration, so we should interact with UI.

        // Open settings, set key
        const settingsBtn = screen.getByRole('button', { name: /settings/i });
        fireEvent.click(settingsBtn);

        fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'test-key' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
        await waitFor(() => expect(useChatStore.getState().apiKeys.openrouter).toHaveLength(1));
        fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }));

        // 2. Type message
        const input = screen.getByPlaceholderText('Ask... (type / for prompts)');
        fireEvent.change(input, { target: { value: 'Hello' } });

        // 3. Send once the catalogue has loaded
        const sendBtn = screen.getByRole('button', { name: /send/i });
        await waitFor(() => expect(sendBtn.disabled).toBe(false));
        fireEvent.click(sendBtn);

        // 4. Expect loading state
        await waitFor(() => {
            expect(screen.getByText('Thinking...')).toBeDefined();
        });

        // 5. Expect response
        await waitFor(() => {
            expect(screen.getByText('AI Response')).toBeDefined();
        });

        // Verify fetch call
        expect(global.fetch).toHaveBeenCalledWith(
            'https://openrouter.ai/api/v1/chat/completions',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Authorization': 'Bearer test-key'
                })
            })
        );
    });

    it('should handle sending a message in Local Mode without API Key', async () => {
        render(<App />);

        // 1. Open Settings
        const settingsBtn = screen.getByRole('button', { name: /settings/i });
        fireEvent.click(settingsBtn);

        // 2. Switch to Local
        const localBtn = screen.getByText('Local');
        fireEvent.click(localBtn);

        // 3. Verify Local Input appears
        const localInput = screen.getByPlaceholderText('http://localhost:11434/v1');
        fireEvent.change(localInput, { target: { value: 'http://localhost:11434/v1' } }); // explicitly set to ensure state

        // 4. Close Settings (no save button for local)
        const closeBtn = screen.getByLabelText('Close Settings');
        fireEvent.click(closeBtn);

        // 5. Type and Send
        const input = screen.getByPlaceholderText('Ask... (type / for prompts)');
        fireEvent.change(input, { target: { value: 'Hello Local' } });
        const sendBtn = screen.getByRole('button', { name: /send/i });
        fireEvent.click(sendBtn);

        // 6. Verify Fetch
        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                'http://localhost:11434/v1/chat/completions',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.not.objectContaining({
                        'Authorization': expect.stringContaining('Bearer')
                    })
                })
            );
        });
    });
    it('preserves the saved LM Studio connection while settings stay closed after reload', async () => {
        useChatStore.setState({
            providerMode: 'local',
            localBaseUrl: 'http://localhost:1234/v1',
            model: 'lmstudio-model',
            availableModels: [],
        });
        vi.mocked(fetchModels).mockImplementation(async (url) => url === 'http://localhost:1234/v1'
            ? [{ id: 'lmstudio-model', name: 'LM Studio Model', _category: 'Local' }]
            : [{ id: 'cloud-model', name: 'Cloud Model' }]);

        vi.useFakeTimers();
        try {
            render(<App />);
            await act(async () => { await vi.advanceTimersByTimeAsync(600); });

            expect(useChatStore.getState().localBaseUrl).toBe('http://localhost:1234/v1');
            expect(useChatStore.getState().model).toBe('lmstudio-model');
            expect(useChatStore.getState().availableModels.map(m => m.id)).toEqual(['lmstudio-model']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('should update local URL when clicking Quick Setup buttons', async () => {
        render(<App />);

        // 1. Open Settings
        const settingsBtn = screen.getByRole('button', { name: /settings/i });
        fireEvent.click(settingsBtn);

        // 2. Switch to Local
        const localBtn = screen.getByText('Local');
        fireEvent.click(localBtn);

        // 3. Find input
        const localInput = screen.getByPlaceholderText('http://localhost:11434/v1');

        // 4. Find and Click Ollama button
        const ollamaBtn = screen.getByText('Ollama', { selector: 'button' });
        fireEvent.click(ollamaBtn);

        expect(localInput.value).toBe('http://localhost:11434/v1');

        // 5. Find and Click LM Studio button
        const lmStudioBtn = screen.getByText('LM Studio', { selector: 'button' });
        fireEvent.click(lmStudioBtn);

        expect(localInput.value).toBe('http://localhost:1234/v1');
    });



    it('saves an LM Studio preset selected in settings and preserves it after reopening the sidebar', async () => {
        useChatStore.setState({ providerMode: 'local', localBaseUrl: 'http://localhost:11434/v1' });
        vi.useFakeTimers();
        try {
            const { unmount } = render(<App />);
            fireEvent.click(screen.getByRole('button', { name: /settings/i }));
            fireEvent.click(screen.getByRole('button', { name: 'LM Studio' }));
            await act(async () => { await vi.advanceTimersByTimeAsync(600); });
            expect(useChatStore.getState().localBaseUrl).toBe('http://localhost:1234/v1');

            unmount();
            render(<App />);
            await act(async () => { await vi.advanceTimersByTimeAsync(600); });
            expect(useChatStore.getState().localBaseUrl).toBe('http://localhost:1234/v1');
        } finally {
            vi.useRealTimers();
        }
    });

    it('should switch to first available model when switching to local mode if current model is not local', async () => {
        // Setup initial state with Cloud mode and a cloud model
        useChatStore.setState({
            model: 'cloud-model',
            providerMode: 'cloud',
            availableModels: [
                { id: 'cloud-model', name: 'Cloud Model', _category: 'Cloud' }
            ]
        });

        // Mock fetchModels for local mode to return local models
        // Mock fetchModels to return based on provider
        vi.mocked(fetchModels).mockReset();
        vi.mocked(fetchModels).mockImplementation(async (url, provider) => {
            if (provider === 'local') {
                return [{ id: 'local-model', name: 'Local Model', _category: 'Local' }];
            }
            return [{ id: 'cloud-model', name: 'Cloud Model', _category: 'Cloud' }];
        });

        render(<App />);

        // Switch to local mode
        const settingsBtn = screen.getByRole('button', { name: /settings/i });
        fireEvent.click(settingsBtn);

        const localBtn = screen.getByText('Local');
        fireEvent.click(localBtn);

        // Wait for fetch and effect
        await waitFor(() => {
            const currentModel = useChatStore.getState().model;
            expect(currentModel).toBe('local-model');
        });
    });

    it('should handle file drop events', async () => {
        render(<App />);

        // Mock fileProcessor to return a dummy result
        fileProcessor.processFile.mockResolvedValue({ name: 'test.pdf', content: 'PDF Content' });

        // The main container has the drag handlers. 
        // We can find it by looking for the header text "Tacit" and going up to the main container.
        // Or simply fire it on the document body or main div if we can select it efficiently.
        // Since the main div has "bg-[#131314]", we can try to select it, or just use fireEvent on the closest element.
        // Let's target the settings button's parent's parent.

        const settingsBtn = screen.getByRole('button', { name: /settings/i });
        const mainContainer = settingsBtn.closest('div').parentElement;

        // Construct a mock DataTransfer with a File
        const file = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
        const dataTransfer = {
            files: [file],
            types: ['Files'],
            items: [{ kind: 'file', type: 'application/pdf', getAsFile: () => file }]
        };

        // 1. Drag Over -> Expect overlay
        fireEvent.dragOver(mainContainer, { dataTransfer });
        expect(screen.getByText('Drop files here')).toBeDefined();

        // 2. Drop -> Expect processing
        fireEvent.drop(mainContainer, { dataTransfer });

        // Overlay should disappear
        expect(screen.queryByText('Drop files here')).toBeNull();

        // File should appear in attachments list
        await waitFor(() => {
            expect(screen.getByText('test.pdf')).toBeDefined();
        });

        expect(fileProcessor.processFile).toHaveBeenCalledWith(file);
    });
    it('should use default Anthropic URL when custom URL is empty', async () => {
        render(<App />);

        // Open Settings
        const settingsBtn = screen.getByRole('button', { name: /settings/i });
        fireEvent.click(settingsBtn);

        // Select Anthropic
        // The button text is "anthropic" (capitalized via CSS)
        const providerBtn = screen.getByRole('button', { name: /anthropic/i });
        fireEvent.click(providerBtn);

        // Enter Key
        fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'ant-key' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
        await waitFor(() => expect(useChatStore.getState().apiKeys.anthropic).toHaveLength(1));
        fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }));

        // Send Message
        const input = screen.getByPlaceholderText('Ask... (type / for prompts)');
        fireEvent.change(input, { target: { value: 'Hi Claude' } });
        const sendBtn = screen.getByRole('button', { name: /send/i });
        fireEvent.click(sendBtn);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.anthropic.com/v1/messages',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'x-api-key': 'ant-key',
                        'anthropic-dangerous-direct-browser-access': 'true'
                    })
                })
            );
        });
    });

    it('should NOT show loading state in active chat when another chat is loading (Parallel Chat)', async () => {
        // 1. Mock chatService to delay response
        // We need to bypass the fetch mock and mock chatService.sendMessage specifically or just delay the fetch.
        // App.jsx imports chatService.
        // We'll mock chatService.sendMessage to wait.
        const { chatService } = await import('../services/chatService');
        // Re-mock it for this test
        vi.spyOn(chatService, 'sendMessage').mockImplementation(async () => {
            await new Promise(r => setTimeout(r, 100)); // Delay 100ms
            return { content: 'Delayed Response', usage: {} };
        });

        render(<App />);

        // 2. Start Chat A
        const input = screen.getByPlaceholderText('Ask... (type / for prompts)');
        fireEvent.change(input, { target: { value: 'Q1' } });
        const sendBtn = screen.getByRole('button', { name: /send/i });
        fireEvent.click(sendBtn);

        // 3. immediately Switch to New Chat (Chat B)
        const newChatBtn = screen.getByTitle('New Chat');
        fireEvent.click(newChatBtn);

        // 4. Verify Chat B is NOT showing "Thinking..."
        // In the current buggy implementation, isLoading is global, so it WOULD show Thinking...
        // We expect it NOT to.
        expect(screen.queryByLabelText('Thinking...')).toBeNull();

        // 5. Verify Chat B input is enabled
        const inputB = screen.getByPlaceholderText('Ask... (type / for prompts)');
        expect(inputB.disabled).toBe(false);

        // Clean up
        vi.spyOn(chatService, 'sendMessage').mockRestore();
    });



    it('sends with the active key and its endpoint, and follows a key switch', async () => {
        useChatStore.setState({ ...OPENROUTER_KEYS, model: PAID.id });
        vi.mocked(fetchModels).mockResolvedValue([PAID]);
        render(<App />);
        // Each key loads its own catalogue before Send is enabled.
        const send = async (text) => {
            typeDraft(text);
            await waitFor(() => expect(sendButton().disabled).toBe(false));
            fireEvent.click(sendButton());
        };

        await send('one');
        await waitFor(() => expect(chatCalls()).toHaveLength(1));
        expect(chatCalls()[0][0]).toBe('https://eu.openrouter.ai/api/v1/chat/completions');
        expect(chatCalls()[0][1].headers.Authorization).toBe('Bearer eu-key');
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());

        act(() => useChatStore.getState().setActiveApiKey('openrouter', 'k2'));
        await send('two');
        await waitFor(() => expect(chatCalls()).toHaveLength(2));
        expect(chatCalls()[1][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(chatCalls()[1][1].headers.Authorization).toBe('Bearer global-key');
    });

    it('opens Settings when the provider has no key', async () => {
        render(<App />);
        fireEvent.change(screen.getByPlaceholderText('Ask... (type / for prompts)'), { target: { value: 'hi' } });
        fireEvent.click(screen.getByRole('button', { name: /send/i }));
        await waitFor(() => expect(screen.getByText('OpenRouter API Keys')).toBeDefined());
    });
});

describe('App OpenRouter catalogue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useDraftStore.setState({ draft: '' });
        useChatStore.setState({
            ...OPENROUTER_KEYS,
            activeCloudProvider: 'openrouter',
            providerMode: 'cloud',
            model: PAID.id,
            availableModels: [],
            messages: [],
        });
        vi.mocked(fetchModels).mockResolvedValue([PAID]);
        global.fetch.mockReset();
        global.fetch.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden', text: async () => '' });
    });

    it.each(['resolves', 'rejects'])('keeps only the second key catalogue when the first request %s late', async (outcome) => {
        const first = deferred();
        const second = deferred();
        vi.mocked(fetchModels).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        render(<App />);
        await waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(1));
        expect(fetchModels).toHaveBeenLastCalledWith('https://eu.openrouter.ai/api/v1', 'openrouter', 'eu-key');

        act(() => useChatStore.getState().setActiveApiKey('openrouter', 'k2'));
        await waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(2));
        expect(fetchModels).toHaveBeenLastCalledWith('', 'openrouter', 'global-key');
        expect(screen.getByText(MSG.loading)).toBeDefined();

        await act(async () => { second.resolve([FREE]); });
        await waitFor(() => expect(useChatStore.getState().availableModels).toEqual([FREE]));
        await act(async () => {
            if (outcome === 'resolves') first.resolve([PAID]);
            else first.reject(new Error('Failed to fetch models from https://eu.openrouter.ai/api/v1 (openrouter): 500 Internal Server Error'));
        });

        expect(useChatStore.getState().availableModels).toEqual([FREE]);
        expect(useChatStore.getState().model).toBe('');
        expect(screen.getByText(MSG.choose)).toBeDefined();
        expect(screen.queryByText(MSG.failed)).toBeNull();
    });

    it('asks for a key without requesting a catalogue', async () => {
        useChatStore.setState({ apiKeys: emptyKeys(), activeKeyId: emptyActive() });
        render(<App />);
        await screen.findByText(MSG.missingKey);
        expect(fetchModels).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(useChatStore.getState().availableModels).toEqual([]);
    });

    it('reports a failed discovery, blocks sending and retries discovery only', async () => {
        vi.mocked(fetchModels).mockRejectedValueOnce(new Error('Failed to fetch models from https://eu.openrouter.ai/api/v1 (openrouter): 503 Service Unavailable'));
        render(<App />);
        await screen.findByText(MSG.failed);
        expect(useChatStore.getState().availableModels).toEqual([]);
        typeDraft('Hello');
        expect(sendButton().disabled).toBe(true);
        fireEvent.keyDown(draftBox(), { key: 'Enter' });
        await act(async () => { });
        expect(useChatStore.getState().messages).toEqual([]);
        expect(draftBox().value).toBe('Hello');

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(useChatStore.getState().availableModels).toEqual([PAID]));
        expect(clearModelCache).toHaveBeenCalledWith('openrouter');
        expect(fetchModels).toHaveBeenCalledTimes(2);
        // Recovery does not pick a model on the user's behalf.
        expect(useChatStore.getState().model).toBe('');
        expect(screen.getByText(MSG.choose)).toBeDefined();
        expect(chatCalls()).toHaveLength(0);
    });

    it('opens Settings from a failed discovery', async () => {
        vi.mocked(fetchModels).mockRejectedValueOnce(new Error('Malformed model list response'));
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Open settings' }));
        expect(screen.getByText('OpenRouter API Keys')).toBeDefined();
    });

    it('distinguishes a successful empty catalogue and blocks sending', async () => {
        vi.mocked(fetchModels).mockResolvedValueOnce([]);
        render(<App />);
        await screen.findByText(MSG.empty);
        expect(screen.queryByText(MSG.failed)).toBeNull();
        typeDraft('Hello');
        expect(sendButton().disabled).toBe(true);
    });

    it('blocks sending while discovery runs and leaves the draft and attachments untouched', async () => {
        const pending = deferred();
        vi.mocked(fetchModels).mockReturnValueOnce(pending.promise);
        render(<App />);
        await screen.findByText(MSG.loading);
        await attach('notes.txt');
        typeDraft('Hello');
        expect(sendButton().disabled).toBe(true);
        fireEvent.keyDown(draftBox(), { key: 'Enter' });
        await act(async () => { });
        expect(useChatStore.getState().messages).toEqual([]);
        expect(draftBox().value).toBe('Hello');
        expect(screen.getByText('notes.txt')).toBeDefined();
        expect(chatCalls()).toHaveLength(0);

        await act(async () => { pending.resolve([PAID]); });
        await waitFor(() => expect(sendButton().disabled).toBe(false));
        expect(screen.queryByText(MSG.loading)).toBeNull();
    });

    it('refreshes the catalogue without the cache and without resending a message', async () => {
        render(<App />);
        await waitFor(() => expect(useChatStore.getState().availableModels).toEqual([PAID]));
        fireEvent.focus(screen.getByRole('combobox'));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
        await waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(2));
        expect(clearModelCache).toHaveBeenCalledTimes(1);
        expect(clearModelCache).toHaveBeenCalledWith('openrouter');
        expect(vi.mocked(clearModelCache).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(fetchModels).mock.invocationCallOrder[1]);
        await waitFor(() => expect(useChatStore.getState().availableModels).toEqual([PAID]));
        expect(useChatStore.getState().model).toBe(PAID.id);
        expect(chatCalls()).toHaveLength(0);
        expect(useChatStore.getState().messages).toEqual([]);
    });

    it('does not refetch or clear the catalogue when the local base URL changes while OpenRouter is active', async () => {
        render(<App />);
        await waitFor(() => expect(useChatStore.getState().availableModels).toEqual([PAID]));
        expect(fetchModels).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().model).toBe(PAID.id);

        act(() => useChatStore.getState().setLocalBaseUrl('http://localhost:1234/v1'));
        await act(async () => { });

        expect(fetchModels).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().availableModels).toEqual([PAID]);
        expect(useChatStore.getState().model).toBe(PAID.id);
    });

    it('clears a free selection that left the catalogue instead of choosing a paid model', async () => {
        useChatStore.setState({ model: FREE.id });
        render(<App />);
        await waitFor(() => expect(useChatStore.getState().availableModels).toEqual([PAID]));
        expect(useChatStore.getState().model).toBe('');
        expect(screen.getByText(MSG.choose)).toBeDefined();
        typeDraft('Hello');
        expect(sendButton().disabled).toBe(true);
    });

    it('still selects the first listed model for a direct provider', async () => {
        useChatStore.setState({
            activeCloudProvider: 'anthropic',
            model: 'missing-model',
            apiKeys: { ...emptyKeys(), anthropic: [{ id: 'a1', label: 'Default', encryptedKey: 'encrypted-ant-key', baseUrl: '' }] },
            activeKeyId: { ...emptyActive(), anthropic: 'a1' },
        });
        vi.mocked(fetchModels).mockResolvedValue([{ id: 'claude-a', name: 'Claude A' }, { id: 'claude-b', name: 'Claude B' }]);
        render(<App />);
        await waitFor(() => expect(useChatStore.getState().model).toBe('claude-a'));
    });

    it('does not truncate an edited message while discovery runs', async () => {
        const original = { role: 'user', content: 'Original' };
        useChatStore.setState({
            sessions: [{ id: 's1', title: 'Chat', messages: [original], model: PAID.id, updatedAt: 1 }],
            currentSessionId: 's1',
            messages: [original],
        });
        const pending = deferred();
        vi.mocked(fetchModels).mockReturnValueOnce(pending.promise);
        render(<App />);
        await screen.findByText(MSG.loading);
        fireEvent.click(screen.getByTitle(/edit/i));
        const editor = screen.getAllByRole('textbox').find(el => el.value === 'Original');
        fireEvent.change(editor, { target: { value: 'Edited' } });
        await act(async () => { fireEvent.click(screen.getByTitle(/regenerate/i)); });
        expect(useChatStore.getState().messages).toEqual([original]);
        expect(chatCalls()).toHaveLength(0);
        await act(async () => { pending.resolve([PAID]); });
    });

    it('keeps the draft and the submitted message with its files when the provider rejects the request', async () => {
        render(<App />);
        await waitFor(() => expect(useChatStore.getState().availableModels).toEqual([PAID]));
        await attach('notes.txt');
        typeDraft('Hello');
        await waitFor(() => expect(sendButton().disabled).toBe(false));
        fireEvent.click(sendButton());
        await waitFor(() => expect(useChatStore.getState().messages.some(m => m.role === 'system')).toBe(true));

        const users = useChatStore.getState().messages.filter(m => m.role === 'user');
        expect(users).toHaveLength(1);
        expect(users[0]).toMatchObject({ content: 'Hello', files: [expect.objectContaining({ name: 'notes.txt' })] });
        expect(draftBox().value).toBe('Hello');
        // The file stays with the submitted message only; it is not restored as a new attachment.
        expect(screen.getAllByText('notes.txt')).toHaveLength(1);
        expect(useChatStore.getState().model).toBe(PAID.id);
        expect(chatCalls()).toHaveLength(1);
    });
});
