import { describe, it, expect } from 'vitest';
import {
    normalizeOpenAI, normalizeAnthropic, normalizeGoogle, normalizeOpenRouter,
    getModelCategory, supportsImageInput
} from './modelCatalog';
import openaiFixture from './__fixtures__/openai-models.json';
import anthropicFixture from './__fixtures__/anthropic-models.json';
import googleFixture from './__fixtures__/google-models.json';
import openrouterFixture from './__fixtures__/openrouter-models.json';

const NOW = Date.parse('2026-10-03T00:00:00Z');

describe('normalizeOpenAI (live fixture)', () => {
    const models = normalizeOpenAI(openaiFixture, NOW);
    const ids = models.map(m => m.id);

    it('keeps current chat models', () => {
        expect(ids).toEqual(expect.arrayContaining(['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra', 'gpt-5.6-terra']));
    });
    it('keeps chat models the old gpt|o1 allow-list missed', () => {
        expect(ids).toContain('chat-latest');
    });
    it('drops non-chat and Responses-only models', () => {
        for (const id of ['gpt-transcribe', 'gpt-live-1', 'gpt-realtime-2.1', 'gpt-audio-1.5', 'gpt-image-2.5-flare',
            'text-embedding-3-small', 'omni-moderation-latest', 'sora-2', 'gpt-5.5-pro', 'gpt-5.3-codex']) {
            expect(ids).not.toContain(id);
        }
    });
    it('hides dated snapshots that have an alias', () => {
        expect(ids).toContain('gpt-5.5');
        expect(ids).not.toContain('gpt-5.5-2026-04-23');
    });
    it('sorts newest first', () => {
        const created = models.map(m => m.created);
        expect(created).toEqual([...created].sort((a, b) => b - a));
    });
    it('drops models past shutdown_date', () => {
        expect(ids).not.toContain('gpt-5.3-chat-latest'); // shutdown_date 2026-08-10 in the fixture
        expect(normalizeOpenAI({ data: [{ id: 'gpt-x', created: 1, shutdown_date: '2026-01-01' }] }, NOW)).toEqual([]);
    });
});

describe('normalizeAnthropic (live fixture)', () => {
    const models = normalizeAnthropic(anthropicFixture);
    it('reads image support and output limits from capabilities', () => {
        expect(models.length).toBeGreaterThan(0);
        expect(models.every(m => typeof m.supportsImages === 'boolean')).toBe(true);
        expect(models.every(m => m.maxOutputTokens > 0)).toBe(true);
    });
    it('categorises by tier word, not generation', () => {
        const haiku = models.find(m => m.id.includes('haiku'));
        const opus = models.find(m => m.id.includes('opus'));
        expect(getModelCategory(haiku)).toBe('Small');
        expect(getModelCategory(opus)).toBe('Performance');
    });
});

describe('normalizeGoogle (live fixture)', () => {
    const ids = normalizeGoogle(googleFixture.models).map(m => m.id);
    it('keeps generateContent chat models including Gemma and image-output models', () => {
        expect(ids).toEqual(expect.arrayContaining(['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemma-4-31b-it', 'gemini-3.1-flash-image']));
    });
    it('drops audio, music, video, embedding and agent-only models', () => {
        for (const id of ['gemini-3.8-flash-tts', 'gemini-3.8-live', 'lyria-3.5', 'veo-3.1-generate-preview', 'gemini-embedding-2',
            'gemini-3.5-transcribe', 'antigravity-preview-latest', 'deep-research-max-preview-04-2026']) {
            expect(ids).not.toContain(id);
        }
    });
});

describe('normalizeOpenRouter (live fixture)', () => {
    const models = normalizeOpenRouter(openrouterFixture.data);
    it('derives image support from architecture for every model', () => {
        expect(models.every(m => typeof m.supportsImages === 'boolean')).toBe(true);
    });
});

describe('getModelCategory', () => {
    it.each([
        [{ id: 'x/free', pricing: { prompt: '0', completion: '0' } }, 'Free'],
        [{ id: 'x/cheap', pricing: { prompt: '0.0000001', completion: '0.0000004' } }, 'Small'],
        [{ id: 'google/gemini-3.1-pro-preview' }, 'Performance'],
        [{ id: 'gemini-3.8-flash' }, 'Small'],
        [{ id: 'gemma-4-26b-a4b-it' }, 'Performance'],
        [{ id: 'meta/llama-3.1-8b-instruct' }, 'Small'],
        [{ id: 'openai/gpt-5.4-mini' }, 'Small'],
        [{ id: 'openai/gpt-6.1-sol' }, 'Performance'],
        [{ id: 'local-model', _category: 'Local' }, 'Local'],
    ])('%o -> %s', (model, expected) => {
        expect(getModelCategory(model)).toBe(expected);
    });
});

describe('supportsImageInput', () => {
    it('trusts explicit metadata and returns null when unknown', () => {
        expect(supportsImageInput({ architecture: { input_modalities: ['text'] } })).toBe(false);
        expect(supportsImageInput({ architecture: { input_modalities: ['text', 'image'] } })).toBe(true);
        expect(supportsImageInput({ supportsImages: true })).toBe(true);
        expect(supportsImageInput({ id: 'llava' })).toBe(null);
        expect(supportsImageInput(undefined)).toBe(null);
    });
});
