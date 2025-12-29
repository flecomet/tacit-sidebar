import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageList from './MessageList';

describe('MessageList', () => {
    it('should show empty state when there are no messages', () => {
        render(<MessageList messages={[]} />);
        expect(screen.getByText('No messages yet.')).toBeDefined();
        expect(screen.getByText(/add page content to context/i)).toBeDefined();
        expect(screen.getByText(/Toggle with Alt \+ J/i)).toBeDefined();
    });

    it('should render user and assistant messages', () => {
        const messages = [
            { role: 'user', content: 'Hello AI' },
            { role: 'assistant', content: 'Hello Human' }
        ];
        render(<MessageList messages={messages} />);

        expect(screen.getByText('Hello AI')).toBeDefined();
        expect(screen.getByText('Hello Human')).toBeDefined();
    });

    it('should render file attachments', () => {
        const messages = [
            {
                role: 'user',
                content: 'Check this file',
                files: [{ name: 'test.pdf', type: 'application/pdf' }]
            }
        ];
        render(<MessageList messages={messages} />);

        expect(screen.getByText('test.pdf')).toBeDefined();
    });

    it('should show loading indicator', () => {
        render(<MessageList messages={[]} isLoading={true} />);
        expect(screen.getByText('Thinking...')).toBeDefined();
    });

    it('should render data URI images used by some models', () => {
        const messages = [{
            role: 'assistant',
            content: 'Image: ![gen](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKwjwAAAAABJRU5ErkJggg==)'
        }];
        render(<MessageList messages={messages} />);

        const img = screen.getByAltText('gen');
        expect(img).toBeDefined();
        const src = img.getAttribute('src');
        expect(src).toContain('data:image/png');
    });

    it('should render http images (regex check)', () => {
        const messages = [{
            role: 'assistant',
            content: 'Image: ![http-img](http://example.com/img.png)'
        }];
        render(<MessageList messages={messages} />);

        const img = screen.getByAltText('http-img');
        expect(img).toBeDefined();
        expect(img.getAttribute('src')).toBe('http://example.com/img.png');
    });
});
