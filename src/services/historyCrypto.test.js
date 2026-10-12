import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptRecord, encryptRecord, generateHistoryKey } from './historyCrypto';

let key;
const context = { recordId: 'message:one', revision: 3, chunkIndex: 2 };
const plaintext = new TextEncoder().encode('private message with image reference');

beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto);
    key = await generateHistoryKey();
});

describe('binary history encryption', () => {
    it('round trips binary data using a 256-bit key and fresh 12-byte IVs', async () => {
        const first = await encryptRecord({ key, plaintext, ...context });
        const second = await encryptRecord({ key, plaintext, ...context });
        expect(key.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
        expect(first.format).toBe(1);
        expect(first.iv.byteLength).toBe(12);
        expect(first.ciphertext.byteLength).toBe(plaintext.byteLength + 16);
        expect(ArrayBuffer.isView(first.iv)).toBe(true);
        expect(first.iv).not.toEqual(second.iv);
        expect(Array.from(await decryptRecord({ key, record: first, ...context }))).toEqual(Array.from(plaintext));
    });

    it.each([
        { recordId: 'message:other' }, { revision: 4 }, { chunkIndex: 3 },
    ])('rejects changed authenticated identity %j', async (change) => {
        const record = await encryptRecord({ key, plaintext, ...context });
        await expect(decryptRecord({ key, record, ...context, ...change })).rejects.toThrow();
    });

    it('rejects tampered ciphertext and a different key', async () => {
        const record = await encryptRecord({ key, plaintext, ...context });
        const otherKey = await generateHistoryKey();
        await expect(decryptRecord({ key: otherKey, record, ...context })).rejects.toThrow();
        new Uint8Array(record.ciphertext)[0] ^= 1;
        await expect(decryptRecord({ key, record, ...context })).rejects.toThrow();
    });

    it('propagates a native encryption failure without returning plaintext', async () => {
        const decryptOnly = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        await expect(encryptRecord({ key: decryptOnly, plaintext, ...context })).rejects.toThrow();
    });

    it('rejects nonbinary plaintext, malformed envelopes and unsafe identity', async () => {
        await expect(encryptRecord({ key, plaintext: 'cleartext', ...context })).rejects.toThrow();
        await expect(encryptRecord({ key, plaintext, ...context, revision: -1 })).rejects.toThrow();
        await expect(encryptRecord({ key, plaintext, ...context, chunkIndex: 0.5 })).rejects.toThrow();
        await expect(decryptRecord({ key, record: { format: 2 }, ...context })).rejects.toThrow();
        const record = await encryptRecord({ key, plaintext, ...context });
        await expect(decryptRecord({ key, record: { ...record, iv: new Uint8Array(11) }, ...context })).rejects.toThrow();
    });
});
