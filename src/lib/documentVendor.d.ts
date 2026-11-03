declare module 'mammoth/mammoth.browser.js' { import mammoth from 'mammoth'; export default mammoth; }
declare module 'webvtt-parser' { const parser: { WebVTTParser: new () => { parse(input: string, mode: string): { cues: any[]; errors: any[] } } }; export default parser; }
