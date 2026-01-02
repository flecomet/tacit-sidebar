/* eslint-disable react/prop-types */
import React, { useState, useEffect, useRef } from 'react';
import { Send, Paperclip, FileDown, ChevronDown, Star, Plus, Minus, Globe } from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import { useDraftStore } from '../store/useDraftStore';
import { getModelCategory } from '../services/modelService';

export default function ChatInput({ onSend, onUpload, onReadPage, isLoading, disabled, providerMode, activeProvider }) {
    const {
        model, setModel, availableModels, favorites, toggleFavorite,
    } = useChatStore();
    const { draft, setDraft } = useDraftStore();

    // Use draft from store instead of local state
    const input = draft;
    const setInput = setDraft;

    // Model selection state
    const [modelInput, setModelInput] = useState(model || '');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isModelListHovered, setIsModelListHovered] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState([]);
    const [webSearchEnabled, setWebSearchEnabled] = useState(false);
    const inputRef = useRef(null);

    // Sync input with current model text (Name or ID) whenever model changes
    useEffect(() => {
        // Prevent overwriting the search input while the user is actively searching
        if (isDropdownOpen) return;

        const found = availableModels.find(m => m.id === model);
        if (found) {
            setModelInput(found.name || found.id);
        } else {
            setModelInput(model || '');
        }
    }, [model, availableModels]);

    const handleSend = async () => {
        if (!input.trim()) return;
        const success = await onSend(input, { webSearch: webSearchEnabled });
        if (success) {
            setInput('');
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            if (disabled) return;
            e.preventDefault();
            handleSend();
        }
    };

    const toggleGroupCollapse = (groupName) => {
        setCollapsedGroups(prev =>
            prev.includes(groupName)
                ? prev.filter(g => g !== groupName)
                : [...prev, groupName]
        );
    };

    // Filter Logic
    const activeModelObj = availableModels.find(m => m.id === model);
    const currentName = activeModelObj ? (activeModelObj.name || activeModelObj.id) : (model || '');
    const showAll = modelInput.trim().toLowerCase() === currentName.toLowerCase();

    // Grouping
    // Order matters here for display: Favorites -> Local -> Performance -> Small -> Free
    const groups = {
        Favorites: [],
        Local: [],
        Performance: [],
        Small: [],
        Free: []
    };

    availableModels.forEach(m => {
        if (m.id === model) return; // Skip active model from list (rendered separately)

        // Strict Mode Filter: If local mode, ONLY show local models (safety net)
        // If providerMode is 'local' and logic in App.jsx failed to clear non-local models, hide them here.
        // We identify local models by _category === 'Local' tag added in modelService.
        if (providerMode === 'local' && m._category !== 'Local') return;

        // Conversely, if providerMode is 'cloud' and we somehow have 'Local' models (shouldn't happen), hide them
        if (providerMode === 'cloud' && m._category === 'Local') return;

        const isFav = favorites.includes(m.id);

        // Filter check:
        // Always include if it is a favorite (and validates mode).
        // Otherwise, check if it matches the search term.
        const term = modelInput.toLowerCase();
        const mName = m.name || m.id || '';
        const matchesRequest = showAll ||
            mName.toLowerCase().includes(term) ||
            m.id.toLowerCase().includes(term);

        if (!matchesRequest && !isFav) return; // Skip if neither matches nor is favorite

        if (isFav) {
            groups.Favorites.push(m);
        } else {
            // Only add non-favorites to other groups
            const cat = getModelCategory(m);
            if (groups[cat]) {
                groups[cat].push(m);
            } else {
                // Fallback, though likely covered by getModelCategory
                groups.Performance.push(m);
            }
        }
    });

    // Remove empty groups
    const activeGroups = Object.entries(groups).filter(([_, list]) => list.length > 0);

    const handleModelSelect = (m) => {
        setModel(m.id);
        setIsDropdownOpen(false);
    };

    const handleBlur = () => {
        setTimeout(() => {
            setIsDropdownOpen(false);
        }, 200);

        const text = modelInput.trim();
        if (!text) return;

        // Only auto-select if it's an exact match to a known model
        const match = availableModels.find(m => m.name === text || m.id === text);
        if (match && match.id !== model) {
            setModel(match.id);
        }
    };

    const handleInputKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const text = modelInput.trim();
            if (text) {
                // Check for exact match first
                const match = availableModels.find(m => m.name === text || m.id === text);
                if (match) {
                    setModel(match.id);
                } else {
                    // Start conversation with custom model ID
                    setModel(text);
                }
                setIsDropdownOpen(false);
            }
        }
    };

    // Calculate capabilities
    const activeModel = availableModels.find(m => m.id === model);
    const supportsVision =
        // Trust the metadata if it exists 
        activeModel?.architecture?.input_modalities?.includes("image") ||

        // Catch common naming conventions
        activeModel?.id.toLowerCase().includes("vision") ||
        activeModel?.id.toLowerCase().includes("vl") ||

        // Catch known families 
        /claude-3|claude-4|gpt-4|gemini|llama-3\.2/.test(activeModel?.id.toLowerCase());

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

                {/* Web Search Toggle (OpenRouter Only) */}
                {activeProvider === 'openrouter' && (
                    <button
                        onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                        disabled={disabled}
                        className={`p-2 cursor-pointer transition-colors flex items-center gap-1 ${webSearchEnabled ? 'text-brand-cyan hover:text-cyan-400' : 'text-gray-400 hover:text-gray-200 disabled:text-gray-600'}`}
                        title={webSearchEnabled ? "Disable Web Search" : "Enable Web Search"}
                        aria-label={webSearchEnabled ? "Disable Web Search" : "Enable Web Search"}
                    >
                        <Globe size={20} />
                    </button>
                )}

                {/* Model Switcher */}
                <div
                    className="relative z-20 w-[160px] shrink-0"
                    onMouseEnter={() => setIsModelListHovered(true)}
                    onMouseLeave={() => setIsModelListHovered(false)}
                >
                    {activeProvider && (
                        <div className="text-[9px] uppercase font-bold text-gray-500 mb-0.5 ml-1 truncate">
                            {activeProvider === 'openai' ? 'OpenAI' : activeProvider}
                        </div>
                    )}
                    <div className="flex items-center gap-1 mb-1 p-1 bg-brand-input border border-brand-border rounded text-xs focus-within:ring-1 focus-within:ring-brand-cyan focus-within:border-brand-cyan transition-all">
                        {/* Favorite Toggle for Current Model */}
                        <button
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => model && toggleFavorite(model)}
                            className={`p-1 hover:bg-white/5 rounded-full transition-colors ${favorites.includes(model) ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400'}`}
                            title={favorites.includes(model) ? "Unfavorite this model" : "Favorite this model"}
                        >
                            <Star size={12} fill={favorites.includes(model) ? "currentColor" : "none"} />
                        </button>
                        <input
                            ref={inputRef}
                            role="combobox"
                            aria-expanded={isDropdownOpen}
                            type="text"
                            value={modelInput}
                            onChange={(e) => {
                                setModelInput(e.target.value);
                                setIsDropdownOpen(true);
                            }}
                            onFocus={(e) => {
                                setIsDropdownOpen(true);
                                e.target.select();
                            }}
                            onBlur={handleBlur}
                            className="flex-1 bg-transparent outline-none min-w-0 text-gray-200 placeholder-gray-500 text-xs"
                            placeholder="Search model..."
                            onKeyDown={handleInputKeyDown}
                        />
                        <button
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                                setIsDropdownOpen(!isDropdownOpen);
                                inputRef.current?.focus();
                            }}
                            className="p-1 hover:bg-white/5 rounded-full transition-colors"
                            tabIndex={-1}
                        >
                            <ChevronDown size={14} className="text-gray-400" />
                        </button>
                    </div>

                    {/* Tooltip for Active Model */}
                    {!isDropdownOpen && isModelListHovered && activeModel && (
                        <div className="absolute bottom-full left-0 mb-2 px-2 py-1 bg-black/90 text-white text-xs rounded border border-brand-border whitespace-nowrap z-50 pointer-events-none shadow-xl">
                            {activeModel.name || activeModel.id}
                        </div>
                    )}

                    {isDropdownOpen && (
                        <div className="absolute bottom-full left-0 right-0 mb-1 max-h-80 bg-brand-card border border-brand-border rounded shadow-lg flex flex-col overflow-hidden">
                            {activeGroups.length === 0 ? (
                                <div className="p-3 text-gray-500 text-xs text-center italic">No models found</div>
                            ) : (
                                <div className="overflow-y-auto flex-1">
                                    {activeGroups.map(([groupName, list]) => {
                                        const isCollapsed = collapsedGroups.includes(groupName);
                                        return (
                                            <div key={groupName}>
                                                <div
                                                    className="px-2 py-1 bg-[#2C2D2E] text-[10px] uppercase font-bold text-gray-400 tracking-wider sticky top-0 z-10 flex cursor-pointer hover:text-gray-200 select-none items-center justify-between"
                                                    onMouseDown={(e) => e.preventDefault()} // Prevent blur
                                                    onClick={() => toggleGroupCollapse(groupName)}
                                                >
                                                    <span>{groupName}</span>
                                                    {isCollapsed ? <Plus size={10} /> : <Minus size={10} />}
                                                </div>

                                                {!isCollapsed && list.map(m => {
                                                    const isFav = favorites.includes(m.id);
                                                    return (
                                                        <div
                                                            key={m.id}
                                                            onMouseDown={(e) => e.preventDefault()}
                                                            className="group flex items-center justify-between p-2 hover:bg-white/10 cursor-pointer text-xs border-b border-brand-border last:border-0"
                                                            onClick={() => handleModelSelect(m)}
                                                            title={m.name}
                                                        >
                                                            <span className="font-medium text-gray-200 pr-2 flex-1 text-[10px] leading-tight line-clamp-2">{m.name || m.id}</span>
                                                            <button
                                                                onMouseDown={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                }}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    toggleFavorite(m.id);
                                                                }}
                                                                className={`p-1 hover:text-yellow-400 transition-colors shrink-0 ${isFav ? 'text-yellow-400' : 'text-gray-600 group-hover:text-gray-400'}`}
                                                                title={isFav ? "Unfavorite" : "Favorite"}
                                                            >
                                                                <Star size={12} fill={isFav ? "currentColor" : "none"} />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Selected Model Footer */}
                            {activeModel && (
                                <div className="shrink-0 border-t border-brand-border bg-brand-input">
                                    <div className="px-2 py-1 text-[10px] uppercase font-bold text-brand-cyan tracking-wider">
                                        Selected
                                    </div>
                                    <div
                                        onMouseDown={(e) => e.preventDefault()}
                                        className="group flex items-center justify-between p-2 hover:bg-white/10 cursor-pointer text-xs"
                                        onClick={() => setIsDropdownOpen(false)}
                                        title={activeModel.name}
                                    >
                                        <span className="font-medium text-brand-cyan/90 pr-2 flex-1 text-[10px] leading-tight line-clamp-2">{activeModel.name || activeModel.id}</span>
                                        <button
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                            }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleFavorite(activeModel.id);
                                            }}
                                            className={`p-1 hover:text-yellow-400 transition-colors shrink-0 ${favorites.includes(activeModel.id) ? 'text-yellow-400' : 'text-gray-600 group-hover:text-gray-400'}`}
                                            title={favorites.includes(activeModel.id) ? "Unfavorite" : "Favorite"}
                                        >
                                            <Star size={12} fill={favorites.includes(activeModel.id) ? "currentColor" : "none"} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Text Input */}
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask..."
                    className="flex-1 resize-none bg-brand-input border border-brand-border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-cyan max-h-[160px] min-h-[40px] placeholder-gray-500 overflow-y-auto"
                    rows={1}
                />

                <button
                    onClick={handleSend}
                    disabled={!input.trim() || disabled}
                    className="p-2 bg-brand-cyan text-brand-dark rounded-lg hover:opacity-90 disabled:bg-brand-input disabled:text-gray-500 transition-all shadow-sm active:scale-95"
                    aria-label="Send"
                >
                    <Send size={18} />
                </button>
            </div>
        </div>
    );
}
