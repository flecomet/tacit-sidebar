#!/usr/bin/env node
// Fetch live model lists, run Tacit's normalizers, and report kept/dropped ids.
// Usage: node scripts/check-models.mjs [--write-fixtures]
// Run weekly by .github/workflows/model-catalog.yml; run locally when a provider ships a new product type.
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
    normalizeOpenAI, normalizeAnthropic, normalizeGoogle, normalizeOpenRouter,
    getModelCategory, supportsImageInput
} from '../src/services/modelCatalog.js';

const env = process.env;
const WRITE = process.argv.includes('--write-fixtures');
const FIXTURE_DIR = new URL('../src/services/__fixtures__/', import.meta.url);

const sources = {
    openai: () => fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${env.VITE_OPENAI_API_KEY}` } }),
    anthropic: () => fetch('https://api.anthropic.com/v1/models?limit=1000', { headers: { 'x-api-key': env.VITE_ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } }),
    google: () => fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': env.VITE_GOOGLE_API_KEY } }),
    openrouter: () => fetch('https://openrouter.ai/api/v1/models'),
};
const normalize = {
    openai: (raw) => normalizeOpenAI(raw),
    anthropic: (raw) => normalizeAnthropic(raw),
    google: (raw) => normalizeGoogle(raw.models || []),
    openrouter: (raw) => normalizeOpenRouter(raw.data || []),
};
const rawIds = {
    openai: (raw) => (raw.data || []).map(m => m.id),
    anthropic: (raw) => (raw.data || []).map(m => m.id),
    google: (raw) => (raw.models || []).map(m => m.name.replace(/^models\//, '')),
    openrouter: (raw) => (raw.data || []).map(m => m.id),
};
// OpenRouter's catalog is large; keep only fields the normalizer reads.
const trim = {
    openrouter: (raw) => ({
        data: raw.data.map(({ id, name, created, context_length, architecture, pricing, top_provider }) =>
            ({ id, name, created, context_length, architecture, pricing, top_provider }))
    }),
};

if (WRITE) mkdirSync(FIXTURE_DIR, { recursive: true });

for (const [provider, load] of Object.entries(sources)) {
    try {
        const res = await load();
        if (!res.ok) throw new Error(`HTTP ${res.status}`); // never write an error body over a fixture
        const raw = await res.json();
        const fixture = new URL(`${provider}-models.json`, FIXTURE_DIR);
        const previous = existsSync(fixture)
            ? new Set(rawIds[provider](JSON.parse(readFileSync(fixture, 'utf8'))))
            : new Set();

        const kept = normalize[provider](raw);
        const keptIds = new Set(kept.map(m => m.id));
        const liveIds = rawIds[provider](raw);
        const dropped = liveIds.filter(id => !keptIds.has(id));
        const unknownVision = kept.filter(m => supportsImageInput(m) === null).length;
        // New ids are what a reviewer must classify: a dropped chat model or a kept non-chat model needs a regex edit.
        const added = liveIds.filter(id => !previous.has(id));
        const removed = [...previous].filter(id => !liveIds.includes(id));

        console.log(`\n## ${provider}: kept ${kept.length}, dropped ${dropped.length}, vision unknown ${unknownVision}`);
        console.log('kept (first 20):', kept.slice(0, 20).map(m => `${m.id} [${getModelCategory(m)}]`).join(', '));
        console.log('dropped:', dropped.join(', '));
        console.log('new since fixture:', added.map(id => `${id} (${keptIds.has(id) ? 'kept' : 'dropped'})`).join(', ') || 'none');
        console.log('gone since fixture:', removed.join(', ') || 'none');
        if (WRITE) {
            const out = trim[provider] ? trim[provider](raw) : raw;
            writeFileSync(fixture, JSON.stringify(out, null, 1));
        }
    } catch (e) {
        console.error(`## ${provider}: FAILED ${e.message}`);
        process.exitCode = 1;
    }
}
