import { describe, it, expect, vi } from 'vitest';
import { fetchModels } from '../services/modelService';

// Mock fetch
global.fetch = vi.fn();

describe('Model Sorting Logic', () => {
    it('should prioritize newer OpenAI models (GPT-5 > o1 > GPT-4.5 > GPT-4o)', async () => {
        const mockModels = {
            data: [
                { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo' },
                { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
                { id: 'openai/gpt-4o', name: 'GPT-4o' },
                { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
                { id: 'openai/gpt-5', name: 'GPT-5' },
                { id: 'openai/gpt-4.5-preview', name: 'GPT-4.5 Preview' },
                { id: 'openai/o1-preview', name: 'o1 Preview' },
                { id: 'openai/o1-mini', name: 'o1 Mini' }
            ]
        };

        global.fetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockModels)
        });

        // Current implementation requires apiKey and baseUrl args
        const models = await fetchModels('https://openrouter.ai/api/v1', true, 'openai', 'test-key');

        // Extract IDs for easier comparison
        const sortedIds = models.map(m => m.id);

        console.log('Sorted Models:', sortedIds);

        // Expected Order:
        // 1. gpt-5
        // 2. o1-preview
        // 3. gpt-4.5
        // 4. gpt-4o
        // ...

        const idxO1 = sortedIds.indexOf('openai/o1-preview');
        const idxGPT5 = sortedIds.indexOf('openai/gpt-5');
        const idxGPT45 = sortedIds.indexOf('openai/gpt-4.5-preview');
        const idxGPT4o = sortedIds.indexOf('openai/gpt-4o');

        // Ensure o1 is handled and at top (or near top)
        expect(idxO1).not.toBe(-1);
        expect(idxGPT5).toBeLessThan(idxO1);
        expect(idxO1).toBeLessThan(idxGPT45);
        expect(idxGPT45).toBeLessThan(idxGPT4o);
    });

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
