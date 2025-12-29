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
});
