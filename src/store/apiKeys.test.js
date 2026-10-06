// src/store/apiKeys.test.js
import { describe, it, expect } from 'vitest';
import {
    emptyKeys, emptyActive, addKey, updateKey, removeKey, setActiveKey, getActiveKey, migrateKeysToV2, canHaveEndpoint
} from './apiKeys';

const base = () => ({ apiKeys: emptyKeys(), activeKeyId: emptyActive() });
const apply = (state, patch) => ({ ...state, ...patch });
const seq = (...xs) => { let i = 0; return () => xs[i++]; };
const EU = 'https://eu.openrouter.ai/api/v1';

describe('apiKeys reducers', () => {
    it('makes the first key active and keeps it active when more are added', () => {
        let s = base();
        s = apply(s, addKey(s, 'openrouter', { label: 'EU', encryptedKey: 'e1', baseUrl: EU }, 'k1'));
        s = apply(s, addKey(s, 'openrouter', { label: 'Global', encryptedKey: 'e2' }, 'k2'));
        expect(s.apiKeys.openrouter.map(k => k.id)).toEqual(['k1', 'k2']);
        expect(s.activeKeyId.openrouter).toBe('k1');
        expect(getActiveKey(s, 'openrouter').baseUrl).toBe(EU);
    });

    it('gives new non-OpenRouter keys no endpoint', () => {
        let s = base();
        s = apply(s, addKey(s, 'openai', { label: 'Work', encryptedKey: 'e', baseUrl: 'https://api.groq.com/openai/v1' }, 'k1'));
        expect(s.apiKeys.openai[0].baseUrl).toBe('');
        s = apply(s, updateKey(s, 'openai', 'k1', { baseUrl: 'https://x.example' }));
        expect(s.apiKeys.openai[0].baseUrl).toBe('');
        s = apply(s, addKey(s, 'anthropic', { encryptedKey: 'e', baseUrl: 'https://proxy.example' }, 'k2'));
        expect(s.apiKeys.anthropic[0].baseUrl).toBe('');
    });

    it('lets a legacy OpenAI endpoint be edited and cleared, then not set again', () => {
        const groq = 'https://api.groq.com/openai/v1';
        let s = { apiKeys: { ...emptyKeys(), openai: [{ id: 'k1', label: 'Default', encryptedKey: 'e', baseUrl: groq }] }, activeKeyId: { ...emptyActive(), openai: 'k1' } };
        expect(canHaveEndpoint('openai', s.apiKeys.openai[0])).toBe(true);
        s = apply(s, updateKey(s, 'openai', 'k1', { baseUrl: ' https://api.together.xyz/v1 ' }));
        expect(s.apiKeys.openai[0].baseUrl).toBe('https://api.together.xyz/v1');
        s = apply(s, updateKey(s, 'openai', 'k1', { baseUrl: '' }));
        expect(s.apiKeys.openai[0].baseUrl).toBe('');
        expect(canHaveEndpoint('openai', s.apiKeys.openai[0])).toBe(false);
        s = apply(s, updateKey(s, 'openai', 'k1', { baseUrl: groq }));
        expect(s.apiKeys.openai[0].baseUrl).toBe('');
    });

    it('canHaveEndpoint: always for OpenRouter, never for Anthropic and Google', () => {
        expect(canHaveEndpoint('openrouter')).toBe(true);
        expect(canHaveEndpoint('anthropic', { baseUrl: 'https://x' })).toBe(false);
        expect(canHaveEndpoint('google', { baseUrl: 'https://x' })).toBe(false);
    });

    it('labels unnamed keys "Key N"', () => {
        let s = base();
        s = apply(s, addKey(s, 'google', { label: '  ', encryptedKey: 'e1' }, 'k1'));
        s = apply(s, addKey(s, 'google', { encryptedKey: 'e2' }, 'k2'));
        expect(s.apiKeys.google.map(k => k.label)).toEqual(['Key 1', 'Key 2']);
    });

    it('updates label and key, keeping the old label when the new one is blank', () => {
        let s = base();
        s = apply(s, addKey(s, 'anthropic', { label: 'Main', encryptedKey: 'e1' }, 'k1'));
        s = apply(s, updateKey(s, 'anthropic', 'k1', { label: ' ', encryptedKey: 'e2' }));
        expect(s.apiKeys.anthropic[0]).toMatchObject({ label: 'Main', encryptedKey: 'e2' });
    });

    it('switches the active key only to an existing id', () => {
        let s = base();
        s = apply(s, addKey(s, 'openrouter', { encryptedKey: 'e1' }, 'k1'));
        s = apply(s, addKey(s, 'openrouter', { encryptedKey: 'e2' }, 'k2'));
        s = apply(s, setActiveKey(s, 'openrouter', 'k2'));
        expect(s.activeKeyId.openrouter).toBe('k2');
        expect(setActiveKey(s, 'openrouter', 'nope')).toEqual({});
    });

    it('removing the active key activates the first remaining key, then none', () => {
        let s = base();
        s = apply(s, addKey(s, 'openrouter', { encryptedKey: 'e1' }, 'k1'));
        s = apply(s, addKey(s, 'openrouter', { encryptedKey: 'e2' }, 'k2'));
        s = apply(s, removeKey(s, 'openrouter', 'k1'));
        expect(s.activeKeyId.openrouter).toBe('k2');
        s = apply(s, removeKey(s, 'openrouter', 'k2'));
        expect(s.activeKeyId.openrouter).toBeNull();
        expect(getActiveKey(s, 'openrouter')).toBeNull();
    });

    it('removing a non-active key keeps the active one', () => {
        let s = base();
        s = apply(s, addKey(s, 'openrouter', { encryptedKey: 'e1' }, 'k1'));
        s = apply(s, addKey(s, 'openrouter', { encryptedKey: 'e2' }, 'k2'));
        s = apply(s, removeKey(s, 'openrouter', 'k2'));
        expect(s.activeKeyId.openrouter).toBe('k1');
    });

    it('getActiveKey falls back to the first key when the active id is stale', () => {
        const s = { apiKeys: { ...emptyKeys(), openai: [{ id: 'k1', label: 'A', encryptedKey: 'e', baseUrl: '' }] }, activeKeyId: { ...emptyActive(), openai: 'gone' } };
        expect(getActiveKey(s, 'openai').id).toBe('k1');
    });

    it('getActiveKey tolerates missing state', () => {
        expect(getActiveKey({}, 'openai')).toBeNull();
    });
});

