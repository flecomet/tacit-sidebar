/**
 * OpenAI, Anthropic and Google /models responses carry no prices (and OpenAI/Google no
 * capabilities). OpenRouter's public catalog lists the same models with both, so it fills
 * those gaps. One request, no API key, no chat content; cached for an hour.
 */

const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const TTL_MS = 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 5000;

const timeoutSignal = (ms) => {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
};

let cached = null; // { at, byId }
let inflight = null;

export const clearPriceCatalog = () => { cached = null; inflight = null; };

export const loadPriceCatalog = (now = Date.now()) => {
    if (cached && now - cached.at < TTL_MS) return Promise.resolve(cached.byId);
    if (!inflight) {
        inflight = fetch(CATALOG_URL, { signal: timeoutSignal(FETCH_TIMEOUT_MS), credentials: 'omit' })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                cached = { at: now, byId: new Map((data.data || []).map(m => [m.id, m])) };
                return cached.byId;
            })
            .finally(() => { inflight = null; }); // a failure is retried on the next call
    }
    return inflight;
};

/** "claude-sonnet-5-5" → "anthropic/claude-sonnet-5.5"; "gpt-4.1-2025-04-14" → "openai/gpt-4.1". */
export const catalogCandidates = (provider, id) => {
    const undated = id.replace(/-\d{8}$/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
    return [...new Set([id, undated, undated.replace(/(\d)-(\d)/g, '$1.$2')])].map(x => `${provider}/${x}`);
};

export const findCatalogEntry = (catalog, provider, id) => {
    for (const candidate of catalogCandidates(provider, id)) {
        if (catalog.has(candidate)) return catalog.get(candidate);
    }
    return null;
};

/** Provider data wins; the catalog fills pricing, modalities and release date where missing. */
export const enrichFromCatalog = (models, provider, catalog) => {
    if (!catalog) return models;
    return models.map(m => {
        const entry = findCatalogEntry(catalog, provider, m.id);
        if (!entry) return m;
        return {
            ...m,
            pricing: m.pricing ?? entry.pricing,
            architecture: m.architecture ?? entry.architecture,
            created: m.created || entry.created,
        };
    });
};
