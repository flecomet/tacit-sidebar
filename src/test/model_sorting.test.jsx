import { describe, it, expect, vi } from 'vitest';
import { fetchModels } from '../services/modelService';

// Mock fetch
global.fetch = vi.fn();

describe('Model Sorting Logic', () => {
    it('should NOT apply OpenAI sorting to OpenRouter models (preserve default order)', async () => {
        const mockModels = {
            data: [
                { id: 'openai/gpt-4o', name: 'GPT-4o' },
                { id: 'openai/gpt-5', name: 'GPT-5' }
            ]
        };

        global.fetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockModels),
            text: () => Promise.resolve(JSON.stringify(mockModels))
        });

        // Provider is 'openrouter'
        const models = await fetchModels('https://openrouter.ai/api/v1', true, 'openrouter', 'test-key');
        const sortedIds = models.map(m => m.id);

        // OpenAI sorting would put GPT-5 first. Default/Original order puts GPT-4o first.
        // We expect the original order to be preserved.
        expect(sortedIds[0]).toBe('openai/gpt-4o');
        expect(sortedIds[1]).toBe('openai/gpt-5');
    });
});
