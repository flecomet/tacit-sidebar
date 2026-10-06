import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadPriceCatalog, clearPriceCatalog, catalogCandidates, findCatalogEntry, enrichFromCatalog } from './priceCatalog';
import { normalizeAnthropic, normalizeOpenAI, supportsImageInput } from './modelCatalog';
import openrouterFixture from './__fixtures__/openrouter-models.json';
import anthropicFixture from './__fixtures__/anthropic-models.json';
import openaiFixture from './__fixtures__/openai-models.json';

const catalog = new Map(openrouterFixture.data.map(m => [m.id, m]));
const NOW = Date.parse('2026-10-03T00:00:00Z');
const HOUR = 60 * 60 * 1000;

describe('loadPriceCatalog', () => {
    beforeEach(() => { clearPriceCatalog(); global.fetch = vi.fn(); });

    it('downloads the public catalog without a key and reuses it', async () => {
        fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 'openai/gpt-x' }] }) });
        await loadPriceCatalog(1000);
        const again = await loadPriceCatalog(2000);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models');
        expect(again.get('openai/gpt-x')).toEqual({ id: 'openai/gpt-x' });
    });

    it('refreshes after an hour', async () => {
        fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
        await loadPriceCatalog(0);
        await loadPriceCatalog(HOUR + 1);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not cache a failure', async () => {
        fetch
            .mockResolvedValueOnce({ ok: false, status: 403 })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
        await expect(loadPriceCatalog(0)).rejects.toThrow('HTTP 403');
        await expect(loadPriceCatalog(1)).resolves.toBeInstanceOf(Map);
    });
});

describe('catalog matching (live fixtures)', () => {
    it('maps dashed versions and dated snapshots to catalog ids', () => {
        expect(catalogCandidates('anthropic', 'claude-sonnet-5-5')).toContain('anthropic/claude-sonnet-5.5');
        expect(catalogCandidates('openai', 'gpt-4.1-2025-04-14')).toContain('openai/gpt-4.1');
        expect(catalogCandidates('anthropic', 'claude-x-4-20250514')).toContain('anthropic/claude-x-4');
    });

    it('finds every Anthropic model and most OpenAI models', () => {
        const anthropic = normalizeAnthropic(anthropicFixture);
        expect(anthropic.filter(m => !findCatalogEntry(catalog, 'anthropic', m.id))).toEqual([]);
        const openai = normalizeOpenAI(openaiFixture, NOW);
        const found = openai.filter(m => findCatalogEntry(catalog, 'openai', m.id));
        expect(found.length / openai.length).toBeGreaterThan(0.8);
    });

    it('keeps provider data and fills only the gaps', () => {
        const [a] = enrichFromCatalog([{ id: 'claude-sonnet-5-5', created: 5, supportsImages: true }], 'anthropic', catalog);
        expect(a.created).toBe(5);
        expect(a.pricing).toMatchObject({ prompt: '0.000002', completion: '0.00001' });
        expect(a.architecture.output_modalities).toEqual(['text']);

        const [g] = enrichFromCatalog([{ id: 'gemini-3.1-flash-image', supportsImages: null }], 'google', catalog);
        expect(g.created).toBe(1781754065);
        expect(g.architecture.output_modalities).toEqual(['image', 'text']);
        expect(supportsImageInput(g)).toBe(true);
    });

    it('returns models unchanged without a catalog or a match', () => {
        const models = [{ id: 'chat-latest' }];
        expect(enrichFromCatalog(models, 'openai', null)).toBe(models);
        expect(enrichFromCatalog(models, 'openai', catalog)[0]).toEqual({ id: 'chat-latest' });
    });
});
