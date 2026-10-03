/**
 * Provider-agnostic model metadata.
 * Capabilities come from each provider's own /models response, so new model
 * generations need no code change. Regexes below name product types
 * (audio, embeddings, image generation), never model generations.
 */

export const OPENROUTER_EU_BASE_URL = 'https://eu.openrouter.ai/api/v1';

// Endpoints these models serve are not chat/completions (or are Responses-API-only).
const OPENAI_NON_CHAT = /(embedding|tts|whisper|transcribe|audio|realtime|live|image|sora|moderation|babbage|davinci|instruct|search-api|codex|deep-research|-pro(-|$))/;
const GOOGLE_NON_CHAT = /(tts|transcribe|lyria|veo|imagen|embedding|native-audio|live|robotics|computer-use|deep-research|antigravity|aqa)/;
const DATED_SNAPSHOT = /-\d{4}-\d{2}-\d{2}$/;
const SMALL_TIER = /(^|[-_/.: ])(mini|nano|haiku|flash|lite|small|tiny|micro)([-_/.: ]|$)/;
const SMALL_PRICE_PER_TOKEN = 0.0000004; // $0.40 per million input tokens

const toUnix = (iso) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
};
const byNewest = (a, b) => (b.created || 0) - (a.created || 0);

export const isFreePricing = (pricing) =>
    !!pricing && Number(pricing.prompt) === 0 && Number(pricing.completion) === 0;

const maxParamBillions = (id) => {
    const sizes = [...id.matchAll(/(\d+(?:\.\d+)?)b(?![a-z])/g)].map(m => parseFloat(m[1]));
    return sizes.length ? Math.max(...sizes) : null;
};

/** true / false when the provider says so, null when unknown. */
export const supportsImageInput = (model) => {
    if (!model) return null;
    const modalities = model.architecture?.input_modalities;
    if (Array.isArray(modalities)) return modalities.includes('image');
    if (typeof model.supportsImages === 'boolean') return model.supportsImages;
    return null;
};

export const getModelCategory = (model) => {
    if (model._category) return model._category;
    if (isFreePricing(model.pricing)) return 'Free';

    const id = (model.id || '').toLowerCase();
    const name = (model.name || '').toLowerCase();

    const promptPrice = Number(model.pricing?.prompt);
    if (promptPrice > 0 && promptPrice < SMALL_PRICE_PER_TOKEN) return 'Small';
    if (SMALL_TIER.test(id) || SMALL_TIER.test(name)) return 'Small';

    const size = maxParamBillions(id);
    if (size !== null && size <= 9) return 'Small';

    return 'Performance';
};

export const normalizeOpenRouter = (models) => models.map(m => ({
    ...m,
    contextLength: m.context_length ?? null,
    maxOutputTokens: m.top_provider?.max_completion_tokens ?? null,
    supportsImages: Array.isArray(m.architecture?.input_modalities)
        ? m.architecture.input_modalities.includes('image')
        : null,
}));

export const normalizeAnthropic = (data) => (data.data || [])
    .map(m => ({
        id: m.id,
        name: m.display_name || m.id,
        created: toUnix(m.created_at),
        contextLength: m.max_input_tokens ?? null,
        maxOutputTokens: m.max_tokens ?? null,
        supportsImages: m.capabilities?.image_input?.supported ?? null,
    }))
    .sort(byNewest);

// Google gives no creation date; keep the API's order.
export const normalizeGoogle = (models) => models
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => ({
        id: m.name.replace(/^models\//, ''),
        name: m.displayName || m.name,
        contextLength: m.inputTokenLimit ?? null,
        maxOutputTokens: m.outputTokenLimit ?? null,
        supportsImages: null,
    }))
    .filter(m => !GOOGLE_NON_CHAT.test(m.id));

export const normalizeOpenAI = (data, now = Date.now()) => {
    const usable = (data.data || [])
        .filter(m => !OPENAI_NON_CHAT.test(m.id))
        .filter(m => !m.shutdown_date || Date.parse(m.shutdown_date) > now);
    const ids = new Set(usable.map(m => m.id));
    return usable
        // Hide "gpt-4.1-2025-04-14" when "gpt-4.1" exists.
        .filter(m => !(DATED_SNAPSHOT.test(m.id) && ids.has(m.id.replace(DATED_SNAPSHOT, ''))))
        .map(m => ({ id: m.id, name: m.id, created: m.created || 0, supportsImages: null }))
        .sort(byNewest);
};
