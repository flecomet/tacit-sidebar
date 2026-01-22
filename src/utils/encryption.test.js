import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, _resetCache } from './encryption';

describe('Encryption Utility', () => {

    it('should encrypt and decrypt a string correctly', async () => {
        const secret = 'sk-or-test-key-12345';
        const encrypted = await encrypt(secret);

        expect(encrypted).not.toBe(secret);
        expect(encrypted).not.toBe('');

        const decrypted = await decrypt(encrypted);
        expect(decrypted).toBe(secret);
    });

    it('should handle empty strings', async () => {
        expect(await encrypt('')).toBe('');
        expect(await decrypt('')).toBe('');
    });

    it('should return original string or empty on decryption failure', async () => {
        // 'zz' is not valid JSON format expected by new decrypt
        // The new decrypt returns the input string if it doesn't look like JSON
        expect(await decrypt('zz')).toBe('zz');

        // Test with invalid JSON
        expect(await decrypt('{"iv":[],"data":[]}')).toBe('');
    });
    it('should cache the key and not hit storage multiple times', async () => {
        _resetCache();

        chrome.storage.local.get.mockClear();

        await encrypt('test1');
        await encrypt('test2');
        await encrypt('test3');

        // Should be called ONLY ONCE if cached. 
        // Currently it is NOT cached, so this test should FAIL (RED).
        expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    });
    it('should handle concurrent access efficiently (prevent race conditions)', async () => {
        _resetCache();
        chrome.storage.local.get.mockClear();

        // Simulate concurrent calls (e.g. loading list of messages)
        await Promise.all([
            encrypt('concurrent1'),
            encrypt('concurrent2'),
            encrypt('concurrent3'),
            encrypt('concurrent4'),
            encrypt('concurrent5')
        ]);

        // Even with 5 concurrent calls, we should only hit storage/crypto ONCE
        expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    });
});

