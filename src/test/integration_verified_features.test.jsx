import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../sidepanel/App';
import * as pageScraper from '../utils/pageScraper';
import * as fileProcessor from '../utils/fileProcessor';
import { useChatStore } from '../store/useChatStore';
import { fetchModels } from '../services/modelService';

// Mocks
vi.mock('../utils/pageScraper', () => ({
    scrapePage: vi.fn()
}));

vi.mock('../utils/fileProcessor', () => ({
    processFile: vi.fn()
}));

vi.mock('../utils/encryption', () => ({
    encryptData: vi.fn(key => Promise.resolve(`encrypted-${key}`)),
    decryptData: vi.fn(key => Promise.resolve(key.replace('encrypted-', '')))
}));

vi.mock('../services/modelService', () => ({
    fetchModels: vi.fn(),
    getModelCategory: vi.fn(m => m._category || 'General') // Simple mock
}));

// Mock global fetch (still needed for other things? maybe not if fetchModels is mocked)
global.fetch = vi.fn();
global.fetch = vi.fn();

describe('Verified Features Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset store state
        act(() => {
            useChatStore.setState({
                availableModels: [],
                model: 'anthropic/claude-4-sonnet',
                providerMode: 'cloud',
                encryptedApiKey: '',
                customBaseUrl: '',
                includeFreeModels: false
            });
        });

        // Mock Fetch Implementation
        global.fetch.mockImplementation(async (url) => {
            if (url.includes('/chat/completions')) {
                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: 'Test Response' } }],
                        usage: { total_tokens: 10 }
                    })
                };
            }
            return { ok: false };
        });

        // Mock fetchModels
        vi.mocked(fetchModels).mockResolvedValue([
            { id: 'openai/gpt-4o', name: 'GPT-4o', pricing: { prompt: '0.000005', completion: '0.000015' } },
            { id: 'anthropic/claude-4-sonnet', name: 'Claude 4 Sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
            { id: 'google/gemini-pro', name: 'Gemini Pro', pricing: { prompt: '0.000125', completion: '0.000375' } },
            { id: 'mistral/mistral-large', name: 'Mistral Large', pricing: { prompt: '0.000002', completion: '0.000006' } }
        ]);

        pageScraper.scrapePage.mockResolvedValue({
            type: 'text',
            name: 'Page Context: Example',
            content: '--- BEGIN PAGE CONTEXT ---\nExample Content\n--- END PAGE CONTEXT ---'
        });

        fileProcessor.processFile.mockResolvedValue({
            type: 'text',
            name: 'test-file.txt',
            content: 'File content'
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('Verified Feature: Model selection correctly retrieves all models', async () => {
        await act(async () => {
            render(<App />);
        });

        await waitFor(() => {
            expect(fetchModels).toHaveBeenCalled();
        }, { timeout: 3000 });

        const combobox = screen.getByRole('combobox');
        fireEvent.focus(combobox);

        await waitFor(() => {
            expect(screen.getByText('GPT-4o')).toBeDefined();
            expect(screen.getByText('Claude 4 Sonnet')).toBeDefined();
        });
    });

    it('Verified Feature: Page uploading to model context works', async () => {
        await act(async () => {
            render(<App />);
        });

        const readPageBtn = screen.getByTitle('Import current page text');

        await act(async () => {
            fireEvent.click(readPageBtn);
        });

        expect(pageScraper.scrapePage).toHaveBeenCalled();
        await waitFor(() => {
            expect(screen.getByText('Page Context: Example')).toBeDefined();
        });
    });

    it('Verified Feature: Searching models by name works', async () => {
        await act(async () => {
            render(<App />);
        });

        await waitFor(() => expect(fetchModels).toHaveBeenCalled(), { timeout: 3000 });

        const combobox = screen.getByRole('combobox');

        fireEvent.change(combobox, { target: { value: 'Gemini' } });
        fireEvent.focus(combobox);

        await waitFor(() => {
            expect(screen.getByText('Gemini Pro')).toBeDefined();
        }, { timeout: 2000 });

        await waitFor(() => {
            const gpt = screen.queryByText('GPT-4o');
            if (gpt) throw new Error("GPT-4o should be filtered out");
        });
    });

    it('Verified Feature: Uploading images works and respects model capabilities', async () => {
        await act(async () => {
            render(<App />);
        });

        fileProcessor.processFile.mockResolvedValue({
            type: 'image',
            name: 'screenshot.png',
            content: 'data:image/png;base64,...',
            originalType: 'image/png'
        });

        // 1. Initial State: Claude 4 Sonnet (Supports Vision)
        // Check input accept attribute
        const attachLabel = screen.getByTitle('Attach file');
        const input = attachLabel.querySelector('input');
        const combobox = screen.getByRole('combobox');

        // Check store update first
        await waitFor(() => {
            expect(useChatStore.getState().availableModels.length).toBeGreaterThan(0);
        });

        // Wait for models to load and mapping to occur (Input should show "Claude 4 Sonnet")
        await waitFor(() => {
            expect(combobox.value).toBe('Claude 4 Sonnet');
        }, { timeout: 3000 });

        // Now check accept
        expect(input.accept).toContain('.png');

        // 2. Switch to a non-vision model (e.g. Mistral Large, assuming heuristic doesn't catch it as vision)
        // We need to make sure our mock data and heuristic align.
        // Heuristic: .includes("vision") || .includes("vl") || matching known families (gpt-4, claude-3, claude-4, gemini, llama-3.2)
        // "mistral/mistral-large" does not match these. and we didn't provide architecture metadata in mock.

        fireEvent.focus(combobox);
        fireEvent.change(combobox, { target: { value: 'Mistral' } });

        const option = await screen.findByText('Mistral Large');
        fireEvent.click(option);

        // Verify model changed
        await waitFor(() => {
            expect(combobox.value).toBe('Mistral Large');
        });

        // Check accept attribute again
        // Should NOT include images
        expect(input.accept).not.toContain('.png');
        expect(input.accept).toContain('.pdf'); // Base types stay

        // 3. Switch back to GPT-4o
        fireEvent.focus(combobox);
        fireEvent.change(combobox, { target: { value: 'GPT-4o' } });
        const gptOption = await screen.findByText('GPT-4o');
        fireEvent.click(gptOption);

        await waitFor(() => {
            expect(combobox.value).toBe('GPT-4o');
        });

        // Should include images again
        expect(input.accept).toContain('.png');

        // 4. Perform Upload
        const file = new File(['(binary)'], 'screenshot.png', { type: 'image/png' });
        await act(async () => {
            fireEvent.change(input, { target: { files: [file] } });
        });

        expect(fileProcessor.processFile).toHaveBeenCalledWith(file);
        await waitFor(() => {
            expect(screen.getByText('screenshot.png')).toBeDefined();
        });
    });
});
