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
            json: async () => ({ data: unsortedModels }),
            text: async () => JSON.stringify({ data: unsortedModels }),
        });

        // Use includeFreeModels=true to bypass filtering for this test
        // Use includeFreeModels=true to bypass filtering for this test, and provider='openai'
        const models = await fetchModels(null, true, 'openai', 'sk-test');

        // Expected order: GPT-5/ChatGPT-5 first, then o1, then GPT-4, then others
        // 1. ChatGPT-5 Pro (5.2?) or just 5
        expect(models[0].id).toMatch(/gpt-5/);    // ChatGPT-5 Pro
        expect(models[1].id).toMatch(/gpt-5/);    // GPT-5

        // o1 should be after gpt-5 but before gpt-4
    });

    it('should sort models by priority: GPT-5 > o1 > GPT-4 > Others', async () => {
        const unsortedModels = [
            { id: 'openai/gpt-4-turbo-preview', name: 'GPT-4 Turbo' },
            { id: 'openai/o1-preview', name: 'o1 Preview' },
            { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus' },
            { id: 'openai/chatgpt-5-pro', name: 'ChatGPT-5 Pro' }, // Assume this is "newer" or higher version
            { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5' },
            { id: 'openai/gpt-5', name: 'GPT-5' },
            { id: 'openai/o1-mini', name: 'o1 Mini' },
            { id: 'openai/gpt-4o', name: 'GPT-4o' },
        ];

        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: unsortedModels }),
            text: async () => JSON.stringify({ data: unsortedModels }),
        });

        const models = await fetchModels(null, true, 'openai', 'sk-test');

        // Indices checking
        // Priority 1: GPT-5s
        // We aren't testing 5.1 vs 5.2 yet as IDs are generic, but 'chatgpt-5-pro' vs 'gpt-5'.
        // Let's assume lexical or simple containment for now, or just that they are top 2.
        const top2 = models.slice(0, 2).map(m => m.id);
        expect(top2).toContain('openai/chatgpt-5-pro');
        expect(top2).toContain('openai/gpt-5');

        // Priority 2: o1s
        const mid2 = models.slice(2, 4).map(m => m.id);
        expect(mid2).toContain('openai/o1-preview');
        expect(mid2).toContain('openai/o1-mini');

        // Priority 3: GPT-4s
        const low2 = models.slice(4, 6).map(m => m.id);
        expect(low2).toContain('openai/gpt-4o');
        expect(low2).toContain('openai/gpt-4-turbo-preview');

        // Priority 4: Others
        const others = models.slice(6).map(m => m.id);
        expect(others).toContain('openai/gpt-3.5-turbo');
        // expect(others).toContain('anthropic/claude-3-opus'); // Filtered out by OpenAI provider logic
    });

    it('should sort GPT versions numerically (5.2 > 5.1 > 5.0)', async () => {
        const unsortedModels = [
            { id: 'openai/gpt-5.1-turbo', name: 'GPT 5.1' },
            { id: 'openai/gpt-5', name: 'GPT 5' },
            { id: 'openai/gpt-5.2-preview', name: 'GPT 5.2' },
        ];

        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: unsortedModels }),
            text: async () => JSON.stringify({ data: unsortedModels }),
        });

        const models = await fetchModels(null, true, 'openai', 'sk-test');

        expect(models[0].id).toBe('openai/gpt-5.2-preview');
        expect(models[1].id).toBe('openai/gpt-5.1-turbo');
        expect(models[2].id).toBe('openai/gpt-5');
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
});
