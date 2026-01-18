import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import * as fileProcessor from '../utils/fileProcessor';
import * as pageScraper from '../utils/pageScraper';
import { useChatStore } from '../store/useChatStore';
import { fetchModels } from '../services/modelService';

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
    getModelCategory: vi.fn(m => m._category || 'General')
}));

// Mock fetch for OpenRouter
global.fetch = vi.fn();

describe('App Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(fetchModels).mockResolvedValue([]);

        // Reset store
        useChatStore.setState({
            encryptedApiKey: '',
            messages: [],
            providerMode: 'cloud'
        });

        global.fetch.mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(JSON.stringify({
                choices: [{ message: { content: 'AI Response' } }]
            })),
            json: async () => ({
                choices: [{ message: { content: 'AI Response' } }]
            })
        });
    });

    it('should render the header and main components', () => {
        render(<App />);
        // Settings button
        expect(screen.getByRole('button', { name: /settings/i })).toBeDefined(); // Settings icon button
    });

    it('should show settings modal when clicking settings', async () => {
        render(<App />);
        const settingsBtn = screen.getByRole('button', { name: /settings/i }); // We'll add aria-label to button
        fireEvent.click(settingsBtn);

        expect(screen.getByText('OpenRouter API Key')).toBeDefined();
    });

    it('should handle sending a message', async () => {
        render(<App />);

        // 1. Enter API Key (mocking it being saved or just assuming logic handles it)
        // For test simplicity, we might need to mock useChatStore state?
        // Actually, we are testing integration, so we should interact with UI.

        // Open settings, set key
        const settingsBtn = screen.getByRole('button', { name: /settings/i });
        fireEvent.click(settingsBtn);

        const keyInput = screen.getByPlaceholderText('sk-...');
        fireEvent.change(keyInput, { target: { value: 'test-key' } });

        const saveBtn = screen.getByRole('button', { name: 'Save Key' });
        fireEvent.click(saveBtn);

        // Settings should close (async now due to encryption)
        await waitFor(() => {
            expect(screen.queryByText('OpenRouter API Key')).toBeNull();
        }, { timeout: 2000 });

        // 2. Type message
        const input = screen.getByPlaceholderText('Ask...');
        fireEvent.change(input, { target: { value: 'Hello' } });

        // 3. Send
        const sendBtn = screen.getByRole('button', { name: /send/i });
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
        const input = screen.getByPlaceholderText('Ask...');
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
        vi.mocked(fetchModels).mockImplementation(async (url, free, provider) => {
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
        const keyInput = screen.getByPlaceholderText('sk-...');
        fireEvent.change(keyInput, { target: { value: 'ant-key' } });
        const saveBtn = screen.getByRole('button', { name: 'Save Key' });
        fireEvent.click(saveBtn);

        // Wait for close
        await waitFor(() => {
            expect(screen.queryByText(/Anthropic API Key/i)).toBeNull(); // Label might be "Anthropic API Key"
        }, { timeout: 2000 });

        // Send Message
        const input = screen.getByPlaceholderText('Ask...');
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
        const input = screen.getByPlaceholderText('Ask...');
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
        const inputB = screen.getByPlaceholderText('Ask...');
        expect(inputB.disabled).toBe(false);

        // Clean up
        vi.spyOn(chatService, 'sendMessage').mockRestore();
    });


});
