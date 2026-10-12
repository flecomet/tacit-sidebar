export const WEB_SEARCH_PREFIX = 'Search the web for current sources: ';

export function explicitSearchQuery(messages) {
    const content = [...messages].reverse().find(message => message.role === 'user')?.content;
    if (typeof content !== 'string' || !content.trimStart().startsWith(WEB_SEARCH_PREFIX.trimEnd())) return null;
    return content.trimStart().slice(WEB_SEARCH_PREFIX.trimEnd().length).trim();
}
