import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webSearchService } from './webSearchService';
import { chatService } from './chatService';

describe('Brave web search', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('authenticates with Brave and normalizes web results', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ web: { results: [
                { title: 'Weather', url: 'https://example.com/weather', description: 'Paris forecast' },
                { title: 'News', url: 'https://example.com/news', description: null }
            ] } })
        });

        const results = await webSearchService.search('brave', 'Paris & weather', { apiKey: 'brave-test-key' });

        const [url, options] = fetch.mock.calls[0];
        expect(new URL(url).origin + new URL(url).pathname).toBe('https://api.search.brave.com/res/v1/web/search');
        expect(new URL(url).searchParams.get('q')).toBe('Paris & weather');
        expect(url).not.toContain('brave-test-key');
        expect(options.headers['X-Subscription-Token']).toBe('brave-test-key');
        expect(results).toEqual([
            { title: 'Weather', link: 'https://example.com/weather', snippet: 'Paris forecast' },
            { title: 'News', link: 'https://example.com/news', snippet: '' }
        ]);
    });

    it('rejects a missing key before sending a request', async () => {
        await expect(webSearchService.search('brave', 'Paris', {})).rejects.toThrow('Missing Brave Search API Key');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('returns no results when the response has no web section', async () => {
        fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
        await expect(webSearchService.search('brave', 'Paris', { apiKey: 'key' })).resolves.toEqual([]);
    });

    it('reports a Brave request failure', async () => {
        fetch.mockResolvedValue({ ok: false, status: 429, text: async () => 'Rate limit exceeded' });
        await expect(webSearchService.search('brave', 'Paris', { apiKey: 'key' }))
            .rejects.toThrow('Brave Search Error: 429 - Rate limit exceeded');
    });

    it('fetches Brave sources before calling the local model for an accepted prefix', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ web: { results: [
                { title: 'Latest headline', url: 'https://example.com/news', description: 'Retrieved news.' }
            ] } })
        }).mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ choices: [{ message: { content: 'Grounded answer.' } }] })
        });
        const result = await chatService.sendMessage({
            provider: 'local', baseUrl: 'http://localhost:1234/v1', model: 'gemma-4-31b-it',
            messages: [{ role: 'user', content: 'Search the web for current sources: latest news' }],
            options: { webSearch: true, webSearchConfig: { provider: 'brave', apiKey: 'brave-test-key' } }
        });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(new URL(fetch.mock.calls[0][0]).hostname).toBe('api.search.brave.com');
        expect(new URL(fetch.mock.calls[0][0]).searchParams.get('q')).toBe('latest news');
        expect(fetch.mock.calls[0][1].headers['X-Subscription-Token']).toBe('brave-test-key');
        expect(fetch.mock.calls[1][0]).toBe('http://localhost:1234/v1/chat/completions');
        expect(JSON.parse(fetch.mock.calls[1][1].body).messages.at(-1).content).toContain('https://example.com/news');
        expect(fetch.mock.calls[1][1].body).not.toContain('brave-test-key');
        expect(result.content).toBe('Grounded answer.');
    });
});
