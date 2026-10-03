/**
 * Service to interact with cloud providers APIs for model lists
 */

import { normalizeAnthropic, normalizeGoogle, normalizeOpenAI, normalizeOpenRouter, getModelCategory } from './modelCatalog';

// In-memory cache for model lists to avoid repeated API calls
// Cache is keyed by: provider + baseUrl (hash) to detect config changes
const modelCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Create a cache key from provider configuration
 */
const getCacheKey = (provider, baseUrl, apiKey) => {
    // Include a hash of apiKey to invalidate cache when key changes
    // We don't store the full key for security, just use its presence/length
    const keyIndicator = apiKey ? `key-${apiKey.length}` : 'nokey';
    return `${provider}|${baseUrl || 'default'}|${keyIndicator}`;
};

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

export const fetchModels = async (customBaseUrl, includeFreeModels = false, provider = 'openrouter', apiKey = '') => {
    try {
        const cleanProvider = (provider || 'openrouter').toLowerCase().trim();

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
            const result = normalizeAnthropic(data).map(m => ({ ...m, _category: getModelCategory(m) }));
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

            const result = normalizeGoogle(raw).map(m => ({ ...m, _category: getModelCategory(m) }));
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
            const result = normalizeOpenAI(data).map(m => ({ ...m, _category: getModelCategory(m) }));
            setCachedModels(cacheKey, result);
            return result;
        }


        // --- OpenRouter / Local (Ollama/LM Studio) ---
        // Explicitly check for 'openrouter' or 'local'. If unknown, default to openrouter logic but logs might be useful.
        const isLocal = cleanProvider === 'local';

        // If the provider is unknown and not 'local', we treat it as OpenRouter (compatibility),
        // but we should proceed with caution.

        const baseUrl = customBaseUrl ? customBaseUrl.replace(/\/$/, '') : 'https://openrouter.ai/api/v1';

        const headers = {};
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(`${baseUrl}/models`, {
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
            throw new Error(`Failed to parse model list: ${text.slice(0, 100)}...`);
        }
        models = data.data || [];

        // If local, we tag them and skip the "free" filter because local models
        // don't have the same "free" semantics (they are free but private).
        if (isLocal) {
            const result = models.map(m => ({ ...m, _category: 'Local' }));
            setCachedModels(cacheKey, result);
            return result;
        }

        // Filter free models if not included (Only for OpenRouter)
        if (!includeFreeModels && cleanProvider === 'openrouter') {
            models = models.filter(model => {
                const isFree = model.pricing &&
                    (String(model.pricing.prompt) === "0") &&
                    (String(model.pricing.completion) === "0");
                return !isFree;
            });
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
