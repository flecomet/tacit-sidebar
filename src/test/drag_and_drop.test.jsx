import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../sidepanel/App';
import * as fileProcessor from '../utils/fileProcessor';
import { useChatStore } from '../store/useChatStore';

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

// Mock global fetch
global.fetch = vi.fn();

describe('Drag and Drop Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset store state
        act(() => {
            useChatStore.setState({ availableModels: [], model: 'anthropic/claude-4-sonnet' });
        });

        // Mock Fetch Implementation
        global.fetch.mockImplementation(async (url) => {
            if (url.includes('/models')) {
                return {
                    ok: true,
                    json: async () => ({
                        data: [
                            { id: 'openai/gpt-4o', name: 'GPT-4o', pricing: { prompt: '0.000005', completion: '0.000015' } },
                        ]
                    })
                };
            }
            return { ok: false };
        });

        fileProcessor.processFile.mockResolvedValue({
            type: 'text',
            name: 'dropped-file.txt',
            content: 'File content'
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should handle drag enter, over, leave and drop', async () => {
        await act(async () => {
            render(<App />);
        });

        const appContainer = screen.getByLabelText('Settings').closest('div').parentElement;

        // 1. Drag Over
        fireEvent.dragOver(appContainer);

        // Expect overlay to appear
        expect(screen.getByText('Drop files here')).not.toBeNull();

        // 2. Drop
        const file = new File(['(binary)'], 'dropped-file.txt', { type: 'text/plain' });

        // Mock dataTransfer
        const dataTransfer = {
            files: [file],
            items: [{
                kind: 'file',
                type: file.type,
                getAsFile: () => file
            }],
            types: ['Files']
        };

        await act(async () => {
            fireEvent.drop(appContainer, { dataTransfer });
        });

        // Verify overlay is gone
        expect(screen.queryByText('Drop files here')).toBeNull();

        // Verify file processing was called
        expect(fileProcessor.processFile).toHaveBeenCalledWith(file);

        // Verify file is added to attachments
        await waitFor(() => {
            expect(screen.getByText('dropped-file.txt')).toBeDefined();
        });
    });

    it('should handle dragging a data: URL directly (local processing)', async () => {
        await act(async () => {
            render(<App />);
        });

        const appContainer = screen.getByLabelText('Settings').closest('div').parentElement;
        const dataUrl = 'data:image/jpeg;base64,another-fake-content';

        const sendMessageMock = vi.fn();
        global.chrome = {
            runtime: {
                sendMessage: sendMessageMock,
                lastError: null
            }
        };

        // Mock fetch for the data URL
        global.fetch.mockImplementation(async (url) => {
            if (url === dataUrl) {
                return {
                    ok: true,
                    blob: async () => new Blob(['fake-jpeg'], { type: 'image/jpeg' })
                };
            }
            if (url.includes('/models')) {
                return { ok: true, json: async () => ({ data: [] }) };
            }
            return { ok: false };
        });

        fileProcessor.processFile.mockResolvedValue({
            type: 'image',
            name: 'dropped_content.png',
            content: dataUrl
        });

        const dataTransfer = {
            files: [],
            items: [],
            types: ['text/plain'],
            getData: (type) => (type === 'text/plain' ? dataUrl : '')
        };

        await act(async () => {
            fireEvent.drop(appContainer, { dataTransfer });
        });

        // Expect background script NOT to be called
        expect(sendMessageMock).not.toHaveBeenCalled();

        // Expect fileProcessor to be called
        await waitFor(() => {
            expect(fileProcessor.processFile).toHaveBeenCalled();
        });

        // Verify filename logic applied attached extension
        await waitFor(() => {
            expect(screen.getByText('dropped_content.png')).toBeDefined();
        });
    });
});
