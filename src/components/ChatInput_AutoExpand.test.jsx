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
        // We implemented max-h-[160px] class, which corresponds to max-height: 160px in css
        // But testing library doesn't parse tailwind classes into computed styles unless we have full css setup.
        // However, we can check if the class is present or check computed style if JSDOM supports it.
        // Usually JSDOM doesn't compute layout styles from classes unless we use a library for it.
        // So checking the class name inclusion is arguably better for unit test here.
        expect(textarea.className).toContain('max-h-[160px]');
    });
});
