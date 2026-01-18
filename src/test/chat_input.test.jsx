import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatInput from '../components/ChatInput';
import { useChatStore } from '../store/useChatStore';
import { useDraftStore } from '../store/useDraftStore';

// Mock dependencies
vi.mock('../services/modelService', () => ({
    getModelCategory: (model) => {
        if (!model) return 'General';
        // Simple mock logic: if ID has 'free', it's Free.
        if (model.id && model.id.includes('free')) return 'Free';
        return 'Performance';
    }
}));

// Mock Stores
vi.mock('../store/useChatStore', () => ({
    useChatStore: vi.fn()
}));

vi.mock('../store/useDraftStore', () => ({
    useDraftStore: vi.fn()
}));

describe('ChatInput Component', () => {
    const defaultProps = {
        onSend: vi.fn(),
        onUpload: vi.fn(),
        onReadPage: vi.fn(),
        isLoading: false,
        disabled: false,
        providerMode: 'cloud',
        activeProvider: 'openrouter' // Web search is enabled for OpenRouter
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Default Store State
        useChatStore.mockReturnValue({
            model: 'openai/gpt-4o',
            setModel: vi.fn(),
            availableModels: [
                { id: 'openai/gpt-4o', name: 'GPT-4o', _category: 'Performance' },
                { id: 'meta-llama/llama-3-8b-instruct:free', name: 'Llama 3 (Free)', _category: 'Free' }
            ],
            favorites: [],
            toggleFavorite: vi.fn()
        });

        useDraftStore.mockReturnValue({
            draft: '',
            setDraft: vi.fn()
        });
    });

    it('should enable web search toggle for paid models', () => {
        useChatStore.mockReturnValue({
            model: 'openai/gpt-4o', // Paid model
            setModel: vi.fn(),
            availableModels: [
                { id: 'openai/gpt-4o', name: 'GPT-4o' }
            ],
            favorites: [],
            toggleFavorite: vi.fn()
        });

        render(<ChatInput {...defaultProps} />);

        const globeBtn = screen.getByLabelText(/Enable Web Search/i);
        expect(globeBtn).toBeDefined();
        expect(globeBtn.disabled).toBe(false);

        // Click to toggle
        fireEvent.click(globeBtn);
        // We can't easily check state without checking title change or class, 
        // since state is internal to component. 
        // But verifying it is NOT disabled is key for this test.
    });

    it('should DISABLE web search toggle for free models', () => {
        useChatStore.mockReturnValue({
            model: 'meta-llama/llama-3-8b-instruct:free', // Free model
            setModel: vi.fn(),
            availableModels: [
                { id: 'meta-llama/llama-3-8b-instruct:free', name: 'Llama 3', _category: 'Free' }
            ],
            favorites: [],
            toggleFavorite: vi.fn()
        });

        render(<ChatInput {...defaultProps} />);

        // The button should either be present but disabled, OR have a specific title.
        // The requirement is "Change button tooltip to 'Unavailable for free models'".

        // In current implementation it might just be enabled.
        // We expect this test to FAIL initially or pass if I fix expectation to match failure?
        // No, I want TDD. I expect "Unavailable for free models" to be present (e.g. title or aria-label).
        // Since I haven't implemented it, this query should fail.

        const disabledBtn = screen.queryByTitle(/Unavailable for free models/i);

        // For TDD, I'll assert that the button exists and is disabled
        // Or that I can find it by the new title.
        // If I search by old label ("Enable Web Search"), it might be there but enabled (FAIL).

        // Let's look for the globe button and check disabled state.
        // Current code: title="Enable Web Search"
        // Target code: title="Unavailable for free models"

        // So checking for the Target title should fail now.
        expect(screen.queryByTitle(/Unavailable for free models/i)).not.toBeNull();
    });
});
