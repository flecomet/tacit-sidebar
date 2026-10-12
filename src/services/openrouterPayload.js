/**
 * OpenRouter web search payload helpers.
 * Kept out of modelService so tests that mock it wholesale still see the real logic.
 */

// Results per web search. Fewer results keep the injected context small.
export const OPENROUTER_WEB_MAX_RESULTS = 3;

// Upper bound for max_tokens when web search is on. OpenRouter reserves max_tokens
// inside the context window, so a large default leaves no room for search results.
export const OPENROUTER_WEB_MAX_TOKENS_CAP = 32768;

// The EU data-region endpoint rejects the web plugin with HTTP 400.
const EU_HOSTNAME = 'eu.openrouter.ai';

/**
 * True when the base URL points at the OpenRouter EU data-region endpoint.
 */
export const isOpenRouterEuEndpoint = (baseUrl) => {
    try {
        return new URL(baseUrl).hostname === EU_HOSTNAME;
    } catch {
        return false;
    }
};

/**
 * Compute the request fields that web search adds for OpenRouter.
 *
 * @returns {{ fields: Object, webSearchUnavailable: boolean }}
 *   fields: `plugins` and `max_tokens` to merge into the payload (empty when web search is off or unavailable).
 *   webSearchUnavailable: true when web search was requested but the endpoint cannot run it.
 */
export const getOpenRouterWebFields = ({ provider, baseUrl, webSearch, maxOutputTokens }) => {
    if (provider !== 'openrouter' || !webSearch) {
        return { fields: {}, webSearchUnavailable: false };
    }

    if (isOpenRouterEuEndpoint(baseUrl)) {
        return { fields: {}, webSearchUnavailable: true };
    }

    // Unknown catalog value falls back to the cap; a known smaller value is respected.
    const hasCatalogLimit = Number.isFinite(maxOutputTokens) && maxOutputTokens > 0;
    const maxTokens = hasCatalogLimit
        ? Math.min(maxOutputTokens, OPENROUTER_WEB_MAX_TOKENS_CAP)
        : OPENROUTER_WEB_MAX_TOKENS_CAP;

    return {
        fields: {
            plugins: [{ id: 'web', max_results: OPENROUTER_WEB_MAX_RESULTS }],
            max_tokens: maxTokens
        },
        webSearchUnavailable: false
    };
};
