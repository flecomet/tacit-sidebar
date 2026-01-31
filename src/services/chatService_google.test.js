import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chatService } from './chatService';

/**
 * Tests for Google (Gemini) provider payload formatting.
 * Ensures webSearchConfig is never sent to Google API.
 */
describe('chatService Google Provider', () => {
    const mockParams = {
        provider: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'test-api-key',
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'What is the weather today?' }]
    };

    beforeEach(() => {
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should NOT include webSearchConfig in the payload sent to Google API', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                candidates: [{ content: { parts: [{ text: 'Response' }] } }],
                usageMetadata: { totalTokenCount: 10 }
            })
        });

        await chatService.sendMessage({
            ...mockParams,
            options: {
                webSearch: true,
                webSearchConfig: {
                    provider: 'google',
                    apiKey: 'search-api-key',
                    cx: 'search-engine-id'
                },
                temperature: 0.7
            }
        });

        const call = global.fetch.mock.calls[0];
        const payload = JSON.parse(call[1].body);

        // webSearchConfig should NOT be in generationConfig
        expect(payload.generationConfig).not.toHaveProperty('webSearchConfig');

        // webSearch should NOT be in generationConfig either
        expect(payload.generationConfig).not.toHaveProperty('webSearch');

        // temperature should pass through
        expect(payload.generationConfig.temperature).toBe(0.7);

        // google_search tool should be enabled when webSearch is true
        expect(payload.tools).toEqual([{ google_search: {} }]);
    });

    it('should handle successful Google API response', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] } }],
                usageMetadata: { totalTokenCount: 42 }
            })
        });

        const result = await chatService.sendMessage(mockParams);

        expect(result.content).toBe('Hello from Gemini');
        expect(result.usage.total_tokens).toBe(42);
    });

    it('should throw on Google API error response', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            status: 400,
            text: () => Promise.resolve('{"error": {"message": "Invalid request"}}')
        });

        await expect(chatService.sendMessage(mockParams))
            .rejects.toThrow('Google API Error: 400');
    });
});
