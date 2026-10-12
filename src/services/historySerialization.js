const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const MAX_HISTORY_CHUNK_BYTES = 256 * 1024;

export function splitHistoryValue(value, recordId, kind, conversationId) {
    const bytes = encoder.encode(JSON.stringify(value));
    const units = [];
    for (let offset = 0; offset < bytes.length; offset += MAX_HISTORY_CHUNK_BYTES) {
        const chunkIndex = units.length;
        units.push({ id: `${conversationId}/${kind}/${recordId}/${chunkIndex}`, conversationId, kind, recordId, chunkIndex, bytes: bytes.slice(offset, offset + MAX_HISTORY_CHUNK_BYTES) });
    }
    return units;
}

export function joinHistoryValue(parts) {
    const ordered = [...parts].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const length = ordered.reduce((total, part) => total + part.bytes.byteLength, 0);
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const part of ordered) { joined.set(part.bytes, offset); offset += part.bytes.byteLength; }
    return JSON.parse(decoder.decode(joined));
}

// Payload references preserve separate display/send variants and share repeated binary data.
export function serializeMessage(message, recordId, conversationId) {
    const payloads = new Map();
    const collect = value => {
        if (typeof value === 'string' && value.startsWith('data:') && !payloads.has(value)) payloads.set(value, `${recordId}:attachment:${payloads.size}`);
        else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(message);
    const extract = value => {
        if (typeof value === 'string') {
            if (payloads.has(value)) return { __tacitAttachment: payloads.get(value) };
            const parts = [];
            let rest = value;
            while (rest) {
                let hit, position = Infinity;
                for (const [payload, id] of payloads) {
                    const next = rest.indexOf(payload);
                    if (next >= 0 && next < position) { hit = [payload, id]; position = next; }
                }
                if (!hit) break;
                parts.push(rest.slice(0, position), { __tacitAttachment: hit[1] });
                rest = rest.slice(position + hit[0].length);
            }
            return parts.length ? { __tacitStringParts: [...parts, rest] } : value;
        }
        if (Array.isArray(value)) return value.map(extract);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, extract(item)]));
        return value;
    };
    return [
        ...splitHistoryValue(extract(message), recordId, 'messages', conversationId),
        ...[...payloads].flatMap(([payload, id]) => splitHistoryValue(payload, id, 'attachments', conversationId)),
    ];
}

export function restoreMessage(value, attachments) {
    if (Array.isArray(value)) return value.map(item => restoreMessage(item, attachments));
    if (value && typeof value === 'object') {
        if (typeof value.__tacitAttachment === 'string') {
            if (!attachments.has(value.__tacitAttachment)) throw new Error('History attachment is missing');
            return attachments.get(value.__tacitAttachment);
        }
        if (Array.isArray(value.__tacitStringParts)) return value.__tacitStringParts.map(item => restoreMessage(item, attachments)).join('');
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreMessage(item, attachments)]));
    }
    return value;
}

export function serializeSession(session) {
    const { messages = [], ...metadata } = session;
    const messageIds = messages.map((_, index) => `legacy:${index}`);
    return [
        ...splitHistoryValue({ ...metadata, messageIds }, 'manifest', 'manifest', session.id),
        ...messages.flatMap((message, index) => serializeMessage(message, messageIds[index], session.id)),
    ];
}
