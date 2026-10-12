const FORMAT = 1;
const ALGORITHM = 'AES-GCM';

const binary = (value, label) => {
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') return new Uint8Array(value);
    throw new TypeError(`${label} must contain binary bytes`);
};

const authenticatedIdentity = ({ recordId, revision, chunkIndex = 0 }) => {
    if (typeof recordId !== 'string' || !recordId || !Number.isSafeInteger(revision) || revision < 0
        || !Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
        throw new TypeError('Invalid history record identity');
    }
    return new TextEncoder().encode(JSON.stringify(['tacit-history', FORMAT, recordId, revision, chunkIndex]));
};

const validateKey = (key) => {
    if (key?.algorithm?.name !== ALGORITHM || key.algorithm.length !== 256) {
        throw new TypeError('History encryption requires a 256-bit AES-GCM key');
    }
};

// Persistence belongs to the background owner so concurrent panels cannot create competing keys.
export const generateHistoryKey = () => globalThis.crypto.subtle.generateKey(
    { name: ALGORITHM, length: 256 }, false, ['encrypt', 'decrypt'],
);

export const encryptRecord = async ({ key, plaintext, ...identity }) => {
    validateKey(key);
    const additionalData = authenticatedIdentity(identity);
    const bytes = binary(plaintext, 'Plaintext');
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await globalThis.crypto.subtle.encrypt(
        { name: ALGORITHM, iv, additionalData, tagLength: 128 }, key, bytes,
    );
    return { format: FORMAT, iv, ciphertext };
};

export const decryptRecord = async ({ key, record, ...identity }) => {
    validateKey(key);
    const additionalData = authenticatedIdentity(identity);
    if (record?.format !== FORMAT) throw new TypeError('Unsupported history encryption format');
    const iv = binary(record.iv, 'IV');
    const ciphertext = binary(record.ciphertext, 'Ciphertext');
    if (iv.byteLength !== 12 || ciphertext.byteLength < 16) throw new TypeError('Invalid encrypted history record');
    return new Uint8Array(await globalThis.crypto.subtle.decrypt(
        { name: ALGORITHM, iv, additionalData, tagLength: 128 }, key, ciphertext,
    ));
};
