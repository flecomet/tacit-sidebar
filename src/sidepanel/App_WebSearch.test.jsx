
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { useChatStore } from '../store/useChatStore';
import { chatService } from '../services/chatService';

// Mock Dependencies
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
    fetchModels: vi.fn().mockResolvedValue([{ id: 'local-model', name: 'Local Model' }]),
    getModelCategory: vi.fn(m => m._category || 'General')
}));

// Spy on chatService
vi.spyOn(chatService, 'sendMessage').mockResolvedValue({ content: 'AI Response', usage: {} });

describe('App Web Search Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset store with specific web search state
        useChatStore.setState({
            providerMode: 'local',
            webSearchConfig: {
                provider: 'serper',
                encryptedApiKey: 'encrypted-test-search-key',
            },
            messages: [],
            model: 'local-model'
        });
    });

    it('selects Brave and saves its key encrypted without a Google engine ID', async () => {
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        render(<App />);
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(screen.queryByRole('button', { name: 'Google' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Brave' }));

        expect(screen.getByText('Brave Search API Key')).toBeTruthy();
        expect(screen.queryByText('Search Engine ID (CX)')).toBeNull();
        await waitFor(() => expect(screen.getByPlaceholderText('Key...').value).toBe(''));
        fireEvent.change(screen.getByPlaceholderText('Key...'), { target: { value: 'brave-key' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Search Config' }));

        await waitFor(() => expect(useChatStore.getState().webSearchConfig).toMatchObject({
            provider: 'brave', encryptedApiKey: 'encrypted-brave-key'
        }));
    });

    it('keeps search keys separate when switching providers', async () => {
        render(<App />);
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        await waitFor(() => expect(screen.getByPlaceholderText('Key...').value).toBe('test-search-key'));
        fireEvent.click(screen.getByRole('button', { name: 'SerpApi' }));
        expect(screen.getByPlaceholderText('Key...').value).toBe('');
        expect(useChatStore.getState().webSearchConfig.encryptedApiKey).toBe('');
        fireEvent.click(screen.getByRole('button', { name: 'Serper.dev' }));
        await waitFor(() => expect(screen.getByPlaceholderText('Key...').value).toBe('test-search-key'));
    });

    it('keeps Google settings editable for an existing configuration', async () => {
        useChatStore.setState({ webSearchConfig: { provider: 'google', encryptedApiKey: 'encrypted-google-key', cx: 'existing-engine' } });
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        render(<App />);
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(screen.getByRole('button', { name: 'Google (existing customers)' })).toBeTruthy();
        await waitFor(() => expect(screen.getByPlaceholderText('Key...').value).toBe('google-key'));
        expect(screen.getByPlaceholderText('cx...').value).toBe('existing-engine');
        fireEvent.change(screen.getByPlaceholderText('cx...'), { target: { value: 'updated-engine' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Search Config' }));
        await waitFor(() => expect(useChatStore.getState().webSearchConfig).toMatchObject({ provider: 'google', encryptedApiKey: 'encrypted-google-key', cx: 'updated-engine' }));
    });

    it.each(['google', 'serper', 'serpapi', 'brave'])('decrypts and passes %s search config to chatService', async (provider) => {
        useChatStore.setState({ webSearchConfig: { ...useChatStore.getState().webSearchConfig, provider } });
        render(<App />);

        // 1. Enable Web Search (assuming a toggle exists or we can mock it)
        // Since the toggle is inside ChatInput and reflects the `options` passed to sendMessage,
        // we can trigger the search via the UI.

        // Find Web Search Toggle in ChatInput and Click it
        // The toggle has title "Enable Web Search" or similar
        const toggleBtn = screen.getByTitle('Enable Web Search');
        // Initially it might be off. Clicking it should toggle it on.
        // Actually, let's check its state. The button appearance changes.
        // Let's assume default is off. Click to turn on.
        fireEvent.click(toggleBtn);

        // 2. Type Message
        const input = screen.getByPlaceholderText('Ask... (type / for prompts)');
        fireEvent.change(input, { target: { value: 'Who won the Super Bowl 2025?' } });

        // 3. Send Message
        const sendBtn = screen.getByRole('button', { name: /send/i });
        fireEvent.click(sendBtn);

        // 4. Verify chatService.sendMessage arguments
        await waitFor(() => {
            expect(chatService.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    options: expect.objectContaining({
                        webSearch: true,
                        webSearchConfig: expect.objectContaining({
                            apiKey: 'test-search-key', // Decrypted!
                            provider,
                                    })
                    })
                })
            );
        });
    });
});
