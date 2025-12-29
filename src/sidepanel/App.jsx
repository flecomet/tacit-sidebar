import React, { useState, useEffect } from 'react';
import { Settings, Lock, X, Plus, Menu, ChevronDown } from 'lucide-react';
import HistorySidebar from '../components/HistorySidebar';
import ChatInput from '../components/ChatInput';
import MessageList from '../components/MessageList';
import { useChatStore } from '../store/useChatStore';
import { processFile } from '../utils/fileProcessor';
import { scrapePage } from '../utils/pageScraper';
import { fetchModels } from '../services/modelService';
import { chatService } from '../services/chatService';
import { encryptData, decryptData } from '../utils/encryption';
import DocViewerModal from '../components/DocViewerModal';

export default function App() {
    const {
        activeCloudProvider, setActiveCloudProvider,
        encryptedApiKeys, setEncryptedApiKey,
        messages, addMessage,
        model, setModel, createNewChat,
        availableModels, setAvailableModels,
        ensureActiveSession,

        customBaseUrl, setCustomBaseUrl,
        includeFreeModels, setIncludeFreeModels,
        providerMode, setProviderMode,
        localBaseUrl, setLocalBaseUrl
    } = useChatStore();

    // Local UI state
    const [showSettings, setShowSettings] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [attachments, setAttachments] = useState([]);

    const [tempKey, setTempKey] = useState('');
    const [tempBaseUrl, setTempBaseUrl] = useState('');
    const [tempLocalUrl, setTempLocalUrl] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [viewingFile, setViewingFile] = useState(null);

    // Initialize session
    useEffect(() => {
        ensureActiveSession();
    }, [ensureActiveSession]);

    // Initialize tempKey when settings open or key changes
    useEffect(() => {
        const loadKey = async () => {
            // Load based on current provider context
            if (showSettings) {
                if (providerMode === 'cloud') {
                    const encKey = encryptedApiKeys[activeCloudProvider];
                    if (encKey) {
                        try {
                            const key = await decryptData(encKey);
                            setTempKey(key || '');
                        } catch (e) { console.error(e); setTempKey(''); }
                    } else {
                        setTempKey('');
                    }
                }
                setTempBaseUrl(customBaseUrl || '');
                setTempLocalUrl(localBaseUrl || '');
            }
        };
        loadKey();
    }, [showSettings, activeCloudProvider, providerMode, encryptedApiKeys, customBaseUrl, localBaseUrl]);

    // Manual Save Key Handler
    const handleSaveKey = async () => {
        // If empty, clear it
        if (!tempKey.trim()) {
            setEncryptedApiKey(activeCloudProvider, '');
            return;
        }
        const encrypted = await encryptData(tempKey);
        setEncryptedApiKey(activeCloudProvider, encrypted);
        // We don't necessarily close settings, user might want to configure other things
        // But maybe give feedback? For now, standard behavior.
        setShowSettings(false);
    };

    // Auto-save effects with debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            if (customBaseUrl !== tempBaseUrl) {
                setCustomBaseUrl(tempBaseUrl);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [tempBaseUrl, customBaseUrl, setCustomBaseUrl]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (localBaseUrl !== tempLocalUrl) {
                setLocalBaseUrl(tempLocalUrl);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [tempLocalUrl, localBaseUrl, setLocalBaseUrl]);

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

    // Fetch models on mount or when settings change
    useEffect(() => {
        const loadModels = async () => {
            const isLocal = providerMode === 'local';
            const provider = isLocal ? 'local' : activeCloudProvider;
            const urlToUse = isLocal ? localBaseUrl : customBaseUrl;
            let apiKey = '';

            if (!isLocal) {
                const encKey = encryptedApiKeys[activeCloudProvider];
                if (encKey) {
                    try {
                        apiKey = await decryptData(encKey);
                    } catch (e) {
                        console.error("Failed to decrypt key:", e);
                    }
                }
            }

            try {
                // fetchModels now accepts provider
                const models = await fetchModels(urlToUse, includeFreeModels, provider, apiKey);
                console.log("Models fetched:", models?.length);

                // Race condition check
                const currentIsLocal = useChatStore.getState().providerMode === 'local';
                const currentProvider = useChatStore.getState().activeCloudProvider;
                if ((currentIsLocal !== isLocal) || (!isLocal && currentProvider !== activeCloudProvider)) return;

                setAvailableModels(models);

                // Auto-switch if current model is not in the new list
                const currentModel = useChatStore.getState().model;
                const isCurrentValid = models.some(m => m.id === currentModel);

                if (!isCurrentValid && models.length > 0) {
                    setModel(models[0].id);
                }
            } catch (err) {
                console.error("Failed to fetch models:", err);
                setAvailableModels([]);
            }
        };

        loadModels();
    }, [customBaseUrl, localBaseUrl, includeFreeModels, providerMode, activeCloudProvider, encryptedApiKeys, setAvailableModels, setModel]);

    const handleSend = async (text) => {
        const isLocal = providerMode === 'local';
        const provider = isLocal ? 'local' : activeCloudProvider;
        let apiKey = '';

        if (!isLocal) {
            const encKey = encryptedApiKeys[activeCloudProvider];
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

        setIsLoading(true);

        try {
            // 1. Check Payload Requirements (Vision)
            const activeModelData = availableModels.find(m => m.id === model);
            // Heuristics for vision support
            const supportsVision =
                // Trust the metadata if it exists 
                activeModelData?.architecture?.input_modalities?.includes("image") ||

                // Catch common naming conventions
                model.toLowerCase().includes("vision") ||
                model.toLowerCase().includes("vl") ||

                // Catch known families 
                /claude-3|claude-4|gpt-4|gemini|llama-3\.2/.test(model.toLowerCase());

            const hasImages = attachments.some(f => f.type === 'image');

            if (hasImages && !supportsVision) {
                throw new Error(`Model ${model} does not support image inputs. Please switch to a vision model (like Claude 3, GPT-4o, or Gemini).`);
            }

            // 2. Add User Message (Optimistic UI)
            const userMsg = { role: 'user', content: text, files: attachments };
            addMessage(userMsg);
            setAttachments([]);

            // 3. Prepare Service Call
            const startTime = Date.now();
            let baseUrl = isLocal ? (localBaseUrl || 'http://localhost:11434/v1') : customBaseUrl;

            if (!isLocal && !baseUrl) {
                if (activeCloudProvider === 'openrouter') baseUrl = 'https://openrouter.ai/api/v1';
                else if (activeCloudProvider === 'openai') baseUrl = 'https://api.openai.com/v1';
                else if (activeCloudProvider === 'anthropic') baseUrl = 'https://api.anthropic.com';
                else if (activeCloudProvider === 'google') baseUrl = 'https://generativelanguage.googleapis.com';
            }

            // Use unified chat service
            const response = await chatService.sendMessage({
                provider: provider,
                baseUrl: baseUrl,
                apiKey: apiKey,
                model: model,
                messages: messages.concat(userMsg),
                options: {} // can add temperature etc here
            });

            const endTime = Date.now();

            // Calculate Metrics
            let cost = 0;
            if (activeModelData?.pricing) {
                const { prompt, completion } = activeModelData.pricing;
                const inputTokens = response.usage?.prompt_tokens || response.usage?.input_tokens || 0;
                const outputTokens = response.usage?.completion_tokens || response.usage?.output_tokens || 0;

                // Pricing is usually per 1M tokens or similar, ensure we handle the string/number format
                if (prompt && completion) {
                    cost = (parseFloat(prompt) * inputTokens) + (parseFloat(completion) * outputTokens);
                }
            }

            const aiMsg = {
                role: 'assistant',
                content: response.content,
                metadata: {
                    latency: endTime - startTime,
                    tokens: response.usage?.total_tokens || 0,
                    cost: cost
                }
            };
            addMessage(aiMsg);
            return true;

        } catch (err) {
            addMessage({ role: 'system', content: `Error: ${err.message}` });
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div
            className="flex flex-col h-screen bg-brand-dark text-gray-100 font-sans relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
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
                        className="p-1.5 hover:bg-white/10 rounded-md text-gray-400 hover:text-white transition-colors mr-1"
                    >
                        <Menu size={18} />
                    </button>

                    <button
                        onClick={handleNewChat}
                        className="p-1.5 hover:bg-white/10 rounded-md text-gray-400 hover:text-white transition-colors"
                        title="New Chat"
                    >
                        <Plus size={16} />
                    </button>
                </div>
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

                                <div className="pt-2">
                                    <label className="block text-sm font-medium text-gray-300">
                                        {activeCloudProvider === 'openrouter' ? 'OpenRouter' :
                                            activeCloudProvider === 'openai' ? 'OpenAI' :
                                                activeCloudProvider === 'anthropic' ? 'Anthropic' :
                                                    activeCloudProvider === 'google' ? 'Google' : activeCloudProvider} API Key
                                    </label>
                                    <input
                                        type="password"
                                        value={tempKey}
                                        onChange={(e) => setTempKey(e.target.value)}
                                        placeholder={`sk-...`}
                                        className="w-full p-2 bg-brand-input border border-brand-border rounded focus:ring-2 focus:ring-brand-cyan outline-none text-white transition-all mt-1"
                                    />
                                    <button
                                        onClick={handleSaveKey}
                                        className="w-full bg-brand-cyan text-brand-dark py-2 rounded hover:bg-cyan-400 font-bold transition-colors mt-3"
                                    >
                                        Save Key
                                    </button>
                                    <p className="text-xs text-gray-500 mt-2">
                                        Use your own API key. Keys are stored encrypted locally.
                                    </p>
                                </div>

                                {/* Custom URL option for OpenRouter/OpenAI Compatible mostly */}
                                {(activeCloudProvider === 'openrouter' || activeCloudProvider === 'openai') && (
                                    <div className="pt-4 border-t border-brand-border">
                                        <label className="block text-sm font-medium text-gray-300">Custom API Endpoint (Optional)</label>
                                        <input
                                            type="text"
                                            value={tempBaseUrl}
                                            onChange={(e) => setTempBaseUrl(e.target.value)}
                                            placeholder={activeCloudProvider === 'openrouter' ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1"}
                                            className="w-full p-2 bg-brand-input border border-brand-border rounded focus:ring-2 focus:ring-brand-cyan outline-none text-white mt-1"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">Status: {customBaseUrl === tempBaseUrl ? 'Saved' : 'Saving...'}</p>
                                    </div>
                                )}

                                {activeCloudProvider === 'openrouter' && (
                                    <div className="pt-4 border-t border-brand-border">
                                        <div className="flex items-start gap-2">
                                            <div className="flex items-center h-5">
                                                <input
                                                    id="free-models"
                                                    type="checkbox"
                                                    checked={includeFreeModels}
                                                    onChange={(e) => setIncludeFreeModels(e.target.checked)}
                                                    className="w-4 h-4 rounded border-brand-border bg-brand-input text-brand-cyan focus:ring-brand-cyan"
                                                />
                                            </div>
                                            <div className="ml-2 text-sm">
                                                <label htmlFor="free-models" className="font-medium text-gray-300">Include Free Models</label>
                                                <p className="text-xs text-gray-500 mt-1">
                                                    Warning: Free models often use your data to train.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}
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
                            </div>
                        )}

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

            {/* Message List */}
            <MessageList
                messages={messages}
                isLoading={isLoading}
                onViewFile={setViewingFile}
            />

            {/* Attachment Preview */}
            {attachments.length > 0 && (
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
            )}

            {/* Input Area */}
            <ChatInput
                onSend={handleSend}
                onUpload={handleFileUpload}
                onReadPage={handleReadPage}
                isLoading={isLoading}
                disabled={isLoading}
                providerMode={providerMode}
                activeProvider={providerMode === 'local' ? 'Local' : activeCloudProvider}
            />

            {/* Document Viewer Modal */}
            <DocViewerModal file={viewingFile} onClose={() => setViewingFile(null)} />

            <HistorySidebar isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
        </div>
    );
}