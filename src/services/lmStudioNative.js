/**
 * LM Studio native chat helpers (POST /api/v1/chat, LM Studio 0.4.0 or newer).
 * The native endpoint is the one that can call MCP servers through the `integrations` field.
 * Kept out of chatService so the payload and response mapping can be tested without fetch.
 */

// server_label used when the integration is a remote MCP URL
export const EPHEMERAL_SERVER_LABEL = 'tacit-search';

/**
 * Map an OpenAI-compatible base URL (http://host:1234/v1) to the native chat endpoint.
 */
export const toNativeUrl = (baseUrl) => {
    const root = (baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '');
    return `${root}/api/v1/chat`;
};

const parseAllowedTools = (allowedTools) =>
    (allowedTools || '').split(',').map(t => t.trim()).filter(Boolean);

/**
 * Build the `integrations` array.
 * `mcp/<label>` refers to a server in LM Studio's mcp.json, an http(s) URL is a remote MCP server sent with the request.
 */
export const buildIntegrations = ({ integrationId, allowedTools }) => {
    const id = (integrationId || '').trim();
    const tools = parseAllowedTools(allowedTools);

    if (/^https?:\/\//i.test(id)) {
        return [{
            type: 'ephemeral_mcp',
            server_label: EPHEMERAL_SERVER_LABEL,
            server_url: id,
            ...(tools.length ? { allowed_tools: tools } : {})
        }];
    }

    if (tools.length) {
        return [{ type: 'plugin', id, allowed_tools: tools }];
    }
    return [id];
};

// Text of a message, with text files appended the same way sendOpenAICompatible does.
const messageText = (m) => {
    let text = m.content || '';
    (m.files || []).forEach(f => {
        if (f.type !== 'image') text += `\n\n--- ${f.name} ---\n${f.content}`;
    });
    return text;
};

/**
 * Convert chat messages to the native `{ system_prompt, input }`. The native API has no roles,
 * so earlier turns become a transcript placed before the last message.
 * Only images of the last message are sent, to keep the request small.
 */
export const buildNativeInput = (messages) => {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).filter(Boolean);
    const turns = messages.filter(m => m.role !== 'system');
    const last = turns[turns.length - 1];
    const history = turns.slice(0, -1);

    let text = last ? messageText(last) : '';
    if (history.length) {
        const transcript = history.map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${messageText(m)}`);
        text = `${transcript.join('\n\n')}\n\nUser: ${text}`;
    }

    const images = (last?.files || []).filter(f => f.type === 'image');
    const input = images.length
        ? [
            ...(text.trim() ? [{ type: 'text', content: text }] : []),
            ...images.map(f => ({ type: 'image', data_url: f.content }))
        ]
        : text;

    return { system_prompt: system.length ? system.join('\n\n') : undefined, input };
};

/**
 * Convert a non-streaming native response to `{ content, toolCalls, usage }`.
 * Reasoning items are dropped. With no message but an invalid tool call, the call's reason is thrown.
 */
export const parseNativeResponse = (data) => {
    const output = Array.isArray(data?.output) ? data.output : [];

    const messages = output.filter(o => o.type === 'message' && o.content);
    if (messages.length === 0) {
        const invalid = output.find(o => o.type === 'invalid_tool_call');
        throw new Error(invalid?.reason || 'No response from AI');
    }

    const toolCalls = output.filter(o => o.type === 'tool_call').map(o => ({
        tool: o.tool,
        query: o.arguments?.query,
        arguments: o.arguments,
        output: o.output,
        server: o.provider_info?.plugin_id || o.provider_info?.server_label
    }));

    const stats = data.stats;
    const usage = stats
        ? {
            prompt_tokens: stats.input_tokens || 0,
            completion_tokens: stats.total_output_tokens || 0,
            total_tokens: (stats.input_tokens || 0) + (stats.total_output_tokens || 0)
        }
        : { total_tokens: 0 };

    return { content: messages.map(o => o.content).join('\n\n'), toolCalls, usage };
};
