import { afterEach, expect, it, vi } from 'vitest';
import { webSearchService } from '../services/webSearchService';

afterEach(() => vi.unstubAllGlobals());

it('continues to use Google Custom Search for existing configurations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [{ title: 'Weather', link: 'https://example.com', snippet: 'Forecast' }] })
    }));
    await expect(webSearchService.search('google', 'weather', { apiKey: 'old-key', cx: 'old-cx' }))
        .resolves.toEqual([{ title: 'Weather', link: 'https://example.com', snippet: 'Forecast' }]);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/customsearch/v1');
    expect(url.searchParams.get('key')).toBe('old-key');
    expect(url.searchParams.get('cx')).toBe('old-cx');
    expect(url.searchParams.get('q')).toBe('weather');
});
