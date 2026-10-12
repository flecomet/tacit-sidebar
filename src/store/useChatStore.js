import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { chromeStorageAdapter, holdStorageWrites, releaseStorageWrites } from './chromeStorageAdapter';
import { getHistoryStatus, restoreHistory, restoreHistorySession, prepareHistory, activateHistory, sendHistoryCommand } from '../services/historyClient';
import { startHistorySync, withoutHistorySync, diffSessions, prepareHistoryCommand, settleHistoryWrites, getHistoryMessageId, markLegacyHistory } from './historySync';
import { emptyKeys, emptyActive, addKey, updateKey, removeKey, setActiveKey, migrateKeysToV2 } from './apiKeys';
import { DEFAULT_SORT } from '../services/modelFilters';

const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Date.now().toString() + Math.random().toString(36).substring(2);
};

let historyHydration = null;
let historyHydrationStatus = null;
let historyRoutingVersion = 0;
const sessionRefreshes = new Map();

// Adoption preserves local additions without truncating conversations changed in another panel.
const mergeLocalHistory = (restored, local) => {
    if (!local.length) return restored;
    const merged = [...restored];
    const indices = new Map(restored.map((session, index) => [session.id, index]));
    for (const session of local) {
        const index = indices.get(session.id);
        if (index === undefined) {
            merged.push(session);
            continue;
        }
        const saved = merged[index];
        let cursor = 0;
        const missing = [];
        for (const message of session.messages) {
            const encoded = JSON.stringify(message);
            let found = cursor;
            while (found < saved.messages.length) {
                const candidate = saved.messages[found];
                const localId = getHistoryMessageId(message);
                const savedId = getHistoryMessageId(candidate);
                if (localId && savedId ? localId === savedId : JSON.stringify(candidate) === encoded) break;
                found++;
            }
            if (found < saved.messages.length) cursor = found + 1;
            else missing.push(message);
        }
        if (missing.length) merged[index] = { ...saved, updatedAt: Math.max(saved.updatedAt || 0, session.updatedAt || 0), messages: [...saved.messages, ...missing] };
    }
    return merged;
};

// The saved sort is validated while the settings load, so a corrupted blob cannot leave the picker in an
// invalid state. A stored 'price' stays valid even on a direct provider; the picker displays it as default.
const MODEL_SORT_KEYS = ['default', 'price', 'released', 'name'];
// A stored sort is usable only when both the key and the direction are recognized; otherwise it falls
// back to the whole default, so a valid key with a malformed direction cannot become that key ascending.
const normalizeModelSort = (modelSort) => {
    const key = MODEL_SORT_KEYS.includes(modelSort?.key) ? modelSort.key : null;
    const dir = modelSort?.dir === 'asc' || modelSort?.dir === 'desc' ? modelSort.dir : null;
    return key && dir ? { key, dir } : DEFAULT_SORT;
};

// The saved settings load asynchronously, and the restore needs the saved current session id.
const settingsHydrated = () => new Promise((resolve) => {
    if (useChatStore.persist.hasHydrated()) resolve();
    else useChatStore.persist.onFinishHydration(() => resolve());
});

