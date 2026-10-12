import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryEncryptionStatus } from './useHistoryEncryptionStatus';
import * as historyClient from '../services/historyClient';

vi.mock('../services/historyClient', () => ({
    getHistoryStatus: vi.fn(),
    subscribeHistoryStatus: vi.fn(),
    reportHistoryInteraction: vi.fn(),
}));

let publish;
let unsubscribe;
const status = (phase, progress = 0) => ({ phase, progress, enabled: phase !== 'disabled', lastError: null });
beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    unsubscribe = vi.fn();
    historyClient.getHistoryStatus.mockResolvedValue(status('disabled'));
    historyClient.subscribeHistoryStatus.mockImplementation(listener => { publish = listener; return unsubscribe; });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useHistoryEncryptionStatus', () => {
    it('coalesces fast progress events to the newest status at no more than four visual updates per second', async () => {
        const { result } = renderHook(() => useHistoryEncryptionStatus());
        await act(async () => {});
        expect(result.current.isLoading).toBe(false);
        act(() => { publish(status('migrating', 0.1)); publish(status('migrating', 0.2)); });
        expect(result.current.phase).toBe('disabled');
        await act(async () => { await vi.advanceTimersByTimeAsync(249); });
        expect(result.current.phase).toBe('disabled');
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(result.current.progress).toBe(0.2);
        act(() => publish(status('complete', 1)));
        expect(result.current.phase).toBe('migrating');
        await act(async () => { await vi.advanceTimersByTimeAsync(250); });
        expect(result.current.phase).toBe('complete');
    });

    it('does not overwrite a subscription event with an older initial read', async () => {
        let finishRead;
        historyClient.getHistoryStatus.mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
        const { result } = renderHook(() => useHistoryEncryptionStatus());
        act(() => publish(status('paused', 0.6)));
        await act(async () => { await vi.advanceTimersByTimeAsync(250); finishRead(status('disabled')); });
        expect(result.current.phase).toBe('paused');
        expect(result.current.progress).toBe(0.6);
    });

    it('cleans up pending updates and its subscription when the panel closes', async () => {
        const { unmount } = renderHook(() => useHistoryEncryptionStatus());
        await act(async () => {});
        act(() => publish(status('migrating', 0.3)));
        unmount();
        expect(unsubscribe).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reports status-read errors without claiming that history is encrypted', async () => {
        historyClient.getHistoryStatus.mockRejectedValue(new Error('History unavailable'));
        const { result } = renderHook(() => useHistoryEncryptionStatus());
        await act(async () => {});
        expect(result.current.phase).toBe('error');
        expect(result.current.lastError).toBe('History unavailable');
        expect(result.current.isLoading).toBe(false);
    });

    it('limits interaction reports while keeping progress and typing independent', async () => {
        const { result } = renderHook(() => useHistoryEncryptionStatus());
        await act(async () => {});
        act(() => { result.current.reportInteraction(); result.current.reportInteraction(); });
        expect(historyClient.reportHistoryInteraction).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        act(() => result.current.reportInteraction());
        expect(historyClient.reportHistoryInteraction).toHaveBeenCalledTimes(2);
    });
});
