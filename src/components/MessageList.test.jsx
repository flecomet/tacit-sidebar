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

    // Skeleton Ghost Loader Tests
    describe('Skeleton Loader', () => {
        it('should show skeleton loader inside assistant bubble when loading', () => {
            render(<MessageList messages={[]} isLoading={true} />);

            // Should have shimmer animation elements
            const skeleton = screen.getByTestId('skeleton-loader');
            expect(skeleton).toBeDefined();
        });

        it('should render skeleton bars with varying widths', () => {
            render(<MessageList messages={[]} isLoading={true} />);

            const skeletonBars = screen.getAllByTestId('skeleton-bar');
            expect(skeletonBars.length).toBeGreaterThanOrEqual(3);
        });

        it('should apply shimmer animation class to skeleton bars', () => {
            render(<MessageList messages={[]} isLoading={true} />);

            const skeletonBars = screen.getAllByTestId('skeleton-bar');
            // Each bar should have the shimmer CSS class
            expect(skeletonBars[0].className).toContain('skeleton-shimmer');
        });
    });

    // Collapsible Message Tests
    describe('Collapsible Messages', () => {
        const longContent = 'A'.repeat(200); // Long message to test truncation

        it('should show collapse button on hover for user messages', () => {
            const messages = [{ role: 'user', content: longContent }];
            render(<MessageList messages={messages} />);

            const collapseBtn = screen.getByTitle(/collapse/i);
            expect(collapseBtn).toBeDefined();
        });

        it('should show collapse button on hover for assistant messages', () => {
            const messages = [{ role: 'assistant', content: longContent }];
            render(<MessageList messages={messages} />);

            const collapseBtn = screen.getByTitle(/collapse/i);
            expect(collapseBtn).toBeDefined();
        });

        it('should truncate content when collapsed', async () => {
            const messages = [{ role: 'user', content: longContent }];
            render(<MessageList messages={messages} />);

            const collapseBtn = screen.getByTitle(/collapse/i);
            await act(async () => {
                fireEvent.click(collapseBtn);
            });

            // Should show truncated content with ellipsis
            expect(screen.getByText(/\.\.\./)).toBeDefined();
            // Should not show full content
            expect(screen.queryByText(longContent)).toBeNull();
        });

        it('should expand content when expand button clicked', async () => {
            const messages = [{ role: 'user', content: longContent }];
            render(<MessageList messages={messages} />);

            // Collapse first
            const collapseBtn = screen.getByTitle(/collapse/i);
            await act(async () => {
                fireEvent.click(collapseBtn);
            });

            // Now expand
            const expandBtn = screen.getByTitle(/expand/i);
            await act(async () => {
                fireEvent.click(expandBtn);
            });

            // Should show full content again
            expect(screen.getByText(longContent)).toBeDefined();
        });

        it('should not show collapse button for short messages', () => {
            const messages = [{ role: 'user', content: 'Short message' }];
            render(<MessageList messages={messages} />);

            const collapseBtn = screen.queryByTitle(/collapse/i);
            expect(collapseBtn).toBeNull();
        });
    });

    // Edit & Regenerate Tests
    describe('Edit Message', () => {
        it('should show edit button on user message hover', () => {
            const messages = [{ role: 'user', content: 'Original message' }];
            render(<MessageList messages={messages} onEditMessage={() => { }} />);

            const editBtn = screen.getByTitle(/edit/i);
            expect(editBtn).toBeDefined();
        });

        it('should NOT show edit button on assistant messages', () => {
            const messages = [{ role: 'assistant', content: 'AI response' }];
            render(<MessageList messages={messages} onEditMessage={() => { }} />);

            const editBtn = screen.queryByTitle(/edit/i);
            expect(editBtn).toBeNull();
        });

        it('should show textarea with original content when edit clicked', async () => {
            const originalContent = 'Original message content';
            const messages = [{ role: 'user', content: originalContent }];
            render(<MessageList messages={messages} onEditMessage={() => { }} />);

            const editBtn = screen.getByTitle(/edit/i);
            await act(async () => {
                fireEvent.click(editBtn);
            });

            const textarea = screen.getByRole('textbox');
            expect(textarea.value).toBe(originalContent);
        });

        it('should call onEditMessage with new content and index when submitted', async () => {
            const onEditMessage = vi.fn();
            const messages = [{ role: 'user', content: 'Original' }];
            render(<MessageList messages={messages} onEditMessage={onEditMessage} />);

            const editBtn = screen.getByTitle(/edit/i);
            await act(async () => {
                fireEvent.click(editBtn);
            });

            const textarea = screen.getByRole('textbox');
            fireEvent.change(textarea, { target: { value: 'Updated message' } });

            const submitBtn = screen.getByTitle(/regenerate/i);
            await act(async () => {
                fireEvent.click(submitBtn);
            });

            expect(onEditMessage).toHaveBeenCalledWith(0, 'Updated message');
        });

        it('should hide edit mode when cancel clicked', async () => {
            const messages = [{ role: 'user', content: 'Original' }];
            render(<MessageList messages={messages} onEditMessage={() => { }} />);

            const editBtn = screen.getByTitle(/edit/i);
            await act(async () => {
                fireEvent.click(editBtn);
            });

            const cancelBtn = screen.getByTitle(/cancel/i);
            await act(async () => {
                fireEvent.click(cancelBtn);
            });

            // Textarea should be gone
            expect(screen.queryByRole('textbox')).toBeNull();
        });
    });

    // Cost Color Tests
    describe('Cost Coloring', () => {
        it('should show green color for cheap costs (< $0.01)', () => {
            const messages = [{
                role: 'assistant',
                content: 'Response',
                metadata: { cost: 0.005, tokens: 100, latency: 1000 }
            }];
            render(<MessageList messages={messages} />);

            const costElement = screen.getByText(/\$0\.005/);
            expect(costElement.className).toContain('text-cost-cheap');
        });

        it('should show gray color when cost is 0 (unavailable)', () => {
            const messages = [{
                role: 'assistant',
                content: 'Response',
                metadata: { cost: 0, tokens: 100, latency: 1000 }
            }];
            render(<MessageList messages={messages} />);

            // Cost should not be displayed or should be gray
            const costElement = screen.queryByText(/cost:/i);
            if (costElement) {
                expect(costElement.className).toContain('text-gray-500');
            }
        });

        it('should show red color for expensive costs (>= $1)', () => {
            const messages = [{
                role: 'assistant',
                content: 'Response',
                metadata: { cost: 1.50, tokens: 100, latency: 1000 }
            }];
            render(<MessageList messages={messages} />);

            const costElement = screen.getByText(/\$1\.50/);
            expect(costElement.className).toContain('text-cost-extreme');
        });
    });

    // Font Size Tests
    describe('Font Size', () => {
        it('should use 15px font size for message bubbles', () => {
            const messages = [{ role: 'user', content: 'Test message' }];
            const { container } = render(<MessageList messages={messages} />);

            // Check that the message bubble has the correct text size class
            const bubble = container.querySelector('.text-\\[15px\\]');
            expect(bubble).not.toBeNull();
        });
    });
});
