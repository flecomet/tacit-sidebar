import { describe, it, expect } from 'vitest';
import { getOpenRouterWebFields, isOpenRouterEuEndpoint } from './openrouterPayload';

const OR_BASE = 'https://openrouter.ai/api/v1';
const EU_BASE = 'https://eu.openrouter.ai/api/v1';

describe('getOpenRouterWebFields', () => {
    it('adds the web plugin with max_results 3 when web search is on', () => {
        const { fields, webSearchUnavailable } = getOpenRouterWebFields({
            provider: 'openrouter', baseUrl: OR_BASE, webSearch: true, maxOutputTokens: 4096
        });

        expect(fields.plugins).toEqual([{ id: 'web', max_results: 3 }]);
        expect(webSearchUnavailable).toBe(false);
    });

    it('uses the catalog max output tokens when below the cap', () => {
        const { fields } = getOpenRouterWebFields({
            provider: 'openrouter', baseUrl: OR_BASE, webSearch: true, maxOutputTokens: 4096
        });

        expect(fields.max_tokens).toBe(4096);
    });

    it('caps max_tokens at 32768 when the catalog value is higher', () => {
        const { fields } = getOpenRouterWebFields({
            provider: 'openrouter', baseUrl: OR_BASE, webSearch: true, maxOutputTokens: 100000
        });

        expect(fields.max_tokens).toBe(32768);
    });

    it('uses 32768 when the catalog value is unknown', () => {
        for (const maxOutputTokens of [undefined, null, 0, NaN]) {
            const { fields } = getOpenRouterWebFields({
                provider: 'openrouter', baseUrl: OR_BASE, webSearch: true, maxOutputTokens
            });

            expect(fields.max_tokens).toBe(32768);
        }
    });

    it('sets no plugin and no max_tokens when web search is off', () => {
        const { fields } = getOpenRouterWebFields({
            provider: 'openrouter', baseUrl: OR_BASE, webSearch: false, maxOutputTokens: 4096
        });

        expect(fields).toEqual({});
        expect('max_tokens' in fields).toBe(false);
        expect('plugins' in fields).toBe(false);
    });

    it('sends no plugin on the EU endpoint and flags the web search as unavailable', () => {
        const { fields, webSearchUnavailable } = getOpenRouterWebFields({
            provider: 'openrouter', baseUrl: EU_BASE, webSearch: true, maxOutputTokens: 4096
        });

        expect(fields).toEqual({});
        expect(webSearchUnavailable).toBe(true);
    });

    it('does not flag the EU endpoint when web search is off', () => {
        const { webSearchUnavailable } = getOpenRouterWebFields({
            provider: 'openrouter', baseUrl: EU_BASE, webSearch: false
        });

        expect(webSearchUnavailable).toBe(false);
    });

    it('leaves non-OpenRouter providers untouched', () => {
        for (const provider of ['openai', 'anthropic', 'google', 'local']) {
            const result = getOpenRouterWebFields({
                provider, baseUrl: OR_BASE, webSearch: true, maxOutputTokens: 4096
            });

            expect(result).toEqual({ fields: {}, webSearchUnavailable: false });
        }
    });
});

describe('isOpenRouterEuEndpoint', () => {
    it('matches the EU hostname only', () => {
        expect(isOpenRouterEuEndpoint(EU_BASE)).toBe(true);
        expect(isOpenRouterEuEndpoint(OR_BASE)).toBe(false);
        expect(isOpenRouterEuEndpoint('https://api.openai.com/v1')).toBe(false);
    });

    it('returns false for missing or invalid URLs', () => {
        expect(isOpenRouterEuEndpoint(undefined)).toBe(false);
        expect(isOpenRouterEuEndpoint('')).toBe(false);
        expect(isOpenRouterEuEndpoint('not a url')).toBe(false);
    });
});
