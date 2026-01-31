import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MessageList from './MessageList';

// Mock the prompts store
vi.mock('../store/usePromptsStore', () => ({
    usePromptsStore: vi.fn()
}));

import { usePromptsStore } from '../store/usePromptsStore';

describe('MessageList', () => {
    let addPromptMock;

    beforeEach(() => {
        vi.clearAllMocks();
        addPromptMock = vi.fn();
        usePromptsStore.mockReturnValue({
            addPrompt: addPromptMock
        });
    });

    it('should show empty state when there are no messages', () => {
        render(<MessageList messages={[]} />);
        expect(screen.getByText('No messages yet.')).toBeDefined();
        expect(screen.getByText(/add page content to context/i)).toBeDefined();
        expect(screen.getByText(/Toggle with Alt \+ J/i)).toBeDefined();
    });

    it('should render user and assistant messages', () => {
        const messages = [
            { role: 'user', content: 'Hello AI' },
            { role: 'assistant', content: 'Hello Human' }
        ];
        render(<MessageList messages={messages} />);

        expect(screen.getByText('Hello AI')).toBeDefined();
        expect(screen.getByText('Hello Human')).toBeDefined();
    });

    it('should render file attachments', () => {
        const messages = [
            {
                role: 'user',
                content: 'Check this file',
                files: [{ name: 'test.pdf', type: 'application/pdf' }]
            }
        ];
        render(<MessageList messages={messages} />);

        expect(screen.getByText('test.pdf')).toBeDefined();
    });

    it('should show loading indicator', () => {
        render(<MessageList messages={[]} isLoading={true} />);
        expect(screen.getByText('Thinking...')).toBeDefined();
    });

    it('should render data URI images used by some models', () => {
        const messages = [{
            role: 'assistant',
            content: 'Image: ![gen](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKwjwAAAAABJRU5ErkJggg==)'
        }];
        render(<MessageList messages={messages} />);

        const img = screen.getByAltText('gen');
        expect(img).toBeDefined();
        const src = img.getAttribute('src');
        expect(src).toContain('data:image/png');
    });

    it('should render http images (regex check)', () => {
        const messages = [{
            role: 'assistant',
            content: 'Image: ![http-img](http://example.com/img.png)'
        }];
        render(<MessageList messages={messages} />);

        const img = screen.getByAltText('http-img');
        expect(img).toBeDefined();
        expect(img.getAttribute('src')).toBe('http://example.com/img.png');
    });

    // Save Prompt Button Tests
    describe('Save Prompt Button', () => {
        it('should show save prompt button on user messages', () => {
            const messages = [{ role: 'user', content: 'Save this prompt' }];
            render(<MessageList messages={messages} />);

            const saveBtn = screen.getByTitle('Save as prompt');
            expect(saveBtn).toBeDefined();
        });

        it('should NOT show save prompt button on assistant messages', () => {
            const messages = [{ role: 'assistant', content: 'AI response' }];
            render(<MessageList messages={messages} />);

            const saveBtn = screen.queryByTitle('Save as prompt');
            expect(saveBtn).toBeNull();
        });

        it('should call addPrompt with message content when save button clicked', async () => {
            const content = 'This prompt should be saved';
            const messages = [{ role: 'user', content }];
            render(<MessageList messages={messages} />);

            const saveBtn = screen.getByTitle('Save as prompt');
            await act(async () => {
                fireEvent.click(saveBtn);
            });

            expect(addPromptMock).toHaveBeenCalledWith(content);
        });

        it('should show checkmark icon briefly after saving', async () => {
            const messages = [{ role: 'user', content: 'Test prompt' }];
            render(<MessageList messages={messages} />);

            const saveBtn = screen.getByTitle('Save as prompt');

            await act(async () => {
                fireEvent.click(saveBtn);
            });

            // After click, should show checkmark (via aria-label or visual change)
            await waitFor(() => {
                expect(screen.getByLabelText('Prompt saved')).toBeDefined();
            });
        });
    });
});
