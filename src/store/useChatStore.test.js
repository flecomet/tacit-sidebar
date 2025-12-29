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
});

