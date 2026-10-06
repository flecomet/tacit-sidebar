import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatInput from './ChatInput';
import { useChatStore } from '../store/useChatStore';

const renderInput = () => render(
    <ChatInput onSend={vi.fn()} onStop={vi.fn()} onUpload={vi.fn()} onReadPage={vi.fn()}
        isLoading={false} disabled={false} providerMode="cloud" activeProvider="openrouter" />
);

describe('ChatInput chat total', () => {
    beforeEach(() => useChatStore.setState({ availableModels: [], model: 'x', messages: [] }));

    it('shows the running cost of the chat', () => {
        useChatStore.setState({
            messages: [
                { role: 'user', content: 'a' },
                { role: 'assistant', content: 'b', metadata: { cost: 0.01 } },
                { role: 'assistant', content: 'c', metadata: { cost: 0.0023 } },
            ],
        });
        renderInput();
        expect(screen.getByTestId('chat-cost').textContent).toBe('chat: $0.0123');
    });

    it('hides the total when nothing was billed', () => {
        useChatStore.setState({ messages: [{ role: 'assistant', content: 'b', metadata: { cost: null } }] });
        renderInput();
        expect(screen.queryByTestId('chat-cost')).toBeNull();
    });
});
