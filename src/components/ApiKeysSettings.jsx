// src/components/ApiKeysSettings.jsx
/* eslint-disable react/prop-types */
import React, { useState } from 'react';
import { Check, Pencil, Trash2, Plus } from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import { getActiveKey, canHaveEndpoint } from '../store/apiKeys';
import { OPENROUTER_EU_BASE_URL } from '../services/modelCatalog';
import { encryptData } from '../utils/encryption';

const PROVIDER_NAMES = { openrouter: 'OpenRouter', openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google' };
const EMPTY_FORM = { id: null, label: '', key: '', baseUrl: '' };
const INPUT = 'w-full p-2 bg-brand-input border border-brand-border rounded focus:ring-2 focus:ring-brand-cyan outline-none text-white text-sm';

const endpointBadge = (url) => !url ? null : (url === OPENROUTER_EU_BASE_URL ? 'EU' : 'Custom');

export default function ApiKeysSettings({ provider }) {
    const { apiKeys, activeKeyId, addApiKey, updateApiKey, removeApiKey, setActiveApiKey } = useChatStore();
    const keys = apiKeys?.[provider] || [];
    const active = getActiveKey({ apiKeys, activeKeyId }, provider);
    const [form, setForm] = useState(null); // null: closed; id null: adding; id set: editing
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [saving, setSaving] = useState(false);
    // With no key yet, show the form directly.
    const editing = form ?? (keys.length === 0 ? EMPTY_FORM : null);
    const editedEntry = editing?.id ? keys.find(k => k.id === editing.id) : null;
    const hasEndpoint = canHaveEndpoint(provider, editedEntry);

    const save = async () => {
        const { id, label, key, baseUrl } = editing;
        if (saving || (!id && !key.trim())) return; // a new entry needs a key
        setSaving(true);
        try {
            const patch = { label, baseUrl };
            // Blank key while editing keeps the stored key, so the form never needs the decrypted value.
            if (key.trim()) patch.encryptedKey = await encryptData(key.trim());
            if (id) updateApiKey(provider, id, patch);
            else addApiKey(provider, patch);
            setForm(null);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="pt-2 space-y-2">
            <label className="block text-sm font-medium text-gray-300">{PROVIDER_NAMES[provider] || provider} API Keys</label>

            {keys.map(k => {
                const isActive = k.id === active?.id;
                const badge = endpointBadge(k.baseUrl);
                return (
                    <div key={k.id} className={`flex items-center gap-2 p-2 rounded border text-sm ${isActive ? 'border-brand-cyan bg-brand-cyan/10' : 'border-brand-border bg-brand-input'}`}>
                        <button type="button" onClick={() => setActiveApiKey(provider, k.id)} aria-label={`Use key ${k.label}`} aria-pressed={isActive}
                            className="flex-1 min-w-0 flex items-center gap-2 text-left">
                            {isActive ? <Check size={14} className="text-brand-cyan shrink-0" /> : <span className="w-3.5 shrink-0" />}
                            <span className="truncate text-gray-200">{k.label}</span>
                            {badge && <span className="text-[10px] px-1 rounded border border-brand-border text-gray-400">{badge}</span>}
                        </button>
                        <button type="button" onClick={() => setForm({ id: k.id, label: k.label, key: '', baseUrl: k.baseUrl })}
                            aria-label={`Edit key ${k.label}`} className="p-1 text-gray-400 hover:text-gray-200">
                            <Pencil size={14} />
                        </button>
                        {confirmDelete === k.id ? (
                            <button type="button" onClick={() => { removeApiKey(provider, k.id); setConfirmDelete(null); }}
                                className="text-xs text-red-400 hover:underline">
                                Confirm delete
                            </button>
                        ) : (
                            <button type="button" onClick={() => setConfirmDelete(k.id)}
                                aria-label={`Delete key ${k.label}`} className="p-1 text-gray-400 hover:text-red-400">
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                );
            })}

            {editing ? (
                <div className="space-y-2 p-2 rounded border border-brand-border">
                    <input aria-label="Key label" value={editing.label} placeholder="Label (e.g. EU)" className={INPUT}
                        onChange={e => setForm({ ...editing, label: e.target.value })} />
                    <input aria-label="API key" type="password" value={editing.key} className={INPUT}
                        placeholder={editing.id ? 'Leave blank to keep the current key' : 'sk-...'}
                        onChange={e => setForm({ ...editing, key: e.target.value })} />
                    {hasEndpoint && (
                        <>
                            <input aria-label="Endpoint" value={editing.baseUrl} className={INPUT}
                                placeholder={provider === 'openrouter' ? 'https://openrouter.ai/api/v1 (default)' : 'https://api.openai.com/v1 (default)'}
                                onChange={e => setForm({ ...editing, baseUrl: e.target.value })} />
                            {provider === 'openrouter' && (
                                <button type="button" className="text-xs text-brand-cyan hover:underline"
                                    onClick={() => setForm({ ...editing, baseUrl: editing.baseUrl === OPENROUTER_EU_BASE_URL ? '' : OPENROUTER_EU_BASE_URL })}>
                                    {editing.baseUrl === OPENROUTER_EU_BASE_URL ? 'Use global endpoint' : 'Use EU endpoint (eu.openrouter.ai)'}
                                </button>
                            )}
                        </>
                    )}
                    <div className="flex gap-2">
                        <button type="button" onClick={save} disabled={saving}
                            className="flex-1 bg-brand-cyan text-brand-dark py-1.5 rounded font-bold hover:bg-cyan-400 transition-colors">
                            Save key
                        </button>
                        {(form || keys.length > 0) && (
                            <button type="button" onClick={() => setForm(null)}
                                className="px-3 py-1.5 rounded border border-brand-border text-gray-300 hover:bg-white/5">
                                Cancel
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <button type="button" onClick={() => setForm(EMPTY_FORM)}
                    className="w-full flex items-center justify-center gap-1 py-1.5 rounded border border-dashed border-brand-border text-sm text-gray-400 hover:text-gray-200">
                    <Plus size={14} /> Add key
                </button>
            )}

            <p className="text-xs text-gray-500">
                Use your own API keys. Keys are stored encrypted locally. The active key is used for the model list and for requests.
            </p>
        </div>
    );
}
