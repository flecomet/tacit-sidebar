/* eslint-disable react/prop-types */
import React, { useState, useEffect, useRef } from 'react';
import { Send, Square, Paperclip, FileDown, Globe, Pencil, Trash2 } from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import { useDraftStore } from '../store/useDraftStore';
import { usePromptsStore } from '../store/usePromptsStore';
import { getModelCategory } from '../services/modelService';
import { supportsImageInput } from '../services/modelCatalog';
import ModelPicker from './ModelPicker';
import { sessionCost, formatCost } from '../services/usage';
import { WEB_SEARCH_PREFIX } from '../services/searchIntent';

export default function ChatInput({
    onSend, onStop, onUpload, onReadPage, isLoading, disabled, providerMode, activeProvider,
    catalogStatus = 'ready', catalogError = '', onRefreshModels, onOpenSettings,
}) {
    const { model, availableModels, messages } = useChatStore();
    const chatCost = sessionCost(messages);
    // Same rule as App's handleSend. Without a key Send stays usable, so App can open Settings instead.
    const isCatalogBlocked = activeProvider === 'openrouter' && catalogStatus !== 'missing-key'
        && (catalogStatus !== 'ready' || !model);
    const { draft, setDraft } = useDraftStore();

    // Use draft from store instead of local state
    const input = draft;
    const setInput = setDraft;

    const [webSearchEnabled, setWebSearchEnabled] = useState(false);

    // Prompt picker state
    const { savedPrompts, updatePrompt, deletePrompt } = usePromptsStore();
    const [editingPrompt, setEditingPrompt] = useState(null);
    const [deletingPromptId, setDeletingPromptId] = useState(null);
    const [showPromptPicker, setShowPromptPicker] = useState(false);
    const [selectedPromptIndex, setSelectedPromptIndex] = useState(0);

    // Filter Logic
    const activeModelObj = availableModels.find(m => m.id === model);
    const category = getModelCategory(activeModelObj || { id: model });
    const isFreeModel = category === 'Free';

    // Disable web search for free models
    useEffect(() => {
        if (isFreeModel && webSearchEnabled) {
            setWebSearchEnabled(false);
        }
    }, [isFreeModel, webSearchEnabled]);

    const handleSend = async () => {
        if (!input.trim()) return;
        const success = await onSend(input, { webSearch: webSearchEnabled });
        if (success) {
            setInput('');
        }
    };

    // Check for slash command
    const isSlashCommand = input.startsWith('/');
    const showSearchSuggestion = webSearchEnabled && !disabled && !isLoading && !isSlashCommand
        && !input.trimStart().startsWith(WEB_SEARCH_PREFIX.trimEnd());
    const acceptSearchSuggestion = () => {
        setInput(WEB_SEARCH_PREFIX + input);
        textareaRef.current?.focus();
    };
    const slashFilter = isSlashCommand ? input.slice(1).toLowerCase() : '';
    const filteredPrompts = isSlashCommand
        ? savedPrompts.filter(p => p.name.toLowerCase().includes(slashFilter))
        : [];

    // Show picker when slash command active and prompts exist
    useEffect(() => {
        if (isSlashCommand && savedPrompts.length > 0) {
            setShowPromptPicker(true);
            setSelectedPromptIndex(0);
        } else {
            setShowPromptPicker(false);
        }
    }, [isSlashCommand, savedPrompts.length]);

    useEffect(() => {
        setSelectedPromptIndex(0);
    }, [slashFilter]);

    const activePromptIndex = Math.min(selectedPromptIndex, Math.max(0, filteredPrompts.length - 1));

    const closePromptAction = () => {
        setEditingPrompt(null);
        setDeletingPromptId(null);
        textareaRef.current?.focus();
    };

    const handlePromptSelect = (prompt) => {
        setInput(prompt.content);
        setShowPromptPicker(false);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowRight' && !e.nativeEvent.isComposing && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey
            && showSearchSuggestion && e.currentTarget.selectionStart === input.length
            && e.currentTarget.selectionEnd === input.length) {
            e.preventDefault();
            acceptSearchSuggestion();
            return;
        }
        // Handle prompt picker navigation
        if (showPromptPicker && filteredPrompts.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedPromptIndex(prev =>
                    prev < filteredPrompts.length - 1 ? prev + 1 : prev
                );
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedPromptIndex(prev => prev > 0 ? prev - 1 : prev);
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handlePromptSelect(filteredPrompts[activePromptIndex]);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setShowPromptPicker(false);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            if (disabled) return;
            e.preventDefault();
            handleSend();
        }
    };


    // Calculate capabilities
    const activeModel = availableModels.find(m => m.id === model);
    // Unknown capability (null) keeps image attachments enabled.
    const supportsVision = supportsImageInput(activeModel) !== false;

    const acceptTypes = supportsVision
        ? ".pdf,.txt,.js,.md,.json,.ts,.py,.png,.jpg,.jpeg,.webp"
        : ".pdf,.txt,.js,.md,.json,.ts,.py";

    const textareaRef = useRef(null);

    // Auto-resize textarea
    const adjustHeight = () => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        }
    };

    // Trigger resize on input change
    useEffect(() => {
        adjustHeight();
    }, [input]);

    // Trigger resize on layout width change
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea || !window.ResizeObserver) return;

        let lastWidth = textarea.clientWidth;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Only adjust height if width has changed to avoid loops/unnecessary updates
                if (entry.contentRect.width !== lastWidth) {
                    lastWidth = entry.contentRect.width;
                    // Wrap in requestAnimationFrame to avoid "ResizeObserver loop completed with undelivered notifications"
                    window.requestAnimationFrame(() => {
                        adjustHeight();
                    });
                }
            }
        });

        observer.observe(textarea);
        return () => observer.disconnect();
    }, []);

    return (
        <div className="p-4 bg-brand-dark border-t border-brand-border flex flex-col gap-2">
            <div className="flex gap-2 items-end">
                {/* File Upload */}
                <label className="p-2 text-gray-400 hover:text-gray-200 cursor-pointer transition-colors" title="Attach file">
                    <Paperclip size={20} />
                    <input
                        type="file"
                        className="hidden"
                        onClick={(e) => e.target.value = null}
                        onChange={(e) => {
                            if (e.target.files?.length > 0) {
                                onUpload(e);
                            }
                        }}
                        accept={acceptTypes}
                    />
                </label>

                {/* Read Page Context */}
                <button
                    onClick={onReadPage}
                    disabled={disabled}
                    className="p-2 text-gray-400 hover:text-brand-cyan cursor-pointer transition-colors disabled:text-gray-600 flex items-center gap-1"
                    title="Import current page text"
                >
                    <FileDown size={20} />
                </button>

                {/* Web Search Toggle (Supported by OpenRouter, OpenAI, Anthropic, Google, and Local) */}
                {['openrouter', 'openai', 'anthropic', 'google', 'local'].includes(activeProvider) && (
                    <button
                        onClick={() => !isFreeModel && setWebSearchEnabled(!webSearchEnabled)}
                        disabled={disabled || isFreeModel}
                        className={`p-2 cursor-pointer transition-colors flex items-center gap-1 ${webSearchEnabled ? 'text-brand-cyan hover:text-cyan-400' : 'text-gray-400 hover:text-gray-200 disabled:text-gray-600'}`}
                        title={isFreeModel ? "Unavailable for free models" : (webSearchEnabled ? "Web search allowed when needed. Accept the prefix to request a search." : "Enable Web Search")}
                        aria-label={isFreeModel ? "Unavailable for free models" : (webSearchEnabled ? "Disable Web Search" : "Enable Web Search")}
                    >
                        <Globe size={20} className={isFreeModel ? "opacity-50" : ""} />
                    </button>
                )}

                <ModelPicker providerMode={providerMode} activeProvider={activeProvider}
                    catalogStatus={catalogStatus} catalogError={catalogError}
                    onRefreshModels={onRefreshModels} onOpenSettings={onOpenSettings} />

                {/* Text Input with Prompt Picker */}
                <div className="relative flex-1">
                    {/* Prompt Picker Dropdown */}
                    {showPromptPicker && filteredPrompts.length > 0 && (
                        <div className="absolute bottom-full left-0 right-0 mb-1 max-h-80 bg-brand-card border border-brand-border rounded-lg shadow-lg overflow-hidden z-30">
                            <div className="overflow-y-auto max-h-80">
                                {filteredPrompts.map((prompt, index) => (
                                    <div key={prompt.id} className="border-b border-brand-border last:border-0">
                                        {editingPrompt?.id === prompt.id ? (
                                            <form
                                                className="p-3 flex flex-col gap-2 text-sm"
                                                onSubmit={(e) => {
                                                    e.preventDefault();
                                                    if (!editingPrompt.name.trim() || !editingPrompt.content.trim()) return;
                                                    updatePrompt(prompt.id, { name: editingPrompt.name.trim(), content: editingPrompt.content });
                                                    closePromptAction();
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Escape') { e.preventDefault(); closePromptAction(); }
                                                }}
                                            >
                                                <label className="text-gray-300">
                                                    Prompt name
                                                    <input autoFocus value={editingPrompt.name}
                                                        onChange={(e) => setEditingPrompt({ ...editingPrompt, name: e.target.value })}
                                                        className="mt-1 w-full bg-brand-input border border-brand-border rounded px-2 py-1 text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-cyan" />
                                                </label>
                                                <label className="text-gray-300">
                                                    Prompt text
                                                    <textarea value={editingPrompt.content} rows={4}
                                                        onChange={(e) => setEditingPrompt({ ...editingPrompt, content: e.target.value })}
                                                        className="mt-1 w-full bg-brand-input border border-brand-border rounded px-2 py-1 text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-cyan" />
                                                </label>
                                                <div className="flex gap-2">
                                                    <button type="submit" disabled={!editingPrompt.name.trim() || !editingPrompt.content.trim()}
                                                        className="px-2 py-1 rounded bg-brand-cyan text-brand-dark disabled:opacity-40">Save changes</button>
                                                    <button type="button" onClick={closePromptAction} className="px-2 py-1 text-gray-300">Cancel</button>
                                                </div>
                                            </form>
                                        ) : deletingPromptId === prompt.id ? (
                                            <div className="p-3 text-sm text-gray-300" onKeyDown={(e) => {
                                                if (e.key === 'Escape') { e.preventDefault(); closePromptAction(); }
                                            }}>
                                                <p>Delete “{prompt.name}”? This cannot be undone.</p>
                                                <div className="flex gap-2 mt-2">
                                                    <button type="button" autoFocus onClick={() => { deletePrompt(prompt.id); closePromptAction(); }}
                                                        className="px-2 py-1 rounded bg-red-600 text-white">Confirm delete</button>
                                                    <button type="button" onClick={closePromptAction} className="px-2 py-1">Cancel</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className={`flex items-center text-sm ${index === activePromptIndex
                                                ? 'bg-brand-cyan/20 text-white' : 'text-gray-300 hover:bg-white/5'}`}>
                                                <button type="button" onMouseDown={(e) => e.preventDefault()}
                                                    onClick={() => handlePromptSelect(prompt)}
                                                    className="min-w-0 flex-1 px-3 py-2 text-left">
                                                    <div className="font-medium truncate">{prompt.name}</div>
                                                    <div className="text-xs text-gray-500 truncate mt-0.5">{prompt.content.slice(0, 60)}...</div>
                                                </button>
                                                <button type="button" aria-label={`Edit ${prompt.name}`} title="Edit prompt"
                                                    onClick={() => { setEditingPrompt({ ...prompt }); setDeletingPromptId(null); }}
                                                    className="p-2 text-gray-400 hover:text-brand-cyan"><Pencil size={16} /></button>
                                                <button type="button" aria-label={`Delete ${prompt.name}`} title="Delete prompt"
                                                    onClick={() => { setDeletingPromptId(prompt.id); setEditingPrompt(null); }}
                                                    className="p-2 mr-1 text-gray-400 hover:text-red-400"><Trash2 size={16} /></button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {showSearchSuggestion && (
                        <button
                            type="button"
                            aria-label="Insert web search prefix"
                            title="Right Arrow at the end of your prompt inserts this prefix. Otherwise search stays optional."
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={acceptSearchSuggestion}
                            className="w-full flex gap-2 items-center text-left text-sm text-gray-500 hover:text-gray-300 bg-brand-input border border-b-0 border-brand-border rounded-t-lg px-3 pt-2 pb-1"
                        >
                            <span className="flex-1">{WEB_SEARCH_PREFIX}</span>
                            <kbd className="text-xs" aria-hidden="true">→</kbd>
                        </button>
                    )}
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask... (type / for prompts)"
                        className={`w-full resize-none bg-brand-input border border-brand-border ${showSearchSuggestion ? 'rounded-b-lg border-t-0' : 'rounded-lg'} px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-cyan max-h-[160px] min-h-[40px] placeholder-gray-500 overflow-y-auto`}
                        rows={1}
                    />
                </div>

                {isLoading && onStop ? (
                    <button
                        onClick={onStop}
                        className="p-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 hover:text-white transition-all shadow-sm active:scale-95 border border-gray-600"
                        aria-label="Stop"
                        title="Stop generation"
                    >
                        <Square size={16} fill="currentColor" />
                    </button>
                ) : (
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || disabled || isCatalogBlocked}
                        className="p-2 bg-brand-cyan text-brand-dark rounded-lg hover:opacity-90 disabled:bg-brand-input disabled:text-gray-500 transition-all shadow-sm active:scale-95"
                        aria-label="Send"
                    >
                        <Send size={18} />
                    </button>
                )}
            </div>
            {chatCost > 0 && (
                <div data-testid="chat-cost" title="Total cost of this chat"
                    className="-mt-1 text-[10px] text-gray-500 font-mono text-right">
                    <span className="opacity-50">chat:</span> {formatCost(chatCost)}
                </div>
            )}
        </div>
    );
}
