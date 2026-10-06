import { describe, it, expect } from 'vitest';
import { getModalities, getModelVendor, filterModels, filterOptions, groupByReleaseMonth, formatPrice } from './modelFilters';
import { normalizeOpenRouter } from './modelCatalog';
import openrouterFixture from './__fixtures__/openrouter-models.json';

const models = normalizeOpenRouter(openrouterFixture.data);
const ids = (list) => list.map(m => m.id);

describe('getModalities', () => {
    it('reads OpenRouter architecture', () => {
        expect(getModalities({ architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }))
            .toEqual({ input: ['text', 'image'], output: ['text'] });
    });
    it('derives input from supportsImages when there is no architecture', () => {
        expect(getModalities({ supportsImages: true })).toEqual({ input: ['text', 'image'], output: null });
        expect(getModalities({ supportsImages: false })).toEqual({ input: ['text'], output: null });
    });
    it('is unknown without data', () => {
        expect(getModalities(undefined)).toEqual({ input: null, output: null });
    });
});

describe('filterModels (live OpenRouter fixture)', () => {
    it('requires every selected input type', () => {
        const out = filterModels(models, { input: ['image', 'file'] }, 'openrouter');
        expect(out.length).toBeGreaterThan(0);
        expect(out.every(m => ['image', 'file'].every(x => m.architecture.input_modalities.includes(x)))).toBe(true);
    });
    it('filters on output type', () => {
        const out = ids(filterModels(models, { output: ['image'] }, 'openrouter'));
        expect(out).toContain('google/gemini-3.1-flash-image');
        expect(out).not.toContain('openai/gpt-6.1-sol');
    });
    it('filters on vendor', () => {
        const out = filterModels(models, { vendors: ['anthropic'] }, 'openrouter');
        expect(out.length).toBeGreaterThan(0);
        expect(out.every(m => m.id.startsWith('anthropic/'))).toBe(true);
    });
    it('hides models with unknown modalities only while a modality filter is on', () => {
        const unknown = [{ id: 'gemini-x', supportsImages: null }];
        expect(filterModels(unknown, {}, 'google')).toHaveLength(1);
        expect(filterModels(unknown, { input: ['image'] }, 'google')).toHaveLength(0);
    });
    it('keeps only free models with freeOnly', () => {
        const list = [{ id: 'a', pricing: { prompt: '0', completion: '0' } }, { id: 'b', pricing: { prompt: '1', completion: '1' } }];
        expect(ids(filterModels(list, { freeOnly: true }, 'openrouter'))).toEqual(['a']);
    });
});

describe('filterOptions', () => {
    it('lists the types and vendors present, in a stable order', () => {
        const o = filterOptions(models, 'openrouter');
        expect(o.inputs).toEqual(['text', 'image', 'file', 'audio', 'video']);
        expect(o.outputs).toEqual(['text', 'image', 'audio']);
        expect(o.vendors).toEqual(expect.arrayContaining(['openai', 'anthropic', 'google']));
    });
    it('has a single vendor for direct providers', () => {
        expect(filterOptions([{ id: 'gpt-x' }, { id: 'gpt-y' }], 'openai').vendors).toEqual(['openai']);
        expect(getModelVendor({ id: 'gpt-x' }, 'openai')).toBe('openai');
    });
});

describe('groupByReleaseMonth', () => {
    it('groups newest month first, undated last, newest first inside a month', () => {
        const at = (y, m, d) => Date.UTC(y, m - 1, d) / 1000;
        const groups = groupByReleaseMonth([
            { id: 'aug', created: at(2026, 8, 1) },
            { id: 'nodate' },
            { id: 'sep-early', created: at(2026, 9, 2) },
            { id: 'sep-late', created: at(2026, 9, 29) },
        ]);
        expect(groups.map(g => g.label)).toEqual(['September 2026', 'August 2026', 'Undated']);
        expect(ids(groups[0].models)).toEqual(['sep-late', 'sep-early']);
    });
});

describe('formatPrice', () => {
    it.each([
        [{ prompt: '0.000002', completion: '0.00001' }, '$2/$10'],
        [{ prompt: '0.0000001', completion: '0.0000005' }, '$0.1/$0.5'],
        [{ prompt: '0.0000005', completion: '0.000003' }, '$0.5/$3'],
        [{ prompt: '0', completion: '0' }, 'Free'],
        [{ prompt: '-1', completion: '-1' }, ''],   // router placeholder, negative
        [undefined, ''],
    ])('%j → %s', (pricing, label) => expect(formatPrice(pricing)).toBe(label));
});
