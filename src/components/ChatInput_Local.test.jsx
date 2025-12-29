import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ChatInput from '../components/ChatInput';
import { useChatStore } from '../store/useChatStore';

// Mock the store
vi.mock('../store/useChatStore', () => ({
    useChatStore: vi.fn(),
}));

// Mock model service
vi.mock('../services/modelService', () => ({
    fetchModels: vi.fn(),
    getModelCategory: vi.fn((m) => m._category || 'Performance')
}));

describe('ChatInput Local Mode', () => {
    let setModelMock;
    let addMessageMock;

    beforeEach(() => {
        vi.clearAllMocks();
        setModelMock = vi.fn();
        addMessageMock = vi.fn();
    });

    it('should ONLY show local models when providerMode is local', () => {
        useChatStore.mockReturnValue({
            model: 'local-model',
            setModel: setModelMock,
            addMessage: addMessageMock,
            availableModels: [
                { id: 'anthropic/claude-4-sonnet', name: 'Claude 4 Sonnet' }, // Cloud
                { id: 'local-model', name: 'Llama 3', _category: 'Local' },     // Local
                { id: 'mistral-local', name: 'Mistral', _category: 'Local' }    // Local
            ],
            favorites: [],
            toggleFavorite: vi.fn(),
            draft: '',
            setDraft: vi.fn()
        });

        // Render with providerMode='local'
        render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} providerMode="local" />);

        const combobox = screen.getByRole('combobox');
        fireEvent.focus(combobox);
        fireEvent.change(combobox, { target: { value: '' } }); // Clear filter to show all in group

        // Expand dropdown
        // (Focus should expand it)

        // Check visibility
        // Local models should be visible
        expect(screen.getByText('Llama 3')).toBeDefined();
        expect(screen.getByText('Mistral')).toBeDefined();

        // Cloud models should NOT be visible
        expect(screen.queryByText('Claude 4 Sonnet')).toBeNull();
    });

    it('should handle search with missing name in local mode (fallback to ID)', () => {
        useChatStore.mockReturnValue({
            model: 'local-model',
            setModel: setModelMock,
            addMessage: addMessageMock,
            availableModels: [
                // Local model with NO name
                { id: 'deepseek-coder:6.7b', _category: 'Local' }
            ],
            favorites: [],
            toggleFavorite: vi.fn(),
            draft: '',
            setDraft: vi.fn()
        });

        render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} providerMode="local" />);

        const combobox = screen.getByRole('combobox');
        fireEvent.focus(combobox);

        // Search for ID part
        fireEvent.change(combobox, { target: { value: 'deepseek' } });

        // Should find it by ID
        expect(screen.getByText('deepseek-coder:6.7b')).toBeDefined();
    });
});
