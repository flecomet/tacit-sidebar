import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import ModelPicker from './ModelPicker';
import { useChatStore } from '../store/useChatStore';
import { emptyKeys, emptyActive } from '../store/apiKeys';

const SEP = Date.UTC(2026, 8, 15) / 1000;
const AUG = Date.UTC(2026, 7, 15) / 1000;
const arch = (input, output) => ({ input_modalities: input, output_modalities: output });
const MODELS = [
    { id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', created: SEP, pricing: { prompt: '0.000002', completion: '0.00001' }, architecture: arch(['text', 'image', 'file'], ['text']) },
    { id: 'google/gemini-3.1-flash-image', name: 'Gemini Flash Image', created: AUG, pricing: { prompt: '0.0000005', completion: '0.000003' }, architecture: arch(['text', 'image'], ['text', 'image']) },
    { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', created: SEP, pricing: { prompt: '0.000002', completion: '0.00001' }, architecture: arch(['text', 'image', 'file'], ['text']) },
    { id: 'openrouter/auto', name: 'Auto Router', created: AUG, pricing: { prompt: '-1', completion: '-1' }, architecture: arch(['text'], ['text', 'image']) },
];
const renderPicker = () => {
    render(<ModelPicker providerMode="cloud" activeProvider="openrouter" />);
    fireEvent.focus(screen.getByRole('combobox'));
};
const headers = () => screen.getAllByTestId('model-group').map(el => el.textContent);
const listed = () => screen.queryAllByTestId('model-option').map(el => el.getAttribute('data-model-id'));

describe('ModelPicker', () => {
    beforeEach(() => useChatStore.setState({
        model: 'anthropic/claude-sonnet-5.5', availableModels: MODELS, favorites: [],
        modelSort: { key: 'default', dir: 'asc' }, favoritesFirst: false,
        apiKeys: emptyKeys(), activeKeyId: emptyActive(),
    }));

    it('groups models by release month, newest first, without the selected model', () => {
        renderPicker();
        expect(headers()).toEqual(['September 2026', 'August 2026']);
        expect(listed()).toEqual(['openai/gpt-6.1-sol', 'google/gemini-3.1-flash-image', 'openrouter/auto']);
    });

    it('stays open when focus moves to a control inside the picker, and closes when it leaves', () => {
        vi.useFakeTimers();
        try {
            renderPicker();
            const input = screen.getByRole('combobox');
            const chip = screen.getByRole('button', { name: /^Output/ });
            fireEvent.blur(input, { relatedTarget: chip });
            act(() => { vi.advanceTimersByTime(300); });
            expect(input.getAttribute('aria-expanded')).toBe('true');
            fireEvent.blur(chip, { relatedTarget: document.body });
            expect(input.getAttribute('aria-expanded')).toBe('false');
        } finally {
            vi.useRealTimers();
        }
    });

    it('closes on Escape', () => {
        renderPicker();
        const input = screen.getByRole('combobox');
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(input.getAttribute('aria-expanded')).toBe('false');
    });

    it('fits the popover inside a narrow viewport', () => {
        const original = window.innerWidth;
        window.innerWidth = 250;
        try {
            renderPicker();
            const popover = screen.getByRole('button', { name: /^Output/ }).closest('div[style]');
            expect(parseFloat(popover.style.width)).toBeLessThanOrEqual(250 - 16);
        } finally {
            window.innerWidth = original;
        }
    });

    it('filters by output type', () => {
        renderPicker();
        fireEvent.click(screen.getByRole('button', { name: /^Output/ }));
        fireEvent.click(screen.getByRole('button', { name: 'image' }));
        expect(listed()).toEqual(['google/gemini-3.1-flash-image', 'openrouter/auto']);
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(listed()).toHaveLength(3);
    });

    it('filters by vendor', () => {
        renderPicker();
        fireEvent.click(screen.getByRole('button', { name: /^Provider/ }));
        fireEvent.click(screen.getByRole('button', { name: 'google' }));
        expect(listed()).toEqual(['google/gemini-3.1-flash-image']);
    });

    it('shows input/output price per million tokens, and none for router placeholders', () => {
        renderPicker();
        expect(screen.getByText('$0.5/$3')).toBeDefined();
        const auto = screen.getAllByTestId('model-option').find(el => el.getAttribute('data-model-id') === 'openrouter/auto');
        expect(auto.textContent).not.toContain('$');
    });

    it('keeps favorites first, and filters apply to them', () => {
        useChatStore.setState({ favorites: ['openai/gpt-6.1-sol', 'google/gemini-3.1-flash-image'], favoritesFirst: true });
        renderPicker();
        expect(headers()[0]).toBe('Favorites');
        fireEvent.click(screen.getByRole('button', { name: /^Output/ }));
        fireEvent.click(screen.getByRole('button', { name: 'image' }));
        expect(listed()).toEqual(['google/gemini-3.1-flash-image', 'openrouter/auto']);
    });

    it('switches the active key from the picker', () => {
        useChatStore.setState({
            apiKeys: { ...emptyKeys(), openrouter: [
                { id: 'k1', label: 'EU', encryptedKey: 'a', baseUrl: 'https://eu.openrouter.ai/api/v1' },
                { id: 'k2', label: 'Global', encryptedKey: 'b', baseUrl: '' },
            ] },
            activeKeyId: { ...emptyActive(), openrouter: 'k1' },
        });
        renderPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Global' }));
        expect(useChatStore.getState().activeKeyId.openrouter).toBe('k2');
    });

    it('hides the key switch with a single key', () => {
        useChatStore.setState({
            apiKeys: { ...emptyKeys(), openrouter: [{ id: 'k1', label: 'EU', encryptedKey: 'a', baseUrl: '' }] },
            activeKeyId: { ...emptyActive(), openrouter: 'k1' },
        });
        renderPicker();
        expect(screen.queryByTestId('key-switch')).toBeNull();
    });

    it('keeps a single Local group and no filters in local mode', () => {
        useChatStore.setState({ model: 'x', availableModels: [{ id: 'llama3', _category: 'Local', created: SEP }] });
        render(<ModelPicker providerMode="local" activeProvider="local" />);
        fireEvent.focus(screen.getByRole('combobox'));
        expect(headers()).toEqual(['Local']);
        expect(screen.queryByRole('button', { name: /^Output/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Price/ })).toBeNull();
    });

    const sortButton = (name) => screen.getByRole('button', { name: new RegExp(`^Sort by ${name}`) });

    it('sorts by price ascending first, unknown prices last, in one flat group', () => {
        renderPicker();
        fireEvent.click(sortButton('price'));
        expect(listed()).toEqual(['google/gemini-3.1-flash-image', 'openai/gpt-6.1-sol', 'openrouter/auto']);
        expect(headers()).toEqual(['Sorted by price']);
        expect(useChatStore.getState().modelSort).toEqual({ key: 'price', dir: 'asc' });
    });

    it('flips the direction when the active key is clicked again and keeps unknown prices last', () => {
        renderPicker();
        fireEvent.click(sortButton('price'));
        fireEvent.click(screen.getByRole('button', { name: 'Sort by price, ascending' }));
        expect(listed()).toEqual(['openai/gpt-6.1-sol', 'google/gemini-3.1-flash-image', 'openrouter/auto']);
    });

    it('sorts by name ascending in one flat group', () => {
        renderPicker();
        fireEvent.click(sortButton('name'));
        expect(listed()).toEqual(['openrouter/auto', 'google/gemini-3.1-flash-image', 'openai/gpt-6.1-sol']);
        expect(headers()).toEqual(['Sorted by name']);
        expect(useChatStore.getState().modelSort).toEqual({ key: 'name', dir: 'asc' });
    });

    it('keeps month headers for the release sort, newest first by default', () => {
        renderPicker();
        fireEvent.click(sortButton('release date'));
        expect(headers()).toEqual(['September 2026', 'August 2026']);
        expect(listed()).toEqual(['openai/gpt-6.1-sol', 'google/gemini-3.1-flash-image', 'openrouter/auto']);
    });

    it('returns to the release-month grouping with Default', () => {
        renderPicker();
        fireEvent.click(sortButton('price'));
        fireEvent.click(screen.getByRole('button', { name: 'Default order' }));
        expect(useChatStore.getState().modelSort).toEqual({ key: 'default', dir: 'asc' });
        expect(headers()).toEqual(['September 2026', 'August 2026']);
    });

    it('sorts favorites with everything else when Favorites first is off (the default)', () => {
        useChatStore.setState({ favorites: ['openai/gpt-6.1-sol'] });
        renderPicker();
        fireEvent.click(sortButton('price'));
        expect(headers()).toEqual(['Sorted by price']);
        expect(listed()).toEqual(['google/gemini-3.1-flash-image', 'openai/gpt-6.1-sol', 'openrouter/auto']);
    });

    it('pins favorites first, sorted by the active key, when Favorites first is on', () => {
        useChatStore.setState({ favorites: ['openai/gpt-6.1-sol'], favoritesFirst: true });
        renderPicker();
        fireEvent.click(sortButton('price'));
        expect(headers()).toEqual(['Favorites', 'Sorted by price']);
        expect(listed()).toEqual(['openai/gpt-6.1-sol', 'google/gemini-3.1-flash-image', 'openrouter/auto']);
    });

    it('narrows pinned favorites with the search text', () => {
        useChatStore.setState({ favorites: ['openai/gpt-6.1-sol'], favoritesFirst: true });
        renderPicker();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Gemini' } });
        expect(headers()).not.toContain('Favorites');
        expect(listed()).toEqual(['google/gemini-3.1-flash-image']);
    });

    it('toggles Favorites first and stores it', () => {
        renderPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Favorites first' }));
        expect(useChatStore.getState().favoritesFirst).toBe(true);
        expect(screen.getByRole('button', { name: 'Favorites first' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('exposes the sort controls as named, pressed buttons in a labelled group', () => {
        renderPicker();
        expect(screen.getByRole('group', { name: 'Sort models' })).toBeDefined();
        for (const name of ['Default order', 'Sort by price', 'Sort by release date', 'Sort by name']) {
            const button = screen.getByRole('button', { name });
            expect(button.tagName).toBe('BUTTON');
            expect(button.tabIndex).toBe(0);
        }
        expect(screen.getByRole('button', { name: 'Default order' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Sort by price' }).getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(sortButton('release date'));
        expect(screen.getByRole('button', { name: 'Sort by release date, descending' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Default order' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('does not offer price sorting for a direct provider', () => {
        useChatStore.setState({
            apiKeys: { ...emptyKeys(), openai: [{ id: 'k1', label: 'Main', encryptedKey: 'x', baseUrl: '' }] },
            activeKeyId: { ...emptyActive(), openai: 'k1' },
        });
        render(<ModelPicker providerMode="cloud" activeProvider="openai" />);
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.queryByRole('button', { name: /^Sort by price/ })).toBeNull();
    });

    it('shows the default order for a stored price choice on a direct provider', () => {
        useChatStore.setState({
            modelSort: { key: 'price', dir: 'asc' },
            apiKeys: { ...emptyKeys(), openai: [{ id: 'k1', label: 'Main', encryptedKey: 'x', baseUrl: '' }] },
            activeKeyId: { ...emptyActive(), openai: 'k1' },
        });
        render(<ModelPicker providerMode="cloud" activeProvider="openai" />);
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByRole('button', { name: 'Default order' }).getAttribute('aria-pressed')).toBe('true');
        expect(useChatStore.getState().modelSort).toEqual({ key: 'price', dir: 'asc' });
    });

    it.each([
        ['key', { key: 'sideways', dir: 'asc' }],
        ['direction', { key: 'name', dir: 'sideways' }],
    ])('falls back to the default order for a malformed stored sort %s', (_, modelSort) => {
        useChatStore.setState({ modelSort });
        renderPicker();
        expect(screen.getByRole('button', { name: 'Default order' }).getAttribute('aria-pressed')).toBe('true');
        expect(headers()).toEqual(['September 2026', 'August 2026']);
    });

    it('announces the sort change politely', () => {
        renderPicker();
        fireEvent.click(sortButton('name'));
        expect(screen.getByText('Sorted by name, ascending').getAttribute('aria-live')).toBe('polite');
    });

    // Sorting reorders the rows only: the footer, the facet counts and the filtered set must not move,
    // and the picker must not ask the app to reload the catalogue.
    it('keeps the selected footer, facet counts and filtered set while switching sorts, without refreshing', () => {
        const onRefreshModels = vi.fn();
        render(<ModelPicker providerMode="cloud" activeProvider="openrouter" onRefreshModels={onRefreshModels} />);
        fireEvent.focus(screen.getByRole('combobox'));
        fireEvent.click(screen.getByRole('button', { name: /^Output/ }));
        fireEvent.click(screen.getByRole('button', { name: 'image' }));
        fireEvent.click(screen.getByRole('button', { name: /^Price/ }));
        const tierCounts = () => within(screen.getByRole('group', { name: 'Price tier' })).getAllByRole('button').map(b => b.textContent);
        const beforeList = [...listed()].sort();
        const beforeCounts = tierCounts();
        for (const name of ['price', 'release date', 'name']) fireEvent.click(sortButton(name));
        fireEvent.click(screen.getByRole('button', { name: 'Default order' }));
        expect([...listed()].sort()).toEqual(beforeList);
        expect(tierCounts()).toEqual(beforeCounts);
        expect(within(screen.getByTestId('selected-model')).getByText('Claude Sonnet 5.5')).toBeDefined();
        expect(onRefreshModels).not.toHaveBeenCalled();
    });
});

// One model per tier, plus a router sentinel and a model without prices (both Unknown).
const PRICED = [
    { id: 'meta/llama:free', name: 'Llama Free', created: SEP, pricing: { prompt: '0', completion: '0' } },
    { id: 'mistral/small', name: 'Mistral Small', created: SEP, pricing: { prompt: '0.0000001', completion: '0.0000002' } },
    { id: 'openai/gpt-mid', name: 'GPT Mid', created: AUG, pricing: { prompt: '0.000002', completion: '0.00001' } },
    { id: 'anthropic/opus', name: 'Opus', created: AUG, pricing: { prompt: '0.000015', completion: '0.000075' } },
    { id: 'openrouter/auto', name: 'Auto Router', created: AUG, pricing: { prompt: '-1', completion: '-1' } },
    { id: 'x/no-price', name: 'No Price', created: AUG },
];
const ALL_IDS = PRICED.map(m => m.id);
const tierButton = (label) => within(screen.getByRole('group', { name: 'Price tier' }))
    .getByRole('button', { name: new RegExp(`^${label}\\b`) });
const pickTier = (label) => {
    fireEvent.click(screen.getByRole('button', { name: /^Price/ }));
    fireEvent.click(tierButton(label));
};
const footer = () => screen.getByTestId('selected-model');

describe('ModelPicker price filter', () => {
    beforeEach(() => useChatStore.setState({
        model: '', availableModels: PRICED, favorites: [],
        modelSort: { key: 'default', dir: 'asc' }, favoritesFirst: false,
        apiKeys: emptyKeys(), activeKeyId: emptyActive(),
    }));

    it.each([
        ['All', ALL_IDS],
        ['Free', ['meta/llama:free']],
        ['Budget', ['mistral/small']],
        ['Mid', ['openai/gpt-mid']],
        ['High', ['anthropic/opus']],
        // Missing prices and router sentinels are never Free or Budget.
        ['Unknown', ['openrouter/auto', 'x/no-price']],
    ])('lists only %s models and marks that single tier as pressed', (label, ids) => {
        renderPicker();
        pickTier(label);
        expect([...listed()].sort()).toEqual([...ids].sort());
        for (const other of ['All', 'Free', 'Budget', 'Mid', 'High', 'Unknown']) {
            expect(tierButton(other).getAttribute('aria-pressed')).toBe(String(other === label));
        }
    });

    it('keeps all six options visible with their counts when a tier is empty', () => {
        useChatStore.setState({ availableModels: PRICED.filter(m => m.id !== 'meta/llama:free') });
        renderPicker();
        fireEvent.click(screen.getByRole('button', { name: /^Price/ }));
        expect(tierButton('Free').textContent).toBe('Free (0)');
        expect(tierButton('All').textContent).toBe('All (5)');
        expect(tierButton('Unknown').textContent).toBe('Unknown (2)');
    });

    it('explains the reference exchange on the Price control', () => {
        renderPicker();
        expect(screen.getByRole('button', { name: /^Price/ }).getAttribute('title')).toBe(
            'Based on 10,000 input + 2,000 output tokens in USD. Actual costs vary; tools and other charges may apply.');
    });

    it('applies the price tier to favorites', () => {
        useChatStore.setState({ favorites: ['meta/llama:free', 'anthropic/opus'], favoritesFirst: true });
        renderPicker();
        expect(headers()[0]).toBe('Favorites');
        pickTier('Free');
        expect(headers()).toEqual(['Favorites']);
        expect(listed()).toEqual(['meta/llama:free']);
    });

    it('retains the selected model in the footer when the filter excludes it', () => {
        useChatStore.setState({ model: 'anthropic/opus' });
        renderPicker();
        expect(within(footer()).queryByText('Outside current filters')).toBeNull();
        pickTier('Free');
        expect(listed()).toEqual(['meta/llama:free']);
        expect(within(footer()).getByText('Opus')).toBeDefined();
        expect(within(footer()).getByText('Outside current filters')).toBeDefined();
        expect(useChatStore.getState().model).toBe('anthropic/opus');
    });

    it('resets the price tier with Clear', () => {
        renderPicker();
        pickTier('High');
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(tierButton('All').getAttribute('aria-pressed')).toBe('true');
        expect(listed()).toHaveLength(PRICED.length);
    });

    it('wraps the price options in a narrow panel', () => {
        renderPicker();
        fireEvent.click(screen.getByRole('button', { name: /^Price/ }));
        expect(screen.getByRole('group', { name: 'Price tier' }).className).toMatch(/\bflex-wrap\b/);
    });

    it.each(['openai', 'anthropic', 'google'])('shows no price control for %s', (provider) => {
        render(<ModelPicker providerMode="cloud" activeProvider={provider} />);
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.queryByRole('button', { name: /^Price/ })).toBeNull();
    });

    it.each([
        ['active key', () => act(() => useChatStore.getState().setActiveApiKey('openrouter', 'k2'))],
        ['active endpoint', () => act(() => useChatStore.setState(s => ({
            apiKeys: { ...s.apiKeys, openrouter: s.apiKeys.openrouter.map(k => k.id === 'k1' ? { ...k, baseUrl: 'https://openrouter.ai/api/v1' } : k) },
        })))],
        ['provider', (rerender) => {
            rerender(<ModelPicker providerMode="cloud" activeProvider="openai" />);
            rerender(<ModelPicker providerMode="cloud" activeProvider="openrouter" />);
        }],
        ['mode', (rerender) => {
            rerender(<ModelPicker providerMode="local" activeProvider="local" />);
            rerender(<ModelPicker providerMode="cloud" activeProvider="openrouter" />);
        }],
    ])('resets the price tier when the %s changes', (_, change) => {
        useChatStore.setState({
            apiKeys: { ...emptyKeys(), openrouter: [
                { id: 'k1', label: 'EU', encryptedKey: 'a', baseUrl: 'https://eu.openrouter.ai/api/v1' },
                { id: 'k2', label: 'Global', encryptedKey: 'b', baseUrl: '' },
            ] },
            activeKeyId: { ...emptyActive(), openrouter: 'k1' },
        });
        const { rerender } = render(<ModelPicker providerMode="cloud" activeProvider="openrouter" />);
        fireEvent.focus(screen.getByRole('combobox'));
        pickTier('Free');
        expect(listed()).toEqual(['meta/llama:free']);
        change(rerender);
        fireEvent.focus(screen.getByRole('combobox'));
        expect(screen.getByRole('button', { name: /^Price/ }).textContent).toBe('Price ▾');
        expect(listed()).toHaveLength(PRICED.length);
    });

    it('labels a manual model ID that the catalogue does not list, without calling it authorized', () => {
        renderPicker();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'vendor/manual-model' } });
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
        expect(useChatStore.getState().model).toBe('vendor/manual-model');
        fireEvent.focus(screen.getByRole('combobox'));
        expect(within(footer()).getByText('vendor/manual-model')).toBeDefined();
        expect(within(footer()).getByText('Not listed in your current catalogue; availability and price are unverified.')).toBeDefined();
        expect(footer().textContent).not.toMatch(/authori[sz]ed/i);
    });

    it('does not label a listed model as unverified', () => {
        useChatStore.setState({ model: 'openai/gpt-mid' });
        renderPicker();
        expect(within(footer()).queryByText(/Not listed/)).toBeNull();
    });
});

const MSG = {
    missingKey: 'Add an OpenRouter API key to load available models.',
    loading: 'Loading available models…',
    failed: 'Could not load models allowed by your OpenRouter settings.',
    empty: 'No models available with your current OpenRouter settings.',
    noFree: 'No free models available with your current OpenRouter settings.',
    noMatch: 'No models match your filters.',
    choose: 'Choose a model before sending.',
};

describe('ModelPicker catalogue state', () => {
    let onRefreshModels;
    let onOpenSettings;
    const renderState = (catalogStatus, extra = {}) => render(
        <ModelPicker providerMode="cloud" activeProvider="openrouter" catalogStatus={catalogStatus}
            onRefreshModels={onRefreshModels} onOpenSettings={onOpenSettings} {...extra} />);
    const open = () => fireEvent.focus(screen.getByRole('combobox'));
    const shown = () => Object.values(MSG).filter(text => screen.queryByText(text));

    beforeEach(() => {
        onRefreshModels = vi.fn();
        onOpenSettings = vi.fn();
        useChatStore.setState({
            model: '', availableModels: [], favorites: [],
            modelSort: { key: 'default', dir: 'asc' }, favoritesFirst: false,
            apiKeys: emptyKeys(), activeKeyId: emptyActive(),
        });
    });

    it.each([
        ['missing-key', MSG.missingKey],
        ['loading', MSG.loading],
        ['error', MSG.failed],
        ['ready', MSG.empty],
    ])('shows one message for %s, both closed and open', (status, text) => {
        renderState(status);
        expect(shown()).toEqual([text]);
        open();
        expect(shown()).toEqual([text]);
        expect(listed()).toEqual([]);
    });

    it('gives the missing key message precedence over a stale list and selection', () => {
        useChatStore.setState({ model: 'openai/gpt-mid', availableModels: PRICED });
        renderState('missing-key');
        open();
        expect(shown()).toEqual([MSG.missingKey]);
        expect(listed()).toEqual([]);
        expect(screen.queryByTestId('selected-model')).toBeNull();
    });

    it('offers Retry and Open settings after a failure, with the sanitized cause', () => {
        renderState('error', { catalogError: 'Failed to fetch models from https://eu.openrouter.ai/api/v1 (openrouter): 404 Not Found' });
        open();
        expect(screen.getByText(/404 Not Found/)).toBeDefined();
        expect(screen.queryByRole('button', { name: 'Refresh models' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(onRefreshModels).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
        expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('offers Refresh models only for a ready catalogue', () => {
        const { rerender } = renderState('loading');
        open();
        expect(screen.queryByRole('button', { name: 'Refresh models' })).toBeNull();
        useChatStore.setState({ availableModels: PRICED });
        rerender(<ModelPicker providerMode="cloud" activeProvider="openrouter" catalogStatus="ready" onRefreshModels={onRefreshModels} />);
        fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
        expect(onRefreshModels).toHaveBeenCalledTimes(1);
    });

    it('says the catalogue has no free models when the Free tier is empty', () => {
        useChatStore.setState({ availableModels: PRICED.filter(m => m.id !== 'meta/llama:free') });
        renderState('ready');
        open();
        pickTier('Free');
        expect(shown()).toEqual([MSG.noFree]);
    });

    it('says filters exclude free models that exist, and clears filters without erasing the search', () => {
        useChatStore.setState({ availableModels: PRICED });
        renderState('ready');
        open();
        pickTier('Free');
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Mistral' } });
        expect(shown()).toEqual([MSG.noMatch]);
        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(screen.getByRole('combobox').value).toBe('Mistral');
        expect(listed()).toEqual(['mistral/small']);
        expect(tierButton('All').getAttribute('aria-pressed')).toBe('true');
    });

    it('asks for a model when the catalogue is valid but nothing is selected', () => {
        useChatStore.setState({ availableModels: PRICED });
        renderState('ready');
        expect(shown()).toEqual([MSG.choose]);
        open();
        expect(shown()).toEqual([MSG.choose]);
        expect(listed()).toHaveLength(PRICED.length);
    });

    it('shows no catalogue message once a listed model is selected', () => {
        useChatStore.setState({ availableModels: PRICED, model: 'openai/gpt-mid' });
        renderState('ready');
        expect(shown()).toEqual([]);
    });

    it('does not label the previous selection as unverified while the catalogue loads', () => {
        useChatStore.setState({ model: 'openai/gpt-mid' });
        renderState('loading');
        open();
        expect(screen.queryByText(/Not listed/)).toBeNull();
    });

    it('keeps the generic wording for other providers', () => {
        render(<ModelPicker providerMode="cloud" activeProvider="anthropic" catalogStatus="error" />);
        expect(screen.queryByText(/OpenRouter/)).toBeNull();
        open();
        expect(screen.getByText('No models found')).toBeDefined();
        expect(screen.queryByText(/OpenRouter/)).toBeNull();
    });
});
