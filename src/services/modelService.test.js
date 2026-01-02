import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchModels } from './modelService';

global.fetch = vi.fn();

describe('modelService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
    it('should sort GPT-5 models to the top', async () => {
        const unsortedModels = [
            { id: 'openai/gpt-4-turbo-preview', name: 'GPT-4 Turbo' },
            { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus' },
            { id: 'openai/chatgpt-5-pro', name: 'ChatGPT-5 Pro' },
            { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5' },
            { id: 'openai/gpt-5', name: 'GPT-5' },
        ];

        fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ data: unsortedModels }),
        });

        // Use includeFreeModels=true to bypass filtering for this test
        const models = await fetchModels(null, true);

        // Expected order: GPT-5/ChatGPT-5 first, then GPT-4, then others
        // gpt-5 or chatgpt-5 should be at index 0 and 1
        expect(models[0].id).toMatch(/gpt-5/);
        expect(models[1].id).toMatch(/gpt-5/);

        // gpt-4 should be after gpt-5
        expect(models[2].id).toContain('gpt-4');

        // others
        expect(models.slice(3).map(m => m.id)).toEqual(expect.arrayContaining(['anthropic/claude-3-opus', 'openai/gpt-3.5-turbo']));
    });
});
