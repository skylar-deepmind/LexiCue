import { Readability } from '@mozilla/readability';
import { DOMParser } from 'linkedom';
import { parse, serialize } from 'parse5';
import { buildDocument, documentDigest, type RawDocument } from './documentCore';
import { plainDocument } from './documentMarkup';
import { clipboardTitle } from './clipboardContent';
import { splitLongSentence } from './sentenceMerge';
import type { SegmentInput } from './types';
import type { ContentOrigin, ExtractedDocument } from './documentTypes';
export interface WebpageResponse { bytes_base64: string; submitted_url: string; final_url: string; content_type: string; fetched_at: number }
const blockTags = new Set('address article aside blockquote dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main ol p pre section table tbody td th thead tr ul summary details'.split(' '));
const skip = new Set('script style noscript template svg head button input select textarea iframe object embed audio video canvas'.split(' '));
/** Same projection as the evaluated prototype: no bracket/number/negation cleanup. */
export function projectArticle(node: any): string {
    const parts: {text:string;code:boolean}[]=[];
    const add=(text:string)=>{if(parts.length&&!parts.at(-1)!.code)parts.at(-1)!.text+=text;else parts.push({text,code:false});};
    const walk=(n:any)=>{if(n.nodeType===3){add(n.nodeValue);return;}if(n.nodeType!==1||skip.has(n.localName))return;if(n.localName==='br'){add('\n');return;}if(n.localName==='pre'){add('\n\n');parts.push({text:n.textContent,code:true});add('\n\n');return;}if(blockTags.has(n.localName))add('\n');for(const c of n.childNodes)walk(c);if(blockTags.has(n.localName))add('\n');};
    walk(node);for(const p of parts)if(!p.code)p.text=p.text.replace(/\r\n?/g,'\n').replace(/\n[ \t]*\n(?:[ \t]*\n)+/g,'\n\n');
    if(parts[0]&&!parts[0].code)parts[0].text=parts[0].text.trimStart();if(parts.at(-1)&&!parts.at(-1)!.code)parts.at(-1)!.text=parts.at(-1)!.text.trimEnd();return parts.map(p=>p.text).join('');
}
async function prepare(raw: RawDocument, text: string, origin: ContentOrigin): Promise<ExtractedDocument> {
    const sourceHash = await documentDigest(new TextEncoder().encode(origin.kind==='webpage' ? `${origin.submitted_url}\n${origin.final_url}\n${text}` : text));
    const result=await buildDocument(raw,origin.kind,origin.title,sourceHash);
    // Keep exact captured text, including whitespace. Re-anchor normalized blocks against it.
    let cursor=0;
    for(const block of result.document.blocks){const at=text.indexOf(block.text,cursor);if(at<0)throw Error('material_content_alignment');block.start_utf16=at;block.end_utf16=at+block.text.length;cursor=block.end_utf16;}
    result.content=text;result.document.normalized_sha256=await documentDigest(new TextEncoder().encode(text));
    result.document.schema_version=2;result.document.origin=origin;result.document.display_name=origin.title;
    result.document.extractor_version=origin.kind==='webpage'?'lexicue-readability/0.6.0-linkedom-1':'lexicue-clipboard/1';
    // Content inputs use lossless sentence spans; legacy file cleanup is unchanged.
    const rebuilt: SegmentInput[]=[];
    for(const block of result.document.blocks){
        const english=block.text.split('\n').filter(line=>!(/\p{Script=Han}/u.test(line)&&!/[A-Za-z]/.test(line)&&!/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line))).join(' ');
        const translation=block.segment_indices.map(i=>result.segments[i].zh_text).filter(Boolean).join(' ') || null;
        block.segment_indices=[];
        if(!/[A-Za-z]/.test(english) && !(/\p{N}/u.test(english)&&!/\p{Alphabetic}/u.test(english))){
            if(/\p{Alphabetic}/u.test(english))throw Error('material_content_alignment');
            continue; // Symbols remain in the original body, without inventing a spoken English sentence.
        }
        let pending='';const pieces:string[]=[];
        for(const span of new Intl.Segmenter('en',{granularity:'sentence'}).segment(english)){
            for(const part of splitLongSentence(span.segment)){
                if(!/[A-Za-z\p{N}]/u.test(part)){if(pieces.length)pieces[pieces.length-1]+=part;else pending+=part;}
                else {pieces.push(pending+part);pending='';}
            }
        }
        if(pending&&pieces.length)pieces[pieces.length-1]+=pending;
        if(pieces.join('').replace(/\s/g,'')!==english.replace(/\s/g,''))throw Error('material_content_alignment');
        for(const [i,text] of pieces.entries()){block.segment_indices.push(rebuilt.length);rebuilt.push({index:rebuilt.length,en_text:text,zh_text:i===0?translation:null,start_time:null,end_time:null});}
    }
    result.segments=rebuilt;
    return result;
}
export async function extractClipboard(text:string):Promise<ExtractedDocument>{
    if(new TextEncoder().encode(text).length>8_000_000)throw Error('material_too_large');
    if([...text].some(c=>c.charCodeAt(0)<32 && !['\t','\r','\n'].includes(c)))throw Error('material_invalid_encoding');
    return prepare(plainDocument(text),text,{kind:'clipboard',title:clipboardTitle(text)});
}
export async function extractWebpage(response:WebpageResponse):Promise<ExtractedDocument>{
    const bytes=Uint8Array.from(atob(response.bytes_base64),c=>c.charCodeAt(0));
    if(bytes.length>8_000_000)throw Error('material_web_large');
    const headerEncoding=/charset\s*=\s*["']?([^\s;"']+)/i.exec(response.content_type)?.[1];
    const head=new TextDecoder('windows-1252').decode(bytes.slice(0,8192));
    const encoding=headerEncoding??/<meta[^>]+charset\s*=\s*["']?([^\s;"'/>]+)/i.exec(head)?.[1]??'utf-8';
    let html:string;try{html=new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch{throw Error('material_invalid_encoding');}
    // linkedom's data-only DOM has no loader or script execution, including in a Worker.
    const doc=new DOMParser().parseFromString(serialize(parse(html)),'text/html') as unknown as Document;
    const language=doc.documentElement?.lang?.toLowerCase();
    if(language&&!/^en(?:-|$)/.test(language)&&language!=='und')throw Error('material_english_only');
    const title=doc.title?.trim()??'';
    if(/^(?:just a moment|access denied|sign in|log in|login|page not found|404|403|verify you are human|attention required)(?:\b|$)/i.test(title))throw Error('material_web_unreadable');
    const originalText=doc.body ? projectArticle(doc.body) : '';
    const restricted=/\b(?:subscribe to (?:continue|read)|sign in to (?:continue|read)|verify (?:that )?you are human|enable javascript and cookies|checking your browser)\b/i.test(originalText);
    const article=new Readability(doc as unknown as Document,{maxElemsToParse:250000}).parse();
    if(!article?.content)throw Error('material_web_unreadable');
    const clean=new DOMParser().parseFromString(`<html><body>${article.content}</body></html>`,'text/html');
    const text=projectArticle(clean.body);
    const linked=[...clean.querySelectorAll('a')].reduce((n,a)=>n+(a.textContent?.replace(/\s/g,'').length??0),0);
    if(linked>text.replace(/\s/g,'').length*.4)throw Error('material_web_unreadable');
    const words=text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)??[];
    const english=(text.toLowerCase().match(/\b(?:the|this|that|we|you|it|is|are|was|were|have|has|will|would|does|not|to|of|with|and|at|on)\b/g)??[]).length;
    if(words.length<40||english<5||restricted&&words.length<200)throw Error('material_web_unreadable');
    const raw=plainDocument(text);
    raw.warnings.push('网页提取可能遗漏边注或章节，请核对原文。 / Extraction may omit side notes or sections; check the original.');
    if(restricted){raw.partial=true;raw.warnings.push('页面包含访问限制，当前仅有部分正文。 / This page restricts access; only partial text is available.');}
    const origin:ContentOrigin={kind:'webpage',title:(article.title?.trim()||title||new URL(response.final_url).hostname).slice(0,240),submitted_url:response.submitted_url,final_url:response.final_url,fetched_at:response.fetched_at};
    return prepare(raw,text,origin);
}
