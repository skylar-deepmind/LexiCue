import { extractClipboard, extractWebpage } from './contentExtract';
self.onmessage = async event => {
    const progress = (value: number) => self.postMessage({ progress: value });
    try {
        const result = event.data.kind === 'clipboard'
            ? await extractClipboard(event.data.text, progress)
            : await extractWebpage(event.data.response, progress);
        self.postMessage({ result });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : 'material_parse_failed' });
    }
};
