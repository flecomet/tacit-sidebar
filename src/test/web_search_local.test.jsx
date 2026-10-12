
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatService } from '../services/chatService';
import { manualToolAdapter } from '../services/manualToolAdapter';
import { webSearchService } from '../services/webSearchService';

// Mock WebSearchService
vi.mock('../services/webSearchService', () => ({
    webSearchService: {
        search: vi.fn().mockResolvedValue([
            { title: 'Result 1', link: 'http://example.com/1', snippet: 'Snippet 1' }
        ]),
        normalizeResults: (res) => res // Pass through for mock
    }
}));

// We need to spy on fetch for the ChatService
global.fetch = vi.fn();

describe('Local Web Search Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch.mockReset();
        webSearchService.search.mockReset().mockResolvedValue([
            { title: 'Result 1', link: 'http://example.com/1', snippet: 'Snippet 1' }
        ]);
    });

    it('keeps search optional when the model answers an ordinary prompt directly', async () => {
        global.fetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({
            choices: [{ message: { content: 'Rewritten paragraph.' } }]
        }) });
        const result = await chatService.sendMessage({
            provider: 'local', baseUrl: 'http://localhost:1234/v1', model: 'gemma-4-31b-it',
            messages: [{ role: 'user', content: 'Rewrite this paragraph.' }],
            options: { webSearch: true, webSearchConfig: { provider: 'brave', apiKey: 'test' } }
        });
        expect(result.content).toBe('Rewritten paragraph.');
        expect(webSearchService.search).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('retrieves sources before generation when the explicit search prefix is present', async () => {
        const controller = new AbortController();
        global.fetch.mockImplementation(async () => {
            expect(webSearchService.search).toHaveBeenCalledWith('brave', 'latest Donald Trump news', expect.anything());
            return { ok: true, text: async () => JSON.stringify({
                choices: [{ message: { content: 'Answer based on retrieved headlines.' } }]
            }) };
        });
        const result = await chatService.sendMessage({
            provider: 'local', baseUrl: 'http://localhost:1234/v1', model: 'gemma-4-31b-it',
            messages: [{ role: 'user', content: 'Search the web for current sources: latest Donald Trump news' }],
            options: { webSearch: true, webSearchConfig: { provider: 'brave', apiKey: 'test' } },
            signal: controller.signal
        });
        expect(result.content).toBe('Answer based on retrieved headlines.');
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const request = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(request.messages.at(-1).content).toContain('http://example.com/1');
        expect(global.fetch.mock.calls[0][1].signal).toBe(controller.signal);
    });

    it('surfaces Brave failures before generation for an explicit search request', async () => {
        webSearchService.search.mockRejectedValueOnce(new Error('Brave Search Error: 401 - Invalid subscription token'));
        await expect(chatService.sendMessage({
            provider: 'local', baseUrl: 'http://localhost:1234/v1', model: 'gemma-4-31b-it',
            messages: [{ role: 'user', content: 'Search the web for current sources: Latest news' }],
            options: { webSearch: true, webSearchConfig: { provider: 'brave', apiKey: 'invalid' } }
        })).rejects.toThrow('Brave Search Error: 401 - Invalid subscription token');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('runs the configured Brave search for the Gemma command shown in the sidebar', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ choices: [{ message: {
                content: '<tool_call>call:google_search:search{queries:["latest Donald Trump news"]}<tool_call>'
            } }] })
        }).mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ choices: [{ message: { content: 'Here are the latest headlines.' } }] })
        });

        const result = await chatService.sendMessage({
            provider: 'local', baseUrl: 'http://localhost:1234/v1', model: 'gemma-4-31b-it',
            messages: [{ role: 'user', content: 'Search for latest donald trump news using websearch.' }],
            options: { webSearch: true, webSearchConfig: { provider: 'brave', apiKey: 'test' } }
        });

        expect(webSearchService.search).toHaveBeenCalledWith('brave', 'latest Donald Trump news', { provider: 'brave', apiKey: 'test' });
        expect(result.content).toBe('Here are the latest headlines.');
        const followUp = JSON.parse(global.fetch.mock.calls[1][1].body);
        expect(followUp.messages.at(-1).content).toContain('http://example.com/1');
    });

    it('preserves a Brave failure instead of asking the model to paraphrase it', async () => {
        const xml = '<tool_use><tool_name>web-browsing</tool_name><parameters><query>latest news</query></parameters></tool_use>';
        global.fetch.mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ choices: [{ message: { content: xml } }] })
        });
        webSearchService.search.mockRejectedValueOnce(new Error('Brave Search Error: 401 - Invalid subscription token'));

        await expect(chatService.sendMessage({
            provider: 'local', baseUrl: 'http://localhost:1234/v1', model: 'local-model',
            messages: [{ role: 'user', content: 'Search latest news' }],
            options: { webSearch: true, webSearchConfig: { provider: 'brave', apiKey: 'test' } }
        })).rejects.toThrow('Brave Search Error: 401 - Invalid subscription token');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('injects tool definitions into system prompt for local models when web search is enabled', async () => {
        const messages = [{ role: 'user', content: 'Who won the World Cup?' }];
        const modified = manualToolAdapter.injectHelper(messages);

        expect(modified[0].role).toBe('system');
        // Expect standard XML tag from prompt
        expect(modified[0].content).toContain('<tool_use>');
        expect(modified[0].content).toContain('web-browsing');
    });

    it('parses valid tool call XML from model response', () => {
        const response = `
<tool_use>
<tool_name>web-browsing</tool_name>
<parameters>
<query>World Cup winner</query>
</parameters>
</tool_use>
        `;
        const parsed = manualToolAdapter.parseToolCall(response);
        expect(parsed).toEqual({ tool: 'web-browsing', args: { query: 'World Cup winner' } });
    });

    it('extracts XML from mixed content', () => {
        const response = `Thinking...
<tool_use>
<tool_name>web-browsing</tool_name>
<parameters>
<query>test</query>
</parameters>
</tool_use>
`;
        const parsed = manualToolAdapter.parseToolCall(response);
        expect(parsed).toEqual({ tool: 'web-browsing', args: { query: 'test' } });
    });

    it('parses alternative function-style XML format', () => {
        const response = `
<think>Some reasoning...</think>
<tool_call>
<function=web-browsing>
<parameter=query>
who won the super bowl 2025
</parameter>
</function>
</tool_call>
        `;
        const parsed = manualToolAdapter.parseToolCall(response);
        expect(parsed).toEqual({ tool: 'web-browsing', args: { query: 'who won the super bowl 2025' } });
    });

    // NEW TEST CASE FOR <tools> FORMAT
    it('parses tools-node style XML format', () => {
        const response = `
<think>Reasoning...</think>
<tools>
  <tool_call>
    <tool>web-browsing</tool>
    <parameter>
      <query>Super Bowl 2025 winner</query>
    </parameter>
  </tool_call>
</tools>
        `;
        const parsed = manualToolAdapter.parseToolCall(response);
        expect(parsed).toEqual({ tool: 'web-browsing', args: { query: 'Super Bowl 2025 winner' } });
    });

    it('executes web search and follows up when local model requests it (using XML)', async () => {
        // 1. First call: Model returns XML tool call
        const xmlResponse = `
<tool_use>
<tool_name>web-browsing</tool_name>
<parameters>
<query>World Cup winner 2022</query>
</parameters>
</tool_use>`;

        global.fetch.mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(JSON.stringify({
                choices: [{ message: { content: xmlResponse } }]
            }))
        });

        // 2. Second call: Model generates final answer based on tool output
        global.fetch.mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(JSON.stringify({
                choices: [{ message: { content: 'Argentina won the World Cup in 2022.' } }]
            }))
        });

        const result = await chatService.sendMessage({
            provider: 'local',
            baseUrl: 'http://localhost:11434/v1',
            model: 'llama3',
            messages: [{ role: 'user', content: 'Who won the world cup?' }],
            options: {
                webSearch: true,
                webSearchConfig: { provider: 'brave', apiKey: 'test' }
            }
        });

        // Expect web search service to be called
        expect(webSearchService.search).toHaveBeenCalledWith('brave', 'World Cup winner 2022', expect.anything());

        // Expect final content
        expect(result.content).toBe('Argentina won the World Cup in 2022.');
    });
});
