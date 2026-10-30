/** Classification never rewrites a text body or visits links embedded in it. */
export type ClipboardContent = { kind: 'text'; text: string } | { kind: 'youtube' | 'webpage'; url: string } | { kind: 'error'; error: 'clipboardEmpty' | 'invalidLink' | 'unsupportedProtocol' | 'multipleLinks' | 'unsupportedYoutube'; input: string };
const youtubeHosts = new Set(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be']);
const evidence = /^(?:[a-z][a-z\d+.-]*:\/\/|https?:|www\.)/i;
// A generic `word:` is also a common vocabulary note, not proof of a URI.
const opaqueProtocol = /^(?:mailto|javascript|data|file|ftp|tel|sms|blob|about):/i;
function link(value: string): URL | null {
    if (/\s|[<>"\\]/u.test(value) || /^www\.(?:$|[./?#])/i.test(value) || value.length > 8192) return null;
    try { const u = new URL(/^www\./i.test(value) ? `https://${value}` : value); return u.hostname && !u.username && !u.password ? u : null; } catch { return null; }
}
export function inspectClipboardContent(input: string | null): ClipboardContent {
    const text = input ?? '', value = text.trim();
    const error = (error: Extract<ClipboardContent, {kind:'error'}>['error']): ClipboardContent => ({kind:'error',error,input:text});
    if (!value) return error('clipboardEmpty');
    const pieces = value.split(/\s+/);
    if (pieces.length > 1 && pieces.every(part => evidence.test(part) && link(part))) return error('multipleLinks');
    // Anything accompanying a link is text, including Chinese notes and numbers.
    // English learning eligibility belongs to extraction, never URL classification.
    if (pieces.length > 1) return {kind:'text',text};
    if (!evidence.test(value) && !opaqueProtocol.test(value) && !/^https?\/\//i.test(value)) return {kind:'text',text};
    if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:/i.test(value)) return error('unsupportedProtocol');
    if (/^https?[:/]/i.test(value) && !/^https?:\/\//i.test(value)) return error('invalidLink');
    const url = link(value);
    if (!url) return error('invalidLink');
    if (!['http:','https:'].includes(url.protocol)) return error('unsupportedProtocol');
    if (youtubeHosts.has(url.hostname.toLowerCase())) {
        const id = url.hostname.includes('youtu.be') ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
        if (!id || !/^[\w-]{11}$/.test(id) || url.port) return error('unsupportedYoutube');
        return {kind:'youtube',url:url.href};
    }
    return {kind:'webpage',url:url.href};
}
export function clipboardTitle(text: string): string { return text.trim().split(/\r?\n/)[0].replace(/\s+/g,' ').slice(0,80) || 'Clipboard text'; }
