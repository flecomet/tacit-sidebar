import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChatInput from './ChatInput';
import { useDraftStore } from '../store/useDraftStore';

vi.mock('./ModelPicker', () => ({ default: () => null }));
vi.mock('../store/useChatStore', () => ({
    useChatStore: () => ({ model: 'test', availableModels: [], messages: [] })
}));

const PREFIX = 'Search the web for current sources: ';
const renderInput = (onSend = vi.fn().mockResolvedValue(true)) => {
    render(<ChatInput activeProvider="local" providerMode="local" onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable Web Search' }));
    return onSend;
};

describe('Optional search prefix', () => {
    beforeEach(() => useDraftStore.setState({ draft: 'latest news' }));

    it('shows grey prefix without adding it to the submitted prompt', async () => {
        const onSend = renderInput();
        expect(screen.getByRole('button', { name: 'Insert web search prefix' })).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await waitFor(() => expect(onSend).toHaveBeenCalledWith('latest news', { webSearch: true }));
    });

    it('prepends the suggestion on Right Arrow at the end without sending', () => {
        const onSend = renderInput();
        const input = screen.getByPlaceholderText('Ask... (type / for prompts)');
        input.setSelectionRange(input.value.length, input.value.length);
        fireEvent.keyDown(input, { key: 'ArrowRight' });
        expect(input.value).toBe(PREFIX + 'latest news');
        expect(onSend).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Insert web search prefix' })).toBeNull();
    });

    it('preserves caret navigation and selected text', () => {
        renderInput();
        const input = screen.getByPlaceholderText('Ask... (type / for prompts)');
        input.setSelectionRange(2, 2);
        fireEvent.keyDown(input, { key: 'ArrowRight' });
        expect(input.value).toBe('latest news');
        input.setSelectionRange(0, input.value.length);
        fireEvent.keyDown(input, { key: 'ArrowRight' });
        expect(input.value).toBe('latest news');
    });

    it('accepts the prefix by clicking and hides the suggestion when search is off', () => {
        renderInput();
        fireEvent.click(screen.getByRole('button', { name: 'Insert web search prefix' }));
        expect(useDraftStore.getState().draft).toBe(PREFIX + 'latest news');
        fireEvent.click(screen.getByRole('button', { name: 'Disable Web Search' }));
        expect(screen.queryByRole('button', { name: 'Insert web search prefix' })).toBeNull();
    });
});
