
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

    it('should keep images sent in stream deltas (OpenRouter streams when a signal is passed)', async () => {
        const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
        const sse = [
            `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' } }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: { images: [{ type: 'image_url', image_url: { url: dataUrl } }] } }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { total_tokens: 1127 } })}`,
            'data: [DONE]',
            ''
        ].join('\n');
        const chunks = [new TextEncoder().encode(sse)];
        global.fetch.mockResolvedValueOnce({
            ok: true,
            body: {
                getReader: () => ({
                    read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true },
                    cancel: () => {}
                })
            }
        });

        const result = await chatService.sendMessage({
            provider: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: 'test-key',
            model: 'google/gemini-2.5-flash-image',
            messages: [{ role: 'user', content: 'cutie cat' }],
            signal: new AbortController().signal
        });

        expect(result.content).toContain(`![Generated Image](${dataUrl})`);
        expect(result.attachments).toEqual([{ type: 'image', url: dataUrl, name: 'generated_image.png' }]);
        expect(result.usage.total_tokens).toBe(1127);
    });
});
