import { parseEnglishSrt } from './englishSrt';
import { parseEnglishText } from './englishText';
self.onmessage = (event: MessageEvent<string | { content: string; type: 'srt' | 'txt' }>) => {
    try {
        const input = typeof event.data === 'string' ? { content: event.data, type: 'srt' } : event.data;
        self.postMessage({ segments: input.type === 'txt' ? parseEnglishText(input.content) : parseEnglishSrt(input.content) });
    }
    catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : 'material_invalid_srt' });
    }
};