describe('migrateKeysToV2', () => {
    it('turns each v1 key into one active "Default" entry; OpenRouter and OpenAI keep their endpoints', () => {
        const out = migrateKeysToV2({
            encryptedApiKeys: { openrouter: 'enc-or', openai: 'enc-oa', anthropic: '', google: '' },
            customBaseUrls: { openrouter: EU, openai: 'https://api.groq.com/openai/v1' },
            messages: [{ role: 'user', content: 'hi' }],
        }, seq('a', 'b'));
        expect(out.apiKeys.openrouter).toEqual([{ id: 'a', label: 'Default', encryptedKey: 'enc-or', baseUrl: EU }]);
        expect(out.apiKeys.openai).toEqual([{ id: 'b', label: 'Default', encryptedKey: 'enc-oa', baseUrl: 'https://api.groq.com/openai/v1' }]);
        expect(out.apiKeys.anthropic).toEqual([]);
        expect(out.activeKeyId).toEqual({ openrouter: 'a', openai: 'b', anthropic: null, google: null });
        expect(out.messages).toEqual([{ role: 'user', content: 'hi' }]);
        expect(out).not.toHaveProperty('encryptedApiKeys');
        expect(out).not.toHaveProperty('customBaseUrls');
    });

    it('tolerates null legacy fields', () => {
        const out = migrateKeysToV2({ encryptedApiKeys: null, customBaseUrls: null }, seq());
        expect(out.apiKeys).toEqual(emptyKeys());
        expect(out.activeKeyId).toEqual(emptyActive());
        expect(out).not.toHaveProperty('encryptedApiKeys');
        expect(out).not.toHaveProperty('customBaseUrls');
    });

    it('migrates an install with no saved keys to empty lists', () => {
        const out = migrateKeysToV2({}, seq());
        expect(out.apiKeys).toEqual(emptyKeys());
        expect(out.activeKeyId).toEqual(emptyActive());
    });
});
