// src/store/apiKeys.js
/**
 * Several API keys per cloud provider, one active at a time.
 * Pure functions over { apiKeys, activeKeyId } so the store and tests share them.
 */

export const PROVIDERS = ['openrouter', 'openai', 'anthropic', 'google'];
// New OpenRouter keys can carry their own endpoint (e.g. the EU endpoint).
export const ENDPOINT_PROVIDERS = ['openrouter'];
// OpenAI keys keep an endpoint saved before multi-key support; new OpenAI keys get none.
const LEGACY_ENDPOINT_PROVIDERS = ['openai'];

export const canHaveEndpoint = (provider, entry) =>
    ENDPOINT_PROVIDERS.includes(provider) || (LEGACY_ENDPOINT_PROVIDERS.includes(provider) && !!entry?.baseUrl);

export const emptyKeys = () => Object.fromEntries(PROVIDERS.map(p => [p, []]));
export const emptyActive = () => Object.fromEntries(PROVIDERS.map(p => [p, null]));

export const newKeyId = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

const trimUrl = (url) => (url || '').trim();
const listOf = (state, provider) => state?.apiKeys?.[provider] || [];
const next = (state, provider, list, activeId) => ({
    apiKeys: { ...emptyKeys(), ...state.apiKeys, [provider]: list },
    activeKeyId: { ...emptyActive(), ...state.activeKeyId, [provider]: activeId },
});

export const addKey = (state, provider, { label = '', encryptedKey, baseUrl = '' }, id = newKeyId()) => {
    const list = listOf(state, provider);
    const entry = { id, label: label.trim() || `Key ${list.length + 1}`, encryptedKey, baseUrl: ENDPOINT_PROVIDERS.includes(provider) ? trimUrl(baseUrl) : '' };
    const current = state.activeKeyId?.[provider];
    return next(state, provider, [...list, entry], list.some(k => k.id === current) ? current : id);
};

export const updateKey = (state, provider, id, patch) => {
    const list = listOf(state, provider).map(k => k.id !== id ? k : {
        ...k,
        ...(patch.label !== undefined && { label: patch.label.trim() || k.label }),
        ...(patch.encryptedKey !== undefined && { encryptedKey: patch.encryptedKey }),
        ...(patch.baseUrl !== undefined && canHaveEndpoint(provider, k) && { baseUrl: trimUrl(patch.baseUrl) }),
    });
    return next(state, provider, list, state.activeKeyId?.[provider] ?? null);
};

export const removeKey = (state, provider, id) => {
    const list = listOf(state, provider).filter(k => k.id !== id);
    const current = state.activeKeyId?.[provider];
    const keep = current !== id && list.some(k => k.id === current);
    return next(state, provider, list, keep ? current : (list[0]?.id ?? null));
};

export const setActiveKey = (state, provider, id) => listOf(state, provider).some(k => k.id === id)
    ? next(state, provider, listOf(state, provider), id)
    : {};

export const getActiveKey = (state, provider) => {
    const list = listOf(state, provider);
    return list.find(k => k.id === state?.activeKeyId?.[provider]) || list[0] || null;
};

/** Store v1 → v2: one key and one endpoint per provider become one active "Default" entry. */
export const migrateKeysToV2 = (persisted, makeId = newKeyId) => {
    const { encryptedApiKeys = {}, customBaseUrls = {}, ...rest } = persisted;
    const apiKeys = emptyKeys();
    const activeKeyId = emptyActive();
    for (const p of PROVIDERS) {
        if (!encryptedApiKeys[p]) continue;
        const id = makeId();
        const keepsUrl = ENDPOINT_PROVIDERS.includes(p) || LEGACY_ENDPOINT_PROVIDERS.includes(p);
        apiKeys[p] = [{ id, label: 'Default', encryptedKey: encryptedApiKeys[p], baseUrl: keepsUrl ? trimUrl(customBaseUrls[p]) : '' }];
        activeKeyId[p] = id;
    }
    return { ...rest, apiKeys, activeKeyId };
};
