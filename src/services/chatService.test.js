
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chatService } from './chatService';

describe('chatService', () => {
    describe('sendOpenAICompatible', () => {
        const mockParams = {
            provider: 'local',
            baseUrl: 'http://localhost:11434/v1',
            apiKey: '',
            model: 'llama3',
            messages: [{ role: 'user', content: 'hello' }]
        };

        beforeEach(() => {
            global.fetch = vi.fn();
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should handle successful response', async () => {
            const mockResponse = {
                ok: true,
                text: () => Promise.resolve(JSON.stringify({
                    choices: [{ message: { content: 'Hi there' } }]
                }))
            };
            global.fetch.mockResolvedValue(mockResponse);

            const result = await chatService.sendMessage(mockParams);
            expect(result.content).toBe('Hi there');
        });

        it('should handle API Error (404)', async () => {
            const mockResponse = {
                ok: false,
                status: 404,
                statusText: 'Not Found',
                text: () => Promise.resolve('Page not found')
            };
            global.fetch.mockResolvedValue(mockResponse);

            await expect(chatService.sendMessage(mockParams))
                .rejects.toThrow('API Error 404: Page not found');
        });

        it('should handle Empty API Error', async () => {
            const mockResponse = {
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                text: () => Promise.resolve('')
            };
            global.fetch.mockResolvedValue(mockResponse);

            await expect(chatService.sendMessage(mockParams))
                .rejects.toThrow('API Error 500: Internal Server Error');
        });

        it('should handle Empty Success Response (Unexpected end of JSON input prevention)', async () => {
            const mockResponse = {
                ok: true,
                text: () => Promise.resolve('')
            };
            global.fetch.mockResolvedValue(mockResponse);

            await expect(chatService.sendMessage(mockParams))
                .rejects.toThrow('Empty response from API');
        });

        it('should handle Malformed JSON Response', async () => {
            const mockResponse = {
                ok: true,
                text: () => Promise.resolve('INVALID JSON')
            };
            global.fetch.mockResolvedValue(mockResponse);

            await expect(chatService.sendMessage(mockParams))
                .rejects.toThrow('Failed to parse API response');
        });
    });
});
