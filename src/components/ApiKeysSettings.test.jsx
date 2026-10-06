// src/components/ApiKeysSettings.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ApiKeysSettings from './ApiKeysSettings';
import { useChatStore } from '../store/useChatStore';
import { emptyKeys, emptyActive } from '../store/apiKeys';

vi.mock('../utils/encryption', () => ({
    encryptData: vi.fn(k => Promise.resolve(`encrypted-${k}`)),
    decryptData: vi.fn(k => Promise.resolve(k.replace('encrypted-', ''))),
}));

const keys = () => useChatStore.getState().apiKeys;
const addViaForm = async ({ label, key, eu = false }) => {
    const add = screen.queryByRole('button', { name: /add key/i });
    if (add) fireEvent.click(add);
    fireEvent.change(screen.getByLabelText('Key label'), { target: { value: label } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: key } });
    if (eu) fireEvent.click(screen.getByRole('button', { name: /use eu endpoint/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
    await waitFor(() => expect(screen.queryByLabelText('API key')).toBeNull());
};

describe('ApiKeysSettings', () => {
    beforeEach(() => useChatStore.setState({ apiKeys: emptyKeys(), activeKeyId: emptyActive() }));

    it('shows the form when the provider has no key; the first key becomes active', async () => {
        render(<ApiKeysSettings provider="openrouter" />);
        expect(screen.getByText('OpenRouter API Keys')).toBeDefined();
        await addViaForm({ label: 'Work EU', key: 'eu-key', eu: true });
        const [k] = keys().openrouter;
        expect(k).toMatchObject({ label: 'Work EU', encryptedKey: 'encrypted-eu-key', baseUrl: 'https://eu.openrouter.ai/api/v1' });
        expect(useChatStore.getState().activeKeyId.openrouter).toBe(k.id);
        expect(screen.getByText('EU')).toBeDefined(); // endpoint badge
    });

    it('switches the active key', async () => {
        render(<ApiKeysSettings provider="openrouter" />);
        await addViaForm({ label: 'Work EU', key: 'eu-key', eu: true });
        await addViaForm({ label: 'Global', key: 'global-key' });
        fireEvent.click(screen.getByRole('button', { name: 'Use key Global' }));
        expect(useChatStore.getState().activeKeyId.openrouter).toBe(keys().openrouter[1].id);
    });

    it('asks for confirmation before deleting', async () => {
        render(<ApiKeysSettings provider="openrouter" />);
        await addViaForm({ label: 'Work EU', key: 'eu-key' });
        await addViaForm({ label: 'Global', key: 'global-key' });
        fireEvent.click(screen.getByRole('button', { name: 'Delete key Global' }));
        expect(keys().openrouter).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
        expect(keys().openrouter.map(k => k.label)).toEqual(['Work EU']);
    });

    it('keeps the stored key when editing with a blank key field', async () => {
        render(<ApiKeysSettings provider="openai" />);
        await addViaForm({ label: 'Work', key: 'oa-key' });
        fireEvent.click(screen.getByRole('button', { name: 'Edit key Work' }));
        fireEvent.change(screen.getByLabelText('Key label'), { target: { value: 'Personal' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
        await waitFor(() => expect(keys().openai[0].label).toBe('Personal'));
        expect(keys().openai[0].encryptedKey).toBe('encrypted-oa-key');
    });

    it('does not add an entry without a key', () => {
        render(<ApiKeysSettings provider="google" />);
        fireEvent.change(screen.getByLabelText('Key label'), { target: { value: 'Empty' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
        expect(keys().google).toEqual([]);
    });

    it('has no endpoint field for new keys of other providers', () => {
        render(<ApiKeysSettings provider="anthropic" />);
        expect(screen.getByLabelText('API key')).toBeDefined();
        expect(screen.queryByLabelText('Endpoint')).toBeNull();
    });

    it('shows the endpoint of a migrated OpenAI key, without the EU shortcut', async () => {
        const groq = 'https://api.groq.com/openai/v1';
        useChatStore.setState({
            apiKeys: { ...emptyKeys(), openai: [{ id: 'k1', label: 'Default', encryptedKey: 'e', baseUrl: groq }] },
            activeKeyId: { ...emptyActive(), openai: 'k1' },
        });
        render(<ApiKeysSettings provider="openai" />);
        expect(screen.getByText('Custom')).toBeDefined(); // endpoint badge
        fireEvent.click(screen.getByRole('button', { name: 'Edit key Default' }));
        expect(screen.getByLabelText('Endpoint').value).toBe(groq);
        expect(screen.queryByRole('button', { name: /use eu endpoint/i })).toBeNull();
        fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://api.together.xyz/v1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
        await waitFor(() => expect(keys().openai[0].baseUrl).toBe('https://api.together.xyz/v1'));
        expect(keys().openai[0].encryptedKey).toBe('e');
    });
});
