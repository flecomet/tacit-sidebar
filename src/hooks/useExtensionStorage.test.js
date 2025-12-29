import { renderHook, act } from '@testing-library/react';
import { useExtensionStorage } from './useExtensionStorage';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('useExtensionStorage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset chrome mock storage
        chrome.storage.local.get.mockImplementation((key, callback) => {
            if (callback) callback({});
            return Promise.resolve({});
        });
    });

    it('should initialize with default value if storage is empty', async () => {
        const { result } = renderHook(() => useExtensionStorage('myKey', 'defaultVal'));

        // Wait for useEffect to run
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(result.current[0]).toBe('defaultVal');
        expect(chrome.storage.local.get).toHaveBeenCalledWith(['myKey'], expect.any(Function));
    });

    it('should load value from chrome storage on mount', async () => {
        chrome.storage.local.get.mockImplementation((keys, callback) => {
            const data = { myKey: 'storedVal' };
            if (callback) callback(data);
            return Promise.resolve(data);
        });

        const { result } = renderHook(() => useExtensionStorage('myKey', 'defaultVal'));

        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(result.current[0]).toBe('storedVal');
    });

    it('should update chrome storage when value changes', async () => {
        const { result } = renderHook(() => useExtensionStorage('myKey', 'defaultVal'));

        await act(async () => {
            const setVal = result.current[1];
            await setVal('newVal');
        });

        expect(result.current[0]).toBe('newVal');
        expect(chrome.storage.local.set).toHaveBeenCalledWith({ myKey: 'newVal' });
    });
});
