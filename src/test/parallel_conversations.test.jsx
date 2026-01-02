import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../store/useChatStore';

describe('Parallel Conversations Logic', () => {
    beforeEach(() => {
        useChatStore.getState().reset();
    });

    it('should add message to a specific session (background) while another is active', () => {
        const store = useChatStore.getState();

        // 1. Create two sessions
        store.createNewChat();
        // createNewChat only works if current is not empty, so add a dummy message
        store.addMessage({ role: 'user', content: 'Init A' });
        const sessionA = useChatStore.getState().currentSessionId;

        store.createNewChat(); // Switches to new chat
        const sessionB = useChatStore.getState().currentSessionId;

        expect(sessionA).not.toBe(sessionB);
        expect(useChatStore.getState().currentSessionId).toBe(sessionB);

        // 2. Simulate correct behavior: Add message to Session A (background)
        // This requires the new action we plan to implement: addMessageToSession
        const msg = { role: 'assistant', content: 'Response for A' };


        if (store.addMessageToSession) {
            store.addMessageToSession(sessionA, msg);

            // 3. Verify Session A has the message
            const updatedA = useChatStore.getState().sessions.find(s => s.id === sessionA);
            expect(updatedA.messages).toHaveLength(2);
            expect(updatedA.messages[1].content).toBe('Response for A');

            // 4. Verify Session B (active) does NOT have the message
            const updatedB = useChatStore.getState().sessions.find(s => s.id === sessionB);
            expect(updatedB.messages).toHaveLength(0);
        } else {
            // Fail initially if method missing
            throw new Error('addMessageToSession is not implemented yet');
        }
    });

    it('should allow adding messages to non-active session without switching', () => {
        const store = useChatStore.getState();
        store.createNewChat();
        const sessionA = useChatStore.getState().currentSessionId;

        store.createNewChat();
        const sessionB = useChatStore.getState().currentSessionId;

        // Simulate receiving a chunk for session A while B is active
        if (store.addMessageToSession) {
            store.addMessageToSession(sessionA, { role: 'assistant', content: 'Async Response' });

            const sessionALogs = useChatStore.getState().sessions.find(s => s.id === sessionA).messages;
            expect(sessionALogs).toHaveLength(1);
            expect(sessionALogs[0].content).toBe('Async Response');

            // Ensure we are still on session B
            expect(useChatStore.getState().currentSessionId).toBe(sessionB);
        }
    });
});
