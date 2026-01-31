import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { chromeStorageAdapter } from './chromeStorageAdapter';

const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Date.now().toString() + Math.random().toString(36).substring(2);
};

export const usePromptsStore = create(
    persist(
        (set, get) => ({
            savedPrompts: [],

            addPrompt: (content) => set((state) => {
                // Auto-generate name from first 30 chars, strip newlines
                const cleanContent = content.replace(/\n/g, ' ');
                const name = cleanContent.length > 30
                    ? cleanContent.slice(0, 30) + '...'
                    : cleanContent;

                const newPrompt = {
                    id: generateId(),
                    name,
                    content,
                    createdAt: Date.now()
                };

                return {
                    savedPrompts: [...state.savedPrompts, newPrompt]
                };
            }),

            updatePrompt: (id, updates) => set((state) => {
                const index = state.savedPrompts.findIndex(p => p.id === id);
                if (index === -1) return {};

                const newPrompts = [...state.savedPrompts];
                newPrompts[index] = { ...newPrompts[index], ...updates };

                return { savedPrompts: newPrompts };
            }),

            deletePrompt: (id) => set((state) => ({
                savedPrompts: state.savedPrompts.filter(p => p.id !== id)
            }))
        }),
        {
            name: 'tacit-prompts-storage',
            storage: createJSONStorage(() => chromeStorageAdapter),
            partialize: (state) => ({
                savedPrompts: state.savedPrompts
            }),
            version: 0,
            migrate: (state) => state
        }
    )
);
