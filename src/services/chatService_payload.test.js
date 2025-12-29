import { describe, it, expect, vi } from 'vitest';
import { chatService } from './chatService';

// Mock fetch to inspect the payload
global.fetch = vi.fn();

describe('chatService Payload Formatting', () => {
    it('should format mixed text and image content correctly for OpenRouter/Google', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(JSON.stringify({
                choices: [{ message: { content: 'Response' } }]
            }))
        });

        const messages = [
            {
                role: 'user',
                content: '', // Empty text
                files: [
                    {
                        type: 'image',
                        name: 'test.png',
                        content: 'data:image/png;base64,FAKE_BASE64'
                    }
                ]
            }
        ];

        await chatService.sendMessage({
            provider: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: 'test-key',
            model: 'google/gemini-pro-1.5',
            messages: messages
        });

        const call = global.fetch.mock.calls[0];
        const payload = JSON.parse(call[1].body);

        console.log('Payload messages:', JSON.stringify(payload.messages, null, 2));

        const userMsg = payload.messages[0];
        // Expect strict structure: content array with type 'text' and 'image_url'
        expect(Array.isArray(userMsg.content)).toBe(true);

        // Should NOT contain empty text block if there are other attachments
        expect(userMsg.content.length).toBe(1);
        expect(userMsg.content[0].type).toBe('image_url');
        expect(userMsg.content[0].image_url.url).toBe('data:image/png;base64,FAKE_BASE64');
    });

    it('should NOT merge text file content into the same text block in a way that breaks structure', async () => {
        // This test checks my suspicion about the loop modifying contentParts[0]
        global.fetch.mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(JSON.stringify({
                choices: [{ message: { content: 'Response' } }]
            }))
        });

        const messages = [
            {
                role: 'user',
                content: 'Analyze this',
                files: [
                    { type: 'text', name: 'logs.txt', content: 'Log content' }
                ]
            }
        ];

        await chatService.sendMessage({
            provider: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: 'test-key',
            model: 'openai/gpt-4o',
            messages: messages
        });

        const call = global.fetch.mock.calls[0]; // Assuming it's the first call in this test run? 
        // Note: vitest doesn't reset mocks automatically between tests unless we configure it.
        // It's safer to check the last call or clear mocks.
    });
});
