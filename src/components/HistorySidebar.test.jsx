import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HistorySidebar from './HistorySidebar';
import { useChatStore } from '../store/useChatStore';

// Mock the store
vi.mock('../store/useChatStore', () => ({
    useChatStore: vi.fn()
}));

describe('HistorySidebar', () => {
    const mockSessions = [
        {
            id: 'session-1',
            title: 'React Hooks Discussion',
            messages: [
                { role: 'user', content: 'How do I use useState?' },
                { role: 'assistant', content: 'useState is a React hook...' }
            ],
            updatedAt: Date.now() - 1000
        },
        {
            id: 'session-2',
            title: 'Python Debugging',
            messages: [
                { role: 'user', content: 'My code has a bug with async await' },
                { role: 'assistant', content: 'Check if your function is marked as async...' }
            ],
            updatedAt: Date.now() - 2000
        },
        {
            id: 'session-3',
            title: 'Untitled Chat',
            messages: [
                { role: 'user', content: 'What is the weather like?' },
                { role: 'assistant', content: 'I cannot check real-time weather...' }
            ],
            updatedAt: Date.now() - 3000
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useChatStore).mockReturnValue({
            sessions: mockSessions,
            currentSessionId: 'session-1',
            restoreSession: vi.fn(),
            deleteSession: vi.fn(),
            createNewChat: vi.fn()
        });
    });

    describe('Search Functionality', () => {
        it('renders search input when sidebar is open', () => {
            render(<HistorySidebar isOpen={true} onClose={() => { }} />);
            expect(screen.getByPlaceholderText(/search/i)).toBeDefined();
        });

        it('filters sessions by title match', () => {
            render(<HistorySidebar isOpen={true} onClose={() => { }} />);

            const searchInput = screen.getByPlaceholderText(/search/i);
            fireEvent.change(searchInput, { target: { value: 'React' } });

            expect(screen.getByText('React Hooks Discussion')).toBeDefined();
            expect(screen.queryByText('Python Debugging')).toBeNull();
        });

        it('filters sessions by message content (fuzzy)', () => {
            render(<HistorySidebar isOpen={true} onClose={() => { }} />);

            const searchInput = screen.getByPlaceholderText(/search/i);
            fireEvent.change(searchInput, { target: { value: 'async await' } });

            // Should find session with "async await" in message content
            expect(screen.getByText('Python Debugging')).toBeDefined();
            expect(screen.queryByText('React Hooks Discussion')).toBeNull();
        });

        it('fuzzy matches partial words', () => {
            render(<HistorySidebar isOpen={true} onClose={() => { }} />);

            const searchInput = screen.getByPlaceholderText(/search/i);
            fireEvent.change(searchInput, { target: { value: 'useState' } });

            expect(screen.getByText('React Hooks Discussion')).toBeDefined();
        });

        it('search is case-insensitive', () => {
            render(<HistorySidebar isOpen={true} onClose={() => { }} />);

            const searchInput = screen.getByPlaceholderText(/search/i);
            fireEvent.change(searchInput, { target: { value: 'PYTHON' } });

            expect(screen.getByText('Python Debugging')).toBeDefined();
        });

        it('shows all sessions when search is cleared', () => {
            render(<HistorySidebar isOpen={true} onClose={() => { }} />);

            const searchInput = screen.getByPlaceholderText(/search/i);
            fireEvent.change(searchInput, { target: { value: 'React' } });
            fireEvent.change(searchInput, { target: { value: '' } });

            expect(screen.getByText('React Hooks Discussion')).toBeDefined();
            expect(screen.getByText('Python Debugging')).toBeDefined();
            expect(screen.getByText('Untitled Chat')).toBeDefined();
        });

        it('shows no results message when search has no matches', () => {
            render(<HistorySidebar isOpen={true} onClose={() => { }} />);

            const searchInput = screen.getByPlaceholderText(/search/i);
            fireEvent.change(searchInput, { target: { value: 'xyznonexistent' } });

            expect(screen.getByText(/no results/i)).toBeDefined();
        });

        it('search completes within reasonable time for large datasets', () => {
            // Create 100 sessions with varied content
            const largeSessions = Array.from({ length: 100 }, (_, i) => ({
                id: `session-${i}`,
                title: `Session ${i} - ${i % 2 === 0 ? 'Important' : 'Regular'}`,
                messages: [
                    { role: 'user', content: `Message ${i} with some content about topic ${i % 10}` },
                    { role: 'assistant', content: `Response ${i} discussing various aspects` }
                ],
                updatedAt: Date.now() - i * 1000
            }));

            vi.mocked(useChatStore).mockReturnValue({
                sessions: largeSessions,
                currentSessionId: 'session-0',
                restoreSession: vi.fn(),
                deleteSession: vi.fn(),
                createNewChat: vi.fn()
            });

            render(<HistorySidebar isOpen={true} onClose={() => { }} />);

            const searchInput = screen.getByPlaceholderText(/search/i);
            const startTime = performance.now();
            fireEvent.change(searchInput, { target: { value: 'Important' } });
            const endTime = performance.now();

            // Search should complete within 100ms
            expect(endTime - startTime).toBeLessThan(100);
        });

        it('has clear button that resets search', () => {
            render(<HistorySidebar isOpen={true} onClose={() => { }} />);

            const searchInput = screen.getByPlaceholderText(/search/i);
            fireEvent.change(searchInput, { target: { value: 'React' } });

            const clearButton = screen.getByLabelText(/clear search/i);
            fireEvent.click(clearButton);

            expect(searchInput.value).toBe('');
        });
    });
});
