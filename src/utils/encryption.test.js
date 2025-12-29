import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './encryption';

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
});
