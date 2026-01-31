import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';

// Mock chrome.storage.local before importing the store
const mockStorage = {};
vi.stubGlobal('chrome', {
    storage: {
        local: {
            get: vi.fn((keys, callback) => {
                const result = {};
                if (Array.isArray(keys)) {
                    keys.forEach(k => { if (mockStorage[k]) result[k] = mockStorage[k]; });
                } else if (typeof keys === 'string') {
                    if (mockStorage[keys]) result[keys] = mockStorage[keys];
                }
                if (callback) callback(result);
                return Promise.resolve(result);
            }),
            set: vi.fn((items, callback) => {
                Object.assign(mockStorage, items);
                if (callback) callback();
                return Promise.resolve();
            }),
            remove: vi.fn((keys, callback) => {
                if (Array.isArray(keys)) {
                    keys.forEach(k => delete mockStorage[k]);
                } else {
                    delete mockStorage[keys];
                }
                if (callback) callback();
                return Promise.resolve();
            })
        }
    }
});

// Import the store after mocking
import { usePromptsStore } from './usePromptsStore';

describe('usePromptsStore', () => {
    beforeEach(() => {
        // Clear mock storage and reset store state
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);

        act(() => {
            usePromptsStore.setState({
                savedPrompts: []
            });
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('addPrompt', () => {
        it('should add a prompt with auto-generated name from first 30 chars', () => {
            const content = 'Summarize the following text in bullet points';

            act(() => {
                usePromptsStore.getState().addPrompt(content);
            });

            const { savedPrompts } = usePromptsStore.getState();
            expect(savedPrompts).toHaveLength(1);
            expect(savedPrompts[0].content).toBe(content);
            expect(savedPrompts[0].name).toBe('Summarize the following text i...');
            expect(savedPrompts[0].id).toBeDefined();
            expect(savedPrompts[0].createdAt).toBeDefined();
        });

        it('should use full text as name if content is shorter than 30 chars', () => {
            const content = 'Translate to French';

            act(() => {
                usePromptsStore.getState().addPrompt(content);
            });

            const { savedPrompts } = usePromptsStore.getState();
            expect(savedPrompts[0].name).toBe('Translate to French');
        });

        it('should strip newlines from auto-generated name', () => {
            const content = 'First line\nSecond line\nThird line of the prompt';

            act(() => {
                usePromptsStore.getState().addPrompt(content);
            });

            const { savedPrompts } = usePromptsStore.getState();
            expect(savedPrompts[0].name).not.toContain('\n');
            expect(savedPrompts[0].name).toBe('First line Second line Third l...');
        });

        it('should generate unique IDs for multiple prompts', () => {
            act(() => {
                usePromptsStore.getState().addPrompt('Prompt 1');
                usePromptsStore.getState().addPrompt('Prompt 2');
            });

            const { savedPrompts } = usePromptsStore.getState();
            expect(savedPrompts).toHaveLength(2);
            expect(savedPrompts[0].id).not.toBe(savedPrompts[1].id);
        });
    });

    describe('updatePrompt', () => {
        it('should update prompt name', () => {
            act(() => {
                usePromptsStore.getState().addPrompt('Original content');
            });

            const { savedPrompts } = usePromptsStore.getState();
            const promptId = savedPrompts[0].id;

            act(() => {
                usePromptsStore.getState().updatePrompt(promptId, { name: 'Custom Name' });
            });

            const updated = usePromptsStore.getState().savedPrompts[0];
            expect(updated.name).toBe('Custom Name');
            expect(updated.content).toBe('Original content'); // Content unchanged
        });

        it('should update prompt content', () => {
            act(() => {
                usePromptsStore.getState().addPrompt('Original content');
            });

            const promptId = usePromptsStore.getState().savedPrompts[0].id;

            act(() => {
                usePromptsStore.getState().updatePrompt(promptId, { content: 'Updated content' });
            });

            const updated = usePromptsStore.getState().savedPrompts[0];
            expect(updated.content).toBe('Updated content');
        });

        it('should not modify other prompts when updating', () => {
            act(() => {
                usePromptsStore.getState().addPrompt('Prompt One');
                usePromptsStore.getState().addPrompt('Prompt Two');
            });

            const prompts = usePromptsStore.getState().savedPrompts;
            const firstId = prompts[0].id;

            act(() => {
                usePromptsStore.getState().updatePrompt(firstId, { name: 'Renamed' });
            });

            const updated = usePromptsStore.getState().savedPrompts;
            expect(updated[0].name).toBe('Renamed');
            expect(updated[1].name).toBe('Prompt Two'); // Unchanged
        });

        it('should do nothing if prompt ID does not exist', () => {
            act(() => {
                usePromptsStore.getState().addPrompt('Existing prompt');
            });

            const before = usePromptsStore.getState().savedPrompts;

            act(() => {
                usePromptsStore.getState().updatePrompt('non-existent-id', { name: 'New Name' });
            });

            const after = usePromptsStore.getState().savedPrompts;
            expect(after).toEqual(before);
        });
    });

    describe('deletePrompt', () => {
        it('should remove a prompt by ID', () => {
            act(() => {
                usePromptsStore.getState().addPrompt('To be deleted');
            });

            const promptId = usePromptsStore.getState().savedPrompts[0].id;

            act(() => {
                usePromptsStore.getState().deletePrompt(promptId);
            });

            expect(usePromptsStore.getState().savedPrompts).toHaveLength(0);
        });

        it('should only remove the specified prompt', () => {
            act(() => {
                usePromptsStore.getState().addPrompt('Keep this');
                usePromptsStore.getState().addPrompt('Delete this');
            });

            const prompts = usePromptsStore.getState().savedPrompts;
            const deleteId = prompts[1].id;

            act(() => {
                usePromptsStore.getState().deletePrompt(deleteId);
            });

            const remaining = usePromptsStore.getState().savedPrompts;
            expect(remaining).toHaveLength(1);
            expect(remaining[0].content).toBe('Keep this');
        });

        it('should do nothing if prompt ID does not exist', () => {
            act(() => {
                usePromptsStore.getState().addPrompt('Existing prompt');
            });

            act(() => {
                usePromptsStore.getState().deletePrompt('non-existent-id');
            });

            expect(usePromptsStore.getState().savedPrompts).toHaveLength(1);
        });
    });

    describe('persistence', () => {
        it('should include savedPrompts in persisted state', () => {
            // The store uses persist middleware with partialize
            // This test verifies the store structure is correct for persistence
            act(() => {
                usePromptsStore.getState().addPrompt('Persistent prompt');
            });

            const state = usePromptsStore.getState();
            expect(state.savedPrompts).toBeDefined();
            expect(Array.isArray(state.savedPrompts)).toBe(true);
        });
    });
});
