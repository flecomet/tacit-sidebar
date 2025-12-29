import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { chromeStorageAdapter } from './chromeStorageAdapter';

export const useDraftStore = create(
    persist(
        (set) => ({
            draft: '',
            setDraft: (text) => set({ draft: text }),
        }),
        {
            name: 'tacit-draft-storage',
            storage: createJSONStorage(() => chromeStorageAdapter),
            version: 0,
        }
    )
);
