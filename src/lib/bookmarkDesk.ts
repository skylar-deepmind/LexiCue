import {splitIntoSentences} from './sentenceMerge';

/** The first two real English sentences form a bookmark and its nearby context. */
export function bookmarkExcerpt(text: string) {
    const value=text.replace(/\s+/g,' ').trim();
    const sentences=splitIntoSentences(value,'en');
    return {quote:sentences[0]??'',context:sentences[1]??''};
}

export function bookmarkTitle(name:string) { return name.replace(/\.(?:txt|srt|vtt|pdf|docx|epub)$/i,''); }

/** Reserve complete preview rows; the same mounted list animates between fits. */
export function fitBookmarkShelf(available:number,items:number) {
    const regular=Math.min(4,items,Math.max(0,Math.floor((available-60)/72)));
    const count=regular>=3?regular:Math.min(4,items,Math.max(0,Math.floor((available-60)/60)));
    const rowHeight=regular>=3?72:60;
    return {count,rowHeight,height:60+count*rowHeight};
}
