import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchModels, clearModelCache } from './modelService';

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

    it('should fetch and return all models if includeFreeModels is true', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ data: mockModels }),
        });

        const models = await fetchModels(null, true);
        expect(models).toHaveLength(4);
        expect(models.map(m => m.id)).toContain('free-model-1');
    });

    it('should filter out free models if includeFreeModels is false (default)', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ data: mockModels }),
        });

        const models = await fetchModels(null, false);
        expect(models).toHaveLength(2);
        expect(models.map(m => m.id)).toContain('paid-model');
        expect(models.map(m => m.id)).toContain('semi-free');
        expect(models.map(m => m.id)).not.toContain('free-model-1');
        expect(models.map(m => m.id)).not.toContain('free-model-2');
    });

    it('should filter out free models if includeFreeModels is not provided', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ data: mockModels }),
        });

        const models = await fetchModels(null);
        expect(models).toHaveLength(2);
        expect(models.map(m => m.id)).not.toContain('free-model-1');
    });

    it('should tag models as Local and skip filtering when isLocal is true', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ data: mockModels }),
        });

        const localUrl = 'http://localhost:11434';
        const models = await fetchModels(localUrl, false, 'local');

        expect(models).toHaveLength(4); // Should include all, even free ones
        expect(models[0]).toHaveProperty('_category', 'Local');
        expect(fetch).toHaveBeenCalledWith('http://localhost:11434/models', expect.objectContaining({ headers: {} }));
    });

    it('should include Authorization header when apiKey is provided', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ data: mockModels }),
        });

        await fetchModels(null, false, 'openrouter', 'sk-test-key');

        expect(fetch).toHaveBeenCalledWith(
            'https://openrouter.ai/api/v1/models',
            expect.objectContaining({
                headers: expect.objectContaining({
                    'Authorization': 'Bearer sk-test-key'
                })
            })
        );
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
        const models = await fetchModels(null, true, 'openai', 'sk-test');

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

        const models = await fetchModels(null, false, 'google', 'g-key');

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

        const models = await fetchModels(null, true, 'openai', 'sk-test');

        expect(models.map(m => m.id)).toEqual(['gpt-next', 'o9-mini', 'gpt-old']);
    });
});
