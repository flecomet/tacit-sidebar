import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatInput from './ChatInput';
import { useChatStore } from '../store/useChatStore';
import { useDraftStore } from '../store/useDraftStore';

// Mock stores
vi.mock('../store/useChatStore', () => ({
    useChatStore: vi.fn(),
}));
vi.mock('../store/useDraftStore', () => ({
    useDraftStore: vi.fn(),
}));

describe('ChatInput AutoExpand', () => {
    let originalScrollHeight;

    beforeEach(() => {
        useChatStore.mockReturnValue({
            model: 'test-model',
            availableModels: [],
            favorites: [],
            toggleFavorite: vi.fn(),
        });

        // Default draft store behavior
        useDraftStore.mockReturnValue({
            draft: '',
            setDraft: vi.fn(),
        });

        // Mock scrollHeight
        originalScrollHeight = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollHeight');
        Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', {
            configurable: true,
            value: 20 // Default small height
        });
    });

    afterEach(() => {
        if (originalScrollHeight) {
            Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
        } else {
            try {
                delete window.HTMLElement.prototype.scrollHeight;
            } catch (e) {
                // ignore
            }
        }
        vi.restoreAllMocks();
    });

    it('should expand height when content increases', () => {
        // Initial render with empty draft
        useDraftStore.mockReturnValue({
            draft: '',
            setDraft: vi.fn()
        });

        const { rerender } = render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);

        const textarea = screen.getByRole('textbox');

        // Mock scrollHeight to simulate expansion (e.g. text added)
        Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 100 });

        // Update store mock to return new content
        useDraftStore.mockReturnValue({
            draft: 'multi\nline\ncontent',
            setDraft: vi.fn()
        });

        // Rerender to trigger effect dependency change
        rerender(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);

        expect(textarea.style.height).toBe('100px');
    });

    it('should respect max height limit', () => {
        const setDraftMock = vi.fn();
        useDraftStore.mockReturnValue({
            draft: 'very\nlong\ncontent\n...'.repeat(10),
            setDraft: setDraftMock
        });

        render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);
        const textarea = screen.getByRole('textbox');

        const computedStyle = window.getComputedStyle(textarea);
        expect(textarea.className).toContain('max-h-[160px]');
    });

    it('should adjust height on resize events', () => {
        // Mock ResizeObserver
        let resizeCallback;
        const resizeObserverMock = vi.fn((callback) => {
            resizeCallback = callback;
            return {
                observe: vi.fn(),
                unobserve: vi.fn(),
                disconnect: vi.fn(),
            };
        });
        window.ResizeObserver = resizeObserverMock;

        useDraftStore.mockReturnValue({
            draft: 'content',
            setDraft: vi.fn()
        });

        render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);
        const textarea = screen.getByRole('textbox');

        // Initial height check logic relies on useEffect, which sets it to scrollHeight
        // Let's change scrollHeight to simulate a layout change (e.g. width got smaller, so text wraps and height grows)
        Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 50 });

        // Sanity check: verify ResizeObserver was instantiated
        expect(resizeObserverMock).toHaveBeenCalled();

        // Trigger the resize callback
        // ResizeObserver callback receives entries
        if (resizeCallback) {
            resizeCallback([{
                target: textarea,
                contentRect: { width: 100 }
            }]);
        }

        // The height should now be updated to the new scrollHeight (50)
        expect(textarea.style.height).toBe('50px');

        // Cleanup
        delete window.ResizeObserver;
    });
});
