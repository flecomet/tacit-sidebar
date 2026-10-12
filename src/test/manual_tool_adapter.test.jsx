
import { describe, it, expect } from 'vitest';
import { manualToolAdapter } from '../services/manualToolAdapter';

describe('Manual Tool Adapter - Edge Cases', () => {
    it.each(['<tool_call>', '</tool_call>'])('parses Gemma search commands ending with %s', (closingTag) => {
        const input = '<tool_call>call:google_search:search{queries:["latest Donald Trump news"]}' + closingTag;
        expect(manualToolAdapter.parseToolCall(input)).toEqual({
            tool: 'web-browsing', args: { query: 'latest Donald Trump news' }
        });
    });

    it.each([
        '<tool_call>call:google_search:search{queries:[]}<tool_call>',
        '<tool_call>call:google_search:search{queries:[123]}<tool_call>',
        '<tool_call>call:google_search:search{queries:[" "]}<tool_call>',
        '<tool_call>call:google_search:search{queries:[broken]}<tool_call>',
        '<tool_call>call:other_tool:search{queries:["news"]}<tool_call>',
        'call:google_search:search{queries:["news"]}'
    ])('ignores invalid or unrelated Gemma commands: %s', (input) => {
        expect(manualToolAdapter.parseToolCall(input)).toBeNull();
    });

    it('should parse malformed hybrid XML format from local models', () => {
        const input = 'Use web-browsing tool with query "2025 Super Bowl winner". <tool_use> <parameter=query> 2025 Super Bowl winner </tool_use> </tool_call>';

        const result = manualToolAdapter.parseToolCall(input);

        expect(result).not.toBeNull();
        expect(result).toEqual({
            tool: 'web-browsing',
            args: { query: '2025 Super Bowl winner' }
        });
    });
});
