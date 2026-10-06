import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
        apiKeys: emptyKeys(), activeKeyId: emptyActive(),
    }));

    it('groups models by release month, newest first, without the selected model', () => {
        renderPicker();
        expect(headers()).toEqual(['September 2026', 'August 2026']);
        expect(listed()).toEqual(['openai/gpt-6.1-sol', 'google/gemini-3.1-flash-image', 'openrouter/auto']);
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
        useChatStore.setState({ favorites: ['openai/gpt-6.1-sol', 'google/gemini-3.1-flash-image'] });
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
    });
});
