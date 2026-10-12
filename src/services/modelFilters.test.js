import { describe, it, expect } from 'vitest';
import { getModalities, getModelVendor, filterModels, filterOptions, groupByReleaseMonth, formatPrice, getPriceTier, getReferenceCost, sortModels, DEFAULT_SORT } from './modelFilters';
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
    it('keeps only models in the requested price tier', () => {
        const list = [
            { id: 'a', pricing: { prompt: '0', completion: '0' } },
            { id: 'b', pricing: { prompt: '1', completion: '1' } },
            { id: 'c', pricing: { prompt: null, completion: '0' } },
        ];
        expect(ids(filterModels(list, { priceTier: 'free' }, 'openrouter'))).toEqual(['a']);
        expect(ids(filterModels(list, { priceTier: 'high' }, 'openrouter'))).toEqual(['b']);
        expect(ids(filterModels(list, { priceTier: 'unknown' }, 'openrouter'))).toEqual(['c']);
        expect(ids(filterModels(list, { priceTier: 'all' }, 'openrouter'))).toEqual(['a', 'b', 'c']);
        expect(ids(filterModels(list, {}, 'openrouter'))).toEqual(['a', 'b', 'c']);
    });
    it('composes the price tier with vendor and modality filters without mutating input', () => {
        const list = [
            { id: 'x/free-text', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
            { id: 'x/free-image', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
            { id: 'y/free-image', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
            { id: 'x/paid-image', pricing: { prompt: '0.00001', completion: '0' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
        ];
        const snapshot = JSON.parse(JSON.stringify(list));
        const out = filterModels(list, { priceTier: 'free', vendors: ['x'], input: ['image'] }, 'openrouter');
        expect(ids(out)).toEqual(['x/free-image']);
        expect(list).toEqual(snapshot);
    });
});

describe('getPriceTier', () => {
    it.each([
        [{ prompt: '0', completion: 0 }, 'free'],
        [{ prompt: 0, completion: '0' }, 'free'],
        [{ prompt: ' 0 ', completion: '0.0' }, 'free'],
        [{ prompt: null, completion: 0 }, 'unknown'],
        [{ prompt: 0, completion: undefined }, 'unknown'],
        [{ completion: 0 }, 'unknown'],
        [{ prompt: '', completion: '0' }, 'unknown'],
        [{ prompt: '   ', completion: '0' }, 'unknown'],
        [{ prompt: false, completion: 0 }, 'unknown'],
        [{ prompt: true, completion: '0' }, 'unknown'],
        [{ prompt: '-1', completion: '-1' }, 'unknown'],
        [{ prompt: 0, completion: -1 }, 'unknown'],
        [{ prompt: 'Infinity', completion: '0' }, 'unknown'],
        [{ prompt: 0, completion: Infinity }, 'unknown'],
        [{ prompt: 'abc', completion: '0' }, 'unknown'],
        [undefined, 'unknown'],
        [null, 'unknown'],
        [{ prompt: '0', completion: '0.000001' }, 'budget'],
        [{ prompt: '0', completion: '0.000004' }, 'budget'],
        [{ prompt: '0', completion: '0.000005' }, 'mid'],       // reference cost $0.01
        [{ prompt: '0.000001', completion: '0' }, 'mid'],       // reference cost $0.01
        [{ prompt: '0.000009', completion: '0' }, 'mid'],
        [{ prompt: '0.00001', completion: '0' }, 'high'],       // reference cost $0.10
        [{ prompt: '0', completion: '0.00005' }, 'high'],       // reference cost $0.10
        [{ prompt: '0', completion: '0', request: '0.01' }, 'unknown'],
        [{ prompt: '0.000001', completion: '0', image: '0.001' }, 'unknown'],
        [{ prompt: '0', completion: '0', audio: 0.5 }, 'unknown'],
        [{ prompt: '0', completion: '0', input_audio: '0.1' }, 'unknown'],
        [{ prompt: '0', completion: '0', output_audio: '0.1' }, 'unknown'],
        [{ prompt: '0', completion: '0', request: '0', image: '0' }, 'free'],
        [{ prompt: '0', completion: '0', request: null }, 'free'],
        [{ prompt: '0', completion: '0', request: '' }, 'unknown'],
    ])('%j belongs to %s', (pricing, tier) => {
        expect(getPriceTier(pricing)).toBe(tier);
    });
    it('does not read the pricing object destructively', () => {
        const pricing = Object.freeze({ prompt: '0', completion: '0' });
        expect(getPriceTier(pricing)).toBe('free');
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
    it('counts every price tier with the same classifier as the filter, including empty tiers', () => {
        const list = [
            { id: 'a', pricing: { prompt: '0', completion: '0' } },
            { id: 'b', pricing: { prompt: '0', completion: '0', request: '0.01' } },
            { id: 'c', pricing: { prompt: '-1', completion: '-1' } },
            { id: 'd', pricing: { prompt: '0.00001', completion: '0' } },
        ];
        expect(filterOptions(list, 'openrouter').priceTiers).toEqual({ free: 1, budget: 0, mid: 0, high: 1, unknown: 2 });
        expect(filterOptions(list, 'openrouter')).not.toHaveProperty('hasFree');
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
        [{ prompt: '0', completion: '0', request: '0.001' }, '$0/$0'],   // extra charge → unknown tier, not Free
        [{ prompt: '-1', completion: '-1' }, ''],   // router placeholder, negative
        [undefined, ''],
        [{ prompt: null, completion: null }, ''],
        [{ prompt: '', completion: '0' }, ''],
        [{ completion: '0.00001' }, ''],
    ])('%j → %s', (pricing, label) => expect(formatPrice(pricing)).toBe(label));
});

describe('getReferenceCost', () => {
    it('is the USD cost of 10,000 input plus 2,000 output tokens', () => {
        expect(getReferenceCost({ prompt: '0.000002', completion: '0.00001' })).toBeCloseTo(0.04, 10);
    });

    it('is zero for a free text price', () => {
        expect(getReferenceCost({ prompt: '0', completion: '0' })).toBe(0);
    });

    it('is null when a text price is missing or invalid', () => {
        expect(getReferenceCost(undefined)).toBeNull();
        expect(getReferenceCost({ prompt: '-1', completion: '0.00001' })).toBeNull();
        expect(getReferenceCost({ prompt: '0.000002', completion: '' })).toBeNull();
    });

    it('ignores extra charges (the tier classifier, not the cost, decides those)', () => {
        expect(getReferenceCost({ prompt: '0', completion: '0', image: '0.01' })).toBe(0);
    });
});

describe('groupByReleaseMonth direction', () => {
    const OCT = Date.UTC(2026, 9, 5) / 1000;
    const SEP = Date.UTC(2026, 8, 15) / 1000;
    const models = [
        { id: 'new', created: OCT },
        { id: 'undated-1' },
        { id: 'old', created: SEP },
        { id: 'undated-2' },
    ];

    it('oldest month first when dir is asc, undated still last in original order', () => {
        expect(groupByReleaseMonth(models, 'asc').map(g => g.models.map(m => m.id))).toEqual([
            ['old'], ['new'], ['undated-1', 'undated-2'],
        ]);
    });

    it('keeps the default (newest first, undated last) when dir is omitted', () => {
        expect(groupByReleaseMonth(models).map(g => g.models.map(m => m.id))).toEqual([
            ['new'], ['old'], ['undated-1', 'undated-2'],
        ]);
    });

    it('keeps descending timestamps inside a month and only reverses month groups for asc', () => {
        const at = (y, m, d) => Date.UTC(y, m - 1, d) / 1000;
        const list = [
            { id: 'sep-early', created: at(2026, 9, 2) },
            { id: 'aug-late', created: at(2026, 8, 29) },
            { id: 'sep-late', created: at(2026, 9, 29) },
            { id: 'aug-early', created: at(2026, 8, 1) },
            { id: 'undated-a' },
            { id: 'undated-b' },
        ];
        expect(groupByReleaseMonth(list).map(g => [g.label, ids(g.models)])).toEqual([
            ['September 2026', ['sep-late', 'sep-early']],
            ['August 2026', ['aug-late', 'aug-early']],
            ['Undated', ['undated-a', 'undated-b']],
        ]);
        expect(groupByReleaseMonth(list, 'asc').map(g => [g.label, ids(g.models)])).toEqual([
            ['August 2026', ['aug-late', 'aug-early']],
            ['September 2026', ['sep-late', 'sep-early']],
            ['Undated', ['undated-a', 'undated-b']],
        ]);
    });
});

describe('sortModels', () => {
    const SEP = Date.UTC(2026, 8, 15) / 1000;
    const AUG = Date.UTC(2026, 7, 15) / 1000;
    const model = (id, name, prompt, completion, created, extra = {}) =>
        ({ id, name, created, pricing: { prompt, completion, ...extra } });
    const MODELS = [
        model('a/mid', 'Mid', '0.000002', '0.00001', SEP),                  // cost 0.04
        model('b/free', 'Free', '0', '0', undefined),                       // cost 0, undated
        model('c/budget', 'Budget', '0.0000005', '0.000001', AUG),          // cost 0.007
        model('d/unknown', 'Unknown', '-1', '-1', AUG),                     // invalid price
        model('e/extra', 'Extra', '0', '0.000001', AUG, { image: '0.01' }), // extra charge → unknown
        model('f/high', 'High', '0.00001', '0.00005', SEP),                 // cost 0.2
    ];
    const ids = (list) => list.map(m => m.id);

    it('sorts by price ascending: cheapest first, unknown prices last by ID', () => {
        expect(ids(sortModels(MODELS, { key: 'price', dir: 'asc' }))).toEqual([
            'b/free', 'c/budget', 'a/mid', 'f/high', 'd/unknown', 'e/extra',
        ]);
    });

    it('sorts by price descending but still puts unknown prices last by ID', () => {
        expect(ids(sortModels(MODELS, { key: 'price', dir: 'desc' }))).toEqual([
            'f/high', 'a/mid', 'c/budget', 'b/free', 'd/unknown', 'e/extra',
        ]);
    });

    it('sorts by release month, keeps ties in source order, and puts undated models last both ways', () => {
        const released = (dir) => ids(sortModels(MODELS, { key: 'released', dir }));
        expect(released('asc')).toEqual(['c/budget', 'd/unknown', 'e/extra', 'a/mid', 'f/high', 'b/free']);
        expect(released('desc')).toEqual(['a/mid', 'f/high', 'c/budget', 'd/unknown', 'e/extra', 'b/free']);
    });

    it('sorts by name case-insensitively with numeric runs', () => {
        const named = [{ id: 'x2', name: 'model 10' }, { id: 'x1', name: 'Model 9' }, { id: 'x3', name: 'alpha' }];
        expect(ids(sortModels(named, { key: 'name', dir: 'asc' }))).toEqual(['x3', 'x1', 'x2']);
        expect(ids(sortModels(named, { key: 'name', dir: 'desc' }))).toEqual(['x2', 'x1', 'x3']);
    });

    it('breaks equal prices by model ID regardless of display name and direction', () => {
        const tied = [
            model('b/tie', 'Alpha', '0.000002', '0.00001', undefined),
            model('a/tie', 'Zulu', '0.000002', '0.00001', undefined),
        ];
        expect(ids(sortModels(tied, { key: 'price', dir: 'asc' }))).toEqual(['a/tie', 'b/tie']);
        expect(ids(sortModels(tied, { key: 'price', dir: 'desc' }))).toEqual(['a/tie', 'b/tie']);
    });

    it('keeps release-month ties in source order in both directions', () => {
        const tied = [
            model('z/same', 'Same', '0', '0', SEP),
            model('y/same', 'Same', '0', '0', SEP),
        ];
        expect(ids(sortModels(tied, { key: 'released', dir: 'asc' }))).toEqual(['z/same', 'y/same']);
        expect(ids(sortModels(tied, { key: 'released', dir: 'desc' }))).toEqual(['z/same', 'y/same']);
    });

    it('orders price ties and unknown prices by ID even when names oppose the IDs', () => {
        const adversarial = [
            model('b/tie', 'Alpha cheapest', '0.000002', '0.00001', undefined),
            model('a/tie', 'Zulu cheapest', '0.000002', '0.00001', undefined),
            model('d/unknown', 'Alpha unknown', '-1', '-1', undefined),
            model('c/unknown', 'Zulu unknown', '-1', '-1', undefined),
        ];
        expect(ids(sortModels(adversarial, { key: 'price', dir: 'asc' })))
            .toEqual(['a/tie', 'b/tie', 'c/unknown', 'd/unknown']);
        expect(ids(sortModels(adversarial, { key: 'price', dir: 'desc' })))
            .toEqual(['a/tie', 'b/tie', 'c/unknown', 'd/unknown']);
    });

    it('keeps several undated models in source order even when names oppose it', () => {
        const undated = [
            model('u3', 'Alpha', '0', '0', undefined),
            model('u1', 'Zulu', '0', '0', undefined),
            model('u2', 'Mike', '0', '0', undefined),
        ];
        expect(ids(sortModels(undated, { key: 'released', dir: 'asc' }))).toEqual(['u3', 'u1', 'u2']);
        expect(ids(sortModels(undated, { key: 'released', dir: 'desc' }))).toEqual(['u3', 'u1', 'u2']);
    });

    it('keeps the input order for the default key and never mutates the input', () => {
        const before = ids(MODELS);
        expect(ids(sortModels(MODELS, { key: 'default' }))).toEqual(before);
        sortModels(MODELS, { key: 'price', dir: 'desc' });
        expect(ids(MODELS)).toEqual(before);
    });

    it('defaults to the default order', () => {
        expect(DEFAULT_SORT).toEqual({ key: 'default', dir: 'asc' });
    });
});
