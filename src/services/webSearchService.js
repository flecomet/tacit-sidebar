
/**
 * Web Search Service
 * Handles interactions with various search providers.
 * Adapted from AnythingLLM implementation.
 */

export const webSearchService = {
    // Normalizer to convert different provider formats to standard { title, link, snippet }
    normalizeResults(results) {
        return results.map(r => ({
            title: r.title,
            link: r.link,
            snippet: r.snippet || r.description || ''
        }));
    },

    async search(provider, query, config) {
        switch (provider) {
            case 'google':
                return this.googleSearch(query, config.apiKey, config.cx);
            case 'serpapi':
                return this.serpApiSearch(query, config.apiKey);
            case 'serper':
                return this.serperSearch(query, config.apiKey);
            // Add other providers as needed
            default:
                throw new Error(`Unsupported search provider: ${provider}`);
        }
    },

    /**
     * Google Custom Search
     * https://programmablesearchengine.google.com/controlpanel/create
     */
    async googleSearch(query, apiKey, cx) {
        if (!apiKey || !cx) throw new Error('Missing Google API Key or CX');

        const searchURL = new URL("https://www.googleapis.com/customsearch/v1");
        searchURL.searchParams.append("key", apiKey);
        searchURL.searchParams.append("cx", cx);
        searchURL.searchParams.append("q", query);

        const res = await fetch(searchURL.toString());
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Google Search Error: ${res.status} - ${err}`);
        }

        const data = await res.json();
        const items = data.items || [];

        return items.map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet
        }));
    },

    /**
     * SerpApi
     * https://serpapi.com/
     */
    async serpApiSearch(query, apiKey) {
        if (!apiKey) throw new Error('Missing SerpApi Key');

        const params = new URLSearchParams({
            engine: "google",
            q: query,
            api_key: apiKey
        });

        const url = `https://serpapi.com/search.json?${params.toString()}`;
        const res = await fetch(url);

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`SerpApi Error: ${res.status} - ${err}`);
        }

        const data = await res.json();

        if (data.error) throw new Error(data.error);

        const results = [];
        // Knowledge Graph
        if (data.knowledge_graph) {
            results.push({
                title: data.knowledge_graph.title || 'Knowledge Graph',
                link: data.knowledge_graph.source?.link || '',
                snippet: data.knowledge_graph.description || ''
            });
        }

        // Organic Results
        if (data.organic_results) {
            data.organic_results.forEach(item => {
                results.push({
                    title: item.title,
                    link: item.link,
                    snippet: item.snippet
                });
            });
        }

        return results;
    },

    /**
     * Serper.dev
     * https://serper.dev
     */
    async serperSearch(query, apiKey) {
        if (!apiKey) throw new Error('Missing Serper API Key');

        const res = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: {
                "X-API-KEY": apiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ q: query })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Serper Error: ${res.status} - ${err}`);
        }

        const data = await res.json();
        const results = [];

        if (data.knowledgeGraph) {
            results.push({
                title: data.knowledgeGraph.title || 'Knowledge Graph',
                link: data.knowledgeGraph.descriptionLink || '',
                snippet: data.knowledgeGraph.description || ''
            });
        }

        if (data.organic) {
            data.organic.forEach(item => {
                results.push({
                    title: item.title,
                    link: item.link,
                    snippet: item.snippet
                });
            });
        }

        return results;
    }
};
