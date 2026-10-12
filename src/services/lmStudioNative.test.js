import { describe, it, expect } from 'vitest';
import { toNativeUrl, buildIntegrations, buildNativeInput, parseNativeResponse } from './lmStudioNative';

describe('toNativeUrl', () => {
    it('maps the OpenAI-compatible base URL to the native chat endpoint', () => {
        expect(toNativeUrl('http://localhost:1234/v1/')).toBe('http://localhost:1234/api/v1/chat');
        expect(toNativeUrl('http://localhost:1234/v1')).toBe('http://localhost:1234/api/v1/chat');
        expect(toNativeUrl('http://192.168.1.5:1234')).toBe('http://192.168.1.5:1234/api/v1/chat');
    });
});

describe('buildIntegrations', () => {
    it('uses the string shorthand for an mcp.json server', () => {
        expect(buildIntegrations({ integrationId: 'mcp/my-search' })).toEqual(['mcp/my-search']);
    });

    it('uses a plugin object when allowed tools are set', () => {
        expect(buildIntegrations({ integrationId: 'mcp/my-search', allowedTools: ' web_search, fetch ,' })).toEqual([
            { type: 'plugin', id: 'mcp/my-search', allowed_tools: ['web_search', 'fetch'] }
        ]);
    });

    it('uses an ephemeral MCP server for a URL', () => {
        expect(buildIntegrations({ integrationId: 'https://mcp.example.com/sse', allowedTools: 'search' })).toEqual([
            { type: 'ephemeral_mcp', server_label: 'tacit-search', server_url: 'https://mcp.example.com/sse', allowed_tools: ['search'] }
        ]);
    });

    it('omits allowed_tools when none are given', () => {
        const [entry] = buildIntegrations({ integrationId: 'https://mcp.example.com/sse', allowedTools: '' });
        expect(entry).not.toHaveProperty('allowed_tools');
    });
});

describe('buildNativeInput', () => {
    it('sends a single user message as a plain string', () => {
        expect(buildNativeInput([{ role: 'user', content: 'Hello' }])).toEqual({ system_prompt: undefined, input: 'Hello' });
    });

    it('moves system messages to system_prompt and flattens earlier turns', () => {
        const { system_prompt, input } = buildNativeInput([
            { role: 'system', content: 'Be brief.' },
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hello!' },
            { role: 'user', content: 'Who won?' }
        ]);
        expect(system_prompt).toBe('Be brief.');
        expect(input).toBe('User: Hi\n\nAssistant: Hello!\n\nUser: Who won?');
    });

    it('sends images of the last turn as data_url items and appends text files', () => {
        const { input } = buildNativeInput([
            {
                role: 'user',
                content: 'Describe',
                files: [
                    { type: 'image', content: 'data:image/png;base64,AAA' },
                    { type: 'text', name: 'a.txt', content: 'file body' }
                ]
            }
        ]);
        expect(input).toEqual([
            { type: 'text', content: 'Describe\n\n--- a.txt ---\nfile body' },
            { type: 'image', data_url: 'data:image/png;base64,AAA' }
        ]);
    });
});

describe('parseNativeResponse', () => {
    const base = {
        model_instance_id: 'm',
        stats: { input_tokens: 10, total_output_tokens: 5, reasoning_output_tokens: 2 }
    };

    it('returns message text, drops reasoning and maps tool calls and usage', () => {
        const result = parseNativeResponse({
            ...base,
            output: [
                { type: 'reasoning', content: 'thinking...' },
                {
                    type: 'tool_call',
                    tool: 'web_search',
                    arguments: { query: 'world cup' },
                    output: '[{"title":"x"}]',
                    provider_info: { type: 'plugin', plugin_id: 'mcp/my-search' }
                },
                { type: 'message', content: 'Argentina.' },
                { type: 'message', content: 'Second part.' }
            ]
        });
        expect(result.content).toBe('Argentina.\n\nSecond part.');
        expect(result.toolCalls).toEqual([{
            tool: 'web_search',
            query: 'world cup',
            arguments: { query: 'world cup' },
            output: '[{"title":"x"}]',
            server: 'mcp/my-search'
        }]);
        expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    });

    it('reads the server label of an ephemeral MCP server', () => {
        const { toolCalls } = parseNativeResponse({
            ...base,
            output: [
                { type: 'tool_call', tool: 'search', arguments: {}, output: '', provider_info: { type: 'ephemeral_mcp', server_label: 'tacit-search' } },
                { type: 'message', content: 'ok' }
            ]
        });
        expect(toolCalls[0].server).toBe('tacit-search');
        expect(toolCalls[0].query).toBeUndefined();
    });

    it('throws the reason of an invalid tool call when there is no message', () => {
        expect(() => parseNativeResponse({
            ...base,
            output: [{ type: 'invalid_tool_call', reason: 'Tool not allowed', metadata: {} }]
        })).toThrow('Tool not allowed');
    });

    it('defaults usage when stats are missing', () => {
        const { usage } = parseNativeResponse({ output: [{ type: 'message', content: 'x' }] });
        expect(usage).toEqual({ total_tokens: 0 });
    });
});
