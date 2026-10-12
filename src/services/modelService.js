/**
 * Service to interact with cloud providers APIs for model lists
 */

import { normalizeAnthropic, normalizeGoogle, normalizeOpenAI, normalizeOpenRouter, getModelCategory } from './modelCatalog';
import { loadPriceCatalog, enrichFromCatalog } from './priceCatalog';

// In-memory cache for model lists to avoid repeated API calls
// Cache is keyed by: provider | baseUrl | api key fingerprint, to detect config changes
const modelCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// FNV-1a: tells keys apart without keeping them in the cache key as plain text.
const fingerprint = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
};

/**
 * Create a cache key from provider configuration
 */
const getCacheKey = (provider, baseUrl, apiKey) =>
    `${provider}|${baseUrl || 'default'}|${apiKey ? fingerprint(apiKey) : 'nokey'}`;

/**
 * Check if cached models are still valid
 */
const getCachedModels = (cacheKey) => {
    const cached = modelCache.get(cacheKey);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > CACHE_TTL_MS) {
        modelCache.delete(cacheKey);
        return null;
    }

    return cached.models;
};

/**
 * Store models in cache
 */
const setCachedModels = (cacheKey, models) => {
    modelCache.set(cacheKey, {
        models,
        timestamp: Date.now()
    });
};

/**
 * Clear cache for a specific provider or all providers
 */
export const clearModelCache = (provider = null) => {
    if (provider) {
        for (const key of modelCache.keys()) {
            if (key.startsWith(provider)) {
                modelCache.delete(key);
            }
        }
    } else {
        modelCache.clear();
    }
};

// Prices are optional: a failed catalog request must never block the model list.
const withCatalog = async (provider, models) => {
    const catalog = await loadPriceCatalog().catch(() => null);
    return enrichFromCatalog(models, provider, catalog);
};

export const fetchModels = async (customBaseUrl, provider = 'openrouter', apiKey = '') => {
    try {
        const cleanProvider = (provider || 'openrouter').toLowerCase().trim();

        // OpenRouter lists only the models the key may use; without a key there is no authorized list.
        if (cleanProvider === 'openrouter' && !apiKey) return [];

        // Check cache first
        const cacheKey = getCacheKey(cleanProvider, customBaseUrl, apiKey);
        const cachedModels = getCachedModels(cacheKey);
        if (cachedModels) {
            console.log(`[ModelService] Using cached models for ${cleanProvider}`);
            return cachedModels;
        }

        console.log(`[ModelService] Fetching models for ${cleanProvider}...`);
        let models = [];


        // --- Anthropic (Dynamic API) ---
        if (cleanProvider === 'anthropic') {
            const baseUrl = 'https://api.anthropic.com/v1';

            if (!apiKey) return [];

            const response = await fetch(`${baseUrl}/models?limit=1000`, {
                headers: {
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                }
            });

            if (!response.ok) throw new Error(`Anthropic API Error: ${response.status}`);

            const data = await response.json();
            const result = (await withCatalog('anthropic', normalizeAnthropic(data))).map(m => ({ ...m, _category: getModelCategory(m) }));
            setCachedModels(cacheKey, result);
            return result;
        }

        // --- Google (Generative Language API) ---
        if (cleanProvider === 'google') {
            const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
            if (!apiKey) return [];

            let raw = [];
            let pageToken = '';
            do {
                const url = new URL(`${baseUrl}/models`);
                url.searchParams.set('pageSize', '1000');
                if (pageToken) url.searchParams.set('pageToken', pageToken);
                const response = await fetch(url.toString(), { headers: { 'x-goog-api-key': apiKey } });
                if (!response.ok) throw new Error(`Google API Error: ${response.status}`);
                const data = await response.json();
                raw = raw.concat(data.models || []);
                pageToken = data.nextPageToken || '';
            } while (pageToken);

            const result = (await withCatalog('google', normalizeGoogle(raw))).map(m => ({ ...m, _category: getModelCategory(m) }));
            setCachedModels(cacheKey, result);
            return result;
        }

        // --- OpenAI (Direct) ---
        if (cleanProvider === 'openai') {
            const baseUrl = 'https://api.openai.com/v1';
            if (!apiKey) return [];

            const response = await fetch(`${baseUrl}/models`, {
                headers: { "Authorization": `Bearer ${apiKey}` }
            });

            if (!response.ok) throw new Error(`OpenAI API Error: ${response.status}`);

            const data = await response.json();
            const result = (await withCatalog('openai', normalizeOpenAI(data))).map(m => ({ ...m, _category: getModelCategory(m) }));
            setCachedModels(cacheKey, result);
            return result;
        }


        // --- OpenRouter / Local (Ollama/LM Studio) ---
        // OpenRouter requests the key's authorized list at `models/user`; every other non-local
        // provider uses `models`. An empty customBaseUrl falls back to the provider's default host.
        const isLocal = cleanProvider === 'local';

        const baseUrl = customBaseUrl ? customBaseUrl.replace(/\/$/, '')
            : isLocal ? 'http://localhost:11434/v1' : 'https://openrouter.ai/api/v1';

        const headers = {};
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        // No fallback to the public /models list when the personalized list fails.
        const path = cleanProvider === 'openrouter' ? 'models/user' : 'models';
        const response = await fetch(`${baseUrl}/${path}`, {
            headers: headers
        });

        if (!response.ok) {
            // Enhanced error message
            throw new Error(`Failed to fetch models from ${baseUrl} (${cleanProvider}): ${response.status} ${response.statusText}`);
        }

        const text = await response.text();
        if (!text) throw new Error('Empty response from model provider');

        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error('Failed to parse model list');
        }
        if (!data || !Array.isArray(data.data)) throw new Error('Malformed model list response');
        models = data.data;

        // If local, we tag them as Local.
        if (isLocal) {
            const result = models.map(m => ({ ...m, _category: 'Local' }));
            setCachedModels(cacheKey, result);
            return result;
        }

        const result = normalizeOpenRouter(models);
        setCachedModels(cacheKey, result);
        return result;
    } catch (error) {
        console.error("Model fetch error:", error.message || "Unknown error");
        throw error;
    }
};

export { getModelCategory };
