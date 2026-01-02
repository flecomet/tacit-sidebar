import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatService } from '../services/chatService';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ChatInput from '../components/ChatInput';
import { useChatStore } from '../store/useChatStore';

// Mock dependencies
vi.mock('../store/useChatStore');
vi.mock('../store/useDraftStore', () => ({
    useDraftStore: () => ({
        draft: 'test message',
        setDraft: vi.fn()
    })
}));

// Mock fetch for chatService tests
global.fetch = vi.fn();

describe('Web Search Integration', () => {

    describe('chatService Logic', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            global.fetch.mockResolvedValue({
                ok: true,
                text: () => Promise.resolve(JSON.stringify({
                    choices: [{ message: { content: 'Response' } }]
                }))
            });
        });

        it('should include web plugin in payload when provider is openrouter and webSearch is true', async () => {
            await chatService.sendMessage({
                provider: 'openrouter',
                baseUrl: 'https://openrouter.ai/api/v1',
                apiKey: 'test-key',
                model: 'openai/gpt-4',
                messages: [{ role: 'user', content: 'hello' }],
                options: { webSearch: true }
            });

            expect(global.fetch).toHaveBeenCalledTimes(1);
            const callArgs = global.fetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);

            expect(body).toHaveProperty('plugins');
            expect(body.plugins).toEqual([{ id: 'web' }]);
        });

        it('should NOT include web plugin when webSearch is false', async () => {
            await chatService.sendMessage({
                provider: 'openrouter',
                baseUrl: 'https://openrouter.ai/api/v1',
                apiKey: 'test-key',
                model: 'openai/gpt-4',
                messages: [{ role: 'user', content: 'hello' }],
                options: { webSearch: false }
            });

            const body = JSON.parse(global.fetch.mock.calls[0][1].body);
            expect(body).not.toHaveProperty('plugins');
        });

        it('should NOT include web plugin when provider is NOT openrouter', async () => {
            // Even if webSearch is true, if provider is 'openai', we don't send OR plugins
            await chatService.sendMessage({
                provider: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: 'test-key',
                model: 'gpt-4',
                messages: [{ role: 'user', content: 'hello' }],
                options: { webSearch: true }
            });

            const body = JSON.parse(global.fetch.mock.calls[0][1].body);
            expect(body).not.toHaveProperty('plugins');
        });
    });

    describe('ChatInput UI', () => {
        const mockOnSend = vi.fn();
        const mockOnUpload = vi.fn();
        const mockOnReadPage = vi.fn();

        beforeEach(() => {
            vi.clearAllMocks();
            useChatStore.mockReturnValue({
                model: 'gpt-4',
                availableModels: [{ id: 'gpt-4', name: 'GPT-4' }],
                favorites: [],
                toggleFavorite: vi.fn(),
                setModel: vi.fn()
            });
        });

        it('should render web search toggle button', () => {
            render(
                <ChatInput
                    onSend={mockOnSend}
                    onUpload={mockOnUpload}
                    onReadPage={mockOnReadPage}
                    isLoading={false}
                    activeProvider="openrouter"
                />
            );

            // Check for the button - assuming we'll use a specific aria-label or accessible name
            // For now, let's assume we'll give it aria-label="Toggle Web Search"
            const toggleBtn = screen.getByTitle('Enable Web Search');
            expect(toggleBtn).toBeDefined();
        });

        it('should toggle web search state on click', () => {
            render(
                <ChatInput
                    onSend={mockOnSend}
                    onUpload={mockOnUpload}
                    onReadPage={mockOnReadPage}
                    isLoading={false}
                    activeProvider="openrouter"
                />
            );

            const toggleBtn = screen.getByTitle('Enable Web Search');

            // Initial state check (e.g. check for class or visually hidden checkbox)
            // Let's assume visual feedback changes class

            fireEvent.click(toggleBtn);
            // After click, should show active state

            // Check if onSend receives the correct option
            const sendBtn = screen.getByLabelText('Send');
            fireEvent.click(sendBtn);

            expect(mockOnSend).toHaveBeenCalledWith(expect.any(String), { webSearch: true });
        });

        it('should send webSearch: false by default', () => {
            render(
                <ChatInput
                    onSend={mockOnSend}
                    onUpload={mockOnUpload}
                    onReadPage={mockOnReadPage}
                    isLoading={false}
                    activeProvider="openrouter"
                />
            );

            const sendBtn = screen.getByLabelText('Send');
            fireEvent.click(sendBtn);

            expect(mockOnSend).toHaveBeenCalledWith(expect.any(String), { webSearch: false });
        });
    });
});
