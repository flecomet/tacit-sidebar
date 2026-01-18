
import { describe, it, expect } from 'vitest';
import { manualToolAdapter } from '../services/manualToolAdapter';

describe('Manual Tool Adapter - Edge Cases', () => {
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
