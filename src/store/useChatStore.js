import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { chromeStorageAdapter } from './chromeStorageAdapter';

const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Date.now().toString() + Math.random().toString(36).substring(2);
};

export const useChatStore = create(
    persist(
        (set, get) => ({
            // Multi-provider support
            activeCloudProvider: 'openrouter', // 'openrouter' | 'openai' | 'anthropic' | 'google'
            setActiveCloudProvider: (provider) => set({ activeCloudProvider: provider }),

            encryptedApiKeys: {
                openrouter: '',
                openai: '',
                anthropic: '',
                google: ''
            },
            setEncryptedApiKey: (provider, key) => set((state) => ({
                encryptedApiKeys: { ...state.encryptedApiKeys, [provider]: key }
            })),
            includeFreeModels: false,
            setIncludeFreeModels: (include) => set({ includeFreeModels: include }),
            messages: [],
            model: 'anthropic/claude-4-sonnet',
            availableModels: [],
            setModel: (model) => set({ model }),
            setAvailableModels: (models) => set({ availableModels: models }),

            // Multi-session support
            sessions: [],
            currentSessionId: null,

            // Favorites
            favorites: [],



            customBaseUrl: '', // For Custom Cloud compliant servers
            setCustomBaseUrl: (url) => set({ customBaseUrl: url }),

            // New Provider Modes
            providerMode: 'cloud', // 'cloud' | 'local'
            setProviderMode: (mode) => set({ providerMode: mode }),

            localBaseUrl: 'http://localhost:11434/v1', // Default to Ollama
            setLocalBaseUrl: (url) => set({ localBaseUrl: url }),

            toggleFavorite: (modelId) => set(state => {
                const isFav = state.favorites.includes(modelId);
                return {
                    favorites: isFav
                        ? state.favorites.filter(id => id !== modelId)
                        : [...state.favorites, modelId]
                };
            }),

            addMessage: (message) => set((state) => {
                const newMessages = [...state.messages, message];

                // Update current session
                let newSessions = [...state.sessions];
                const currentIndex = newSessions.findIndex(s => s.id === state.currentSessionId);

                if (currentIndex >= 0) {
                    const currentSession = newSessions[currentIndex];
                    // Auto-title
                    let title = currentSession.title;
                    if (title === 'New Chat' || !title) {
                        const firstUser = newMessages.find(m => m.role === 'user');
                        if (firstUser) {
                            title = firstUser.content.slice(0, 30).replace(/\n/g, ' ') + (firstUser.content.length > 30 ? '...' : '');
                        }
                    }

                    newSessions[currentIndex] = {
                        ...currentSession,
                        messages: newMessages,
                        title: title || 'Chat',
                        updatedAt: Date.now()
                    };
                } else {
                    // Fallback: should have been initialized
                }

                return {
                    messages: newMessages,
                    sessions: newSessions
                };
            }),

            clearHistory: () => set((state) => {
                // Clears messages of current chat
                // Should also clear frames in session
                let newSessions = [...state.sessions];
                const currentIndex = newSessions.findIndex(s => s.id === state.currentSessionId);
                if (currentIndex >= 0) {
                    newSessions[currentIndex] = {
                        ...newSessions[currentIndex],
                        messages: [],
                        updatedAt: Date.now()
                    };
                }
                return { messages: [], sessions: newSessions };
            }),

            createNewChat: () => set((state) => {
                // If current is empty, ignore
                if (state.messages.length === 0 && state.sessions.length > 0) return state;

                const newId = generateId();
                const newSession = {
                    id: newId,
                    title: 'New Chat',
                    messages: [],
                    model: state.model,
                    updatedAt: Date.now()
                };

                return {
                    currentSessionId: newId,
                    messages: [],
                    sessions: [...state.sessions, newSession]
                };
            }),

            ensureActiveSession: () => set((state) => {
                if (!state.currentSessionId || !state.sessions.find(s => s.id === state.currentSessionId)) {
                    // Create defaults
                    const newId = generateId();
                    const newSession = {
                        id: newId,
                        title: state.messages.length > 0 ? 'Restored Chat' : 'New Chat',
                        messages: state.messages, // Adopt orphans if any
                        model: state.model,
                        updatedAt: Date.now()
                    };
                    return {
                        sessions: [...state.sessions, newSession],
                        currentSessionId: newId
                    };
                }
                return {};
            }),

            restoreSession: (id) => set((state) => {
                const session = state.sessions.find(s => s.id === id);
                if (!session) return {};
                return {
                    currentSessionId: session.id,
                    messages: session.messages,
                    model: session.model || state.model
                };
            }),

            deleteSession: (id) => set((state) => {
                const newSessions = state.sessions.filter(s => s.id !== id);

                // If we deleted current
                if (id === state.currentSessionId) {
                    if (newSessions.length > 0) {
                        // Activate most recent
                        const recent = newSessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
                        return {
                            sessions: newSessions,
                            currentSessionId: recent.id,
                            messages: recent.messages,
                            model: recent.model || state.model
                        };
                    } else {
                        // Reset to clean slate
                        const newId = generateId();
                        const newSession = { id: newId, title: 'New Chat', messages: [], updatedAt: Date.now(), model: state.model };
                        return {
                            sessions: [newSession],
                            currentSessionId: newId,
                            messages: [],
                        };
                    }
                }

                return { sessions: newSessions };
            }),

            reset: () => set({
                encryptedApiKeys: { openrouter: '', openai: '', anthropic: '', google: '' },
                messages: [],
                sessions: [],
                currentSessionId: null,
                model: 'anthropic/claude-4-sonnet'
            })
        }),
        {
            name: 'tacit-storage',
            storage: createJSONStorage(() => chromeStorageAdapter),
            partialize: (state) => ({
                messages: state.messages,
                model: state.model,
                encryptedApiKeys: state.encryptedApiKeys,
                activeCloudProvider: state.activeCloudProvider,
                sessions: state.sessions,
                currentSessionId: state.currentSessionId,
                favorites: state.favorites,

                customBaseUrl: state.customBaseUrl,
                includeFreeModels: state.includeFreeModels,
                providerMode: state.providerMode,
                localBaseUrl: state.localBaseUrl
            }),
            version: 0,
            migrate: (state) => state
        }
    )
);
