import React, { useState, useEffect, useRef } from 'react';
import { Settings, Lock, X, Plus, Menu, ChevronDown } from 'lucide-react';
import HistorySidebar from '../components/HistorySidebar';
import ChatInput from '../components/ChatInput';
import MessageList from '../components/MessageList';
import { useChatStore } from '../store/useChatStore';
import { processFile } from '../utils/fileProcessor';
import { scrapePage } from '../utils/pageScraper';
import { fetchModels, clearModelCache } from '../services/modelService';
import { chatService } from '../services/chatService';
import { isOpenRouterEuEndpoint } from '../services/openrouterPayload';
import { supportsImageInput } from '../services/modelCatalog';
import { encryptData, decryptData } from '../utils/encryption';
import ApiKeysSettings from '../components/ApiKeysSettings';
import { getActiveKey } from '../store/apiKeys';
import { getModalities } from '../services/modelFilters';
import { normalizeUsage, computeCost } from '../services/usage';
import DocViewerModal from '../components/DocViewerModal';
import EncryptionStatus from '../components/EncryptionStatus';
import HistoryEncryptionSettings from '../components/HistoryEncryptionSettings';
import { settleHistoryWrites, isOwnHistoryChange } from '../store/historySync';
import { useHistoryEncryptionStatus } from '../hooks/useHistoryEncryptionStatus';
import { subscribeHistoryStatus, subscribeHistoryChanges, resumeHistory, pauseHistory } from '../services/historyClient';

// Fallback when the provider gives no output types for the model.
const IMAGE_MODEL_NAME = /flux|dall-?e|stable.?diffusion|imagen|midjourney|banana|image/i;