export const useChatStore = create(
    persist(
        (set, get) => ({
            // Multi-provider support
            activeCloudProvider: 'openrouter', // 'openrouter' | 'openai' | 'anthropic' | 'google'
            setActiveCloudProvider: (provider) => set({ activeCloudProvider: provider }),

            // Several keys per provider; the active one is used for the model list and requests.
            apiKeys: emptyKeys(),
            activeKeyId: emptyActive(),
            addApiKey: (provider, entry) => set(state => addKey(state, provider, entry)),
            updateApiKey: (provider, id, patch) => set(state => updateKey(state, provider, id, patch)),
            removeApiKey: (provider, id) => set(state => removeKey(state, provider, id)),
            setActiveApiKey: (provider, id) => set(state => setActiveKey(state, provider, id)),
            messages: [],
            // Once history encryption is active, sessions live in the background-owned repository
            // and leave the settings blob. A subscriber below turns session changes into commands.
            historyEnabled: false, // saved with the settings so the next start knows before the restore finishes
            historyLoaded: false,
            historyWriteError: null,
            historyNeedsReconcile: false,
            historyRecoverySessions: [],
            historyFailedCommands: [],
            hydrateHistory: (knownStatus) => {
                const baseline = get().sessions;
                const markEnabled = () => withoutHistorySync(() => set(state => ({
                    historyEnabled: true,
                    historyLoaded: false,
                    historyNeedsReconcile: state.historyNeedsReconcile || !state.historyEnabled,
                })));
                if (knownStatus?.enabled) { historyHydrationStatus = knownStatus; markEnabled(); }
                if (historyHydration) return historyHydration;
                historyHydration = (async () => {
                    await settingsHydrated();
                    try {
                        const requestedVersion = historyRoutingVersion;
                        const fetchedStatus = historyHydrationStatus || await getHistoryStatus();
                        // An opt-in transition supersedes any status read started before it.
                        if (!historyHydrationStatus && requestedVersion !== historyRoutingVersion) return null;
                        const status = historyHydrationStatus || fetchedStatus;
                        if (!status?.enabled) {
                            set({ historyEnabled: false, historyLoaded: true, historyWriteError: null, historyNeedsReconcile: false });
                            return status;
                        }
                        markEnabled();
                        await settleHistoryWrites();
                        let sessions = await restoreHistory();
                        const localAdditions = () => get().sessions.flatMap(session => {
                            const old = baseline.find(saved => saved.id === session.id);
                            if (!old) return [session];
                            const messages = session.messages.slice(old.messages.length);
                            return messages.length ? [{ ...session, messages }] : [];
                        });
                        {
                            let local;
                            do {
                                local = get().sessions;
                                const candidates = get().historyNeedsReconcile ? local : localAdditions();
                                const merged = mergeLocalHistory(sessions, [...candidates, ...get().historyRecoverySessions]);
                                for (const command of diffSessions(sessions, merged)) {
                                    const response = await sendHistoryCommand(prepareHistoryCommand(command, generateId, merged));
                                    if (response?.error) throw new Error(response.message || response.error);
                                }
                                sessions = merged;
                            } while (local !== get().sessions);
                        }
                        withoutHistorySync(() => set((state) => {
                            const current = sessions.find(s => s.id === state.currentSessionId);
                            const failures = state.historyFailedCommands.filter(command => command.type === 'history.delete' || command.type === 'history.truncate');
                            return { historyEnabled: true, historyLoaded: true, sessions, messages: current ? current.messages : [], historyWriteError: failures.length ? state.historyWriteError : null, historyNeedsReconcile: false, historyRecoverySessions: [], historyFailedCommands: failures };
                        }));
                        return status;
                    } catch (error) {
                        set({ historyWriteError: error?.message || String(error) });
                        return null;
                    }
                })().finally(() => { historyHydration = null; historyHydrationStatus = null; });
                return historyHydration;
            },
            refreshHistorySession: (sessionId) => {
                if (!get().historyEnabled || !get().historyLoaded) return get().hydrateHistory({ enabled: true });
                const running = sessionRefreshes.get(sessionId);
                if (running) { running.dirty = true; return running.promise; }
                const refresh = { dirty: false, promise: null };
                refresh.promise = (async () => {
                    try {
                        while (true) {
                            refresh.dirty = false;
                            await settleHistoryWrites();
                            const baseline = get().sessions.find(session => session.id === sessionId);
                            const saved = await restoreHistorySession(sessionId);
                            await settleHistoryWrites();
                            if (refresh.dirty || baseline !== get().sessions.find(session => session.id === sessionId)) continue;
                            const pending = get().historyRecoverySessions.filter(session => session.id === sessionId);
                            const restored = mergeLocalHistory(saved ? [saved] : [], pending)[0];
                            withoutHistorySync(() => set(state => {
                                const index = state.sessions.findIndex(session => session.id === sessionId);
                                const sessions = [...state.sessions];
                                if (restored && index >= 0) sessions[index] = restored;
                                else if (restored) sessions.push(restored);
                                else if (index >= 0) sessions.splice(index, 1);
                                const current = sessions.find(session => session.id === state.currentSessionId);
                                return { sessions, messages: current?.messages || [] };
                            }));
                            return restored || null;
                        }
                    } catch (error) {
                        set({ historyWriteError: error?.message || String(error) });
                        return null;
                    }
                })().finally(() => sessionRefreshes.delete(sessionId));
                sessionRefreshes.set(sessionId, refresh);
                return refresh.promise;
            },
            retryHistoryWrites: async () => {
                set({ historyLoaded: false });
                try {
                    await settleHistoryWrites();
                    for (const command of get().historyFailedCommands) {
                        const response = await sendHistoryCommand(command);
                        if (response?.error) throw new Error(response.message || response.error);
                        set(state => ({ historyFailedCommands: state.historyFailedCommands.filter(failed => failed.commandId !== command.commandId) }));
                    }
                    return await get().hydrateHistory({ enabled: true });
                } catch (error) {
                    set({ historyWriteError: error?.message || String(error) });
                    return null;
                }
            },
            enableHistoryEncryption: async () => {
                await settingsHydrated();
                // The newest state is saved first because the background reads the saved blob as the migration source.
                const options = useChatStore.persist.getOptions();
                await options.storage.setItem(options.name, { state: options.partialize(get()), version: options.version });
                try {
                    await prepareHistory();
                } catch (error) {
                    try {
                        const status = await getHistoryStatus();
                        if (status?.enabled) await get().hydrateHistory(status);
                    } catch (statusError) {
                        withoutHistorySync(() => set({ historyLoaded: false, historyWriteError: statusError?.message || String(statusError) }));
                    }
                    throw error;
                }
                // From here the panel stops writing sessions to the blob; the held write is applied after activation.
                historyRoutingVersion++;
                holdStorageWrites();
                markLegacyHistory(get().sessions);
                withoutHistorySync(() => set({ historyEnabled: true, historyLoaded: true }));
                try {
                    return await activateHistory();
                } catch (error) {
                    try {
                        const status = await getHistoryStatus();
                        if (status?.enabled) {
                            withoutHistorySync(() => set({ historyEnabled: true }));
                        } else {
                            withoutHistorySync(() => set({ historyEnabled: false }));
                        }
                    } catch (statusError) {
                        withoutHistorySync(() => set({ historyEnabled: true, historyLoaded: false, historyNeedsReconcile: true, historyWriteError: statusError?.message || String(statusError) }));
                    }
                    throw error;
                } finally {
                    await releaseStorageWrites();
                }
            },
            model: 'anthropic/claude-4-sonnet',
            availableModels: [],
            setModel: (model) => set({ model }),
            setAvailableModels: (models) => set({ availableModels: models }),

            // Multi-session support
            sessions: [],
            currentSessionId: null,

            // Favorites
            favorites: [],

            // Model picker sort and favorites-first, persisted with the settings
            modelSort: DEFAULT_SORT,
            favoritesFirst: false,



            // New Provider Modes
            providerMode: 'cloud', // 'cloud' | 'local'
            setProviderMode: (mode) => set({ providerMode: mode }),

            localBaseUrl: 'http://localhost:11434/v1', // Default to Ollama
            setLocalBaseUrl: (url) => set({ localBaseUrl: url }),

            // Web Search Config (for Local Models)
            webSearchConfig: {
                enabled: false,
                provider: 'brave',
                encryptedApiKey: ''
            },
            setWebSearchConfig: (config) => set(state => {
                const current = state.webSearchConfig;
                const provider = config.provider ?? current.provider;
                const keysByProvider = {
                    ...current.keysByProvider,
                    [current.provider]: current.encryptedApiKey || ''
                };
                const encryptedApiKey = config.encryptedApiKey !== undefined
                    ? config.encryptedApiKey
                    : provider === current.provider ? current.encryptedApiKey : keysByProvider[provider] || '';
                keysByProvider[provider] = encryptedApiKey;
                return { webSearchConfig: { ...current, ...config, encryptedApiKey, keysByProvider } };
            }),

            // LM Studio web search through MCP (native /api/v1/chat, LM Studio 0.4.0 or newer)
            lmStudioSearch: {
                enabled: false,
                integrationId: '', // 'mcp/<label>' or a remote MCP URL
                allowedTools: '', // comma-separated, empty allows all tools of the server
                encryptedToken: ''
            },
            setLmStudioSearch: (config) => set(state => ({ lmStudioSearch: { ...state.lmStudioSearch, ...config } })),

            toggleFavorite: (modelId) => set(state => {
                const isFav = state.favorites.includes(modelId);
                return {
                    favorites: isFav
                        ? state.favorites.filter(id => id !== modelId)
                        : [...state.favorites, modelId]
                };
            }),

            setModelSort: (modelSort) => set({ modelSort }),
            setFavoritesFirst: (favoritesFirst) => set({ favoritesFirst }),

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

            addMessageToSession: (sessionId, message) => set((state) => {
                let newSessions = [...state.sessions];
                const index = newSessions.findIndex(s => s.id === sessionId);

                if (index === -1) return {};

                const currentSession = newSessions[index];
                const newMessages = [...currentSession.messages, message];

                // Auto-title
                let title = currentSession.title;
                if (title === 'New Chat' || !title) {
                    const firstUser = newMessages.find(m => m.role === 'user');
                    if (firstUser) {
                        title = firstUser.content.slice(0, 30).replace(/\n/g, ' ') + (firstUser.content.length > 30 ? '...' : '');
                    }
                }

                newSessions[index] = {
                    ...currentSession,
                    messages: newMessages,
                    title: title || 'Chat',
                    updatedAt: Date.now()
                };

                // If currently active, also update the 'messages' pointer
                if (state.currentSessionId === sessionId) {
                    return {
                        sessions: newSessions,
                        messages: newMessages
                    };
                }

                return { sessions: newSessions };
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

            // Truncate messages at and after the specified index (for edit/regenerate)
            truncateAtMessage: (sessionId, messageIndex) => set((state) => {
                let newSessions = [...state.sessions];
                const index = newSessions.findIndex(s => s.id === sessionId);

                if (index === -1) return {};

                const currentSession = newSessions[index];
                const truncatedMessages = currentSession.messages.slice(0, messageIndex);

                newSessions[index] = {
                    ...currentSession,
                    messages: truncatedMessages,
                    updatedAt: Date.now()
                };

                // If currently active, also update the 'messages' pointer
                if (state.currentSessionId === sessionId) {
                    return {
                        sessions: newSessions,
                        messages: truncatedMessages
                    };
                }

                return { sessions: newSessions };
            }),

            reset: () => set({
                apiKeys: emptyKeys(),
                activeKeyId: emptyActive(),
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
                ...(state.historyEnabled ? {} : { messages: state.messages, sessions: state.sessions }),
                historyEnabled: state.historyEnabled,
                model: state.model,
                apiKeys: state.apiKeys,
                activeKeyId: state.activeKeyId,
                activeCloudProvider: state.activeCloudProvider,
                currentSessionId: state.currentSessionId,
                favorites: state.favorites,
                modelSort: state.modelSort,
                favoritesFirst: state.favoritesFirst,

                providerMode: state.providerMode,
                localBaseUrl: state.localBaseUrl,
                webSearchConfig: state.webSearchConfig,
                lmStudioSearch: state.lmStudioSearch
            }),
            merge: (persisted, current) => ({
                ...current,
                ...persisted,
                modelSort: normalizeModelSort(persisted?.modelSort),
                favoritesFirst: persisted?.favoritesFirst === true
            }),
            version: 5,
            migrate: (persisted, version) => {
                if (!persisted) return persisted;
                if (version < 1) {
                    // v0 had one shared customBaseUrl for OpenRouter and OpenAI.
                    const legacy = persisted.customBaseUrl || '';
                    const target = legacy.includes('openrouter') ? 'openrouter' : 'openai';
                    persisted.customBaseUrls = { openrouter: '', openai: '', ...(legacy ? { [target]: legacy } : {}) };
                    delete persisted.customBaseUrl;
                }
                if (version < 2) persisted = migrateKeysToV2(persisted);
                if (version < 4) delete persisted.includeFreeModels;
                if (version < 5) {
                    persisted.modelSort = DEFAULT_SORT;
                    persisted.favoritesFirst = false;
                }
                return persisted;
            }
        }
    )
);

startHistorySync({
    store: useChatStore,
    send: sendHistoryCommand,
    createId: generateId,
    onError: (message) => useChatStore.setState({ historyWriteError: message }),
    onFailure: (command, error) => {
        if (error?.code !== 'HISTORY_REVISION_CONFLICT') {
            useChatStore.setState(state => ({ historyFailedCommands: [...state.historyFailedCommands, command] }));
        }
        if (command.type === 'history.append' || command.type === 'history.create') {
            const session = command.type === 'history.create' ? command.session : { ...command.session, messages: [command.message] };
            useChatStore.setState(state => ({ historyRecoverySessions: [...state.historyRecoverySessions, session] }));
        }
        if (error?.code === 'HISTORY_REVISION_CONFLICT') {
            useChatStore.getState().hydrateHistory({ enabled: true }).then(() => {
                useChatStore.setState({ historyWriteError: 'History changed in another panel. Unsaved messages were preserved; review the conversation before editing again.' });
            });
        }
    },
});
