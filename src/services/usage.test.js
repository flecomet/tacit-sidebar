import { describe, it, expect } from 'vitest';
import { normalizeUsage, computeCost, sessionCost, formatCost } from './usage';

describe('normalizeUsage', () => {
    it.each([
        [{ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, { input: 10, output: 5, total: 15 }], // OpenAI, OpenRouter
        [{ input_tokens: 7, output_tokens: 3 }, { input: 7, output: 3, total: 10 }],                         // Anthropic, Responses, Google
        [{ total_tokens: 4 }, { input: 0, output: 0, total: 4 }],
        [undefined, { input: 0, output: 0, total: 0 }],
    ])('%j', (usage, expected) => expect(normalizeUsage(usage)).toEqual(expected));
});

describe('computeCost', () => {
    const PRICES = { prompt: '0.000003', completion: '0.000015' };
    it('prefers the cost the provider reports', () => expect(computeCost({ cost: 0.0123, prompt_tokens: 1 }, PRICES)).toBe(0.0123));
    it('keeps a reported cost of 0 (free model)', () => expect(computeCost({ cost: 0 }, PRICES)).toBe(0));
    it('estimates from per-token prices', () =>
        expect(computeCost({ input_tokens: 1000, output_tokens: 500 }, PRICES)).toBeCloseTo(0.0105, 10));
    it('returns null without prices', () => expect(computeCost({ input_tokens: 1 }, undefined)).toBeNull());
    it('returns null for router placeholder prices (-1)', () =>
        expect(computeCost({ input_tokens: 1, output_tokens: 1 }, { prompt: '-1', completion: '-1' })).toBeNull());
});

describe('sessionCost', () => {
    it('sums known reply costs', () => {
        expect(sessionCost([
            { role: 'user', content: 'a' },
            { role: 'assistant', metadata: { cost: 0.01 } },
            { role: 'assistant', metadata: { cost: null } },
            { role: 'assistant', metadata: { cost: 0.0023 } },
        ])).toBeCloseTo(0.0123, 10);
    });
    it('is 0 for an empty chat', () => expect(sessionCost(undefined)).toBe(0));
});

describe('formatCost', () => {
    it.each([[0.00005, '<$0.0001'], [0.0123, '$0.0123'], [1.5, '$1.50']])('%s → %s', (n, s) => expect(formatCost(n)).toBe(s));
});
