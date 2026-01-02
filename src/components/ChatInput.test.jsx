import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ChatInput from './ChatInput';
import { useChatStore } from '../store/useChatStore';
import { useDraftStore } from '../store/useDraftStore';
import * as modelService from '../services/modelService';

// Mock the store
vi.mock('../store/useChatStore', () => ({
    useChatStore: vi.fn(),
}));

vi.mock('../store/useDraftStore', () => ({
    useDraftStore: vi.fn(),
}));

// Mock model service
vi.mock('../services/modelService', () => ({
    fetchModels: vi.fn(),
    getModelCategory: vi.fn(() => 'Performance')
}));

describe('ChatInput Component', () => {
    let setModelMock;
    let addMessageMock;

    beforeEach(() => {
        vi.clearAllMocks();
        setModelMock = vi.fn();
        addMessageMock = vi.fn();

        useChatStore.mockReturnValue({
            model: 'anthropic/claude-4-sonnet',
            setModel: setModelMock,
            addMessage: addMessageMock,
            availableModels: [
                { id: 'anthropic/claude-4-sonnet', name: 'Claude 4 Sonnet' },
                { id: 'openai/gpt-4o', name: 'GPT-4o' },
                { id: 'google/gemini-pro', name: 'Gemini Pro' }
            ],
            favorites: [],
            toggleFavorite: vi.fn(),
            // draft moved to separate store
        });

        useDraftStore.mockReturnValue({
            draft: '',
            setDraft: vi.fn()
        });
    });

    it('should always render the currently selected model at the bottom of the dropdown, even if it does not match the filter', async () => {
        const { rerender } = render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);
        const combobox = screen.getByRole('combobox');

        // Active model is Claude 4 Sonnet (from beforeEach)

        // Type 'gpt'
        fireEvent.focus(combobox);
        fireEvent.change(combobox, { target: { value: 'gpt' } });

        // "GPT-4o" matches filter. "Claude" does NOT.
        // But we expect "Claude 4 Sonnet" to be visible (at the bottom).

        // Verify GPT-4o is there
        expect(screen.getByText(/GPT-4o/i)).toBeDefined();

        // Verify active model (Claude) is ALSO there
        const activeModel = screen.getByText(/Claude 4 Sonnet/i);
        expect(activeModel).toBeDefined();

        // Optional: Verify text says "Active" or similar if we add a label?
        // For now just existence is enough to prove it's bypassing the filter for the active item.
    });

    it('should filter models list locally when user types in the combobox', async () => {
        // Change active model to Gemini so that Claude is NOT active.
        // This ensures that when we filter for 'gpt', Claude should disappear completely.
        const { rerender } = render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);

        // Mock store update to simulate Gemini is active (if we could, but we mocked via useChatStore.mockReturnValue in global beforeEach)
        // We need to override the mock for THIS test.
        useChatStore.mockReturnValue({
            model: 'google/gemini-pro',
            setModel: setModelMock,
            addMessage: addMessageMock,
            availableModels: [
                { id: 'anthropic/claude-4-sonnet', name: 'Claude 4 Sonnet' },
                { id: 'openai/gpt-4o', name: 'GPT-4o' },
                { id: 'google/gemini-pro', name: 'Gemini Pro' }
            ],
            favorites: [],
            toggleFavorite: vi.fn(),
        });

        rerender(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);

        const combobox = screen.getByRole('combobox');

        fireEvent.focus(combobox);
        fireEvent.change(combobox, { target: { value: 'gpt' } });

        await waitFor(() => {
            expect(screen.getByText(/GPT-4o/i)).toBeDefined();
            // Claude is not active (Gemini is), and doesn't match 'gpt'. Should be gone.
            expect(screen.queryByText(/Claude/i)).toBeNull();
            // Gemini is active, so it SHOULD be visible (at bottom)
            expect(screen.getByText(/Gemini Pro/i)).toBeDefined();
        });
    });

    it('should show ALL models if input matches current selection exactly', async () => {
        await act(async () => {
            render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);
        });

        const combobox = screen.getByRole('combobox');

        // Focus usually selects all text.
        fireEvent.focus(combobox);
        // Ensure input value matches current model name exactly
        fireEvent.change(combobox, { target: { value: 'Claude 4 Sonnet' } });

        // Should see ALL models, not just Claude
        await waitFor(() => {
            expect(screen.getByText(/GPT-4o/i)).toBeDefined();
            expect(screen.getByText(/Gemini Pro/i)).toBeDefined();
            expect(screen.getByText(/Claude 4 Sonnet/i)).toBeDefined();
        });
    });

    it('should select a model when clicked from the filtered list', async () => {
        await act(async () => {
            render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);
        });

        const combobox = screen.getByRole('combobox');
        fireEvent.focus(combobox);
        fireEvent.change(combobox, { target: { value: 'Gemini' } });

        // Find the option and click it
        const option = await screen.findByText(/Gemini Pro/i);
        fireEvent.click(option);

        // Should update the store
        expect(setModelMock).toHaveBeenCalledWith('google/gemini-pro');
    });

    it('should allow manual entry of an arbitrary model ID', async () => {
        await act(async () => {
            render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);
        });

        const combobox = screen.getByRole('combobox');

        // Type a custom model ID that is NOT in the list
        const customModel = 'custom/my-special-model';
        fireEvent.change(combobox, { target: { value: customModel } });

        // Press Enter to commit/save
        fireEvent.keyDown(combobox, { key: 'Enter', code: 'Enter' });

        // Store should be updated with exactly what was typed
        expect(setModelMock).toHaveBeenCalledWith(customModel);
    });

    it('should render standard chat inputs (textarea, buttons)', () => {
        render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);
        expect(screen.getByPlaceholderText('Ask...')).toBeDefined();
        expect(screen.getByRole('button', { name: /send/i })).toBeDefined();
    });
    it('should call onUpload and reset input value when a file is selected', () => {
        const onUploadMock = vi.fn();
        render(<ChatInput onSend={vi.fn()} onUpload={onUploadMock} onReadPage={vi.fn()} />);

        // The label has a title "Attach file"
        const label = screen.getByTitle('Attach file');
        // Find the input within the label
        // Note: explicitly querySelector because the input is hidden
        const fileInput = label.querySelector('input[type="file"]');

        const file = new File(['content'], 'test.png', { type: 'image/png' });

        // Simulate file selection
        // We must provide a value property because the component tries to clear it
        // In JSDOM, file inputs are tricky, but let's try to set it.
        // fireEvent.change essentially calls the handler.
        // To verify the 'value = ""' logic, we rely on the implementation detail that e.target points to the element.

        // We'll trust the logic if onUpload is called.
        // Validating the reset in JSDOM via fireEvent might be flaky depending on how event.target is shammed.
        // Let's at least verify onUpload is called.

        fireEvent.change(fileInput, { target: { files: [file] } });

        expect(onUploadMock).toHaveBeenCalled();
        // Since we modified the actual input element's value:
        expect(fileInput.value).toBe('');
    });

    it('should allow toggling favorite status when clicking the star icon in a filtered list', async () => {
        // Mock toggleFavorite
        const toggleFavoriteMock = vi.fn();
        useChatStore.mockReturnValue({
            model: 'anthropic/claude-4-sonnet',
            setModel: setModelMock,
            addMessage: addMessageMock,
            availableModels: [
                { id: 'anthropic/claude-4-sonnet', name: 'Claude 4 Sonnet' },
                { id: 'openai/gpt-4o', name: 'GPT-4o' }
            ],
            favorites: [],
            toggleFavorite: toggleFavoriteMock,
        });

        render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);
        const combobox = screen.getByRole('combobox');

        // Filter for 'gpt'
        fireEvent.focus(combobox);
        fireEvent.change(combobox, { target: { value: 'gpt' } });

        // Find GPT-4o item
        const modelItem = screen.getByText(/GPT-4o/i).closest('.group');

        // Find the star button within this item
        const starBtn = modelItem.querySelector('button[title="Favorite"]');

        // Click it
        fireEvent.click(starBtn);

        expect(toggleFavoriteMock).toHaveBeenCalledWith('openai/gpt-4o');

        // Ensure dropdown is STILL open (input focused or state true)
        // In this mock, we can't easily check state directly, but we can check if the list is still in the document.
        expect(screen.getByText(/GPT-4o/i)).toBeDefined();
    });

    it('should toggle favorite status when clicking the star icon in the collapsed input', async () => {
        const toggleFavoriteMock = vi.fn();
        useChatStore.mockReturnValue({
            model: 'openai/gpt-4o', // Current model
            setModel: setModelMock,
            availableModels: [
                { id: 'openai/gpt-4o', name: 'GPT-4o' }
            ],
            favorites: [],
            toggleFavorite: toggleFavoriteMock,
        });

        render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);

        // Find the star button in the generic input area (not inside the dropdown list)
        // It has title "Favorite this model" (since favorites is empty)
        const starBtn = screen.getByTitle('Favorite this model');

        fireEvent.click(starBtn);

        expect(toggleFavoriteMock).toHaveBeenCalledWith('openai/gpt-4o');
    });



    it('should persist search text on blur and NOT update model automatically', async () => {
        const { rerender } = render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);
        const combobox = screen.getByRole('combobox');

        // Type 'Cla'
        fireEvent.focus(combobox);
        fireEvent.change(combobox, { target: { value: 'Cla' } });

        // Blur
        fireEvent.blur(combobox);

        // Wait for potential debounce/timeouts
        await act(async () => {
            await new Promise(r => setTimeout(r, 250));
        });

        // 1. Model should NOT have changed (no auto-commit of partials)
        expect(setModelMock).not.toHaveBeenCalled();

        // 2. Input value should still be 'Cla' (no reset)
        expect(combobox.value).toBe('Cla');
    });

    it('should commit custom model on Enter key in model input', async () => {
        render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);
        const combobox = screen.getByRole('combobox');
        const customModel = 'my-custom-model';

        fireEvent.change(combobox, { target: { value: customModel } });
        fireEvent.keyDown(combobox, { key: 'Enter', code: 'Enter' });

        expect(setModelMock).toHaveBeenCalledWith(customModel);
    });

    it('should NOT overwrite search input with model name if background update occurs while searching', async () => {
        const { rerender } = render(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);
        const combobox = screen.getByRole('combobox');

        // 1. User starts searching
        fireEvent.focus(combobox);
        fireEvent.change(combobox, { target: { value: 'gpt' } });
        expect(combobox.value).toBe('gpt');

        // 2. Simulate a background update (e.g. availableModels refreshed)
        useChatStore.mockReturnValue({
            model: 'anthropic/claude-4-sonnet',
            setModel: setModelMock,
            addMessage: addMessageMock,
            availableModels: [
                { id: 'anthropic/claude-4-sonnet', name: 'Claude 4 Sonnet' },
                { id: 'openai/gpt-4o', name: 'GPT-4o' },
                { id: 'google/gemini-pro', name: 'Gemini Pro' },
                { id: 'new/model', name: 'New Model' }
            ],
            favorites: [],
            toggleFavorite: vi.fn(),
        });

        // Force rerender
        rerender(<ChatInput onSend={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()} />);

        // 3. Expectation: Input should still be 'gpt' because we manually removed the dependency/reset logic
        expect(combobox.value).toBe('gpt');
    });

    it('should clear input if onSend returns true', async () => {
        const setDraftMock = vi.fn();
        useDraftStore.mockReturnValue({
            draft: 'Hello world',
            setDraft: setDraftMock
        });
        useChatStore.mockReturnValue({
            availableModels: [],
            favorites: []
        });

        const onSendMock = vi.fn().mockResolvedValue(true);
        render(<ChatInput onSend={onSendMock} onUpload={vi.fn()} onReadPage={vi.fn()} />);

        const sendBtn = screen.getByRole('button', { name: /send/i });
        fireEvent.click(sendBtn);

        await waitFor(() => {
            expect(onSendMock).toHaveBeenCalledWith('Hello world', { webSearch: false });
            expect(setDraftMock).toHaveBeenCalledWith('');
        });
    });

    it('should NOT clear input if onSend returns false', async () => {
        const setDraftMock = vi.fn();
        useDraftStore.mockReturnValue({
            draft: 'Hello world',
            setDraft: setDraftMock
        });
        useChatStore.mockReturnValue({
            availableModels: [],
            favorites: []
        });

        const onSendMock = vi.fn().mockResolvedValue(false);
        render(<ChatInput onSend={onSendMock} onUpload={vi.fn()} onReadPage={vi.fn()} />);

        const sendBtn = screen.getByRole('button', { name: /send/i });
        fireEvent.click(sendBtn);

        await waitFor(() => {
            expect(onSendMock).toHaveBeenCalledWith('Hello world', { webSearch: false });
            expect(setDraftMock).not.toHaveBeenCalledWith('');
        });
    });

    it('should not allow sending when disabled (isLoading)', () => {
        const setDraftMock = vi.fn();
        useDraftStore.mockReturnValue({
            draft: 'Hello',
            setDraft: setDraftMock
        });

        const onSendMock = vi.fn();
        render(<ChatInput onSend={onSendMock} disabled={true} />);

        const sendButton = screen.getByLabelText('Send');
        fireEvent.click(sendButton);

        expect(onSendMock).not.toHaveBeenCalled();
    });

    it('should prevent double submission on Enter key if disabled', () => {
        const setDraftMock = vi.fn();
        useDraftStore.mockReturnValue({
            draft: 'Hello',
            setDraft: setDraftMock
        });

        const onSendMock = vi.fn();
        render(<ChatInput onSend={onSendMock} disabled={true} />);

        const textarea = screen.getByRole('textbox');
        fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

        expect(onSendMock).not.toHaveBeenCalled();
    });
});
