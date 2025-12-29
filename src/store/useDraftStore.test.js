import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDraftStore } from './useDraftStore';

// Mock chromeStorageAdapter
vi.mock('./chromeStorageAdapter', () => ({
    chromeStorageAdapter: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
    }
}));

describe('useDraftStore', () => {
    beforeEach(() => {
        useDraftStore.setState({ draft: '' });
        vi.clearAllMocks();
    });

    it('should initialize with empty draft', () => {
        expect(useDraftStore.getState().draft).toBe('');
    });

    it('should update draft', () => {
        useDraftStore.getState().setDraft('Hello World');
        expect(useDraftStore.getState().draft).toBe('Hello World');
    });

    it('should clear draft', () => {
        useDraftStore.setState({ draft: 'Something' });
        useDraftStore.getState().setDraft('');
        expect(useDraftStore.getState().draft).toBe('');
    });
});
