import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MessageList from './MessageList';

describe('MessageList Copy Functionality', () => {
    // Keep reference to original clipboard to restore later if needed (though jsdom doesn't usually have it)
    const originalClipboard = global.navigator.clipboard;

    beforeEach(() => {
        global.navigator.clipboard = {
            writeText: vi.fn().mockResolvedValue(undefined)
        };
    });

    afterEach(() => {
        if (originalClipboard) {
            global.navigator.clipboard = originalClipboard;
        } else {
            delete global.navigator.clipboard;
        }
        vi.restoreAllMocks();
    });

    it('should show copy button for messages and copy content on click', async () => {
        const messages = [{ role: 'assistant', content: 'Hello World' }];
        render(<MessageList messages={messages} />);

        // We assume the copy button will have aria-label="Copy message"
        // This is expected to FAIL currently
        const copyBtn = await screen.findByLabelText('Copy message');
        fireEvent.click(copyBtn);

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Hello World');
    });

    it('should show copy button for code blocks and copy code on click', async () => {
        const code = 'console.log("test");';
        const messages = [{ role: 'assistant', content: '```javascript\n' + code + '\n```' }];
        render(<MessageList messages={messages} />);

        // We assume the code block copy button will have aria-label="Copy code"
        // This is expected to FAIL currently
        const copyBtn = await screen.findByLabelText('Copy code');
        fireEvent.click(copyBtn);

        // Note: ReactMarkdown or the code block renderer might trim or handle newlines differently,
        // but usually it preserves the content. We'll adjust expectation if needed after implementation.
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining(code));
    });
});
