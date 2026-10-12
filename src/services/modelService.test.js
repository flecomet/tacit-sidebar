import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchModels, clearModelCache } from './modelService';
import { loadPriceCatalog } from './priceCatalog';

vi.mock('./priceCatalog', async (importOriginal) => ({
    ...(await importOriginal()),
    loadPriceCatalog: vi.fn().mockResolvedValue(null),
}));

global.fetch = vi.fn();

describe('modelService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearModelCache(); // Clear model cache between tests
    });

    const mockModels = [
        { id: 'paid-model', pricing: { prompt: '0.00001', completion: '0.00003' } },
        { id: 'free-model-1', pricing: { prompt: '0', completion: '0' } },
        { id: 'free-model-2', pricing: { prompt: 0, completion: 0 } },
        { id: 'semi-free', pricing: { prompt: '0', completion: '0.0001' } }, // Not fully free
    ];

    const EU = 'https://eu.openrouter.ai/api/v1';
    const ok = (body) => ({ ok: true, text: async () => JSON.stringify(body), json: async () => body });

    it('requests the personalized EU list with the bearer key', async () => {
        fetch.mockResolvedValueOnce(ok({ data: mockModels }));
        await fetchModels(EU, 'openrouter', 'test-key');
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(
            'https://eu.openrouter.ai/api/v1/models/user',
            expect.objectContaining({ headers: { Authorization: 'Bearer test-key' } })
        );
    });

    it('makes no request for OpenRouter without a key', async () => {
        expect(await fetchModels(EU, 'openrouter')).toEqual([]);
        expect(await fetchModels(EU, 'openrouter', '')).toEqual([]);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('keeps free and paid models', async () => {
        fetch.mockResolvedValueOnce(ok({ data: mockModels }));
        const models = await fetchModels(EU, 'openrouter', 'k');
        expect(models.map(m => m.id)).toEqual(['paid-model', 'free-model-1', 'free-model-2', 'semi-free']);
        expect(models[1].pricing).toEqual({ prompt: '0', completion: '0' });
    });

    it('accepts a valid empty authorized list', async () => {
        fetch.mockResolvedValueOnce(ok({ data: [] }));
        expect(await fetchModels(EU, 'openrouter', 'k')).toEqual([]);
    });

    it.each([{}, { data: null }, { data: {} }, { data: 'x' }])('rejects a malformed response %j and does not cache it', async (body) => {
        fetch.mockResolvedValueOnce(ok(body));
        await expect(fetchModels(EU, 'openrouter', 'k')).rejects.toThrow();
        fetch.mockResolvedValueOnce(ok({ data: [{ id: 'm' }] }));
        expect((await fetchModels(EU, 'openrouter', 'k')).map(m => m.id)).toEqual(['m']);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each([401, 403, 500])('fails on status %i without falling back to /models', async (status) => {
        fetch.mockResolvedValueOnce({ ok: false, status, statusText: 'x', text: async () => 'secret-body' });
        await expect(fetchModels(EU, 'openrouter', 'k')).rejects.toThrow(String(status));
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).toBe(`${EU}/models/user`);
    });

    it('isolates the cache by key and base URL', async () => {
        fetch.mockImplementation(async (url, init) => ok({ data: [{ id: `${url}|${init.headers.Authorization}` }] }));
        const a = await fetchModels(EU, 'openrouter', 'key-a');
        const b = await fetchModels(EU, 'openrouter', 'key-b');
        const c = await fetchModels('https://other.example/api/v1', 'openrouter', 'key-a');
        const a2 = await fetchModels(EU, 'openrouter', 'key-a');
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(new Set([a[0].id, b[0].id, c[0].id]).size).toBe(3);
        expect(a2).toEqual(a);
    });

    it('should tag models as Local and skip filtering when isLocal is true', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ data: mockModels }),
        });

        const localUrl = 'http://localhost:11434';
        const models = await fetchModels(localUrl, 'local');

        expect(models).toHaveLength(4); // Should include all, even free ones
        expect(models[0]).toHaveProperty('_category', 'Local');
        expect(fetch).toHaveBeenCalledWith('http://localhost:11434/models', expect.objectContaining({ headers: {} }));
    });

    it.each(['', null, undefined])('keeps an empty local address %s on the default local server', async (url) => {
        fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ data: [{ id: 'local-model' }] }),
        });

        const models = await fetchModels(url, 'local');

        expect(fetch).toHaveBeenCalledWith('http://localhost:11434/v1/models', { headers: {} });
        expect(models).toEqual([{ id: 'local-model', _category: 'Local' }]);
    });

    it('should categorize models correctly (gpt-5 and o1 as Performance)', async () => {
        const inputModels = [
            { id: 'openai/gpt-5', name: 'GPT 5' },
            { id: 'openai/o1-mini', name: 'o1 Mini' },
            { id: 'openai/gpt-4-turbo', name: 'GPT 4 Turbo' },
            { id: 'openai/gpt-4o-mini', name: 'GPT 4o Mini' },
            { id: 'openai/gpt-5-turbo', name: 'GPT 5 Turbo' } // "Turbo" typically makes it small in generic logic, but gpt-5 should override
        ];

        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: inputModels }),
            text: async () => JSON.stringify({ data: inputModels })
        });

        // Using 'openai' provider where mapping happens explicitly using getModelCategory logic
        const models = await fetchModels(null, 'openai', 'sk-test');

        const gpt5 = models.find(m => m.id === 'openai/gpt-5');
        const o1Mini = models.find(m => m.id === 'openai/o1-mini');
        const gpt4Turbo = models.find(m => m.id === 'openai/gpt-4-turbo');
        const gpt4oMini = models.find(m => m.id === 'openai/gpt-4o-mini');
        const gpt5Turbo = models.find(m => m.id === 'openai/gpt-5-turbo');

        expect(gpt5._category).toBe('Performance');
        expect(gpt4Turbo._category).toBe('Performance');
        expect(gpt5Turbo._category).toBe('Performance');

        expect(gpt4oMini._category).toBe('Small');
        expect(o1Mini._category).toBe('Small');
    });

    it('pages through Google models and sends the key as a header', async () => {
        fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [{ name: 'models/gemini-x-pro', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'p2' }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [{ name: 'models/gemma-9-27b-it', supportedGenerationMethods: ['generateContent'] }] }) });

        const models = await fetchModels(null, 'google', 'g-key');

        expect(models.map(m => m.id)).toEqual(['gemini-x-pro', 'gemma-9-27b-it']);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[1][0]).toContain('pageToken=p2');
        expect(fetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('g-key');
        expect(fetch.mock.calls[0][0]).not.toContain('g-key');
    });

    it('sorts OpenAI models newest first and drops non-chat models', async () => {
        const data = { data: [
            { id: 'gpt-old', created: 1 },
            { id: 'whisper-1', created: 5 },
            { id: 'o9-mini', created: 3 },
            { id: 'gpt-next', created: 4 },
        ] };
        fetch.mockResolvedValueOnce({ ok: true, json: async () => data, text: async () => JSON.stringify(data) });

        const models = await fetchModels(null, 'openai', 'sk-test');

        expect(models.map(m => m.id)).toEqual(['gpt-next', 'o9-mini', 'gpt-old']);
    });

    it('does not reuse the cached list for a different key of the same length', async () => {
        fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'gpt-a', created: 2 }] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'gpt-b', created: 1 }] }) });
        const a = await fetchModels('', 'openai', 'sk-aaaa');
        const b = await fetchModels('', 'openai', 'sk-bbbb');
        expect(a.map(m => m.id)).toEqual(['gpt-a']);
        expect(b.map(m => m.id)).toEqual(['gpt-b']);
    });

    it('adds catalog prices and modalities to direct-provider models', async () => {
        vi.mocked(loadPriceCatalog).mockResolvedValueOnce(new Map([['anthropic/claude-sonnet-5.5', {
            id: 'anthropic/claude-sonnet-5.5',
            pricing: { prompt: '0.000002', completion: '0.00001' },
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            created: 1,
        }]]));
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-09-29T00:00:00Z', capabilities: { image_input: { supported: true } } }] }),
        });
        const [m] = await fetchModels('', 'anthropic', 'sk-ant');
        expect(m.pricing).toEqual({ prompt: '0.000002', completion: '0.00001' });
        expect(m.architecture.output_modalities).toEqual(['text']);
    });

    it('still lists models when the price catalog fails', async () => {
        vi.mocked(loadPriceCatalog).mockRejectedValueOnce(new Error('HTTP 403'));
        fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'gpt-x', created: 1 }] }) });
        const models = await fetchModels('', 'openai', 'sk-1');
        expect(models.map(m => m.id)).toEqual(['gpt-x']);
    });
});
