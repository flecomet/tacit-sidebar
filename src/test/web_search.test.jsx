import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatService } from '../services/chatService';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ChatInput from '../components/ChatInput';
import { useChatStore } from '../store/useChatStore';
import { useDraftStore } from '../store/useDraftStore';

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
            // Default mock response
            global.fetch.mockResolvedValue({
                ok: true,
                text: () => Promise.resolve(JSON.stringify({
                    choices: [{ message: { content: 'Response' } }], // OpenAI structure
                    content: [{ text: 'Response' }], // Claude structure
                    candidates: [{ content: { parts: [{ text: 'Response' }] } }] // Google structure
                })),
                json: () => Promise.resolve({
                    choices: [{ message: { content: 'Response' } }],
                    content: [{ text: 'Response' }],
                    candidates: [{ content: { parts: [{ text: 'Response' }] } }]
                })
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

            const callArgs = global.fetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.plugins).toEqual([{ id: 'web' }]);
        });

        it('should include web_search tool for OpenAI when webSearch is true', async () => {
            await chatService.sendMessage({
                provider: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: 'test-key',
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'hello' }],
                options: { webSearch: true }
            });

            const callArgs = global.fetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.tools).toBeDefined();
            expect(body.tools).toContainEqual({
                type: 'web_search'
            });
        });

        it('should include web_search_20250305 tool for Anthropic when webSearch is true', async () => {
            await chatService.sendMessage({
                provider: 'anthropic',
                baseUrl: 'https://api.anthropic.com',
                apiKey: 'test-key',
                model: 'claude-3-5-sonnet-20241022',
                messages: [{ role: 'user', content: 'hello' }],
                options: { webSearch: true }
            });

            const callArgs = global.fetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);

            expect(body.tools).toBeDefined();
            expect(body.tools).toContainEqual({
                type: 'web_search_20250305',
                name: 'web_search'
            });
        });

        it('should include google_search_retrieval tool for Google when webSearch is true', async () => {
            await chatService.sendMessage({
                provider: 'google',
                baseUrl: 'https://generativelanguage.googleapis.com',
                apiKey: 'test-key',
                model: 'gemini-1.5-pro',
                messages: [{ role: 'user', content: 'hello' }],
                options: { webSearch: true }
            });

            const callArgs = global.fetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);

            expect(body.tools).toBeDefined();
            expect(body.tools).toContainEqual({ google_search: {} });
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

        it('should render web search toggle button for OpenRouter', () => {
            render(<ChatInput onSend={mockOnSend} activeProvider="openrouter" isLoading={false} onUpload={mockOnUpload} onReadPage={mockOnReadPage} />);
            expect(screen.getByTitle('Enable Web Search')).toBeDefined();
        });

        it('should render web search toggle button for OpenAI', () => {
            render(<ChatInput onSend={mockOnSend} activeProvider="openai" isLoading={false} onUpload={mockOnUpload} onReadPage={mockOnReadPage} />);
            expect(screen.getByTitle('Enable Web Search')).toBeDefined();
        });

        it('should render web search toggle button for Anthropic', () => {
            render(<ChatInput onSend={mockOnSend} activeProvider="anthropic" isLoading={false} onUpload={mockOnUpload} onReadPage={mockOnReadPage} />);
            expect(screen.getByTitle('Enable Web Search')).toBeDefined();
        });

        it('should render web search toggle button for Google', () => {
            render(<ChatInput onSend={mockOnSend} activeProvider="google" isLoading={false} onUpload={mockOnUpload} onReadPage={mockOnReadPage} />);
            expect(screen.getByTitle('Enable Web Search')).toBeDefined();
        });

        it('should NOT render web search toggle button for Local', () => {
            render(<ChatInput onSend={mockOnSend} activeProvider="Local" providerMode="local" isLoading={false} onUpload={mockOnUpload} onReadPage={mockOnReadPage} />);
            expect(screen.queryByTitle('Enable Web Search')).toBeNull();
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
            fireEvent.click(toggleBtn);

            const sendBtn = screen.getByLabelText('Send');
            fireEvent.click(sendBtn);

            expect(mockOnSend).toHaveBeenCalledWith(expect.any(String), { webSearch: true });
        });
    });

    describe('OpenAI Responses API Parsing', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should correctly parse OpenAI Web Search response with citations', async () => {
            // Mock the specific responses API format
            const mockResponse = {
                output: [
                    {
                        type: "message",
                        content: [
                            {
                                type: "output_text",
                                text: "The weather in Paris is sunny.",
                                annotations: [
                                    { type: "url_citation", url: "https://weather.com/paris", title: "Weather in Paris" }
                                ]
                            }
                        ]
                    }
                ]
            };

            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockResponse),
                text: () => Promise.resolve(JSON.stringify(mockResponse))
            });

            const result = await chatService.sendMessage({
                provider: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: 'test-key',
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'Weather Paris' }],
                options: { webSearch: true }
            });

            expect(result.content).toContain('The weather in Paris is sunny.');
            expect(result.content).toContain('Weather in Paris');
            expect(result.content).toContain('https://weather.com/paris');
        });

        it('should handle "No text content" scenario gracefully (fallback)', async () => {
            // Simulate a response that currently fails finding text
            const mockResponse = {
                output: [] // Empty output
            };

            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockResponse),
                text: () => Promise.resolve(JSON.stringify(mockResponse))
            });

            const result = await chatService.sendMessage({
                provider: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: 'test-key',
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'Weather Paris' }],
                options: { webSearch: true }
            });

            // Current implementation returns "No text content returned from Responses API."
            expect(result.content).toBe("No text content returned from Responses API.");
        });
    });
});
