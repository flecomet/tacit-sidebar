/**
 * Service to interact with cloud providers APIs for model lists
 */

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

const sortOpenAIModels = (models) => {
    return models.sort((a, b) => {
        const idA = a.id.toLowerCase();
        const idB = b.id.toLowerCase();

        // Helper to extract version
        const getVersion = (id) => {
            const match = id.match(/(?:gpt|chatgpt)-(\d+(?:\.\d+)?)/);
            if (match) return parseFloat(match[1]);
            return 0;
        };

        const verA = getVersion(idA);
        const verB = getVersion(idB);

        // Priority 1: GPT-5+ (>= 5.0)
        const isA5 = verA >= 5;
        const isB5 = verB >= 5;

        if (isA5 && !isB5) return -1;
        if (!isA5 && isB5) return 1;
        if (isA5 && isB5) {
            if (verA !== verB) return verB - verA; // Descending version
            return 0;
        }

        // Priority 2: o1 models (Reasoning)
        const isAo1 = idA.includes('o1');
        const isBo1 = idB.includes('o1');

        if (isAo1 && !isBo1) return -1;
        if (!isAo1 && isBo1) return 1;
        if (isAo1 && isBo1) return idA.localeCompare(idB);

        // Priority 3: GPT-4 (>= 4.0 and < 5.0)
        const isA4 = verA >= 4;
        const isB4 = verB >= 4;

        if (isA4 && !isB4) return -1;
        if (!isA4 && isB4) return 1;
        if (isA4 && isB4) {
            if (verA !== verB) return verB - verA;
            // Put turbo/o before vanilla if same version?
            // Let's just create a quick heuristic for 4o > 4-turbo > 4
            const getVariantScore = (id) => {
                if (id.includes('gpt-4o')) return 3;
                if (id.includes('turbo')) return 2;
                return 1;
            }
            return getVariantScore(idB) - getVariantScore(idA);
        }

        return 0;
    });
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

            const response = await fetch(`${baseUrl}/models`, {
                headers: {
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                }
            });

            if (!response.ok) throw new Error(`Anthropic API Error: ${response.status}`);

            const data = await response.json();

            // Map the response to our format
            models = (data.data || []).map(m => ({
                id: m.id,
                name: m.display_name || m.id
            }));

            // Categorization logic for 2025 models
            const result = models.map(m => ({
                ...m,
                _category: m.id.includes('haiku') ? 'Small' : 'Performance'
            }));
            setCachedModels(cacheKey, result);
            return result;
        }

        // --- Google (Generative Language API) ---
        if (cleanProvider === 'google') {
            const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
            if (!apiKey) return [];

            const response = await fetch(`${baseUrl}/models?key=${apiKey}`);
            if (!response.ok) throw new Error(`Google API Error: ${response.status}`);

            const data = await response.json();
            // Google returns models with "name": "models/gemini-pro"
            // We want id: "gemini-pro"
            models = (data.models || [])
                .filter(m => m.name.includes('gemini'))
                .map(m => ({
                    id: m.name.replace('models/', ''),
                    name: m.displayName || m.name
                }));
            const result = models.map(m => ({ ...m, _category: m.id.includes('flash') || m.id.includes('nano') ? 'Small' : 'Performance' }));
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
            models = (data.data || [])
                .filter(m => m.id.includes('gpt') || m.id.includes('o1')) // Filter for GPT or o1 models
                .map(m => ({ id: m.id, name: m.id }));

            // Apply sorting logic to OpenAI provider too
            // Apply sorting logic to OpenAI provider too
            sortOpenAIModels(models);

            const result = models.map(m => ({
                ...m,
                _category: getModelCategory(m)
            }));
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

        setCachedModels(cacheKey, models);
        return models;
    } catch (error) {
        console.error("Model fetch error:", error.message || "Unknown error");
        throw error;
    }
};

export const getModelCategory = (model) => {
    // Explicit tag from fetchModels (e.g. Local)
    if (model._category) return model._category;

    // Check if free (pricing is usually string "0" or number 0)
    // OpenRouter model object usually has `pricing` object with `prompt` and `completion`.
    const isFree = model.pricing && (model.pricing.prompt === "0" || model.pricing.prompt === 0)
        && (model.pricing.completion === "0" || model.pricing.completion === 0);

    if (isFree) return 'Free';

    const id = model.id.toLowerCase();
    const name = (model.name || '').toLowerCase();

    // Performance: GPT-4, GPT-5, o1, Claude 3 Opus/Sonnet/3.5 Sonnet, Gemini Pro
    // We check these first, but exclude "mini"/"haiku" variants which are Small
    if (id.includes('gpt-5') || id.includes('gpt-4') || id.includes('o1') ||
        id.includes('claude-3-opus') || id.includes('claude-3-sonnet') ||
        id.includes('claude-3.5-sonnet') ||
        (id.includes('gemini') && id.includes('pro')) ||
        id.includes('gemini-1.5-pro') ||
        id.includes('mistral-large') ||
        id.includes('llama-3.1-405b')
    ) {
        if (id.includes('mini') || id.includes('micro') || id.includes('haiku') || id.includes('flash-8b')) {
            return 'Small';
        }
        return 'Performance';
    }

    // Light/Small models
    const smallKeywords = ['7b', '8b', 'phi', 'gemma', 'haiku', 'flash', 'micro', 'mini', 'turbo'];

    if (smallKeywords.some(k => {
        // Special case: if keyword is 'mini' and model is 'gemini', ignore unless it's 'gemini-mini' (doesn't exist)
        if (k === 'mini' && id.includes('gemini') && !id.includes('mini-')) return false;
        // Special case: 'turbo' is often Performance for OpenAI (handled above) 
        // but might be small for others. If we reached here, it wasn't caught by the heavy weights above.
        return id.includes(k) || name.includes(k);
    })) {
        return 'Small';
    }

    // Default to Performance
    return 'Performance';
};
