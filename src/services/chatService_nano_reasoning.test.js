
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatService } from './chatService.js';

describe('ChatService - Nano Banana Reasoning', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        global.fetch = vi.fn();
    });

    it('should handle response with reasoning tokens and images array', async () => {
        // Mock a response where content has reasoning "thinking" and images array is present
        const mockResponse = {
            choices: [
                {
                    message: {
                        content: "Thinking Process: 1. Start with a banana. 2. Make it nano.\n\nHere is your image.",
                        images: [
                            { url: 'https://example.com/banana.png' }
                        ]
                    }
                }
            ]
        };

        global.fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify(mockResponse),
            json: async () => mockResponse
        });

        const result = await chatService.sendMessage({
            provider: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: 'test-key',
            model: 'nano-banana-3-pro',
            messages: [{ role: 'user', content: 'Draw a banana' }]
        });

        // Current behavior expectation:
        // Content should append the image if not present
        expect(result.content).toContain('Thinking Process');
        expect(result.content).toContain('![Generated Image](https://example.com/banana.png)');
        // Attachments should be populated
        expect(result.attachments).toHaveLength(1);
        expect(result.attachments[0].url).toBe('https://example.com/banana.png');
    });

    it('should extract image to attachments if images array is missing but image markdown is present', async () => {
        // Mock a response where content has reasoning and a markdown image, but NO images array
        const mockResponse = {
            choices: [
                {
                    message: {
                        content: "Thinking... Done.\n\n![Generated Image](https://example.com/derived_banana.png)"
                    }
                }
            ]
        };

        global.fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify(mockResponse),
            json: async () => mockResponse
        });

        const result = await chatService.sendMessage({
            provider: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: 'test-key',
            model: 'nano-banana-3-pro',
            messages: [{ role: 'user', content: 'Draw a banana' }]
        });

        // Expectation: logic should find the image and add it to attachments
        expect(result.attachments).toHaveLength(1);
        expect(result.attachments[0].url).toBe('https://example.com/derived_banana.png');
    });
});
