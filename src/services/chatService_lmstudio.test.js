import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatService } from './chatService';
import { webSearchService } from './webSearchService';

vi.mock('./webSearchService', () => ({
    webSearchService: {
        search: vi.fn().mockResolvedValue([{ title: 'Result 1', link: 'http://example.com/1', snippet: 'Snippet 1' }]),
        normalizeResults: (res) => res
    }
}));

const BASE = 'http://localhost:1234/v1';
const messages = [{ role: 'user', content: 'Who won the World Cup?' }];
const lmStudioSearch = { integrationId: 'mcp/my-search', allowedTools: '', token: '' };

const nativeBody = {
    model_instance_id: 'qwen',
    output: [
        { type: 'tool_call', tool: 'web_search', arguments: { query: 'world cup' }, output: '[]', provider_info: { type: 'plugin', plugin_id: 'mcp/my-search' } },
        { type: 'message', content: 'Argentina won.' }
    ],
    stats: { input_tokens: 10, total_output_tokens: 5, reasoning_output_tokens: 0 }
};

const jsonResponse = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
});

const send = (options = {}, extra = {}) => chatService.sendMessage({
    provider: 'local',
    baseUrl: BASE,
    apiKey: '',
    model: 'qwen',
    messages,
    options: { webSearch: true, webSearchConfig: { provider: 'google', apiKey: 'k', cx: 'c' }, lmStudioSearch, ...options },
    ...extra
});

const urls = () => global.fetch.mock.calls.map(c => c[0]);

describe('LM Studio native web search', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    it('posts to /api/v1/chat without messages and returns content, tool calls and usage', async () => {
        global.fetch.mockResolvedValueOnce(jsonResponse(nativeBody));

        const result = await send();

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('http://localhost:1234/api/v1/chat');
        const body = JSON.parse(init.body);
        expect(body).toMatchObject({ model: 'qwen', input: 'Who won the World Cup?', integrations: ['mcp/my-search'], stream: false, store: false });
        expect(body).not.toHaveProperty('messages');
        expect(body).not.toHaveProperty('previous_response_id');
        expect(init.headers).not.toHaveProperty('Authorization');

        expect(result.content).toBe('Argentina won.');
        expect(result.attachments).toEqual([]);
        expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].tool).toBe('web_search');
        expect(webSearchService.search).not.toHaveBeenCalled();
    });

    it('sends the Bearer token only when one is set', async () => {
        global.fetch.mockResolvedValueOnce(jsonResponse(nativeBody));

        await send({ lmStudioSearch: { ...lmStudioSearch, token: 'lm-secret' } });

        expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer lm-secret');
    });

    it('falls back to the built-in XML search on HTTP 404', async () => {
        const xml = '<tool_use><tool_name>web-browsing</tool_name><parameters><query>World Cup winner</query></parameters></tool_use>';
        global.fetch
            .mockResolvedValueOnce(jsonResponse('Not found', 404))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: xml } }] }))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Argentina.' } }] }));

        const result = await send();

        expect(urls()[0]).toBe('http://localhost:1234/api/v1/chat');
        expect(urls()[1]).toBe('http://localhost:1234/v1/chat/completions');
        expect(webSearchService.search).toHaveBeenCalledWith('google', 'World Cup winner', expect.anything());
        expect(result.content).toBe('Argentina.');
        expect(result.fallbackNotice).toBe('LM Studio MCP unavailable, using built-in search');
        const body = JSON.parse(global.fetch.mock.calls[1][1].body);
        expect(body).not.toHaveProperty('lmStudioSearch');
    });

    it('falls back on HTTP 405 and on a network failure', async () => {
        global.fetch
            .mockResolvedValueOnce(jsonResponse('', 405))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'plain' } }] }));
        expect((await send()).content).toBe('plain');
        expect(webSearchService.search).not.toHaveBeenCalled();

        global.fetch.mockReset();
        global.fetch
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'plain 2' } }] }));
        expect((await send()).content).toBe('plain 2');
        expect(webSearchService.search).not.toHaveBeenCalled();
        expect(urls()[1]).toBe('http://localhost:1234/v1/chat/completions');
    });

    it('throws an error with an authentication hint on 401 and does not fall back', async () => {
        global.fetch.mockResolvedValueOnce(jsonResponse('Unauthorized', 401));

        await expect(send()).rejects.toThrow(/Require Authentication/);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('gives the same hint on other 4xx errors without falling back', async () => {
        global.fetch.mockResolvedValueOnce(jsonResponse('{"error":"unknown integration"}', 400));

        await expect(send()).rejects.toThrow(/Require Authentication.*400|400.*Require Authentication/s);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('does not fall back on a server error', async () => {
        global.fetch.mockResolvedValueOnce(jsonResponse('boom', 500));

        await expect(send()).rejects.toThrow(/500/);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('rethrows AbortError without falling back', async () => {
        const abort = new DOMException('Aborted', 'AbortError');
        global.fetch.mockRejectedValueOnce(abort);

        await expect(send({}, { signal: new AbortController().signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('does not use the native endpoint without lmStudioSearch or when web search is off', async () => {
        global.fetch.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'plain' } }] }));

        await send({ lmStudioSearch: undefined, webSearch: false });
        await send({ lmStudioSearch: undefined });
        await send({ webSearch: false });
        await send({ lmStudioSearch: { integrationId: '' } });

        urls().forEach(u => expect(u).toBe('http://localhost:1234/v1/chat/completions'));
        global.fetch.mock.calls.forEach(c => expect(JSON.parse(c[1].body)).not.toHaveProperty('lmStudioSearch'));
    });

    it('makes no /api/v1 call for an Ollama URL when the setting is off', async () => {
        global.fetch.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'plain' } }] }));

        await chatService.sendMessage({
            provider: 'local',
            baseUrl: 'http://localhost:11434/v1',
            apiKey: '',
            model: 'llama3',
            messages,
            options: { webSearch: false }
        });

        expect(urls()).toEqual(['http://localhost:11434/v1/chat/completions']);
    });
});
