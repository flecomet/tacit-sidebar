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
        expect(result.current.encryptedApiKeys.openrouter).toBe('');
        // Default model commonly used
        expect(result.current.model).toBe('anthropic/claude-4-sonnet');
    });

    it('should set API key', () => {
        const { result } = renderHook(() => useChatStore());
        act(() => {
            result.current.setEncryptedApiKey('openrouter', 'sk-test-key');
        });
        expect(result.current.encryptedApiKeys.openrouter).toBe('sk-test-key');
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

