/* eslint-disable react/prop-types */
import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { ChevronDown, Star, Plus, Minus, ArrowUp, ArrowDown } from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import { getActiveKey } from '../store/apiKeys';
import { filterModels, filterOptions, groupByReleaseMonth, formatPrice, sortModels, DEFAULT_SORT } from '../services/modelFilters';

const NO_FILTERS = { input: [], output: [], vendors: [], priceTier: 'all' };
// [filter field, button label, filterOptions field]
const FACETS = [['input', 'Input', 'inputs'], ['output', 'Output', 'outputs'], ['vendors', 'Provider', 'vendors']];
// One active tier at a time, so price has its own facet branch instead of a multi-value FACETS entry.
const PRICE_TIERS = [
    ['all', 'All'], ['free', 'Free'], ['budget', 'Budget'],
    ['mid', 'Mid'], ['high', 'High'], ['unknown', 'Unknown'],
];
// Sort keys in display order. 'price' appears only for OpenRouter (the only catalogue with prices).
const SORT_OPTIONS = [['default', 'Default'], ['price', 'Price'], ['released', 'Released'], ['name', 'Name']];
// The first direction when a key is picked: cheapest first, newest first, A to Z.
const FIRST_DIR = { price: 'asc', released: 'desc', name: 'asc' };
const SORT_WORDS = { price: 'price', released: 'release date', name: 'name' };
const DIR_WORDS = { asc: 'ascending', desc: 'descending' };
const PRICE_REFERENCE = 'Based on 10,000 input + 2,000 output tokens in USD. Actual costs vary; tools and other charges may apply.';
const UNLISTED_NOTE = 'Not listed in your current catalogue; availability and price are unverified.';
const MESSAGES = {
    missingKey: 'Add an OpenRouter API key to load available models.',
    loading: 'Loading available models…',
    failed: 'Could not load models allowed by your OpenRouter settings.',
    empty: 'No models available with your current OpenRouter settings.',
    // Describes the returned catalogue; it does not diagnose why OpenRouter left free models out.
    noFree: 'No free models available with your current OpenRouter settings.',
    noMatch: 'No models match your filters.',
    choose: 'Choose a model before sending.',
};
// Keep focus in the search box: its blur handler closes the popover.
const keepFocus = (e) => e.preventDefault();
const toggle = (list, value) => list.includes(value) ? list.filter(v => v !== value) : [...list, value];

const Chip = ({ active, onClick, title, ariaLabel, children }) => (
    <button type="button" onMouseDown={keepFocus} onClick={onClick} aria-pressed={!!active} title={title} aria-label={ariaLabel}
        className={`px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap ${active ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan' : 'border-brand-border text-gray-400 hover:text-gray-200'}`}>
        {children}
    </button>
);

const ActionButton = ({ onClick, children }) => (
    <button type="button" onMouseDown={keepFocus} onClick={onClick} className="text-[10px] text-brand-cyan hover:underline">
        {children}
    </button>
);

