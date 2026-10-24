import { parseEnglishSrt } from './englishSrt';
self.onmessage = (event: MessageEvent<string>) => {
    try {
        self.postMessage({ segments: parseEnglishSrt(event.data) });
    }
    catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : 'material_invalid_srt' });
    }
};
