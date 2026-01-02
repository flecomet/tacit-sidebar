/**
 * Service to interact with cloud providers APIs for model lists
 */
export const fetchModels = async (customBaseUrl, includeFreeModels = false, provider = 'openrouter', apiKey = '') => {
    try {
        let models = [];
        const cleanProvider = (provider || 'openrouter').toLowerCase().trim();

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
            return models.map(m => ({
                ...m,
                _category: m.id.includes('haiku') ? 'Small' : 'Performance'
            }));
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
            return models.map(m => ({ ...m, _category: m.id.includes('flash') || m.id.includes('nano') ? 'Small' : 'Performance' }));
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
            models.sort((a, b) => {
                const idA = a.id.toLowerCase();
                const idB = b.id.toLowerCase();

                // Priority: o1 > GPT-5 > GPT-4.5 > GPT-4o > GPT-4
                const getScore = (id) => {
                    if (id.includes('o1-')) return 110; // o1 preview/mini
                    if (id.includes('gpt-5') || id.includes('chatgpt-5')) return 100;
                    if (id.includes('gpt-4.5')) return 90;
                    if (id.includes('gpt-4o')) return 80;
                    if (id.includes('gpt-4') && !id.includes('mini')) return 70;
                    if (id.includes('gpt-4')) return 60; // minis etc
                    return 0;
                };

                const scoreA = getScore(idA);
                const scoreB = getScore(idB);

                if (scoreA !== scoreB) {
                    return scoreB - scoreA; // Descending score
                }

                // Alphabetical as tie breaker
                return idA.localeCompare(idB);
            });

            return models.map(m => ({ ...m, _category: m.id.includes('gpt-4') || m.id.includes('o1') ? 'Performance' : 'Small' }));
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
            return models.map(m => ({ ...m, _category: 'Local' }));
        }

        // Custom Sorting: Prioritize GPT-5 / ChatGPT-5
        models.sort((a, b) => {
            const idA = a.id.toLowerCase();
            const idB = b.id.toLowerCase();

            // Extract version numbers for GPT models
            const getGptScore = (id) => {
                if (id.includes('o1-')) return 110;
                if (id.includes('gpt-5') || id.includes('chatgpt-5')) return 100;
                if (id.includes('gpt-4.5')) return 90;
                if (id.includes('gpt-4o')) return 80; // Optimized
                if (id.includes('gpt-4') && !id.includes('mini')) return 70;
                if (id.includes('gpt-4')) return 60;

                // Claude
                if (id.includes('claude-3.5')) return 55;
                if (id.includes('claude-3')) return 50;

                return 0;
            };

            const scoreA = getGptScore(idA);
            const scoreB = getGptScore(idB);

            if (scoreA !== scoreB) {
                return scoreB - scoreA;
            }

            return idA.localeCompare(idB);
        });

        // Filter free models if not included (Only for OpenRouter)
        if (!includeFreeModels && cleanProvider === 'openrouter') {
            models = models.filter(model => {
                const isFree = model.pricing &&
                    (String(model.pricing.prompt) === "0") &&
                    (String(model.pricing.completion) === "0");
                return !isFree;
            });
        }

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

    // Specific check for Gemini Pro to ensure it hits Performance
    // "gemini" contains "mini", so we need to be careful
    if (id.includes('gemini') && id.includes('pro')) {
        return 'Performance';
    }

    // Light/Small models
    // Exclude 'gemini' here because of the 'mini' substring match issue if we used 'mini'
    // But 'mini' IS in the list.
    const smallKeywords = ['7b', '8b', 'phi', 'gemma', 'haiku', 'flash', 'micro', 'mini', 'turbo'];

    if (smallKeywords.some(k => {
        // Special case: if keyword is 'mini' and model is 'gemini', ignore unless it's 'gemini-mini' (doesn't exist)
        if (k === 'mini' && id.includes('gemini') && !id.includes('mini-')) return false;
        return id.includes(k) || name.includes(k);
    })) {
        return 'Small';
    }

    // Default to Performance
    return 'Performance';
};