/** catalogStatus: 'missing-key' | 'loading' | 'error' | 'ready'. App owns it; the default suits callers without discovery. */
export default function ModelPicker({ providerMode, activeProvider, catalogStatus = 'ready', catalogError = '', onRefreshModels, onOpenSettings }) {
    const {
        model, setModel, availableModels, favorites, toggleFavorite,
        apiKeys, activeKeyId, setActiveApiKey,
        modelSort, setModelSort, favoritesFirst, setFavoritesFirst,
    } = useChatStore();

    const [modelInput, setModelInput] = useState(model || '');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isModelListHovered, setIsModelListHovered] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState([]);
    const [filters, setFilters] = useState(NO_FILTERS);
    const [openFacet, setOpenFacet] = useState(null);
    const inputRef = useRef(null);
    const rootRef = useRef(null);
    const [popoverBox, setPopoverBox] = useState({ left: 0, width: 352 });

    const isLocal = providerMode === 'local';
    const isOpenRouter = !isLocal && activeProvider === 'openrouter';
    // A stored choice is kept, but it is applied only when this provider can offer it. Both the key and
    // the direction must be valid, or the picker falls back to the default order.
    const storedDir = modelSort?.dir === 'asc' || modelSort?.dir === 'desc' ? modelSort.dir : null;
    const storedKey = storedDir && SORT_OPTIONS.some(([key]) => key === modelSort?.key) ? modelSort.key : 'default';
    const sortKey = storedKey === 'price' && !isOpenRouter ? 'default' : storedKey;
    const sort = sortKey === 'default' ? DEFAULT_SORT : { key: sortKey, dir: storedDir };
    const sortOptions = SORT_OPTIONS.filter(([key]) => key !== 'price' || isOpenRouter);
    const keys = isLocal ? [] : (apiKeys?.[activeProvider] || []);
    const activeKey = isLocal ? null : getActiveKey({ apiKeys, activeKeyId }, activeProvider);

    // Filter values (types, vendors, price tier) belong to one catalogue: one provider, key and endpoint.
    useEffect(() => { setFilters(NO_FILTERS); setOpenFacet(null); }, [activeProvider, providerMode, activeKey?.id, activeKey?.baseUrl]);

    // Sync input with current model text (Name or ID) whenever model changes
    useEffect(() => {
        // Preserve search text unless the selected model has been cleared.
        if (isDropdownOpen && model) return;
        const found = availableModels.find(m => m.id === model);
        setModelInput(found ? (found.name || found.id) : (model || ''));
    }, [model, availableModels]);

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
    // Sorting runs after filtering and search, so facet counts (computed from modeModels) do not change.
    // The search text narrows the whole list, including pinned favorites.
    const pinned = favoritesFirst && !isLocal;
    const favs = pinned ? sortModels(others.filter(m => favorites.includes(m.id) && matchesSearch(m)), sort) : [];
    const rest = others.filter(m => (!pinned || !favorites.includes(m.id)) && matchesSearch(m));
    const sortedLabel = `Sorted by ${SORT_WORDS[sort.key]}`;
    // Release dates keep the month headers and their within-month tie order; price and name use one flat group.
    const groups = [
        ...(favs.length ? [{ label: 'Favorites', models: favs }] : []),
        ...(rest.length === 0 ? []
            : isLocal ? [{ label: 'Local', models: sortModels(rest, sort) }]
                : sort.key === 'default' ? groupByReleaseMonth(rest)
                    : sort.key === 'released' ? groupByReleaseMonth(rest, sort.dir)
                        : [{ label: sortedLabel, models: sortModels(rest, sort) }]),
    ];
    const hasFilters = filters.input.length + filters.output.length + filters.vendors.length > 0 || filters.priceTier !== 'all';
    const facets = FACETS.filter(([field, , optionField]) =>
        options[optionField].length > 0 && (field !== 'vendors' || options.vendors.length > 1));
    const tierLabel = PRICE_TIERS.find(([value]) => value === filters.priceTier)[1];
    const tierCount = (value) => value === 'all' ? modeModels.length : options.priceTiers[value];

    const isReady = catalogStatus === 'ready';
    // Catalogue-wide OpenRouter state, in precedence order. Filters and search cannot change it.
    const catalogNotice = !isOpenRouter ? ''
        : catalogStatus === 'missing-key' ? MESSAGES.missingKey
            : catalogStatus === 'loading' ? MESSAGES.loading
                : catalogStatus === 'error' ? MESSAGES.failed
                    : modeModels.length === 0 ? MESSAGES.empty
                        : '';
    // Until the catalogue is ready, nothing in a stale list or selection is offered.
    const showCatalogue = isReady || !isOpenRouter;

    // Filters narrow browsing only: the selection stays in the footer, marked when they hide it.
    const isInFilters = !!activeModel && filtered.some(m => m.id === activeModel.id);
    const isOutsideFilters = !!activeModel && hasFilters && !isInFilters;
    // A manual ID stays selected, but nothing in the catalogue vouches for it.
    const isUnlisted = isOpenRouter && isReady && !!model && !activeModel;
    const selectedName = activeModel ? (activeModel.name || activeModel.id) : model;
    const selectedNote = isUnlisted ? UNLISTED_NOTE : isOutsideFilters ? 'Outside current filters' : '';

    let listNotice = catalogNotice || (catalogStatus === 'loading' ? MESSAGES.loading : '');
    if (!listNotice && groups.length === 0) {
        listNotice = !isOpenRouter ? 'No models found'
            // The selected model may be the only match; the footer already shows it.
            : isInFilters && matchesSearch(activeModel) ? ''
                : filters.priceTier === 'free' && options.priceTiers.free === 0 ? MESSAGES.noFree
                    : MESSAGES.noMatch;
    }
    const chooseNotice = isOpenRouter && !catalogNotice && !model ? MESSAGES.choose : '';
    const closedNotice = catalogNotice || chooseNotice;

    const noticeActions = (text) => (
        <>
            {text === MESSAGES.failed && onRefreshModels && <ActionButton onClick={onRefreshModels}>Retry</ActionButton>}
            {text === MESSAGES.failed && onOpenSettings && <ActionButton onClick={onOpenSettings}>Open settings</ActionButton>}
            {/* Search text stays: only the facet filters are cleared. */}
            {text === MESSAGES.noMatch && hasFilters && <ActionButton onClick={() => setFilters(NO_FILTERS)}>Clear filters</ActionButton>}
        </>
    );

    const chooseSort = (key) => {
        if (key === 'default') setModelSort(DEFAULT_SORT);
        else if (sort.key === key) setModelSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
        else setModelSort({ key, dir: FIRST_DIR[key] });
    };
    const sortAnnouncement = sort.key === 'default' ? 'Default order' : `Sorted by ${SORT_WORDS[sort.key]}, ${DIR_WORDS[sort.dir]}`;

    const toggleGroupCollapse = (groupName) => {
        setCollapsedGroups(prev => prev.includes(groupName) ? prev.filter(g => g !== groupName) : [...prev, groupName]);
    };

    const handleModelSelect = (m) => {
        setModel(m.id);
        setIsDropdownOpen(false);
    };

    // Moving focus to a control inside the picker (Tab to a chip) must not close it.
    const handleBlur = (e) => {
        if (!rootRef.current?.contains(e.relatedTarget)) {
            setTimeout(() => {
                setIsDropdownOpen(false);
            }, 200);
        }

        const text = modelInput.trim();
        if (!text) return;

        // Only auto-select if it's an exact match to a known model
        const match = availableModels.find(m => m.name === text || m.id === text);
        if (match && match.id !== model) {
            setModel(match.id);
        }
    };

    // Focus leaving from a chip or button (the input has its own blur handler) closes the picker.
    const handleRootBlur = (e) => {
        if (e.target !== inputRef.current && !rootRef.current?.contains(e.relatedTarget)) setIsDropdownOpen(false);
    };

    // The picker sits mid-row, so a left-anchored popover would overflow a narrow side panel.
    // Fit it inside the viewport instead of using a fixed width.
    useLayoutEffect(() => {
        if (!isDropdownOpen || !rootRef.current) return;
        const margin = 8;
        const width = Math.min(352, window.innerWidth - 2 * margin);
        const { left } = rootRef.current.getBoundingClientRect();
        const target = Math.max(margin, Math.min(left, window.innerWidth - margin - width));
        setPopoverBox({ left: target - left, width });
    }, [isDropdownOpen]);

    const handleInputKeyDown = (e) => {
        if (e.key === 'Escape') {
            setIsDropdownOpen(false);
            return;
        }
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
            ref={rootRef}
            onBlur={handleRootBlur}
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

            {/* Explains a disabled Send while the list is closed; the open list shows the same notice in place. */}
            {closedNotice && !isDropdownOpen && (
                <div aria-live="polite" className="mb-1 ml-1 text-[10px] leading-tight text-gray-400">
                    <p>{closedNotice}</p>
                    <div className="flex flex-wrap gap-x-2">{noticeActions(closedNotice)}</div>
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
                <div style={{ left: popoverBox.left, width: popoverBox.width }} className="absolute bottom-full mb-1 max-h-96 bg-brand-card border border-brand-border rounded shadow-lg flex flex-col overflow-hidden">
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
                        {!isLocal && isReady && (
                            <div className="flex items-center gap-1 flex-wrap">
                                {facets.map(([field, label]) => (
                                    <Chip key={field} active={openFacet === field || filters[field].length > 0}
                                        onClick={() => setOpenFacet(openFacet === field ? null : field)}>
                                        {label}{filters[field].length ? ` (${filters[field].length})` : ''} ▾
                                    </Chip>
                                ))}
                                {isOpenRouter && (
                                    <Chip active={openFacet === 'price' || filters.priceTier !== 'all'} title={PRICE_REFERENCE}
                                        onClick={() => setOpenFacet(openFacet === 'price' ? null : 'price')}>
                                        Price{filters.priceTier !== 'all' ? `: ${tierLabel}` : ''} ▾
                                    </Chip>
                                )}
                                {hasFilters && (
                                    <button type="button" onMouseDown={keepFocus} onClick={() => setFilters(NO_FILTERS)}
                                        className="text-[10px] text-brand-cyan hover:underline">
                                        Clear
                                    </button>
                                )}
                                <span className="text-[10px] text-gray-500 ml-auto">{filtered.length} models</span>
                                {isOpenRouter && onRefreshModels && <ActionButton onClick={onRefreshModels}>Refresh models</ActionButton>}
                            </div>
                        )}
                        {!isReady ? null : openFacet === 'price' ? (
                            <div role="group" aria-label="Price tier" className="flex items-center gap-1 flex-wrap">
                                {PRICE_TIERS.map(([value, label]) => (
                                    <Chip key={value} active={filters.priceTier === value}
                                        onClick={() => setFilters(previous => ({ ...previous, priceTier: value }))}>
                                        {label} ({tierCount(value)})
                                    </Chip>
                                ))}
                            </div>
                        ) : openFacet && (
                            <div className="flex items-center gap-1 flex-wrap">
                                {options[FACETS.find(([field]) => field === openFacet)[2]].map(value => (
                                    <Chip key={value} active={filters[openFacet].includes(value)}
                                        onClick={() => setFilters({ ...filters, [openFacet]: toggle(filters[openFacet], value) })}>
                                        {value}
                                    </Chip>
                                ))}
                            </div>
                        )}
                        {isReady && (
                            <div role="group" aria-label="Sort models" className="flex items-center gap-1 flex-wrap">
                                <span className="text-[10px] text-gray-500 mr-1">Sort</span>
                                {sortOptions.map(([key, label]) => {
                                    const active = sort.key === key;
                                    const Arrow = sort.dir === 'asc' ? ArrowUp : ArrowDown;
                                    const ariaLabel = key === 'default' ? 'Default order'
                                        : `Sort by ${SORT_WORDS[key]}${active ? `, ${DIR_WORDS[sort.dir]}` : ''}`;
                                    return (
                                        <Chip key={key} active={active} ariaLabel={ariaLabel} onClick={() => chooseSort(key)}>
                                            {label}{active && key !== 'default' && <Arrow aria-hidden="true" size={10} className="inline ml-0.5" />}
                                        </Chip>
                                    );
                                })}
                                {!isLocal && (
                                    <Chip active={favoritesFirst} onClick={() => setFavoritesFirst(!favoritesFirst)}>
                                        Favorites first
                                    </Chip>
                                )}
                                <span className="sr-only" aria-live="polite">{sortAnnouncement}</span>
                            </div>
                        )}
                    </div>

                    {listNotice ? (
                        <div className="p-3 text-gray-500 text-xs text-center space-y-1">
                            <p className={isOpenRouter ? '' : 'italic'}>{listNotice}</p>
                            {listNotice === MESSAGES.failed && catalogError && (
                                <p className="text-[10px] break-words">{catalogError}</p>
                            )}
                            <div className="flex justify-center flex-wrap gap-x-2">{noticeActions(listNotice)}</div>
                        </div>
                    ) : groups.length > 0 && (
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

                        {chooseNotice && !listNotice && (
                            <div className="shrink-0 border-t border-brand-border bg-brand-input p-2 text-[10px] text-gray-400">
                                {chooseNotice}
                            </div>
                        )}

                        {/* Selected Model Footer */}
                        {showCatalogue && (activeModel || isUnlisted) && (
                            <div data-testid="selected-model" className="shrink-0 border-t border-brand-border bg-brand-input">
                                <div className="px-2 py-1 text-[10px] uppercase font-bold text-brand-cyan tracking-wider">
                                    Selected
                                </div>
                                <div
                                    onMouseDown={(e) => e.preventDefault()}
                                    className="group flex items-center justify-between p-2 hover:bg-white/10 cursor-pointer text-xs"
                                    onClick={() => setIsDropdownOpen(false)}
                                    title={activeModel ? activeModel.name : model}
                                >
                                    <span className="pr-2 flex-1 min-w-0">
                                        <span className="block font-medium text-brand-cyan/90 text-[10px] leading-tight line-clamp-2">{selectedName}</span>
                                        {selectedNote && <span className="block mt-0.5 text-[9px] leading-tight text-gray-400">{selectedNote}</span>}
                                    </span>
                                    <button
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleFavorite(model);
                                        }}
                                        className={`p-1 hover:text-yellow-400 transition-colors shrink-0 ${favorites.includes(model) ? 'text-yellow-400' : 'text-gray-600 group-hover:text-gray-400'}`}
                                        title={favorites.includes(model) ? "Unfavorite" : "Favorite"}
                                    >
                                        <Star size={12} fill={favorites.includes(model) ? "currentColor" : "none"} />
                                    </button>
                                </div>
                            </div>
                        )}
                </div>
            )}
        </div>
    );
}
