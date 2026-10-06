/* eslint-disable react/prop-types */
import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Star, Plus, Minus } from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import { getActiveKey } from '../store/apiKeys';
import { filterModels, filterOptions, groupByReleaseMonth, formatPrice } from '../services/modelFilters';

const NO_FILTERS = { input: [], output: [], vendors: [], freeOnly: false };
// [filter field, button label, filterOptions field]
const FACETS = [['input', 'Input', 'inputs'], ['output', 'Output', 'outputs'], ['vendors', 'Provider', 'vendors']];
// Keep focus in the search box: its blur handler closes the popover.
const keepFocus = (e) => e.preventDefault();
const toggle = (list, value) => list.includes(value) ? list.filter(v => v !== value) : [...list, value];

const Chip = ({ active, onClick, children }) => (
    <button type="button" onMouseDown={keepFocus} onClick={onClick} aria-pressed={!!active}
        className={`px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap ${active ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan' : 'border-brand-border text-gray-400 hover:text-gray-200'}`}>
        {children}
    </button>
);

export default function ModelPicker({ providerMode, activeProvider }) {
    const {
        model, setModel, availableModels, favorites, toggleFavorite,
        apiKeys, activeKeyId, setActiveApiKey,
    } = useChatStore();

    const [modelInput, setModelInput] = useState(model || '');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isModelListHovered, setIsModelListHovered] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState([]);
    const [filters, setFilters] = useState(NO_FILTERS);
    const [openFacet, setOpenFacet] = useState(null);
    const inputRef = useRef(null);

    // Filter values (types, vendors) belong to one provider's list.
    useEffect(() => { setFilters(NO_FILTERS); setOpenFacet(null); }, [activeProvider, providerMode]);

    // Sync input with current model text (Name or ID) whenever model changes
    useEffect(() => {
        // Prevent overwriting the search input while the user is actively searching
        if (isDropdownOpen) return;
        const found = availableModels.find(m => m.id === model);
        setModelInput(found ? (found.name || found.id) : (model || ''));
    }, [model, availableModels]);

    const isLocal = providerMode === 'local';
    const keys = isLocal ? [] : (apiKeys?.[activeProvider] || []);
    const activeKey = isLocal ? null : getActiveKey({ apiKeys, activeKeyId }, activeProvider);

    const activeModel = availableModels.find(m => m.id === model);
    const currentName = activeModel ? (activeModel.name || activeModel.id) : (model || '');
    const term = modelInput.trim().toLowerCase();
    const showAll = term === currentName.toLowerCase();

    // Safety net: list only the models of the current mode.
    const modeModels = availableModels.filter(m => isLocal ? m._category === 'Local' : m._category !== 'Local');
    const options = filterOptions(modeModels, activeProvider);
    const filtered = filterModels(modeModels, filters, activeProvider);
    const matchesSearch = (m) => showAll || (m.name || m.id).toLowerCase().includes(term) || m.id.toLowerCase().includes(term);

    const others = filtered.filter(m => m.id !== model); // the selected model is shown in the footer
    const favs = others.filter(m => favorites.includes(m.id)); // favorites ignore the search text, as before
    const rest = others.filter(m => !favorites.includes(m.id) && matchesSearch(m));
    const groups = [
        ...(favs.length ? [{ label: 'Favorites', models: favs }] : []),
        ...(isLocal ? (rest.length ? [{ label: 'Local', models: rest }] : []) : groupByReleaseMonth(rest)),
    ];
    const hasFilters = filters.input.length + filters.output.length + filters.vendors.length > 0 || filters.freeOnly;
    const facets = FACETS.filter(([field, , optionField]) =>
        options[optionField].length > 0 && (field !== 'vendors' || options.vendors.length > 1));

    const toggleGroupCollapse = (groupName) => {
        setCollapsedGroups(prev => prev.includes(groupName) ? prev.filter(g => g !== groupName) : [...prev, groupName]);
    };

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

    return (
        <div
            className="relative z-20 w-[160px] shrink-0"
            onMouseEnter={() => setIsModelListHovered(true)}
            onMouseLeave={() => setIsModelListHovered(false)}
        >
            {activeProvider && (
                <div className="text-[9px] uppercase font-bold text-gray-500 mb-0.5 ml-1 truncate">
                    {activeProvider === 'openai' ? 'OpenAI' : activeProvider}
                    {activeKey && keys.length > 1 ? ` · ${activeKey.label}` : ''}
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
                <div className="absolute bottom-full left-0 mb-1 w-[min(22rem,calc(100vw-2rem))] max-h-96 bg-brand-card border border-brand-border rounded shadow-lg flex flex-col overflow-hidden">
                    <div className="shrink-0 p-2 space-y-1.5 border-b border-brand-border">
                        {keys.length > 1 && (
                            <div className="flex items-center gap-1 flex-wrap" data-testid="key-switch">
                                <span className="text-[10px] text-gray-500 mr-1">Key</span>
                                {keys.map(k => (
                                    <Chip key={k.id} active={k.id === activeKey?.id} onClick={() => setActiveApiKey(activeProvider, k.id)}>
                                        {k.label}
                                    </Chip>
                                ))}
                            </div>
                        )}
                        {!isLocal && (
                            <div className="flex items-center gap-1 flex-wrap">
                                {facets.map(([field, label]) => (
                                    <Chip key={field} active={openFacet === field || filters[field].length > 0}
                                        onClick={() => setOpenFacet(openFacet === field ? null : field)}>
                                        {label}{filters[field].length ? ` (${filters[field].length})` : ''} ▾
                                    </Chip>
                                ))}
                                {options.hasFree && (
                                    <Chip active={filters.freeOnly} onClick={() => setFilters({ ...filters, freeOnly: !filters.freeOnly })}>Free</Chip>
                                )}
                                {hasFilters && (
                                    <button type="button" onMouseDown={keepFocus} onClick={() => setFilters(NO_FILTERS)}
                                        className="text-[10px] text-brand-cyan hover:underline">
                                        Clear
                                    </button>
                                )}
                                <span className="text-[10px] text-gray-500 ml-auto">{filtered.length} models</span>
                            </div>
                        )}
                        {openFacet && (
                            <div className="flex items-center gap-1 flex-wrap">
                                {options[FACETS.find(([field]) => field === openFacet)[2]].map(value => (
                                    <Chip key={value} active={filters[openFacet].includes(value)}
                                        onClick={() => setFilters({ ...filters, [openFacet]: toggle(filters[openFacet], value) })}>
                                        {value}
                                    </Chip>
                                ))}
                            </div>
                        )}
                    </div>

                    {groups.length === 0 ? (
                        <div className="p-3 text-gray-500 text-xs text-center italic">No models found</div>
                    ) : (
                        <div className="overflow-y-auto flex-1">
                            {groups.map(({ label, models }) => {
                                const isCollapsed = collapsedGroups.includes(label);
                                return (
                                    <div key={label}>
                                        <div
                                            data-testid="model-group"
                                            className="px-2 py-1 bg-[#2C2D2E] text-[10px] uppercase font-bold text-gray-400 tracking-wider sticky top-0 z-10 flex cursor-pointer hover:text-gray-200 select-none items-center justify-between"
                                            onMouseDown={keepFocus}
                                            onClick={() => toggleGroupCollapse(label)}
                                        >
                                            <span>{label}</span>
                                            {isCollapsed ? <Plus size={10} /> : <Minus size={10} />}
                                        </div>
                                        {!isCollapsed && models.map(m => {
                                            const isFav = favorites.includes(m.id);
                                            const price = formatPrice(m.pricing);
                                            return (
                                                <div
                                                    key={m.id}
                                                    data-testid="model-option"
                                                    data-model-id={m.id}
                                                    onMouseDown={keepFocus}
                                                    className="group flex items-center justify-between gap-2 p-2 hover:bg-white/10 cursor-pointer text-xs border-b border-brand-border last:border-0"
                                                    onClick={() => handleModelSelect(m)}
                                                    title={m.name}
                                                >
                                                    <span className="font-medium text-gray-200 flex-1 text-[10px] leading-tight line-clamp-2">{m.name || m.id}</span>
                                                    {price && (
                                                        <span className="text-[9px] text-gray-500 font-mono shrink-0" title="Input / output price per million tokens">{price}</span>
                                                    )}
                                                    <button
                                                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                        onClick={(e) => { e.stopPropagation(); toggleFavorite(m.id); }}
                                                        className={`p-1 hover:text-yellow-400 transition-colors shrink-0 ${isFav ? 'text-yellow-400' : 'text-gray-600 group-hover:text-gray-400'}`}
                                                        title={isFav ? 'Unfavorite' : 'Favorite'}
                                                    >
                                                        <Star size={12} fill={isFav ? 'currentColor' : 'none'} />
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
    );
}
