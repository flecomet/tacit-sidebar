import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ChatInput from './ChatInput';
import { usePromptsStore } from '../store/usePromptsStore';
import { useDraftStore } from '../store/useDraftStore';

vi.mock('./ModelPicker', () => ({ default: () => null }));
vi.mock('../store/useChatStore', () => ({
    useChatStore: () => ({ model: 'test', availableModels: [], messages: [] })
}));

function openPicker() {
    render(<ChatInput onSend={vi.fn()} />);
}

describe('Saved prompt management', () => {
    beforeEach(() => {
        usePromptsStore.setState({ savedPrompts: [
            { id: 'one', name: 'Summary', content: 'Summarize this text', createdAt: 1 },
            { id: 'two', name: 'Translation', content: 'Translate this text', createdAt: 2 }
        ] });
        useDraftStore.setState({ draft: '/' });
    });

    it('edits a saved prompt without replacing the chat draft', () => {
        openPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Summary' }));
        fireEvent.change(screen.getByLabelText('Prompt name'), { target: { value: 'Brief' } });
        fireEvent.change(screen.getByLabelText('Prompt text'), { target: { value: 'Give a brief summary' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        expect(usePromptsStore.getState().savedPrompts[0]).toEqual({
            id: 'one', name: 'Brief', content: 'Give a brief summary', createdAt: 1
        });
        expect(screen.getByText('Brief')).toBeDefined();
        expect(useDraftStore.getState().draft).toBe('/');
        fireEvent.click(screen.getByText('Brief'));
        expect(useDraftStore.getState().draft).toBe('Give a brief summary');
    });

    it('cancels edits and rejects blank names or text', () => {
        openPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Summary' }));
        fireEvent.change(screen.getByLabelText('Prompt name'), { target: { value: '   ' } });
        expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('Prompt name'), { target: { value: 'New name' } });
        fireEvent.change(screen.getByLabelText('Prompt text'), { target: { value: '   ' } });
        expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(usePromptsStore.getState().savedPrompts[0].name).toBe('Summary');
        expect(screen.queryByLabelText('Prompt name')).toBeNull();
    });

    it('requires confirmation before deleting only the chosen prompt', () => {
        openPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Summary' }));
        expect(usePromptsStore.getState().savedPrompts).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(usePromptsStore.getState().savedPrompts).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Delete Summary' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
        expect(screen.queryByText('Summary')).toBeNull();
        expect(usePromptsStore.getState().savedPrompts.map(p => p.id)).toEqual(['two']);
        expect(useDraftStore.getState().draft).toBe('/');
    });

    it('keeps keyboard selection valid when the filter narrows the list', () => {
        openPicker();
        const input = screen.getByPlaceholderText('Ask... (type / for prompts)');
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.change(input, { target: { value: '/sum' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(useDraftStore.getState().draft).toBe('Summarize this text');
    });
});
