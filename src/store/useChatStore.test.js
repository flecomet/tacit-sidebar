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

    it('leaves v2 data unchanged', () => {
        const migrate = useChatStore.persist.getOptions().migrate;
        const v2 = {
            apiKeys: { openrouter: [{ id: 'k', label: 'EU', encryptedKey: 'e', baseUrl: '' }], openai: [], anthropic: [], google: [] },
            activeKeyId: { openrouter: 'k', openai: null, anthropic: null, google: null },
        };
        expect(migrate(structuredClone(v2), 2)).toEqual(v2);
    });

    it('persists at version 2', () => {
        expect(useChatStore.persist.getOptions().version).toBe(2);
    });

    it('should set includeFreeModels', () => {
        const { result } = renderHook(() => useChatStore());
        expect(result.current.includeFreeModels).toBe(false); // Default

        act(() => {
            result.current.setIncludeFreeModels(true);
        });
        expect(result.current.includeFreeModels).toBe(true);
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

