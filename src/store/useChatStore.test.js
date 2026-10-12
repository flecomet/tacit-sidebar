import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatStore } from './useChatStore';

describe('useChatStore', () => {
    beforeEach(() => {
        const { result } = renderHook(() => useChatStore());
        act(() => {
            result.current.reset();
        });
    });

    it('should initialize with default state', () => {
        const { result } = renderHook(() => useChatStore());
        expect(result.current.messages).toEqual([]);
        expect(result.current.apiKeys.openrouter).toEqual([]);
        // Default model commonly used
        expect(result.current.model).toBe('anthropic/claude-4-sonnet');
    });

    it('adds a key and makes it active', () => {
        const { result } = renderHook(() => useChatStore());
        act(() => {
            result.current.addApiKey('openrouter', { label: 'EU', encryptedKey: 'sk-test-key', baseUrl: '' });
        });
        const [entry] = result.current.apiKeys.openrouter;
        expect(entry.encryptedKey).toBe('sk-test-key');
        expect(result.current.activeKeyId.openrouter).toBe(entry.id);
    });

    it('reset clears all keys', () => {
        const { result } = renderHook(() => useChatStore());
        act(() => { result.current.addApiKey('openai', { encryptedKey: 'e' }); });
        act(() => { result.current.reset(); });
        expect(result.current.apiKeys.openai).toEqual([]);
        expect(result.current.activeKeyId.openai).toBeNull();
    });

    it('has LM Studio search defaults and stores the token as given (already encrypted)', () => {
        const { result } = renderHook(() => useChatStore());
        expect(result.current.lmStudioSearch).toEqual({ enabled: false, integrationId: '', allowedTools: '', encryptedToken: '' });

        act(() => {
            result.current.setLmStudioSearch({ enabled: true, integrationId: 'mcp/x' });
        });
        act(() => {
            result.current.setLmStudioSearch({ encryptedToken: 'enc:abc' });
        });
        expect(result.current.lmStudioSearch).toEqual({ enabled: true, integrationId: 'mcp/x', allowedTools: '', encryptedToken: 'enc:abc' });
    });

    it('persists lmStudioSearch', () => {
        const partialize = useChatStore.persist.getOptions().partialize;
        const persisted = partialize(useChatStore.getState());
        expect(persisted).toHaveProperty('lmStudioSearch');
        expect(persisted.lmStudioSearch).toEqual(useChatStore.getState().lmStudioSearch);
    });

    it('retains separately saved search keys across provider switches and persistence', async () => {
        act(() => useChatStore.setState({ webSearchConfig: { provider: 'brave', encryptedApiKey: '' } }));
        const update = config => act(() => useChatStore.getState().setWebSearchConfig(config));
        update({ encryptedApiKey: 'encrypted-brave' });
        update({ provider: 'serper' });
        expect(useChatStore.getState().webSearchConfig.encryptedApiKey).toBe('');
        update({ encryptedApiKey: 'encrypted-serper' });
        update({ provider: 'serpapi' });
        expect(useChatStore.getState().webSearchConfig.encryptedApiKey).toBe('');

        await act(async () => { await useChatStore.persist.rehydrate(); });
        expect(useChatStore.getState().webSearchConfig.keysByProvider).toEqual({
            brave: 'encrypted-brave', serper: 'encrypted-serper', serpapi: ''
        });
        update({ provider: 'brave' });
        expect(useChatStore.getState().webSearchConfig.encryptedApiKey).toBe('encrypted-brave');
        update({ provider: 'serper' });
        expect(useChatStore.getState().webSearchConfig.encryptedApiKey).toBe('encrypted-serper');
    });

    it('should set Model', () => {
        const { result } = renderHook(() => useChatStore());
        act(() => {
            result.current.setModel('gpt-4o');
        });
        expect(result.current.model).toBe('gpt-4o');
    });

    it('should add messages', () => {
        const { result } = renderHook(() => useChatStore());
        const msg = { role: 'user', content: 'Hello' };

        act(() => {
            result.current.addMessage(msg);
        });

        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0]).toEqual(msg);
    });

    it('should clear history', () => {
        const { result } = renderHook(() => useChatStore());
        act(() => {
            result.current.addMessage({ role: 'user', content: 'Hi' });
            result.current.clearHistory();
        });
        expect(result.current.messages).toEqual([]);
    });

    it('migrates a v0 install through v1 to v2', () => {
        const migrate = useChatStore.persist.getOptions().migrate;
        const out = migrate({ encryptedApiKeys: { openrouter: 'enc' }, customBaseUrl: 'https://eu.openrouter.ai/api/v1' }, 0);
        expect(out.apiKeys.openrouter[0]).toMatchObject({ label: 'Default', encryptedKey: 'enc', baseUrl: 'https://eu.openrouter.ai/api/v1' });
        expect(out.activeKeyId.openrouter).toBe(out.apiKeys.openrouter[0].id);
        expect(out).not.toHaveProperty('customBaseUrl');
        expect(out).not.toHaveProperty('customBaseUrls');
        expect(out).not.toHaveProperty('encryptedApiKeys');
    });

    it('keeps a v0 OpenAI-compatible endpoint on the OpenAI key', () => {
        const migrate = useChatStore.persist.getOptions().migrate;
        const out = migrate({ encryptedApiKeys: { openai: 'enc' }, customBaseUrl: 'https://api.groq.com/openai/v1' }, 0);
        expect(out.apiKeys.openai[0]).toMatchObject({ encryptedKey: 'enc', baseUrl: 'https://api.groq.com/openai/v1' });
    });

    it('keeps v2 data and adds the v5 sort defaults', () => {
        const migrate = useChatStore.persist.getOptions().migrate;
        const v2 = {
            apiKeys: { openrouter: [{ id: 'k', label: 'EU', encryptedKey: 'e', baseUrl: '' }], openai: [], anthropic: [], google: [] },
            activeKeyId: { openrouter: 'k', openai: null, anthropic: null, google: null },
        };
        expect(migrate(structuredClone(v2), 2)).toEqual({
            ...v2,
            modelSort: { key: 'default', dir: 'asc' },
            favoritesFirst: false,
        });
    });

    it('preserves existing Google local search credentials', () => {
        const migrate = useChatStore.persist.getOptions().migrate;
        const out = migrate({ webSearchConfig: { enabled: true, provider: 'google', encryptedApiKey: 'google-key', cx: 'engine' } }, 2);
        expect(out.webSearchConfig).toEqual({ enabled: true, provider: 'google', encryptedApiKey: 'google-key', cx: 'engine' });
    });

    it.each(['brave', 'serper', 'serpapi'])('preserves %s search settings during migration', (provider) => {
        const migrate = useChatStore.persist.getOptions().migrate;
        const config = { provider, encryptedApiKey: 'saved-key' };
        expect(migrate({ webSearchConfig: config }, 2).webSearchConfig).toEqual(config);
    });

    it('persists at version 5', () => {
        expect(useChatStore.persist.getOptions().version).toBe(5);
    });

    it('removes only the obsolete includeFreeModels preference when migrating from version 3', () => {
        const migrate = useChatStore.persist.getOptions().migrate;
        const persisted = {
            includeFreeModels: false,
            favorites: ['a/model'],
            apiKeys: { openrouter: [{ id: 'k1', label: 'test', encryptedKey: 'enc-placeholder', baseUrl: '' }] },
            activeKeyId: { openrouter: 'k1' },
            model: 'a/model',
        };
        const result = migrate({ ...persisted }, 3);
        expect(result).not.toHaveProperty('includeFreeModels');
        const rest = { ...persisted, modelSort: { key: 'default', dir: 'asc' }, favoritesFirst: false };
        delete rest.includeFreeModels;
        expect(result).toEqual(rest);
    });

    it('does not expose includeFreeModels in state or persisted selection', () => {
        expect(useChatStore.getState()).not.toHaveProperty('includeFreeModels');
        expect(useChatStore.getState()).not.toHaveProperty('setIncludeFreeModels');
        expect(useChatStore.persist.getOptions().partialize(useChatStore.getState())).not.toHaveProperty('includeFreeModels');
    });

    // truncateAtMessage tests for edit/regenerate feature
    describe('truncateAtMessage', () => {
        it('should remove messages at and after the specified index', () => {
            const { result } = renderHook(() => useChatStore());

            // Set up session with messages
            act(() => {
                result.current.ensureActiveSession();
                result.current.addMessage({ role: 'user', content: 'First' });
                result.current.addMessage({ role: 'assistant', content: 'Response 1' });
                result.current.addMessage({ role: 'user', content: 'Second' });
                result.current.addMessage({ role: 'assistant', content: 'Response 2' });
            });

            expect(result.current.messages).toHaveLength(4);

            // Truncate at index 2 (remove 'Second' and 'Response 2')
            const sessionId = result.current.currentSessionId;
            act(() => {
                result.current.truncateAtMessage(sessionId, 2);
            });

            expect(result.current.messages).toHaveLength(2);
            expect(result.current.messages[0].content).toBe('First');
            expect(result.current.messages[1].content).toBe('Response 1');
        });

        it('should keep all messages if index is beyond array length', () => {
            const { result } = renderHook(() => useChatStore());

            act(() => {
                result.current.ensureActiveSession();
                result.current.addMessage({ role: 'user', content: 'Only' });
            });

            const sessionId = result.current.currentSessionId;
            act(() => {
                result.current.truncateAtMessage(sessionId, 10);
            });

            expect(result.current.messages).toHaveLength(1);
        });

        it('should remove all messages if index is 0', () => {
            const { result } = renderHook(() => useChatStore());

            act(() => {
                result.current.ensureActiveSession();
                result.current.addMessage({ role: 'user', content: 'First' });
                result.current.addMessage({ role: 'assistant', content: 'Response' });
            });

            const sessionId = result.current.currentSessionId;
            act(() => {
                result.current.truncateAtMessage(sessionId, 0);
            });

            expect(result.current.messages).toHaveLength(0);
        });

        it('should update the session in the sessions array', () => {
            const { result } = renderHook(() => useChatStore());

            act(() => {
                result.current.ensureActiveSession();
                result.current.addMessage({ role: 'user', content: 'First' });
                result.current.addMessage({ role: 'assistant', content: 'Response' });
            });

            const sessionId = result.current.currentSessionId;
            act(() => {
                result.current.truncateAtMessage(sessionId, 1);
            });

            const session = result.current.sessions.find(s => s.id === sessionId);
            expect(session.messages).toHaveLength(1);
        });
    });
});

