
/**
 * Manual Tool Adapter
 * Helps local models usage of tools by prompt injection and output parsing.
 * Uses XML format for better compatibility with local models.
 */

export const manualToolAdapter = {
    /**
     * Injects tool definitions into the system prompt.
     * @param {Array} messages - Chat history
     * @returns {Array} Modified messages
     */
    injectHelper(messages) {
        const currentDate = new Date().toISOString().split('T')[0];
        const TOOL_DEFINITION = `
Current Date: ${currentDate}

You have access to the following tools:
1. web-browsing: Searches for a given query using a search engine to get better results.
   - Parameters: query (string)

To use a tool, you MUST use the following XML format:
<tool_use>
<tool_name>web-browsing</tool_name>
<parameters>
<query>your search query</query>
</parameters>
</tool_use>

If no tool is needed, respond normally.
Do not use other formats. Only use the format above.
`;

        // Find system message or prepend one
        const systemIndex = messages.findIndex(m => m.role === 'system');
        const newMessages = [...messages];

        if (systemIndex !== -1) {
            newMessages[systemIndex] = {
                ...newMessages[systemIndex],
                content: newMessages[systemIndex].content + "\n\n" + TOOL_DEFINITION
            };
        } else {
            newMessages.unshift({
                role: 'system',
                content: TOOL_DEFINITION
            });
        }

        return newMessages;
    },

    /**
     * Parses the model output for tool calls using XML.
     * @param {string} content - Model response content
     * @returns {Object|null} - { tool: string, args: Object } or null
     */
    parseToolCall(content) {
        // 1. Try standard <tool_use> format
        // Also supports loose format like: <tool_use> <parameter=query> value </tool_use>
        const toolUseRegex = /<tool_use>([\s\S]*?)<\/tool_use>/;
        const match = content.match(toolUseRegex);

        if (match) {
            const innerContent = match[1];

            // Extract tool name
            const nameMatch = innerContent.match(/<tool_name>(.*?)<\/tool_name>/);
            // Default to 'web-browsing' if strictly inside <tool_use> but name is missing
            // This is safe because we only inject one tool for local models right now
            const toolName = nameMatch ? nameMatch[1].trim() : 'web-browsing';

            // Extract query parameter
            // Support:
            // 1. <query>val</query>
            // 2. <parameter=query>val</parameter>
            // 3. <parameter=query>val (implicit close by parent)
            let query = null;

            const queryMatch = innerContent.match(/<query>(.*?)<\/query>/);
            if (queryMatch) {
                query = queryMatch[1].trim();
            } else {
                // Try parameter=query format
                const paramMatch = innerContent.match(/<parameter=query>([\s\S]*?)(?:<\/parameter>|$)/);
                if (paramMatch) {
                    query = paramMatch[1].trim();
                }
            }

            if (toolName && query) {
                return {
                    tool: toolName,
                    args: { query }
                };
            }
        }

        // 2. Try alternative <function=name> format (e.g. DeepSeek R1)
        // Format: <function=web-browsing><parameter=query>value</parameter></function>
        const funcRegex = /<function=(\S+)>([\s\S]*?)<\/function>/;
        const funcMatch = content.match(funcRegex);

        if (funcMatch) {
            const toolName = funcMatch[1].trim();
            const inner = funcMatch[2];

            // Extract query from <parameter=query> or just <query> if distinct
            // Also handle missing closing tag for parameter
            const paramRegex = /(?:<parameter=query>|<query>)([\s\S]*?)(?:<\/parameter>|<\/query>|$)/;
            const paramMatch = inner.match(paramRegex);

            if (paramMatch) {
                return {
                    tool: toolName,
                    args: { query: paramMatch[1].trim() }
                };
            }
        }

        // 3. Try <tools> wrapper format
        // Format: <tools><tool_call><tool>web-browsing</tool><parameter><query>value</query></parameter></tool_call></tools>
        const toolsRegex = /<tools>([\s\S]*?)<\/tools>/;
        const toolsMatch = content.match(toolsRegex);

        if (toolsMatch) {
            const inner = toolsMatch[1];

            // Extract tool
            const toolRegex = /<tool>(.*?)<\/tool>/;
            const toolMatch = inner.match(toolRegex);
            const toolName = toolMatch ? toolMatch[1].trim() : 'web-browsing';

            // Extract query from <parameter><query> or just <query>
            const queryRegex = /<query>(.*?)<\/query>/;
            const queryMatch = inner.match(queryRegex);

            if (queryMatch) {
                return {
                    tool: toolName,
                    args: { query: queryMatch[1].trim() }
                };
            }
        }

        // 4. Fallback: Loose "parameter=query" finding
        // If we find <parameter=query>... anywhere, even if tags are messy
        // Matches: <parameter=query> search term </AnyClosingTag>
        // Or: <tool_code> ... </tool_code> patterns
        const looseParamRegex = /<parameter=query>([\s\S]*?)(?:<\/parameter>|<\/tool_use>|<\/tool_call>|<\/function>|$)/;
        const looseMatch = content.match(looseParamRegex);

        if (looseMatch) {
            // If we found a parameter=query, it's almost certainly a tool call to our web search
            // Check if it looks like a valid string (not empty)
            const val = looseMatch[1].trim();
            if (val && val.length < 200) { // Safety limit length
                return {
                    tool: 'web-browsing',
                    args: { query: val }
                };
            }
        }

        return null;
    },

    /**
     * Formats the tool result into a message for the model.
     * @param {Array} results - Search results
     * @returns {string} - Formatted result string
     */
    formatToolResult(results) {
        if (!results || results.length === 0) {
            return "<tool_output>No results found.</tool_output>";
        }
        const snippet = results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.link}\n${r.snippet}`).join('\n\n');
        return `<tool_output>\n${snippet}\n</tool_output>\n\nBased on these results, please answer the user's original question.`;
    }
};