export default function App() {
    const {
        activeCloudProvider, setActiveCloudProvider,
        apiKeys, activeKeyId,
        messages, addMessage,
        model, setModel, createNewChat,
        availableModels, setAvailableModels,
        ensureActiveSession,

        providerMode, setProviderMode,
        localBaseUrl, setLocalBaseUrl,
        webSearchConfig, setWebSearchConfig,
        lmStudioSearch, setLmStudioSearch,
        truncateAtMessage, currentSessionId: storeSessionId
    } = useChatStore();

    const activeKey = getActiveKey({ apiKeys, activeKeyId }, activeCloudProvider);
    const activeBaseUrl = activeKey?.baseUrl || '';

    // Local UI state
    const [showSettings, setShowSettings] = useState(false);
    const [loadingSessionIds, setLoadingSessionIds] = useState([]); // Track loading state per session
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [attachments, setAttachments] = useState([]);

    const [tempLocalUrl, setTempLocalUrl] = useState('');

    // Web Search Settings State
    const [tempSearchKey, setTempSearchKey] = useState('');
    const [tempSearchCX, setTempSearchCX] = useState('');

    // LM Studio MCP Search Settings State
    const [tempLmEnabled, setTempLmEnabled] = useState(false);
    const [tempLmIntegration, setTempLmIntegration] = useState('');
    const [tempLmTools, setTempLmTools] = useState('');
    const [tempLmToken, setTempLmToken] = useState('');

    const [isDragging, setIsDragging] = useState(false);
    const [viewingFile, setViewingFile] = useState(null);
    const abortControllerRef = useRef(null);

    // Model discovery state for the active catalogue. Transient: never persisted.
    // catalogStatus: 'loading' | 'ready' | 'error' | 'missing-key' (OpenRouter without a usable key).
    const [catalogStatus, setCatalogStatus] = useState('loading');
    const [catalogError, setCatalogError] = useState('');
    const [modelRefreshCount, setModelRefreshCount] = useState(0);

    // Derived loading state for current view
    const currentSessionId = useChatStore(state => state.currentSessionId);
    const isCurrentSessionLoading = loadingSessionIds.includes(currentSessionId);

    const encryption = useHistoryEncryptionStatus();
    const [encryptionBusy, setEncryptionBusy] = useState(false);
    const [encryptionError, setEncryptionError] = useState('');
    // Chats cannot be saved safely until encrypted history is read back into memory.
    const historyLoading = useChatStore(state => !state.historyLoaded);
    const historyLoadError = useChatStore(state => state.historyWriteError);

    // Initialize session. Restoring first keeps a placeholder chat from being created beside the saved ones.
    useEffect(() => {
        let cancelled = false;
        useChatStore.getState().hydrateHistory().finally(() => {
            // After a failed restore a placeholder chat would be written next to the unread ones.
            const { historyLoaded } = useChatStore.getState();
            if (!cancelled && historyLoaded) ensureActiveSession();
        });
        return () => { cancelled = true; };
    }, [ensureActiveSession]);

    // Another panel can turn encryption on; this one then reads the repository instead of the saved blob.
    useEffect(() => subscribeHistoryStatus((status) => {
        const state = useChatStore.getState();
        if (status?.enabled && !state.historyEnabled) state.hydrateHistory(status);
    }), []);

    useEffect(() => {
        let active = true;
        let refreshing = false;
        let pending = false;
        const refresh = async (event) => {
            if (isOwnHistoryChange(event)) return;
            if (event?.sessionId) {
                const state = useChatStore.getState();
                if (active && state.historyEnabled) {
                    await state.refreshHistorySession(event.sessionId);
                    const restored = useChatStore.getState();
                    if (active && restored.historyLoaded) restored.ensureActiveSession();
                }
                return;
            }
            pending = true;
            if (refreshing) return;
            refreshing = true;
            do {
                pending = false;
                await settleHistoryWrites();
                const state = useChatStore.getState();
                if (active && state.historyEnabled) {
                    await state.hydrateHistory({ enabled: true });
                    const restored = useChatStore.getState();
                    if (active && restored.historyLoaded) restored.ensureActiveSession();
                }
            } while (active && pending);
            refreshing = false;
        };
        const unsubscribe = subscribeHistoryChanges(refresh);
        return () => { active = false; unsubscribe(); };
    }, []);

    const runEncryptionAction = async (action) => {
        setEncryptionBusy(true);
        setEncryptionError('');
        try {
            await action();
        } catch (error) {
            setEncryptionError(error?.message || String(error));
        } finally {
            setEncryptionBusy(false);
        }
    };

    // Initialize the local URL field when settings open
    useEffect(() => {
        if (showSettings) setTempLocalUrl(localBaseUrl || '');
    }, [showSettings, localBaseUrl]);

    // Load Search Keys
    useEffect(() => {
        let cancelled = false;
        setTempSearchKey('');
        const loadSearchKey = async () => {
            if (showSettings) {
                setTempSearchCX(webSearchConfig.cx || '');
                if (webSearchConfig.encryptedApiKey) {
                    try {
                        const key = await decryptData(webSearchConfig.encryptedApiKey);
                        if (!cancelled) setTempSearchKey(key || '');
                    } catch (e) { console.error(e); if (!cancelled) setTempSearchKey(''); }
                } else {
                    setTempSearchKey('');
                }
            }
        };
        loadSearchKey();
        return () => { cancelled = true; };
    }, [showSettings, webSearchConfig]);

    // Load LM Studio MCP search settings
    useEffect(() => {
        const loadLmSettings = async () => {
            if (showSettings) {
                setTempLmEnabled(!!lmStudioSearch.enabled);
                setTempLmIntegration(lmStudioSearch.integrationId || '');
                setTempLmTools(lmStudioSearch.allowedTools || '');
                if (lmStudioSearch.encryptedToken) {
                    try {
                        const token = await decryptData(lmStudioSearch.encryptedToken);
                        setTempLmToken(token || '');
                    } catch (e) { console.error(e); setTempLmToken(''); }
                } else {
                    setTempLmToken('');
                }
            }
        };
        loadLmSettings();
    }, [showSettings, lmStudioSearch]);

    // Only the visible settings form owns edits to the saved local address.
    useEffect(() => {
        if (!showSettings) return;

        const timer = setTimeout(() => {
            if (localBaseUrl !== tempLocalUrl) {
                setLocalBaseUrl(tempLocalUrl);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [showSettings, tempLocalUrl, localBaseUrl, setLocalBaseUrl]);

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const processed = await processFile(file);
            setAttachments(prev => [...prev, processed]);
        } catch (err) {
            alert('Error processing file: ' + err.message);
        }
    };

    const handleReadPage = async () => {
        try {
            const processed = await scrapePage();
            setAttachments(prev => [...prev, processed]);
        } catch (err) {
            if (err.message && err.message.includes('The extensions gallery cannot be scripted')) {
                alert('Cannot read this page: security restrictions prevent extensions from reading the Chrome Web Store or other internal pages.\n\nPlease try a regular website.');
            } else {
                alert('Error reading page: ' + err.message);
            }
        }
    };

    const handleNewChat = () => {
        if (historyLoading) return;
        createNewChat();
        setAttachments([]);
    };

    // Drag and Drop Handlers
    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        if (e.currentTarget.contains(e.relatedTarget)) {
            return;
        }
        setIsDragging(false);
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);

        // 1. Handle Files (Desktop Drop)
        if (files.length > 0) {
            for (const file of files) {
                try {
                    const processed = await processFile(file);
                    setAttachments(prev => [...prev, processed]);
                } catch (err) {
                    console.error("Error processing dropped file:", err);
                    alert(`Error processing ${file.name}: ${err.message}`);
                }
            }
            return;
        }

        // 2. Handle URLs (Web Drop)
        // Feature disabled due to strict CSP
        const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (url && (url.startsWith('http') || url.startsWith('data:'))) {
            if (url.startsWith('data:')) {
                try {
                    const matches = url.match(/^data:([^;]+);/);
                    const contentType = matches ? matches[1] : 'application/octet-stream';
                    const res = await fetch(url);
                    const blob = await res.blob();
                    const fileName = 'dropped_content.png'; // simplified
                    const file = new File([blob], fileName, { type: contentType });
                    const processed = await processFile(file);
                    setAttachments(prev => [...prev, processed]);
                } catch (e) {
                    console.error("Failed to process data URL", e);
                }
            } else {
                console.log("Web URL dropped, ignoring per CSP policy.");
            }
        }
    };

    // The catalogue endpoint this effect actually uses. Deriving it before the effect keeps an
    // unrelated settings edit (for example the local URL while a cloud provider is active) from
    // re-running discovery and clearing the current list.
    const modelsUrl = providerMode === 'local' ? localBaseUrl : activeBaseUrl;

    // Fetch models on mount or when settings change
    useEffect(() => {
        let isActive = true;

        const loadModels = async () => {
            const isLocal = providerMode === 'local';
            const provider = isLocal ? 'local' : activeCloudProvider;
            const urlToUse = modelsUrl;
            // The previous key's or endpoint's list must not stay selectable while this one loads.
            setAvailableModels([]);
            setCatalogStatus('loading');
            setCatalogError('');
            let apiKey = '';

            if (!isLocal) {
                const encKey = activeKey?.encryptedKey;
                if (encKey) {
                    try {
                        apiKey = await decryptData(encKey);
                    } catch (e) {
                        console.error("Failed to decrypt key:", e);
                    }
                }
            }

            // Check active status before fetch to avoid unnecessary calls if already unmounted/changed
            if (!isActive) return;

            // OpenRouter lists only what a key may use. Without one there is nothing to request; the
            // selection is kept for the next discovery to confirm or clear.
            if (provider === 'openrouter' && !apiKey) {
                setCatalogStatus('missing-key');
                return;
            }

            try {
                const models = await fetchModels(urlToUse, provider, apiKey);

                if (!isActive) return;

                console.log("Models fetched:", models?.length);

                setAvailableModels(models);

                const currentModel = useChatStore.getState().model;
                const isCurrentValid = models.some(m => m.id === currentModel);

                // An empty provider list must not retain another provider's selection. OpenRouter never
                // substitutes a model (it could be paid); the user chooses a replacement explicitly.
                if (!isCurrentValid) {
                    setModel(provider === 'openrouter' ? '' : (models[0]?.id || ''));
                }
                setCatalogStatus('ready');
            } catch (err) {
                if (!isActive) return;
                console.error("Failed to fetch models:", err);
                setAvailableModels([]);
                setModel('');
                setCatalogStatus('error');
                setCatalogError(err?.message || '');
            }
        };

        loadModels();

        return () => {
            isActive = false;
        };
    }, [activeKey?.encryptedKey, modelsUrl, providerMode, activeCloudProvider, setAvailableModels, setModel, modelRefreshCount]);

    // Discovery only: bypasses the five-minute cache and never resends a message.
    const handleRefreshModels = () => {
        clearModelCache(activeCloudProvider);
        setModelRefreshCount(count => count + 1);
    };

    // An OpenRouter message needs a loaded catalogue and a chosen model; other providers keep their behavior.
    const isCatalogBlocked = providerMode !== 'local' && activeCloudProvider === 'openrouter'
        && (catalogStatus !== 'ready' || !model);

    const handleSend = async (text, options = {}) => {
        const isLocal = providerMode === 'local';
        const provider = isLocal ? 'local' : activeCloudProvider;
        const { webSearch } = options;
        let apiKey = '';

        if (!isLocal) {
            const encKey = activeKey?.encryptedKey;
            if (!encKey) {
                setShowSettings(true);
                return false;
            }
            apiKey = await decryptData(encKey);
            if (!apiKey) {
                setShowSettings(true);
                return false;
            }
        }

        // Nothing is added to the conversation, and the draft and attachments stay as they are.
        if (isCatalogBlocked) return false;

        // Capture session ID *before* async operation so we lock the correct session
        const initiatingSessionId = useChatStore.getState().currentSessionId;
        setLoadingSessionIds(prev => [...prev, initiatingSessionId]);

        try {
            // 1. Check Payload Requirements (Vision)
            const activeModelData = availableModels.find(m => m.id === model);
            const hasImages = attachments.some(f => f.type === 'image');

            // Block only when the provider says the model is text-only; unknown capability lets the provider decide.
            if (hasImages && supportsImageInput(activeModelData) === false) {
                throw new Error(`Model ${model} does not accept image inputs. Switch to a model that does.`);
            }

            // 2. Add User Message (Optimistic UI)
            const userMsg = { role: 'user', content: text, files: attachments };

            // We use addMessage for the user message to ensure it appears immediately
            // But we should really use addMessageToSession to be safe, though addMessage defaults to valid current.
            // Let's stick to addMessage for the user interaction trigger (synchronous-ish)
            addMessage(userMsg);

            setAttachments([]);

            // 3. Prepare Service Call
            const startTime = Date.now();
            let baseUrl = isLocal ? (localBaseUrl || 'http://localhost:11434/v1') : activeBaseUrl;

            // Create AbortController for this request
            const controller = new AbortController();
            abortControllerRef.current = controller;

            // Prepare Web Search Config with Decrypted Key
            let activeWebSearchConfig = null;
            if (options.webSearch && providerMode === 'local') {
                // Clone to avoid mutating store state
                const config = { ...webSearchConfig };
                if (config.encryptedApiKey) {
                    try {
                        config.apiKey = await decryptData(config.encryptedApiKey);
                    } catch (e) {
                        console.error("Failed to decrypt web search key:", e);
                        alert("Failed to decrypt web search key. Please re-enter it in settings.");
                        options.webSearch = false; // Disable if decryption fails
                    }
                }
                activeWebSearchConfig = config;
            }

            // LM Studio MCP search: the token is decrypted here and travels only in the request header
            if (isLocal && options.webSearch && lmStudioSearch.enabled && lmStudioSearch.integrationId) {
                let token = '';
                if (lmStudioSearch.encryptedToken) {
                    try {
                        token = await decryptData(lmStudioSearch.encryptedToken);
                    } catch (e) {
                        console.error("Failed to decrypt LM Studio token:", e);
                        alert("Failed to decrypt LM Studio token. Please re-enter it in settings.");
                    }
                }
                options.lmStudioSearch = {
                    integrationId: lmStudioSearch.integrationId,
                    allowedTools: lmStudioSearch.allowedTools,
                    token
                };
            }

            if (!isLocal && !baseUrl) {
                if (activeCloudProvider === 'openrouter') baseUrl = 'https://openrouter.ai/api/v1';
                else if (activeCloudProvider === 'openai') baseUrl = 'https://api.openai.com/v1';
                else if (activeCloudProvider === 'anthropic') baseUrl = 'https://api.anthropic.com';
                else if (activeCloudProvider === 'google') baseUrl = 'https://generativelanguage.googleapis.com';
            }

            // The EU OpenRouter endpoint rejects web search, so the request goes out without it
            if (provider === 'openrouter' && options.webSearch && isOpenRouterEuEndpoint(baseUrl)) {
                addMessage({ role: 'system', content: 'Web search is not available on the OpenRouter EU endpoint (data region). This message was sent without web search.' });
            }

            // Use unified chat service
            // IMPORTANT: Read fresh messages from store to handle edit/regenerate correctly
            const currentMessages = useChatStore.getState().messages;
            const response = await chatService.sendMessage({
                provider: provider,
                baseUrl: baseUrl,
                apiKey: apiKey,
                model: model,
                messages: currentMessages.concat(userMsg),
                options: {
                    ...options,
                    modelMaxOutputTokens: activeModelData?.maxOutputTokens ?? null, // Caps max_tokens for web search
                    webSearchConfig: activeWebSearchConfig // Pass decrypted config
                },
                signal: controller.signal
            });

            const endTime = Date.now();

            const aiMsg = {
                role: 'assistant',
                content: response.content,
                attachments: response.attachments || [],
                metadata: {
                    latency: endTime - startTime,
                    tokens: normalizeUsage(response.usage).total,
                    cost: computeCost(response.usage, activeModelData?.pricing),
                    ...(response.toolCalls?.length ? { toolCalls: response.toolCalls } : {})
                }
            };

            if (response.fallbackNotice) {
                useChatStore.getState().addMessageToSession(initiatingSessionId, { role: 'system', content: response.fallbackNotice });
            }

            // Target the specific session that initiated the request
            useChatStore.getState().addMessageToSession(initiatingSessionId, aiMsg);

            return true;

        } catch (err) {
            // Don't show error for user-initiated abort
            if (err.name === 'AbortError') {
                console.log('[App] Request aborted by user');
                return false;
            }
            addMessage({ role: 'system', content: `Error: ${err.message}` });
            return false;
        } finally {
            abortControllerRef.current = null;
            setLoadingSessionIds(prev => prev.filter(id => id !== initiatingSessionId));
        }
    };

    // Stop current generation
    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
    };

    // Edit message and regenerate
    const handleEditMessage = async (messageIndex, newContent) => {
        // Checked before truncating: a blocked send would otherwise drop the edited message and its successors.
        if (historyLoading || isCatalogBlocked) return;
        const sessionId = useChatStore.getState().currentSessionId;

        // Truncate messages at the edit point
        truncateAtMessage(sessionId, messageIndex);

        // Clear current attachments since we're regenerating from edited text
        setAttachments([]);

        // Send the edited message using fresh messages from the store
        // (The truncateAtMessage already updated the store, so handleSend's 
        // messages.concat(userMsg) will use the truncated list)
        await handleSend(newContent);
    };

    return (
        <div
            className="flex flex-col h-full bg-brand-dark text-gray-100 font-sans relative overflow-hidden"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onKeyDownCapture={encryption.reportInteraction}
        >
            {/* Drag Overlay */}
            {isDragging && (
                <div className="absolute inset-0 z-50 bg-brand-cyan/10 border-4 border-brand-cyan border-dashed rounded-lg flex items-center justify-center pointer-events-none">
                    <div className="bg-brand-card p-4 rounded-xl shadow-lg border border-brand-border text-center">
                        <p className="font-bold text-lg text-white">Drop files here</p>
                        <p className="text-sm text-gray-400">PDF, TXT, MD, JS, PY...</p>
                    </div>
                </div>
            )}
            {/* Header */}
            <div className="h-12 border-b border-brand-border bg-brand-card flex items-center justify-between px-4 shadow-sm z-10">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsHistoryOpen(true)}
                        disabled={historyLoading}
                        className="p-1.5 hover:bg-white/10 rounded-md text-gray-400 hover:text-white transition-colors mr-1"
                    >
                        <Menu size={18} />
                    </button>

                    <button
                        onClick={handleNewChat}
                        disabled={historyLoading}
                        className="p-1.5 hover:bg-white/10 rounded-md text-gray-400 hover:text-white transition-colors"
                        title="New Chat"
                    >
                        <Plus size={16} />
                    </button>
                </div>
                <div className="flex items-center gap-1">
                    {encryption.phase !== 'disabled' && (
                        <EncryptionStatus
                            phase={encryption.phase}
                            progress={encryption.progress}
                            lastError={encryption.lastError}
                            onClick={() => {
                                setShowSettings(true);
                            }}
                        />
                    )}
                    <button
                        onClick={() => {
                            setShowSettings(true);
                        }}
                        className="p-2 hover:bg-white/10 rounded-full"
                        aria-label="Settings"
                    >
                        <Settings size={18} />
                    </button>
                </div>
            </div>

            {/* Settings Modal */}
            {showSettings && (
                <div className="absolute inset-0 bg-brand-dark text-gray-100 z-50 p-6 flex flex-col animate-in fade-in duration-200">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold">Settings</h2>
                        <button onClick={() => setShowSettings(false)} className="hover:text-gray-300" aria-label="Close Settings"><X /></button>
                    </div>

                    {/* Mode Toggle */}
                    <div className="flex bg-brand-input rounded-lg p-1 mb-6 border border-brand-border">
                        <button
                            onClick={() => setProviderMode('cloud')}
                            className={`flex-1 py-1.5 rounded-md text-sm font-bold transition-all ${providerMode === 'cloud' ? 'bg-brand-cyan text-brand-dark shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                            Cloud
                        </button>
                        <button
                            onClick={() => setProviderMode('local')}
                            className={`flex-1 py-1.5 rounded-md text-sm font-bold transition-all ${providerMode === 'local' ? 'bg-brand-cyan text-brand-dark shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                            Local
                        </button>
                    </div>

                    <div className="space-y-4 flex-1 overflow-y-auto">
                        {providerMode === 'cloud' && (
                            <>
                                {/* Provider Selector */}
                                <div className="space-y-2">
                                    <label className="block text-sm font-medium text-gray-300">Provider</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {['openrouter', 'openai', 'anthropic', 'google'].map(p => (
                                            <button
                                                key={p}
                                                onClick={() => setActiveCloudProvider(p)}
                                                className={`py-2 px-3 rounded border text-sm capitalize ${activeCloudProvider === p ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan font-bold' : 'border-brand-border bg-brand-input hover:bg-white/5 text-gray-400'}`}
                                            >
                                                {p === 'openrouter' ? 'OpenRouter' : p}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <ApiKeysSettings key={activeCloudProvider} provider={activeCloudProvider} />
                            </>
                        )}

                        {providerMode === 'local' && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-200">
                                <label className="block text-sm font-medium text-gray-300">Local Base URL</label>
                                <input
                                    type="text"
                                    value={tempLocalUrl}
                                    onChange={(e) => setTempLocalUrl(e.target.value)}
                                    placeholder="http://localhost:11434/v1"
                                    className="w-full p-2 bg-brand-input border border-brand-border rounded focus:ring-2 focus:ring-brand-cyan outline-none text-white"
                                />
                                <div className="flex justify-between items-center mt-1">
                                    <p className="text-xs text-gray-500">Status: {localBaseUrl === tempLocalUrl ? 'Saved' : 'Saving...'}</p>
                                    <p className="text-xs text-brand-cyan">No API Key needed</p>
                                </div>

                                <div className="mt-4 p-3 bg-white/5 rounded-md border border-brand-border">
                                    <p className="text-xs text-gray-300 font-bold mb-2">Quick Setup:</p>
                                    <div className="space-y-2 text-xs text-gray-400">
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setTempLocalUrl('http://localhost:11434/v1')}
                                                className="flex-1 text-center bg-brand-input hover:bg-white/5 p-2 rounded border border-brand-border transition-colors pointer-events-auto cursor-pointer"
                                            >
                                                Ollama
                                            </button>
                                            <button
                                                onClick={() => setTempLocalUrl('http://localhost:1234/v1')}
                                                className="flex-1 text-center bg-brand-input hover:bg-white/5 p-2 rounded border border-brand-border transition-colors pointer-events-auto cursor-pointer"
                                            >
                                                LM Studio
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Local Web Search Settings */}
                                <div className="mt-6 pt-4 border-t border-brand-border">
                                    <h3 className="text-sm font-bold text-gray-200 mb-3 flex items-center gap-2">
                                        Web Search Configuration
                                    </h3>

                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <label className="block text-xs font-medium text-gray-400">Search Provider</label>
                                            <div className="grid grid-cols-2 gap-2">
                                                {[...(webSearchConfig.provider === 'google' || webSearchConfig.cx ? ['google'] : []), 'serpapi', 'serper', 'brave'].map(p => (
                                                    <button
                                                        key={p}
                                                        onClick={() => setWebSearchConfig({ provider: p })}
                                                        className={`py-1.5 px-2 rounded border text-xs capitalize ${webSearchConfig.provider === p ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan font-bold' : 'border-brand-border bg-brand-input hover:bg-white/5 text-gray-400'}`}
                                                    >
                                                        {p === 'brave' ? 'Brave' : p === 'serper' ? 'Serper.dev' : p === 'google' ? 'Google (existing customers)' : 'SerpApi'}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="block text-xs font-medium text-gray-400">
                                                {webSearchConfig.provider === 'google' ? 'Google Custom Search API Key' :
                                                    webSearchConfig.provider === 'brave' ? 'Brave Search API Key' :
                                                        webSearchConfig.provider === 'serpapi' ? 'SerpApi Key' : 'Serper.dev API Key'}
                                            </label>
                                            <input
                                                type="password"
                                                autoComplete="new-password"
                                                value={tempSearchKey}
                                                onChange={(e) => setTempSearchKey(e.target.value)}
                                                placeholder="Key..."
                                                className="w-full p-2 bg-brand-input border border-brand-border rounded focus:ring-2 focus:ring-brand-cyan outline-none text-white text-xs"
                                            />
                                        </div>

                                        {webSearchConfig.provider === 'google' && (
                                            <div className="space-y-2">
                                                <label className="block text-xs font-medium text-gray-400">Search Engine ID (CX)</label>
                                                <input
                                                    type="text"
                                                    value={tempSearchCX}
                                                    onChange={(e) => setTempSearchCX(e.target.value)}
                                                    placeholder="cx..."
                                                    className="w-full p-2 bg-brand-input border border-brand-border rounded focus:ring-2 focus:ring-brand-cyan outline-none text-white text-xs"
                                                />
                                            </div>
                                        )}

                                        <button
                                            onClick={async () => {
                                                const encrypted = tempSearchKey ? await encryptData(tempSearchKey) : '';
                                                setWebSearchConfig({
                                                    encryptedApiKey: encrypted,
                                                    ...(webSearchConfig.provider === 'google' ? { cx: tempSearchCX } : {})
                                                });
                                                alert('Search configuration saved!');
                                            }}
                                            className="w-full bg-brand-input hover:bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/50 py-1.5 rounded text-xs font-bold transition-colors"
                                        >
                                            Save Search Config
                                        </button>
                                    </div>
                                </div>

                                {/* LM Studio MCP Search Settings */}
                                <div className="mt-6 pt-4 border-t border-brand-border">
                                    <h3 className="text-sm font-bold text-gray-200 mb-1 flex items-center gap-2">
                                        LM Studio Search through MCP
                                    </h3>
                                    <p className="text-xs text-gray-500 mb-3">
                                        Optional, LM Studio 0.4.0 or newer. Web-search messages use LM Studio's native chat endpoint with an MCP search server. If it is not available, the search above is used.
                                    </p>

                                    <div className="space-y-4">
                                        <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={tempLmEnabled}
                                                onChange={(e) => setTempLmEnabled(e.target.checked)}
                                            />
                                            Use LM Studio MCP for web search
                                        </label>

                                        <div className="space-y-2">
                                            <label className="block text-xs font-medium text-gray-400">MCP server (mcp/name or https URL)</label>
                                            <input
                                                type="text"
                                                value={tempLmIntegration}
                                                onChange={(e) => setTempLmIntegration(e.target.value)}
                                                placeholder="mcp/my-search"
                                                className="w-full p-2 bg-brand-input border border-brand-border rounded focus:ring-2 focus:ring-brand-cyan outline-none text-white text-xs"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="block text-xs font-medium text-gray-400">Allowed tools (optional, comma-separated)</label>
                                            <input
                                                type="text"
                                                value={tempLmTools}
                                                onChange={(e) => setTempLmTools(e.target.value)}
                                                placeholder="web_search"
                                                className="w-full p-2 bg-brand-input border border-brand-border rounded focus:ring-2 focus:ring-brand-cyan outline-none text-white text-xs"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="block text-xs font-medium text-gray-400">LM Studio API token</label>
                                            <input
                                                type="password"
                                                value={tempLmToken}
                                                onChange={(e) => setTempLmToken(e.target.value)}
                                                placeholder="Token..."
                                                className="w-full p-2 bg-brand-input border border-brand-border rounded focus:ring-2 focus:ring-brand-cyan outline-none text-white text-xs"
                                            />
                                        </div>

                                        <button
                                            onClick={async () => {
                                                const encrypted = tempLmToken ? await encryptData(tempLmToken) : '';
                                                setLmStudioSearch({
                                                    enabled: tempLmEnabled,
                                                    integrationId: tempLmIntegration.trim(),
                                                    allowedTools: tempLmTools.trim(),
                                                    encryptedToken: encrypted
                                                });
                                                alert('LM Studio search configuration saved!');
                                            }}
                                            className="w-full bg-brand-input hover:bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/50 py-1.5 rounded text-xs font-bold transition-colors"
                                        >
                                            Save LM Studio Search
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        <HistoryEncryptionSettings
                            enabled={encryption.enabled}
                            phase={encryption.phase}
                            progress={encryption.progress}
                            lastError={encryption.lastError}
                            busy={encryptionBusy}
                            error={encryptionError}
                            onEnable={() => runEncryptionAction(() => useChatStore.getState().enableHistoryEncryption())}
                            onResume={() => runEncryptionAction(resumeHistory)}
                            onPause={() => runEncryptionAction(pauseHistory)}
                        />

                        <div className="mt-4 border-t border-brand-border pt-4">
                            <h3 className="text-sm font-medium text-gray-300 mb-2">Setup Guide</h3>

                            {/* Local Instructions */}
                            {providerMode === 'local' && (
                                <div className="space-y-3 text-xs text-gray-400">
                                    <div>
                                        <p className="font-bold text-gray-300 mb-1">Ollama</p>
                                        <p>1. Install from <a href="https://ollama.com" target="_blank" className="text-brand-cyan hover:underline">ollama.com</a></p>
                                        <p>2. Run command: <code className="bg-white/10 px-1 rounded">ollama run llama3</code></p>
                                        <p>3. Default URL is <code className="bg-white/10 px-1 rounded">http://localhost:11434/v1</code></p>
                                    </div>
                                    <div>
                                        <p className="font-bold text-gray-300 mb-1">LM Studio</p>
                                        <p>1. Start Local Server in LM Studio</p>
                                        <p>2. Default URL is <code className="bg-white/10 px-1 rounded">http://localhost:1234/v1</code></p>
                                        <p>3. For MCP web search (0.4.0 or newer), turn on "Allow calling servers from mcp.json" and "Require Authentication" in the server settings, then create an API token. For a remote MCP URL, turn on "Allow per-request MCPs"</p>
                                    </div>
                                    <div className="p-2 bg-brand-cyan/10 border border-brand-cyan/20 rounded mt-2">
                                        <p className="text-brand-cyan">Tacit automatically handles CORS for standard ports (11434, 1234).</p>
                                    </div>
                                </div>
                            )}

                            {/* Cloud Instructions */}
                            {providerMode === 'cloud' && (
                                <div className="space-y-2 text-xs text-gray-400">
                                    <p>Get your API keys from the respective providers:</p>
                                    <ul className="list-disc list-inside space-y-1 ml-1">
                                        <li><a href="https://openrouter.ai/keys" target="_blank" className="text-brand-cyan hover:underline">OpenRouter</a></li>
                                        <li><a href="https://platform.openai.com/api-keys" target="_blank" className="text-brand-cyan hover:underline">OpenAI</a></li>
                                        <li><a href="https://console.anthropic.com/settings/keys" target="_blank" className="text-brand-cyan hover:underline">Anthropic</a></li>
                                        <li><a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-brand-cyan hover:underline">Google AI Studio</a></li>
                                    </ul>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {historyLoading && (
                <div role="status" className="px-4 py-2 text-xs bg-brand-card border-b border-brand-border text-gray-300">
                    {historyLoadError
                        ? <>Encrypted history could not be loaded: {historyLoadError} <button className="underline text-brand-cyan" onClick={() => useChatStore.getState().hydrateHistory()}>Retry</button></>
                        : 'Loading encrypted history…'}
                </div>
            )}

            {!historyLoading && historyLoadError && (
                <div role="alert" className="px-4 py-2 text-xs bg-brand-card border-b border-brand-border text-gray-300">
                    History changes could not be saved: {historyLoadError} <button className="underline text-brand-cyan" onClick={() => useChatStore.getState().retryHistoryWrites()}>Retry saving</button>
                </div>
            )}

            {/* Message List */}
            <MessageList
                messages={messages}
                isLoading={isCurrentSessionLoading}
                isImageModel={(() => {
                    const outputs = getModalities(availableModels.find(m => m.id === model)).output;
                    // OpenRouter routers (openrouter/auto...) list image output but pick the real model per request.
                    return outputs ? (outputs.includes('image') && !model.startsWith('openrouter/')) : IMAGE_MODEL_NAME.test(model);
                })()}
                onViewFile={setViewingFile}
                onEditMessage={historyLoading ? undefined : handleEditMessage}
            />

            {/* Attachment Preview */}
            {
                attachments.length > 0 && (
                    <div className="px-4 py-2 bg-brand-card border-t border-brand-border flex gap-2 overflow-x-auto">
                        {attachments.map((file, i) => (
                            <div
                                key={i}
                                onClick={() => setViewingFile(file)}
                                className="flex items-center gap-2 bg-brand-input px-2 py-1 rounded text-xs border border-brand-border shadow-sm text-gray-200 cursor-pointer hover:bg-white/5 transition-colors"
                            >
                                <span className="truncate max-w-[120px]">{file.name}</span>
                                <button onClick={(e) => {
                                    e.stopPropagation();
                                    setAttachments(attachments.filter((_, idx) => idx !== i));
                                }}>
                                    <X size={12} className="text-gray-400 hover:text-red-400" />
                                </button>
                            </div>
                        ))}
                    </div>
                )
            }

            {/* Input Area */}
            <ChatInput
                onSend={handleSend}
                onStop={handleStop}
                onUpload={handleFileUpload}
                onReadPage={handleReadPage}
                isLoading={isCurrentSessionLoading}
                disabled={isCurrentSessionLoading || historyLoading}
                providerMode={providerMode}
                activeProvider={providerMode === 'local' ? 'local' : activeCloudProvider}
                catalogStatus={catalogStatus}
                catalogError={catalogError}
                onRefreshModels={handleRefreshModels}
                onOpenSettings={() => setShowSettings(true)}
            />

            {/* Document Viewer Modal */}
            <DocViewerModal file={viewingFile} onClose={() => setViewingFile(null)} />

            <HistorySidebar isOpen={isHistoryOpen && !historyLoading} onClose={() => setIsHistoryOpen(false)} />
        </div >
    );
}
